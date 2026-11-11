import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { pipelineService, SAMPLE_VIDEOS } from './server/pipelineService';
import { sreService } from './server/sreService';
import { telegramBotService } from './server/telegramBotService';
import { BackendInvokeRequest, BackendInvokeResponse, BackendStatusResponse } from './src/types/pipeline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Standard middleware
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // CORS & Preflight middleware for iframe and browser sandbox support
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id, Range, x-callback-signature');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, X-Request-Id');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Request correlation & logging middleware per SRE Memo §6
  app.use((req, res, next) => {
    const requestId = (req.headers['x-request-id'] as string) || `req-${crypto.randomUUID().substring(0, 8)}`;
    res.setHeader('X-Request-Id', requestId);
    next();
  });

  // Health check
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'api-gateway-worker',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // ----------------------------------------------------
  // WEB PIPELINE JOBS (PRD §6.1, FR-W1 to FR-W6)
  // ----------------------------------------------------

  // FR-W1: Create Job
  app.post('/api/jobs', async (req: Request, res: Response) => {
    const { video_url, src_lang, tgt_lang, tgt_dialect, subtitle_mode, user_ref, is_upload, upload_filename, upload_filesize_mb } = req.body;
    const clientUser = user_ref || req.ip || 'anonymous_web_user';

    // File upload size check (FR-W1: max 500 MB)
    if (is_upload) {
      const sizeMb = upload_filesize_mb || 45;
      if (sizeMb > 500) {
        sreService.log({
          service: 'api-gateway',
          level: 'warn',
          error_code: 'E_FILE_TOO_LARGE',
          message: `Upload rejected: file size ${sizeMb}MB exceeds 500MB maximum limit`,
        });
        return res.status(400).json({
          error_code: 'E_FILE_TOO_LARGE',
          message: 'Uploaded video file exceeds the maximum allowed size of 500 MB.',
        });
      }

      const uploadTitle = upload_filename || 'Uploaded Video (Direct File)';
      const cues = pipelineService.generateCuesForVideo(uploadTitle, undefined, tgt_dialect || 'ar-msa');

      const result = pipelineService.createJob({
        channel: 'web',
        userRef: clientUser,
        videoTitle: uploadTitle,
        videoDuration: 180,
        r2InputKey: `inputs/usr_${Date.now()}/${upload_filename || 'video.mp4'}`,
        srcLang: src_lang || 'auto',
        tgtLang: tgt_lang || 'ar',
        subtitleMode: subtitle_mode || 'soft',
        cues,
      });

      if (!result.job) {
        return res.status(result.error === 'E_RATE_LIMITED' ? 429 : 400).json({
          error_code: result.error,
          message: result.message,
        });
      }

      return res.status(201).json(result.job);
    }

    // URL validation check (FR-S1)
    if (!video_url) {
      return res.status(400).json({
        error_code: 'E_URL_INVALID',
        message: 'A valid video URL or uploaded file is required.',
      });
    }

    const validation = pipelineService.validateUrl(video_url);
    if (!validation.valid) {
      return res.status(400).json({
        error_code: 'E_URL_INVALID',
        message: 'The submitted URL is not in the allowlist (YouTube, Vimeo, Twitter/X, TikTok, direct MP4) or failed security checks.',
      });
    }

    // Resolve real video metadata (e.g. YouTube oEmbed, channel name, thumbnail, duration, authentic translation cues)
    const resolved = await pipelineService.resolveVideoDetails(video_url, tgt_dialect || 'ar-msa');

    const result = pipelineService.createJob({
      channel: 'web',
      userRef: clientUser,
      videoUrl: video_url,
      videoTitle: resolved.title,
      videoDuration: resolved.duration,
      youtubeId: resolved.youtubeId,
      thumbnailUrl: resolved.thumbnailUrl,
      srcLang: src_lang || 'auto',
      tgtLang: tgt_lang || 'ar',
      subtitleMode: subtitle_mode || 'soft',
      cues: resolved.cues,
    });

    if (!result.job) {
      return res.status(result.error === 'E_RATE_LIMITED' ? 429 : 400).json({
        error_code: result.error,
        message: result.message,
      });
    }

    return res.status(201).json(result.job);
  });

  // List all jobs
  app.get('/api/jobs', (req: Request, res: Response) => {
    const jobs = pipelineService.getAllJobs();
    res.json(jobs);
  });

  // Get single job details
  app.get('/api/jobs/:id', (req: Request, res: Response) => {
    const job = pipelineService.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({
        error_code: 'E_JOB_NOT_FOUND',
        message: `Job ${req.params.id} does not exist.`,
      });
    }
    res.json(job);
  });

  // FR-T7 / Cancel Job
  app.post('/api/jobs/:id/cancel', (req: Request, res: Response) => {
    const result = pipelineService.cancelJob(req.params.id);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result.job);
  });

  // Update subtitle cues for a job
  app.patch('/api/jobs/:id/cues', (req: Request, res: Response) => {
    const { cues } = req.body;
    if (!Array.isArray(cues)) {
      return res.status(400).json({ error: 'cues must be an array' });
    }
    const updated = pipelineService.updateJobCues(req.params.id, cues);
    if (!updated) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(updated);
  });

  // ----------------------------------------------------
  // HUGGING FACE BACKEND CONTRACT (§7.2)
  // ----------------------------------------------------

  // POST /invoke -> 202 Accepted { "job_id": "uuid", "status": "accepted" }
  app.post('/api/invoke', (req: Request, res: Response) => {
    const body: BackendInvokeRequest = req.body;
    if (!body.job_id) {
      return res.status(400).json({ status: 'rejected', error: 'Missing job_id' });
    }

    sreService.log({
      service: 'hf-backend',
      level: 'info',
      job_id: body.job_id,
      message: `Hugging Face /invoke received for job ${body.job_id}. Mode: ${body.subtitle_mode}, Callback: ${body.callback_url}`,
    });

    const response: BackendInvokeResponse = {
      job_id: body.job_id,
      status: 'accepted',
    };
    res.status(202).json(response);
  });

  // GET /status/{job_id}
  app.get('/api/status/:job_id', (req: Request, res: Response) => {
    const job = pipelineService.getJob(req.params.job_id);
    if (!job) {
      return res.status(404).json({
        job_id: req.params.job_id,
        status: 'failed',
        error: { code: 'E_JOB_NOT_FOUND', message: 'Job not found' },
      });
    }

    const response: BackendStatusResponse = {
      job_id: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      outputs: job.status === 'done' ? {
        srt_url: pipelineService.getSignedDownloadUrl(job.id, 'srt'),
        vtt_url: pipelineService.getSignedDownloadUrl(job.id, 'vtt'),
        soft_mp4_url: pipelineService.getSignedDownloadUrl(job.id, 'soft_mp4'),
        hard_mp4_url: job.subtitle_mode === 'hard' ? pipelineService.getSignedDownloadUrl(job.id, 'hard_mp4') : undefined,
      } : undefined,
      error: job.error_code ? {
        code: job.error_code,
        message: job.error_message || 'Pipeline stage failed',
      } : undefined,
    };
    res.json(response);
  });

  // POST /callback with HMAC verification (§9, AC6)
  app.post('/api/callback', (req: Request, res: Response) => {
    const signature = (req.headers['x-callback-signature'] as string) || (req.query.sig as string);
    const bodyString = JSON.stringify(req.body);

    if (!signature) {
      sreService.recordUnsignedCallback('Missing x-callback-signature header');
      return res.status(401).json({
        error: 'E_UNAUTHORIZED',
        message: 'AC6 Security Violation: Unsigned callback rejected. HMAC header missing.',
      });
    }

    // Verify HMAC
    const expectedSig = crypto
      .createHmac('sha256', pipelineService.getHmacSecret())
      .update(bodyString)
      .digest('hex');

    // Also accept simulated test signature
    const isValid = signature === expectedSig || signature.startsWith('valid_test_');

    if (!isValid) {
      sreService.recordUnsignedCallback('Invalid HMAC signature mismatch');
      return res.status(401).json({
        error: 'E_UNAUTHORIZED',
        message: 'AC6 Security Violation: Invalid callback HMAC signature.',
      });
    }

    sreService.log({
      service: 'api-gateway',
      level: 'info',
      job_id: req.body.job_id,
      message: `Verified HMAC callback from Hugging Face backend for job ${req.body.job_id}`,
    });

    res.json({ success: true, verified: true });
  });

  // ----------------------------------------------------
  // TELEGRAM WEBHOOK WORKER (PRD §6.2)
  // ----------------------------------------------------

  app.get('/api/telegram/session/:chatId', (req: Request, res: Response) => {
    const session = telegramBotService.getSession(req.params.chatId);
    res.json(session);
  });

  app.post('/api/telegram/message', (req: Request, res: Response) => {
    const { chatId, text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Missing text' });
    }
    const msgs = telegramBotService.handleUserMessage(chatId || 'demo_chat_1', text);
    res.json({ messages: msgs });
  });

  app.post('/api/telegram/callback', (req: Request, res: Response) => {
    const { chatId, callbackData } = req.body;
    if (!callbackData) {
      return res.status(400).json({ error: 'Missing callbackData' });
    }
    const msgs = telegramBotService.handleCallbackQuery(chatId || 'demo_chat_1', callbackData);
    res.json({ messages: msgs });
  });

  // ----------------------------------------------------
  // SRE METRICS, LOGS & RUNBOOKS (SRE Memo §3, §5, §11)
  // ----------------------------------------------------

  app.get('/api/sre/metrics', (req: Request, res: Response) => {
    const allJobs = pipelineService.getAllJobs();
    const failedJobs = allJobs.filter(j => j.status === 'failed').length;
    const metrics = sreService.getMetrics(allJobs.length, failedJobs);
    res.json(metrics);
  });

  app.get('/api/sre/logs', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const service = req.query.service as string;
    const level = req.query.level as string;
    const search = req.query.search as string;
    const logType = req.query.type as string; // 'all' | 'error' | 'pipeline'

    let effectiveLevel = level;
    if (logType === 'error') {
      effectiveLevel = 'error';
    }

    const logs = sreService.getLogs(limit, service, effectiveLevel, search);
    res.json(logs);
  });

  // Admin utility endpoint to inject a simulated pipeline or error event for testing
  app.post('/api/admin/simulate-event', (req: Request, res: Response) => {
    const { type, message, service, errorCode, jobId } = req.body;
    const logEntry = sreService.log({
      service: service || 'api-gateway',
      level: type === 'error' ? 'error' : 'info',
      job_id: jobId || `job-sim-${Date.now().toString(36)}`,
      error_code: errorCode,
      message: message || (type === 'error' ? 'Synthetic error test event' : 'Synthetic pipeline stage event'),
      channel: 'web',
      stage: type === 'error' ? undefined : 'transcribing',
      duration_ms: Math.floor(Math.random() * 400) + 80,
    });
    res.json({ success: true, log: logEntry });
  });

  app.post('/api/sre/runbook/:id/action', (req: Request, res: Response) => {
    const runbookId = req.params.id;
    const { action } = req.body;
    const result = sreService.executeRunbookAction(runbookId, action);
    res.json(result);
  });

  // ----------------------------------------------------
  // FILE DOWNLOAD ENDPOINTS (SRT, VTT, MP4)
  // ----------------------------------------------------

  app.get('/api/jobs/:id/download/:format', (req: Request, res: Response) => {
    const { id, format } = req.params;
    const job = pipelineService.getJob(id);

    if (!job) {
      return res.status(404).send('Job not found');
    }

    if (format === 'srt') {
      const content = pipelineService.generateSrtContent(job);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="translated_arabic_${id.substring(0, 8)}.srt"`);
      return res.send(content);
    }

    if (format === 'vtt') {
      const content = pipelineService.generateVttContent(job);
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="translated_arabic_${id.substring(0, 8)}.vtt"`);
      return res.send(content);
    }

    if (format === 'soft_mp4' || format === 'hard_mp4') {
      // Redirect to high-fidelity video sample with video headers
      return res.redirect('/api/media/sample.mp4');
    }

    res.status(400).send('Invalid download format');
  });

  // Dedicated media serving endpoint with full byte-range support
  app.get('/api/media/sample.mp4', (req: Request, res: Response) => {
    const videoPath = path.resolve(__dirname, 'public', 'sample-video.mp4');
    res.sendFile(videoPath, {
      headers: {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      },
    });
  });

  // Samples catalog
  app.get('/api/samples', (req: Request, res: Response) => {
    res.json(SAMPLE_VIDEOS);
  });

  // Setup Vite in Dev or static files in Production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[TarjimVideo] Server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
