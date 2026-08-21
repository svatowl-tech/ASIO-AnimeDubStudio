import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Mic, FileVideo, FileAudio, FileText, Clipboard, X, Upload, Sparkles, User } from 'lucide-react';

interface CastingImportModalProps {
  onClose: () => void;
  onImportCasting: (data: {
    mediaPath?: string;
    mediaFile?: File;
    textSourceType: 'subtitles_file' | 'text_file' | 'clipboard' | 'none';
    textFilePath?: string;
    textFileContent?: string;
    clipboardText?: string;
    dubberNick?: string;
    roleName?: string;
  }) => Promise<void>;
  isDesktop?: boolean;
}

export const CastingImportModal: React.FC<CastingImportModalProps> = ({
  onClose,
  onImportCasting,
  isDesktop = true
}) => {
  const [mediaPath, setMediaPath] = useState<string>('');
  const [mediaFileName, setMediaFileName] = useState<string>('');
  const [mediaType, setMediaType] = useState<'audio' | 'video' | 'none'>('none');
  const [browserFile, setBrowserFile] = useState<File | null>(null);

  const [textSourceType, setTextSourceType] = useState<'subtitles_file' | 'text_file' | 'clipboard' | 'none'>('clipboard');
  const [textFilePath, setTextFilePath] = useState<string>('');
  const [textFileName, setTextFileName] = useState<string>('');
  const [textFileContent, setTextFileContent] = useState<string>('');
  const [clipboardText, setClipboardText] = useState<string>('');

  const [dubberNick, setDubberNick] = useState<string>('');
  const [roleName, setRoleName] = useState<string>('Кастинг');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    const savedNick = localStorage.getItem('dubstudio_dubber_nick');
    if (savedNick) setDubberNick(savedNick);
  }, []);

  // Select Media file (Audio or Video)
  const handleSelectMedia = async () => {
    if (window.electronAPI) {
      const res = await window.electronAPI.openFile({
        title: 'Выбрать медиафайл для кастинга (Аудио или Видео)',
        filters: [
          { name: 'Медиафайлы (Аудио / Видео)', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'mp4', 'mkv', 'avi', 'mov', 'webm'] },
          { name: 'Аудиофайлы', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'] },
          { name: 'Видеофайлы', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm'] }
        ]
      });
      if (res.success && res.data) {
        const data = res.data as any;
        const filePath: string = typeof data === 'string' ? data : (data.path || '');
        const name: string = typeof data === 'string' ? (data.split(/[/\\]/).pop() || data) : (data.name || data.path || '');
        setMediaPath(filePath);
        setMediaFileName(name);

        const ext = name.split('.').pop()?.toLowerCase() || '';
        if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'].includes(ext)) {
          setMediaType('audio');
        } else {
          setMediaType('video');
        }
      }
    }
  };

  // Select Text / Subtitles file
  const handleSelectTextFile = async () => {
    if (window.electronAPI) {
      const res = await window.electronAPI.openFile({
        title: 'Выбрать файл субтитров или текста',
        filters: [
          { name: 'Текст / Субтитры', extensions: ['srt', 'vtt', 'ass', 'txt', 'docx', 'pdf', 'csv', 'fb2'] }
        ]
      });
      if (res.success && res.data) {
        const data = res.data as any;
        const filePath: string = typeof data === 'string' ? data : (data.path || '');
        const name: string = typeof data === 'string' ? (data.split(/[/\\]/).pop() || data) : (data.name || data.path || '');
        setTextFilePath(filePath);
        setTextFileName(name);

        const readRes = await window.electronAPI.readTextFile(filePath);
        if (readRes.success && readRes.data) {
          setTextFileContent(readRes.data);
        }
      }
    }
  };

  // Paste from Clipboard
  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setClipboardText(text);
      }
    } catch (e) {
      console.warn('Cannot read clipboard:', e);
    }
  };

  const handleSubmit = async () => {
    if (!mediaPath && !browserFile) {
      alert('Пожалуйста, выберите медиафайл (Аудио или Видео) для кастинга.');
      return;
    }

    if (dubberNick.trim()) {
      localStorage.setItem('dubstudio_dubber_nick', dubberNick.trim());
    }

    setIsSubmitting(true);
    try {
      await onImportCasting({
        mediaPath,
        mediaFile: browserFile || undefined,
        textSourceType,
        textFilePath,
        textFileContent,
        clipboardText,
        dubberNick: dubberNick.trim(),
        roleName: roleName.trim()
      });
      onClose();
    } catch (err) {
      console.error('Error importing casting:', err);
      alert('Ошибка при импорте кастинга.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl max-w-xl w-full p-6 space-y-6 overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600/20 border border-indigo-500/30 rounded-xl flex items-center justify-center text-indigo-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Импорт кастинга</h2>
              <p className="text-xs text-zinc-400">Кастинг по аудио/видео с опциональным текстом или субтитрами</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 1. Media Source Selection */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
            <Upload className="w-4 h-4 text-indigo-400" />
            1. Выберите медиафайл (Аудио или Видео)
          </label>
          <div className="flex items-center gap-3 bg-zinc-800/60 p-3 rounded-xl border border-white/5">
            <div className="flex-1 truncate">
              {mediaFileName ? (
                <div className="flex items-center gap-2">
                  {mediaType === 'audio' ? (
                    <FileAudio className="w-5 h-5 text-amber-400 shrink-0" />
                  ) : (
                    <FileVideo className="w-5 h-5 text-indigo-400 shrink-0" />
                  )}
                  <div className="truncate">
                    <p className="text-xs font-bold text-white truncate">{mediaFileName}</p>
                    <p className="text-[10px] text-zinc-400 uppercase font-semibold">{mediaType === 'audio' ? 'Аудиофайл' : 'Видеофайл'}</p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-zinc-500 italic">Файл не выбран...</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleSelectMedia}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all shadow-md shadow-indigo-600/20 whitespace-nowrap"
            >
              {mediaFileName ? 'Изменить...' : 'Обзор...'}
            </button>
          </div>
        </div>

        {/* 2. Text / Subtitles Source Selection */}
        <div className="space-y-3">
          <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
            <FileText className="w-4 h-4 text-purple-400" />
            2. Источник текста / субтитров (Опционально)
          </label>

          <div className="grid grid-cols-3 gap-2 p-1 bg-zinc-800/80 rounded-xl border border-white/5">
            <button
              type="button"
              onClick={() => setTextSourceType('clipboard')}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                textSourceType === 'clipboard' ? 'bg-purple-600 text-white shadow-md' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Clipboard className="w-3.5 h-3.5" />
              Буфер
            </button>
            <button
              type="button"
              onClick={() => setTextSourceType('subtitles_file')}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                textSourceType === 'subtitles_file' ? 'bg-purple-600 text-white shadow-md' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Из файла
            </button>
            <button
              type="button"
              onClick={() => setTextSourceType('none')}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                textSourceType === 'none' ? 'bg-purple-600 text-white shadow-md' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Без текста
            </button>
          </div>

          {textSourceType === 'clipboard' && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-zinc-400">Вставьте реплики / текст кастинга:</span>
                <button
                  type="button"
                  onClick={handlePasteClipboard}
                  className="text-[10px] text-purple-400 hover:text-purple-300 font-bold flex items-center gap-1"
                >
                  <Clipboard className="w-3 h-3" />
                  Вставить из буфера
                </button>
              </div>
              <textarea
                value={clipboardText}
                onChange={e => setClipboardText(e.target.value)}
                placeholder="Вставьте текст или список реплик..."
                rows={3}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-purple-500 font-mono resize-none"
              />
            </div>
          )}

          {textSourceType === 'subtitles_file' && (
            <div className="flex items-center gap-3 bg-zinc-800/60 p-3 rounded-xl border border-white/5">
              <div className="flex-1 truncate">
                {textFileName ? (
                  <p className="text-xs font-bold text-white truncate">{textFileName}</p>
                ) : (
                  <p className="text-xs text-zinc-500 italic">Файл субтитров / текста не выбран...</p>
                )}
              </div>
              <button
                type="button"
                onClick={handleSelectTextFile}
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg text-xs font-bold transition-colors"
              >
                {textFileName ? 'Изменить' : 'Обзор...'}
              </button>
            </div>
          )}
        </div>

        {/* 3. Dubber Nick & Role */}
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/10">
          <div>
            <label className="block text-xs font-bold text-zinc-400 mb-1 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-indigo-400" />
              Ник даббера
            </label>
            <input
              type="text"
              value={dubberNick}
              onChange={e => setDubberNick(e.target.value)}
              placeholder="Напр. Volodarsky"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-400 mb-1 flex items-center gap-1.5">
              <Mic className="w-3.5 h-3.5 text-amber-400" />
              Роль / Персонаж
            </label>
            <input
              type="text"
              value={roleName}
              onChange={e => setRoleName(e.target.value)}
              placeholder="Напр. Главный герой"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 pt-4 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white transition-all"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || (!mediaPath && !browserFile)}
            className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            {isSubmitting ? 'Создание...' : 'Запустить кастинг'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default CastingImportModal;
