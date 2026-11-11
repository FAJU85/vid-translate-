import { StructuredLog, SreMetrics, CanonicalErrorCode } from '../src/types/pipeline';
import crypto from 'crypto';

class SreService {
  private logs: StructuredLog[] = [];
  private maxLogs = 1000;
  private submissionLatencies: number[] = [142, 185, 210, 190, 310, 245, 160, 420, 290, 175];
  private metricCounters = {
    workerRequestsTotal: 28410,
    worker5xxTotal: 8,
    hfRequestsTotal: 620,
    hf5xxTotal: 3,
    hfQueueDepth: 2,
    d1WritesTotal: 4120,
    d1WriteErrors: 0,
    r2UploadsTotal: 1240,
    r2UploadFailures: 0,
    callbackTotal: 615,
    callbackUnsignedRejects: 1,
    telegramRequestsTotal: 1820,
    telegram4xxTotal: 4,
    rateLimitHits: 12,
    ssrfBlockedUrls: 7,
    authFailures: 3,
    hfInferenceMinutes: 418.5,
    hfActiveReplicas: 1,
    r2StorageGB: 42.6,
  };

  // Runbook and failure simulation states
  public systemState = {
    hfBackendHealthy: true,
    hfFallbackActive: false,
    acceptingJobs: true,
    hmacSecretRotatedAt: Date.now() - 3600 * 1000 * 24 * 12, // 12 days ago
    hmacCurrentKeyId: 'key_v1_active',
    r2Healthy: true,
    d1PrimaryHealthy: true,
    d1KvCacheMode: false,
    telegramWebhookHealthy: true,
    telegramLastErrorDate: null as string | null,
  };

  constructor() {
    this.seedInitialLogs();
  }

  private seedInitialLogs() {
    const services: StructuredLog['service'][] = ['api-gateway', 'hf-backend', 'telegram-worker', 'd1-jobs', 'r2-media', 'queue-worker'];
    const now = Date.now();
    for (let i = 20; i >= 1; i--) {
      const ts = new Date(now - i * 45000).toISOString();
      const service = services[i % services.length];
      this.log({
        ts,
        service,
        level: i === 3 ? 'warn' : 'info',
        job_id: `job-019318b8-6a3f-7e${i < 10 ? '0' + i : i}-99b2`,
        channel: i % 2 === 0 ? 'web' : 'telegram',
        stage: i % 2 === 0 ? 'transcribing' : 'translating',
        duration_ms: 120 + (i * 35),
        message: i === 3 
          ? 'Hugging Face queue depth briefly reached 6 replicas queue threshold'
          : `Stage transitioned successfully for job processing`,
      });
    }
  }

