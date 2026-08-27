import React, { useState, useEffect, useMemo } from 'react';
import { GripVertical, Trash2, RotateCcw, Scissors, Edit3, Maximize, Volume2, Video, Copy, ClipboardPaste } from 'lucide-react';
import { cn } from '../lib/utils';
import { AudioSegment } from '../types';
import { VirtualizedWaveform } from './VirtualizedWaveform';
import { SmartAlignService } from '../services/smartAlignService';
import { ContextMenu } from './ContextMenu';
import { logger } from '../lib/logger';
import { useProjectData } from '../contexts/ProjectContext';

export const AudioSegmentView = React.memo(({ 
  seg, 
  trackId,
  zoom, 
  audioOffsetMs, 
  timelineVisibleRange,
  onUpdateSegment,
  onDeleteSegment,
  snapTime,
  onSnapLine,
  onSplitSegment,
  onDuplicateSegment,
  isSelected,
  onSelectSegment,
  onCopySegments,
  onCutSegments,
  onPasteSegments,
  onGlueSegments,
  currentTimeRef,
  autoFadeIn = 0,
  autoFadeOut = 0
}: { 
  seg: AudioSegment, 
  trackId: string,
  zoom: number, 
  audioOffsetMs: number,
  timelineVisibleRange?: { start: number, end: number },
  onUpdateSegment: (trackId: string, segmentId: string, updates: Partial<AudioSegment>, targetTrackId?: string) => void,
  onDeleteSegment?: (trackId: string, segmentId: string) => void,
  snapTime: (time: number, excludeId?: string) => { time: number, snapped: boolean },
  onSnapLine: (time: number | null) => void,
  onSplitSegment?: (trackId: string, segmentId: string, time: number) => void,
  onDuplicateSegment?: (trackId: string, segmentId: string, newStartTime: number) => void,
  isSelected?: boolean,
  onSelectSegment?: (segmentId: string, multi: boolean) => void,
  onCopySegments?: () => void,
  onCutSegments?: () => void,
  onPasteSegments?: () => void,
  onGlueSegments?: () => void,
  currentTimeRef?: React.MutableRefObject<number>,
  autoFadeIn?: number,
  autoFadeOut?: number,
  key?: string | number
}) => {
  const { saveSnapshot } = useProjectData();
  const [isResizing, setIsResizing] = useState<'left' | 'right' | 'drag' | 'slip' | null>(null);
  const [showVolume, setShowVolume] = useState(false);
  const [isAligning, setIsAligning] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);
  const [isDraggingGain, setIsDraggingGain] = useState(false);

  const handleGainLineMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (e.button !== 0 || e.detail > 1) {
      return;
    }

    const startY = e.clientY;
    const initialGain = (seg.gain === undefined) ? 0 : seg.gain;
    
    // Находим высоту контейнера сегмента, чтобы рассчитать шаг изменения dB на пиксель
    const container = e.currentTarget.closest('.audio-segment-container') || e.currentTarget.parentElement;
    const containerHeight = container ? container.getBoundingClientRect().height : 80;

    let hasDragged = false;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      
      if (!hasDragged && Math.abs(deltaY) < 3) {
        return;
      }

      if (!hasDragged) {
        hasDragged = true;
        saveSnapshot();
        setIsDraggingGain(true);
      }

      // Относительное изменение громкости: полный перетаскиваемый диапазон составляет 30 дБ (-15 до 15)
      // Масштабируем так, чтобы перетаскивание на 80% высоты контейнера давало изменение в 30 дБ.
      const scaleFactor = containerHeight > 0 ? containerHeight * 0.8 : 64;
      const deltaDb = -(deltaY / scaleFactor) * 30;
      
      let newGain = initialGain + deltaDb;
      // Ограничиваем шаг в 0.5 дБ и диапазон от -15 до 15 дБ
      newGain = Math.max(-15, Math.min(15, Math.round(newGain * 2) / 2));
      
      onUpdateSegment(trackId, seg.id, { gain: newGain });
    };
    
    const handleMouseUp = () => {
      if (hasDragged) {
        setIsDraggingGain(false);
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isSelected && onSelectSegment) {
      onSelectSegment(seg.id, false);
    }
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleMouseDown = (e: React.MouseEvent, side: 'left' | 'right' | 'drag') => {
    e.stopPropagation();
    saveSnapshot();
    
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
        const { time: snappedStartTime, snapped } = moveEvent.shiftKey ? { time: rawStartTime, snapped: false } : snapTime(rawStartTime, seg.id);
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
            onUpdateSegment(trackId, seg.id, { 
              startTime: finalStartTime, 
              duration: newDuration, 
              fileOffset: newFileOffset 
            });
          }
        }
      } else if (side === 'right') {
        const rawEndTime = initialStartTime + initialDuration + deltaT;
        const { time: snappedEndTime, snapped } = moveEvent.shiftKey ? { time: rawEndTime, snapped: false } : snapTime(rawEndTime, seg.id);
        onSnapLine(snapped ? snappedEndTime : null);
        
        let actualDeltaT = snappedEndTime - (initialStartTime + initialDuration);
        
        // Don't drag beyond available file end!
        const maxDeltaT = (seg.fileDuration || seg.duration) - (initialFileOffset + initialDuration);
        actualDeltaT = Math.min(actualDeltaT, maxDeltaT);
        
        const newDuration = Math.max(0.1, initialDuration + actualDeltaT);
        
        // Ensure we don't trim past the file end, with 2ms tolerance for float precision
        if (Math.abs(actualDeltaT) > 0.001) {
          if (initialFileOffset + newDuration <= (seg.fileDuration || seg.duration) + 0.002) {
            onUpdateSegment(trackId, seg.id, { duration: newDuration });
          }
        }
      } else if (currentMode === 'slip') {
        const newFileOffset = Math.max(0, initialFileOffset - deltaT);
        if (newFileOffset + initialDuration <= seg.fileDuration) {
          onUpdateSegment(trackId, seg.id, { fileOffset: newFileOffset });
        }
      } else if (currentMode === 'drag') {
        const rawStart = Math.max(0, initialStartTime + deltaT);
        const rawEnd = rawStart + initialDuration;
        
        const snapStart = moveEvent.shiftKey ? { time: rawStart, snapped: false } : snapTime(rawStart, seg.id);
        const snapEnd = moveEvent.shiftKey ? { time: rawEnd, snapped: false } : snapTime(rawEnd, seg.id);
        
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

        if (moveEvent.ctrlKey && !hasDuplicated && onDuplicateSegment) {
          hasDuplicated = true;
          onDuplicateSegment(trackId, seg.id, finalStart);
        } else if (!hasDuplicated) {
          onUpdateSegment(trackId, seg.id, { startTime: finalStart }, targetTrackId);
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
    saveSnapshot();
    const startX = e.clientX;
    const initialFade = type === 'in' ? (seg.fadeIn || 0) : (seg.fadeOut || 0);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaT = deltaX / zoom;
      
      let newFade = initialFade;
      if (type === 'in') {
        newFade = Math.max(0, Math.min(seg.duration, initialFade + deltaT));
        onUpdateSegment(trackId, seg.id, { fadeIn: newFade });
      } else {
        newFade = Math.max(0, Math.min(seg.duration, initialFade - deltaT));
        onUpdateSegment(trackId, seg.id, { fadeOut: newFade });
      }
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  if (timelineVisibleRange) {
    const startOffset = seg.startTime + (audioOffsetMs / 1000);
    const endOffset = startOffset + seg.duration;
    // Buffer of 5 seconds to prevent flickering on scroll/seek
    if (endOffset < timelineVisibleRange.start - 5 || startOffset > timelineVisibleRange.end + 5) {
      return (
        <div 
          className="absolute h-full pointer-events-none opacity-0"
          style={{ 
            left: `${startOffset * zoom}px`, 
            width: `${seg.duration * zoom}px` 
          }}
        />
      );
    }
  }

  const currentGainVal = (seg.gain === undefined) ? 0 : seg.gain;
  
  const gainToPercent = (g: number) => {
    const minDb = -15;
    const maxDb = 15;
    const clamped = Math.max(minDb, Math.min(maxDb, g));
    const frac = (clamped - minDb) / (maxDb - minDb);
    // Мапим -15 dB на 90% (низ), +15 dB на 10% (верх)
    return 90 - frac * 80;
  };

  const gY = gainToPercent(currentGainVal);
  const effFadeIn = Math.max(seg.fadeIn || 0, autoFadeIn || 0);
  const effFadeOut = Math.max(seg.fadeOut || 0, autoFadeOut || 0);

  const fadeInX = Math.min(100, (effFadeIn / seg.duration) * 100);
  const rawFadeOutX = 100 - (effFadeOut / seg.duration) * 100;
  const fadeOutX = Math.max(fadeInX, Math.min(100, rawFadeOutX));

  const averageDb = useMemo(() => {
    if (!seg.waveform || seg.waveform.length === 0) {
      // По умолчанию, если нет волны, берем среднюю громкость -20 дБ
      return -20 + currentGainVal;
    }
    const sum = seg.waveform.reduce((acc, val) => acc + Math.abs(val), 0);
    const avgAmp = sum / seg.waveform.length;
    // Переводим амплитуду [0..1] в децибелы (dBFS)
    const baseDb = avgAmp > 0.001 ? 20 * Math.log10(avgAmp) : -60;
    // Оцениваем RMS (обычно на ~12 дБ ниже пикового значения)
    const estimatedRmsDb = baseDb - 12;
    const realDb = estimatedRmsDb + currentGainVal;
    return Math.max(-60, Math.min(6, realDb));
  }, [seg.waveform, currentGainVal]);

  const getVolumeColorClass = (db: number) => {
    if (db > -3) return "text-red-400 bg-red-950/85 border-red-500/30";
    if (db > -10) return "text-amber-400 bg-amber-950/80 border-amber-500/30";
    if (db > -24) return "text-emerald-400 bg-emerald-950/85 border-emerald-500/30";
    return "text-zinc-400 bg-zinc-950/85 border-zinc-500/20";
  };

  const getMeterPercent = (db: number) => {
    const minDb = -45;
    const maxDb = 0;
    const clamped = Math.max(minDb, Math.min(maxDb, db));
    return ((clamped - minDb) / (maxDb - minDb)) * 100;
  };

  return (
    <div 
      onMouseDown={(e) => {
        if (onSelectSegment) onSelectSegment(seg.id, e.shiftKey);
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
          {seg.gain !== 0 && seg.gain !== undefined && (
            <span className="text-[7px] font-black bg-emerald-600/60 px-1 rounded text-white">
              {seg.gain > 0 ? `+${seg.gain.toFixed(1)}` : seg.gain.toFixed(1)} dB
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
                seg.gain !== 0 && seg.gain !== undefined ? "text-emerald-400" : "text-zinc-500"
              )}
              title="Громкость фразы"
            >
              <Volume2 className="w-3 h-3" />
            </button>
            {showVolume && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-2 bg-zinc-900 border border-white/10 rounded-lg shadow-2xl z-50 flex flex-col items-center gap-2">
                <div className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">Громкость</div>
                {(() => {
                  const safeGain = typeof seg.gain === 'number' && !isNaN(seg.gain) ? seg.gain : 0;
                  return (
                    <>
                      <input 
                        type="range" min="-15" max="15" step="0.5"
                        value={safeGain}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          saveSnapshot();
                        }}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          onUpdateSegment(trackId, seg.id, { gain: isNaN(val) ? 0 : val });
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          saveSnapshot();
                          onUpdateSegment(trackId, seg.id, { gain: 0 });
                        }}
                        className="h-24 appearance-none bg-zinc-800 rounded-full w-1 accent-indigo-500 cursor-pointer"
                        style={{ writingMode: 'vertical-lr' }}
                      />
                      <div className="text-[8px] font-mono text-indigo-400">
                        {(safeGain > 0 ? '+' : '') + safeGain.toFixed(1)} dB
                      </div>
                    </>
                  );
                })()}
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
          
      {/* Fade Background Overlays */}
      {effFadeIn > 0 && (
        <div 
          className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-black/40 to-transparent pointer-events-none z-0"
          style={{ width: `${effFadeIn * zoom}px` }}
        />
      )}
      {effFadeOut > 0 && (
        <div 
          className="absolute top-0 bottom-0 right-0 bg-gradient-to-l from-black/40 to-transparent pointer-events-none z-0"
          style={{ width: `${effFadeOut * zoom}px` }}
        />
      )}

      {/* Yellow Volume Envelope (Interactive & Anti-Scaling) */}
      <svg 
        className="absolute inset-0 w-full h-full pointer-events-none z-15 select-none" 
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {/* Filled translucent volume shape */}
        <path
          d={`M 0,100 L ${fadeInX},${gY} L ${fadeOutX},${gY} L 100,100 Z`}
          fill="#eab308"
          fillOpacity="0.08"
        />

        {/* Left Fade line */}
        <line
          x1={0}
          y1={100}
          x2={fadeInX}
          y2={gY}
          stroke="#eab308"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          strokeDasharray={effFadeIn > 0 ? undefined : "2,2"}
          className="opacity-40"
        />

        {/* Right Fade line */}
        <line
          x1={fadeOutX}
          y1={gY}
          x2={100}
          y2={100}
          stroke="#eab308"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          strokeDasharray={effFadeOut > 0 ? undefined : "2,2"}
          className="opacity-40"
        />

        {/* Main Volume Level Line */}
        <line
          x1={fadeInX}
          y1={gY}
          x2={fadeOutX}
          y2={gY}
          stroke="#facc15"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />

        {/* Grab trigger area (makes dragging easy) */}
        <g 
          className="group/gain cursor-ns-resize pointer-events-auto" 
          onMouseDown={handleGainLineMouseDown}
          onDoubleClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setIsDraggingGain(false);
            saveSnapshot();
            onUpdateSegment(trackId, seg.id, { gain: 0 });
          }}
        >
          <line
            x1={fadeInX}
            y1={gY}
            x2={fadeOutX}
            y2={gY}
            stroke="transparent"
            strokeWidth={12}
            vectorEffect="non-scaling-stroke"
          />
          {/* Highlight Glow line on hover */}
          <line
            x1={fadeInX}
            y1={gY}
            x2={fadeOutX}
            y2={gY}
            stroke="#facc15"
            strokeWidth={4.5}
            vectorEffect="non-scaling-stroke"
            className="opacity-0 group-hover/gain:opacity-30 transition-opacity duration-100"
          />
        </g>
      </svg>

      {/* Floating real-time dB Badge while dragging */}
      {isDraggingGain && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30 animate-pulse">
          <div className="bg-yellow-500 text-zinc-950 font-black px-2 py-0.5 rounded text-[9px] shadow-xl border border-yellow-300/30 flex items-center gap-1">
            <Volume2 className="w-2.5 h-2.5" />
            <span>{currentGainVal > 0 ? `+${currentGainVal.toFixed(1)}` : currentGainVal.toFixed(1)} dB</span>
          </div>
        </div>
      )}

      {/* Real-time RMS volume indicator badge */}
      {seg.duration * zoom > 40 && (
        <div 
          className={cn(
            "absolute bottom-1 right-2 px-1.5 py-0.5 rounded text-[8px] font-mono select-none z-10 border flex items-center gap-1 shadow-md bg-zinc-950/85",
            getVolumeColorClass(averageDb)
          )}
          title={`Реальная средняя громкость: ${averageDb.toFixed(1)} dB`}
        >
          <span className="font-bold uppercase tracking-wider text-[7px] opacity-75">RMS</span>
          {seg.duration * zoom > 90 && (
            <div className="w-10 h-1 bg-zinc-800 rounded-full overflow-hidden relative">
              <div 
                className={cn(
                  "h-full rounded-full transition-all duration-100",
                  averageDb > -3 ? "bg-red-500" : averageDb > -10 ? "bg-amber-500" : "bg-emerald-500"
                )}
                style={{ width: `${getMeterPercent(averageDb)}%` }}
              />
            </div>
          )}
          <span className="font-black text-[8px] min-w-[32px] text-right">
            {averageDb > 0 ? `+${averageDb.toFixed(1)}` : averageDb.toFixed(1)} dB
          </span>
        </div>
      )}

      {contextMenu && (
        <ContextMenu 
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: "Скопировать",
              icon: <Copy className="w-3.5 h-3.5 text-zinc-400" />,
              disabled: !onCopySegments,
              onClick: () => onCopySegments?.()
            },
            {
              label: "Вырезать",
              icon: <Scissors className="w-3.5 h-3.5 text-zinc-400" />,
              disabled: !onCutSegments,
              onClick: () => onCutSegments?.()
            },
            {
              label: "Вставить",
              icon: <ClipboardPaste className="w-3.5 h-3.5 text-zinc-400" />,
              disabled: !onPasteSegments,
              onClick: () => onPasteSegments?.()
            },
            {
              label: "Громкость по умолчанию",
              icon: <Maximize className="w-3.5 h-3.5 text-emerald-400" />,
              onClick: () => {
                saveSnapshot();
                onUpdateSegment(trackId, seg.id, { gain: 0.0 });
              }
            },
            {
              label: "Разделить (в плейхеде)",
              icon: <Scissors className="w-3.5 h-3.5 text-zinc-400" />,
              disabled: !onSplitSegment || !currentTimeRef,
              onClick: () => {
                if (onSplitSegment && currentTimeRef) {
                  onSplitSegment(trackId, seg.id, currentTimeRef.current);
                }
              }
            },
            {
              label: "Переименовать / Коммент",
              icon: <Edit3 className="w-3.5 h-3.5 text-zinc-400" />,
              onClick: () => {
                const newText = prompt("Введите комментарий к дублю:", seg.text || "");
                if (newText !== null) {
                  saveSnapshot();
                  onUpdateSegment(trackId, seg.id, { text: newText });
                }
              }
            },
            ...(onGlueSegments ? [{
              label: "Склеить выделенные (Glue)",
              icon: <Volume2 className="w-3.5 h-3.5 text-indigo-400" />,
              onClick: () => onGlueSegments()
            }] : []),
            {
              label: "Удалить сегмент",
              icon: <Trash2 className="w-3.5 h-3.5 text-rose-400" />,
              variant: 'danger',
              onClick: () => onDeleteSegment?.(trackId, seg.id)
            }
          ]}
        />
      )}
    </div>
  );
});

export default AudioSegmentView;
