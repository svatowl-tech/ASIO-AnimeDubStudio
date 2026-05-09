import React from 'react';
import { FileText } from 'lucide-react';
import { cn } from '../lib/utils';
import { Project } from '../types';

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
    if (!project) return -1;
    // Prioritize selected role
    const roleMatch = project.subtitles.findIndex(s => currentTime >= s.start && currentTime <= s.end && s.role === selectedRole);
    if (roleMatch !== -1) return roleMatch;
    // Fallback to any matching line
    return project.subtitles.findIndex(s => currentTime >= s.start && currentTime <= s.end);
  }, [project, currentTime, selectedRole]);

  React.useEffect(() => {
    if (currentLineIndex !== undefined && currentLineIndex !== -1 && sidebarRef.current) {
      const itemHeight = 80;
      const targetScroll = currentLineIndex * itemHeight - (sidebarRef.current.clientHeight / 2) + (itemHeight / 2);
      
      // Only auto-scroll if it's not being manually scrolled or if it's a significant jump
      sidebarRef.current.scrollTo({
        top: targetScroll,
        behavior: 'smooth'
      });
    }
  }, [currentLineIndex, sidebarRef]);

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
              onClick={() => {
                const subs = project.subtitles;
                const prev = subs.slice().reverse().find(s => s.role === selectedRole && s.start < currentTime - 0.5);
                if (prev) {
                  const preroll = project?.audioSettings?.prerollSeconds ?? 3;
                  onSeek(Math.max(0, prev.start - preroll));
                }
              }}
              className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-white/5 rounded-lg text-[10px] font-bold text-zinc-300 transition-colors uppercase tracking-wider"
              disabled={!project.subtitles.some(s => s.role === selectedRole && s.start < currentTime - 0.5)}
            >
              Пред.
            </button>
            <button 
              onClick={() => {
                const subs = project.subtitles;
                const next = subs.find(s => s.role === selectedRole && s.start > currentTime + 0.5);
                if (next) {
                  const preroll = project?.audioSettings?.prerollSeconds ?? 3;
                  onSeek(Math.max(0, next.start - preroll));
                }
              }}
              className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-white/5 rounded-lg text-[10px] font-bold text-zinc-300 transition-colors uppercase tracking-wider"
              disabled={!project.subtitles.some(s => s.role === selectedRole && s.start > currentTime + 0.5)}
            >
              След.
            </button>
          </div>
        )}
      </div>
      
      <div 
        ref={sidebarRef}
        onScroll={(e) => onScroll(e.currentTarget.scrollTop)}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2 block">Сценарий</label>
        {project ? (
          <div style={{ height: `${project.subtitles.length * 80}px`, position: 'relative' }}>
            {project.subtitles.map((line, index) => {
              const itemHeight = 80;
              const visibleStart = sidebarScrollTop;
              const visibleEnd = sidebarScrollTop + 600; // sidebar height
              const itemTop = index * itemHeight;
              
              if (itemTop + itemHeight < visibleStart - 200 || itemTop > visibleEnd + 200) return null;

              const isActive = index === currentLineIndex;

              return (
                <div 
                  key={line.id}
                  style={{ position: 'absolute', top: `${itemTop}px`, left: 0, right: 0, height: `${itemHeight - 16}px` }}
                  className={cn(
                    "p-3 rounded-xl border transition-all cursor-pointer flex flex-col",
                    line.role === selectedRole 
                      ? "bg-blue-500/10 border-blue-500/30" 
                      : "bg-zinc-800/20 border-white/5 opacity-50",
                    isActive && "ring-2 ring-blue-500 ring-offset-2 ring-offset-zinc-950 shadow-lg shadow-blue-500/20"
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
