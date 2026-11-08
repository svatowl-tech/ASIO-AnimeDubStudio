import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Minus,
  Plus,
  GripVertical,
  Settings,
  Check,
  ChevronUp,
  ChevronDown,
  PanelBottom,
  PanelTop,
  PanelLeft,
  PanelRight,
  Move,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { SubtitleLine, TeleprompterMode } from '../types';
import { TeleprompterResizer } from './teleprompter/TeleprompterResizer';
import { getStoredTeleprompterPref, saveTeleprompterPref } from './teleprompter/useTeleprompterLayout';

export const Teleprompter = ({ 
  subtitles, 
  currentTime, 
  mode = 'bottom',
  fontSize,
  lineHeight,
  pacing,
  activeRole,
  dragControls,
  onFontSizeChange,
  onLineHeightChange,
  onPacingChange,
  onModeChange,
  onResize,
  onSeek
}: { 
  subtitles: SubtitleLine[], 
  currentTime: number,
  mode?: TeleprompterMode,
  fontSize: number,
  lineHeight: number,
  pacing: 'auto' | 'manual',
  activeRole: string,
  dragControls?: any,
  onFontSizeChange: (size: number) => void,
  onLineHeightChange: (height: number) => void,
  onPacingChange: (pacing: 'auto' | 'manual') => void,
  onModeChange: (mode: TeleprompterMode) => void,
  onResize?: (width: number, height: number) => void,
  onSeek?: (time: number) => void
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const gearBtnRef = useRef<HTMLButtonElement>(null);

  const initialPref = useMemo(() => getStoredTeleprompterPref(), []);
  const [autoFit, setAutoFit] = useState<boolean>(initialPref.autoFit ?? true);
  const [speed, setSpeed] = useState<number>(initialPref.speed ?? 1);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [containerWidth, setContainerWidth] = useState<number>(560);
  const [manualStepOffset, setManualStepOffset] = useState<number>(0);

  const isSettingsOpen = menuAnchor !== null;

  // Measure container width for dynamic long-replica font scaling
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateWidth = () => {
      if (el.clientWidth > 0) {
        setContainerWidth(el.clientWidth);
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode]);

  // Clamp context menu coordinates to viewport so it never goes off-screen or behind panels
  useLayoutEffect(() => {
    if (!menuAnchor) return;
    const win = containerRef.current?.ownerDocument?.defaultView || window;
    const menuEl = menuRef.current;
    const menuW = menuEl?.offsetWidth || 236;
    const menuH = menuEl?.offsetHeight || 340;
    const pad = 8;

    let left = menuAnchor.x;
    let top = menuAnchor.y;

    if (left + menuW + pad > win.innerWidth) {
      left = Math.max(pad, win.innerWidth - menuW - pad);
    }
    if (top + menuH + pad > win.innerHeight) {
      top = Math.max(pad, menuAnchor.y - menuH - 6);
    }
    left = Math.max(pad, left);
    top = Math.max(pad, top);

    setMenuPos({ left, top });
  }, [menuAnchor]);

  // Close context menu on outside click, Escape, or window resize
  useEffect(() => {
    if (!isSettingsOpen) return;
    const doc = containerRef.current?.ownerDocument || document;
    const win = doc.defaultView || window;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        gearBtnRef.current &&
        !gearBtnRef.current.contains(target)
      ) {
        setMenuAnchor(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuAnchor(null);
    };
    const handleScrollOrResize = () => {
      setMenuAnchor(null);
    };

    doc.addEventListener('pointerdown', handlePointerDown, true);
    win.addEventListener('keydown', handleKeyDown);
    win.addEventListener('resize', handleScrollOrResize);
    return () => {
      doc.removeEventListener('pointerdown', handlePointerDown, true);
      win.removeEventListener('keydown', handleKeyDown);
      win.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isSettingsOpen]);

  const handleOpenMenuAtGear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (menuAnchor) {
      setMenuAnchor(null);
      return;
    }
    const rect = gearBtnRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuAnchor({ x: rect.right - 236, y: rect.bottom + 6 });
    } else {
      setMenuAnchor({ x: e.clientX, y: e.clientY });
    }
  }, [menuAnchor]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuAnchor({ x: e.clientX, y: e.clientY });
  }, []);

  // Filter subtitles by activeRole if selected, falling back to all subtitles if none match
  const roleSubtitles = useMemo(() => {
    const all = subtitles || [];
    if (!activeRole) return all;
    const filtered = all.filter(s => s.role === activeRole);
    return filtered.length > 0 ? filtered : all;
  }, [subtitles, activeRole]);

  // Reset manual offset when switching back to auto pacing
  useEffect(() => {
    if (pacing === 'auto') {
      setManualStepOffset(0);
    }
  }, [pacing, currentTime]);

  // Find current active line and upcoming line
  const activeIndex = useMemo(() => {
    return roleSubtitles.findIndex(s => currentTime >= s.start && currentTime <= s.end);
  }, [roleSubtitles, currentTime]);

  const nextIndex = useMemo(() => {
    return roleSubtitles.findIndex(s => s.start > currentTime);
  }, [roleSubtitles, currentTime]);

  const baseAnchorIndex = useMemo(() => {
    if (activeIndex !== -1) return activeIndex;
    if (nextIndex !== -1) return nextIndex;
    return roleSubtitles.length > 0 ? roleSubtitles.length - 1 : -1;
  }, [activeIndex, nextIndex, roleSubtitles.length]);

  const effectiveIndex = useMemo(() => {
    if (baseAnchorIndex === -1) return -1;
    if (pacing === 'manual') {
      return Math.max(0, Math.min(roleSubtitles.length - 1, baseAnchorIndex + manualStepOffset));
    }
    return baseAnchorIndex;
  }, [baseAnchorIndex, pacing, manualStepOffset, roleSubtitles.length]);

  const primaryLine = effectiveIndex !== -1 ? roleSubtitles[effectiveIndex] : null;
  const secondaryLine =
    effectiveIndex !== -1 && effectiveIndex + 1 < roleSubtitles.length
      ? roleSubtitles[effectiveIndex + 1]
      : null;

  const isPrimaryCurrentlySpeaking =
    !!primaryLine && currentTime >= primaryLine.start && currentTime <= primaryLine.end;

  const timeToNext =
    !isPrimaryCurrentlySpeaking && primaryLine && primaryLine.start > currentTime
      ? Math.max(0, primaryLine.start - currentTime)
      : null;

  const remainingSpeakTime =
    isPrimaryCurrentlySpeaking && primaryLine
      ? Math.max(0, primaryLine.end - currentTime)
      : null;

  // Traffic light state ("принцип светофора"):
  // - 'green': currently speaking (currentTime >= start && currentTime <= end)
  // - 'yellow': <= 1.5 seconds before replica starts
  // - 'red': > 1.5 seconds before replica starts
  // - 'idle': after last replica finished
  const trafficState = useMemo<'red' | 'yellow' | 'green' | 'idle'>(() => {
    if (!primaryLine) return 'idle';
    if (isPrimaryCurrentlySpeaking) return 'green';
    if (timeToNext !== null) {
      return timeToNext <= 1.5 ? 'yellow' : 'red';
    }
    return 'idle';
  }, [primaryLine, isPrimaryCurrentlySpeaking, timeToNext]);

  const activeProgress = useMemo(() => {
    if (!primaryLine || !isPrimaryCurrentlySpeaking) return 0;
    const dur = Math.max(0.1, primaryLine.end - primaryLine.start);
    return Math.max(0, Math.min(100, ((currentTime - primaryLine.start) / dur) * 100));
  }, [primaryLine, isPrimaryCurrentlySpeaking, currentTime]);

  // Manual keyboard & wheel navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (pacing === 'manual') {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setManualStepOffset(prev => prev + 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setManualStepOffset(prev => prev - 1);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pacing]);

  const handleWheel = (e: React.WheelEvent) => {
    if (pacing === 'manual' && roleSubtitles.length > 0) {
      e.stopPropagation();
      const step = e.deltaY > 0 ? 1 : -1;
      setManualStepOffset(prev => prev + step);
    }
  };

  // Dynamic font-size calculation for long lines so the entire replica fits without head movement
  const effectiveFontSize = useMemo(() => {
    const rawBase = fontSize || 22;
    const base = mode === 'expanded' ? Math.round(rawBase * 1.35) : rawBase;
    if (!autoFit || !primaryLine?.text) return base;

    const textLen = primaryLine.text.trim().length;
    const availWidth = Math.max(180, containerWidth - 96);
    const approxCharsPerLine = Math.max(16, availWidth / (base * 0.56));
    const estimatedLines = textLen / approxCharsPerLine;

    if (estimatedLines <= 1.35) return base;

    const scaleFactor = Math.max(0.56, Math.min(1, Math.pow(1.35 / estimatedLines, 0.44)));
    const minLegibleSize = mode === 'left' || mode === 'right' ? 14 : mode === 'expanded' ? 18 : 15;
    return Math.max(minLegibleSize, Math.round(base * scaleFactor));
  }, [fontSize, autoFit, primaryLine?.text, containerWidth, mode]);

  const secondaryFontSize = useMemo(() => {
    return Math.max(12, Math.round(effectiveFontSize * 0.72));
  }, [effectiveFontSize]);

  const handleModeSelect = (newMode: TeleprompterMode) => {
    const stored = getStoredTeleprompterPref();
    onModeChange(newMode);
    saveTeleprompterPref({ mode: newMode });
    if (onResize) {
      if (newMode === 'left' || newMode === 'right') {
        onResize(stored.dockWidth || 320, stored.dockHeight || 68);
      } else if (newMode === 'top' || newMode === 'bottom') {
        onResize(stored.dockWidth || 320, stored.dockHeight || 68);
      } else if (newMode === 'compact') {
        onResize(stored.floatWidth || 640, stored.floatHeight || 68);
      }
    }
    setMenuAnchor(null);
  };

  const handleToggleAutoFit = () => {
    const next = !autoFit;
    setAutoFit(next);
    saveTeleprompterPref({ autoFit: next });
  };

  const handleSpeedStep = (delta: number) => {
    const next = Math.max(0.5, Math.min(2.5, Number((speed + delta).toFixed(1))));
    setSpeed(next);
    saveTeleprompterPref({ speed: next });
  };

  const isVerticalDock = mode === 'left' || mode === 'right';
  const isStripMode = mode === 'bottom' || mode === 'top' || mode === 'compact';

  const modeMenuItems: { id: TeleprompterMode; label: string; icon: React.ReactNode }[] = [
    { id: 'bottom', label: 'Привязать снизу', icon: <PanelBottom className="w-3.5 h-3.5 text-zinc-400" /> },
    { id: 'top', label: 'Привязать сверху', icon: <PanelTop className="w-3.5 h-3.5 text-zinc-400" /> },
    { id: 'left', label: 'Привязать слева', icon: <PanelLeft className="w-3.5 h-3.5 text-zinc-400" /> },
    { id: 'right', label: 'Привязать справа', icon: <PanelRight className="w-3.5 h-3.5 text-zinc-400" /> },
    { id: 'compact', label: 'Плавающая полоска', icon: <Move className="w-3.5 h-3.5 text-zinc-400" /> },
    { id: 'expanded', label: 'Во весь экран (мини-видео)', icon: <Maximize2 className="w-3.5 h-3.5 text-zinc-400" /> },
  ];

  const portalTarget = containerRef.current?.ownerDocument?.body || document.body;

  return (
    <div 
      ref={containerRef}
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
      className={cn(
        "relative w-full flex flex-col pointer-events-auto select-none transition-all duration-150 ease-out",
        isStripMode ? "h-auto" : "h-full",
        mode === 'expanded' && "bg-zinc-950 p-6 justify-center",
        mode === 'left' && "bg-zinc-950/95 backdrop-blur-md border-r border-white/10 justify-center",
        mode === 'right' && "bg-zinc-950/95 backdrop-blur-md border-l border-white/10 justify-center",
        mode === 'top' && "bg-zinc-950/95 backdrop-blur-md border-b border-white/10",
        mode === 'bottom' && "bg-zinc-950/95 backdrop-blur-md border-t border-white/10",
        mode === 'compact' && "bg-zinc-950/92 backdrop-blur-md border border-white/15 rounded-xl shadow-2xl"
      )}
    >
      {/* Main Minimalist Content Row */}
      <div
        className={cn(
          "relative flex items-center gap-3 w-full",
          isStripMode ? "px-3.5 py-2" : "px-5 py-4 h-full flex-col justify-center"
        )}
      >
        {/* Drag Handle (only in floating compact mode) */}
        {mode === 'compact' && (
          <div
            style={{ touchAction: 'none' }}
            onPointerDown={(e) => {
              e.stopPropagation();
              dragControls?.start(e);
            }}
            className="shrink-0 p-1 -ml-1 text-zinc-500 hover:text-zinc-300 cursor-grab active:cursor-grabbing rounded transition-colors"
            title="Перетащить полоску суфлера"
          >
            <GripVertical className="w-4 h-4" />
          </div>
        )}

        {/* Active + Next Replica Content Area */}
        <div
          className={cn(
            "flex-1 min-w-0 flex items-center gap-2.5 transition-all duration-150",
            isVerticalDock ? "w-full my-auto flex-col items-start space-y-2.5" : "",
            mode === 'expanded' ? "max-w-4xl mx-auto flex-col items-center space-y-4" : ""
          )}
        >
          {primaryLine ? (
            <>
              {/* Minimalist Traffic-Light Cue Indicator (Small dot + compact timer, no distracting box) */}
              <div
                onClick={() => {
                  if (onSeek) onSeek(primaryLine.start);
                }}
                className="shrink-0 flex items-center gap-1.5 px-1.5 py-0.5 rounded cursor-pointer select-none"
                title={
                  trafficState === 'red'
                    ? 'До реплики больше 1.5 сек'
                    : trafficState === 'yellow'
                      ? 'Приготовьтесь (< 1.5 сек)'
                      : trafficState === 'green'
                        ? 'Говорите сейчас'
                        : 'Пауза'
                }
              >
                <span
                  className={cn(
                    "w-2 h-2 rounded-full shrink-0 transition-colors duration-150",
                    trafficState === 'red' && "bg-rose-500/85",
                    trafficState === 'yellow' && "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.85)]",
                    trafficState === 'green' && "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.85)]",
                    trafficState === 'idle' && "bg-zinc-600"
                  )}
                />
                <span
                  className={cn(
                    "font-mono text-[11px] font-medium tabular-nums tracking-tight whitespace-nowrap transition-colors duration-150",
                    trafficState === 'red' && "text-zinc-400",
                    trafficState === 'yellow' && "text-amber-300 font-semibold",
                    trafficState === 'green' && "text-emerald-300 font-semibold",
                    trafficState === 'idle' && "text-zinc-500"
                  )}
                >
                  {trafficState === 'green' && remainingSpeakTime !== null
                    ? `${remainingSpeakTime.toFixed(1)}с`
                    : timeToNext !== null
                      ? `-${timeToNext.toFixed(1)}с`
                      : '0.0с'}
                </span>
              </div>

              {/* Text Column: Active Replica + 1 Next Replica */}
              <div
                className={cn(
                  "flex-1 min-w-0 flex flex-col justify-center",
                  isVerticalDock ? "text-left w-full" : mode === 'expanded' ? "text-center w-full" : "text-left"
                )}
              >
                {/* Role + Fix badge inline */}
                {(primaryLine.role || primaryLine.needsFix) && (
                  <div
                    className={cn(
                      "flex items-center gap-2 mb-0.5 flex-wrap",
                      mode === 'expanded' ? "justify-center" : "justify-start"
                    )}
                  >
                    {primaryLine.role && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400/80 whitespace-nowrap">
                        {primaryLine.role}
                      </span>
                    )}
                    {primaryLine.needsFix && (
                      <span className="inline-flex items-center bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded text-[10px] font-bold uppercase tracking-wider whitespace-nowrap border border-amber-500/30">
                        Фикс
                      </span>
                    )}
                  </div>
                )}

                {/* Current Replica (Traffic-light colored: Red=white waiting, Yellow=amber <=1.5s, Green=emerald speaking) */}
                <div
                  onClick={() => {
                    if (onSeek) onSeek(primaryLine.start);
                  }}
                  className={cn(
                    "font-semibold tracking-tight transition-[font-size,line-height,color] duration-150 ease-out whitespace-normal break-words cursor-pointer select-text",
                    trafficState === 'green' && "text-emerald-300",
                    trafficState === 'yellow' && "text-amber-300",
                    (trafficState === 'red' || trafficState === 'idle') && "text-white"
                  )}
                  style={{
                    fontSize: `${effectiveFontSize}px`,
                    lineHeight: lineHeight,
                  }}
                  title="Нажмите для перехода к таймкоду реплики (ПКМ — настройки)"
                >
                  {primaryLine.text}
                </div>

                {/* Next Replica (Single Muted Compact Preview) */}
                {secondaryLine && (
                  <div
                    onClick={() => {
                      if (onSeek) onSeek(secondaryLine.start);
                    }}
                    className={cn(
                      "mt-0.5 text-zinc-400/80 hover:text-zinc-300 transition-colors cursor-pointer select-text whitespace-normal break-words",
                      isStripMode ? "line-clamp-1" : "line-clamp-2 pt-1.5 border-t border-white/5"
                    )}
                    style={{
                      fontSize: `${secondaryFontSize}px`,
                      lineHeight: Math.max(1.15, lineHeight - 0.1),
                    }}
                    title="Следующая реплика (нажмите для перехода)"
                  >
                    {secondaryLine.role && secondaryLine.role !== primaryLine.role && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mr-1.5">
                        [{secondaryLine.role}]
                      </span>
                    )}
                    <span>{secondaryLine.text}</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-zinc-500 text-xs py-1">
              Нет реплик для отображения
            </div>
          )}
        </div>

        {/* Right Controls Column: Manual Step Buttons (if manual) + Exit Fullscreen (if expanded) + Subtle Gear Button */}
        <div
          className={cn(
            "shrink-0 flex items-center gap-1.5",
            !isStripMode && "absolute top-3 right-3"
          )}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {pacing === 'manual' && roleSubtitles.length > 0 && (
            <div className="flex items-center bg-zinc-900/90 rounded-lg border border-white/10 p-0.5">
              <button
                type="button"
                onClick={() => setManualStepOffset(prev => prev - 1)}
                className="p-1 text-zinc-400 hover:text-white hover:bg-white/10 rounded transition-colors cursor-pointer"
                title="Предыдущая реплика (Стрелка вверх)"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setManualStepOffset(prev => prev + 1)}
                className="p-1 text-zinc-400 hover:text-white hover:bg-white/10 rounded transition-colors cursor-pointer"
                title="Следующая реплика (Стрелка вниз)"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {mode === 'expanded' && (
            <button
              type="button"
              onClick={() => handleModeSelect('bottom')}
              className="px-2 py-1 h-6 rounded-md bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-white/10 text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
              title="Свернуть полноэкранный суфлер"
            >
              <Minimize2 className="w-3 h-3" />
              <span>Свернуть</span>
            </button>
          )}

          <button
            ref={gearBtnRef}
            type="button"
            onClick={handleOpenMenuAtGear}
            className={cn(
              "w-6 h-6 rounded-md flex items-center justify-center transition-all cursor-pointer border",
              isSettingsOpen
                ? "bg-indigo-600 text-white border-indigo-400 shadow-sm"
                : "bg-zinc-900/60 text-zinc-400 hover:text-white hover:bg-white/10 border-white/10"
            )}
            title="Настройки телесуфлера (или ПКМ по суфлеру)"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Subtle Bottom Progress Line for Active Replica */}
      {isPrimaryCurrentlySpeaking && (
        <div className="w-full h-0.5 bg-white/5 overflow-hidden shrink-0">
          <div
            className="h-full bg-emerald-500 transition-[width] duration-75 ease-linear"
            style={{ width: `${activeProgress}%` }}
          />
        </div>
      )}

      {/* Portaled Mouse Context Menu (Always on top of all UI panels) */}
      {isSettingsOpen &&
        portalTarget &&
        createPortal(
          <div
            ref={menuRef}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              position: 'fixed',
              left: `${menuPos.left}px`,
              top: `${menuPos.top}px`,
              zIndex: 999999,
            }}
            className="w-60 py-1.5 rounded-lg bg-zinc-900/98 backdrop-blur-xl border border-white/15 shadow-[0_14px_40px_rgba(0,0,0,0.85)] text-xs text-zinc-200 select-none font-sans"
          >
            {/* Section: Position */}
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Расположение
            </div>
            {modeMenuItems.map((item) => {
              const active = mode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleModeSelect(item.id)}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-1.5 text-left transition-colors cursor-pointer",
                    active
                      ? "bg-indigo-600/20 text-white font-medium"
                      : "text-zinc-200 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 flex items-center justify-center">
                      {active ? <Check className="w-3.5 h-3.5 text-indigo-400" /> : null}
                    </span>
                    {item.icon}
                    <span>{item.label}</span>
                  </span>
                </button>
              );
            })}

            <div className="h-px bg-white/10 my-1" />

            {/* Inline Stepper Rows */}
            <div className="px-3 py-1 flex items-center justify-between hover:bg-white/5">
              <span className="text-zinc-300">Размер шрифта</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const next = Math.max(14, fontSize - 2);
                    onFontSizeChange(next);
                    saveTeleprompterPref({ fontSize: next });
                  }}
                  className="w-5 h-5 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="w-10 text-center font-mono text-[11px] font-semibold text-white tabular-nums">
                  {fontSize}px
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const next = Math.min(72, fontSize + 2);
                    onFontSizeChange(next);
                    saveTeleprompterPref({ fontSize: next });
                  }}
                  className="w-5 h-5 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="px-3 py-1 flex items-center justify-between hover:bg-white/5">
              <span className="text-zinc-300">Интервал строк</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const next = Math.max(1.0, Number((lineHeight - 0.1).toFixed(1)));
                    onLineHeightChange(next);
                    saveTeleprompterPref({ lineHeight: next });
                  }}
                  className="w-5 h-5 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="w-10 text-center font-mono text-[11px] font-semibold text-white tabular-nums">
                  {lineHeight.toFixed(1)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const next = Math.min(2.2, Number((lineHeight + 0.1).toFixed(1)));
                    onLineHeightChange(next);
                    saveTeleprompterPref({ lineHeight: next });
                  }}
                  className="w-5 h-5 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="px-3 py-1 flex items-center justify-between hover:bg-white/5">
              <span className="text-zinc-300">Скорость</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleSpeedStep(-0.1)}
                  className="w-5 h-5 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="w-10 text-center font-mono text-[11px] font-semibold text-white tabular-nums">
                  {speed.toFixed(1)}x
                </span>
                <button
                  type="button"
                  onClick={() => handleSpeedStep(0.1)}
                  className="w-5 h-5 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="h-px bg-white/10 my-1" />

            {/* Checkable Menu Options */}
            <button
              type="button"
              onClick={handleToggleAutoFit}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            >
              <span className="w-3.5 h-3.5 flex items-center justify-center">
                {autoFit ? <Check className="w-3.5 h-3.5 text-indigo-400" /> : null}
              </span>
              <span>Авто-размер длинных реплик</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const next = pacing === 'auto' ? 'manual' : 'auto';
                onPacingChange(next);
                saveTeleprompterPref({ pacing: next });
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            >
              <span className="w-3.5 h-3.5 flex items-center justify-center">
                {pacing === 'auto' ? <Check className="w-3.5 h-3.5 text-indigo-400" /> : null}
              </span>
              <span>Автопрокрутка по таймкоду</span>
            </button>
          </div>,
          portalTarget
        )}

      {/* Resize Handle (Dock Left/Right border, Top/Bottom border, or floating corner) */}
      <TeleprompterResizer 
        mode={mode} 
        onResize={onResize} 
        containerRef={containerRef} 
      />
    </div>
  );
};

export default Teleprompter;


