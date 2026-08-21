import React, { useState, useEffect } from 'react';
import { TeleprompterMode } from '../../types';
import { cn } from '../../lib/utils';
import { saveTeleprompterPref } from './useTeleprompterLayout';

interface TeleprompterResizerProps {
  mode: TeleprompterMode;
  onResize?: (width: number, height: number) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

type ResizeDirection = 'corner' | 'right' | 'bottom' | 'dock-left' | 'dock-right' | 'dock-bottom';

export const TeleprompterResizer: React.FC<TeleprompterResizerProps> = ({
  mode,
  onResize,
  containerRef,
}) => {
  const [activeDirection, setActiveDirection] = useState<ResizeDirection | null>(null);

  useEffect(() => {
    if (activeDirection) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 
        activeDirection === 'right' || activeDirection === 'dock-left' || activeDirection === 'dock-right' 
          ? 'col-resize' 
          : activeDirection === 'bottom' || activeDirection === 'dock-bottom' 
            ? 'row-resize' 
            : 'nwse-resize';
    } else {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [activeDirection]);

  if (mode === 'expanded') return null;

  const startResize = (dir: ResizeDirection) => (e: React.PointerEvent) => {
    if (!onResize || !containerRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    setActiveDirection(dir);
    const startX = e.clientX;
    const startY = e.clientY;
    const initialWidth = containerRef.current.clientWidth || 460;
    const initialHeight = containerRef.current.clientHeight || 200;

    let latestWidth = initialWidth;
    let latestHeight = initialHeight;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      if (dir === 'dock-left') {
        latestWidth = Math.max(260, Math.min(window.innerWidth * 0.75, initialWidth + deltaX));
        onResize(Math.round(latestWidth), initialHeight);
      } else if (dir === 'dock-right') {
        latestWidth = Math.max(260, Math.min(window.innerWidth * 0.75, initialWidth - deltaX));
        onResize(Math.round(latestWidth), initialHeight);
      } else if (dir === 'dock-bottom') {
        latestHeight = Math.max(120, Math.min(window.innerHeight * 0.75, initialHeight - deltaY));
        onResize(initialWidth, Math.round(latestHeight));
      } else if (dir === 'right') {
        latestWidth = Math.max(280, Math.min(window.innerWidth - 40, initialWidth + deltaX));
        onResize(Math.round(latestWidth), initialHeight);
      } else if (dir === 'bottom') {
        latestHeight = Math.max(120, Math.min(window.innerHeight - 40, initialHeight + deltaY));
        onResize(initialWidth, Math.round(latestHeight));
      } else if (dir === 'corner') {
        latestWidth = Math.max(280, Math.min(window.innerWidth - 40, initialWidth + deltaX));
        latestHeight = Math.max(120, Math.min(window.innerHeight - 40, initialHeight + deltaY));
        onResize(Math.round(latestWidth), Math.round(latestHeight));
      }
    };

    const handlePointerUp = () => {
      setActiveDirection(null);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);

      if (mode === 'compact') {
        saveTeleprompterPref({ floatWidth: Math.round(latestWidth), floatHeight: Math.round(latestHeight) });
      } else if (mode === 'left' || mode === 'right') {
        saveTeleprompterPref({ dockWidth: Math.round(latestWidth) });
      } else if (mode === 'bottom') {
        saveTeleprompterPref({ dockHeight: Math.round(latestHeight) });
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  if (mode === 'left') {
    return (
      <div
        style={{ touchAction: 'none' }}
        onPointerDown={startResize('dock-left')}
        className={cn(
          "absolute top-0 right-0 bottom-0 w-2.5 z-30 cursor-col-resize flex items-center justify-center transition-colors group/resizer",
          activeDirection === 'dock-left' ? "bg-indigo-500/60" : "hover:bg-indigo-500/30"
        )}
        title="Перетащите для изменения ширины панели"
      >
        <div className={cn(
          "w-0.5 h-12 rounded-full transition-colors",
          activeDirection === 'dock-left' ? "bg-indigo-300" : "bg-white/20 group-hover/resizer:bg-indigo-400"
        )} />
      </div>
    );
  }

  if (mode === 'right') {
    return (
      <div
        style={{ touchAction: 'none' }}
        onPointerDown={startResize('dock-right')}
        className={cn(
          "absolute top-0 left-0 bottom-0 w-2.5 z-30 cursor-col-resize flex items-center justify-center transition-colors group/resizer",
          activeDirection === 'dock-right' ? "bg-indigo-500/60" : "hover:bg-indigo-500/30"
        )}
        title="Перетащите для изменения ширины панели"
      >
        <div className={cn(
          "w-0.5 h-12 rounded-full transition-colors",
          activeDirection === 'dock-right' ? "bg-indigo-300" : "bg-white/20 group-hover/resizer:bg-indigo-400"
        )} />
      </div>
    );
  }

  if (mode === 'bottom') {
    return (
      <div
        style={{ touchAction: 'none' }}
        onPointerDown={startResize('dock-bottom')}
        className={cn(
          "absolute top-0 left-0 right-0 h-2.5 z-30 cursor-row-resize flex items-center justify-center transition-colors group/resizer",
          activeDirection === 'dock-bottom' ? "bg-indigo-500/60" : "hover:bg-indigo-500/30"
        )}
        title="Перетащите для изменения высоты панели"
      >
        <div className={cn(
          "h-0.5 w-16 rounded-full transition-colors",
          activeDirection === 'dock-bottom' ? "bg-indigo-300" : "bg-white/20 group-hover/resizer:bg-indigo-400"
        )} />
      </div>
    );
  }

  // mode === 'compact' (Floating Window)
  return (
    <>
      {/* Right Edge Resizer */}
      <div
        style={{ touchAction: 'none' }}
        onPointerDown={startResize('right')}
        className={cn(
          "absolute top-8 right-0 bottom-6 w-2 cursor-col-resize z-30 transition-colors",
          activeDirection === 'right' ? "bg-indigo-500/50" : "hover:bg-indigo-500/30"
        )}
        title="Изменить ширину"
      />

      {/* Bottom Edge Resizer */}
      <div
        style={{ touchAction: 'none' }}
        onPointerDown={startResize('bottom')}
        className={cn(
          "absolute bottom-0 left-6 right-6 h-2 cursor-row-resize z-30 transition-colors",
          activeDirection === 'bottom' ? "bg-indigo-500/50" : "hover:bg-indigo-500/30"
        )}
        title="Изменить высоту"
      />

      {/* Bottom-Right Corner Grip */}
      <div
        style={{ touchAction: 'none' }}
        onPointerDown={startResize('corner')}
        className={cn(
          "absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize z-30 flex items-center justify-center group/resize transition-all",
          activeDirection === 'corner' ? "scale-125" : ""
        )}
        title="Изменить размер окна"
      >
        <div className={cn(
          "w-2.5 h-2.5 rounded-br-sm border-r-2 border-b-2 transition-colors",
          activeDirection === 'corner' ? "border-indigo-400" : "border-white/40 group-hover/resize:border-indigo-400"
        )} />
      </div>
    </>
  );
};
