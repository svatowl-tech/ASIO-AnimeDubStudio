import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, ArrowRight, CheckCircle2, X } from 'lucide-react';
import { Project, SubtitleLine } from '../types';
import { getSubtitleCoverageStats, getNextUnrecordedSubtitle } from '../lib/subtitleCoverage';

interface MissingSubtitlesBannerProps {
  project: Project | null;
  currentTime: number;
  onSeek: (time: number) => void;
  isActive: boolean;
  onClose: () => void;
}

export const MissingSubtitlesBanner: React.FC<MissingSubtitlesBannerProps> = ({
  project,
  currentTime,
  onSeek,
  isActive,
  onClose,
}) => {
  const stats = getSubtitleCoverageStats(project);

  // Auto-close banner if all lines are recorded
  useEffect(() => {
    if (isActive && stats.totalTargetLines > 0 && stats.unrecordedLinesCount === 0) {
      const timer = setTimeout(() => {
        onClose();
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [isActive, stats.totalTargetLines, stats.unrecordedLinesCount, onClose]);

  if (!isActive) return null;

  const isComplete = stats.totalTargetLines > 0 && stats.unrecordedLinesCount === 0;

  const handleNextMissing = () => {
    const nextLine = getNextUnrecordedSubtitle(project, currentTime, stats.unrecordedLineIds);
    if (nextLine) {
      const preroll = project?.audioSettings?.prerollSeconds ?? 2;
      const offset = project?.subtitlesOffset || 0;
      const targetTime = Math.max(0, nextLine.start + offset - preroll);
      
      onSeek(targetTime);

      // Trigger scroll event to focus the subtitle element in sidebar
      setTimeout(() => {
        const el = document.getElementById(`sub-${nextLine.id}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 50, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 50, opacity: 0, scale: 0.95 }}
        className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 bg-zinc-900/95 border border-amber-500/40 backdrop-blur-md rounded-2xl shadow-2xl shadow-amber-500/10 text-white font-sans max-w-lg w-full"
      >
        {isComplete ? (
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs flex-1">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 animate-bounce" />
            <span>Отлично! Все {stats.totalTargetLines} реплик успешно записаны!</span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 flex-shrink-0 animate-pulse">
                <AlertCircle className="w-4 h-4" />
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-amber-300 truncate">
                    Пропущено {stats.unrecordedLinesCount} из {stats.totalTargetLines} реплик
                  </span>
                  {stats.activeRoles.length > 0 && (
                    <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.2 rounded truncate">
                      {stats.activeRoles.join(', ')}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-zinc-400">
                  Подсветка пропусков включена на таймлайне и в сценарии
                </span>
              </div>
            </div>

            <button
              onClick={handleNextMissing}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 flex-shrink-0 active:scale-95"
            >
              <span>Записать след. пропуск</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={onClose}
              className="p-1 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors flex-shrink-0"
              title="Закрыть подсветку"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

export default MissingSubtitlesBanner;
