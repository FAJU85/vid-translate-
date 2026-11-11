import React from 'react';
import { Video, Bot, Layers, ShieldCheck, LogIn, LogOut, Subtitles, User as UserIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export type NavTab = 'web' | 'my_translations' | 'telegram' | 'architecture' | 'admin';

interface HeaderProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onNewJobClick: () => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, onTabChange, onNewJobClick }) => {
  const { currentUser, isAdmin, signInWithGoogle, logout } = useAuth();

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between gap-6 px-4 md:px-6 py-3.5 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
      {/* Zone 1: Wordmark */}
      <div 
        onClick={() => onTabChange('web')}
        className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-2"
      >
        <span className="text-amber-400 font-black">ترجم</span>
        <span>TarjimVideo</span>
      </div>

      {/* Zone 2: Navigation Links */}
      <nav className="hidden lg:flex items-center gap-5 text-sm font-medium text-slate-300">
        <button
          onClick={() => onTabChange('web')}
          className={`flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'web' ? 'text-amber-400 font-bold' : 'hover:text-white text-slate-300'
          }`}
        >
          <Video className="w-4 h-4" />
          <span>Video Translator</span>
        </button>

        <button
          onClick={() => onTabChange('my_translations')}
          className={`flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'my_translations' ? 'text-amber-400 font-bold' : 'hover:text-white text-slate-300'
          }`}
        >
          <Subtitles className="w-4 h-4" />
          <span>My Translations</span>
          {currentUser && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block ml-0.5" />
          )}
        </button>

        <button
          onClick={() => onTabChange('telegram')}
          className={`flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'telegram' ? 'text-amber-400 font-bold' : 'hover:text-white text-slate-300'
          }`}
        >
          <Bot className="w-4 h-4" />
          <span>Telegram Bot</span>
        </button>

        <button
          onClick={() => onTabChange('architecture')}
          className={`flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'architecture' ? 'text-amber-400 font-bold' : 'hover:text-white text-slate-300'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Architecture &amp; API</span>
        </button>

        {isAdmin && (
          <button
            onClick={() => onTabChange('admin')}
            className={`flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'admin' ? 'text-amber-400 font-bold' : 'hover:text-white text-slate-300'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Admin Control Panel</span>
          </button>
        )}
      </nav>

      {/* Zone 3: Authentication & Actions */}
      <div className="flex items-center gap-3 shrink-0">
        {currentUser ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onTabChange('my_translations')}
              className="flex items-center gap-2 px-2.5 py-1.5 text-xs font-mono rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:border-slate-600 transition-colors"
              title="View my translations"
            >
              {currentUser.photoURL ? (
                <img
                  src={currentUser.photoURL}
                  alt={currentUser.displayName || 'User'}
                  className="w-5 h-5 rounded-full object-cover"
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-amber-400 text-slate-950 font-bold flex items-center justify-center text-[10px]">
                  {currentUser.displayName ? currentUser.displayName[0].toUpperCase() : 'U'}
                </div>
              )}
              <span className="truncate max-w-[110px] hidden sm:inline">
                {currentUser.displayName || currentUser.email}
              </span>
            </button>

            <button
              onClick={logout}
              className="p-1.5 text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={signInWithGoogle}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-900 bg-white hover:bg-slate-100 rounded-lg transition-all shadow-sm whitespace-nowrap"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In with Google</span>
          </button>
        )}

        <button
          onClick={onNewJobClick}
          className="px-3.5 py-2 text-xs font-semibold text-slate-950 bg-amber-400 rounded-lg hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 shadow-sm"
        >
          + Translate Video
        </button>
      </div>
    </header>
  );
};
