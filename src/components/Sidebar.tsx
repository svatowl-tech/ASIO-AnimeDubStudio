import React from 'react';
import { FileText, SlidersHorizontal, RotateCcw, Plus, X, Check, UserPlus, ChevronDown, Mic, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn, formatTimeHms } from '../lib/utils';
import { Project, SubtitleLine } from '../types';
import { useSyncScriptScroll } from '../hooks/useSyncScriptScroll';
import { UniversalParserService } from '../services/UniversalParserService';
import { getSubtitleCoverageStats } from '../lib/subtitleCoverage';

interface SidebarProps {
  project: Project | null;
  selectedRole: string;
  onRoleChange: (role: string) => void;
  onRolesChange?: (roles: string[]) => void;
  onAddProjectRole?: (newRole: string) => void;
  onAddSubtitlesAsRole?: (subtitles: SubtitleLine[], roles: string[]) => void;
  currentTime: number;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  isPlaying: boolean;
  sidebarScrollTop: number;
  onScroll: (scrollTop: number) => void;
  sidebarRef: React.RefObject<HTMLDivElement | null>;
  width?: number;
  onShiftSubtitles?: (newOffset: number) => void;
  isHighlightingMissingSubtitles?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({
  project,
  selectedRole,
  onRoleChange,
  onRolesChange,
  onAddProjectRole,
  onAddSubtitlesAsRole,
  currentTime,
  onSeek,
  onTogglePlay,
  isPlaying,
  sidebarScrollTop,
  onScroll,
  sidebarRef,
  width = 320,
  onShiftSubtitles,
  isHighlightingMissingSubtitles
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = React.useState(false);
  const [newRoleInput, setNewRoleInput] = React.useState('');
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  const activeRoles = React.useMemo(() => {
    if (!project) return [];
    if (project.selectedRoles && project.selectedRoles.length > 0) {
      return project.selectedRoles;
    }
    return project.selectedRole ? [project.selectedRole] : [];
  }, [project?.selectedRoles, project?.selectedRole]);

  const coverageStats = React.useMemo(() => {
    return getSubtitleCoverageStats(project);
  }, [project]);

  const availableRolesToAdd = React.useMemo(() => {
    if (!project) return [];
    return project.roles.filter(r => !activeRoles.includes(r));
  }, [project?.roles, activeRoles]);

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

  const handleSeekToLine = React.useCallback((startTime: number) => {
    const preroll = project?.audioSettings?.prerollSeconds ?? 3;
    onSeek(Math.max(0, startTime - preroll));
    if (!isPlaying) onTogglePlay();
  }, [project?.audioSettings?.prerollSeconds, onSeek, isPlaying, onTogglePlay]);

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
      const isRoleMatch = activeRoles.length === 0 || activeRoles.includes(subs[i].role);
      if (subs[i].start < searchTime && isRoleMatch) {
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
  }, [project, activeRoles, currentTime, onSeek, handleManualInteraction]);

  const goToNextSubtitle = React.useCallback(() => {
    if (!project || project.subtitles.length === 0) return;
    const subs = project.subtitles;
    const preroll = project?.audioSettings?.prerollSeconds ?? 3;

    // Search for a phrase that starts AFTER current time + preroll + buffer
    // This ensures we skip the subtitle we are currently targeting/viewing
    const searchTime = currentTime + preroll + 0.5;

    let targetSubIndex = -1;
    for (let i = 0; i < subs.length; i++) {
      const isRoleMatch = activeRoles.length === 0 || activeRoles.includes(subs[i].role);
      if (subs[i].start >= searchTime && isRoleMatch) {
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
  }, [project, activeRoles, currentTime, onSeek, handleManualInteraction]);

  return (
    <aside 
      className="flex-shrink-0 border-r border-white/5 flex flex-col bg-zinc-900/30"
      style={{ width: `${width}px` }}
    >
      <div className="p-4 border-b border-white/5">
        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2 block">
          Активные роли
        </label>
        
        <div className="relative mb-3" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="w-full bg-zinc-800 hover:bg-zinc-700/80 border border-white/10 rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500"
            disabled={!project}
          >
            <span className="truncate text-zinc-200">
              {project ? (
                activeRoles.length === 0 ? "Все роли" : 
                activeRoles.length === 1 ? `Роль: ${activeRoles[0]}` :
                `Роли (${activeRoles.length}): ${activeRoles.join(', ')}`
              ) : "Нет ролей"}
            </span>
            <ChevronDown className="w-4 h-4 text-zinc-400 ml-1 flex-shrink-0" />
          </button>
          
          {isDropdownOpen && project && (
            <div className="absolute left-0 right-0 top-full mt-1.5 bg-zinc-800 border border-white/10 rounded-xl shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-1 duration-100 flex flex-col gap-1.5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 px-1 pt-0.5">
                Выберите активных персонажей
              </span>

              {/* Список всех ролей с чекбоксами */}
              <div className="max-h-48 overflow-y-auto custom-scrollbar flex flex-col gap-0.5">
                {(project.roles || []).map(role => {
                  const isChecked = activeRoles.includes(role);
                  // Динамический размер шрифта в зависимости от длины названия, чтобы избежать наложений и обрезки
                  const getRoleFontSizeClass = (name: string) => {
                    const len = name.length;
                    if (len > 25) return "text-[9px] leading-3 py-2";
                    if (len > 18) return "text-[10px] leading-3.5 py-2";
                    if (len > 12) return "text-[11px] leading-4 py-1.5";
                    return "text-xs py-1.5";
                  };
                  const fontSizeClass = getRoleFontSizeClass(role);

                  return (
                    <div
                      key={role}
                      className={cn(
                        "group w-full flex items-center justify-between rounded-md transition-colors overflow-hidden flex-shrink-0 min-h-[32px]",
                        isChecked 
                          ? "bg-indigo-600/10 text-indigo-300 hover:bg-indigo-600/15" 
                          : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                      )}
                    >
                      {/* Клик по названию роли — делает только её активной */}
                      <button
                        type="button"
                        onClick={() => {
                          if (onRolesChange) {
                            onRolesChange([role]);
                          }
                        }}
                        className={cn(
                          "flex-1 text-left px-2.5 truncate font-medium focus:outline-none",
                          fontSizeClass
                        )}
                        title={`Показать только роль ${role}`}
                      >
                        {role}
                      </button>

                      {/* Клик по чекбоксу — переключает мультивыбор */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!onRolesChange) return;
                          let updated: string[];
                          if (isChecked) {
                            if (activeRoles.length > 1) {
                              updated = activeRoles.filter(r => r !== role);
                            } else {
                              return; // Нельзя снять последнюю роль
                            }
                          } else {
                            updated = [...activeRoles, role];
                          }
                          onRolesChange(updated);
                        }}
                        className="px-2.5 hover:bg-indigo-600/20 focus:outline-none flex items-center justify-center border-l border-white/5 self-stretch"
                        title={isChecked ? "Исключить из активных" : "Добавить к активным"}
                      >
                        {isChecked ? (
                          <Check className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                        ) : (
                          <Plus className="w-3.5 h-3.5 text-zinc-600 hover:text-zinc-400 flex-shrink-0" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Добавление персонажа из файла субтитров */}
              {onAddSubtitlesAsRole && (
                <div className="border-t border-white/5 pt-2 mt-0.5 px-1 pb-0.5">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 block mb-1.5">
                    Загрузить нового персонажа из файла сабов
                  </span>
                  <label className="flex items-center justify-center gap-1.5 px-2.5 py-2 bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/20 text-indigo-300 rounded-lg text-xs font-medium cursor-pointer transition-all active:scale-[0.98]">
                    <Plus className="w-3.5 h-3.5" />
                    <span>Выбрать файл сабов...</span>
                    <input
                      type="file"
                      accept=".srt,.vtt,.ass,.csv,.txt"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          let content: string | ArrayBuffer;
                          if (file.name.toLowerCase().endsWith('.epub') || file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.pdf')) {
                            content = await file.arrayBuffer();
                          } else {
                            content = await file.text();
                          }
                          
                          const parsed = await UniversalParserService.parse(content, file.name);
                          if (!parsed || parsed.length === 0) {
                            alert("Файл пуст или имеет неверную структуру.");
                            return;
                          }
                          
                          const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
                          
                          // Determine roles inside the file
                          const uniqueRolesInFile = Array.from(new Set(parsed.map(s => s.role)));
                          const hasOnlyDefault = uniqueRolesInFile.length === 1 && uniqueRolesInFile[0] === 'Default';
                          
                          const mappedLines = parsed.map((line, idx) => {
                            const isDefault = !line.role || line.role === 'Default' || line.role === 'default';
                            return {
                              ...line,
                              id: `loaded-sub-${idx}-${Date.now()}`,
                              role: isDefault ? fileNameWithoutExt : line.role
                            };
                          });
                          
                          const finalRoles = hasOnlyDefault ? [fileNameWithoutExt] : Array.from(new Set(mappedLines.map(s => s.role)));
                          
                          onAddSubtitlesAsRole(mappedLines, finalRoles);
                          e.target.value = ''; // Reset file input
                        } catch (err) {
                          alert(`Ошибка при загрузке файла: ${err instanceof Error ? err.message : String(err)}`);
                        }
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>

        {project && coverageStats.totalTargetLines > 0 && (
          <div className="mb-3 p-2.5 bg-zinc-800/60 border border-white/5 rounded-xl flex flex-col gap-1.5 font-sans">
            <div className="flex justify-between items-center text-[11px]">
              <span className="font-bold text-zinc-300">
                Записано: {coverageStats.recordedLinesCount} из {coverageStats.totalTargetLines}
              </span>
              {coverageStats.unrecordedLinesCount > 0 ? (
                <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                  Осталось: {coverageStats.unrecordedLinesCount}
                </span>
              ) : (
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 flex items-center gap-0.5">
                  <Check className="w-3 h-3" /> 100%
                </span>
              )}
            </div>
            <div className="w-full bg-zinc-950 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.round(
                    (coverageStats.recordedLinesCount / coverageStats.totalTargetLines) * 100
                  )}%`,
                }}
              />
            </div>
          </div>
        )}
        
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

        {project && onShiftSubtitles && (
          <div className="mt-4 pt-4 border-t border-white/5 flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-1.5 font-sans">
                <SlidersHorizontal className="w-3 h-3 text-rose-500" />
                Сдвиг субтитров
              </span>
              <span className={cn(
                "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded",
                (project.subtitlesOffset || 0) === 0 
                  ? "text-zinc-500 bg-zinc-800/30" 
                  : (project.subtitlesOffset || 0) > 0 
                    ? "text-emerald-400 bg-emerald-500/10" 
                    : "text-rose-400 bg-rose-500/10"
              )}>
                {(project.subtitlesOffset || 0) > 0 ? '+' : ''}{(project.subtitlesOffset || 0).toFixed(1)}s
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input 
                type="range"
                min="-10"
                max="10"
                step="0.1"
                value={project.subtitlesOffset || 0}
                onChange={(e) => onShiftSubtitles(parseFloat(e.target.value))}
                className="flex-1 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
              />
              <button
                onClick={() => onShiftSubtitles(0)}
                disabled={(project.subtitlesOffset || 0) === 0}
                className="p-1 text-zinc-500 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-500 transition-colors rounded hover:bg-zinc-800"
                title="Сбросить сдвиг"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
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
            {(project.subtitles || []).map((line, index) => {
              const isActive = index === currentLineIndex;
              const isLineRoleActive = activeRoles.length === 0 || activeRoles.includes(line.role);
              const isRecorded = coverageStats.recordedLineIds.has(line.id);
              const isUnrecorded = coverageStats.unrecordedLineIds.has(line.id);

              return (
                <SubtitleItem
                  key={line.id}
                  line={line}
                  isActive={isActive}
                  isLineRoleActive={isLineRoleActive}
                  isRecorded={isRecorded}
                  isUnrecorded={isUnrecorded}
                  isHighlightingMissingSubtitles={!!isHighlightingMissingSubtitles}
                  onSeekToTime={handleSeekToLine}
                />
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

interface SubtitleItemProps {
  line: SubtitleLine;
  isActive: boolean;
  isLineRoleActive: boolean;
  isRecorded?: boolean;
  isUnrecorded?: boolean;
  isHighlightingMissingSubtitles?: boolean;
  onSeekToTime: (startTime: number) => void;
}

const SubtitleItem = React.memo<SubtitleItemProps>(({
  line,
  isActive,
  isLineRoleActive,
  isRecorded,
  isUnrecorded,
  isHighlightingMissingSubtitles,
  onSeekToTime
}) => {
  const { start } = line;
  const handleClick = React.useCallback(() => {
    onSeekToTime(start);
  }, [onSeekToTime, start]);

  const showHighlight = isHighlightingMissingSubtitles && isUnrecorded;

  return (
    <div 
      id={`sub-${line.id}`}
      className={cn(
        "p-3 rounded-xl border transition-all cursor-pointer flex flex-col min-h-[80px] relative overflow-hidden",
        showHighlight
          ? "bg-amber-500/15 border-amber-500/80 shadow-[0_0_20px_rgba(245,158,11,0.25)] ring-2 ring-amber-500 ring-offset-1 ring-offset-zinc-950 animate-pulse"
          : line.needsFix
            ? "bg-rose-500/10 border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.1)]"
            : isLineRoleActive 
              ? "bg-blue-500/10 border-blue-500/30 shadow-[0_0_10px_rgba(59,130,246,0.05)]" 
              : "bg-zinc-800/20 border-white/5 opacity-40",
        isActive && !line.needsFix && !showHighlight && "ring-2 ring-blue-500 ring-offset-2 ring-offset-zinc-950 shadow-lg shadow-blue-500/20",
        isActive && line.needsFix && !showHighlight && "ring-2 ring-rose-500 ring-offset-2 ring-offset-zinc-950 shadow-lg shadow-rose-500/30"
      )}
      onClick={handleClick}
    >
      <div className="flex justify-between items-center mb-1 flex-shrink-0 gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-bold text-zinc-400 truncate">{line.role}</span>
          {isLineRoleActive && (
            isRecorded ? (
              <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20 flex items-center gap-0.5">
                <Check className="w-2.5 h-2.5" />
                Записано
              </span>
            ) : (
              <span className="text-[9px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/20">
                Не записано
              </span>
            )
          )}
        </div>
        <span className="text-[10px] font-mono text-zinc-500 flex-shrink-0">{formatTimeHms(line.start ?? 0)}</span>
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
});

SubtitleItem.displayName = 'SubtitleItem';
