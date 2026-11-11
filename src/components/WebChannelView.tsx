import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Pause, Download, FileText, Film, RefreshCw, AlertCircle, 
  CheckCircle2, Clock, Upload, Copy, Check, Subtitles, Volume2, 
  Settings2, Sparkles, ExternalLink, Edit3, Save, Share2, LogIn, ChevronRight, ChevronLeft
} from 'lucide-react';
import { Job, PipelineStage, SubtitleMode, SubtitleCue } from '../types/pipeline';
import { useAuth } from '../context/AuthContext';

interface WebChannelViewProps {
  targetJobId?: string | null;
  onClearTargetJob?: () => void;
}

export const WebChannelView: React.FC<WebChannelViewProps> = ({
  targetJobId,
  onClearTargetJob,
}) => {
  const { currentUser, signInWithGoogle, saveUserTranslation } = useAuth();

  // Input mode
  const [submissionTab, setSubmissionTab] = useState<'url' | 'upload'>('url');
  const [videoUrl, setVideoUrl] = useState('https://youtube.com/watch?v=ai-video-revolution-2026');
  const [srcLang, setSrcLang] = useState('auto');
  const [tgtDialect, setTgtDialect] = useState('ar-msa');
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode>('hard');
  
  // Local uploaded file
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [localVideoBlobUrl, setLocalVideoBlobUrl] = useState<string | null>(null);

  // Translation execution state
  const [isTranslating, setIsTranslating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [copiedShareLink, setCopiedShareLink] = useState(false);
  const [savedToAccount, setSavedToAccount] = useState(false);

  // Active Job & Cues
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [editableCues, setEditableCues] = useState<SubtitleCue[]>([]);
  const [savingCues, setSavingCues] = useState(false);
  const [editingCueId, setEditingCueId] = useState<number | null>(null);

  // Video player controls
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(30);
  const [activeCueId, setActiveCueId] = useState<number | null>(null);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [fontSize, setFontSize] = useState<'normal' | 'large'>('normal');

  // Rate limit
  const [rateQuota, setRateQuota] = useState({ remaining: 5, total: 5, resetSec: 3600 });

  // Load target job if requested from navigation or shared link
  useEffect(() => {
    if (targetJobId) {
      fetch(`/api/jobs/${targetJobId}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            setActiveJob(data);
            setEditableCues(data.cues || []);
            if (data.video_url) setVideoUrl(data.video_url);
          }
        })
        .catch(err => console.warn('Failed to load targeted job:', err));
    }
  }, [targetJobId]);

  // Fetch initial job or refresh
  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/jobs');
      if (res.ok) {
        const data: Job[] = await res.json();
        setActiveJob(prev => {
          if (!prev && data.length > 0 && !targetJobId) {
            setEditableCues(data[0].cues || []);
            return data[0];
          }
          if (prev) {
            const updated = data.find(j => j.id === prev.id);
            if (updated) {
              if (updated.progress !== prev.progress || updated.status !== prev.status) {
                setEditableCues(updated.cues || []);
                // If just finished and logged in, sync to user's Firestore library
                if (updated.status === 'done' && prev.status !== 'done' && currentUser) {
                  saveUserTranslation(updated).catch(() => {});
                }
                return updated;
              }
            }
            return prev;
          }
          return prev;
        });
      }
    } catch (err) {
      console.warn('Network polling note: /api/jobs temporarily unavailable');
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 2500);
    return () => clearInterval(interval);
  }, [currentUser]);

  // Sync active cues when activeJob changes
  useEffect(() => {
    if (activeJob?.cues) {
      setEditableCues(activeJob.cues);
      if (activeJob.cues.length > 0 && !activeCueId) {
        setActiveCueId(activeJob.cues[0].id);
      }
    }
  }, [activeJob?.id]);

  // Handle local video file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 500 * 1024 * 1024) {
      setFormError('File size exceeds the 500 MB limit.');
      return;
    }

    setFormError(null);
    setLocalFile(file);
    const blobUrl = URL.createObjectURL(file);
    setLocalVideoBlobUrl(blobUrl);

    if (videoRef.current) {
      videoRef.current.src = blobUrl;
      videoRef.current.load();
    }
  };

  // Video time update tracker for HTML5 player
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const curSec = videoRef.current.currentTime;
    setCurrentTime(curSec);
    const curMs = curSec * 1000;

    const matchedCue = editableCues.find(c => curMs >= c.startMs && curMs <= c.endMs);
    if (matchedCue) {
      setActiveCueId(matchedCue.id);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || 30);
    }
  };

  const seekTo = (seconds: number, cueId?: number) => {
    if (cueId) {
      setActiveCueId(cueId);
    }
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  // Submit translation request
  const handleStartTranslation = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsTranslating(true);
    setSavedToAccount(false);

    try {
      const payload = submissionTab === 'url' ? {
        video_url: videoUrl,
        src_lang: srcLang,
        tgt_lang: 'ar',
        tgt_dialect: tgtDialect,
        subtitle_mode: subtitleMode,
        user_ref: currentUser?.uid || 'web_session_user',
      } : {
        is_upload: true,
        upload_filename: localFile?.name || 'uploaded_video.mp4',
        upload_filesize_mb: localFile ? Math.round(localFile.size / (1024 * 1024)) : 25,
        src_lang: srcLang,
        tgt_lang: 'ar',
        tgt_dialect: tgtDialect,
        subtitle_mode: subtitleMode,
        user_ref: currentUser?.uid || 'web_session_user',
      };

      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data: Job = await res.json();
      if (!res.ok) {
        setFormError(`[${(data as any).error_code || 'ERROR'}] ${(data as any).message || 'Translation request failed'}`);
        setIsTranslating(false);
        return;
      }

      setActiveJob(data);
      setEditableCues(data.cues || []);
      if (data.cues && data.cues.length > 0) {
        setActiveCueId(data.cues[0].id);
      }
      setRateQuota(prev => ({ ...prev, remaining: Math.max(0, prev.remaining - 1) }));

      // Automatically persist to user's Google Firebase account if signed in
      if (currentUser) {
        saveUserTranslation(data)
          .then(() => setSavedToAccount(true))
          .catch((err) => console.warn('Could not save translation to Firebase:', err));
      }

      // If URL submission and not a YouTube URL, load sample video into HTML5 player
      if (submissionTab === 'url' && !data.youtube_id && videoRef.current) {
        videoRef.current.src = '/api/media/sample.mp4';
        videoRef.current.load();
      }
    } catch (err: any) {
      setFormError(err.message || 'Network error occurred');
    } finally {
      setIsTranslating(false);
    }
  };

  // Save edited subtitle line
  const handleSaveCueText = async (cueId: number, newArabicText: string) => {
    if (!activeJob) return;
    const updated = editableCues.map(c => c.id === cueId ? { ...c, translatedText: newArabicText } : c);
    setEditableCues(updated);
    setEditingCueId(null);
    setSavingCues(true);

    try {
      await fetch(`/api/jobs/${activeJob.id}/cues`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cues: updated }),
      });
      // Also update in user's saved translations if authenticated
      if (currentUser) {
        saveUserTranslation({ ...activeJob, cues: updated }).catch(() => {});
      }
    } catch (err) {
      console.warn('Failed to save edited cues to backend:', err);
    } finally {
      setSavingCues(false);
    }
  };

  const handleCopyTranscript = () => {
    const text = editableCues.map(c => `${c.start} -> ${c.end}\n${c.translatedText}\n`).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedTranscript(true);
    setTimeout(() => setCopiedTranscript(false), 2000);
  };

  const handleShareLink = () => {
    if (!activeJob) return;
    const shareUrl = `${window.location.origin}/?job=${activeJob.id}&shared=true`;
    navigator.clipboard.writeText(shareUrl);
    setCopiedShareLink(true);
    setTimeout(() => setCopiedShareLink(false), 2500);
  };

  // Current active cue for display overlay
  const activeCue = editableCues.find(c => c.id === activeCueId) || editableCues[0];

  // Detect whether active job is a YouTube video
  const isYouTubeVideo = Boolean(activeJob?.youtube_id);
  const playerVideoSource = localVideoBlobUrl || '/api/media/sample.mp4';

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      {/* Platform Title & Concise Introduction */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <span>Speech Recognition (Whisper ASR)</span>
            <span aria-hidden="true">·</span>
            <span>Neural Arabic Translation (NMT)</span>
            <span aria-hidden="true">·</span>
            <span>Accurate Arabic Subtitles</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <span>Video Translator to Arabic</span>
            <span className="text-amber-400 text-sm font-normal border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 rounded-full font-mono">
              ترجمة احترافية
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            Translate any video into natural Arabic subtitles with zero hallucination. Preview synced subtitles, edit lines in place, and download ready-to-publish `.srt` files.
          </p>
        </div>

        {/* Quota & User Badge */}
        <div className="flex items-center gap-3">
          {currentUser ? (
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-slate-300 truncate max-w-[140px]">{currentUser.displayName || currentUser.email}</span>
            </div>
          ) : (
            <button
              onClick={signInWithGoogle}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-xl border border-slate-700 transition-colors"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In with Google</span>
            </button>
          )}

          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl text-xs">
            <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-slate-300">
              Quota: <strong className="text-amber-400 font-mono">{rateQuota.remaining}</strong>/5
            </span>
          </div>
        </div>
      </div>

      {/* Target Job notification banner if arrived via shared link */}
      {targetJobId && activeJob && (
        <div className="p-4 bg-amber-400/10 border border-amber-400/40 rounded-xl flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-amber-300">
            <Share2 className="w-4 h-4 shrink-0" />
            <span>
              Loaded shared translated video: <strong className="text-white">{activeJob.video_title}</strong>
            </span>
          </div>
          {onClearTargetJob && (
            <button
              onClick={onClearTargetJob}
              className="text-xs text-slate-400 hover:text-white underline font-mono"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* STEP 1: Video Input & Translation Settings */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="w-6 h-6 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center font-bold text-xs">
              1
            </span>
            <span>Provide Video &amp; Configure Settings</span>
          </div>

          {/* Tab buttons */}
          <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => { setSubmissionTab('url'); setFormError(null); }}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                submissionTab === 'url' ? 'bg-amber-400 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Paste Video URL
            </button>
            <button
              type="button"
              onClick={() => { setSubmissionTab('upload'); setFormError(null); }}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                submissionTab === 'upload' ? 'bg-amber-400 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Upload Video File
            </button>
          </div>
        </div>

        <form onSubmit={handleStartTranslation} className="space-y-4">
          {submissionTab === 'url' ? (
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Video URL (YouTube, Vimeo, Twitter/X, TikTok, direct MP4)
              </label>
              <input
                type="url"
                required
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full px-4 py-2.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-400 font-mono"
              />

              {/* Instant Test Presets */}
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <span className="text-[11px] text-slate-500">Quick presets:</span>
                <button
                  type="button"
                  onClick={() => {
                    setVideoUrl('https://www.youtube.com/watch?v=ai-video-revolution-2026');
                    setSubtitleMode('hard');
                  }}
                  className="text-[11px] px-2.5 py-1 bg-slate-950 hover:bg-slate-800 text-amber-300 border border-slate-800 rounded-lg transition-colors"
                >
                  AI Video Keynote (YouTube)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVideoUrl('https://vimeo.com/89124018');
                    setSubtitleMode('soft');
                  }}
                  className="text-[11px] px-2.5 py-1 bg-slate-950 hover:bg-slate-800 text-amber-300 border border-slate-800 rounded-lg transition-colors"
                >
                  Deep Universe (Vimeo)
                </button>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Select MP4 or WebM Video from Computer (Max 500 MB)
              </label>
              <div className="border border-dashed border-slate-700 bg-slate-950/60 rounded-xl p-5 text-center hover:border-amber-400 transition-colors">
                <input
                  type="file"
                  accept="video/mp4,video/webm"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="video-upload-input"
                />
                <label htmlFor="video-upload-input" className="cursor-pointer block">
                  <Upload className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                  <div className="text-xs font-semibold text-white">
                    {localFile ? localFile.name : 'Click to browse or drop video file'}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    {localFile ? `${(localFile.size / (1024 * 1024)).toFixed(1)} MB selected — Ready to translate` : 'MP4, WebM formats supported'}
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Options Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Source Audio Language</label>
              <select
                value={srcLang}
                onChange={(e) => setSrcLang(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-400"
              >
                <option value="auto">Auto-Detect Speech</option>
                <option value="en">English (US / UK / Global)</option>
                <option value="fr">French (Français)</option>
                <option value="es">Spanish (Español)</option>
                <option value="de">German (Deutsch)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Target Arabic Dialect</label>
              <select
                value={tgtDialect}
                onChange={(e) => setTgtDialect(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-amber-400 font-semibold focus:outline-none focus:ring-1 focus:ring-amber-400"
              >
                <option value="ar-msa">🇸🇦 Modern Standard Arabic (الفصحى)</option>
                <option value="ar-eg">🇪🇬 Egyptian Dialect (لهجة مصرية)</option>
                <option value="ar-gulf">🇦🇪 Gulf Dialect (لهجة خليجية)</option>
                <option value="ar-lev">🇱🇧 Levantine Dialect (لهجة شامية)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Delivery Subtitle Mode</label>
              <select
                value={subtitleMode}
                onChange={(e) => setSubtitleMode(e.target.value as SubtitleMode)}
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-400"
              >
                <option value="hard">Hard Subtitles (Burned-in Video Preview)</option>
                <option value="soft">Soft Subtitles (Downloadable SRT/VTT only)</option>
              </select>
            </div>
          </div>

          {formError && (
            <div className="p-3 bg-red-950/60 border border-red-800 text-red-200 text-xs rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {/* Action Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isTranslating}
              className="w-full py-3 px-6 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-sm rounded-xl transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isTranslating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Processing Video Speech &amp; Translating...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-slate-950" />
                  <span>Translate Video to Arabic Now</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Live Pipeline Status Progress Bar */}
        {activeJob && (
          <div className="pt-3 border-t border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white">Pipeline Status:</span>
                <span className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold ${
                  activeJob.status === 'done' ? 'bg-emerald-950 text-emerald-400' :
                  activeJob.status === 'failed' ? 'bg-rose-950 text-rose-400' : 'bg-amber-950 text-amber-400'
                }`}>
                  {activeJob.stage.toUpperCase()} ({activeJob.progress}%)
                </span>
                {savedToAccount && (
                  <span className="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    <span>Saved to your Google Library</span>
                  </span>
                )}
              </div>
              <span className="text-slate-400 text-[11px] font-mono">Job ID: {activeJob.id.substring(0, 12)}...</span>
            </div>

            <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
              <div
                className={`h-full transition-all duration-500 ${
                  activeJob.status === 'done' ? 'bg-emerald-500' :
                  activeJob.status === 'failed' ? 'bg-rose-500' : 'bg-amber-400'
                }`}
                style={{ width: `${activeJob.progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* STEP 2: Interactive Video Player with Synchronized Arabic Subtitles */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm space-y-0">
        <div className="p-4 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center font-bold text-xs">
              2
            </span>
            <span className="text-sm font-semibold text-white">
              Synchronized Video &amp; Arabic Subtitle Player
            </span>
            {activeJob?.video_title && (
              <span className="text-[11px] font-mono text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/60 max-w-xs truncate hidden sm:inline">
                {activeJob.video_title}
              </span>
            )}
          </div>

          {/* Subtitle Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSubtitles(prev => !prev)}
              className={`px-3 py-1 text-xs rounded-lg border font-medium flex items-center gap-1.5 transition-colors ${
                showSubtitles ? 'bg-amber-400/10 border-amber-400/40 text-amber-300' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <Subtitles className="w-3.5 h-3.5" />
              <span>{showSubtitles ? 'Subtitles On' : 'Subtitles Off'}</span>
            </button>

            <button
              onClick={() => setFontSize(prev => prev === 'normal' ? 'large' : 'normal')}
              className="px-2.5 py-1 text-xs bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg transition-colors font-mono"
            >
              {fontSize === 'normal' ? 'A' : 'A+'}
            </button>
          </div>
        </div>

        {/* Video Player Frame: Supports YouTube Embed OR Local/Direct HTML5 Video */}
        <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
          {isYouTubeVideo ? (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${activeJob?.youtube_id}?enablejsapi=1&rel=0&modestbranding=1`}
              title={activeJob?.video_title || 'YouTube Video'}
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <video
              ref={videoRef}
              src={playerVideoSource}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              className="w-full h-full object-contain"
              controls
              playsInline
              preload="auto"
            />
          )}

          {/* Arabic Subtitles Overlay (for both YouTube and HTML5 videos) */}
          {showSubtitles && activeCue && (
            <div className="absolute bottom-10 left-4 right-4 pointer-events-none flex flex-col items-center z-20">
              <div 
                className={`bg-black/90 text-amber-300 font-bold px-5 py-2.5 rounded-xl shadow-2xl border border-amber-500/30 tracking-wide dir-rtl font-sans backdrop-blur-sm text-center max-w-2xl ${
                  fontSize === 'large' ? 'text-xl md:text-2xl' : 'text-base md:text-lg'
                }`}
                dir="rtl"
              >
                {activeCue.translatedText}
              </div>
              <div className="bg-black/75 text-slate-300 text-xs px-3 py-1 rounded-md mt-1.5 max-w-xl text-center">
                {activeCue.originalText}
              </div>
            </div>
          )}
        </div>

        {/* Subtitle Cue Stepper Bar for synchronized navigation */}
        {editableCues.length > 0 && (
          <div className="p-3 bg-slate-950 border-t border-slate-800/80 flex items-center justify-between text-xs">
            <button
              onClick={() => {
                const curIndex = editableCues.findIndex(c => c.id === activeCueId);
                if (curIndex > 0) {
                  const prev = editableCues[curIndex - 1];
                  seekTo(prev.startMs / 1000, prev.id);
                }
              }}
              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg flex items-center gap-1 font-mono text-[11px]"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Prev Subtitle</span>
            </button>

            <span className="font-mono text-slate-400 text-[11px]">
              Cue {activeCue?.id || 1} of {editableCues.length} ({activeCue?.start} ➔ {activeCue?.end})
            </span>

            <button
              onClick={() => {
                const curIndex = editableCues.findIndex(c => c.id === activeCueId);
                if (curIndex >= 0 && curIndex < editableCues.length - 1) {
                  const next = editableCues[curIndex + 1];
                  seekTo(next.startMs / 1000, next.id);
                }
              }}
              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg flex items-center gap-1 font-mono text-[11px]"
            >
              <span>Next Subtitle</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Download & Share Bar */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Download className="w-4 h-4 text-amber-400" />
            <span>Translated Outputs &amp; Sharing</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/jobs/${activeJob?.id || '019318a4-9e32-7df8-9214-72a39b40fa18'}/download/srt`}
              download
              className="px-3.5 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download .SRT</span>
            </a>

            <a
              href={`/api/jobs/${activeJob?.id || '019318a4-9e32-7df8-9214-72a39b40fa18'}/download/vtt`}
              download
              className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-xs rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Download .VTT</span>
            </a>

            {/* Share link button */}
            <button
              onClick={handleShareLink}
              className="px-3.5 py-1.5 bg-amber-400/10 hover:bg-amber-400/20 text-amber-300 border border-amber-400/30 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5"
            >
              {copiedShareLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
              <span>{copiedShareLink ? 'Link Copied!' : 'Share Video Link'}</span>
            </button>

            <button
              onClick={handleCopyTranscript}
              className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg transition-colors flex items-center gap-1.5"
            >
              {copiedTranscript ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedTranscript ? 'Copied!' : 'Copy Transcript'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* STEP 3: Editable Bilingual Subtitle Segments Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center font-bold text-xs">
              3
            </span>
            <div>
              <h2 className="text-sm font-bold text-white">
                Bilingual Subtitle Segments ({editableCues.length})
              </h2>
              <p className="text-[11px] text-slate-400">
                Click any line to seek video. Click "Edit Arabic" to refine translations with immediate player sync.
              </p>
            </div>
          </div>

          {savingCues && (
            <span className="text-xs font-mono text-amber-400 flex items-center gap-1">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>Saving edits...</span>
            </span>
          )}
        </div>

        {/* Cues List */}
        <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
          {editableCues.map((cue) => {
            const isCurrentlyActive = activeCueId === cue.id;
            const isEditing = editingCueId === cue.id;

            return (
              <div
                key={cue.id}
                className={`p-4 rounded-xl border transition-all ${
                  isCurrentlyActive
                    ? 'border-amber-400 bg-amber-950/20 shadow-xs'
                    : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                }`}
              >
                {/* Header row with timecode */}
                <div className="flex items-center justify-between mb-2">
                  <button
                    type="button"
                    onClick={() => seekTo(cue.startMs / 1000, cue.id)}
                    className="font-mono text-xs text-amber-400 hover:underline flex items-center gap-1"
                  >
                    <Play className="w-3 h-3" />
                    <span>#{cue.id} [{cue.start} ➔ {cue.end}]</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditingCueId(isEditing ? null : cue.id)}
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>{isEditing ? 'Cancel Edit' : 'Edit Arabic'}</span>
                  </button>
                </div>

                {/* Content grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {/* English Speech Column */}
                  <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
                    <span className="text-[10px] font-mono text-slate-500 uppercase block mb-1">
                      Speech Transcription (Original)
                    </span>
                    <p className="text-slate-300 leading-relaxed">{cue.originalText}</p>
                  </div>

                  {/* Arabic NMT Translation Column */}
                  <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
                    <span className="text-[10px] font-mono text-amber-400/80 uppercase block mb-1 text-left" dir="ltr">
                      Arabic Translation (Translated)
                    </span>
                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          defaultValue={cue.translatedText}
                          id={`cue-edit-${cue.id}`}
                          dir="rtl"
                          className="w-full p-2 bg-slate-950 border border-amber-400/60 rounded text-amber-300 text-xs font-sans focus:outline-none"
                          rows={2}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const val = (document.getElementById(`cue-edit-${cue.id}`) as HTMLTextAreaElement)?.value;
                            if (val) handleSaveCueText(cue.id, val);
                          }}
                          className="px-3 py-1 bg-amber-400 text-slate-950 font-bold text-xs rounded hover:bg-amber-300 transition-colors flex items-center gap-1"
                        >
                          <Save className="w-3 h-3" />
                          <span>Save Line</span>
                        </button>
                      </div>
                    ) : (
                      <p className="text-amber-300 leading-relaxed font-semibold text-right dir-rtl font-sans" dir="rtl">
                        {cue.translatedText}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
