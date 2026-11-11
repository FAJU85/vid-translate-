import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Bot, Paperclip, CheckCheck, FileText, Film, Download, 
  Terminal, Sparkles, RefreshCw, AlertCircle
} from 'lucide-react';
import { TelegramMessage, TelegramUserSession } from '../../server/telegramBotService';

export const TelegramBotView: React.FC = () => {
  const [messages, setMessages] = useState<TelegramMessage[]>([]);
  const [inputVal, setInputVal] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [chatId] = useState('demo_chat_1');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const fetchSession = async () => {
    try {
      const res = await fetch(`/api/telegram/session/${chatId}`);
      if (res.ok) {
        const session: TelegramUserSession = await res.json();
        setMessages(session.messages);
      }
    } catch (err) {
      console.warn('Network polling note: Telegram session temporarily unavailable');
    }
  };

  useEffect(() => {
    fetchSession();
    const interval = setInterval(fetchSession, 2000);
    return () => clearInterval(interval);
  }, [chatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || inputVal;
    if (!text.trim() || isSending) return;

    setInputVal('');
    setIsSending(true);

    try {
      const res = await fetch('/api/telegram/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, text }),
      });
      if (res.ok) {
        fetchSession();
      }
    } catch (err) {
      console.error('Send message failed:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleCallbackClick = async (callbackData: string) => {
    try {
      const res = await fetch('/api/telegram/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, callbackData }),
      });
      if (res.ok) {
        fetchSession();
      }
    } catch (err) {
      console.error('Callback failed:', err);
    }
  };

  const renderFormattedText = (rawText: string) => {
    // Quick markdown parser for *bold*, `code`, and newlines
    const lines = rawText.split('\n');
    return lines.map((line, lIdx) => {
      // Split by `code`
      const parts = line.split(/(`[^`]+`|\*[^*]+\*)/g);
      return (
        <span key={lIdx} className="block leading-relaxed">
          {parts.map((p, pIdx) => {
            if (p.startsWith('`') && p.endsWith('`')) {
              return (
                <code key={pIdx} className="px-1 py-0.5 bg-slate-900/80 rounded font-mono text-[11px] text-amber-300">
                  {p.slice(1, -1)}
                </code>
              );
            }
            if (p.startsWith('*') && p.endsWith('*')) {
              return (
                <strong key={pIdx} className="font-semibold text-white">
                  {p.slice(1, -1)}
                </strong>
              );
            }
            return <span key={pIdx}>{p}</span>;
          })}
        </span>
      );
    });
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <span>Telegram Channel (FR-T1 - FR-T7)</span>
            <span aria-hidden="true">·</span>
            <span>Cloudflare Webhook Worker</span>
            <span aria-hidden="true">·</span>
            <span>Stateless Bot Engine</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Telegram Bot Client
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Functional parity with Web channel. Submit URLs, configure subtitle modes via inline keyboards, and receive document outputs directly in chat.
          </p>
        </div>

        {/* Quick Commands Bar */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleSendMessage('/start')}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs font-mono text-slate-300 transition-colors"
          >
            /start
          </button>
          <button
            onClick={() => handleSendMessage('/status')}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs font-mono text-slate-300 transition-colors"
          >
            /status
          </button>
          <button
            onClick={() => handleSendMessage('/cancel')}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs font-mono text-slate-300 transition-colors"
          >
            /cancel
          </button>
        </div>
      </div>

      {/* Main Telegram Chat UI Window */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden grid grid-cols-1 md:grid-cols-12 min-h-[640px]">
        {/* Left Sidebar: Chats list (4 cols) */}
        <div className="md:col-span-4 bg-slate-950/80 border-r border-slate-800 p-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Telegram Channels</span>
              <span className="text-[11px] font-mono text-emerald-400">Webhook Active</span>
            </div>

            {/* Active Bot Chat Card */}
            <div className="p-3 bg-slate-900 border border-amber-400/30 rounded-xl cursor-pointer">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center font-bold text-slate-950 text-sm shadow-md">
                  TV
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white truncate">TarjimVideo Bot</span>
                    <span className="text-[10px] text-slate-500">Just now</span>
                  </div>
                  <div className="text-[11px] text-amber-400 truncate">@TarjimVideoBot · bot</div>
                  <div className="text-[11px] text-slate-400 truncate mt-0.5">Whisper ASR &amp; NMT Orchestrator</div>
                </div>
              </div>
            </div>

            {/* Quick Prompts */}
            <div className="pt-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                Sample Video Injections
              </span>
              <div className="space-y-1.5">
                <button
                  onClick={() => handleSendMessage('https://youtube.com/watch?v=ai-video-revolution-2026')}
                  className="w-full text-left p-2 rounded-lg bg-slate-900/60 hover:bg-slate-900 border border-slate-800 text-[11px] text-slate-300 transition-colors"
                >
                  <div className="font-medium text-white truncate">AI Revolution (YouTube)</div>
                  <div className="text-slate-500 font-mono text-[10px] truncate">https://youtube.com/watch?v=...</div>
                </button>

                <button
                  onClick={() => handleSendMessage('https://vimeo.com/89124018')}
                  className="w-full text-left p-2 rounded-lg bg-slate-900/60 hover:bg-slate-900 border border-slate-800 text-[11px] text-slate-300 transition-colors"
                >
                  <div className="font-medium text-white truncate">Deep Universe (Vimeo)</div>
                  <div className="text-slate-500 font-mono text-[10px] truncate">https://vimeo.com/89124018</div>
                </button>

                <button
                  onClick={() => handleSendMessage('https://cdn.example.org/videos/keynote-overview.mp4')}
                  className="w-full text-left p-2 rounded-lg bg-slate-900/60 hover:bg-slate-900 border border-slate-800 text-[11px] text-slate-300 transition-colors"
                >
                  <div className="font-medium text-white truncate">Direct MP4 Keynote</div>
                  <div className="text-slate-500 font-mono text-[10px] truncate">https://cdn.example.org/...mp4</div>
                </button>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800/80 text-[11px] text-slate-500">
            <div>Encrypted Cloudflare Worker webhook</div>
            <div className="font-mono mt-0.5">POST /internal/telegram/webhook</div>
          </div>
        </div>

        {/* Right Chat Panel: Conversation Window (8 cols) */}
        <div className="md:col-span-8 flex flex-col justify-between bg-slate-950">
          {/* Chat Header */}
          <div className="p-3.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center font-bold text-slate-950 text-xs">
                TV
              </div>
              <div>
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>TarjimVideo Bot</span>
                  <span className="text-[10px] px-1 bg-amber-400/20 text-amber-300 rounded font-normal">BOT</span>
                </div>
                <div className="text-[11px] text-emerald-400">online</div>
              </div>
            </div>

            <button
              onClick={fetchSession}
              className="p-1.5 text-slate-400 hover:text-white transition-colors"
              title="Refresh conversation"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Messages Scroll Area */}
          <div className="flex-1 p-4 overflow-y-auto space-y-4 max-h-[500px]">
            {messages.map((msg) => {
              const isUser = msg.sender === 'user';
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs shadow-sm ${
                      isUser
                        ? 'bg-amber-500 text-slate-950 rounded-br-sm'
                        : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-sm'
                    }`}
                  >
                    {/* Message Body */}
                    <div className="space-y-1">{renderFormattedText(msg.text)}</div>

                    {/* Inline Keyboard Buttons (FR-T3) */}
                    {msg.inlineKeyboard && msg.inlineKeyboard.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-slate-800 space-y-1.5">
                        {msg.inlineKeyboard.map((row, rIdx) => (
                          <div key={rIdx} className="flex flex-wrap gap-1.5">
                            {row.map((btn, bIdx) => (
                              <button
                                key={bIdx}
                                onClick={() => handleCallbackClick(btn.callbackData)}
                                className="flex-1 min-w-[120px] px-3 py-1.5 bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700 rounded-lg text-slate-200 text-xs font-medium transition-colors text-center shadow-xs"
                              >
                                {btn.text}
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Attachment Deliverable Card (FR-T5) */}
                    {msg.attachment && (
                      <div className="mt-3 p-3 bg-slate-950/80 border border-slate-700/80 rounded-xl flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {msg.attachment.type === 'document' ? (
                            <FileText className="w-6 h-6 text-amber-400 shrink-0" />
                          ) : (
                            <Film className="w-6 h-6 text-purple-400 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white truncate">
                              {msg.attachment.filename}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              {msg.attachment.filesize} · Telegram Document
                            </div>
                          </div>
                        </div>

                        <a
                          href={msg.attachment.downloadUrl}
                          download
                          className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold text-xs rounded-lg transition-colors flex items-center gap-1 shrink-0"
                        >
                          <Download className="w-3 h-3" />
                          <span>Download</span>
                        </a>
                      </div>
                    )}

                    {/* Timestamp & Delivery status */}
                    <div className={`text-[10px] mt-1.5 flex items-center justify-end gap-1 ${
                      isUser ? 'text-slate-900/70' : 'text-slate-500'
                    }`}>
                      <span>{msg.timestamp}</span>
                      {isUser && <CheckCheck className="w-3 h-3" />}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input Bar */}
          <div className="p-3 bg-slate-900/90 border-t border-slate-800">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-2"
            >
              <button
                type="button"
                onClick={() => handleSendMessage('https://youtube.com/watch?v=ai-video-revolution-2026')}
                className="p-2 text-slate-400 hover:text-white transition-colors"
                title="Paste demo video URL"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <input
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder="Send a video link or command (/start, /status, /cancel)..."
                className="flex-1 px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-400"
              />

              <button
                type="submit"
                disabled={!inputVal.trim() || isSending}
                className="p-2 bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-xl transition-colors disabled:opacity-40"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
