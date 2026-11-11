import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, ShieldAlert, Play, RefreshCw, CheckCircle2, XCircle, 
  AlertTriangle, Filter, Search, Terminal, ArrowUpRight, Flame, Key,
  Database, UserCheck, LogIn, LogOut, FileText, Activity, Clock
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { runQaTestSuite, runE2eTestSuite, TestSuiteResult } from '../lib/testRunner';
import { StructuredLog } from '../types/pipeline';
import { SreOperationsView } from './SreOperationsView';

export const AdminControlPanelView: React.FC = () => {
  const { currentUser, isAdmin, signInWithGoogle, logout, authError } = useAuth();
  
  // Tabs within Admin Panel
  const [activeTab, setActiveTab] = useState<'tests' | 'error_logs' | 'pipeline_logs' | 'sre_telemetry' | 'auth_mgmt'>('tests');

  // Test Runner State
  const [qaSuite, setQaSuite] = useState<TestSuiteResult | null>(null);
  const [e2eSuite, setE2eSuite] = useState<TestSuiteResult | null>(null);
  const [isRunningQa, setIsRunningQa] = useState(false);
  const [isRunningE2e, setIsRunningE2e] = useState(false);

  // Logs state
  const [logs, setLogs] = useState<StructuredLog[]>([]);
  const [logFilterService, setLogFilterService] = useState('all');
  const [logSearch, setLogSearch] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Error simulation form
  const [simErrorType, setSimErrorType] = useState('E_ASR_FAILED');
  const [simErrorService, setSimErrorService] = useState('hf-backend');
  const [simErrorMsg, setSimErrorMsg] = useState('Whisper model memory exceeded on long segment');
  const [injectingEvent, setInjectingEvent] = useState(false);

  const fetchLogs = async (type: 'all' | 'error' | 'pipeline') => {
    setLoadingLogs(true);
    try {
      const res = await fetch(`/api/sre/logs?type=${type}&service=${logFilterService}&search=${encodeURIComponent(logSearch)}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.warn('Network polling note: Admin logs temporarily unavailable');
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'error_logs') {
      fetchLogs('error');
    } else if (activeTab === 'pipeline_logs') {
      fetchLogs('pipeline');
    }
  }, [activeTab, logFilterService, logSearch]);

  const handleRunQa = async () => {
    setIsRunningQa(true);
    try {
      const res = await runQaTestSuite();
      setQaSuite(res);
    } finally {
      setIsRunningQa(false);
    }
  };

  const handleRunE2e = async () => {
    setIsRunningE2e(true);
    try {
      const res = await runE2eTestSuite();
      setE2eSuite(res);
    } finally {
      setIsRunningE2e(false);
    }
  };

  const handleRunAllTests = async () => {
    await handleRunQa();
    await handleRunE2e();
  };

  const handleInjectSimulatedEvent = async (isError: boolean) => {
    setInjectingEvent(true);
    try {
      await fetch('/api/admin/simulate-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: isError ? 'error' : 'info',
          service: simErrorService,
          errorCode: isError ? simErrorType : undefined,
          message: simErrorMsg,
        }),
      });
      fetchLogs(activeTab === 'error_logs' ? 'error' : 'pipeline');
    } catch (err) {
      console.error('Event injection failed:', err);
    } finally {
      setInjectingEvent(false);
    }
  };

  // Run initial test suites on first mount
  useEffect(() => {
    handleRunQa();
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* Admin Header with Firebase User Identity */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <span>Admin Control Panel</span>
            <span aria-hidden="true">·</span>
            <span>Automated QA &amp; E2E Test Suite</span>
            <span aria-hidden="true">·</span>
            <span>Error &amp; Pipeline Logs</span>
          </div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <span>Admin Control Center</span>
            {isAdmin ? (
              <span className="text-xs px-2.5 py-0.5 bg-emerald-950 border border-emerald-700/60 text-emerald-400 font-mono font-medium rounded-full">
                ADMIN ACCESS VERIFIED
              </span>
            ) : (
              <span className="text-xs px-2.5 py-0.5 bg-amber-950 border border-amber-700/60 text-amber-400 font-mono font-medium rounded-full">
                AUTHENTICATION REQUIRED
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Authorized Administrator Console. Run automated QA suites, verify E2E pipeline lifecycles, and monitor dedicated pipeline and error log streams.
          </p>
        </div>

        {/* Authentication Widget (Google Firebase) */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
          {currentUser ? (
            <div className="flex items-center gap-3">
              {currentUser.photoURL ? (
                <img
                  src={currentUser.photoURL}
                  alt={currentUser.displayName || 'User'}
                  className="w-9 h-9 rounded-full border border-slate-700"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-amber-400 text-slate-950 font-bold flex items-center justify-center text-xs">
                  {currentUser.email ? currentUser.email[0].toUpperCase() : 'U'}
                </div>
              )}
              <div className="text-left">
                <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <span className="truncate max-w-[150px]">{currentUser.displayName || currentUser.email}</span>
                  {isAdmin && (
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.2 rounded font-mono">
                      ADMIN
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 font-mono truncate max-w-[180px]">
                  {currentUser.email}
                </div>
              </div>
              <button
                onClick={logout}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-colors flex items-center gap-1"
                title="Log out"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Exit</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-2">
              <div className="text-left text-xs text-slate-300">
                <div className="font-semibold text-white">Google Authentication</div>
                <div className="text-[11px] text-slate-400">Sign in with an authorized account for administrative privileges</div>
              </div>
              <button
                onClick={signInWithGoogle}
                className="px-3.5 py-1.5 bg-white text-slate-950 font-semibold hover:bg-slate-100 text-xs rounded-lg transition-colors flex items-center gap-1.5 shadow-sm whitespace-nowrap"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In with Google</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {authError && (
        <div className="p-3 bg-red-950/60 border border-red-800 text-red-200 text-xs rounded-xl flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{authError}</span>
        </div>
      )}

      {/* Admin Sub-Tabs */}
      <div className="flex flex-wrap gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl">
        <button
          onClick={() => setActiveTab('tests')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === 'tests' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>QA &amp; E2E Automated Tests</span>
        </button>

        <button
          onClick={() => setActiveTab('error_logs')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === 'error_logs' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>Dedicated Error Logs</span>
        </button>

        <button
          onClick={() => setActiveTab('pipeline_logs')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === 'pipeline_logs' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Pipeline Stage Logs</span>
        </button>

        <button
          onClick={() => setActiveTab('sre_telemetry')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === 'sre_telemetry' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>SRE Signals &amp; SLOs</span>
        </button>

        <button
          onClick={() => setActiveTab('auth_mgmt')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === 'auth_mgmt' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'
          }`}
        >
          <UserCheck className="w-3.5 h-3.5" />
          <span>RBAC &amp; Firebase Auth</span>
        </button>
      </div>

      {/* TAB 1: QA & E2E AUTOMATED TESTS */}
      {activeTab === 'tests' && (
        <div className="space-y-6">
          {/* Controls Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-white">Automated Verification Suites</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Execute live validation against backend routes, contracts, HMAC security, allowlists, and pipeline lifecycles.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleRunQa}
                disabled={isRunningQa}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRunningQa ? 'animate-spin' : ''}`} />
                <span>Run QA Tests</span>
              </button>

              <button
                onClick={handleRunE2e}
                disabled={isRunningE2e}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <Play className={`w-3.5 h-3.5 ${isRunningE2e ? 'animate-spin' : ''}`} />
                <span>Run E2E Tests</span>
              </button>

              <button
                onClick={handleRunAllTests}
                disabled={isRunningQa || isRunningE2e}
                className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Run All Suites</span>
              </button>
            </div>
          </div>

          {/* QA Suite Results Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className={`p-1.5 rounded-lg ${
                  qaSuite?.status === 'passed' ? 'bg-emerald-950 text-emerald-400' :
                  qaSuite?.status === 'failed' ? 'bg-rose-950 text-rose-400' : 'bg-slate-800 text-slate-300'
                }`}>
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {qaSuite?.name || 'QA Unit & Integration Test Suite'}
                  </h3>
                  <div className="text-xs text-slate-400">
                    Category: Functional allowlists, rate limiting, media endpoints &amp; HMAC security
                  </div>
                </div>
              </div>

              {qaSuite && (
                <div className="flex items-center gap-4 text-xs font-mono">
                  <span className="text-emerald-400">{qaSuite.passed} passed</span>
                  {qaSuite.failed > 0 && <span className="text-rose-400">{qaSuite.failed} failed</span>}
                  <span className="text-slate-400">{qaSuite.durationMs}ms</span>
                </div>
              )}
            </div>

            {/* Assertion rows */}
            <div className="space-y-2">
              {qaSuite ? (
                qaSuite.assertions.map((assert, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-start justify-between gap-3 text-xs"
                  >
                    <div className="flex items-start gap-2.5">
                      {assert.status === 'passed' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-semibold text-white">{assert.name}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{assert.details || assert.error}</div>
                      </div>
                    </div>
                    <span className="font-mono text-slate-500 text-[11px] shrink-0">{assert.durationMs}ms</span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-500 py-3 text-center">Click "Run QA Tests" to evaluate.</div>
              )}
            </div>
          </div>

          {/* E2E Suite Results Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className={`p-1.5 rounded-lg ${
                  e2eSuite?.status === 'passed' ? 'bg-emerald-950 text-emerald-400' :
                  e2eSuite?.status === 'failed' ? 'bg-rose-950 text-rose-400' : 'bg-slate-800 text-slate-300'
                }`}>
                  <Play className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {e2eSuite?.name || 'End-to-End Pipeline & Artifact Lifecycle Suite'}
                  </h3>
                  <div className="text-xs text-slate-400">
                    Category: Full job submission $\rightarrow$ Hugging Face /invoke $\rightarrow$ Polling $\rightarrow$ Output generation $\rightarrow$ Cancellation
                  </div>
                </div>
              </div>

              {e2eSuite && (
                <div className="flex items-center gap-4 text-xs font-mono">
                  <span className="text-emerald-400">{e2eSuite.passed} passed</span>
                  {e2eSuite.failed > 0 && <span className="text-rose-400">{e2eSuite.failed} failed</span>}
                  <span className="text-slate-400">{e2eSuite.durationMs}ms</span>
                </div>
              )}
            </div>

            {/* Assertion rows */}
            <div className="space-y-2">
              {e2eSuite ? (
                e2eSuite.assertions.map((assert, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-start justify-between gap-3 text-xs"
                  >
                    <div className="flex items-start gap-2.5">
                      {assert.status === 'passed' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-semibold text-white">{assert.name}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{assert.details || assert.error}</div>
                      </div>
                    </div>
                    <span className="font-mono text-slate-500 text-[11px] shrink-0">{assert.durationMs}ms</span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-500 py-3 text-center">Click "Run E2E Tests" to simulate full end-to-end jobs.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: DEDICATED ERROR LOGS */}
      {activeTab === 'error_logs' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-rose-400 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" />
                  <span>Dedicated Error Logs Stream</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Filters specifically for `error` level telemetry across API Gateway, Hugging Face endpoints, and media workers.
                </p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 text-xs bg-slate-950 px-2 py-1 rounded border border-slate-800">
                  <Search className="w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search errors..."
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

                <button
                  onClick={() => fetchLogs('error')}
                  className="p-1.5 text-slate-400 hover:text-white"
                  title="Refresh error logs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Error Table */}
            <div className="bg-slate-950 rounded-lg border border-slate-800 overflow-x-auto max-h-96">
              <table className="w-full text-left font-mono text-[11px]">
                <thead>
                  <tr className="border-b border-slate-800/80 text-slate-500">
                    <th className="p-2.5">Time (UTC)</th>
                    <th className="p-2.5">Service</th>
                    <th className="p-2.5">Error Code</th>
                    <th className="p-2.5">Job ID</th>
                    <th className="p-2.5">Error Message</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-slate-500 font-sans">
                        No error logs found matching current filters. System running nominal.
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-900/40 transition-colors">
                        <td className="p-2.5 text-slate-400 whitespace-nowrap">
                          {new Date(log.ts).toISOString().substring(11, 23)}
                        </td>
                        <td className="p-2.5 text-slate-300 whitespace-nowrap">{log.service}</td>
                        <td className="p-2.5 whitespace-nowrap">
                          <span className="px-1.5 py-0.5 bg-rose-950 text-rose-400 rounded font-bold">
                            {log.error_code || 'E_UNKNOWN'}
                          </span>
                        </td>
                        <td className="p-2.5 text-slate-400 whitespace-nowrap">
                          {log.job_id ? log.job_id.substring(0, 10) + '...' : '-'}
                        </td>
                        <td className="p-2.5 text-rose-200">{log.message}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Synthetic Error Generator Tool for Testing */}
            <div className="pt-4 border-t border-slate-800">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Inject Synthetic Error Event (For Testing &amp; Runbook Drill)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <select
                  value={simErrorType}
                  onChange={(e) => setSimErrorType(e.target.value)}
                  className="px-2 py-1.5 bg-slate-950 border border-slate-800 text-xs text-white rounded-lg"
                >
                  <option value="E_ASR_FAILED">E_ASR_FAILED</option>
                  <option value="E_NMT_FAILED">E_NMT_FAILED</option>
                  <option value="E_BACKEND_DOWN">E_BACKEND_DOWN</option>
                  <option value="E_RENDER_FAILED">E_RENDER_FAILED</option>
                  <option value="E_RATE_LIMITED">E_RATE_LIMITED</option>
                </select>

                <select
                  value={simErrorService}
                  onChange={(e) => setSimErrorService(e.target.value)}
                  className="px-2 py-1.5 bg-slate-950 border border-slate-800 text-xs text-white rounded-lg"
                >
                  <option value="hf-backend">hf-backend</option>
                  <option value="api-gateway">api-gateway</option>
                  <option value="telegram-worker">telegram-worker</option>
                  <option value="r2-media">r2-media</option>
                </select>

                <input
                  type="text"
                  value={simErrorMsg}
                  onChange={(e) => setSimErrorMsg(e.target.value)}
                  placeholder="Error message..."
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 text-xs text-white rounded-lg font-mono"
                />

                <button
                  onClick={() => handleInjectSimulatedEvent(true)}
                  disabled={injectingEvent}
                  className="px-3 py-1.5 bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                >
                  {injectingEvent ? 'Injecting...' : '+ Inject Error Log'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: PIPELINE STAGE LOGS */}
      {activeTab === 'pipeline_logs' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  <span>Pipeline Execution &amp; Stage Transition Logs</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Chronological trace of stages: `queued` $\rightarrow$ `downloading` $\rightarrow$ `transcribing` $\rightarrow$ `translating` $\rightarrow$ `rendering` $\rightarrow$ `done`.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchLogs('pipeline')}
                  className="p-1.5 text-slate-400 hover:text-white"
                  title="Refresh pipeline logs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Pipeline Logs Table */}
            <div className="bg-slate-950 rounded-lg border border-slate-800 overflow-x-auto max-h-96">
              <table className="w-full text-left font-mono text-[11px]">
                <thead>
                  <tr className="border-b border-slate-800/80 text-slate-500">
                    <th className="p-2.5">Time (UTC)</th>
                    <th className="p-2.5">Job ID</th>
                    <th className="p-2.5">Channel</th>
                    <th className="p-2.5">Pipeline Stage</th>
                    <th className="p-2.5">Duration</th>
                    <th className="p-2.5">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-900/40 transition-colors">
                      <td className="p-2.5 text-slate-400 whitespace-nowrap">
                        {new Date(log.ts).toISOString().substring(11, 23)}
                      </td>
                      <td className="p-2.5 text-amber-400 whitespace-nowrap">
                        {log.job_id ? log.job_id.substring(0, 12) + '...' : '-'}
                      </td>
                      <td className="p-2.5 text-slate-300 whitespace-nowrap">{log.channel || 'web'}</td>
                      <td className="p-2.5 whitespace-nowrap">
                        <span className="px-1.5 py-0.5 bg-slate-900 border border-slate-700 text-amber-300 rounded font-semibold">
                          {log.stage || 'queued'}
                        </span>
                      </td>
                      <td className="p-2.5 text-slate-400 whitespace-nowrap tabular-nums">
                        {log.duration_ms ? `${log.duration_ms}ms` : '-'}
                      </td>
                      <td className="p-2.5 text-slate-300 max-w-lg truncate">{log.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: RBAC & FIREBASE AUTH MANAGEMENT */}
      {activeTab === 'auth_mgmt' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm space-y-6">
          <div className="pb-4 border-b border-slate-800">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-amber-400" />
              <span>Role-Based Access Control (RBAC) &amp; Google Authentication</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Protected by Firebase Authentication &amp; Firestore security rules. Super Administrator privileges require authorized email identity and cryptographic verification.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Identity Card */}
            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
              <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Current Session Identity</div>
              {currentUser ? (
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Authenticated UID:</span>
                    <span className="font-mono text-slate-200">{currentUser.uid}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Email:</span>
                    <span className="font-mono text-white font-medium">{currentUser.email}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Email Verified:</span>
                    <span className={`font-mono font-medium ${currentUser.emailVerified ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {currentUser.emailVerified ? 'true' : 'false'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">Authorized Role:</span>
                    <span className={`font-mono font-bold ${isAdmin ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {isAdmin ? 'ADMIN (Full Access)' : 'STANDARD USER'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6">
                  <p className="text-xs text-slate-400 mb-3">No user currently signed in.</p>
                  <button
                    onClick={signInWithGoogle}
                    className="px-4 py-2 bg-amber-400 text-slate-950 font-bold text-xs rounded-lg hover:bg-amber-300 transition-colors"
                  >
                    Sign in with Google Account
                  </button>
                </div>
              )}
            </div>

            {/* Policy & Rules Summary */}
            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
              <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Firestore Security Rules Policy</div>
              <ul className="text-xs text-slate-400 space-y-2">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Admin role check enforces: <code className="text-amber-400 font-mono text-[11px]">isAuthorizedAdmin() &amp;&amp; email_verified == true</code></span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Email verification check: <code className="text-amber-400 font-mono text-[11px]">email_verified == true</code></span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Audit collection <code className="text-amber-400 font-mono text-[11px]">/audit_logs/{'{id}'}</code> write permitted only for authenticated operators.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Global default-deny catch-all prevents unauthorized data traversal.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: SRE GOLDEN SIGNALS & SLOS */}
      {activeTab === 'sre_telemetry' && (
        <div className="space-y-6">
          <SreOperationsView />
        </div>
      )}
    </div>
  );
};
