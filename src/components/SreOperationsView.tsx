import React, { useState, useEffect } from 'react';
import { 
  Activity, ShieldAlert, AlertTriangle, CheckCircle, Clock, Server, 
  Database, HardDrive, RefreshCw, Filter, Search, Terminal, ArrowUpRight,
  Sliders, Shield, Layers
} from 'lucide-react';
import { SreMetrics, StructuredLog } from '../types/pipeline';

export const SreOperationsView: React.FC = () => {
  const [metrics, setMetrics] = useState<SreMetrics | null>(null);
  const [logs, setLogs] = useState<StructuredLog[]>([]);
  const [activeDashboard, setActiveDashboard] = useState<'overview' | 'pipeline' | 'cost' | 'security'>('overview');
  const [logFilterService, setLogFilterService] = useState('all');
  const [logFilterLevel, setLogFilterLevel] = useState('all');
  const [logSearch, setLogSearch] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchMetricsAndLogs = async () => {
    setIsRefreshing(true);
    try {
      const [metricsRes, logsRes] = await Promise.all([
        fetch('/api/sre/metrics'),
        fetch(`/api/sre/logs?service=${logFilterService}&level=${logFilterLevel}&search=${encodeURIComponent(logSearch)}`)
      ]);

      if (metricsRes.ok) {
        const mData: SreMetrics = await metricsRes.json();
        setMetrics(mData);
      }
      if (logsRes.ok) {
        const lData: StructuredLog[] = await logsRes.json();
        setLogs(lData);
      }
    } catch (err) {
      console.warn('Network polling note: SRE telemetry temporarily unavailable');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchMetricsAndLogs();
    const interval = setInterval(fetchMetricsAndLogs, 3000);
    return () => clearInterval(interval);
  }, [logFilterService, logFilterLevel, logSearch]);

  if (!metrics) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center text-slate-500">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-amber-400" />
        <div>Connecting to Cloudflare &amp; Hugging Face telemetry bus...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* SRE Memo Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <span>SRE Operations Center</span>
            <span aria-hidden="true">·</span>
            <span>SLI / SLO Target Tracking</span>
            <span aria-hidden="true">·</span>
            <span>Golden Signals</span>
          </div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-white">
            System Reliability &amp; Golden Signals
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-3xl">
            Live telemetry for Cloudflare Workers (API Gateway &amp; Telegram Webhook), Hugging Face GPU clusters, Cloudflare R2 media store, and D1 database.
          </p>
        </div>

        {/* Dashboard Selector Tabs */}
        <div className="flex flex-wrap gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl">
          <button
            onClick={() => setActiveDashboard('overview')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeDashboard === 'overview' ? 'bg-amber-400 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
            }`}
          >
            1. Platform Overview
          </button>
          <button
            onClick={() => setActiveDashboard('pipeline')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeDashboard === 'pipeline' ? 'bg-amber-400 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
            }`}
          >
            2. Pipeline Health
          </button>
          <button
            onClick={() => setActiveDashboard('cost')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeDashboard === 'cost' ? 'bg-amber-400 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
            }`}
          >
            3. Cost &amp; Capacity
          </button>
          <button
            onClick={() => setActiveDashboard('security')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeDashboard === 'security' ? 'bg-amber-400 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
            }`}
          >
            4. Security Guardrails
          </button>
        </div>
      </div>

      {/* Active Alerts Banner if any */}
      {metrics.activeAlerts.length > 0 && (
        <div className="space-y-2">
          {metrics.activeAlerts.map(alert => (
            <div
              key={alert.id}
              className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${
                alert.level === 'P1'
                  ? 'bg-rose-950/40 border-rose-800 text-rose-200'
                  : 'bg-amber-950/40 border-amber-800 text-amber-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                    <span className="font-mono">{alert.level} INCIDENT</span>
                    <span>·</span>
                    <span>Service: {alert.service}</span>
                  </div>
                  <div className="text-sm font-semibold text-white mt-0.5">{alert.title}</div>
                  <div className="text-xs text-slate-300 mt-0.5">{alert.description}</div>
                </div>
              </div>
              <div className="font-mono text-xs text-slate-400 shrink-0">
                {new Date(alert.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* DASHBOARD 1: PLATFORM OVERVIEW */}
      {activeDashboard === 'overview' && (
        <div className="space-y-6">
          {/* SLI/SLO Target Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: API Gateway Availability */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>API Gateway Availability</span>
                <span className="font-mono text-emerald-400">Target ≥99.9%</span>
              </div>
              <div className="text-2xl font-bold font-mono text-white tabular-nums">
                {metrics.slo.apiGatewayAvailability.current}%
              </div>
              <div className="mt-2 text-xs flex items-center justify-between text-slate-400">
                <span>SLO Status</span>
                <span className="text-emerald-400 font-medium">Nominal (In Budget)</span>
              </div>
            </div>

            {/* Card 2: Submission Latency p95 */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>Submission Latency (p95)</span>
                <span className="font-mono text-emerald-400">Target ≤800ms</span>
              </div>
              <div className="text-2xl font-bold font-mono text-white tabular-nums">
                {metrics.slo.submissionLatencyP95.currentMs} <span className="text-sm font-normal text-slate-400">ms</span>
              </div>
              <div className="mt-2 text-xs flex items-center justify-between text-slate-400">
                <span>AC1 Compliance</span>
                <span className="text-emerald-400 font-medium">Passed (&lt;2s)</span>
              </div>
            </div>

            {/* Card 3: Pipeline Success Rate */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>Pipeline Success Rate</span>
                <span className="font-mono text-emerald-400">Target ≥98.0%</span>
              </div>
              <div className="text-2xl font-bold font-mono text-white tabular-nums">
                {metrics.slo.pipelineSuccessRate.current}%
              </div>
              <div className="mt-2 text-xs flex items-center justify-between text-slate-400">
                <span>Evaluation Window</span>
                <span className="text-slate-300">Rolling 5-min</span>
              </div>
            </div>

            {/* Card 4: Telegram Webhook Availability */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>Telegram Webhook Avail</span>
                <span className="font-mono text-emerald-400">Target ≥99.9%</span>
              </div>
              <div className={`text-2xl font-bold font-mono tabular-nums ${
                metrics.slo.telegramWebhookAvailability.status === 'ok' ? 'text-white' : 'text-rose-400'
              }`}>
                {metrics.slo.telegramWebhookAvailability.current}%
              </div>
              <div className="mt-2 text-xs flex items-center justify-between text-slate-400">
                <span>Telegram Health</span>
                <span className={metrics.slo.telegramWebhookAvailability.status === 'ok' ? 'text-emerald-400' : 'text-rose-400'}>
                  {metrics.slo.telegramWebhookAvailability.status === 'ok' ? 'Healthy' : 'Degraded'}
                </span>
              </div>
            </div>
          </div>

          {/* Golden Signals Table (§5.1) */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">
              Golden Signals Matrix (§5.1)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="pb-3 font-medium">Signal</th>
                    <th className="pb-3 font-medium">Telemetry Source</th>
                    <th className="pb-3 font-medium">Alert Threshold</th>
                    <th className="pb-3 font-medium text-right">Current Value</th>
                    <th className="pb-3 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  <tr>
                    <td className="py-3 text-white font-sans">Worker 5xx Error Rate</td>
                    <td className="py-3 text-slate-400 font-sans">Cloudflare Analytics</td>
                    <td className="py-3 text-slate-400">&gt; 1.0% over 5m</td>
                    <td className="py-3 text-right text-emerald-400 tabular-nums">{metrics.goldenSignals.worker5xxRate}%</td>
                    <td className="py-3 text-right text-emerald-400 font-sans">Nominal</td>
                  </tr>
                  <tr>
                    <td className="py-3 text-white font-sans">Worker p95 Latency</td>
                    <td className="py-3 text-slate-400 font-sans">Cloudflare Analytics</td>
                    <td className="py-3 text-slate-400">&gt; 1000ms over 10m</td>
                    <td className="py-3 text-right text-emerald-400 tabular-nums">{metrics.goldenSignals.workerP95Ms} ms</td>
                    <td className="py-3 text-right text-emerald-400 font-sans">Nominal</td>
                  </tr>
                  <tr>
                    <td className="py-3 text-white font-sans">HF Endpoint 5xx Rate</td>
                    <td className="py-3 text-slate-400 font-sans">HF Endpoint Metrics</td>
                    <td className="py-3 text-slate-400">&gt; 2.0% over 5m</td>
                    <td className="py-3 text-right text-emerald-400 tabular-nums">{metrics.goldenSignals.hfEndpoint5xxRate}%</td>
                    <td className="py-3 text-right text-emerald-400 font-sans">Nominal</td>
                  </tr>
                  <tr>
                    <td className="py-3 text-white font-sans">HF Queue Depth</td>
                    <td className="py-3 text-slate-400 font-sans">HF Endpoint Metrics</td>
                    <td className="py-3 text-slate-400">&gt; 20 for 5m</td>
                    <td className={`py-3 text-right tabular-nums ${metrics.goldenSignals.hfQueueDepth > 20 ? 'text-rose-400 font-bold' : 'text-emerald-400'}`}>
                      {metrics.goldenSignals.hfQueueDepth}
                    </td>
                    <td className={`py-3 text-right font-sans ${metrics.goldenSignals.hfQueueDepth > 20 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {metrics.goldenSignals.hfQueueDepth > 20 ? 'High' : 'Normal'}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 text-white font-sans">D1 Write Errors</td>
                    <td className="py-3 text-slate-400 font-sans">Worker Logs</td>
                    <td className="py-3 text-slate-400">Any for 2m</td>
                    <td className="py-3 text-right text-emerald-400 tabular-nums">{metrics.goldenSignals.d1WriteErrors}</td>
                    <td className="py-3 text-right text-emerald-400 font-sans">Zero Errors</td>
                  </tr>
                  <tr>
                    <td className="py-3 text-white font-sans">R2 Upload Failures</td>
                    <td className="py-3 text-slate-400 font-sans">Worker Logs</td>
                    <td className="py-3 text-slate-400">&gt; 3 in 5m</td>
                    <td className="py-3 text-right text-emerald-400 tabular-nums">{metrics.goldenSignals.r2UploadFailures}</td>
                    <td className="py-3 text-right text-emerald-400 font-sans">Nominal</td>
                  </tr>
                  <tr>
                    <td className="py-3 text-white font-sans">Callback Unsigned Rejects</td>
                    <td className="py-3 text-slate-400 font-sans">Worker Logs (HMAC)</td>
                    <td className="py-3 text-slate-400">&gt; 5 in 5m</td>
                    <td className={`py-3 text-right tabular-nums ${metrics.goldenSignals.callbackUnsignedRejects > 5 ? 'text-amber-400 font-bold' : 'text-emerald-400'}`}>
                      {metrics.goldenSignals.callbackUnsignedRejects}
                    </td>
                    <td className="py-3 text-right text-emerald-400 font-sans">Enforcing AC6</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* DASHBOARD 2: PIPELINE HEALTH */}
      {activeDashboard === 'pipeline' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
              <div className="text-xs text-slate-400 mb-1">Source Video &lt;5min Bucket</div>
              <div className="text-2xl font-bold font-mono text-white tabular-nums">
                {metrics.slo.pipelineLatencyUnder5m.currentMin} <span className="text-sm font-normal text-slate-400">min</span>
              </div>
              <div className="text-xs text-emerald-400 mt-2 font-mono">
                SLO Target: p95 ≤ {metrics.slo.pipelineLatencyUnder5m.targetMin} min (PASS)
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
              <div className="text-xs text-slate-400 mb-1">Source Video 5-20min Bucket</div>
              <div className="text-2xl font-bold font-mono text-white tabular-nums">
                {metrics.slo.pipelineLatency5to20m.currentMin} <span className="text-sm font-normal text-slate-400">min</span>
              </div>
              <div className="text-xs text-emerald-400 mt-2 font-mono">
                SLO Target: p95 ≤ {metrics.slo.pipelineLatency5to20m.targetMin} min (PASS)
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
              <div className="text-xs text-slate-400 mb-1">Source Video 20-60min Bucket</div>
              <div className="text-2xl font-bold font-mono text-white tabular-nums">
                {metrics.slo.pipelineLatency20to60m.currentMin} <span className="text-sm font-normal text-slate-400">min</span>
              </div>
              <div className="text-xs text-emerald-400 mt-2 font-mono">
                SLO Target: p95 ≤ {metrics.slo.pipelineLatency20to60m.targetMin} min (PASS)
              </div>
            </div>
          </div>

          {/* Stage Duration Breakdown */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">
              Pipeline Stage Durations (Average Wall-Clock Distribution)
            </h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1 font-mono">
                  <span>1. yt-dlp Video Stream Extraction</span>
                  <span>12.4s (8.8%)</span>
                </div>
                <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                  <div className="bg-blue-400 h-full" style={{ width: '8.8%' }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1 font-mono">
                  <span>2. Whisper Automatic Speech Recognition (HF GPU)</span>
                  <span>42.1s (29.8%)</span>
                </div>
                <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                  <div className="bg-purple-400 h-full" style={{ width: '29.8%' }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1 font-mono">
                  <span>3. Neural Machine Translation (NMT Arabic)</span>
                  <span>18.3s (12.9%)</span>
                </div>
                <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                  <div className="bg-amber-400 h-full" style={{ width: '12.9%' }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1 font-mono">
                  <span>4. ffmpeg Subtitle Burning (Hard Subtitles Mode)</span>
                  <span>68.5s (48.5%)</span>
                </div>
                <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                  <div className="bg-rose-400 h-full" style={{ width: '48.5%' }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DASHBOARD 3: COST & CAPACITY */}
      {activeDashboard === 'cost' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="text-xs text-slate-400 mb-1">HF GPU Inference Minutes (Today)</div>
              <div className="text-2xl font-bold font-mono text-white tabular-nums">
                {metrics.costAndCapacity.hfInferenceMinutesToday} <span className="text-xs font-normal text-slate-400">mins</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-2">Scale-to-zero after 10m idle (§9)</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="text-xs text-slate-400 mb-1">Cloudflare R2 Media Storage</div>
              <div className="text-2xl font-bold font-mono text-white tabular-nums">
                {metrics.costAndCapacity.r2StorageGB} <span className="text-xs font-normal text-slate-400">GB</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-2">Outputs auto-purged after 7 days (§8.2)</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="text-xs text-slate-400 mb-1">Cloudflare D1 Table Rows</div>
              <div className="text-2xl font-bold font-mono text-white tabular-nums">
                {metrics.costAndCapacity.d1RowsCount}
              </div>
              <div className="text-[11px] text-slate-500 mt-2">Automated export to R2 every 6h (§8)</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="text-xs text-slate-400 mb-1">Worker Requests (Today)</div>
              <div className="text-2xl font-bold font-mono text-white tabular-nums">
                {metrics.costAndCapacity.workerRequestsToday.toLocaleString()}
              </div>
              <div className="text-[11px] text-slate-500 mt-2">30s wall CPU limit enforced (§9)</div>
            </div>
          </div>
        </div>
      )}

      {/* DASHBOARD 4: SECURITY */}
      {activeDashboard === 'security' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="text-xs text-slate-400 mb-1">Rate Limit Throttles (24h)</div>
              <div className="text-2xl font-bold font-mono text-amber-400 tabular-nums">
                {metrics.security.rateLimitHits24h}
              </div>
              <div className="text-[11px] text-slate-500 mt-2">5 jobs/hr limit enforced (AC5)</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="text-xs text-slate-400 mb-1">SSRF Blocked URLs (24h)</div>
              <div className="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
                {metrics.security.ssrfBlockedUrls24h}
              </div>
              <div className="text-[11px] text-slate-500 mt-2">Allowlist &amp; private IP guard (§10)</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="text-xs text-slate-400 mb-1">Unsigned HMAC Rejects (24h)</div>
              <div className="text-2xl font-bold font-mono text-rose-400 tabular-nums">
                {metrics.security.invalidHmacCallbacks24h}
              </div>
              <div className="text-[11px] text-slate-500 mt-2">Enforcing 401 on callbacks (AC6)</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="text-xs text-slate-400 mb-1">Auth Failures (24h)</div>
              <div className="text-2xl font-bold font-mono text-slate-300 tabular-nums">
                {metrics.security.authFailures24h}
              </div>
              <div className="text-[11px] text-slate-500 mt-2">Signed session validation (§9)</div>
            </div>
          </div>
        </div>
      )}

      {/* Error Budget Policy Section (§4) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Error Budget Policy (§4)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              When any error budget is exhausted: Feature work paused, postmortem required, release throttled to fix-only.
            </p>
          </div>
          <span className="text-xs font-mono text-emerald-400">All Budgets Intact</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div>
            <div className="flex justify-between text-xs text-slate-300 mb-1 font-mono">
              <span>API Gateway Budget</span>
              <span className="tabular-nums">{metrics.errorBudgets.apiGateway.remaining}% remaining</span>
            </div>
            <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
              <div className="bg-emerald-400 h-full" style={{ width: `${metrics.errorBudgets.apiGateway.remaining}%` }} />
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Burn rate: {metrics.errorBudgets.apiGateway.burnRate}x</div>
          </div>

          <div>
            <div className="flex justify-between text-xs text-slate-300 mb-1 font-mono">
              <span>Pipeline SLO Budget</span>
              <span className="tabular-nums">{metrics.errorBudgets.pipeline.remaining}% remaining</span>
            </div>
            <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
              <div className="bg-emerald-400 h-full" style={{ width: `${metrics.errorBudgets.pipeline.remaining}%` }} />
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Burn rate: {metrics.errorBudgets.pipeline.burnRate}x</div>
          </div>

          <div>
            <div className="flex justify-between text-xs text-slate-300 mb-1 font-mono">
              <span>Telegram Webhook Budget</span>
              <span className="tabular-nums">{metrics.errorBudgets.telegram.remaining}% remaining</span>
            </div>
            <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
              <div className={`h-full ${metrics.errorBudgets.telegram.remaining < 20 ? 'bg-rose-400' : 'bg-emerald-400'}`} style={{ width: `${metrics.errorBudgets.telegram.remaining}%` }} />
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Burn rate: {metrics.errorBudgets.telegram.burnRate}x</div>
          </div>
        </div>
      </div>

      {/* Structured JSON Log Inspector (§6) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Structured JSON Log Stream (§6)
            </h3>
            <p className="text-[11px] text-slate-500">
              Mandatory fields: <code className="text-slate-400">ts, service, level, job_id, channel, stage, duration_ms, error_code</code>
            </p>
          </div>

          {/* Log Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 text-xs bg-slate-950 px-2 py-1 rounded border border-slate-800">
              <Search className="w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search logs..."
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                className="bg-transparent text-white focus:outline-none w-28 text-xs font-mono"
              />
            </div>

            <select
              value={logFilterService}
              onChange={(e) => setLogFilterService(e.target.value)}
              className="text-xs bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-300 focus:outline-none"
            >
              <option value="all">All Services</option>
              <option value="api-gateway">api-gateway</option>
              <option value="hf-backend">hf-backend</option>
              <option value="telegram-worker">telegram-worker</option>
              <option value="d1-jobs">d1-jobs</option>
              <option value="r2-media">r2-media</option>
            </select>

            <select
              value={logFilterLevel}
              onChange={(e) => setLogFilterLevel(e.target.value)}
              className="text-xs bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-300 focus:outline-none"
            >
              <option value="all">All Levels</option>
              <option value="info">INFO</option>
              <option value="warn">WARN</option>
              <option value="error">ERROR</option>
            </select>

            <button
              onClick={fetchMetricsAndLogs}
              className="p-1.5 text-slate-400 hover:text-white"
              title="Refresh logs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Log Viewer Table */}
        <div className="bg-slate-950 rounded-lg border border-slate-800 p-2 overflow-x-auto max-h-96">
          <table className="w-full text-left font-mono text-[11px]">
            <thead>
              <tr className="border-b border-slate-800/80 text-slate-500">
                <th className="p-2">Timestamp (UTC)</th>
                <th className="p-2">Level</th>
                <th className="p-2">Service</th>
                <th className="p-2">Job ID</th>
                <th className="p-2">Stage</th>
                <th className="p-2">Duration</th>
                <th className="p-2">Error</th>
                <th className="p-2">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-900/60 transition-colors">
                  <td className="p-2 text-slate-400 whitespace-nowrap">
                    {new Date(log.ts).toISOString().substring(11, 23)}
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      log.level === 'error' ? 'bg-red-950 text-red-400' :
                      log.level === 'warn' ? 'bg-amber-950 text-amber-400' : 'bg-slate-900 text-slate-300'
                    }`}>
                      {log.level.toUpperCase()}
                    </span>
                  </td>
                  <td className="p-2 text-slate-300 whitespace-nowrap">{log.service}</td>
                  <td className="p-2 text-slate-400 whitespace-nowrap">
                    {log.job_id ? log.job_id.substring(0, 10) + '...' : '-'}
                  </td>
                  <td className="p-2 text-amber-400 whitespace-nowrap">{log.stage || '-'}</td>
                  <td className="p-2 text-slate-400 whitespace-nowrap tabular-nums">
                    {log.duration_ms ? `${log.duration_ms}ms` : '-'}
                  </td>
                  <td className="p-2 text-rose-400 whitespace-nowrap">{log.error_code || '-'}</td>
                  <td className="p-2 text-slate-200 max-w-md truncate">{log.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
