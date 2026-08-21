import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Video, AudioLines, FileAudio, FolderOpen, FileEdit, RotateCcw, AlertTriangle, Mic } from 'lucide-react';
import { buildCleanExportFilename, sanitizeFilenameSegment } from '../lib/filenameUtils';
import { Project } from '../types';
import { getSubtitleCoverageStats } from '../lib/subtitleCoverage';

export interface ExportOptions {
  format: 'WAV' | 'MP3' | 'FLAC';
  includeVideo: boolean;
  includeOriginalAudio: boolean;
  forceMono: boolean;
  exportFolder: string;
  customFileName?: string;
}

interface ExportModalProps {
  project?: Project | null;
  onExport: (options: ExportOptions) => void;
  onCancel: () => void;
  initialFormat?: 'WAV' | 'MP3' | 'FLAC';
  onStartRecordingMissing?: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ 
  project,
  onExport, 
  onCancel,
  initialFormat = 'WAV',
  onStartRecordingMissing
}) => {
  const [format, setFormat] = useState<'WAV' | 'MP3' | 'FLAC'>(initialFormat);
  const [includeVideo, setIncludeVideo] = useState(false);
  const [includeOriginalAudio, setIncludeOriginalAudio] = useState(false);
  const [forceMono, setForceMono] = useState(true);
  const [exportFolder, setExportFolder] = useState<string>('');

  const [filename, setFilename] = useState<string>('');
  const [isCustomFilename, setIsCustomFilename] = useState<boolean>(false);

  const coverageStats = getSubtitleCoverageStats(project || null);

  // Compute clean default filename
  const computeDefaultFilename = (targetFormat: string) => {
    const activeRoles = project?.selectedRoles && project.selectedRoles.length > 0
      ? project.selectedRoles
      : (project?.selectedRole ? [project.selectedRole] : []);
    const hasFixes = !!(project?.fixes && project.fixes.length > 0);
    const dubberNick = project?.dubberNick || localStorage.getItem('dubstudio_dubber_nick') || '';

    let videoName = '';
    if (project?.videoPath) {
      const base = project.videoPath.split(/[/\\]/).pop() || '';
      const extIdx = base.lastIndexOf('.');
      videoName = extIdx !== -1 ? base.substring(0, extIdx) : base;
    } else if (project?.videoUrl) {
      const base = project.videoUrl.split('/').pop()?.split('?')[0] || '';
      const extIdx = base.lastIndexOf('.');
      videoName = extIdx !== -1 ? base.substring(0, extIdx) : base;
    }

    return buildCleanExportFilename({
      dubberNick,
      activeRoles,
      projectName: project?.name,
      videoName,
      prefix: hasFixes ? 'fix' : '',
      extension: targetFormat.toLowerCase()
    });
  };

  useEffect(() => {
    const savedFolder = localStorage.getItem('dubstudio_export_folder');
    if (savedFolder) setExportFolder(savedFolder);

    setFilename(computeDefaultFilename(format));
  }, []);

  // Update extension if format changes and user hasn't typed custom name
  const handleFormatChange = (newFormat: 'WAV' | 'MP3' | 'FLAC') => {
    setFormat(newFormat);
    if (!isCustomFilename) {
      setFilename(computeDefaultFilename(newFormat));
    } else {
      // Replace existing extension with new format extension
      const lastDot = filename.lastIndexOf('.');
      if (lastDot > 0) {
        setFilename(`${filename.substring(0, lastDot)}.${newFormat.toLowerCase()}`);
      } else {
        setFilename(`${filename}.${newFormat.toLowerCase()}`);
      }
    }
  };

  const handleResetFilename = () => {
    setIsCustomFilename(false);
    setFilename(computeDefaultFilename(format));
  };

  const handleSelectFolder = async () => {
    if (window.electronAPI) {
      const res = await window.electronAPI.openFolder();
      if (res.success && res.data) {
        setExportFolder(res.data);
        localStorage.setItem('dubstudio_export_folder', res.data);
      }
    }
  };

  const handleExportClick = () => {
    // Sanitize user-edited filename before export
    let finalName = filename.trim();
    if (finalName) {
      const ext = format.toLowerCase();
      if (!finalName.toLowerCase().endsWith(`.${ext}`)) {
        finalName = `${finalName}.${ext}`;
      }
      const parts = finalName.split('.');
      const extName = parts.pop() || ext;
      const base = parts.join('.');
      const cleanBase = sanitizeFilenameSegment(base) || 'export';
      finalName = `${cleanBase}.${extName}`;
    } else {
      finalName = computeDefaultFilename(format);
    }

    onExport({ 
      format, 
      includeVideo, 
      includeOriginalAudio, 
      forceMono, 
      exportFolder,
      customFileName: finalName
    });
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-[100] p-4">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-zinc-900 border border-white/10 p-6 sm:p-8 rounded-2xl shadow-2xl w-full max-w-md space-y-6"
      >
        <h3 className="text-xl font-bold text-white flex items-center gap-2">
          Настройки экспорта
        </h3>

        {coverageStats.totalTargetLines > 0 && coverageStats.unrecordedLinesCount > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 flex flex-col gap-2.5">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="flex flex-col text-xs font-sans">
                <span className="font-bold text-amber-300">
                  Не записано {coverageStats.unrecordedLinesCount} из {coverageStats.totalTargetLines} реплик!
                </span>
                <span className="text-[11px] text-zinc-400 mt-0.5">
                  Выбранные роли ({coverageStats.activeRoles.join(', ') || 'Все'}): записано {coverageStats.recordedLinesCount} реплик.
                </span>
              </div>
            </div>

            {onStartRecordingMissing && (
              <button
                type="button"
                onClick={() => {
                  onStartRecordingMissing();
                  onCancel();
                }}
                className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs rounded-lg transition-all flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/10 active:scale-[0.98]"
              >
                <Mic className="w-3.5 h-3.5" />
                <span>Записать пропущенные реплики ({coverageStats.unrecordedLinesCount})</span>
              </button>
            )}
          </div>
        )}

        <div className="space-y-5">
          {/* Format selector */}
          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Формат</label>
            <div className="flex gap-2">
              {(['WAV', 'MP3', 'FLAC'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => handleFormatChange(f)}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${
                    format === f ? 'bg-indigo-600 text-white shadow-md' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Export Filename Field with Preview & Edit */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-zinc-400 uppercase flex items-center gap-1.5">
                <FileEdit className="w-3.5 h-3.5 text-indigo-400" />
                Имя файла (предпросмотр)
              </label>
              {isCustomFilename && (
                <button
                  type="button"
                  onClick={handleResetFilename}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1 transition-colors"
                  title="Сбросить на авто-сгенерированное"
                >
                  <RotateCcw className="w-3 h-3" />
                  Сброс
                </button>
              )}
            </div>
            <input
              type="text"
              value={filename}
              onChange={e => {
                setFilename(e.target.value);
                setIsCustomFilename(true);
              }}
              placeholder="Имя файла..."
              className="w-full bg-zinc-800/90 border border-zinc-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs text-indigo-200 font-mono focus:outline-none transition-all"
            />
            <p className="text-[10px] text-zinc-500 mt-1">
              Фильтрует запрещенные символы OS и дубликаты слов.
            </p>
          </div>

          {/* Export folder selector */}
          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Папка экспорта</label>
            <div className="flex gap-2 items-center">
              <div 
                className="flex-1 bg-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-300 truncate border border-zinc-700" 
                title={exportFolder || 'По умолчанию папка проекта'}
              >
                {exportFolder || 'По умолчанию папка проекта'}
              </div>
              <button 
                type="button"
                onClick={handleSelectFolder}
                className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-xl text-xs text-white font-bold transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <FolderOpen className="w-4 h-4" />
                Обзор
              </button>
            </div>
          </div>

          {/* Toggle Options */}
          <div className="space-y-3 pt-3 border-t border-white/5">
            <label className="flex items-center gap-3 text-xs text-zinc-300 cursor-pointer group">
              <input 
                type="checkbox" 
                checked={includeVideo} 
                onChange={e => setIncludeVideo(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-800 text-indigo-500 focus:ring-indigo-500"
              />
              <Video className="w-4 h-4 text-zinc-500 group-hover:text-indigo-400 transition-colors" /> 
              <span>Включить видеодорожку</span>
            </label>
            
            <label className="flex items-center gap-3 text-xs text-zinc-300 cursor-pointer group">
              <input 
                type="checkbox" 
                checked={includeOriginalAudio} 
                onChange={e => setIncludeOriginalAudio(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-800 text-indigo-500 focus:ring-indigo-500"
              />
              <AudioLines className="w-4 h-4 text-zinc-500 group-hover:text-indigo-400 transition-colors" /> 
              <span>Включить оригинальное аудиоиз видео</span>
            </label>

            <label className="flex items-center gap-3 text-xs text-zinc-300 cursor-pointer group">
              <input 
                type="checkbox" 
                checked={forceMono} 
                onChange={e => setForceMono(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-800 text-indigo-500 focus:ring-indigo-500"
              />
              <FileAudio className="w-4 h-4 text-zinc-500 group-hover:text-indigo-400 transition-colors" /> 
              <span>Дублировать в оба канала (Моно)</span>
            </label>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button 
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
          >
            Отмена
          </button>
          <button 
            type="button"
            onClick={handleExportClick}
            className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-600/20"
          >
            Экспорт
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default ExportModal;
