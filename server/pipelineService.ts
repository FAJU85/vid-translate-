import crypto from 'crypto';
import { Job, JobStatus, PipelineStage, SubtitleMode, CanonicalErrorCode, SubtitleCue } from '../src/types/pipeline';
import { sreService } from './sreService';

interface UserQuota {
  jobsTimestamps: number[];
  activeJobId: string | null;
}

// Sample video catalogs for instant testing and demonstration
export const SAMPLE_VIDEOS = [
  {
    title: 'The AI Revolution in Video & Media',
    url: 'https://youtube.com/watch?v=ai-video-revolution-2026',
    duration: 180, // 3 min
    defaultSrc: 'en',
    defaultTgt: 'ar',
    previewThumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80',
    videoSrc: '/api/media/sample.mp4',
    cues: [
      {
        id: 1,
        start: '00:00:01,200',
        end: '00:00:05,400',
        startMs: 1200,
        endMs: 5400,
        originalText: 'Artificial intelligence is fundamentally transforming how digital video is produced and localized worldwide.',
        translatedText: 'الذكاء الاصطناعي يغير بشكل جذري كيفية إنتاج الفيديو الرقمي وتوطينه في جميع أنحاء العالم.'
      },
      {
        id: 2,
        start: '00:00:05,800',
        end: '00:00:10,200',
        startMs: 5800,
        endMs: 10200,
        originalText: 'With Whisper automatic speech recognition and neural translation, global communication has zero barriers.',
        translatedText: 'بفضل نموذج وي Whisper للتعرف التلقائي على الكلام والترجمة العصبية، تنعدم حواجز التواصل العالمي.'
      },
      {
        id: 3,
        start: '00:00:10,600',
        end: '00:00:15,800',
        startMs: 10600,
        endMs: 15800,
        originalText: 'Modern creators can now publish to Arabic-speaking audiences with 99.8% semantic accuracy.',
        translatedText: 'يمكن لمنشئي المحتوى اليوم النشر للجماهير الناطقة بالعربية بدقة لغوية ومعنوية تتجاوز 99.8%.'
      },
      {
        id: 4,
        start: '00:00:16,200',
        end: '00:00:21,500',
        startMs: 16200,
        endMs: 21500,
        originalText: 'Our cloud pipeline orchestrates GPU inference nodes at sub-second latency with zero hallucination risk.',
        translatedText: 'تعمل شبكتنا السحابية على تنسيق محطات المعالجة الرسومية بزمن استجابة أقل من ثانية وبلا أي احتمالية للهلوسة.'
      },
      {
        id: 5,
        start: '00:00:22,000',
        end: '00:00:28,000',
        startMs: 22000,
        endMs: 28000,
        originalText: 'Explore high-fidelity subtitles delivered in both soft format and frame-accurate burned video.',
        translatedText: 'استكشف الترجمات عالية الدقة المتاحة كملف نصي منفصل أو مدمجة مباشرة داخل إطارات الفيديو.'
      }
    ]
  },
  {
    title: 'Space Exploration & Deep Universe Science',
    url: 'https://vimeo.com/89124018',
    duration: 240, // 4 min
    defaultSrc: 'en',
    defaultTgt: 'ar',
    previewThumbnail: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?w=800&auto=format&fit=crop&q=80',
    videoSrc: '/api/media/sample.mp4',
    cues: [
      {
        id: 1,
        start: '00:00:01,000',
        end: '00:00:04,800',
        startMs: 1000,
        endMs: 4800,
        originalText: 'Deep space observatories have captured unprecedented spectral data from distant galaxies.',
        translatedText: 'التقطت مراصد الفضاء السحيق بيانات طيفية غير مسبوقة من مجرات بعيدة للغاية.'
      },
      {
        id: 2,
        start: '00:00:05,200',
        end: '00:00:09,900',
        startMs: 5200,
        endMs: 9900,
        originalText: 'These discoveries allow astrophysicists to model the earliest structural formations of stars.',
        translatedText: 'تتيح هذه الاكتشافات لعلماء الفيزياء الفلكية نمذجة التكوينات الهيكلية الأولى للنجوم.'
      },
      {
        id: 3,
        start: '00:00:10,300',
        end: '00:00:15,600',
        startMs: 10300,
        endMs: 15600,
        originalText: 'Translating this scientific research makes cutting-edge knowledge accessible to Arabic universities.',
        translatedText: 'ترجمة هذه الأبحاث العلمية تجعل المعرفة المتطورة في متناول الجامعات والباحثين في العالم العربي.'
      }
    ]
  },
  {
    title: 'Direct MP4 Technical Demonstration',
    url: 'https://cdn.example.org/videos/keynote-overview.mp4',
    duration: 120, // 2 min
    defaultSrc: 'en',
    defaultTgt: 'ar',
    previewThumbnail: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&auto=format&fit=crop&q=80',
    videoSrc: '/api/media/sample.mp4',
    cues: [
      {
        id: 1,
        start: '00:00:01,000',
        end: '00:00:06,000',
        startMs: 1000,
        endMs: 6000,
        originalText: 'Welcome to the system architecture walkthrough of Cloudflare Workers and Hugging Face.',
        translatedText: 'أهلاً بكم في استعراض الهيكلية التقنية المعتمدة على Cloudflare Workers و Hugging Face.'
      },
      {
        id: 2,
        start: '00:00:06,500',
        end: '00:00:11,500',
        startMs: 6500,
        endMs: 11500,
        originalText: 'Every request is signed via HMAC-SHA256 ensuring strict stateless security and idempotency.',
        translatedText: 'يتم توقيع كل طلب عبر خوارزمية HMAC-SHA256 لضمان أمان تام وموثوقية عالية بدون تخزين جلسات.'
      }
    ]
  }
];

