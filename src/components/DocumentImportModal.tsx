import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  X, 
  Upload, 
  Clock, 
  Sliders, 
  CheckCircle2, 
  Sparkles, 
  HelpCircle,
  AlignLeft
} from 'lucide-react';
import { motion } from 'framer-motion';
import { SubtitleLine } from '../types';
import { TextImportService } from '../services/textImportService';
import { UniversalParserService } from '../services/UniversalParserService';

interface DocumentImportModalProps {
  isDesktop: boolean;
  projectDuration?: number;
  onClose: () => void;
  onImportDocument: (data: {
    filePath?: string;
    fileName?: string;
    fileContent?: string;
    subtitles: SubtitleLine[];
    defaultRole: string;
  }) => void;
}

export const DocumentImportModal: React.FC<DocumentImportModalProps> = ({
  isDesktop,
  projectDuration = 60,
  onClose,
  onImportDocument
}) => {
  const [filePath, setFilePath] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [fileContent, setFileContent] = useState<string>('');
  const [pastedText, setPastedText] = useState<string>('');
  const [activeSourceTab, setActiveSourceTab] = useState<'file' | 'text'>('file');

  // Distribution settings
  const [distributionMode, setDistributionMode] = useState<'fixed' | 'char_count' | 'fit_duration'>('char_count');
  const [fixedSeconds, setFixedSeconds] = useState<number>(5);
  const [charsPerSecond, setCharsPerSecond] = useState<number>(15);
  const [pauseSeconds, setPauseSeconds] = useState<number>(0.5);
  const [defaultRole, setDefaultRole] = useState<string>('Narrator');
  const [targetDuration, setTargetDuration] = useState<number>(projectDuration || 60);

  const [previewLines, setPreviewLines] = useState<SubtitleLine[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // File selection
  const handleSelectFile = async () => {
    if (!window.electronAPI) return;
    try {
      const res = await window.electronAPI.openFile({
        title: 'Выберите документ с текстом',
        filters: [
          { name: 'Documents & Scripts', extensions: ['txt', 'docx', 'pdf', 'fb2', 'csv', 'ass', 'srt', 'vtt'] }
        ]
      });
      if (res.success && res.data) {
        const data = res.data as any;
        const path = typeof data === 'string' ? data : (data.path || '');
        const name = typeof data === 'string' ? (data.split(/[/\\]/).pop() || data) : (data.name || data.path || '');
        setFilePath(path);
        setFileName(name);

        const readRes = await window.electronAPI.readTextFile(path);
        if (readRes.success && readRes.data) {
          setFileContent(readRes.data);
        } else if (typeof data === 'object' && data.content) {
          setFileContent(data.content);
        }
      }
    } catch (err) {
      console.error('Failed to select file:', err);
    }
  };

  // Re-calculate timing preview whenever content or settings change
  useEffect(() => {
    const rawText = activeSourceTab === 'file' ? fileContent : pastedText;
    if (!rawText.trim()) {
      setPreviewLines([]);
      return;
    }

    try {
      // First parse base text into lines/segments
      const parsed = TextImportService.parseRawText(rawText);
      if (parsed.length === 0) {
        setPreviewLines([]);
        return;
      }

      let currentTime = 0;
      let totalTextChars = parsed.reduce((sum, item) => sum + item.text.length, 0);

      const processed: SubtitleLine[] = parsed.map((item, idx) => {
        let segDuration = 5;

        if (distributionMode === 'fixed') {
          segDuration = Math.max(1, fixedSeconds);
        } else if (distributionMode === 'char_count') {
          const charLen = item.text.replace(/\[.*?\]/g, '').trim().length || 15;
          segDuration = Math.max(1.5, Math.round((charLen / Math.max(1, charsPerSecond)) * 10) / 10);
        } else if (distributionMode === 'fit_duration') {
          if (totalTextChars > 0 && targetDuration > 0) {
            const charLen = item.text.replace(/\[.*?\]/g, '').trim().length || 15;
            const ratio = charLen / totalTextChars;
            const availableDuration = Math.max(10, targetDuration - (parsed.length * pauseSeconds));
            segDuration = Math.max(1, Math.round((ratio * availableDuration) * 10) / 10);
          } else {
            segDuration = Math.max(1, Math.round((targetDuration / parsed.length) * 10) / 10);
          }
        }

        const startTime = currentTime;
        const endTime = startTime + segDuration;
        currentTime = endTime + pauseSeconds;

        return {
          ...item,
          start: Math.round(startTime * 100) / 100,
          end: Math.round(endTime * 100) / 100,
          role: item.role && item.role !== 'Unknown' ? item.role : defaultRole
        };
      });

      setPreviewLines(processed);
    } catch (e) {
      console.error('Error generating preview lines:', e);
    }
  }, [fileContent, pastedText, activeSourceTab, distributionMode, fixedSeconds, charsPerSecond, pauseSeconds, defaultRole, targetDuration]);

  const handleApplyImport = () => {
    if (previewLines.length === 0) {
      alert('Нет реплик для импорта. Выберите файл или вставьте текст.');
      return;
    }

    onImportDocument({
      filePath: activeSourceTab === 'file' ? filePath : undefined,
      fileName: activeSourceTab === 'file' ? fileName : 'Импортированный документ',
      fileContent: activeSourceTab === 'file' ? fileContent : pastedText,
      subtitles: previewLines,
      defaultRole
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-zinc-900 border border-white/10 rounded-2xl max-w-2xl w-full p-6 shadow-2xl relative my-auto max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/20 text-blue-400 rounded-xl border border-blue-500/30">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Импорт текстового документа</h2>
              <p className="text-xs text-zinc-400">Настройка распределения текста реплик по времени</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors text-zinc-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Source Tabs */}
        <div className="flex items-center gap-2 mt-4 bg-zinc-800/60 p-1 rounded-xl border border-white/5 shrink-0">
          <button
            onClick={() => setActiveSourceTab('file')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
              activeSourceTab === 'file' ? 'bg-blue-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Upload className="w-4 h-4" />
            Выбрать файл (.txt, .docx, .pdf, .fb2)
          </button>
          <button
            onClick={() => setActiveSourceTab('text')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
              activeSourceTab === 'text' ? 'bg-blue-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <AlignLeft className="w-4 h-4" />
            Вставить текст вручную
          </button>
        </div>

        <div className="space-y-4 my-4 overflow-y-auto custom-scrollbar pr-1 flex-1">
          {/* Source Input */}
          {activeSourceTab === 'file' ? (
            <div className="p-4 bg-zinc-800/40 rounded-xl border border-white/5 flex items-center justify-between gap-4">
              <div className="truncate flex-1">
                <div className="text-xs text-zinc-400 mb-1">Файл документа:</div>
                <div className="text-sm font-semibold text-white truncate">
                  {fileName || 'Файл не выбран'}
                </div>
              </div>
              <button
                onClick={handleSelectFile}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all shrink-0 flex items-center gap-2"
              >
                <Upload className="w-4 h-4" />
                Обзор...
              </button>
            </div>
          ) : (
            <div>
              <label className="text-xs text-zinc-400 block mb-1.5 font-medium">Текст документа:</label>
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Вставьте текст скрипта или сценария сюда..."
                rows={4}
                className="w-full bg-zinc-800/60 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-all font-mono"
              />
            </div>
          )}

          {/* Time Distribution Strategy */}
          <div className="p-4 bg-zinc-800/30 rounded-xl border border-white/5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-blue-300 uppercase tracking-wider">
              <Clock className="w-4 h-4" />
              Способ распределения текста по времени
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                onClick={() => setDistributionMode('char_count')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  distributionMode === 'char_count' 
                    ? 'bg-blue-600/20 border-blue-500/50 text-white' 
                    : 'bg-zinc-800/50 border-white/5 text-zinc-400 hover:text-white'
                }`}
              >
                <div className="text-xs font-bold mb-1">По длине текста</div>
                <div className="text-[10px] text-zinc-400 leading-relaxed">
                  Длительность реплик рассчитывается пропорционально символам (~15 символов = 1с)
                </div>
              </button>

              <button
                onClick={() => setDistributionMode('fixed')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  distributionMode === 'fixed' 
                    ? 'bg-blue-600/20 border-blue-500/50 text-white' 
                    : 'bg-zinc-800/50 border-white/5 text-zinc-400 hover:text-white'
                }`}
              >
                <div className="text-xs font-bold mb-1">Фиксированный шаг</div>
                <div className="text-[10px] text-zinc-400 leading-relaxed">
                  Каждая реплика получает ровно одинаковую длительность (например 5 секунд)
                </div>
              </button>

              <button
                onClick={() => setDistributionMode('fit_duration')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  distributionMode === 'fit_duration' 
                    ? 'bg-blue-600/20 border-blue-500/50 text-white' 
                    : 'bg-zinc-800/50 border-white/5 text-zinc-400 hover:text-white'
                }`}
              >
                <div className="text-xs font-bold mb-1">Под хронометраж</div>
                <div className="text-[10px] text-zinc-400 leading-relaxed">
                  Все реплики равномерно растягиваются под общую длительность видео
                </div>
              </button>
            </div>

            {/* Options based on selected mode */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              {distributionMode === 'fixed' && (
                <div>
                  <label className="text-[11px] text-zinc-400 block mb-1">Длительность реплики (сек):</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={typeof fixedSeconds === 'number' && !isNaN(fixedSeconds) ? fixedSeconds : ''}
                    onChange={(e) => setFixedSeconds(Number(e.target.value))}
                    className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              {distributionMode === 'char_count' && (
                <div>
                  <label className="text-[11px] text-zinc-400 block mb-1">Скорость чтения (символов в сек):</label>
                  <input
                    type="number"
                    min={5}
                    max={40}
                    value={typeof charsPerSecond === 'number' && !isNaN(charsPerSecond) ? charsPerSecond : ''}
                    onChange={(e) => setCharsPerSecond(Number(e.target.value))}
                    className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              {distributionMode === 'fit_duration' && (
                <div>
                  <label className="text-[11px] text-zinc-400 block mb-1">Целевая длительность (сек):</label>
                  <input
                    type="number"
                    min={10}
                    value={typeof targetDuration === 'number' && !isNaN(targetDuration) ? targetDuration : ''}
                    onChange={(e) => setTargetDuration(Number(e.target.value))}
                    className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              <div>
                <label className="text-[11px] text-zinc-400 block mb-1">Пауза между репликами (сек):</label>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={10}
                  value={typeof pauseSeconds === 'number' && !isNaN(pauseSeconds) ? pauseSeconds : ''}
                  onChange={(e) => setPauseSeconds(Number(e.target.value))}
                  className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-[11px] text-zinc-400 block mb-1">Роль по умолчанию:</label>
                <input
                  type="text"
                  value={defaultRole}
                  onChange={(e) => setDefaultRole(e.target.value)}
                  placeholder="Narrator"
                  className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Preview list */}
          {previewLines.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-zinc-300">Предпросмотр сегментов ({previewLines.length} шт):</span>
                <span className="text-[10px] text-zinc-400 font-mono">
                  Общий хронометраж: {previewLines[previewLines.length - 1]?.end || 0}s
                </span>
              </div>
              <div className="max-h-36 overflow-y-auto bg-zinc-950/60 rounded-xl border border-white/5 p-2 space-y-1.5 font-mono text-[11px]">
                {previewLines.slice(0, 10).map((line, idx) => (
                  <div key={idx} className="flex items-start gap-2 bg-zinc-900/60 p-1.5 rounded border border-white/5">
                    <span className="text-blue-400 font-bold shrink-0">
                      [{line.start.toFixed(1)}s - {line.end.toFixed(1)}s]
                    </span>
                    <span className="text-amber-400 shrink-0 font-bold">[{line.role}]</span>
                    <span className="text-zinc-300 truncate flex-1">{line.text}</span>
                  </div>
                ))}
                {previewLines.length > 10 && (
                  <div className="text-[10px] text-zinc-500 text-center py-1">
                    ... и ещё {previewLines.length - 10} реплик
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10 shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold transition-all"
          >
            Отмена
          </button>
          <button
            onClick={handleApplyImport}
            disabled={previewLines.length === 0}
            className={`px-6 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              previewLines.length > 0 
                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30' 
                : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            Импортировать ({previewLines.length} реплик)
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default DocumentImportModal;
