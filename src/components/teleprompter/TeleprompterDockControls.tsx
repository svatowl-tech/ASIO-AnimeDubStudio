import React from 'react';
import { PanelLeft, PanelRight, PanelBottom, PanelTop, Move, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { TeleprompterMode } from '../../types';

interface TeleprompterDockControlsProps {
  mode: TeleprompterMode;
  onModeChange: (mode: TeleprompterMode) => void;
  variant?: 'inline' | 'grid';
}

export const TeleprompterDockControls: React.FC<TeleprompterDockControlsProps> = ({
  mode,
  onModeChange,
  variant = 'grid',
}) => {
  const dockOptions: { id: TeleprompterMode; label: string; icon: React.ReactNode; tooltip: string }[] = [
    {
      id: 'bottom',
      label: 'Снизу',
      icon: <PanelBottom className="w-3.5 h-3.5 shrink-0" />,
      tooltip: 'Привязать снизу (сдвигает видео вверх)',
    },
    {
      id: 'top',
      label: 'Сверху',
      icon: <PanelTop className="w-3.5 h-3.5 shrink-0" />,
      tooltip: 'Привязать сверху (сдвигает видео вниз)',
    },
    {
      id: 'left',
      label: 'Слева',
      icon: <PanelLeft className="w-3.5 h-3.5 shrink-0" />,
      tooltip: 'Привязать слева (сдвигает видео вправо)',
    },
    {
      id: 'right',
      label: 'Справа',
      icon: <PanelRight className="w-3.5 h-3.5 shrink-0" />,
      tooltip: 'Привязать справа (сдвигает видео влево)',
    },
    {
      id: 'compact',
      label: 'Плавающий',
      icon: <Move className="w-3.5 h-3.5 shrink-0" />,
      tooltip: 'Свободное перемещение поверх экрана',
    },
    {
      id: 'expanded',
      label: 'Экран',
      icon: mode === 'expanded' ? <Minimize2 className="w-3.5 h-3.5 shrink-0" /> : <Maximize2 className="w-3.5 h-3.5 shrink-0" />,
      tooltip: mode === 'expanded' ? 'Свернуть из полноэкранного режима' : 'Во весь экран',
    },
  ];

  return (
    <div 
      className={cn(
        variant === 'grid'
          ? "grid grid-cols-3 gap-1 bg-zinc-900/90 rounded-lg p-1 border border-white/10"
          : "flex items-center bg-black/60 backdrop-blur-md rounded-lg p-0.5 border border-white/10 shadow-sm"
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {dockOptions.map((opt) => {
        const isActive = mode === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onModeChange(opt.id === 'expanded' && mode === 'expanded' ? 'bottom' : opt.id)}
            title={opt.tooltip}
            className={cn(
              "flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold tracking-tight transition-all cursor-pointer select-none whitespace-nowrap",
              isActive
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-white hover:bg-white/10"
            )}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
};