  public log(entry: Omit<StructuredLog, 'id' | 'ts'> & { id?: string; ts?: string }) {
    const fullLog: StructuredLog = {
      id: entry.id || crypto.randomUUID(),
      ts: entry.ts || new Date().toISOString(),
      service: entry.service,
      level: entry.level,
      job_id: entry.job_id,
      channel: entry.channel,
      stage: entry.stage,
      duration_ms: entry.duration_ms,
      error_code: entry.error_code,
      message: entry.message,
      ip: entry.ip,
    };

    this.logs.unshift(fullLog);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }
    return fullLog;
  }

  public recordSubmissionLatency(ms: number) {
    this.submissionLatencies.push(ms);
    if (this.submissionLatencies.length > 100) {
      this.submissionLatencies.shift();
    }
    this.metricCounters.workerRequestsTotal++;
  }

  public recordRateLimitHit(userRef: string) {
    this.metricCounters.rateLimitHits++;
    this.log({
      service: 'api-gateway',
      level: 'warn',
      error_code: 'E_RATE_LIMITED',
      message: `User ${userRef} exceeded 5 jobs/hour rate limit quota`,
    });
  }

  public recordSsrfBlock(url: string, ip?: string) {
    this.metricCounters.ssrfBlockedUrls++;
    this.log({
      service: 'api-gateway',
      level: 'warn',
      error_code: 'E_URL_INVALID',
      message: `SSRF Guard blocked submission: URL host not allowlisted or resolved to non-public IP: ${url}`,
      ip,
    });
  }

  public recordUnsignedCallback(reason: string) {
    this.metricCounters.callbackUnsignedRejects++;
    this.log({
      service: 'api-gateway',
      level: 'error',
      message: `Rejected unsigned callback from Hugging Face backend: ${reason}`,
    });
  }

  public getMetrics(jobsCount: number, failedJobsCount: number): SreMetrics {
    // Calculate p95 latency
    const sorted = [...this.submissionLatencies].sort((a, b) => a - b);
    const p95Idx = Math.floor(sorted.length * 0.95);
    const p95 = sorted[p95Idx] || 220;

    const worker5xxRate = (this.metricCounters.worker5xxTotal / Math.max(this.metricCounters.workerRequestsTotal, 1)) * 100;
    const hf5xxRate = (this.metricCounters.hf5xxTotal / Math.max(this.metricCounters.hfRequestsTotal, 1)) * 100;
    const telegram4xxRate = (this.metricCounters.telegram4xxTotal / Math.max(this.metricCounters.telegramRequestsTotal, 1)) * 100;
    
    const totalJobs = Math.max(jobsCount, 1);
    const successRate = Math.max(0, 100 - (failedJobsCount / totalJobs) * 100);

    const apiGatewayAvail = 99.96;
    const telegramWebhookAvail = this.systemState.telegramWebhookHealthy ? 99.95 : 94.20;
    const callbackAcceptance = 99.82;

    const activeAlerts: SreMetrics['activeAlerts'] = [];

    if (!this.systemState.hfBackendHealthy) {
      activeAlerts.push({
        id: 'alert-hf-down',
        level: 'P1',
        title: 'Hugging Face Inference Endpoint Unreachable',
        service: 'hf-backend',
        timestamp: new Date().toISOString(),
        description: 'Primary GPU endpoint failing healthcheck with 503. RB-1 recommended.',
        runbookId: 'RB-1',
      });
    }

    if (this.metricCounters.callbackUnsignedRejects > 5) {
      activeAlerts.push({
        id: 'alert-callback-storm',
        level: 'P2',
        title: 'Unsigned Callback Anomaly Threshold Exceeded',
        service: 'api-gateway',
        timestamp: new Date().toISOString(),
        description: 'More than 5 invalid HMAC callbacks detected in window. RB-2 recommended.',
        runbookId: 'RB-2',
      });
    }

    if (!this.systemState.r2Healthy) {
      activeAlerts.push({
        id: 'alert-r2-fail',
        level: 'P1',
        title: 'Cloudflare R2 Media Store Upload Errors',
        service: 'r2-media',
        timestamp: new Date().toISOString(),
        description: 'Persistent R2 PUT errors during artifact storage. RB-3 recommended.',
        runbookId: 'RB-3',
      });
    }

    if (!this.systemState.d1PrimaryHealthy) {
      activeAlerts.push({
        id: 'alert-d1-fail',
        level: 'P1',
        title: 'Cloudflare D1 Primary Store Write Failures',
        service: 'd1-jobs',
        timestamp: new Date().toISOString(),
        description: 'D1 write failed; KV buffer failover active. RB-4 recommended.',
        runbookId: 'RB-4',
      });
    }

    if (!this.systemState.telegramWebhookHealthy) {
      activeAlerts.push({
        id: 'alert-tg-silent',
        level: 'P2',
        title: 'Telegram Webhook Degraded',
        service: 'telegram-worker',
        timestamp: new Date().toISOString(),
        description: 'Telegram getWebhookInfo reports recent delivery failures. RB-5 recommended.',
        runbookId: 'RB-5',
      });
    }

    return {
      timestamp: new Date().toISOString(),
      slo: {
        apiGatewayAvailability: {
          current: apiGatewayAvail,
          target: 99.9,
          status: apiGatewayAvail >= 99.9 ? 'ok' : 'breach',
        },
        submissionLatencyP95: {
          currentMs: p95,
          targetMs: 800,
          status: p95 <= 800 ? 'ok' : 'breach',
        },
        pipelineSuccessRate: {
          current: parseFloat(successRate.toFixed(2)),
          target: 98.0,
          status: successRate >= 98.0 ? 'ok' : 'breach',
        },
        pipelineLatencyUnder5m: {
          currentMin: 2.3,
          targetMin: 4.0,
          status: 'ok',
        },
        pipelineLatency5to20m: {
          currentMin: 8.5,
          targetMin: 12.0,
          status: 'ok',
        },
        pipelineLatency20to60m: {
          currentMin: 21.4,
          targetMin: 30.0,
          status: 'ok',
        },
        callbackAcceptanceRate: {
          current: callbackAcceptance,
          target: 99.5,
          status: callbackAcceptance >= 99.5 ? 'ok' : 'breach',
        },
        telegramWebhookAvailability: {
          current: telegramWebhookAvail,
          target: 99.9,
          status: telegramWebhookAvail >= 99.9 ? 'ok' : 'breach',
        },
      },
      errorBudgets: {
        apiGateway: { remaining: 76.5, burnRate: 0.8 },
        pipeline: { remaining: 84.2, burnRate: 1.1 },
        telegram: { remaining: this.systemState.telegramWebhookHealthy ? 91.0 : 12.5, burnRate: this.systemState.telegramWebhookHealthy ? 0.6 : 8.4 },
      },
      goldenSignals: {
        worker5xxRate: parseFloat(worker5xxRate.toFixed(3)),
        workerP95Ms: p95,
        hfEndpoint5xxRate: parseFloat(hf5xxRate.toFixed(2)),
        hfQueueDepth: this.systemState.hfBackendHealthy ? this.metricCounters.hfQueueDepth : 48,
        d1WriteErrors: this.metricCounters.d1WriteErrors,
        r2UploadFailures: this.metricCounters.r2UploadFailures,
        callbackUnsignedRejects: this.metricCounters.callbackUnsignedRejects,
        telegramWebhook4xxRate: parseFloat(telegram4xxRate.toFixed(2)),
      },
      costAndCapacity: {
        hfInferenceMinutesToday: parseFloat(this.metricCounters.hfInferenceMinutes.toFixed(1)),
        hfActiveReplicas: this.metricCounters.hfActiveReplicas,
        r2StorageGB: parseFloat(this.metricCounters.r2StorageGB.toFixed(2)),
        d1RowsCount: 1420 + jobsCount,
        workerRequestsToday: this.metricCounters.workerRequestsTotal,
      },
      security: {
        authFailures24h: this.metricCounters.authFailures,
        rateLimitHits24h: this.metricCounters.rateLimitHits,
        ssrfBlockedUrls24h: this.metricCounters.ssrfBlockedUrls,
        invalidHmacCallbacks24h: this.metricCounters.callbackUnsignedRejects,
      },
      activeAlerts,
    };
  }

  public getLogs(limit = 100, service?: string, level?: string, search?: string): StructuredLog[] {
    let filtered = this.logs;
    if (service && service !== 'all') {
      filtered = filtered.filter(l => l.service === service);
    }
    if (level && level !== 'all') {
      filtered = filtered.filter(l => l.level === level);
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(l => 
        l.message.toLowerCase().includes(q) || 
        (l.job_id && l.job_id.toLowerCase().includes(q)) ||
        (l.error_code && l.error_code.toLowerCase().includes(q))
      );
    }
    return filtered.slice(0, limit);
  }

  // Interactive Runbook triggers
  public executeRunbookAction(runbookId: string, action: string) {
    if (runbookId === 'RB-1') {
      if (action === 'simulate_outage') {
        this.systemState.hfBackendHealthy = false;
        this.metricCounters.hf5xxTotal += 14;
        this.log({
          service: 'hf-backend',
          level: 'error',
          error_code: 'E_BACKEND_DOWN',
          message: 'RB-1: Simulated HF inference endpoint 503 outage triggered. Queue depth increasing.',
        });
        return { success: true, message: 'Simulated Hugging Face 503 outage. Jobs will queue or return E_BACKEND_DOWN.' };
      }
      if (action === 'switch_fallback') {
        this.systemState.hfFallbackActive = true;
        this.systemState.hfBackendHealthy = true;
        this.log({
          service: 'api-gateway',
          level: 'info',
          message: 'RB-1 Mitigation: Switched HF_FALLBACK_URL to secondary inference endpoint. Traffic re-routed.',
        });
        return { success: true, message: 'Switched to HF fallback replica. Pipeline restored.' };
      }
      if (action === 'restore_primary') {
        this.systemState.hfBackendHealthy = true;
        this.systemState.hfFallbackActive = false;
        this.log({
          service: 'hf-backend',
          level: 'info',
          message: 'RB-1 Resolution: Primary Hugging Face GPU endpoint recovered. Normal traffic resumed.',
        });
        return { success: true, message: 'Primary HF endpoint restored.' };
      }
    }

    if (runbookId === 'RB-2') {
      if (action === 'simulate_storm') {
        this.metricCounters.callbackUnsignedRejects += 18;
        this.log({
          service: 'api-gateway',
          level: 'error',
          message: 'RB-2: Detected 18 unsigned callback attempts from unverified IP range. Possible replay attack.',
        });
        return { success: true, message: 'Simulated unsigned callback storm. Alert P2 triggered.' };
      }
      if (action === 'rotate_secret') {
        this.systemState.hmacSecretRotatedAt = Date.now();
        this.systemState.hmacCurrentKeyId = 'key_v2_' + Math.random().toString(36).substring(2, 7);
        this.metricCounters.callbackUnsignedRejects = 0;
        this.log({
          service: 'api-gateway',
          level: 'info',
          message: `RB-2 Mitigation: Rotated HMAC callback secret to ${this.systemState.hmacCurrentKeyId}. 15m grace window active.`,
        });
        return { success: true, message: 'HMAC secret rotated successfully. WAF block rules deployed.' };
      }
    }

    if (runbookId === 'RB-3') {
      if (action === 'simulate_failure') {
        this.systemState.r2Healthy = false;
        this.metricCounters.r2UploadFailures += 6;
        this.log({
          service: 'r2-media',
          level: 'error',
          error_code: 'E_RENDER_FAILED',
          message: 'RB-3: R2 multipart upload failed with HTTP 500 error from bucket endpoint.',
        });
        return { success: true, message: 'Simulated R2 bucket upload failure.' };
      }
      if (action === 'mitigate_retry') {
        this.systemState.r2Healthy = true;
        this.log({
          service: 'r2-media',
          level: 'info',
          message: 'RB-3 Mitigation: R2 exponential backoff retry succeeded. Artifacts retained in temporary HF store re-uploaded.',
        });
        return { success: true, message: 'R2 upload retry succeeded. Bucket status normal.' };
      }
    }

    if (runbookId === 'RB-4') {
      if (action === 'simulate_d1_down') {
        this.systemState.d1PrimaryHealthy = false;
        this.systemState.d1KvCacheMode = true;
        this.metricCounters.d1WriteErrors += 4;
        this.log({
          service: 'd1-jobs',
          level: 'error',
          message: 'RB-4: Cloudflare D1 primary database write failed. Switched to KV read-cache with Queues buffer.',
        });
        return { success: true, message: 'Simulated D1 outage. Switched reads to KV cache and writes to queue buffer.' };
      }
      if (action === 'recover_d1') {
        this.systemState.d1PrimaryHealthy = true;
        this.systemState.d1KvCacheMode = false;
        this.metricCounters.d1WriteErrors = 0;
        this.log({
          service: 'd1-jobs',
          level: 'info',
          message: 'RB-4 Resolution: D1 primary recovered. Replayed buffered queue writes idempotently by job_id.',
        });
        return { success: true, message: 'D1 primary restored and buffered writes replayed idempotently.' };
      }
    }

    if (runbookId === 'RB-5') {
      if (action === 'simulate_tg_silent') {
        this.systemState.telegramWebhookHealthy = false;
        this.systemState.telegramLastErrorDate = new Date().toISOString();
        this.metricCounters.telegram4xxTotal += 8;
        this.log({
          service: 'telegram-worker',
          level: 'warn',
          message: 'RB-5: Telegram webhook reported 403 Forbidden / invalid token webhook status.',
        });
        return { success: true, message: 'Simulated Telegram webhook failure. Bot silent.' };
      }
      if (action === 'reregister_webhook') {
        this.systemState.telegramWebhookHealthy = true;
        this.systemState.telegramLastErrorDate = null;
        this.log({
          service: 'telegram-worker',
          level: 'info',
          message: 'RB-5 Resolution: Webhook re-registered with setWebhook API. Telegram bot operational.',
        });
        return { success: true, message: 'Telegram webhook re-registered and verified successfully.' };
      }
    }

    return { success: false, message: 'Unknown runbook or action.' };
  }
}

export const sreService = new SreService();
