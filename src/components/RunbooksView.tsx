import React, { useState } from 'react';
import { 
  Terminal, AlertTriangle, ShieldCheck, Play, RefreshCw, CheckCircle, 
  Flame, Key, Database, HardDrive, Bot, ChevronRight
} from 'lucide-react';

export const RunbooksView: React.FC = () => {
  const [selectedRunbook, setSelectedRunbook] = useState<'RB-1' | 'RB-2' | 'RB-3' | 'RB-4' | 'RB-5'>('RB-1');
  const [actionOutput, setActionOutput] = useState<{ success: boolean; message: string } | null>(null);
  const [executingAction, setExecutingAction] = useState<string | null>(null);

  const executeAction = async (runbookId: string, action: string) => {
    setExecutingAction(action);
    setActionOutput(null);
    try {
      const res = await fetch(`/api/sre/runbook/${runbookId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      setActionOutput(data);
    } catch (err: any) {
      setActionOutput({ success: false, message: err.message || 'Action failed' });
    } finally {
      setExecutingAction(null);
    }
  };

  const runbooks = [
    {
      id: 'RB-1',
      title: 'Hugging Face Endpoint Down',
      service: 'hf-backend',
      icon: Flame,
      summary: 'Handles HF 5xx spikes or total GPU cluster outage by re-routing to secondary endpoint.',
      steps: [
        'Confirm via HF dashboard status + Cloudflare 5xx spike.',
        'Worker returns E_BACKEND_DOWN to clients; queue holds jobs (max 1h retention).',
        'If HF outage > 15 min: switch Worker env HF_FALLBACK_URL to secondary endpoint or disable submissions.',
        'Notify users on status page and Telegram channel.',
      ],
      actions: [
        { label: 'Simulate 503 HF Outage', action: 'simulate_outage', danger: true },
        { label: 'Switch to HF_FALLBACK_URL', action: 'switch_fallback', danger: false },
        { label: 'Restore Primary HF Endpoint', action: 'restore_primary', danger: false },
      ]
    },
    {
      id: 'RB-2',
      title: 'Callback Storm / Replay Attack',
      service: 'api-gateway',
      icon: Key,
      summary: 'Defends against forged or unsigned backend callbacks through immediate HMAC secret rotation and WAF throttling.',
      steps: [
        'Check Worker logs for callback signature failures (AC6).',
        'Rotate HMAC secret; old secret accepted for 15 min during rotation.',
        'Add offending IP / ASN to WAF block list.',
        'Replay failed legitimate callbacks from HF endpoint audit log.',
      ],
      actions: [
        { label: 'Simulate Unsigned Callback Storm', action: 'simulate_storm', danger: true },
        { label: 'Rotate HMAC Secret (15m grace)', action: 'rotate_secret', danger: false },
      ]
    },
    {
      id: 'RB-3',
      title: 'Cloudflare R2 Upload Failures',
      service: 'r2-media',
      icon: HardDrive,
      summary: 'Mitigates R2 multipart storage failures by retaining artifacts in HF temporary storage and re-uploading with exponential backoff.',
      steps: [
        'Verify R2 bucket status via Cloudflare status.',
        'Retry uploads from Worker with exponential backoff.',
        'If persistent: pause new jobs; retain completed outputs in HF temporary storage and re-upload on recovery.',
      ],
      actions: [
        { label: 'Simulate R2 Bucket Upload Failure', action: 'simulate_failure', danger: true },
        { label: 'Execute Exponential Backoff Retry', action: 'mitigate_retry', danger: false },
      ]
    },
    {
      id: 'RB-4',
      title: 'Cloudflare D1 Write Failure',
      service: 'd1-jobs',
      icon: Database,
      summary: 'Maintains platform uptime during database outages by failing over to KV cache for reads and buffering writes in Cloudflare Queues.',
      steps: [
        'Switch Worker reads to KV cache; queue writes.',
        'If D1 regional outage: failover to replica (read) and buffer writes to Queues.',
        'After recovery: replay buffered writes idempotently by job_id (FR-S5).',
      ],
      actions: [
        { label: 'Simulate D1 Write Outage', action: 'simulate_d1_down', danger: true },
        { label: 'Recover D1 & Replay Buffered Writes', action: 'recover_d1', danger: false },
      ]
    },
    {
      id: 'RB-5',
      title: 'Telegram Bot Silent / Desync',
      service: 'telegram-worker',
      icon: Bot,
      summary: 'Diagnoses unresponsive Telegram bot webhooks and re-establishes webhook bindings with Telegram Bot API.',
      steps: [
        'Verify webhook with getWebhookInfo.',
        'Re-register webhook if last_error_date is recent.',
        'Check Worker route bindings and secrets.',
        'Communicate downtime in the bot\'s /start message via KV flag.',
      ],
      actions: [
        { label: 'Simulate Webhook Desync', action: 'simulate_tg_silent', danger: true },
        { label: 'Re-register Webhook via setWebhook', action: 'reregister_webhook', danger: false },
      ]
    },
  ];

  const currentRb = runbooks.find(r => r.id === selectedRunbook)!;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      <div className="pb-6 border-b border-slate-800">
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
          <span>SRE Memo §11</span>
          <span aria-hidden="true">·</span>
          <span>Incident Operational Runbooks</span>
          <span aria-hidden="true">·</span>
          <span>Automated Mitigation Drills</span>
        </div>
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-white">
          SRE Incident Runbooks &amp; Failure Drills
        </h1>
        <p className="text-sm text-slate-400 mt-1 max-w-3xl">
          Execute end-to-end incident mitigation drills against the live platform architecture. Validate failover behavior, HMAC rotation, and queue buffering.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Runbook selector list (4 cols) */}
        <div className="lg:col-span-4 space-y-2">
          {runbooks.map((rb) => {
            const Icon = rb.icon;
            const isSelected = selectedRunbook === rb.id;
            return (
              <button
                key={rb.id}
                onClick={() => {
                  setSelectedRunbook(rb.id as any);
                  setActionOutput(null);
                }}
                className={`w-full text-left p-4 rounded-xl border transition-all ${
                  isSelected
                    ? 'border-amber-400/80 bg-slate-900 shadow-sm'
                    : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-amber-400" />
                    <span className="font-mono text-xs font-bold text-white">{rb.id}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">{rb.service}</span>
                </div>
                <div className="text-xs font-semibold text-slate-200">{rb.title}</div>
                <div className="text-[11px] text-slate-400 mt-1 line-clamp-2">{rb.summary}</div>
              </button>
            );
          })}
        </div>

        {/* Right: Selected Runbook Execution & Checklist (8 cols) */}
        <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono text-amber-400">
                <span>{currentRb.id}</span>
                <span>·</span>
                <span>Target: {currentRb.service}</span>
              </div>
              <h2 className="text-xl font-bold text-white mt-0.5">{currentRb.title}</h2>
              <p className="text-xs text-slate-400 mt-1">{currentRb.summary}</p>
            </div>
          </div>

          {/* Standard Operating Procedure (SOP) Checklist */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
              Standard Operating Procedure (SOP Checklist)
            </h3>
            <div className="space-y-2.5">
              {currentRb.steps.map((step, idx) => (
                <div key={idx} className="flex items-start gap-3 p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <span className="font-mono text-xs text-amber-400 font-bold shrink-0 mt-0.5">
                    {idx + 1}.
                  </span>
                  <span className="text-xs text-slate-300 leading-relaxed">{step}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Interactive Drill & Action Triggers */}
          <div className="pt-4 border-t border-slate-800">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
              Live Interactive Mitigation &amp; Drill Controls
            </h3>

            <div className="flex flex-wrap gap-3">
              {currentRb.actions.map((act) => (
                <button
                  key={act.action}
                  onClick={() => executeAction(currentRb.id, act.action)}
                  disabled={executingAction === act.action}
                  className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 ${
                    act.danger
                      ? 'bg-rose-950/60 hover:bg-rose-900/80 border border-rose-800 text-rose-200'
                      : 'bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold shadow-sm'
                  }`}
                >
                  {executingAction === act.action ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  <span>{act.label}</span>
                </button>
              ))}
            </div>

            {/* Action Feedback Box */}
            {actionOutput && (
              <div className={`mt-4 p-4 rounded-xl border text-xs flex items-start gap-3 ${
                actionOutput.success
                  ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
                  : 'bg-rose-950/40 border-rose-800 text-rose-200'
              }`}>
                {actionOutput.success ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-semibold">{actionOutput.success ? 'Runbook Executed' : 'Execution Failed'}</div>
                  <div className="mt-0.5 text-slate-300">{actionOutput.message}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
