import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderOpen, AlertTriangle, CheckCircle2, ShieldAlert, Loader2, HardDrive, X } from 'lucide-react';
import { Project } from '../types';
import { PendingTakeData, relocateProjectToChosenFolder, buildProjectFolderPath } from '../lib/projectRelocation';

interface ProjectFolderRecoveryModalProps {
  isOpen: boolean;
  errorDetails: string;
  project: Project | null;
  pendingTake?: PendingTakeData | null;
  onRecovered: (updatedProject: Project, newProjectRoot: string) => void;
  onClose: () => void;
}

export const ProjectFolderRecoveryModal: React.FC<ProjectFolderRecoveryModalProps> = ({
  isOpen,
  errorDetails,
  project,
  pendingTake,
  onRecovered,
  onClose
}) => {
  const [isRelocating, setIsRelocating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [recoveredPath, setRecoveredPath] = useState<string | null>(null);

  if (!isOpen || !project) return null;

  const hasUnsavedTakes = Boolean(
    pendingTake ||
    project.tracks?.some(t =>
      t.segments?.some(s => !s.filePath && s.blobUrl?.startsWith('blob:'))
    )
  );

  const expectedFolderName = buildProjectFolderPath('Выбранная_папка', project.name).split('/').pop();

  const handleChooseFolderAndRecover = async () => {
    if (!window.electronAPI || isRelocating) return;
    setLocalError(null);

    try {
      const folderRes = await window.electronAPI.openFolder();
      if (!folderRes.success || !folderRes.data) {
        return; // User cancelled dialog
      }

      const chosenDir = folderRes.data;
      setIsRelocating(true);
      setStatusMessage('Подготовка папки проекта...');

      const result = await relocateProjectToChosenFolder({
        project,
        chosenParentDir: chosenDir,
        pendingTake,
        onStatus: (msg) => setStatusMessage(msg)
      });

      if (result.success && result.updatedProject && result.newProjectRoot) {
        setRecoveredPath(result.newProjectRoot);
        setStatusMessage('Все файлы и записи успешно сохранены!');
        setTimeout(() => {
          setIsRelocating(false);
          setRecoveredPath(null);
          onRecovered(result.updatedProject!, result.newProjectRoot!);
        }, 900);
      } else {
        setIsRelocating(false);
        setLocalError(result.error || 'Не удалось сохранить проект в выбранную папку. Попробуйте выбрать другую директорию (например, на Рабочем столе или в Документах).');
      }
    } catch (err: any) {
      setIsRelocating(false);
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          className="relative w-full max-w-lg rounded-2xl bg-zinc-900 border border-amber-500/30 shadow-2xl overflow-hidden text-white"
        >
          {/* Top Accent Line */}
          <div className="h-1 w-full bg-gradient-to-r from-amber-500 via-indigo-500 to-emerald-500" />

          <div className="p-6 flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white leading-snug">
                    Не удалось сохранить запись в папку проекта
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Требуется выбрать доступную для записи папку на диске
                  </p>
                </div>
              </div>
              {!isRelocating && (
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors"
                  title="Закрыть"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Reassurance banner that the take is safe */}
            {hasUnsavedTakes && (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-200">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed">
                  <span className="font-bold text-emerald-300">Ваша запись не потеряна!</span> Записанная реплика уже добавлена на таймлайн и удерживается в оперативной памяти. Как только вы выберете папку, файл сразу сохранится на диск.
                </div>
              </div>
            )}

            {/* Explanation */}
            <div className="text-xs text-zinc-300 leading-relaxed space-y-2 bg-zinc-950/60 border border-white/5 rounded-xl p-4">
              <p>
                При импорте видео не удалось создать или использовать рабочую папку проекта (например, файл открыт из защищённой системной директории, архива или диска без прав на запись).
              </p>
              <p className="text-zinc-400">
                Нажмите кнопку ниже и выберите любую удобную папку (например, <strong className="text-zinc-200">Документы</strong> или <strong className="text-zinc-200">Рабочий стол</strong>). Приложение автоматически создаст внутри неё папку <code className="text-indigo-300 bg-indigo-500/10 px-1.5 py-0.5 rounded">{expectedFolderName}</code> и перенесёт туда все файлы проекта и ваши записи.
              </p>
            </div>

            {/* Error & Current Path Diagnostics */}
            <div className="rounded-xl bg-zinc-950/90 border border-white/5 px-3.5 py-2.5 text-[11px] font-mono text-zinc-400 space-y-1">
              <div className="flex items-center gap-1.5 text-zinc-500">
                <HardDrive className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  Текущий путь: {project.projectPath && project.projectPath !== '/mock/path' ? project.projectPath : 'Не задан (только в памяти)'}
                </span>
              </div>
              {errorDetails && (
                <div className="flex items-start gap-1.5 text-amber-400/90 break-all">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>Детали: {errorDetails}</span>
                </div>
              )}
            </div>

            {/* Local error if chosen folder also failed */}
            {localError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                {localError}
              </div>
            )}

            {/* Progress / Success state */}
            {(isRelocating || recoveredPath) && (
              <div className="flex items-center gap-3 p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-xs text-indigo-200">
                {recoveredPath ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                ) : (
                  <Loader2 className="w-5 h-5 text-indigo-400 animate-spin shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-white">{statusMessage}</div>
                  {recoveredPath && (
                    <div className="text-[11px] text-zinc-400 truncate mt-0.5">{recoveredPath}</div>
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                disabled={isRelocating}
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                Позже
              </button>
              <button
                type="button"
                disabled={isRelocating}
                onClick={handleChooseFolderAndRecover}
                className="flex-1 py-2.5 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-bold shadow-lg shadow-indigo-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isRelocating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Сохранение проекта...</span>
                  </>
                ) : (
                  <>
                    <FolderOpen className="w-4 h-4" />
                    <span>Выбрать папку для проекта и сохранить</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