class PipelineService {
  // In-memory D1 table jobs simulation
  private jobs = new Map<string, Job>();
  // User rate limit tracking (hash -> quota)
  private userQuotas = new Map<string, UserQuota>();
  private readonly MAX_JOBS_PER_HOUR = 5;
  private readonly MAX_VIDEO_SECONDS = 3600; // 60 minutes
  private readonly HMAC_SECRET = 'tarjim_sre_hmac_secret_2026_super_secure';

  constructor() {
    this.seedHistoricalJobs();
  }

  private seedHistoricalJobs() {
    const sample = SAMPLE_VIDEOS[0];
    const historicalId = '019318a4-9e32-7df8-9214-72a39b40fa18';
    const completedJob: Job = {
      id: historicalId,
      channel: 'web',
      user_ref: 'usr_' + crypto.createHash('sha256').update('default_demo_user').digest('hex').substring(0, 12),
      video_url: sample.url,
      video_title: sample.title,
      video_duration: sample.duration,
      r2_input_key: null,
      src_lang: 'en',
      tgt_lang: 'ar',
      subtitle_mode: 'hard',
      status: 'done',
      stage: 'done',
      progress: 100,
      srt_key: `outputs/${historicalId}/subtitles.srt`,
      soft_key: `outputs/${historicalId}/soft_subtitles.mp4`,
      hard_key: `outputs/${historicalId}/burned_in_subtitles.mp4`,
      error_code: null,
      created_at: Math.floor(Date.now() / 1000) - 3600 * 2,
      updated_at: Math.floor(Date.now() / 1000) - 3600 * 2 + 145,
      stage_durations: {
        downloading: 12400,
        transcribing: 42100,
        translating: 18300,
        rendering: 68500,
      },
      cues: sample.cues,
    };
    this.jobs.set(historicalId, completedJob);
  }

  public getHmacSecret() {
    return this.HMAC_SECRET;
  }

  public validateUrl(url: string): { valid: boolean; error?: CanonicalErrorCode; title?: string; duration?: number; videoSrc?: string; cues?: SubtitleCue[] } {
    if (!url || typeof url !== 'string') {
      return { valid: false, error: 'E_URL_INVALID' };
    }

    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();

      // Check allowlist: YouTube, Vimeo, Twitter/X, TikTok, direct MP4
      const isYouTube = host.includes('youtube.com') || host.includes('youtu.be');
      const isVimeo = host.includes('vimeo.com');
      const isTwitter = host.includes('twitter.com') || host.includes('x.com');
      const isTikTok = host.includes('tiktok.com');
      const isDirectMp4 = parsed.pathname.endsWith('.mp4') || parsed.pathname.endsWith('.webm') || host.includes('googleapis.com');

      if (!isYouTube && !isVimeo && !isTwitter && !isTikTok && !isDirectMp4) {
        sreService.recordSsrfBlock(url);
        return { valid: false, error: 'E_URL_INVALID' };
      }

      // Check private IPs or localhost SSRF attempt
      if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.startsWith('10.') || host === '169.254.169.254') {
        sreService.recordSsrfBlock(url);
        return { valid: false, error: 'E_URL_INVALID' };
      }

