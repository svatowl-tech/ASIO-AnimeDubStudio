import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Sparkles, CheckCircle2, ShieldCheck } from 'lucide-react';

interface ExportOverlayProps {
  isExporting: boolean;
  exportProgress: number;
  exportOperation: string;
}

export const ExportOverlay: React.FC<ExportOverlayProps> = ({
  isExporting,
  exportProgress,
  exportOperation
}) => {
  const safeProgress = Math.min(100, Math.max(0, Math.round(exportProgress)));
  const isDone = safeProgress >= 100;

  return (
    <AnimatePresence>
      {isExporting && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", stiffness: 350, damping: 28 }}
            className="relative w-full max-w-md bg-zinc-900/95 border border-white/10 rounded-3xl p-8 text-center shadow-2xl overflow-hidden backdrop-blur-xl"
          >
            {/* Ambient background glow */}
            <div className="absolute -top-24 -left-24 w-48 h-48 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-purple-500/15 rounded-full blur-3xl pointer-events-none" />

            {/* Glowing Icon */}
            <div className="relative w-20 h-20 mx-auto mb-5">
              <div className="absolute inset-0 bg-indigo-500/20 rounded-2xl blur-lg animate-pulse" />
              <div className="relative w-full h-full bg-gradient-to-tr from-indigo-600 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/30 border border-white/10">
                {isDone ? (
                  <CheckCircle2 className="w-10 h-10 text-white animate-bounce" />
                ) : (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                  >
                    <Download className="w-9 h-9 text-white" />
                  </motion.div>
                )}
              </div>
            </div>

            {/* Title & Status */}
            <h3 className="text-xl font-black text-white tracking-tight mb-1.5 flex items-center justify-center gap-2">
              <span>{isDone ? 'Экспорт завершен!' : 'Экспорт проекта...'}</span>
              <Sparkles className="w-4 h-4 text-indigo-400 animate-spin" style={{ animationDuration: '4s' }} />
            </h3>

            <p className="text-xs text-indigo-300 font-medium px-2 py-1 bg-indigo-950/60 border border-indigo-500/20 rounded-lg inline-block mb-4 max-w-full truncate">
              {exportOperation || 'Фоновая обработка и рендеринг дорожек...'}
            </p>

            <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
              Выполняется фоновое сведение, выравнивание таймкодов и нормализация звука.
            </p>
            
            {/* Beautiful Progress Bar */}
            <div className="relative w-full bg-zinc-800/80 p-1 rounded-2xl border border-white/5 mb-3 shadow-inner">
              <div className="h-3 bg-zinc-950 rounded-xl overflow-hidden relative">
                <motion.div 
                  className="h-full bg-gradient-to-r from-indigo-500 via-indigo-400 to-purple-500 rounded-xl relative shadow-[0_0_12px_rgba(99,102,241,0.6)]"
                  initial={{ width: '0%' }}
                  animate={{ width: `${safeProgress}%` }}
                  transition={{ ease: "easeOut", duration: 0.3 }}
                >
                  <div className="absolute inset-0 bg-white/20 animate-pulse" />
                </motion.div>
              </div>
            </div>

            {/* Percentage & Progress indicator */}
            <div className="flex justify-between items-center text-xs font-bold px-1 mb-5">
              <span className="text-zinc-500 uppercase tracking-wider text-[10px]">Выполнение задачи</span>
              <span className="text-indigo-300 font-mono text-sm">{safeProgress}%</span>
            </div>

            {/* Reassurance Badge: Silent background execution without command windows */}
            <div className="flex items-center justify-center gap-1.5 pt-3 border-t border-white/5 text-[11px] text-zinc-400">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Фоновый тихий процесс без лишних консольных окон</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default ExportOverlay;
