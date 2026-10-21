import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Video, AudioLines, FileAudio, FolderOpen, FileEdit, RotateCcw, AlertTriangle, Mic, Volume2, Sliders, Sparkles } from 'lucide-react';
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
  normalizeAudio: boolean;
  normalizationLevel: number;
  normalizationPeak: number;
  normalizationMode: 'lufs' | 'peak';
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

  // Normalization options (default: target -20 LUFS, peak limit -9 dB)
  const [normalizeAudio, setNormalizeAudio] = useState<boolean>(() => {
    const saved = localStorage.getItem('dubstudio_export_normalize_audio');
    return saved !== null ? saved === 'true' : true;
  });
  const [normalizationLevel, setNormalizationLevel] = useState<number>(() => {
    const saved = localStorage.getItem('dubstudio_export_norm_level');
    return saved ? Number(saved) : -20;
  });
  const [normalizationPeak, setNormalizationPeak] = useState<number>(() => {
    const saved = localStorage.getItem('dubstudio_export_norm_peak');
    return saved ? Number(saved) : -9.0;
  });
  const [normalizationMode, setNormalizationMode] = useState<'lufs' | 'peak'>(() => {
    const saved = localStorage.getItem('dubstudio_export_norm_mode');
    return (saved === 'peak' ? 'peak' : 'lufs');
  });

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

  const handleLevelChange = (lvl: number) => {
    setNormalizationLevel(lvl);
    localStorage.setItem('dubstudio_export_norm_level', String(lvl));
  };

  const handlePeakChange = (peak: number) => {
    setNormalizationPeak(peak);
    localStorage.setItem('dubstudio_export_norm_peak', String(peak));
  };

  const handleModeChange = (mode: 'lufs' | 'peak') => {
    setNormalizationMode(mode);
    localStorage.setItem('dubstudio_export_norm_mode', mode);
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
      customFileName: finalName,
      normalizeAudio,
      normalizationLevel,
      normalizationPeak,
      normalizationMode
    });
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-[100] p-4">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-zinc-900 border border-white/10 p-6 sm:p-8 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto space-y-6"
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

          {/* Normalization Section */}
          <div className="bg-zinc-800/70 border border-zinc-700/70 rounded-xl p-3.5 space-y-3 transition-all">
            <label className="flex items-center justify-between cursor-pointer group">
              <div className="flex items-center gap-2.5">
                <input 
                  type="checkbox" 
                  checked={normalizeAudio} 
                  onChange={e => {
                    setNormalizeAudio(e.target.checked);
                    localStorage.setItem('dubstudio_export_normalize_audio', String(e.target.checked));
                  }}
                  className="rounded border-zinc-700 bg-zinc-800 text-indigo-500 focus:ring-indigo-500 w-4 h-4"
                />
                <div className="flex items-center gap-2">
                  <Volume2 className={`w-4 h-4 transition-colors ${normalizeAudio ? 'text-indigo-400' : 'text-zinc-500 group-hover:text-zinc-400'}`} />
                  <span className="text-xs font-semibold text-zinc-200">
                    Нормализовать дорожку по громкости
                  </span>
                </div>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md ${
                normalizeAudio 
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold' 
                  : 'bg-zinc-800 text-zinc-500'
              }`}>
                {normalizeAudio 
                  ? (normalizationMode === 'lufs' ? `${normalizationLevel} LUFS (пик ≤ ${normalizationPeak} dB)` : `Пик: ${normalizationPeak} dBFS`) 
                  : 'Выключено'}
              </span>
            </label>

            {normalizeAudio && (
              <div className="pt-2.5 border-t border-zinc-700/50 space-y-3 text-xs">
                {/* Normalization Mode Selector */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                      Режим нормализации
                    </label>
                    <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-amber-400" />
                      EBU R128 / True Peak
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 p-0.5 bg-zinc-900/90 rounded-lg border border-zinc-800">
                    <button
                      type="button"
                      onClick={() => handleModeChange('lufs')}
                      className={`py-1.5 px-2 rounded text-[11px] font-medium transition-all text-center ${
                        normalizationMode === 'lufs'
                          ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Интегрированная (LUFS)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleModeChange('peak')}
                      className={`py-1.5 px-2 rounded text-[11px] font-medium transition-all text-center ${
                        normalizationMode === 'peak'
                          ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      По пику (True Peak)
                    </button>
                  </div>
                </div>

                {normalizationMode === 'lufs' ? (
                  <>
                    {/* Target LUFS Level Slider & Presets */}
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[11px] text-zinc-300 font-medium">Целевая громкость:</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={-36}
                            max={-10}
                            step={0.5}
                            value={normalizationLevel}
                            onChange={e => handleLevelChange(Number(e.target.value))}
                            className="w-14 bg-zinc-900 border border-indigo-700/50 rounded px-1.5 py-0.5 text-[11px] font-mono text-indigo-300 text-right focus:outline-none focus:border-indigo-500"
                          />
                          <span className="text-[11px] font-mono text-indigo-400">LUFS</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={-36}
                        max={-10}
                        step={0.5}
                        value={normalizationLevel}
                        onChange={e => handleLevelChange(Number(e.target.value))}
                        className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                      />
                      {/* Presets */}
                      <div className="grid grid-cols-3 gap-1 mt-2">
                        {[
                          { label: '-20 LUFS (Дубляж)', val: -20, title: 'Рекомендуемый стандарт для дубляжа' },
                          { label: '-23 LUFS (EBU R128)', val: -23, title: 'Европейский стандарт вещания' },
                          { label: '-14 LUFS (YouTube/Веб)', val: -14, title: 'Для стриминга и интернета' },
                        ].map(preset => (
                          <button
                            key={preset.val}
                            type="button"
                            onClick={() => handleLevelChange(preset.val)}
                            title={preset.title}
                            className={`py-1 px-1 rounded text-[10px] border transition-colors truncate ${
                              normalizationLevel === preset.val
                                ? 'bg-indigo-600/30 border-indigo-500/60 text-indigo-200 font-semibold'
                                : 'bg-zinc-800/80 border-zinc-700/60 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Peak Limit */}
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[11px] text-zinc-300 font-medium">Ограничение пиков (не выше):</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={-18}
                            max={-1}
                            step={0.5}
                            value={normalizationPeak}
                            onChange={e => handlePeakChange(Number(e.target.value))}
                            className="w-14 bg-zinc-900 border border-amber-700/50 rounded px-1.5 py-0.5 text-[11px] font-mono text-amber-300 text-right focus:outline-none focus:border-amber-500"
                          />
                          <span className="text-[11px] font-mono text-amber-400">dB</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={-18}
                        max={-1}
                        step={0.5}
                        value={normalizationPeak}
                        onChange={e => handlePeakChange(Number(e.target.value))}
                        className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                      />
                      {/* Peak Presets */}
                      <div className="grid grid-cols-4 gap-1 mt-2">
                        {[
                          { label: '-9 dB (Стандарт)', val: -9 },
                          { label: '-6 dB', val: -6 },
                          { label: '-2 dB (R128)', val: -2 },
                          { label: '-1 dB (Пик)', val: -1 },
                        ].map(preset => (
                          <button
                            key={preset.val}
                            type="button"
                            onClick={() => handlePeakChange(preset.val)}
                            className={`py-1 px-1 rounded text-[10px] border transition-colors truncate ${
                              normalizationPeak === preset.val
                                ? 'bg-amber-500/20 border-amber-500/50 text-amber-200 font-semibold'
                                : 'bg-zinc-800/80 border-zinc-700/60 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="text-[10px] text-zinc-400 leading-relaxed bg-zinc-900/60 p-2 rounded-lg border border-zinc-800/80">
                      💡 Громкость голоса нормализуется до <strong className="text-indigo-300">{normalizationLevel} LUFS</strong>, а самый громкий пик гарантированно не превысит <strong className="text-amber-300">{normalizationPeak} dB</strong> (True Peak).
                    </div>
                  </>
                ) : (
                  <>
                    {/* Peak Level Slider & Presets */}
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[11px] text-zinc-300 font-medium">Целевой уровень самого громкого пика:</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={-18}
                            max={-0.5}
                            step={0.5}
                            value={normalizationPeak}
                            onChange={e => handlePeakChange(Number(e.target.value))}
                            className="w-14 bg-zinc-900 border border-amber-700/50 rounded px-1.5 py-0.5 text-[11px] font-mono text-amber-300 text-right focus:outline-none focus:border-amber-500"
                          />
                          <span className="text-[11px] font-mono text-amber-400">dBFS</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={-18}
                        max={-0.5}
                        step={0.5}
                        value={normalizationPeak}
                        onChange={e => handlePeakChange(Number(e.target.value))}
                        className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                      />
                      <div className="grid grid-cols-4 gap-1 mt-2">
                        {[
                          { label: '-9 dB (По умолч.)', val: -9 },
                          { label: '-6 dB', val: -6 },
                          { label: '-3 dB', val: -3 },
                          { label: '-0.5 dB', val: -0.5 },
                        ].map(preset => (
                          <button
                            key={preset.val}
                            type="button"
                            onClick={() => handlePeakChange(preset.val)}
                            className={`py-1 px-1 rounded text-[10px] border transition-colors truncate ${
                              normalizationPeak === preset.val
                                ? 'bg-amber-500/20 border-amber-500/50 text-amber-200 font-semibold'
                                : 'bg-zinc-800/80 border-zinc-700/60 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="text-[10px] text-zinc-400 leading-relaxed bg-zinc-900/60 p-2 rounded-lg border border-zinc-800/80">
                      💡 Дорожка будет пропорционально масштабирована так, чтобы её максимальный пик составил ровно <strong className="text-amber-300">{normalizationPeak} dBFS</strong>.
                    </div>
                  </>
                )}
              </div>
            )}
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
              <span>Включить оригинальное аудио из видео</span>
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
