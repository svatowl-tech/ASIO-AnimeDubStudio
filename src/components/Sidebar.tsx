import React from 'react';
import { FileText } from 'lucide-react';
import { cn } from '../lib/utils';
import { Project } from '../types';
import { useSyncScriptScroll } from '../hooks/useSyncScriptScroll';

interface SidebarProps {
  project: Project | null;
  selectedRole: string;
  onRoleChange: (role: string) => void;
  currentTime: number;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  isPlaying: boolean;
  sidebarScrollTop: number;
  onScroll: (scrollTop: number) => void;
  sidebarRef: React.RefObject<HTMLDivElement | null>;
  width?: number;
}

const Sidebar: React.FC<SidebarProps> = ({
  project,
  selectedRole,
  onRoleChange,
  currentTime,
  onSeek,
  onTogglePlay,
  isPlaying,
  sidebarScrollTop,
  onScroll,
  sidebarRef,
  width = 320
}) => {
  const currentLineIndex = React.useMemo(() => {
    if (!project || project.subtitles.length === 0) return 0;
    const subs = project.subtitles;
    
    // 1. Try to find the exact active line
    const exactIndex = subs.findIndex(s => currentTime >= s.start && currentTime <= s.end);
    if (exactIndex !== -1) return exactIndex;
    
    // 2. Otherwise find the subtitle with the minimum distance to currentTime
    let minDistance = Infinity;
    let nearestIndex = 0;
    for (let i = 0; i < subs.length; i++) {
      const s = subs[i];
      let dist = 0;
      if (currentTime < s.start) {
        dist = s.start - currentTime;
      } else if (currentTime > s.end) {
        dist = currentTime - s.end;
      }
      if (dist < minDistance) {
        minDistance = dist;
        nearestIndex = i;
      }
    }
    return nearestIndex;
  }, [project, currentTime]);

  const { handleManualInteraction } = useSyncScriptScroll(currentTime, project?.subtitles || [], sidebarRef);

  const goToPrevSubtitle = React.useCallback(() => {
    if (!project || project.subtitles.length === 0) return;
    const subs = project.subtitles;
    const preroll = project?.audioSettings?.prerollSeconds ?? 3;

    // Search for a phrase that started BEFORE current time minus a buffer
    // Adding 0.6s buffer ensures we don't jump to the start of the current subtitle if we're near its beginning
    const searchTime = currentTime - 0.6;

    let targetSubIndex = -1;
    for (let i = subs.length - 1; i >= 0; i--) {
      if (subs[i].start < searchTime && (subs[i].role === selectedRole || !selectedRole)) {
        targetSubIndex = i;
        break;
      }
    }

    if (targetSubIndex !== -1) {
      onSeek(Math.max(0, subs[targetSubIndex].start - preroll));
    } else {
      onSeek(0);
    }

    handleManualInteraction();
    window.dispatchEvent(new CustomEvent('syncScroll'));
  }, [project, selectedRole, currentTime, onSeek, handleManualInteraction]);

  const goToNextSubtitle = React.useCallback(() => {
    if (!project || project.subtitles.length === 0) return;
    const subs = project.subtitles;
    const preroll = project?.audioSettings?.prerollSeconds ?? 3;

    // Search for a phrase that starts AFTER current time + preroll + buffer
    // This ensures we skip the subtitle we are currently targeting/viewing
    const searchTime = currentTime + preroll + 0.5;

    let targetSubIndex = -1;
    for (let i = 0; i < subs.length; i++) {
      if (subs[i].start >= searchTime && (subs[i].role === selectedRole || !selectedRole)) {
        targetSubIndex = i;
        break;
      }
    }

    // Fallback: if no match for role, find any next subtitle
    if (targetSubIndex === -1) {
       targetSubIndex = subs.findIndex(s => s.start > currentTime + 0.5);
    }

    if (targetSubIndex !== -1) {
      onSeek(Math.max(0, subs[targetSubIndex].start - preroll));
      handleManualInteraction();
      window.dispatchEvent(new CustomEvent('syncScroll'));
    } else {
      // If nothing ahead, go to the end of the script
      const maxEnd = project.subtitles[project.subtitles.length - 1]?.end || currentTime;
      onSeek(maxEnd);
      handleManualInteraction();
      window.dispatchEvent(new CustomEvent('syncScroll'));
    }
  }, [project, selectedRole, currentTime, onSeek, handleManualInteraction]);

  return (
    <aside 
      className="flex-shrink-0 border-r border-white/5 flex flex-col bg-zinc-900/30"
      style={{ width: `${width}px` }}
    >
      <div className="p-4 border-b border-white/5">
        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2 block">Активная роль</label>
        <select 
          value={selectedRole}
          onChange={(e) => onRoleChange(e.target.value)}
          className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-3"
          disabled={!project}
        >
          {project?.roles.map(role => (
            <option key={role} value={role}>{role}</option>
          ))}
          {!project && <option value="">Нет ролей</option>}
        </select>
        
        {project && (
          <div className="flex gap-2">
            <button 
              onClick={goToPrevSubtitle}
              className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-white/5 rounded-lg text-[10px] font-bold text-zinc-300 transition-colors uppercase tracking-wider"
              disabled={currentTime <= 0.1}
            >
              Пред.
            </button>
            <button 
              onClick={goToNextSubtitle}
              className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-white/5 rounded-lg text-[10px] font-bold text-zinc-300 transition-colors uppercase tracking-wider"
              disabled={false}
            >
              След.
            </button>
          </div>
        )}
      </div>
      
      <div 
        ref={sidebarRef}
        onScroll={(e) => {
          onScroll(e.currentTarget.scrollTop);
          handleManualInteraction();
        }}
        onWheel={handleManualInteraction}
        onTouchMove={handleManualInteraction}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2 block">Сценарий</label>
        {project ? (
          <div className="flex flex-col gap-4 pb-20">
            {project.subtitles.map((line, index) => {
              const isActive = index === currentLineIndex;

              return (
                <div 
                  key={line.id}
                  id={`sub-${line.id}`}
                  className={cn(
                    "p-3 rounded-xl border transition-all cursor-pointer flex flex-col min-h-[80px]",
                    line.needsFix
                      ? "bg-rose-500/10 border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.1)]"
                      : line.role === selectedRole 
                        ? "bg-blue-500/10 border-blue-500/30" 
                        : "bg-zinc-800/20 border-white/5 opacity-50",
                    isActive && !line.needsFix && "ring-2 ring-blue-500 ring-offset-2 ring-offset-zinc-950 shadow-lg shadow-blue-500/20",
                    isActive && line.needsFix && "ring-2 ring-rose-500 ring-offset-2 ring-offset-zinc-950 shadow-lg shadow-rose-500/30"
                  )}
                  onClick={() => {
                    const preroll = project?.audioSettings?.prerollSeconds ?? 3;
                    onSeek(Math.max(0, line.start - preroll));
                    if (!isPlaying) onTogglePlay();
                  }}
                >
                  <div className="flex justify-between items-center mb-1 flex-shrink-0">
                    <span className="text-[10px] font-bold text-zinc-400">{line.role}</span>
                    <span className="text-[10px] font-mono text-zinc-500">{(line.start ?? 0).toFixed(1)}s</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
                    <p style={{
                      fontSize: line.text.length < 40 ? '14px' : line.text.length < 80 ? '12px' : line.text.length < 150 ? '10px' : '8px',
                      lineHeight: line.text.length < 40 ? '1.4' : line.text.length < 80 ? '1.3' : line.text.length < 150 ? '1.2' : '1.1'
                    }}>{line.text}</p>
                    
                    {line.needsFix && line.fixComment && (
                      <div className="mt-2 text-[10px] text-rose-300 bg-rose-500/10 p-2 rounded border border-rose-500/20">
                        <span className="font-bold uppercase tracking-widest text-[8px] opacity-70 block mb-0.5">Правка от куратора:</span>
                        {line.fixComment}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-4">
            <FileText className="w-12 h-12 opacity-20" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-center">Сценарий не загружен</p>
          </div>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
