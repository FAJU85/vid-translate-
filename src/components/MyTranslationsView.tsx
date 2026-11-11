import React, { useState, useEffect } from 'react';
import { 
  Video, Play, Download, Share2, Trash2, ExternalLink, LogIn, 
  Check, RefreshCw, FileText, Clock, Globe, Subtitles, AlertCircle, Sparkles
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { UserTranslationRecord } from '../types/pipeline';

interface MyTranslationsViewProps {
  onSelectTranslation: (record: UserTranslationRecord) => void;
  onNavigateToTranslator: () => void;
}

export const MyTranslationsView: React.FC<MyTranslationsViewProps> = ({
  onSelectTranslation,
  onNavigateToTranslator,
}) => {
  const { 
    currentUser, loading, signInWithGoogle, 
    fetchUserTranslations, deleteUserTranslation, toggleShareTranslation 
  } = useAuth();

  const [translations, setTranslations] = useState<UserTranslationRecord[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadData = async () => {
    if (!currentUser) return;
    setLoadingData(true);
    setActionError(null);
    try {
      const items = await fetchUserTranslations();
      setTranslations(items);
    } catch (err: any) {
      console.warn('Failed to load translations:', err);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      loadData();
    }
  }, [currentUser]);

  const handleShare = async (item: UserTranslationRecord) => {
    try {
      const shareUrl = `${window.location.origin}/?job=${item.id}&shared=true`;
      await navigator.clipboard.writeText(shareUrl);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2500);

      if (!item.isShared) {
        await toggleShareTranslation(item.id, true);
        setTranslations(prev => prev.map(t => t.id === item.id ? { ...t, isShared: true } : t));
      }
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to remove this video translation from your library?')) {
      return;
    }
    const success = await deleteUserTranslation(id);
    if (success) {
      setTranslations(prev => prev.filter(t => t.id !== id));
    } else {
      setActionError('Failed to delete translation. Please check permissions.');
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16 text-center text-slate-400">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-amber-400 mb-3" />
        <p className="text-sm">Connecting to Google Authentication...</p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-5 shadow-xl">
          <div className="w-14 h-14 rounded-2xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center mx-auto text-amber-400">
            <Video className="w-7 h-7" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Sign In to Access Your Translated Videos
            </h1>
            <p className="text-sm text-slate-400 max-w-lg mx-auto">
              Sign in with your Google account to view all your translated videos in one place, download synced Arabic subtitles (.SRT / .VTT), and share translations with others via public links.
            </p>
          </div>

          <div className="pt-2">
            <button
              onClick={signInWithGoogle}
              className="px-6 py-3 bg-white hover:bg-slate-100 text-slate-950 font-bold text-sm rounded-xl transition-all shadow-md inline-flex items-center gap-2.5"
            >
              <LogIn className="w-4 h-4" />
              <span>Continue with Google</span>
            </button>
          </div>

          <div className="pt-6 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left text-xs text-slate-400">
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800/80">
              <span className="font-semibold text-white block mb-0.5">Persistent Storage</span>
              Keep all your translated video projects safely saved to your profile.
            </div>
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800/80">
              <span className="font-semibold text-white block mb-0.5">Instant Downloads</span>
              Download clean SubRip (.SRT) and WebVTT (.VTT) subtitle files anytime.
            </div>
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800/80">
              <span className="font-semibold text-white block mb-0.5">One-Click Sharing</span>
              Generate public links to share translated videos and synced player directly.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <span>Google Account</span>
            <span aria-hidden="true">·</span>
            <span>{currentUser.email}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <span>My Translated Videos</span>
            <span className="text-xs bg-amber-400/20 text-amber-300 border border-amber-400/30 px-2 py-0.5 rounded-full font-mono">
              {translations.length} {translations.length === 1 ? 'Video' : 'Videos'}
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Access your translated videos, download subtitles in Arabic, or share them via direct links.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            disabled={loadingData}
            className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg transition-colors"
            title="Refresh list"
          >
            <RefreshCw className={`w-4 h-4 ${loadingData ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={onNavigateToTranslator}
            className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Translate New Video</span>
          </button>
        </div>
      </div>

      {actionError && (
        <div className="p-3 bg-red-950/60 border border-red-800 text-red-200 text-xs rounded-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Translations Grid / List */}
      {translations.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-4">
          <Subtitles className="w-12 h-12 text-slate-600 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-base font-bold text-white">No translations yet</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              You haven't translated any videos yet. Paste a YouTube URL or upload a video file to generate your first Arabic translation!
            </p>
          </div>
          <button
            onClick={onNavigateToTranslator}
            className="px-5 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl transition-colors inline-flex items-center gap-2"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Translate a Video Now</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {translations.map((item) => (
            <div
              key={item.id}
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl overflow-hidden flex flex-col justify-between transition-all group"
            >
              {/* Media Preview Box */}
              <div 
                onClick={() => onSelectTranslation(item)}
                className="relative aspect-video bg-slate-950 cursor-pointer overflow-hidden flex items-center justify-center border-b border-slate-800/80"
              >
                {item.thumbnailUrl ? (
                  <img
                    src={item.thumbnailUrl}
                    alt={item.videoTitle}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="text-slate-600 flex flex-col items-center gap-1.5">
                    <Video className="w-8 h-8 text-amber-400/60" />
                    <span className="text-[11px] font-mono">Uploaded Video</span>
                  </div>
                )}

                {/* Play button overlay */}
                <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 flex items-center justify-center transition-colors">
                  <div className="w-10 h-10 rounded-full bg-amber-400/90 text-slate-950 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  </div>
                </div>

                {/* Subtitle Cue Count Badge */}
                <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/80 backdrop-blur-xs text-[10px] font-mono text-amber-300 rounded border border-amber-400/30">
                  {item.cues?.length || 0} Arabic Cues
                </div>

                {/* Duration Badge */}
                <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/80 backdrop-blur-xs text-[10px] font-mono text-slate-300 rounded">
                  {Math.floor(item.videoDuration / 60)}:{(item.videoDuration % 60).toString().padStart(2, '0')}
                </div>
              </div>

              {/* Info Body */}
              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                    <span className="font-mono text-amber-400 font-semibold uppercase">
                      {item.srcLang} ➔ {item.tgtLang}
                    </span>
                    <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                  </div>

                  <h3 
                    onClick={() => onSelectTranslation(item)}
                    className="text-sm font-bold text-white line-clamp-2 hover:text-amber-400 transition-colors cursor-pointer"
                    title={item.videoTitle}
                  >
                    {item.videoTitle}
                  </h3>

                  {item.cues && item.cues[0] && (
                    <p className="text-xs text-amber-300/80 font-sans mt-2 line-clamp-1 text-right dir-rtl" dir="rtl">
                      "{item.cues[0].translatedText}"
                    </p>
                  )}
                </div>

                {/* Actions Toolbar */}
                <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5">
                    {/* View in Player */}
                    <button
                      onClick={() => onSelectTranslation(item)}
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1"
                      title="Open in player and view synchronized subtitles"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Play</span>
                    </button>

                    {/* Download SRT */}
                    <a
                      href={`/api/jobs/${item.id}/download/srt`}
                      download
                      className="p-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 text-xs rounded-lg transition-colors flex items-center"
                      title="Download SubRip (.SRT) subtitle file"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  </div>

                  <div className="flex items-center gap-1">
                    {/* Share Link Button */}
                    <button
                      onClick={() => handleShare(item)}
                      className="px-2.5 py-1.5 bg-amber-400/10 hover:bg-amber-400/20 text-amber-300 border border-amber-400/30 text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
                      title="Copy public shareable link"
                    >
                      {copiedId === item.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Share2 className="w-3.5 h-3.5" />
                          <span>Share</span>
                        </>
                      )}
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="p-1.5 text-slate-500 hover:text-red-400 rounded-lg hover:bg-slate-800 transition-colors"
                      title="Delete from library"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
