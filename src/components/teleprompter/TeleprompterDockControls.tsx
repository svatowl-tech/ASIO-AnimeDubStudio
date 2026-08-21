import React from 'react';
import { PanelLeft, PanelRight, PanelBottom, Move, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { TeleprompterMode } from '../../types';

interface TeleprompterDockControlsProps {
  mode: TeleprompterMode;
  onModeChange: (mode: TeleprompterMode) => void;
}

export const TeleprompterDockControls: React.FC<TeleprompterDockControlsProps> = ({
  mode,
  onModeChange,
}) => {
  const dockOptions: { id: TeleprompterMode; label: string; icon: React.ReactNode; tooltip: string }[] = [
    {
      id: 'left',
      label: 'Слева',
      icon: <PanelLeft className="w-3.5 h-3.5" />,
      tooltip: 'Привязать влево (Reaper-style)',
    },
    {
      id: 'right',
      label: 'Справа',
      icon: <PanelRight className="w-3.5 h-3.5" />,
      tooltip: 'Привязать вправо (Reaper-style)',
    },
    {
      id: 'bottom',
      label: 'Снизу',
      icon: <PanelBottom className="w-3.5 h-3.5" />,
      tooltip: 'Привязать снизу',
    },
    {
      id: 'compact',
      label: 'Плавающее',
      icon: <Move className="w-3.5 h-3.5" />,
      tooltip: 'Свободное перемещение',
    },
    {
      id: 'expanded',
      label: 'Экран',
      icon: mode === 'expanded' ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />,
      tooltip: mode === 'expanded' ? 'Свернуть из полноэкранного режима' : 'Во весь экран',
    },
  ];

  return (
    <div 
      className="flex items-center bg-black/60 backdrop-blur-md rounded-lg p-0.5 border border-white/10 shadow-sm"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {dockOptions.map((opt) => {
        const isActive = mode === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onModeChange(opt.id === 'expanded' && mode === 'expanded' ? 'left' : opt.id)}
            title={opt.tooltip}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold tracking-tight transition-all cursor-pointer select-none",
              isActive
                ? "bg-indigo-600 text-white shadow-[0_0_10px_rgba(79,70,229,0.5)]"
                : "text-zinc-400 hover:text-white hover:bg-white/10"
            )}
          >
            {opt.icon}
            <span className="hidden sm:inline">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
};
