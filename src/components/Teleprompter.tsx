import React, { useState, useRef, useEffect } from 'react';
import { Minus, Plus, ArrowUp, ArrowDown, GripHorizontal } from 'lucide-react';
import { cn } from '../lib/utils';
import { SubtitleLine, TeleprompterMode } from '../types';
import { TeleprompterDockControls } from './teleprompter/TeleprompterDockControls';
import { TeleprompterResizer } from './teleprompter/TeleprompterResizer';
import { saveTeleprompterPref } from './teleprompter/useTeleprompterLayout';

export const Teleprompter = ({ 
  subtitles, 
  currentTime, 
  mode = 'compact',
  fontSize,
  lineHeight,
  pacing,
  activeRole,
  dragControls,
  onFontSizeChange,
  onLineHeightChange,
  onPacingChange,
  onModeChange,
  onResize,
  onSeek
}: { 
  subtitles: SubtitleLine[], 
  currentTime: number,
  mode?: TeleprompterMode,
  fontSize: number,
  lineHeight: number,
  pacing: 'auto' | 'manual',
  activeRole: string,
  dragControls?: any,
  onFontSizeChange: (size: number) => void,
  onLineHeightChange: (height: number) => void,
  onPacingChange: (pacing: 'auto' | 'manual') => void,
  onModeChange: (mode: TeleprompterMode) => void,
  onResize?: (width: number, height: number) => void,
  onSeek?: (time: number) => void
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [manualOffset, setManualOffset] = useState(0);
  const [userInteracting, setUserInteracting] = useState(false);
  const interactionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const activeLine = (subtitles || []).find(
    s => currentTime >= s.start && currentTime <= s.end && (!activeRole || s.role === activeRole)
  );
  const nextActiveLine = (subtitles || []).find(
    s => s.start > currentTime && (!activeRole || s.role === activeRole)
  );

  const handleInteraction = () => {
    setUserInteracting(true);
    if (interactionTimeoutRef.current) clearTimeout(interactionTimeoutRef.current);
    interactionTimeoutRef.current = setTimeout(() => {
      setUserInteracting(false);
    }, 2000);
  };

  const timeToNext = nextActiveLine ? Math.max(0, nextActiveLine.start - currentTime) : null;

  const activeLineIdRef = useRef<string | null>(null);
  const targetId = activeLine?.id || nextActiveLine?.id || null;

  // Auto-scroll logic (Optimized: trigger scroll only when active segment target ID changes)
  useEffect(() => {
    if (pacing === 'auto' && scrollRef.current && !userInteracting && targetId) {
      if (targetId !== activeLineIdRef.current) {
        activeLineIdRef.current = targetId;
        setTimeout(() => {
          const element = document.getElementById(`tp-line-${targetId}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 50);
      }
    } else if (!targetId) {
      activeLineIdRef.current = null;
    }
  }, [targetId, pacing, userInteracting]);

  // Handle keyboard pacing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (pacing === 'manual') {
        if (e.key === 'ArrowDown') setManualOffset(prev => prev + 20);
        if (e.key === 'ArrowUp') setManualOffset(prev => Math.max(0, prev - 20));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pacing]);

  const handleWheel = (e: WheelEvent) => {
    if (pacing === 'manual') {
      e.preventDefault();
      setManualOffset(prev => Math.max(0, prev + e.deltaY));
    }
  };

  useEffect(() => {
    const container = scrollRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel as any, { passive: false });
      return () => container.removeEventListener('wheel', handleWheel as any);
    }
  }, [pacing]);

  // Find current line index (for optimization/virtualization)
  const currentLineIndex = (subtitles || []).findIndex(
    s => currentTime >= s.start && currentTime <= s.end && (!activeRole || s.role === activeRole)
  );
  
  let targetIndex = currentLineIndex;
  if (targetIndex === -1 && nextActiveLine) {
    targetIndex = (subtitles || []).findIndex(s => s.id === nextActiveLine.id);
  }
  if (targetIndex === -1) {
    targetIndex = 0;
  }

  // Windowed subtitles slice for peak performance
  const visibleSubtitles = (subtitles || []).slice(
    Math.max(0, targetIndex - 8),
    Math.min((subtitles || []).length, targetIndex + 14)
  );

  const isDockedVertical = mode === 'left' || mode === 'right';

  const handleModeSelect = (newMode: TeleprompterMode) => {
    onModeChange(newMode);
    saveTeleprompterPref({ mode: newMode });
  };

  return (
    <div 
      ref={containerRef}
      className={cn(
        "relative w-full h-full flex flex-col pointer-events-auto select-none overflow-hidden transition-colors",
        mode === 'expanded' && "bg-black/80 backdrop-blur-md p-6",
        mode === 'left' && "bg-zinc-950/92 backdrop-blur-lg border-r border-white/15 shadow-[10px_0_30px_rgba(0,0,0,0.8)]",
        mode === 'right' && "bg-zinc-950/92 backdrop-blur-lg border-l border-white/15 shadow-[-10px_0_30px_rgba(0,0,0,0.8)]",
        mode === 'bottom' && "bg-zinc-950/92 backdrop-blur-lg border-t border-white/15 shadow-[0_-10px_30px_rgba(0,0,0,0.8)]",
        mode === 'compact' && "bg-zinc-950/90 backdrop-blur-lg border border-white/15 rounded-2xl shadow-2xl"
      )}
    >
      {/* Controls Top Header Bar */}
      <div 
        className={cn(
          "shrink-0 flex items-center justify-between gap-2 p-2 bg-black/50 border-b border-white/10 z-20 flex-wrap select-none",
          isDockedVertical ? "gap-y-2" : "",
          mode === 'compact' ? "cursor-grab active:cursor-grabbing" : ""
        )}
        style={mode === 'compact' ? { touchAction: 'none' } : undefined}
        onPointerDown={(e) => {
          if (mode === 'compact' && dragControls) {
            dragControls.start(e);
          }
        }}
      >
        {/* Left side: Dock controls + Drag grip */}
        <div className="flex items-center gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
          {mode === 'compact' && (
            <div 
              className="p-1 text-zinc-500 hover:text-zinc-300 cursor-grab active:cursor-grabbing flex items-center"
              onPointerDown={(e) => {
                e.stopPropagation();
                dragControls?.start(e);
              }}
              title="Зажмите и перетащите для перемещения окна"
            >
              <GripHorizontal className="w-4 h-4" />
            </div>
          )}
          <TeleprompterDockControls 
            mode={mode} 
            onModeChange={handleModeSelect} 
          />
          {timeToNext !== null && (
            <div className="hidden sm:inline-flex bg-indigo-900/50 text-indigo-300 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold whitespace-nowrap border border-indigo-500/20">
              Далее: {timeToNext.toFixed(1)}с
            </div>
          )}
        </div>

        {/* Right side: Font, Line Height, Pacing */}
        <div className="flex items-center gap-1.5 flex-wrap" onPointerDown={(e) => e.stopPropagation()}>
          {/* Font Size Stepper */}
          <div className="flex items-center bg-black/60 rounded-lg p-0.5 border border-white/10">
            <button 
              type="button"
              onClick={() => onFontSizeChange(Math.max(12, fontSize - 2))} 
              className="p-1 hover:bg-white/10 rounded text-white/70 hover:text-white transition-colors cursor-pointer"
              title="Уменьшить шрифт"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="flex items-center px-1.5 text-[10px] font-mono font-bold text-white/80 w-8 justify-center">
              {fontSize}
            </span>
            <button 
              type="button"
              onClick={() => onFontSizeChange(Math.min(120, fontSize + 2))} 
              className="p-1 hover:bg-white/10 rounded text-white/70 hover:text-white transition-colors cursor-pointer"
              title="Увеличить шрифт"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
          
          {/* Line Height Stepper */}
          <div className="flex items-center bg-black/60 rounded-lg p-0.5 border border-white/10">
            <button 
              type="button"
              onClick={() => onLineHeightChange(Math.max(1, Number((lineHeight - 0.1).toFixed(1))))} 
              className="p-1 hover:bg-white/10 rounded text-white/70 hover:text-white transition-colors cursor-pointer"
              title="Уменьшить межстрочный интервал"
            >
              <ArrowDown className="w-3 h-3" />
            </button>
            <span className="flex items-center px-1 text-[10px] font-mono font-bold text-white/80 w-7 justify-center">
              {lineHeight.toFixed(1)}
            </span>
            <button 
              type="button"
              onClick={() => onLineHeightChange(Math.min(3, Number((lineHeight + 0.1).toFixed(1))))} 
              className="p-1 hover:bg-white/10 rounded text-white/70 hover:text-white transition-colors cursor-pointer"
              title="Увеличить межстрочный интервал"
            >
              <ArrowUp className="w-3 h-3" />
            </button>
          </div>

          {/* Auto / Manual Pacing */}
          <button 
            type="button"
            onClick={() => onPacingChange(pacing === 'auto' ? 'manual' : 'auto')}
            className={cn(
              "px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border cursor-pointer whitespace-nowrap", 
              pacing === 'manual' 
                ? "bg-orange-600 border-orange-500 text-white shadow-[0_0_12px_rgba(249,115,22,0.4)]" 
                : "bg-black/60 border-white/10 text-zinc-400 hover:text-white hover:bg-white/10"
            )}
            title="Автопрокрутка по таймкоду или ручное управление стрелками/колесиком"
          >
            {pacing === 'auto' ? 'Авто' : 'Ручн.'}
          </button>
        </div>
      </div>

      {/* Focus Line (Reading guide) */}
      <div className="absolute top-1/2 left-0 right-0 h-px bg-indigo-500/30 z-10 pointer-events-none flex items-center justify-between px-4 -translate-y-1/2">
        <div className="text-[8px] font-black uppercase tracking-widest text-indigo-400/80 bg-zinc-950/80 px-1.5 py-0.5 rounded border border-indigo-500/30">
          Фокус
        </div>
        <div className="flex-1 mx-2 h-px bg-gradient-to-r from-indigo-500/20 via-indigo-500/40 to-indigo-500/20" />
        <div className="text-[8px] font-black uppercase tracking-widest text-indigo-400/80 bg-zinc-950/80 px-1.5 py-0.5 rounded border border-indigo-500/30">
          Фокус
        </div>
      </div>

      {/* Scrolling Text Subtitles Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto no-scrollbar scroll-smooth relative"
        onWheel={() => {
          if (pacing === 'auto') handleInteraction();
        }}
        onTouchMove={() => {
          if (pacing === 'auto') handleInteraction();
        }}
      >
        <div 
          className={cn(
            "space-y-6 mx-auto text-center transition-transform duration-100 ease-out px-4",
            mode === 'expanded' ? "max-w-4xl py-[40vh]" : "max-w-2xl py-32"
          )}
          style={{ 
            transform: pacing === 'manual' ? `translateY(${-manualOffset}px)` : 'none'
          }}
        >
          {visibleSubtitles.map(line => {
            const isSelectedRole = !activeRole || line.role === activeRole;
            const isCurrent = currentTime >= line.start && currentTime <= line.end && isSelectedRole;
            return (
              <div 
                key={line.id}
                id={`tp-line-${line.id}`}
                onClick={() => {
                  if (onSeek) onSeek(line.start);
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('syncScroll'));
                  }, 50);
                }}
                className={cn(
                  "transition-all duration-200 px-4 py-2 rounded-xl cursor-pointer select-text",
                  isCurrent 
                    ? "text-white font-semibold bg-indigo-600/25 border border-indigo-500/40 shadow-[0_0_25px_rgba(99,102,241,0.35)] scale-105" 
                    : isSelectedRole
                      ? "text-zinc-200/80 hover:text-white hover:bg-white/5 opacity-80"
                      : "text-zinc-500 opacity-40 scale-95 hover:opacity-70"
                )}
                style={{ 
                  fontSize: isSelectedRole ? `${fontSize}px` : `${Math.max(12, fontSize * 0.75)}px`, 
                  lineHeight: lineHeight 
                }}
              >
                {line.role && (
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 mb-1 opacity-75">
                    {line.role}
                  </div>
                )}
                <div>{line.text}</div>
              </div>
            );
          })}

          {visibleSubtitles.length === 0 && (
            <div className="text-zinc-500 text-sm italic py-8">
              Нет реплик для отображения
            </div>
          )}
        </div>
      </div>

      {/* Resize Handle (Dock Left/Right border, Bottom top border, or floating corner) */}
      <TeleprompterResizer 
        mode={mode} 
        onResize={onResize} 
        containerRef={containerRef} 
      />
    </div>
  );
};

export default Teleprompter;
