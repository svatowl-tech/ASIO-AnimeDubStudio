import React, { useState, useRef, useEffect, useMemo } from 'react';
import { GripHorizontal, Play, Pause, Maximize2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { getStoredTeleprompterPref, saveTeleprompterPref } from './useTeleprompterLayout';

interface StageVideoContainerProps {
  isExpandedPip: boolean;
  isPlaying?: boolean;
  currentTime?: number;
  duration?: number;
  onTogglePlay?: () => void;
  onExitExpanded?: () => void;
  children: React.ReactNode;
}

type PipResizeDir = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';

export const StageVideoContainer: React.FC<StageVideoContainerProps> = ({
  isExpandedPip,
  isPlaying = false,
  currentTime = 0,
  duration = 0,
  onTogglePlay,
  onExitExpanded,
  children,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialPref = useMemo(() => getStoredTeleprompterPref(), []);

  const [pipSize, setPipSize] = useState<{ width: number; height: number }>({
    width: initialPref.pipWidth || 320,
    height: initialPref.pipHeight || 180,
  });
  const [pipOffset, setPipOffset] = useState<{ x: number; y: number }>({
    x: initialPref.pipX || 0,
    y: initialPref.pipY || 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [resizingDir, setResizingDir] = useState<PipResizeDir | null>(null);

  // Clamp PiP window inside parent stage on window resize
  useEffect(() => {
    if (!isExpandedPip) return;
    const clampToStage = () => {
      const parent = containerRef.current?.parentElement;
      if (!parent) return;
      const stageW = parent.clientWidth;
      const stageH = parent.clientHeight;
      if (stageW <= 0 || stageH <= 0) return;

      const maxW = Math.max(180, stageW - 24);
      const maxH = Math.max(102, stageH - 24);
      const clampedW = Math.min(pipSize.width, maxW);
      const clampedH = Math.min(pipSize.height, maxH);

      // Anchor is right: 16px, bottom: 16px => x in [-(stageW - clampedW - 24), 8], y in [-(stageH - clampedH - 24), 8]
      const minX = -(stageW - clampedW - 24);
      const minY = -(stageH - clampedH - 24);
      const clampedX = Math.max(minX, Math.min(8, pipOffset.x));
      const clampedY = Math.max(minY, Math.min(8, pipOffset.y));

      if (clampedW !== pipSize.width || clampedH !== pipSize.height) {
        setPipSize({ width: clampedW, height: clampedH });
      }
      if (clampedX !== pipOffset.x || clampedY !== pipOffset.y) {
        setPipOffset({ x: clampedX, y: clampedY });
      }
    };
    clampToStage();
    window.addEventListener('resize', clampToStage);
    return () => window.removeEventListener('resize', clampToStage);
  }, [isExpandedPip, pipSize.width, pipSize.height, pipOffset.x, pipOffset.y]);

  const handleDragStart = (e: React.PointerEvent) => {
    if (!isExpandedPip || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const parent = containerRef.current?.parentElement;
    const stageW = parent?.clientWidth || window.innerWidth;
    const stageH = parent?.clientHeight || window.innerHeight;

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = pipOffset.x;
    const origY = pipOffset.y;
    let moved = false;
    let latestX = origX;
    let latestY = origY;

    setIsDragging(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    const minX = -(stageW - pipSize.width - 24);
    const minY = -(stageH - pipSize.height - 24);

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        moved = true;
      }
      latestX = Math.max(minX, Math.min(8, origX + dx));
      latestY = Math.max(minY, Math.min(8, origY + dy));
      setPipOffset({ x: Math.round(latestX), y: Math.round(latestY) });
    };

    const onUp = () => {
      setIsDragging(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);

      if (moved) {
        saveTeleprompterPref({ pipX: Math.round(latestX), pipY: Math.round(latestY) });
      } else if (onTogglePlay) {
        onTogglePlay();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const handleResizeStart = (dir: PipResizeDir) => (e: React.PointerEvent) => {
    if (!isExpandedPip || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const parent = containerRef.current?.parentElement;
    const stageW = parent?.clientWidth || window.innerWidth;
    const stageH = parent?.clientHeight || window.innerHeight;

    const startX = e.clientX;
    const startY = e.clientY;
    const origW = pipSize.width;
    const origH = pipSize.height;
    const origX = pipOffset.x;
    const origY = pipOffset.y;

    let latestW = origW;
    let latestH = origH;
    let latestX = origX;
    let latestY = origY;

    setResizingDir(dir);
    document.body.style.userSelect = 'none';

    const maxW = Math.min(760, stageW - 24);
    const maxH = Math.min(520, stageH - 24);
    const minW = 180;
    const minH = 102;

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      // Anchor is bottom-right (right: 16px, bottom: 16px)
      // Expanding left ('w', 'nw', 'sw') increases width without moving right edge
      // Expanding right ('e', 'ne', 'se') increases width AND shifts pipOffset.x right
      if (dir.includes('w')) {
        latestW = Math.max(minW, Math.min(maxW, origW - dx));
      } else if (dir.includes('e')) {
        const nextW = Math.max(minW, Math.min(maxW, origW + dx));
        const actualDw = nextW - origW;
        latestW = nextW;
        latestX = Math.min(8, origX + actualDw);
      }

      if (dir.includes('n')) {
        latestH = Math.max(minH, Math.min(maxH, origH - dy));
      } else if (dir.includes('s')) {
        const nextH = Math.max(minH, Math.min(maxH, origH + dy));
        const actualDh = nextH - origH;
        latestH = nextH;
        latestY = Math.min(8, origY + actualDh);
      }

      setPipSize({ width: Math.round(latestW), height: Math.round(latestH) });
      setPipOffset({ x: Math.round(latestX), y: Math.round(latestY) });
    };

    const onUp = () => {
      setResizingDir(null);
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);

      saveTeleprompterPref({
        pipWidth: Math.round(latestW),
        pipHeight: Math.round(latestH),
        pipX: Math.round(latestX),
        pipY: Math.round(latestY),
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const formatTime = (sec: number) => {
    const s = Math.max(0, Math.floor(sec || 0));
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  };

  if (!isExpandedPip) {
    return (
      <div ref={containerRef} className="w-full h-full relative flex items-center justify-center">
        {children}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        right: '16px',
        bottom: '16px',
        width: `${pipSize.width}px`,
        height: `${pipSize.height}px`,
        transform: `translate3d(${pipOffset.x}px, ${pipOffset.y}px, 0)`,
        zIndex: 70,
        '--tp-left': '0px',
        '--tp-right': '0px',
        '--tp-top': '0px',
        '--tp-bottom': '0px',
      } as React.CSSProperties}
      className={cn(
        "rounded-xl bg-black border border-white/20 shadow-[0_16px_44px_rgba(0,0,0,0.9)] overflow-hidden flex items-center justify-center group/pip select-none",
        isDragging ? "ring-2 ring-indigo-500/70" : "",
        resizingDir ? "ring-2 ring-indigo-400/70" : ""
      )}
    >
      {/* Video Element inside PiP */}
      <div
        onPointerDown={handleDragStart}
        className="w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing"
        title="Перетащите для перемещения видео (клик — Пауза/Воспроизведение)"
      >
        {children}
      </div>

      {/* Top Drag & Restore Header Bar (Visible on Hover) */}
      <div
        onPointerDown={handleDragStart}
        className="absolute top-0 left-0 right-0 h-7 px-2.5 bg-gradient-to-b from-black/85 via-black/50 to-transparent flex items-center justify-between opacity-0 group-hover/pip:opacity-100 transition-opacity cursor-grab active:cursor-grabbing z-20"
      >
        <div className="flex items-center gap-1.5 text-zinc-300 text-[10px] font-semibold tracking-wide">
          <GripHorizontal className="w-3.5 h-3.5 text-zinc-400" />
          <span>Мини-видео</span>
        </div>
        {onExitExpanded && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onExitExpanded();
            }}
            className="p-1 rounded hover:bg-white/15 text-zinc-300 hover:text-white transition-colors cursor-pointer"
            title="Вернуть обычное расположение видео и суфлера"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Bottom Mini Playback Bar (Visible on Hover) */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 h-7 px-2.5 bg-gradient-to-t from-black/85 via-black/50 to-transparent flex items-center justify-between opacity-0 group-hover/pip:opacity-100 transition-opacity z-20"
      >
        <div className="flex items-center gap-2">
          {onTogglePlay && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePlay();
              }}
              className="w-5 h-5 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform cursor-pointer"
              title={isPlaying ? 'Пауза' : 'Воспроизведение'}
            >
              {isPlaying ? (
                <Pause className="w-2.5 h-2.5 fill-current" />
              ) : (
                <Play className="w-2.5 h-2.5 fill-current ml-0.5" />
              )}
            </button>
          )}
          <span className="text-[10px] font-mono text-zinc-200 tabular-nums">
            {formatTime(currentTime)} <span className="text-zinc-500">/ {formatTime(duration)}</span>
          </span>
        </div>
      </div>

      {/* Edge & Corner Resize Handles */}
      <div
        onPointerDown={handleResizeStart('nw')}
        className="absolute top-0 left-0 w-3.5 h-3.5 cursor-nwse-resize z-30 group/nw flex items-start justify-start p-0.5"
        title="Изменить размер"
      >
        <div className="w-2 h-2 border-t-2 border-l-2 border-white/30 group-hover/nw:border-indigo-400 rounded-tl-xs" />
      </div>
      <div
        onPointerDown={handleResizeStart('ne')}
        className="absolute top-0 right-0 w-3.5 h-3.5 cursor-nesw-resize z-30"
        title="Изменить размер"
      />
      <div
        onPointerDown={handleResizeStart('sw')}
        className="absolute bottom-0 left-0 w-3.5 h-3.5 cursor-nesw-resize z-30"
        title="Изменить размер"
      />
      <div
        onPointerDown={handleResizeStart('se')}
        className="absolute bottom-0 right-0 w-3.5 h-3.5 cursor-nwse-resize z-30 group/se flex items-end justify-end p-0.5"
        title="Изменить размер"
      >
        <div className="w-2 h-2 border-b-2 border-r-2 border-white/30 group-hover/se:border-indigo-400 rounded-br-xs" />
      </div>
      <div
        onPointerDown={handleResizeStart('w')}
        className="absolute top-3.5 bottom-3.5 left-0 w-1.5 cursor-ew-resize z-20 hover:bg-indigo-500/30 transition-colors"
      />
      <div
        onPointerDown={handleResizeStart('e')}
        className="absolute top-3.5 bottom-3.5 right-0 w-1.5 cursor-ew-resize z-20 hover:bg-indigo-500/30 transition-colors"
      />
      <div
        onPointerDown={handleResizeStart('n')}
        className="absolute top-0 left-3.5 right-3.5 h-1.5 cursor-ns-resize z-20 hover:bg-indigo-500/30 transition-colors"
      />
      <div
        onPointerDown={handleResizeStart('s')}
        className="absolute bottom-0 left-3.5 right-3.5 h-1.5 cursor-ns-resize z-20 hover:bg-indigo-500/30 transition-colors"
      />
    </div>
  );
};
