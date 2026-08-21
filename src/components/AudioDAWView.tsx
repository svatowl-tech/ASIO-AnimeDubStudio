import React, { useEffect, useState } from 'react';
import { Mic, Music, Video, FileText, Plus, Disc, Volume2 } from 'lucide-react';
import { Project } from '../types';

interface AudioDAWViewProps {
  project: Project;
  isPlaying: boolean;
  isRecording: boolean;
  currentTime: number;
  onSelectVideo: () => void;
  onImportAudioTrack: () => void;
  onImportSubtitles: () => void;
  onAddTrack: () => void;
}

export const AudioDAWView: React.FC<AudioDAWViewProps> = ({
  project,
  isPlaying,
  isRecording,
  currentTime,
  onSelectVideo,
  onImportAudioTrack,
  onImportSubtitles,
  onAddTrack,
}) => {
  // Generate mock spectrum bars
  const [bars, setBars] = useState<number[]>(new Array(24).fill(15));

  useEffect(() => {
    if (!isPlaying && !isRecording) {
      // Idle state: minor ambient movement
      const interval = setInterval(() => {
        setBars(prev => prev.map(() => Math.floor(Math.random() * 15) + 8));
      }, 300);
      return () => clearInterval(interval);
    } else if (isRecording) {
      // Recording state: energetic but controlled red/orange pulse
      const interval = setInterval(() => {
        setBars(prev => prev.map(() => Math.floor(Math.random() * 55) + 15));
      }, 100);
      return () => clearInterval(interval);
    } else {
      // Playing state: full dynamic audio spectrum
      const interval = setInterval(() => {
        setBars(prev => prev.map(() => Math.floor(Math.random() * 85) + 10));
      }, 80);
      return () => clearInterval(interval);
    }
  }, [isPlaying, isRecording]);

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    const ms = Math.floor((time % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  return (
    <div id="audio-daw-view-container" className="w-full h-full flex flex-col items-center justify-center p-8 bg-zinc-950 text-white relative select-none overflow-y-auto">
      {/* Decorative subtle grid background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f1f23_1px,transparent_1px),linear-gradient(to_bottom,#1f1f23_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-30 pointer-events-none" />

      <div className="max-w-2xl w-full flex flex-col items-center gap-8 relative z-10">
        
        {/* Top Status Header */}
        <div className="flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 mb-3">
            <span className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : isPlaying ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`} />
            {isRecording ? 'ЗАПИСЬ ЗВУКА' : isPlaying ? 'ВОСПРОИЗВЕДЕНИЕ' : 'РЕЖИМ АУДИОСТУДИИ'}
          </div>
          <h2 className="text-2xl font-black tracking-tight bg-gradient-to-r from-zinc-100 via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
            {project.name}
          </h2>
          <p className="text-xs text-zinc-500 mt-1 max-w-sm">
            Проект запущен в режиме звукозаписи и аудиомонтажа без видео. Все функции записи и микширования активны.
          </p>
        </div>

        {/* Central Visualizer Block */}
        <div className="w-full bg-zinc-900/40 border border-zinc-800/80 rounded-3xl p-6 flex flex-col items-center justify-center shadow-2xl relative overflow-hidden backdrop-blur-md">
          {/* Subtle reflection overlay */}
          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent pointer-events-none" />

          {/* Timecode counter */}
          <div className="font-mono text-4xl font-extrabold tracking-wider text-zinc-300 mb-8 select-all select-none">
            {formatTime(currentTime)}
          </div>

          {/* Graphical Spectrum Waveform */}
          <div className="h-24 w-full flex items-end justify-center gap-[3px] px-4">
            {bars.map((height, idx) => (
              <div
                key={idx}
                className="w-2.5 rounded-full transition-all duration-100 ease-out"
                style={{
                  height: `${height}%`,
                  background: isRecording
                    ? 'linear-gradient(to top, #ef4444, #f97316)'
                    : isPlaying
                    ? 'linear-gradient(to top, #6366f1, #a855f7)'
                    : 'linear-gradient(to top, #3f3f46, #71717a)'
                }}
              />
            ))}
          </div>

          {/* Active Record Indicator */}
          {isRecording && (
            <div className="absolute top-4 right-4 flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-950 border border-red-500/30 text-[10px] font-bold text-red-400 tracking-widest animate-pulse">
              <Disc className="w-3 h-3 animate-spin" /> REC
            </div>
          )}
        </div>

        {/* Modular Action Dashboard */}
        <div className="w-full grid grid-cols-2 gap-3">
          <button
            id="daw-import-audio-track-btn"
            onClick={onImportAudioTrack}
            className="flex items-center gap-3 p-4 bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-2xl text-left transition-all active:scale-98 group"
          >
            <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-xl group-hover:bg-indigo-500/20 group-hover:scale-105 transition-all">
              <Music className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-zinc-200">Импорт аудио</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">Добавить аудиодорожку</div>
            </div>
          </button>

          <button
            id="daw-add-empty-track-btn"
            onClick={onAddTrack}
            className="flex items-center gap-3 p-4 bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-2xl text-left transition-all active:scale-98 group"
          >
            <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl group-hover:bg-emerald-500/20 group-hover:scale-105 transition-all">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-zinc-200">Новая дорожка</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">Создать пустой трек</div>
            </div>
          </button>

          <button
            id="daw-import-subtitles-btn"
            onClick={onImportSubtitles}
            className="flex items-center gap-3 p-4 bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-2xl text-left transition-all active:scale-98 group"
          >
            <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl group-hover:bg-amber-500/20 group-hover:scale-105 transition-all">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-zinc-200">Субтитры</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">Импортировать текст / SRT</div>
            </div>
          </button>

          <button
            id="daw-add-video-btn"
            onClick={onSelectVideo}
            className="flex items-center gap-3 p-4 bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-2xl text-left transition-all active:scale-98 group"
          >
            <div className="p-3 bg-pink-500/10 text-pink-400 rounded-xl group-hover:bg-pink-500/20 group-hover:scale-105 transition-all">
              <Video className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-zinc-200">Добавить видео</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">Привязать видеофайл</div>
            </div>
          </button>
        </div>

      </div>
    </div>
  );
};