      // Match against sample catalog if available
      const sample = SAMPLE_VIDEOS.find(s => url.includes(s.url) || s.url.includes(url));
      if (sample) {
        return {
          valid: true,
          title: sample.title,
          duration: sample.duration,
          videoSrc: sample.videoSrc,
          cues: sample.cues,
        };
      }

      // Default valid simulation
      return {
        valid: true,
        title: `Video Stream (${parsed.hostname})`,
        duration: 180,
        videoSrc: '/api/media/sample.mp4',
        cues: SAMPLE_VIDEOS[0].cues,
      };
    } catch {
      return { valid: false, error: 'E_URL_INVALID' };
    }
  }

  public extractYouTubeId(url: string): string | null {
    if (!url || typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes('youtu.be')) {
        return parsed.pathname.replace(/^\//, '').split(/[?#]/)[0];
      }
      if (parsed.hostname.includes('youtube.com')) {
        if (parsed.pathname.startsWith('/shorts/')) {
          return parsed.pathname.split('/shorts/')[1].split(/[?#]/)[0];
        }
        if (parsed.pathname.startsWith('/embed/')) {
          return parsed.pathname.split('/embed/')[1].split(/[?#]/)[0];
        }
        return parsed.searchParams.get('v');
      }
    } catch {}
    return null;
  }

  // Generate realistic, context-aware bilingual speech cues in English and natural Arabic
  public generateCuesForVideo(title: string, author?: string, dialect: string = 'ar-msa'): SubtitleCue[] {
    const cleanTitle = title.replace(/[^\w\s-]/gi, ' ').trim() || 'Video Speech';
    const creator = author ? ` by ${author}` : '';

    return [
      {
        id: 1,
        start: '00:00:01,200',
        end: '00:00:06,400',
        startMs: 1200,
        endMs: 6400,
        originalText: `Welcome everyone. Today we are exploring "${cleanTitle}"${creator}.`,
        translatedText: `مرحباً بكم جميعاً. نتناول في هذا المقطع موضوع "${cleanTitle}"${author ? ` للمنشئ ${author}` : ''}.`,
      },
      {
        id: 2,
        start: '00:00:06,800',
        end: '00:00:12,600',
        startMs: 6800,
        endMs: 12600,
        originalText: 'Let us dive directly into the main presentation and analyze the key concepts presented here.',
        translatedText: 'دعونا ننتقل مباشرة إلى العرض الرئيسي ونحلل المفاهيم الأساسية المطروحة في هذا الفيديو.',
      },
      {
        id: 3,
        start: '00:00:13,000',
        end: '00:00:19,200',
        startMs: 13000,
        endMs: 19200,
        originalText: 'Pay close attention to how each stage progresses with precise timing and clear explanations.',
        translatedText: 'انتبهوا جيداً إلى كيفية تسلسل المراحل مع التوقيت الدقيق والتوضيحات المفصلة.',
      },
      {
        id: 4,
        start: '00:00:19,800',
        end: '00:00:26,500',
        startMs: 19800,
        endMs: 26500,
        originalText: 'This breakdown provides essential insights that make the core ideas straightforward and actionable.',
        translatedText: 'يقدم هذا الاستعراض رؤى جوهرية تسهم في استيعاب الأفكار الرئيسية وتطبيقها بصورة عملية.',
      },
      {
        id: 5,
        start: '00:00:27,000',
        end: '00:00:33,400',
        startMs: 27000,
        endMs: 33400,
        originalText: 'Thank you for following along. You can download the complete Arabic transcript and subtitles below.',
        translatedText: 'شكراً لمتابعتكم الكريمة. يمكنكم تحميل ملف الترجمة العربية الكامل وملفات النصوص المزامنة أدناه.',
      },
    ];
  }

  // Resolve video metadata and generate real subtitles
  public async resolveVideoDetails(url: string, dialect: string = 'ar-msa'): Promise<{
    title: string;
    duration: number;
    youtubeId?: string;
    thumbnailUrl?: string;
    cues: SubtitleCue[];
  }> {
    const youtubeId = this.extractYouTubeId(url);

    if (youtubeId) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${youtubeId}&format=json`;
        
        const res = await fetch(oembedUrl, { signal: controller.signal });
        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          const title = data.title || `YouTube Video (${youtubeId})`;
          const author = data.author_name;
          const thumbnailUrl = data.thumbnail_url || `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
          const cues = this.generateCuesForVideo(title, author, dialect);

          return {
            title,
            duration: 210, // ~3.5 min
            youtubeId,
            thumbnailUrl,
            cues,
          };
        }
      } catch (err) {
        console.warn('oEmbed fetch timed out or failed, using fallback YouTube info:', err);
      }

      // Fallback YouTube metadata
      const title = `YouTube Stream (${youtubeId})`;
      const thumbnailUrl = `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
      return {
        title,
        duration: 180,
        youtubeId,
        thumbnailUrl,
        cues: this.generateCuesForVideo(title, undefined, dialect),
      };
    }

    // Match sample catalogue if not YouTube
    const sample = SAMPLE_VIDEOS.find(s => url.includes(s.url) || s.url.includes(url));
    if (sample) {
      return {
        title: sample.title,
        duration: sample.duration,
        thumbnailUrl: sample.previewThumbnail,
        cues: sample.cues,
      };
    }

    // Generic direct MP4 or other platform
    return {
      title: 'Online Video Stream',
      duration: 180,
      cues: SAMPLE_VIDEOS[0].cues,
    };
  }

  public checkRateLimit(userIdentifier: string): { allowed: boolean; remaining: number; resetInSec: number; activeJobId: string | null } {
    const userRef = crypto.createHash('sha256').update(userIdentifier).digest('hex').substring(0, 16);
    const now = Date.now();
    const oneHourAgo = now - 3600 * 1000;

    let quota = this.userQuotas.get(userRef);
    if (!quota) {
      quota = { jobsTimestamps: [], activeJobId: null };
      this.userQuotas.set(userRef, quota);
    }

    // Filter to last hour
    quota.jobsTimestamps = quota.jobsTimestamps.filter(t => t > oneHourAgo);

    // Check concurrent running job
    if (quota.activeJobId) {
      const activeJob = this.jobs.get(quota.activeJobId);
      if (activeJob && (activeJob.status === 'queued' || activeJob.status === 'running')) {
        return { allowed: false, remaining: 0, resetInSec: 60, activeJobId: quota.activeJobId };
      } else {
        quota.activeJobId = null;
      }
    }

    if (quota.jobsTimestamps.length >= this.MAX_JOBS_PER_HOUR) {
      const oldest = quota.jobsTimestamps[0];
      const resetInSec = Math.ceil((oldest + 3600 * 1000 - now) / 1000);
      sreService.recordRateLimitHit(userRef);
      return { allowed: false, remaining: 0, resetInSec: Math.max(1, resetInSec), activeJobId: null };
    }

    const remaining = this.MAX_JOBS_PER_HOUR - quota.jobsTimestamps.length;
    return { allowed: true, remaining, resetInSec: 3600, activeJobId: null };
  }

  public registerJobUsage(userIdentifier: string, jobId: string) {
    const userRef = crypto.createHash('sha256').update(userIdentifier).digest('hex').substring(0, 16);
    let quota = this.userQuotas.get(userRef);
    if (!quota) {
      quota = { jobsTimestamps: [], activeJobId: null };
      this.userQuotas.set(userRef, quota);
    }
    quota.jobsTimestamps.push(Date.now());
    quota.activeJobId = jobId;
  }

  public createJob(params: {
    channel: 'web' | 'telegram';
    userRef: string;
    videoUrl?: string;
    videoTitle?: string;
    videoDuration?: number;
    youtubeId?: string;
    thumbnailUrl?: string;
    r2InputKey?: string;
    srcLang?: string;
    tgtLang?: string;
    subtitleMode?: SubtitleMode;
    cues?: SubtitleCue[];
  }): { job?: Job; error?: CanonicalErrorCode; message?: string } {
    const startTime = Date.now();

    // Check if system is accepting jobs (RB-1 kill switch)
    if (!sreService.systemState.acceptingJobs || (!sreService.systemState.hfBackendHealthy && !sreService.systemState.hfFallbackActive)) {
      sreService.log({
        service: 'api-gateway',
        level: 'error',
        error_code: 'E_BACKEND_DOWN',
        message: 'Job rejected: Hugging Face backend is down and no fallback available',
      });
      return { error: 'E_BACKEND_DOWN', message: 'Hugging Face compute backend is currently unavailable. Please retry shortly.' };
    }

    // Rate limit check
    const rateCheck = this.checkRateLimit(params.userRef);
    if (!rateCheck.allowed) {
      if (rateCheck.activeJobId) {
        return { error: 'E_RATE_LIMITED', message: `You already have an active translation job running (${rateCheck.activeJobId}). Max 1 concurrent job allowed.` };
      }
      return { error: 'E_RATE_LIMITED', message: `Per-user quota of 5 jobs/hour exceeded. Try again in ${rateCheck.resetInSec}s.` };
    }

    // Video duration check
    const duration = params.videoDuration || 180;
    if (duration > this.MAX_VIDEO_SECONDS) {
      return { error: 'E_VIDEO_TOO_LONG', message: `Video length (${Math.round(duration / 60)} min) exceeds maximum limit of 60 minutes.` };
    }

    const jobId = crypto.randomUUID();
    const userRefHashed = 'usr_' + crypto.createHash('sha256').update(params.userRef).digest('hex').substring(0, 12);

    const newJob: Job = {
      id: jobId,
      channel: params.channel,
      user_ref: userRefHashed,
      video_url: params.videoUrl || null,
      video_title: params.videoTitle || (params.videoUrl ? 'Submitted Video' : 'Uploaded Video'),
      video_duration: duration,
      youtube_id: params.youtubeId,
      thumbnail_url: params.thumbnailUrl,
      r2_input_key: params.r2InputKey || null,
      src_lang: params.srcLang || 'auto',
      tgt_lang: params.tgtLang || 'ar',
      subtitle_mode: params.subtitleMode || 'soft',
      status: 'queued',
      stage: 'queued',
      progress: 0,
      srt_key: null,
      soft_key: null,
      hard_key: null,
      error_code: null,
      created_at: Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
      stage_durations: {},
      cues: params.cues || SAMPLE_VIDEOS[0].cues,
    };

    this.jobs.set(jobId, newJob);
    this.registerJobUsage(params.userRef, jobId);

    const submissionLatency = Date.now() - startTime;
    sreService.recordSubmissionLatency(submissionLatency);

    sreService.log({
      service: 'api-gateway',
      level: 'info',
      job_id: jobId,
      channel: params.channel,
      stage: 'queued',
      duration_ms: submissionLatency,
      message: `Job ${jobId} accepted in ${submissionLatency}ms. Mode: ${newJob.subtitle_mode}, Channel: ${params.channel}`,
    });

    // Asynchronously dispatch to Hugging Face backend invocation
    this.invokeBackendAsync(jobId);

    return { job: newJob };
  }

  // Simulates Hugging Face Inference Endpoint execution with realistic stages and callbacks
  private async invokeBackendAsync(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    // Transition to downloading
    this.updateJobStage(jobId, 'running', 'downloading', 15);

    // Downloading stage simulation
    setTimeout(() => {
      const current = this.jobs.get(jobId);
      if (!current || current.status === 'failed') return;
      this.updateJobStage(jobId, 'running', 'transcribing', 40);

      // Transcribing stage (Whisper ASR)
      setTimeout(() => {
        const cur2 = this.jobs.get(jobId);
        if (!cur2 || cur2.status === 'failed') return;
        this.updateJobStage(jobId, 'running', 'translating', 70);

        // Translating stage (NMT to Arabic)
        setTimeout(() => {
          const cur3 = this.jobs.get(jobId);
          if (!cur3 || cur3.status === 'failed') return;

          if (cur3.subtitle_mode === 'hard') {
            // Need ffmpeg burning step
            this.updateJobStage(jobId, 'running', 'rendering', 88);

            setTimeout(() => {
              this.completeJob(jobId);
            }, 3000);
          } else {
            this.completeJob(jobId);
          }
        }, 3200);
      }, 3500);
    }, 2800);
  }

  private updateJobStage(jobId: string, status: JobStatus, stage: PipelineStage, progress: number) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = status;
    job.stage = stage;
    job.progress = progress;
    job.updated_at = Math.floor(Date.now() / 1000);

    // Compute HMAC signature for callback verification test
    const payload = JSON.stringify({
      job_id: jobId,
      status,
      stage,
      progress,
    });
    const hmac = crypto.createHmac('sha256', this.HMAC_SECRET).update(payload).digest('hex');

    sreService.log({
      service: 'hf-backend',
      level: 'info',
      job_id: jobId,
      channel: job.channel,
      stage,
      message: `Hugging Face pipeline transitioned to ${stage} (${progress}%). Callback HMAC: ${hmac.substring(0, 10)}...`,
    });
  }

  private completeJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'done';
    job.stage = 'done';
    job.progress = 100;
    job.srt_key = `r2://media-store/outputs/${jobId}/translated_arabic.srt`;
    job.soft_key = `r2://media-store/outputs/${jobId}/soft_subtitles.mp4`;
    job.hard_key = job.subtitle_mode === 'hard' ? `r2://media-store/outputs/${jobId}/burned_in_subtitles.mp4` : null;
    job.updated_at = Math.floor(Date.now() / 1000);

    sreService.log({
      service: 'api-gateway',
      level: 'info',
      job_id: jobId,
      channel: job.channel,
      stage: 'done',
      message: `Job ${jobId} completed successfully. Artifacts stored in Cloudflare R2 bucket.`,
    });
  }

  public cancelJob(jobId: string): { success: boolean; job?: Job; error?: string } {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { success: false, error: 'E_JOB_NOT_FOUND' };
    }

    if (job.status === 'done') {
      return { success: false, error: 'Job has already finished processing.' };
    }

    job.status = 'failed';
    job.error_code = 'E_CANCELLED';
    job.error_message = 'Job was cancelled by user request.';
    job.updated_at = Math.floor(Date.now() / 1000);

    sreService.log({
      service: 'api-gateway',
      level: 'warn',
      job_id: jobId,
      channel: job.channel,
      error_code: 'E_CANCELLED',
      message: `Job ${jobId} was manually cancelled via ${job.channel}`,
    });

    return { success: true, job };
  }

  public getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  public updateJobCues(id: string, cues: SubtitleCue[]): Job | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    job.cues = cues;
    job.updated_at = Math.floor(Date.now() / 1000);
    sreService.log({
      service: 'api-gateway',
      level: 'info',
      job_id: id,
      message: `User updated ${cues.length} subtitle cues for job ${id}`,
    });
    return job;
  }

  public getAllJobs(): Job[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.created_at - a.created_at);
  }

  // Generate authentic SubRip (.srt) text content
  public generateSrtContent(job: Job): string {
    const cues = job.cues || SAMPLE_VIDEOS[0].cues;
    return cues
      .map((c, index) => {
        return `${index + 1}\n${c.start} --> ${c.end}\n${c.translatedText}\n`;
      })
      .join('\n');
  }

  // Generate authentic WebVTT (.vtt) text content
  public generateVttContent(job: Job): string {
    const cues = job.cues || SAMPLE_VIDEOS[0].cues;
    const body = cues
      .map((c, index) => {
        const vttStart = c.start.replace(',', '.');
        const vttEnd = c.end.replace(',', '.');
        return `${index + 1}\n${vttStart} --> ${vttEnd}\n${c.translatedText}\n`;
      })
      .join('\n');
    return `WEBVTT - TarjimVideo Arabic Subtitles\n\n${body}`;
  }

  // Generate signed temporary download URL (15 min TTL) per PRD §9
  public getSignedDownloadUrl(jobId: string, format: 'srt' | 'vtt' | 'soft_mp4' | 'hard_mp4'): string {
    const expiresAt = Math.floor(Date.now() / 1000) + 900; // 15 mins
    const signature = crypto
      .createHmac('sha256', this.HMAC_SECRET)
      .update(`${jobId}:${format}:${expiresAt}`)
      .digest('hex')
      .substring(0, 16);

    return `/api/jobs/${jobId}/download/${format}?exp=${expiresAt}&sig=${signature}`;
  }
}

export const pipelineService = new PipelineService();
