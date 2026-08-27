import React, { useState, useRef } from 'react';
import { Volume2, VolumeX, Headphones, Edit3, Trash2, Eraser, RotateCcw, Settings2 } from 'lucide-react';
import { cn, safeConfirm } from '../lib/utils';
import { AudioTrack, TrackProcessing } from '../types';
import { ContextMenu } from './ContextMenu';
import { TrackProcessingModal } from './TrackProcessingModal';
import { useProjectData } from '../contexts/ProjectContext';

export const TrackHeader = ({ 
  track, 
  isMuted, 
  isSoloed, 
  volume, 
  onMute, 
  onSolo, 
  onVolumeChange,
  onRename,
  onClear,
  onDelete,
  onUpdateProcessing,
  onHeightChange,
  onSelectSegment,
  onSelectBatchSegments,
  onOpenProcessing,
  onArm
}: { 
  track: AudioTrack, 
  isMuted: boolean, 
  isSoloed: boolean, 
  volume: number, 
  onMute: (id: string) => void, 
  onSolo: (id: string) => void, 
  onVolumeChange: (id: string, vol: number) => void,
  onArm?: (id: string) => void,
  onRename?: (id: string, name: string) => void,
  onClear?: (id: string) => void,
  onDelete?: (id: string) => void,
  onUpdateProcessing?: (id: string, settings: TrackProcessing) => void,
  onHeightChange?: (id: string, height: number) => void,
  onSelectSegment?: (segmentId: string, multi: boolean) => void,
  onSelectBatchSegments?: (segmentIds: string[], multi?: boolean) => void,
  onOpenProcessing?: (id: string) => void,
  key?: string | number
}) => {
  const { saveSnapshot } = useProjectData();
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);

  const isArmed = track.isArmed;
  const isOriginal = track.name === 'Оригинал';
  
  const toggleProcessing = () => {
    if (onOpenProcessing) onOpenProcessing(track.id);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const headerRef = useRef<HTMLDivElement>(null);

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const initialHeight = track.height || 80;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(64, initialHeight + deltaY); // Min height 64px
      
      if (headerRef.current) {
        headerRef.current.style.height = `${newHeight}px`;
      }
      
      const trackRow = document.querySelector(`[data-track-id="${track.id}"]`) as HTMLElement;
      if (trackRow) {
        trackRow.style.height = `${newHeight}px`;
      }
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      
      const deltaY = upEvent.clientY - startY;
      const newHeight = Math.max(64, initialHeight + deltaY);
      
      if (onHeightChange) {
        onHeightChange(track.id, newHeight);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div 
      ref={headerRef}
      onContextMenu={handleContextMenu}
      onDoubleClick={(e) => {
        if (onSelectBatchSegments) {
          onSelectBatchSegments((track.segments || []).map(seg => seg.id), e.shiftKey);
        } else if (onSelectSegment) {
          track.segments.forEach(seg => onSelectSegment(seg.id, true));
        }
      }}
      className="border-b border-zinc-800 bg-zinc-900/50 p-4 flex flex-col gap-3 group relative"
      style={{ height: track.height || 80 }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 group-hover:text-zinc-300 transition-colors">
          {track.name}
        </span>
        <div className="flex gap-1">
          {!isOriginal && (
            <button 
              onClick={() => onArm?.(track.id)}
              className={cn(
                "w-6 h-6 rounded flex items-center justify-center transition-all",
                isArmed ? "bg-rose-500 text-white shadow-[0_0_8px_rgba(244,63,94,0.5)]" : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
              )}
              title="Запись на эту дорожку (ARM)"
            >
              <div className={cn("w-2 h-2 rounded-full", isArmed ? "bg-white animate-pulse" : "bg-zinc-600")} />
            </button>
          )}
          <button 
            onClick={() => onMute(track.id)}
            className={cn(
              "w-6 h-6 rounded flex items-center justify-center transition-all",
              isMuted ? "bg-rose-500 text-white" : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
            )}
          >
            {isMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
          </button>
          <button 
            onClick={() => onSolo(track.id)}
            className={cn(
              "w-6 h-6 rounded flex items-center justify-center transition-all",
              isSoloed ? "bg-amber-500 text-white" : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
            )}
          >
            <Headphones size={12} />
          </button>
          <button 
            onClick={toggleProcessing}
            className={cn(
              "w-6 h-6 rounded flex items-center justify-center transition-all",
              track.processing?.enabled ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
            )}
            title="Настроить обработку"
          >
            <Settings2 size={12} />
          </button>
        </div>
      </div>
      
      <div className="flex-1 flex flex-col justify-end gap-2">
        <div className="flex items-center gap-2">
          {(() => {
            const safeVolume = typeof volume === 'number' && !isNaN(volume) ? volume : 0;
            return (
              <>
                <input 
                  type="range" 
                  min="-15" 
                  max="15" 
                  step="0.5" 
                  value={safeVolume} 
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    saveSnapshot();
                  }}
                  onChange={(e) => {
                    const parsed = parseFloat(e.target.value);
                    onVolumeChange(track.id, isNaN(parsed) ? 0 : parsed);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    saveSnapshot();
                    onVolumeChange(track.id, 0.0);
                  }}
                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <span className="text-[8px] font-mono text-zinc-600 w-10 text-right">
                  {safeVolume > 0 ? `+${safeVolume.toFixed(1)}` : safeVolume.toFixed(1)} dB
                </span>
              </>
            );
          })()}
        </div>
      </div>

      {contextMenu && (
        <ContextMenu 
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: "Переименовать дорожку",
              icon: <Edit3 className="w-3.5 h-3.5 text-zinc-400" />,
              onClick: () => {
                const newName = prompt("Введите новое название дорожки:", track.name);
                if (newName) {
                  saveSnapshot();
                  onRename?.(track.id, newName);
                }
              }
            },
            {
              label: "Сбросить громкость",
              icon: <RotateCcw className="w-3.5 h-3.5 text-zinc-400" />,
              onClick: () => {
                saveSnapshot();
                onVolumeChange(track.id, 0.0);
              }
            },
            {
              label: "Очистить дорожку",
              icon: <Eraser className="w-3.5 h-3.5 text-amber-400" />,
              onClick: async () => {
                if (await safeConfirm(`Вы уверены, что хотите удалить все дубли на дорожке "${track.name}"?`)) {
                  onClear?.(track.id);
                }
              }
            },
            {
              label: "Удалить дорожку",
              icon: <Trash2 className="w-3.5 h-3.5 text-rose-400" />,
              variant: 'danger',
              disabled: track.name === 'Оригинал',
              onClick: async () => {
                const hasSegments = track.segments && track.segments.length > 0;
                let msg = `Удалить дорожку "${track.name}"?`;
                if (hasSegments) {
                  msg = `ВНИМАНИЕ! Дорожка "${track.name}" содержит записи (${track.segments.length} фрагментов). Вы уверены, что хотите удалить её ОКОНЧАТЕЛЬНО?`;
                }
                
                if (await safeConfirm(msg)) {
                  onDelete?.(track.id);
                }
              }
            }
          ]}
        />
      )}

      {/* Resize Handle */}
      <div 
        className="absolute bottom-0 left-0 right-0 h-2 cursor-row-resize hover:bg-white/10 z-20"
        onMouseDown={handleResizeMouseDown}
      />
    </div>
  );
};

export default TrackHeader;
