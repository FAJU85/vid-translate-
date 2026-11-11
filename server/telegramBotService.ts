import { pipelineService, SAMPLE_VIDEOS } from './pipelineService';
import { sreService } from './sreService';
import { SubtitleMode } from '../src/types/pipeline';

export interface TelegramMessage {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
  inlineKeyboard?: Array<Array<{ text: string; callbackData: string }>>;
  attachment?: {
    type: 'document' | 'video';
    filename: string;
    filesize: string;
    downloadUrl: string;
    jobId?: string;
  };
  jobId?: string;
}

export interface TelegramUserSession {
  chatId: string;
  messages: TelegramMessage[];
  pendingJob?: {
    videoUrl?: string;
    srcLang?: string;
    tgtLang?: string;
    subtitleMode?: SubtitleMode;
  };
}

class TelegramBotService {
  private sessions = new Map<string, TelegramUserSession>();

  constructor() {
    this.initDefaultSession('demo_chat_1');
  }

  private initDefaultSession(chatId: string) {
    const session: TelegramUserSession = {
      chatId,
      messages: [
        {
          id: 'msg-start-1',
          sender: 'bot',
          text: `👋 Welcome to *TarjimVideo Bot*!\n\nI automatically translate videos into Arabic with neural precision using Whisper ASR and NMT.\n\n*Supported Platforms:*\n• YouTube, Vimeo, Twitter/X, TikTok, direct MP4\n\n*Available Commands:*\n• \`/start\` — View instructions & supported languages\n• \`/status <job_id>\` — Check real-time pipeline status\n• \`/cancel <job_id>\` — Abort a running translation job\n\nTo begin, paste a video link or pick one of the quick demo clips below:`,
          timestamp: new Date(Date.now() - 3600000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          inlineKeyboard: [
            [
              { text: '🎬 AI Revolution (YouTube)', callbackData: 'quick_demo:0' },
              { text: '🌌 Deep Universe (Vimeo)', callbackData: 'quick_demo:1' },
            ],
            [
              { text: '⚙️ Architecture Walkthrough (MP4)', callbackData: 'quick_demo:2' },
            ]
          ]
        }
      ],
      pendingJob: {},
    };
    this.sessions.set(chatId, session);
  }

  public getSession(chatId: string): TelegramUserSession {
    if (!this.sessions.has(chatId)) {
      this.initDefaultSession(chatId);
    }
    return this.sessions.get(chatId)!;
  }

  public handleUserMessage(chatId: string, text: string): TelegramMessage[] {
    const session = this.getSession(chatId);
    const userMsgId = 'msg-' + Date.now();
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Record user message
    const userMsg: TelegramMessage = {
      id: userMsgId,
      sender: 'user',
      text,
      timestamp: timeStr,
    };
    session.messages.push(userMsg);

    sreService.log({
      service: 'telegram-worker',
      level: 'info',
      channel: 'telegram',
      message: `Telegram webhook received message from chat ${chatId}: "${text.substring(0, 30)}..."`,
    });

    const trimmed = text.trim();

    // Command: /start (FR-T1)
    if (trimmed.startsWith('/start')) {
      const botResponse: TelegramMessage = {
        id: 'msg-' + (Date.now() + 1),
        sender: 'bot',
        text: `🚀 *TarjimVideo Bot — Arabic Video Localization*\n\nSend me any video URL or forwarded video message to transcribe and translate into Arabic with zero hallucination.\n\n*Supported Platforms:*\n• YouTube\n• Vimeo\n• Twitter / X\n• TikTok\n• Direct MP4 / WebM\n\n*Commands:*\n/status \`<job_id>\` — Query pipeline state\n/cancel \`<job_id>\` — Abort a queued or running job\n\nPaste a video link or choose a demo below:`,
        timestamp: timeStr,
        inlineKeyboard: [
          [
            { text: '🎬 AI Revolution (YouTube)', callbackData: 'quick_demo:0' },
            { text: '🌌 Deep Space (Vimeo)', callbackData: 'quick_demo:1' },
          ],
        ]
      };
      session.messages.push(botResponse);
      return [userMsg, botResponse];
    }

    // Command: /status <job_id> (FR-T6)
    if (trimmed.startsWith('/status')) {
      const parts = trimmed.split(' ');
      const jobId = parts[1];
      if (!jobId) {
        const errorMsg: TelegramMessage = {
          id: 'msg-' + (Date.now() + 1),
          sender: 'bot',
          text: `⚠️ *Usage:* \`/status <job_id>\`\nPlease provide the UUID of the job you wish to inspect.`,
          timestamp: timeStr,
        };
        session.messages.push(errorMsg);
        return [userMsg, errorMsg];
      }

      const job = pipelineService.getJob(jobId);
      if (!job) {
        const notFound: TelegramMessage = {
          id: 'msg-' + (Date.now() + 1),
          sender: 'bot',
          text: `❌ *Error: E_JOB_NOT_FOUND*\nNo translation job found matching ID: \`${jobId}\``,
          timestamp: timeStr,
        };
        session.messages.push(notFound);
        return [userMsg, notFound];
      }

      const statusMsg: TelegramMessage = {
        id: 'msg-' + (Date.now() + 1),
        sender: 'bot',
        text: `📊 *Job Status Report*\n\n*Job ID:* \`${job.id}\`\n*Status:* \`${job.status.toUpperCase()}\`\n*Stage:* \`${job.stage}\`\n*Progress:* ${job.progress}%\n*Mode:* \`${job.subtitle_mode}\`\n*Created:* ${new Date(job.created_at * 1000).toLocaleTimeString()}`,
        timestamp: timeStr,
      };
      session.messages.push(statusMsg);
      return [userMsg, statusMsg];
    }

    // Command: /cancel <job_id> (FR-T7)
    if (trimmed.startsWith('/cancel')) {
      const parts = trimmed.split(' ');
      const jobId = parts[1];
      if (!jobId) {
        const errorMsg: TelegramMessage = {
          id: 'msg-' + (Date.now() + 1),
          sender: 'bot',
          text: `⚠️ *Usage:* \`/cancel <job_id>\`\nPlease provide the UUID of the job to cancel.`,
          timestamp: timeStr,
        };
        session.messages.push(errorMsg);
        return [userMsg, errorMsg];
      }

      const cancelResult = pipelineService.cancelJob(jobId);
      if (!cancelResult.success) {
        const failMsg: TelegramMessage = {
          id: 'msg-' + (Date.now() + 1),
          sender: 'bot',
          text: `❌ *Cancellation Failed:*\n${cancelResult.error}`,
          timestamp: timeStr,
        };
        session.messages.push(failMsg);
        return [userMsg, failMsg];
      }

      const cancelledMsg: TelegramMessage = {
        id: 'msg-' + (Date.now() + 1),
        sender: 'bot',
        text: `🛑 *Job Cancelled Successfully*\nJob \`${jobId}\` has been aborted. Status set to \`failed (E_CANCELLED)\`.`,
        timestamp: timeStr,
      };
      session.messages.push(cancelledMsg);
      return [userMsg, cancelledMsg];
    }

    // URL or text handling (FR-T2)
    const validation = pipelineService.validateUrl(trimmed);
    if (!validation.valid) {
      const invalidUrlMsg: TelegramMessage = {
        id: 'msg-' + (Date.now() + 1),
        sender: 'bot',
        text: `⚠️ *Error: E_URL_INVALID*\n\nThe URL you provided is not supported or failed security allowlist check.\n\n*Allowed platforms:*\n• YouTube\n• Vimeo\n• Twitter / X\n• TikTok\n• Direct MP4 / WebM`,
        timestamp: timeStr,
      };
      session.messages.push(invalidUrlMsg);
      return [userMsg, invalidUrlMsg];
    }

    // Store pending job configuration & present inline keyboard (FR-T3)
    session.pendingJob = {
      videoUrl: trimmed,
      srcLang: 'auto',
      tgtLang: 'ar',
      subtitleMode: 'soft',
    };

    const configMsg: TelegramMessage = {
      id: 'msg-' + (Date.now() + 1),
      sender: 'bot',
      text: `📹 *Video Recognized:* "${validation.title || 'Selected Video'}"\n*Duration:* ~${Math.round((validation.duration || 180) / 60)} min\n\nPlease select your *Subtitle Mode* and *Target Language* below to start:`,
      timestamp: timeStr,
      inlineKeyboard: [
        [
          { text: '📄 Soft Subtitles (SRT)', callbackData: 'set_mode:soft' },
          { text: '🎬 Burned-in (Hard MP4)', callbackData: 'set_mode:hard' },
        ],
        [
          { text: '🇸🇦 Arabic (Modern Standard)', callbackData: 'set_lang:ar' },
          { text: '🌐 English (EN)', callbackData: 'set_lang:en' },
        ],
        [
          { text: '⚡ Start Translation Pipeline', callbackData: 'start_job' },
        ]
      ]
    };
    session.messages.push(configMsg);
    return [userMsg, configMsg];
  }

  public handleCallbackQuery(chatId: string, callbackData: string): TelegramMessage[] {
    const session = this.getSession(chatId);
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (!session.pendingJob) {
      session.pendingJob = {};
    }

    if (callbackData.startsWith('quick_demo:')) {
      const idx = parseInt(callbackData.split(':')[1], 10);
      const sample = SAMPLE_VIDEOS[idx] || SAMPLE_VIDEOS[0];
      session.pendingJob = {
        videoUrl: sample.url,
        srcLang: 'auto',
        tgtLang: 'ar',
        subtitleMode: 'soft',
      };

      const demoMsg: TelegramMessage = {
        id: 'msg-' + Date.now(),
        sender: 'bot',
        text: `🎬 Selected demo: *${sample.title}*\nURL: \`${sample.url}\`\n\nChoose configuration to initiate GPU translation:`,
        timestamp: timeStr,
        inlineKeyboard: [
          [
            { text: '📄 Soft (SRT Subtitles)', callbackData: 'set_mode:soft' },
            { text: '🎬 Hard (Burned-in Video)', callbackData: 'set_mode:hard' },
          ],
          [
            { text: '⚡ Start Translation Pipeline', callbackData: 'start_job' },
          ]
        ]
      };
      session.messages.push(demoMsg);
      return [demoMsg];
    }

    if (callbackData.startsWith('set_mode:')) {
      const mode = callbackData.split(':')[1] as SubtitleMode;
      session.pendingJob.subtitleMode = mode;
      const modeMsg: TelegramMessage = {
        id: 'msg-' + Date.now(),
        sender: 'bot',
        text: `✅ Subtitle Mode set to *${mode === 'soft' ? 'Soft (SRT file)' : 'Hard (Burned-in MP4)'}*.\n\nClick *Start Translation Pipeline* when ready!`,
        timestamp: timeStr,
        inlineKeyboard: [
          [
            { text: '⚡ Start Translation Pipeline', callbackData: 'start_job' },
          ]
        ]
      };
      session.messages.push(modeMsg);
      return [modeMsg];
    }

    if (callbackData === 'start_job') {
      const videoUrl = session.pendingJob.videoUrl || SAMPLE_VIDEOS[0].url;
      const sample = SAMPLE_VIDEOS.find(s => s.url === videoUrl) || SAMPLE_VIDEOS[0];

      const createResult = pipelineService.createJob({
        channel: 'telegram',
        userRef: 'tg_' + chatId,
        videoUrl: sample.url,
        videoTitle: sample.title,
        videoDuration: sample.duration,
        srcLang: session.pendingJob.srcLang || 'auto',
        tgtLang: session.pendingJob.tgtLang || 'ar',
        subtitleMode: session.pendingJob.subtitleMode || 'soft',
        cues: sample.cues,
      });

      if (!createResult.job) {
        const errorMsg: TelegramMessage = {
          id: 'msg-' + Date.now(),
          sender: 'bot',
          text: `❌ *Job Submission Failed:* ${createResult.error}\n${createResult.message}`,
          timestamp: timeStr,
        };
        session.messages.push(errorMsg);
        return [errorMsg];
      }

      const job = createResult.job;
      const startMsg: TelegramMessage = {
        id: 'msg-' + Date.now(),
        sender: 'bot',
        text: `⏳ *Job Accepted & Queued!*\n\n*Job ID:* \`${job.id}\`\n*Mode:* \`${job.subtitle_mode}\`\n*Target:* \`Arabic (ar)\`\n\n*Progress:*\n[░░░░░░░░░░] 0% — \`queued\`\n\n_I will update you as the job moves through Hugging Face GPU stages..._`,
        timestamp: timeStr,
        jobId: job.id,
      };
      session.messages.push(startMsg);

      // Trigger Telegram stage updates simulation (FR-T4 and FR-T5)
      this.simulateTelegramProgress(chatId, job.id, session.pendingJob.subtitleMode || 'soft');

      return [startMsg];
    }

    return [];
  }

  private simulateTelegramProgress(chatId: string, jobId: string, mode: SubtitleMode) {
    const session = this.getSession(chatId);

    // Downloading (15%)
    setTimeout(() => {
      const msg1: TelegramMessage = {
        id: 'msg-' + Date.now(),
        sender: 'bot',
        text: `⬇️ *Stage 1/4: Downloading video stream...*\n[██░░░░░░░░] 15% — \`downloading\``,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        jobId,
      };
      session.messages.push(msg1);

      // Transcribing (40%)
      setTimeout(() => {
        const msg2: TelegramMessage = {
          id: 'msg-' + Date.now(),
          sender: 'bot',
          text: `🎙️ *Stage 2/4: Transcribing speech (Whisper ASR)...*\n[████░░░░░░] 40% — \`transcribing\``,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          jobId,
        };
        session.messages.push(msg2);

        // Translating (70%)
        setTimeout(() => {
          const msg3: TelegramMessage = {
            id: 'msg-' + Date.now(),
            sender: 'bot',
            text: `🌐 *Stage 3/4: Translating into Arabic (NMT)...*\n[███████░░░] 70% — \`translating\``,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            jobId,
          };
          session.messages.push(msg3);

          if (mode === 'hard') {
            // Rendering (88%)
            setTimeout(() => {
              const msg4: TelegramMessage = {
                id: 'msg-' + Date.now(),
                sender: 'bot',
                text: `🎞️ *Stage 4/4: Burning Arabic subtitles into video (ffmpeg)...*\n[█████████░] 88% — \`rendering\``,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                jobId,
              };
              session.messages.push(msg4);

              setTimeout(() => {
                this.deliverTelegramOutputs(chatId, jobId, mode);
              }, 3000);
            }, 3000);
          } else {
            setTimeout(() => {
              this.deliverTelegramOutputs(chatId, jobId, mode);
            }, 3200);
          }
        }, 3200);
      }, 3500);
    }, 2800);
  }

  private deliverTelegramOutputs(chatId: string, jobId: string, mode: SubtitleMode) {
    const session = this.getSession(chatId);
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Document message (FR-T5)
    const srtDeliveryMsg: TelegramMessage = {
      id: 'msg-' + Date.now(),
      sender: 'bot',
      text: `🎉 *Translation Complete!*\n\nHere is your translated SubRip (.srt) subtitle document:`,
      timestamp: timeStr,
      attachment: {
        type: 'document',
        filename: `translated_arabic_${jobId.substring(0, 8)}.srt`,
        filesize: '4.2 KB',
        downloadUrl: pipelineService.getSignedDownloadUrl(jobId, 'srt'),
        jobId,
      },
      jobId,
    };
    session.messages.push(srtDeliveryMsg);

    if (mode === 'hard') {
      const videoDeliveryMsg: TelegramMessage = {
        id: 'msg-' + (Date.now() + 1),
        sender: 'bot',
        text: `📹 *Burned-in Subtitled Video Deliverable:*`,
        timestamp: timeStr,
        attachment: {
          type: 'video',
          filename: `subtitled_video_${jobId.substring(0, 8)}.mp4`,
          filesize: '14.8 MB',
          downloadUrl: pipelineService.getSignedDownloadUrl(jobId, 'hard_mp4'),
          jobId,
        },
        jobId,
      };
      session.messages.push(videoDeliveryMsg);
    }
  }
}

export const telegramBotService = new TelegramBotService();
