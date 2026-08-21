import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, Loader2, AlertTriangle, CheckCircle2, X } from 'lucide-react';

export interface VideoPreparationModalProps {
  isOpen: boolean;
  progress: number;
  time?: string;
  statusText?: string;
  error?: string | null;
  isSuccess?: boolean;
  onClose?: () => void;
  onRetry?: () => void;
}

export const VideoPreparationModal: React.FC<VideoPreparationModalProps> = ({
  isOpen,
  progress,
  time,
  statusText = 'Конвертирование видео в совместимый формат MP4 (H.264)...',
  error,
  isSuccess,
  onClose,
  onRetry
}) => {
  if (!isOpen) return null;

  const roundedProgress = Math.min(100, Math.max(0, Math.round(progress)));

  return (
    <AnimatePresence>
      <div 
        id="video-preparation-overlay"
        className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md select-none"
      >
        <motion.div
          id="video-preparation-card"
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-md bg-zinc-900/95 border border-zinc-700/60 rounded-2xl p-6 sm:p-8 text-center shadow-2xl overflow-hidden"
        >
          {/* Subtle decorative background glow */}
          <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-48 h-48 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />

          {/* Close button if error or success */}
          {(error || isSuccess) && onClose && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition-colors"
              title="Закрыть"
            >
              <X className="w-5 h-5" />
            </button>
          )}

          {/* Icon Header */}
          <div className="relative w-16 h-16 mx-auto mb-5 flex items-center justify-center">
            {error ? (
              <div className="w-16 h-16 bg-rose-500/20 border border-rose-500/30 rounded-2xl flex items-center justify-center shadow-lg shadow-rose-500/10">
                <AlertTriangle className="w-8 h-8 text-rose-400 animate-pulse" />
              </div>
            ) : isSuccess ? (
              <div className="w-16 h-16 bg-emerald-500/20 border border-emerald-500/30 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/10">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              </div>
            ) : (
              <div className="w-16 h-16 bg-indigo-500/20 border border-indigo-500/30 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/10">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
                >
                  <Film className="w-8 h-8 text-indigo-400" />
                </motion.div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-10 h-10 text-indigo-300/40 animate-spin" />
                </div>
              </div>
            )}
          </div>

          {/* Main Title */}
          <h3 className="text-xl sm:text-2xl font-bold text-white mb-2 tracking-tight">
            {error ? 'Ошибка подготовки видео' : isSuccess ? 'Видео готово' : 'Подготовка видео'}
          </h3>

          {/* Status message */}
          <p className="text-sm text-zinc-300/90 mb-6 leading-relaxed">
            {error ? (
              <span className="text-rose-300">{error}</span>
            ) : isSuccess ? (
              <span className="text-emerald-300">Видео успешно сконвертировано и загружено в проект.</span>
            ) : (
              statusText
            )}
          </p>

          {/* Progress Section (shown when not in error state) */}
          {!error && (
            <div className="space-y-3 mb-6 bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-4">
              <div className="h-3 bg-zinc-800 rounded-full overflow-hidden p-0.5 relative">
                <motion.div 
                  className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 rounded-full shadow-[0_0_12px_rgba(99,102,241,0.6)] transition-all duration-300"
                  style={{ width: `${Math.max(roundedProgress, 4)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400 font-medium">
                  {time ? `Время: ${time}` : 'Обработка FFmpeg...'}
                </span>
                <span className="text-indigo-400 font-bold font-mono text-sm">
                  {roundedProgress}%
                </span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {error ? (
            <div className="flex gap-3 justify-center">
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-indigo-600/30 active:scale-95"
                >
                  Попробовать снова
                </button>
              )}
              {onClose && (
                <button
                  onClick={onClose}
                  className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-sm font-semibold transition-all active:scale-95"
                >
                  Отмена
                </button>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500 italic">
              Это гарантирует стабильное воспроизведение, синхронизацию дорожек и плавный предпросмотр.
            </p>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default VideoPreparationModal;
