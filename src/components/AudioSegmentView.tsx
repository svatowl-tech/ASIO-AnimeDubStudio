import React, { useState, useEffect } from 'react';
import { GripVertical, Trash2, RotateCcw, Scissors, Edit3, Maximize, Volume2, Video } from 'lucide-react';
import { cn } from '../lib/utils';
import { AudioSegment } from '../types';
import { VirtualizedWaveform } from './VirtualizedWaveform';
import { SmartAlignService } from '../services/smartAlignService';
import { ContextMenu } from './ContextMenu';
import { logger } from '../lib/logger';

export const AudioSegmentView = React.memo(({ 
  seg, 
  zoom, 
  audioOffsetMs, 
  timelineVisibleRange,
  onUpdate,
  onDelete,
  snapTime,
  onSnapLine,
  onSplit,
  onDuplicate,
  isSelected,
  onSelect,
  onGlue,
  autoFadeIn = 0,
  autoFadeOut = 0
}: { 
  seg: AudioSegment, 
  zoom: number, 
  audioOffsetMs: number,
  timelineVisibleRange?: { start: number, end: number },
  onUpdate: (id: string, updates: Partial<AudioSegment>, targetTrackId?: string) => void,
  onDelete?: (id: string) => void,
  snapTime: (time: number, excludeId?: string) => { time: number, snapped: boolean },
  onSnapLine: (time: number | null) => void,
  onSplit?: (id: string) => void,
  onDuplicate?: (id: string, newStartTime: number) => void,
  isSelected?: boolean,
  onSelect?: (e: React.MouseEvent) => void,
  onGlue?: () => void,
  autoFadeIn?: number,
  autoFadeOut?: number,
  key?: string | number
}) => {
  const [isResizing, setIsResizing] = useState<'left' | 'right' | 'drag' | 'slip' | null>(null);
  const [showVolume, setShowVolume] = useState(false);
  const [isAligning, setIsAligning] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleMouseDown = (e: React.MouseEvent, side: 'left' | 'right' | 'drag') => {
    e.stopPropagation();
    
    let currentMode: 'left' | 'right' | 'drag' | 'slip' = side;
    if (side === 'drag' && e.altKey) {
      currentMode = 'slip';
    }
    
    setIsResizing(currentMode);
    
    const startX = e.clientX;
    const initialStartTime = seg.startTime;
    const initialDuration = seg.duration;
    const initialFileOffset = seg.fileOffset;
    
    // For duplicate
    let hasDuplicated = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaT = deltaX / zoom;

      if (currentMode === 'left') {
        const rawStartTime = Math.max(0, initialStartTime + deltaT);
        const { time: snappedStartTime, snapped } = snapTime(rawStartTime, seg.id);
        onSnapLine(snapped ? snappedStartTime : null);
        
        let actualDeltaT = snappedStartTime - initialStartTime;
        
        // Ensure we don't trim past the available fileOffset
        actualDeltaT = Math.max(actualDeltaT, -initialFileOffset);
        // Ensure we don't shrink the duration below 0.1s
        if (initialDuration - actualDeltaT < 0.1) {
            actualDeltaT = initialDuration - 0.1;
        }

        const finalStartTime = initialStartTime + actualDeltaT;
        const newDuration = initialDuration - actualDeltaT;
        const newFileOffset = initialFileOffset + actualDeltaT;
        
        // Ensure we don't trim past the file end, with 2ms tolerance for float precision
        if (Math.abs(actualDeltaT) > 0.001) {
          if (newFileOffset + newDuration <= (seg.fileDuration || seg.duration) + 0.002) {
            onUpdate(seg.id, { 
              startTime: finalStartTime, 
              duration: newDuration, 
              fileOffset: newFileOffset 
            });
          }
        }
      } else if (side === 'right') {
        const rawEndTime = initialStartTime + initialDuration + deltaT;
        const { time: snappedEndTime, snapped } = snapTime(rawEndTime, seg.id);
        onSnapLine(snapped ? snappedEndTime : null);
        
        let actualDeltaT = snappedEndTime - (initialStartTime + initialDuration);
        
        // Don't drag beyond available file end!
        const maxDeltaT = (seg.fileDuration || seg.duration) - (initialFileOffset + initialDuration);
        actualDeltaT = Math.min(actualDeltaT, maxDeltaT);
        
        const newDuration = Math.max(0.1, initialDuration + actualDeltaT);
        
        // Ensure we don't trim past the file end, with 2ms tolerance for float precision
        if (Math.abs(actualDeltaT) > 0.001) {
          if (initialFileOffset + newDuration <= (seg.fileDuration || seg.duration) + 0.002) {
            onUpdate(seg.id, { duration: newDuration });
          }
        }
      } else if (currentMode === 'slip') {
        const newFileOffset = Math.max(0, initialFileOffset - deltaT);
        if (newFileOffset + initialDuration <= seg.fileDuration) {
          onUpdate(seg.id, { fileOffset: newFileOffset });
        }
      } else if (currentMode === 'drag') {
        const rawStart = Math.max(0, initialStartTime + deltaT);
        const rawEnd = rawStart + initialDuration;
        
        const snapStart = snapTime(rawStart, seg.id);
        const snapEnd = snapTime(rawEnd, seg.id);
        
        let finalStart = rawStart;
        let snapLineTime = null;

        if (snapStart.snapped && snapEnd.snapped) {
           if (Math.abs(snapStart.time - rawStart) < Math.abs(snapEnd.time - rawEnd)) {
               finalStart = snapStart.time;
               snapLineTime = snapStart.time;
           } else {
               finalStart = snapEnd.time - initialDuration;
               snapLineTime = snapEnd.time;
           }
        } else if (snapStart.snapped) {
           finalStart = snapStart.time;
           snapLineTime = snapStart.time;
        } else if (snapEnd.snapped) {
           finalStart = snapEnd.time - initialDuration;
           snapLineTime = snapEnd.time;
        }

        onSnapLine(snapLineTime);
        
        let targetTrackId: string | undefined = undefined;
        const trackContainers = document.querySelectorAll('.timeline-track');
        trackContainers.forEach(container => {
          const rect = container.getBoundingClientRect();
          if (moveEvent.clientY >= rect.top && moveEvent.clientY <= rect.bottom && 
              moveEvent.clientX >= rect.left && moveEvent.clientX <= rect.right) {
            targetTrackId = container.getAttribute('data-track-id') || undefined;
          }
        });

        if (moveEvent.ctrlKey && !hasDuplicated && onDuplicate) {
          hasDuplicated = true;
          onDuplicate(seg.id, finalStart);
        } else if (!hasDuplicated) {
          onUpdate(seg.id, { startTime: finalStart }, targetTrackId);
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizing(null);
      onSnapLine(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleFadeMouseDown = (e: React.MouseEvent, type: 'in' | 'out') => {
    e.stopPropagation();
    const startX = e.clientX;
    const initialFade = type === 'in' ? (seg.fadeIn || 0) : (seg.fadeOut || 0);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaT = deltaX / zoom;
      
      let newFade = initialFade;
      if (type === 'in') {
        newFade = Math.max(0, Math.min(seg.duration, initialFade + deltaT));
        onUpdate(seg.id, { fadeIn: newFade });
      } else {
        newFade = Math.max(0, Math.min(seg.duration, initialFade - deltaT));
        onUpdate(seg.id, { fadeOut: newFade });
      }
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div 
      onMouseDown={(e) => {
        if (onSelect) onSelect(e);
        handleMouseDown(e, 'drag');
      }}
      onContextMenu={handleContextMenu}
      className={cn(
        "absolute h-full flex items-center overflow-hidden transition-all group cursor-move pointer-events-auto",
        "bg-indigo-500/40 border-x border-indigo-500/60 z-10 shadow-[0_0_10px_rgba(99,102,241,0.2)]",
        isSelected && "ring-2 ring-white ring-inset"
      )}
      style={{ 
        left: `${(seg.startTime + (audioOffsetMs / 1000)) * zoom}px`, 
        width: `${seg.duration * zoom}px` 
      }}
    >
      {seg.waveform && timelineVisibleRange && (
        <VirtualizedWaveform 
          peaks={seg.waveform} 
          zoom={zoom} 
          duration={seg.fileDuration || seg.duration} 
          color="#60a5fa" 
          visibleRange={timelineVisibleRange}
          isRelative={true}
          segmentOffset={seg.fileOffset || 0}
          segmentStartTime={seg.startTime}
          audioOffsetMs={audioOffsetMs}
        />
      )}
      
      {/* Segment Info */}
      <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
        <div className="flex items-center gap-1">
          {seg.backstageVideoPath && (
            <span className="p-[2px] rounded bg-purple-500/80 text-white" title={`Есть backstage видео: ${seg.backstageVideoPath}`}>
              <Video className="w-2.5 h-2.5" />
            </span>
          )}
          {seg.text && (
            <span className="text-[7px] font-black bg-black/40 px-1 rounded text-indigo-300">
              {seg.text}
            </span>
          )}
          {seg.gain !== 1 && (
            <span className="text-[7px] font-black bg-emerald-600/60 px-1 rounded text-white">
              {Math.round(seg.gain * 100)}%
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto">
          <div className="relative">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setShowVolume(!showVolume);
              }}
              className={cn(
                "p-0.5 rounded hover:bg-white/10 transition-colors",
                seg.gain !== 1 ? "text-emerald-400" : "text-zinc-500"
              )}
              title="Громкость фразы"
            >
              <Volume2 className="w-3 h-3" />
            </button>
            {showVolume && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-2 bg-zinc-900 border border-white/10 rounded-lg shadow-2xl z-50 flex flex-col items-center gap-2">
                <div className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">Громкость</div>
                <input 
                  type="range" min="0" max="2" step="0.05"
                  value={seg.gain}
                  onChange={(e) => onUpdate(seg.id, { gain: parseFloat(e.target.value) })}
                  className="h-24 appearance-none bg-zinc-800 rounded-full w-1 accent-indigo-500 cursor-pointer"
                  style={{ writingMode: 'vertical-lr' }}
                />
                <div className="text-[8px] font-mono text-indigo-400">{Math.round(seg.gain * 100)}%</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Trim Handles */}
      <div 
        onMouseDown={(e) => handleMouseDown(e, 'left')}
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-indigo-400/50 flex items-center justify-center"
        title="Обрезать начало"
      >
          <GripVertical className="w-2 h-2 text-white/50" />
        </div>
        <div 
          onMouseDown={(e) => handleMouseDown(e, 'right')}
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-indigo-400/50 flex items-center justify-center"
          title="Обрезать конец"
        >
          <GripVertical className="w-2 h-2 text-white/50" />
        </div>
          
      {/* Fade Handles */}
      <div 
        onMouseDown={(e) => handleFadeMouseDown(e, 'in')}
        className="absolute top-0 w-3 h-3 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity z-20 flex items-center justify-center"
        style={{ left: `${(seg.fadeIn || 0) * zoom}px`, transform: 'translateX(-50%)' }}
        title="Нарастание (Fade In)"
      >
        <div className="w-1.5 h-1.5 bg-white rounded-full shadow-sm" />
      </div>
      <div 
        onMouseDown={(e) => handleFadeMouseDown(e, 'out')}
        className="absolute top-0 w-3 h-3 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity z-20 flex items-center justify-center"
        style={{ right: `${(seg.fadeOut || 0) * zoom}px`, transform: 'translateX(50%)' }}
        title="Затухание (Fade Out)"
      >
        <div className="w-1.5 h-1.5 bg-white rounded-full shadow-sm" />
      </div>
          
      {/* Fade Visualizers */}
      {(seg.fadeIn || autoFadeIn) > 0 && (
        <div 
          className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-black/50 to-transparent pointer-events-none z-10"
          style={{ width: `${Math.max(seg.fadeIn || 0, autoFadeIn) * zoom}px` }}
        >
          <svg className="w-full h-full opacity-50">
            <line x1="0" y1="100%" x2="100%" y2="0" stroke="white" strokeWidth="1" strokeDasharray="2,2" />
          </svg>
        </div>
      )}
      {(seg.fadeOut || autoFadeOut) > 0 && (
        <div 
          className="absolute top-0 bottom-0 right-0 bg-gradient-to-l from-black/50 to-transparent pointer-events-none z-10"
          style={{ width: `${Math.max(seg.fadeOut || 0, autoFadeOut) * zoom}px` }}
        >
          <svg className="w-full h-full opacity-50">
            <line x1="0" y1="0" x2="100%" y2="100%" stroke="white" strokeWidth="1" strokeDasharray="2,2" />
          </svg>
        </div>
      )}

      {contextMenu && (
        <ContextMenu 
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: "Нормализовать громкость",
              icon: <Maximize className="w-3.5 h-3.5 text-emerald-400" />,
              onClick: () => onUpdate(seg.id, { gain: 1.0 })
            },
            {
              label: "Разделить (в плейхеде)",
              icon: <Scissors className="w-3.5 h-3.5 text-zinc-400" />,
              disabled: !onSplit,
              onClick: () => {
                if (onSplit) {
                  onSplit(seg.id);
                }
              }
            },
            {
              label: "Переименовать / Коммент",
              icon: <Edit3 className="w-3.5 h-3.5 text-zinc-400" />,
              onClick: () => {
                const newText = prompt("Введите комментарий к дублю:", seg.text || "");
                if (newText !== null) onUpdate(seg.id, { text: newText });
              }
            },
            ...(onGlue ? [{
              label: "Склеить выделенные (Glue)",
              icon: <Volume2 className="w-3.5 h-3.5 text-indigo-400" />,
              onClick: () => onGlue()
            }] : []),
            {
              label: "Удалить сегмент",
              icon: <Trash2 className="w-3.5 h-3.5 text-rose-400" />,
              variant: 'danger',
              onClick: () => onDelete?.(seg.id)
            }
          ]}
        />
      )}
    </div>
  );
});

export default AudioSegmentView;
