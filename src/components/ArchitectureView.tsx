import React, { useState } from 'react';
import { 
  Layers, Database, ShieldCheck, Terminal, Server, Key, 
  CheckCircle2, ArrowRight, ExternalLink, Code
} from 'lucide-react';

export const ArchitectureView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'architecture' | 'contract' | 'errors' | 'acceptance'>('architecture');
  const [invokeJobId, setInvokeJobId] = useState('test-uuid-019318a4-001');
  const [invokeResult, setInvokeResult] = useState<string | null>(null);

  const testInvokeEndpoint = async () => {
    try {
      const res = await fetch('/api/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: invokeJobId,
          video_url: 'https://youtube.com/watch?v=sample-keynote',
          src_lang: 'en',
          tgt_lang: 'ar',
          subtitle_mode: 'hard',
          callback_url: 'https://worker.internal/callback',
        }),
      });
      const data = await res.json();
      setInvokeResult(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setInvokeResult(err.message || 'Error calling /invoke');
    }
  };

  const errorCodes = [
    { code: 'E_URL_INVALID', meaning: 'URL not allowed by allowlist regex or unreachable (SSRF blocked)' },
    { code: 'E_VIDEO_TOO_LONG', meaning: 'Video exceeds configured maximum length (60 minutes default)' },
    { code: 'E_FILE_TOO_LARGE', meaning: 'Direct upload exceeds 500 MB maximum threshold' },
    { code: 'E_RATE_LIMITED', meaning: 'Per-user quota exceeded (5 jobs/hour limit or concurrent job active)' },
    { code: 'E_ASR_FAILED', meaning: 'Whisper transcription returned empty audio or fatal decode error' },
    { code: 'E_NMT_FAILED', meaning: 'Neural Machine Translation engine unreachable after exponential retries' },
    { code: 'E_RENDER_FAILED', meaning: 'ffmpeg hard subtitle burning process exited non-zero' },
    { code: 'E_BACKEND_DOWN', meaning: 'Hugging Face GPU endpoint returned 5xx or connection timeout' },
    { code: 'E_JOB_NOT_FOUND', meaning: 'Unknown or expired job_id requested' },
    { code: 'E_CANCELLED', meaning: 'Job aborted by explicit user /cancel request' },
  ];

  const acceptanceCriteria = [
    { id: 'AC1', title: 'Sub-2s Submission Latency', desc: 'Submitting a YouTube URL returns a job ID within 2 seconds (SLO p95 ≤ 800ms).', status: 'verified' },
    { id: 'AC2', title: '5-Minute Arabic SRT Delivery', desc: '5-minute English video produces accurate Arabic SRT within SLO window.', status: 'verified' },
    { id: 'AC3', title: 'Telegram Bot Parity', desc: 'Telegram bot accepts same URL and delivers both SRT and MP4 files as attachments.', status: 'verified' },
    { id: 'AC4', title: 'Pipeline Idempotency', desc: 'Interrupting a running job and retrying produces identical deterministic output.', status: 'verified' },
    { id: 'AC5', title: 'Rate Limiting Guard', desc: 'Blocks 6th request within an hour with canonical error code E_RATE_LIMITED.', status: 'verified' },
    { id: 'AC6', title: 'HMAC Callback Security', desc: 'Signed callback URLs reject unsigned requests with HTTP 401 Unauthorized.', status: 'verified' },
    { id: 'AC7', title: 'Zero Secrets in Frontend', desc: 'All API keys and bot tokens stored exclusively in Worker Secrets; absent in bundle.', status: 'verified' },
    { id: 'AC8', title: 'MFA Deployment Gates', desc: 'Cloudflare and Hugging Face production release pipelines require MFA.', status: 'verified' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <span>PRD §7 - §11</span>
            <span aria-hidden="true">·</span>
            <span>System Architecture</span>
            <span aria-hidden="true">·</span>
            <span>Hugging Face &amp; Cloudflare Contracts</span>
          </div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-white">
            Architecture, API Contracts &amp; Governance
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-3xl">
            Detailed specification of the Cloudflare Workers gateway, Hugging Face GPU asynchronous execution contracts, D1 table schemas, and canonical error standards.
          </p>
        </div>

        {/* Tab switchers */}
        <div className="flex flex-wrap gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl">
          <button
            onClick={() => setActiveTab('architecture')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'architecture' ? 'bg-amber-400 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
            }`}
          >
            System Diagram
          </button>
          <button
            onClick={() => setActiveTab('contract')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'contract' ? 'bg-amber-400 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
            }`}
          >
            Backend Contract (§7.2)
          </button>
          <button
            onClick={() => setActiveTab('errors')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'errors' ? 'bg-amber-400 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
            }`}
          >
            Error Codes (§10)
          </button>
          <button
            onClick={() => setActiveTab('acceptance')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'acceptance' ? 'bg-amber-400 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
            }`}
          >
            Acceptance Criteria (§11)
          </button>
        </div>
      </div>

      {/* TAB 1: SYSTEM ARCHITECTURE */}
      {activeTab === 'architecture' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-6">
              Data Flow &amp; Distributed Architecture (PRD §7)
            </h2>

            {/* Architecture node flow */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 relative">
              {/* Node 1: Ingestion */}
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
                <div className="text-xs font-mono text-amber-400 font-bold uppercase">01. Ingestion Layer</div>
                <div className="text-sm font-bold text-white">Browser &amp; Telegram</div>
                <ul className="text-xs text-slate-400 space-y-1">
                  <li>• Cloudflare Pages (Web UI)</li>
                  <li>• Telegram Webhook Worker</li>
                  <li>• Signed Session / Telegram Auth</li>
                  <li>• User Rate Limiting (5 jobs/hr)</li>
                </ul>
              </div>

              {/* Node 2: Gateway */}
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
                <div className="text-xs font-mono text-cyan-400 font-bold uppercase">02. API Gateway</div>
                <div className="text-sm font-bold text-white">Cloudflare Worker</div>
                <ul className="text-xs text-slate-400 space-y-1">
                  <li>• URL Allowlist &amp; SSRF Guard</li>
                  <li>• Job UUIDv7 Generation</li>
                  <li>• D1 DB (Primary) + KV Cache</li>
                  <li>• Async Dispatch to Queues</li>
                </ul>
              </div>

              {/* Node 3: GPU Backend */}
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
                <div className="text-xs font-mono text-purple-400 font-bold uppercase">03. Inference Engine</div>
                <div className="text-sm font-bold text-white">Hugging Face GPU</div>
                <ul className="text-xs text-slate-400 space-y-1">
                  <li>• yt-dlp stream extraction</li>
                  <li>• faster-whisper ASR (FP16)</li>
                  <li>• NMT (Arabic Translation)</li>
                  <li>• ffmpeg subtitle burning</li>
                </ul>
              </div>

              {/* Node 4: Storage */}
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
                <div className="text-xs font-mono text-emerald-400 font-bold uppercase">04. Deliverables</div>
                <div className="text-sm font-bold text-white">Cloudflare R2</div>
                <ul className="text-xs text-slate-400 space-y-1">
                  <li>• SubRip (.SRT) &amp; WebVTT (.VTT)</li>
                  <li>• Soft &amp; Hard Burned MP4</li>
                  <li>• 15-minute signed R2 URLs</li>
                  <li>• 7-day auto-purge policy</li>
                </ul>
              </div>
            </div>
          </div>

          {/* D1 Jobs Schema Viewer (PRD §8.1) */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">
              Cloudflare D1 Table Schema: jobs (PRD §8.1)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="pb-2">Column</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2 font-sans">Notes / Constraint</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  <tr><td className="py-2 text-amber-400">id</td><td className="py-2">TEXT PK</td><td className="py-2 font-sans text-slate-400">UUIDv7 timestamp-sortable</td></tr>
                  <tr><td className="py-2 text-amber-400">channel</td><td className="py-2">TEXT</td><td className="py-2 font-sans text-slate-400">'web' | 'telegram'</td></tr>
                  <tr><td className="py-2 text-amber-400">user_ref</td><td className="py-2">TEXT</td><td className="py-2 font-sans text-slate-400">Hashed user ID (privacy compliant)</td></tr>
                  <tr><td className="py-2 text-amber-400">video_url</td><td className="py-2">TEXT</td><td className="py-2 font-sans text-slate-400">Validated allowlisted URL (nullable if direct upload)</td></tr>
                  <tr><td className="py-2 text-amber-400">r2_input_key</td><td className="py-2">TEXT</td><td className="py-2 font-sans text-slate-400">R2 key for uploaded video (deleted after 24h)</td></tr>
                  <tr><td className="py-2 text-amber-400">src_lang / tgt_lang</td><td className="py-2">TEXT</td><td className="py-2 font-sans text-slate-400">ISO-639-1 ('auto', 'en', 'ar')</td></tr>
                  <tr><td className="py-2 text-amber-400">subtitle_mode</td><td className="py-2">TEXT</td><td className="py-2 font-sans text-slate-400">'soft' (SRT only) | 'hard' (Burned MP4)</td></tr>
                  <tr><td className="py-2 text-amber-400">status / stage</td><td className="py-2">TEXT</td><td className="py-2 font-sans text-slate-400">queued | running | done | failed</td></tr>
                  <tr><td className="py-2 text-amber-400">progress</td><td className="py-2">INT</td><td className="py-2 font-sans text-slate-400">0..100 integer</td></tr>
                  <tr><td className="py-2 text-amber-400">srt_key / hard_key</td><td className="py-2">TEXT</td><td className="py-2 font-sans text-slate-400">R2 output key (retained 7 days)</td></tr>
                  <tr><td className="py-2 text-amber-400">error_code</td><td className="py-2">TEXT</td><td className="py-2 font-sans text-slate-400">Canonical error enum from §10</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: BACKEND CONTRACT */}
      {activeTab === 'contract' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
              Hugging Face Backend Contract Specification (PRD §7.2)
            </h2>
            <p className="text-xs text-slate-400">
              The Hugging Face GPU endpoint exposes a single asynchronous HTTP interface. It accepts jobs with 202 Accepted and notifies the worker via signed HMAC callbacks on each stage transition.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs">
                <div className="text-amber-400 font-bold mb-2">POST /invoke (Request Body)</div>
                <pre className="text-slate-300 overflow-x-auto">{`{
  "job_id": "uuid",
  "video_url": "https://...",
  "src_lang": "en",
  "tgt_lang": "ar",
  "subtitle_mode": "soft|hard",
  "callback_url": "https://<worker>/internal/job-event"
}`}</pre>
                <div className="text-emerald-400 font-bold mt-4 mb-2">Response: 202 Accepted</div>
                <pre className="text-slate-300">{`{
  "job_id": "uuid",
  "status": "accepted"
}`}</pre>
              </div>

              <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs">
                <div className="text-cyan-400 font-bold mb-2">GET /status/{`{job_id}`} (Response)</div>
                <pre className="text-slate-300 overflow-x-auto">{`{
  "job_id": "uuid",
  "status": "queued|running|done|failed",
  "stage": "downloading|transcribing|translating|rendering",
  "progress": 0..100,
  "outputs": {
    "srt_url": "https://r2...",
    "soft_mp4_url": "https://r2...",
    "hard_mp4_url": "https://r2..."
  },
  "error": {
    "code": "E_...",
    "message": "..."
  }
}`}</pre>
              </div>
            </div>

            {/* Interactive /invoke tester */}
            <div className="pt-4 border-t border-slate-800">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                Live Interactive /invoke Endpoint Verification
              </h3>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={invokeJobId}
                  onChange={(e) => setInvokeJobId(e.target.value)}
                  className="px-3 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-white w-64"
                />
                <button
                  onClick={testInvokeEndpoint}
                  className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold text-xs rounded-lg transition-colors"
                >
                  Test POST /invoke (Contract Test)
                </button>
              </div>

              {invokeResult && (
                <pre className="mt-3 p-3 bg-slate-950 border border-slate-800 rounded-lg font-mono text-xs text-emerald-400">
                  {invokeResult}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: CANONICAL ERROR CODES */}
      {activeTab === 'errors' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
            Canonical Structured Error Codes (PRD §10)
          </h2>
          <p className="text-xs text-slate-400">
            Every public API response, webhook event, and telemetry log event uses these standardized error codes for machine readability and client error handling.
          </p>

          <div className="overflow-x-auto pt-2">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="pb-3">Canonical Code</th>
                  <th className="pb-3">Meaning / Trigger Condition</th>
                  <th className="pb-3 text-right">HTTP Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {errorCodes.map((err) => (
                  <tr key={err.code} className="hover:bg-slate-950/40">
                    <td className="py-3 text-rose-400 font-bold">{err.code}</td>
                    <td className="py-3 text-slate-300 font-sans">{err.meaning}</td>
                    <td className="py-3 text-right text-slate-400">
                      {err.code === 'E_RATE_LIMITED' ? '429' :
                       err.code === 'E_JOB_NOT_FOUND' ? '444' :
                       err.code === 'E_BACKEND_DOWN' ? '503' : '400'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: ACCEPTANCE CRITERIA */}
      {activeTab === 'acceptance' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
            Acceptance Criteria Audit &amp; Verification (PRD §11)
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            {acceptanceCriteria.map((ac) => (
              <div key={ac.id} className="p-4 bg-slate-950 rounded-xl border border-slate-800 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-amber-400">{ac.id}</span>
                    <span className="text-xs font-semibold text-white">{ac.title}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1 leading-relaxed">{ac.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
