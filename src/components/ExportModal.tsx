import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Download, Video, AudioLines, FileAudio } from 'lucide-react';

export const ExportModal = ({ 
  onExport, 
  onCancel,
  initialFormat = 'WAV'
}: { 
  onExport: (options: { 
    format: 'WAV' | 'MP3' | 'FLAC', 
    includeVideo: boolean, 
    includeOriginalAudio: boolean,
    forceMono: boolean
  }) => void, 
  onCancel: () => void,
  initialFormat?: 'WAV' | 'MP3' | 'FLAC'
}) => {
  const [format, setFormat] = useState<'WAV' | 'MP3' | 'FLAC'>(initialFormat);
  const [includeVideo, setIncludeVideo] = useState(false);
  const [includeOriginalAudio, setIncludeOriginalAudio] = useState(false);
  const [forceMono, setForceMono] = useState(true);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-[100]">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-zinc-900 border border-white/10 p-8 rounded-2xl shadow-2xl w-96"
      >
        <h3 className="text-xl font-bold mb-6 text-white">Настройки экспорта</h3>
        
        <div className="space-y-4 mb-8">
          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Формат</label>
            <div className="flex gap-2">
              {(['WAV', 'MP3', 'FLAC'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-sm font-medium transition-colors",
                    format === f ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-3 text-sm text-zinc-300 cursor-pointer">
              <input 
                type="checkbox" 
                checked={includeVideo} 
                onChange={e => setIncludeVideo(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-800 text-indigo-500 focus:ring-indigo-500"
              />
              <Video className="w-4 h-4" /> Включить видеодорожку
            </label>
            
            <label className="flex items-center gap-3 text-sm text-zinc-300 cursor-pointer">
              <input 
                type="checkbox" 
                checked={includeOriginalAudio} 
                onChange={e => setIncludeOriginalAudio(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-800 text-indigo-500 focus:ring-indigo-500"
              />
              <AudioLines className="w-4 h-4" /> Включить аудио из видео
            </label>

            <label className="flex items-center gap-3 text-sm text-zinc-300 cursor-pointer">
              <input 
                type="checkbox" 
                checked={forceMono} 
                onChange={e => setForceMono(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-800 text-indigo-500 focus:ring-indigo-500"
              />
              <FileAudio className="w-4 h-4" /> Дублировать в оба канала (Моно)
            </label>
          </div>
        </div>

        <div className="flex gap-3">
          <button 
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
          >
            Отмена
          </button>
          <button 
            onClick={() => onExport({ format, includeVideo, includeOriginalAudio, forceMono })}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
          >
            Экспорт
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default ExportModal;

// Helper for cn
function cn(...classes: string[]) {
  return classes.filter(Boolean).join(' ');
}
