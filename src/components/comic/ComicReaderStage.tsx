import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  MapPin,
  Link2,
  Link2Off,
  ScrollText,
  BookOpen,
  Film,
  X,
  Trash2,
  RotateCcw,
  Check,
  PanelRightOpen,
  Image as ImageIcon,
  AlertTriangle,
} from 'lucide-react';
import { ComicBubblePin, ComicProjectData, ComicScrollTarget, ComicViewMode } from '../../types/comic';
import { resolveComicAssetUrl } from '../../services/comic/comicUtils';
import { cn, formatTimeHms } from '../../lib/utils';
import { PdfPageCanvas } from './PdfPageCanvas';

interface PendingPinDraft {
  chapterId: string;
  pageIndex: number;
  x: number;
  y: number;
  role: string;
  text: string;
  time: number;
}

interface ComicReaderStageProps {
  comic: ComicProjectData;
  projectPath?: string;
  roles: string[];
  activeRole: string;
  currentTime: number;
  isRecording: boolean;
  hasVideo: boolean;
  isRightNavCollapsed: boolean;
  scrollTarget: ComicScrollTarget | null;
  activeTrackId?: string;
  activeTrackName?: string;
  isFirstDubTrack?: boolean;
  onSwitchToVideo?: () => void;
  onExpandRightNav: () => void;
  onViewModeChange: (mode: ComicViewMode) => void;
  onZoomChange: (zoom: number) => void;
  onToggleTimelineSync: () => void;
  onActivePageChange: (chapterId: string, pageIndex: number, source: 'scroll' | 'nav') => void;
  onViewportScrollChange?: (chapterId: string, pageIndex: number, scrollFraction: number) => void;
  onAddPin: (draft: {
    chapterId: string;
    pageIndex: number;
    x: number;
    y: number;
    role: string;
    text: string;
    timelineTime: number;
  }) => void;
  onDeletePin: (pinId: string) => void;
  onSelectPin: (pin: ComicBubblePin) => void;
  onClearTimeline?: () => void;
  onPdfPageCountResolved?: (numPages: number) => void;
}

function getElementTopInContainer(el: HTMLElement, container: HTMLElement): number {
  return el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
}

export const ComicReaderStage: React.FC<ComicReaderStageProps> = ({
  comic,
  projectPath,
  roles,
  activeRole,
  currentTime,
  isRecording,
  hasVideo,
  isRightNavCollapsed,
  scrollTarget,
  activeTrackId,
  activeTrackName,
  isFirstDubTrack = true,
  onSwitchToVideo,
  onExpandRightNav,
  onViewModeChange,
  onZoomChange,
  onToggleTimelineSync,
  onActivePageChange,
  onViewportScrollChange,
  onAddPin,
  onDeletePin,
  onSelectPin,
  onClearTimeline,
  onPdfPageCountResolved,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pagesWrapperRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const isProgrammaticScrollRef = useRef(false);
  const programmaticTimerRef = useRef<number | null>(null);
  const pendingScrollTargetRef = useRef<{ target: ComicScrollTarget; expiresAt: number } | null>(null);
  const scrollReportRafRef = useRef<number | null>(null);
  const prevChapterIdRef = useRef<string | undefined>(undefined);
  const prevPageKeyRef = useRef<string>('');

  const [isPinMode, setIsPinMode] = useState(false);
  const [draftPin, setDraftPin] = useState<PendingPinDraft | null>(null);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [containerWidth, setContainerWidth] = useState(820);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const activeChapter = useMemo(() => {
    return comic.chapters.find((c) => c.id === comic.activeChapterId) || comic.chapters[0];
  }, [comic.chapters, comic.activeChapterId]);

  const pdfResolvedUrl = useMemo(
    () => (comic.pdfPath ? resolveComicAssetUrl(comic.pdfPath, projectPath) : undefined),
    [comic.pdfPath, projectPath]
  );

  const markProgrammaticScroll = useCallback((durationMs = 420) => {
    isProgrammaticScrollRef.current = true;
    if (programmaticTimerRef.current) window.clearTimeout(programmaticTimerRef.current);
    programmaticTimerRef.current = window.setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, durationMs);
  }, []);

  const applyScrollTargetNow = useCallback(
    (target: ComicScrollTarget, forceInstant = false): boolean => {
      const container = scrollContainerRef.current;
      if (!container || !activeChapter || activeChapter.id !== target.chapterId) return false;

      const isTopReset = target.scrollFraction <= 0.001 && !target.isPinTarget;

      if (comic.viewMode === 'page') {
        if (comic.activePageIndex !== target.pageIndex) return false;
        if (isTopReset) {
          markProgrammaticScroll(250);
          container.scrollTop = 0;
          return true;
        }
        const pageEl = pageRefs.current[target.pageIndex];
        if (!pageEl || pageEl.offsetHeight < 20) return false;

        const pageTop = getElementTopInContainer(pageEl, container);
        const pageHeight = pageEl.offsetHeight;
        const rawTop = target.isPinTarget
          ? pageTop + target.scrollFraction * pageHeight - container.clientHeight * 0.3
          : pageTop + target.scrollFraction * pageHeight;
        const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
        const desiredTop = Math.max(0, Math.min(maxTop, rawTop));

        markProgrammaticScroll(forceInstant ? 250 : 450);
        container.scrollTo({
          top: desiredTop,
          behavior: forceInstant ? 'auto' : target.behavior || 'smooth',
        });
        return true;
      }

      // Webtoon mode
      const pageEl = pageRefs.current[target.pageIndex];
      if (!pageEl) return false;

      const pageTop = getElementTopInContainer(pageEl, container);
      if (isTopReset) {
        const desiredTop = Math.max(0, pageTop);
        markProgrammaticScroll(forceInstant ? 250 : 450);
        container.scrollTo({
          top: desiredTop,
          behavior: forceInstant ? 'auto' : target.behavior || 'auto',
        });
        return true;
      }

      if (pageEl.offsetHeight < 20) return false;
      const pageHeight = pageEl.offsetHeight;
      const rawTop = target.isPinTarget
        ? pageTop + target.scrollFraction * pageHeight - container.clientHeight * 0.3
        : pageTop + target.scrollFraction * pageHeight;
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const desiredTop = Math.max(0, Math.min(maxTop, rawTop));

      markProgrammaticScroll(forceInstant ? 250 : 450);
      container.scrollTo({
        top: desiredTop,
        behavior: forceInstant ? 'auto' : target.behavior || 'smooth',
      });
      return true;
    },
    [activeChapter, comic.viewMode, comic.activePageIndex, markProgrammaticScroll]
  );

  const reapplyPendingScroll = useCallback(() => {
    const pending = pendingScrollTargetRef.current;
    if (!pending) return;
    if (Date.now() > pending.expiresAt) {
      pendingScrollTargetRef.current = null;
      return;
    }
    applyScrollTargetNow(pending.target, true);
  }, [applyScrollTargetNow]);

  // Track stage container width for responsive zoom/PDF rendering
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setContainerWidth(Math.max(320, Math.floor(entries[0].contentRect.width)));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Re-apply pending cross-chapter / cold-image scroll target as images decode and expand height
  useEffect(() => {
    const wrapper = pagesWrapperRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(() => {
      reapplyPendingScroll();
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [reapplyPendingScroll, activeChapter?.id, comic.viewMode]);

  // Clear draft pin when chapter changes (keep selectedPinId if explicitly targeted by scrollTarget)
  useEffect(() => {
    if (prevChapterIdRef.current !== activeChapter?.id) {
      prevChapterIdRef.current = activeChapter?.id;
      setDraftPin(null);
      if (!scrollTarget || scrollTarget.chapterId !== activeChapter?.id || !scrollTarget.pinId) {
        setSelectedPinId(null);
      }
    }
  }, [activeChapter?.id, scrollTarget]);

  // Apply explicit scroll targets (manual page top reset OR recorded scroll position / bubble pin jump)
  useEffect(() => {
    if (!scrollTarget || !activeChapter || activeChapter.id !== scrollTarget.chapterId) return;

    if (scrollTarget.pinId) {
      setSelectedPinId(scrollTarget.pinId);
    }

    const isTopReset = scrollTarget.scrollFraction <= 0.001 && !scrollTarget.isPinTarget;
    pendingScrollTargetRef.current = {
      target: scrollTarget,
      expiresAt: Date.now() + (isTopReset ? 450 : 1600),
    };

    const applied = applyScrollTargetNow(scrollTarget, false);
    const raf1 = window.requestAnimationFrame(() => {
      if (!applied || !isTopReset) {
        applyScrollTargetNow(scrollTarget, true);
      } else if (comic.viewMode === 'page' && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }
    });

    return () => window.cancelAnimationFrame(raf1);
  }, [scrollTarget, activeChapter?.id, comic.activePageIndex, comic.viewMode, applyScrollTargetNow]);

  // Guarantee: in Single-Page mode, opening any new page without a non-zero target ALWAYS starts at the very top
  useEffect(() => {
    const pageKey = `${activeChapter?.id || ''}:${comic.activePageIndex}:${comic.viewMode}`;
    if (prevPageKeyRef.current === pageKey) return;
    prevPageKeyRef.current = pageKey;

    if (comic.viewMode !== 'page' || !scrollContainerRef.current) return;
    const hasSpecificOffset =
      scrollTarget &&
      scrollTarget.chapterId === activeChapter?.id &&
      scrollTarget.pageIndex === comic.activePageIndex &&
      (scrollTarget.scrollFraction > 0.001 || scrollTarget.isPinTarget);

    if (!hasSpecificOffset) {
      markProgrammaticScroll(200);
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [activeChapter?.id, comic.activePageIndex, comic.viewMode, scrollTarget, markProgrammaticScroll]);

  // Report live vertical scroll fraction within the active page so recording captures exact reading position
  const handleContainerScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current || !onViewportScrollChange || !activeChapter) return;
    if (scrollReportRafRef.current !== null) return;

    scrollReportRafRef.current = window.requestAnimationFrame(() => {
      scrollReportRafRef.current = null;
      const container = scrollContainerRef.current;
      const pageEl = pageRefs.current[comic.activePageIndex];
      if (!container || !pageEl || pageEl.offsetHeight <= 0) return;

      const pageTop = getElementTopInContainer(pageEl, container);
      const fraction = Math.max(0, Math.min(1, (container.scrollTop - pageTop) / pageEl.offsetHeight));
      onViewportScrollChange(activeChapter.id, comic.activePageIndex, fraction);
    });
  }, [onViewportScrollChange, activeChapter, comic.activePageIndex]);

  const cancelPendingScrollByUser = useCallback(() => {
    pendingScrollTargetRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      if (programmaticTimerRef.current) window.clearTimeout(programmaticTimerRef.current);
      if (scrollReportRafRef.current !== null) window.cancelAnimationFrame(scrollReportRafRef.current);
    };
  }, []);

  // IntersectionObserver in Webtoon mode to automatically track currently visible page
  useEffect(() => {
    if (comic.viewMode !== 'webtoon' || !activeChapter || !scrollContainerRef.current) return;

    const root = scrollContainerRef.current;
    const visibilityRatios = new Map<number, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        if (isProgrammaticScrollRef.current) return;

        for (const entry of entries) {
          const idxStr = (entry.target as HTMLElement).dataset.pageIndex;
          if (idxStr !== undefined) {
            visibilityRatios.set(Number(idxStr), entry.intersectionRatio);
          }
        }

        let bestIdx = -1;
        let bestRatio = 0;
        visibilityRatios.forEach((ratio, idx) => {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestIdx = idx;
          }
        });

        if (bestIdx >= 0 && bestIdx !== comic.activePageIndex) {
          onActivePageChange(activeChapter.id, bestIdx, 'scroll');
        }
      },
      {
        root,
        threshold: [0.1, 0.25, 0.5, 0.75],
      }
    );

    activeChapter.pages.forEach((_, idx) => {
      const node = pageRefs.current[idx];
      if (node) observer.observe(node);
    });

    return () => observer.disconnect();
  }, [comic.viewMode, activeChapter, comic.activePageIndex, onActivePageChange]);

  // Keyboard navigation in Single-Page mode (ArrowLeft / ArrowRight when not typing)
  useEffect(() => {
    if (comic.viewMode !== 'page' || !activeChapter) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        if (comic.activePageIndex < activeChapter.pages.length - 1) {
          e.preventDefault();
          onActivePageChange(activeChapter.id, comic.activePageIndex + 1, 'nav');
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        if (comic.activePageIndex > 0) {
          e.preventDefault();
          onActivePageChange(activeChapter.id, comic.activePageIndex - 1, 'nav');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [comic.viewMode, activeChapter, comic.activePageIndex, onActivePageChange]);

  const handlePageSurfaceClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, pageIndex: number) => {
      if (!activeChapter) return;
      // Only create bubble pins when Pin Mode is ON or user holds Alt+Click
      if (!isPinMode && !e.altKey) {
        setSelectedPinId(null);
        return;
      }

      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const x = Math.max(2, Math.min(98, ((e.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(2, Math.min(98, ((e.clientY - rect.top) / rect.height) * 100));

      const defaultRole = activeRole || roles[0] || 'Персонаж 1';
      setDraftPin({
        chapterId: activeChapter.id,
        pageIndex,
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        role: defaultRole,
        text: '',
        time: Math.max(0, Math.round(currentTime * 100) / 100),
      });
    },
    [activeChapter, isPinMode, activeRole, roles, currentTime]
  );

  const handleConfirmDraftPin = useCallback(() => {
    if (!draftPin || !activeChapter) return;
    const chNum = activeChapter.number || '1';
    const nextPinNum = (comic.pins?.length || 0) + 1;
    const finalText =
      draftPin.text.trim() || `Гл.${chNum} Стр.${draftPin.pageIndex + 1} · Реплика #${nextPinNum}`;
    const finalRole = draftPin.role.trim() || activeRole || roles[0] || 'Персонаж 1';

    onAddPin({
      chapterId: draftPin.chapterId,
      pageIndex: draftPin.pageIndex,
      x: draftPin.x,
      y: draftPin.y,
      role: finalRole,
      text: finalText,
      timelineTime: draftPin.time,
    });
    setDraftPin(null);
  }, [draftPin, activeChapter, comic.pins?.length, activeRole, roles, onAddPin]);

  const baseRenderWidth = Math.max(320, Math.min(containerWidth - 48, 920));
  const targetPageWidth = Math.round((baseRenderWidth * (comic.zoom || 100)) / 100);

  const pinsByPage = useMemo(() => {
    const map: Record<number, ComicBubblePin[]> = {};
    if (!activeChapter) return map;
    for (const pin of comic.pins || []) {
      if (pin.chapterId !== activeChapter.id) continue;
      if (activeTrackId) {
        if (pin.trackId && pin.trackId !== activeTrackId) continue;
        if (!pin.trackId && !isFirstDubTrack) continue;
      }
      if (!map[pin.pageIndex]) map[pin.pageIndex] = [];
      map[pin.pageIndex].push(pin);
    }
    return map;
  }, [comic.pins, activeChapter, activeTrackId, isFirstDubTrack]);

  if (!activeChapter) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-950 text-zinc-500 gap-2 p-6">
        <BookOpen className="w-8 h-8 text-zinc-600" />
        <p className="text-sm font-medium text-zinc-400">В комиксе нет загруженных глав</p>
      </div>
    );
  }

  const pagesToRender =
    comic.viewMode === 'webtoon'
      ? activeChapter.pages.map((p, idx) => ({ page: p, idx }))
      : [
          {
            page: activeChapter.pages[comic.activePageIndex] || activeChapter.pages[0],
            idx: Math.min(comic.activePageIndex, Math.max(0, activeChapter.pages.length - 1)),
          },
        ].filter((item) => !!item.page);

  const canPrevPage = comic.activePageIndex > 0;
  const canNextPage = comic.activePageIndex < activeChapter.pages.length - 1;

  return (
    <div className="w-full h-full flex flex-col min-h-0 bg-zinc-950 relative overflow-hidden">
      {/* Compact Contextual Reader Toolbar */}
      <div className="h-9 shrink-0 bg-zinc-900/95 border-b border-white/10 px-3 flex items-center justify-between gap-2 z-20 select-none">
        {/* Left: Mode Switch + Video Switch */}
        <div className="flex items-center gap-2 min-w-0">
          {hasVideo && onSwitchToVideo && (
            <button
              type="button"
              onClick={onSwitchToVideo}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title="Переключиться на видеоплеер"
            >
              <Film className="w-3.5 h-3.5 text-indigo-400" />
              <span>Видео</span>
            </button>
          )}

          <div className="flex items-center bg-zinc-950/90 p-0.5 rounded-lg border border-white/10 shrink-0">
            <button
              type="button"
              onClick={() => onViewModeChange('webtoon')}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer',
                comic.viewMode === 'webtoon'
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              )}
              title="Вертикальная бесшовная лента (удобно для манхвы и вебтунов)"
            >
              <ScrollText className="w-3 h-3" />
              <span>Лента</span>
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange('page')}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer',
                comic.viewMode === 'page'
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              )}
              title="Постраничный просмотр со стрелками"
            >
              <BookOpen className="w-3 h-3" />
              <span>Страницы</span>
            </button>
          </div>

          <span className="hidden md:inline text-[11px] font-mono tabular-nums text-zinc-400 truncate">
            Гл. {activeChapter.number} · Стр. {comic.activePageIndex + 1}/{activeChapter.pages.length}
          </span>
        </div>

        {/* Center/Right: Pin Mode, Timeline Sync, Zoom, Right Nav Toggle */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setIsPinMode((v) => !v);
              setDraftPin(null);
            }}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors whitespace-nowrap cursor-pointer',
              isPinMode
                ? 'bg-indigo-600 border-indigo-400 text-white shadow-sm shadow-indigo-600/30'
                : 'bg-zinc-800/80 border-white/10 text-zinc-300 hover:bg-zinc-800 hover:text-white'
            )}
            title="Режим клик-меток реплик на бабблах (также работает по Alt + клик в любом режиме)"
          >
            <MapPin className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Метки реплик</span>
          </button>

          <button
            type="button"
            onClick={onToggleTimelineSync}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors whitespace-nowrap cursor-pointer',
              comic.syncTimelineWithComic
                ? 'bg-zinc-800 border-indigo-500/40 text-indigo-300'
                : 'bg-zinc-900 border-white/10 text-zinc-500 hover:text-zinc-300'
            )}
            title={
              comic.syncTimelineWithComic
                ? `Синхронизация включена для дорожки «${activeTrackName || 'Дубли'}»: перемотка аудио перелистывает комикс по меткам этой дорожки`
                : 'Синхронизация с таймлайном выключена'
            }
          >
            {comic.syncTimelineWithComic ? (
              <Link2 className="w-3.5 h-3.5" />
            ) : (
              <Link2Off className="w-3.5 h-3.5" />
            )}
            <span className="hidden lg:inline">Синхр.</span>
            {comic.syncTimelineWithComic && activeTrackName && (
              <span className="hidden xl:inline max-w-[84px] truncate text-[10px] font-medium text-indigo-300/80 border-l border-indigo-400/25 pl-1.5">
                {activeTrackName}
              </span>
            )}
          </button>

          {onClearTimeline && (
            <button
              type="button"
              disabled={isRecording}
              onClick={() => setIsClearConfirmOpen(true)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors whitespace-nowrap',
                isRecording
                  ? 'bg-zinc-900/60 border-white/5 text-zinc-600 cursor-not-allowed'
                  : 'bg-zinc-900 border-white/10 text-zinc-400 hover:text-rose-300 hover:bg-rose-950/50 hover:border-rose-500/40 cursor-pointer'
              )}
              title="Очистить записи и метки на таймлайне (комикс и главы останутся в проекте)"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden md:inline">Очистить таймлайн</span>
            </button>
          )}

          <div className="h-4 w-px bg-white/10 mx-0.5" />

          {/* Zoom Controls */}
          <div className="flex items-center gap-0.5 bg-zinc-950/80 border border-white/10 rounded-md p-0.5">
            <button
              type="button"
              onClick={() => onZoomChange(Math.max(50, (comic.zoom || 100) - 15))}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Уменьшить масштаб"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onZoomChange(100)}
              className="px-1.5 text-[11px] font-mono tabular-nums text-zinc-300 hover:text-white cursor-pointer"
              title="Сбросить масштаб до 100%"
            >
              {comic.zoom || 100}%
            </button>
            <button
              type="button"
              onClick={() => onZoomChange(Math.min(200, (comic.zoom || 100) + 15))}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Увеличить масштаб"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          {isRightNavCollapsed && (
            <button
              type="button"
              onClick={onExpandRightNav}
              className="p-1.5 rounded-md bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              title="Показать правую панель глав и страниц"
            >
              <PanelRightOpen className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Recording Auto-Marker Subtle Banner */}
      {isRecording && (
        <div className="shrink-0 bg-rose-950/70 border-b border-rose-500/30 px-3 py-1 flex items-center justify-between text-[11px] text-rose-200 select-none">
          <span>
            Идёт запись ({activeTrackName || 'Дубли'}) — авто-метки привязываются к этой дорожке
          </span>
          <span className="font-mono tabular-nums text-rose-300">
            Гл. {activeChapter.number} · Стр. {comic.activePageIndex + 1} · {formatTimeHms(currentTime)}
          </span>
        </div>
      )}

      {/* Main Scrollable Comic Viewport */}
      <div
        ref={scrollContainerRef}
        onScroll={handleContainerScroll}
        onWheel={cancelPendingScrollByUser}
        onPointerDown={cancelPendingScrollByUser}
        onTouchStart={cancelPendingScrollByUser}
        className={cn(
          'flex-1 min-h-0 overflow-y-auto overflow-x-auto bg-zinc-950 relative custom-scrollbar',
          comic.viewMode === 'page' ? 'flex flex-col items-center justify-start py-4 px-6' : 'py-2 px-4'
        )}
      >
        <div
          ref={pagesWrapperRef}
          className={cn(
            'mx-auto flex flex-col items-center',
            comic.viewMode === 'webtoon' ? 'gap-0' : 'gap-4'
          )}
          style={{ width: `${targetPageWidth}px`, maxWidth: 'none' }}
        >
          {pagesToRender.map(({ page, idx }) => {
            const imgUrl = resolveComicAssetUrl(page.imagePath, projectPath);
            const pagePins = pinsByPage[idx] || [];
            const isFailed = failedImages[page.id];

            return (
              <div
                key={page.id}
                ref={(el) => {
                  pageRefs.current[idx] = el;
                }}
                data-page-index={idx}
                onClick={(e) => handlePageSurfaceClick(e, idx)}
                className={cn(
                  'relative w-full flex justify-center bg-zinc-900/40',
                  isPinMode ? 'cursor-crosshair' : 'cursor-default',
                  comic.viewMode === 'page' && 'rounded-lg overflow-hidden border border-white/10 shadow-2xl'
                )}
              >
                {/* Page Media / Text Content */}
                {imgUrl && !isFailed ? (
                  <img
                    src={imgUrl}
                    alt={`Глава ${activeChapter.number}, страница ${idx + 1}`}
                    loading={idx < 3 || Math.abs(idx - comic.activePageIndex) <= 1 ? 'eager' : 'lazy'}
                    referrerPolicy="no-referrer"
                    draggable={false}
                    style={
                      page.width && page.height
                        ? { aspectRatio: `${page.width} / ${page.height}` }
                        : undefined
                    }
                    onLoad={reapplyPendingScroll}
                    onError={() => setFailedImages((prev) => ({ ...prev, [page.id]: true }))}
                    className="w-full h-auto block select-none"
                  />
                ) : page.pdfPageNumber && pdfResolvedUrl ? (
                  <PdfPageCanvas
                    pdfUrl={pdfResolvedUrl}
                    pageNumber={page.pdfPageNumber}
                    targetWidth={targetPageWidth}
                    onNumPagesResolved={onPdfPageCountResolved}
                  />
                ) : page.textBlocks && page.textBlocks.length > 0 ? (
                  <article className="w-full bg-zinc-900/90 border border-white/10 rounded-xl px-8 py-7 text-zinc-100 space-y-4 my-2">
                    <div className="flex items-center justify-between text-xs font-mono tabular-nums text-zinc-500 pb-3 border-b border-white/10">
                      <span>{activeChapter.title}</span>
                      <span>Стр. {idx + 1}</span>
                    </div>
                    {page.textBlocks.map((paragraph, pIdx) => (
                      <p key={pIdx} className="text-[15px] leading-relaxed text-zinc-200">
                        {paragraph}
                      </p>
                    ))}
                  </article>
                ) : (
                  <div className="w-full py-24 flex flex-col items-center justify-center bg-zinc-900 text-zinc-500 gap-2 border border-white/5">
                    <ImageIcon className="w-8 h-8 text-zinc-600" />
                    <span className="text-xs font-medium text-zinc-400">
                      Страница {idx + 1} не загрузилась
                    </span>
                  </div>
                )}

                {/* Existing Bubble Pins Overlay */}
                {pagePins.map((pin) => {
                  const isSelected = selectedPinId === pin.id;
                  return (
                    <div
                      key={pin.id}
                      style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 z-20"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPinId(isSelected ? null : pin.id);
                        onSelectPin(pin);
                      }}
                    >
                      <button
                        type="button"
                        className={cn(
                          'flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold shadow-lg border transition-transform cursor-pointer whitespace-nowrap',
                          isSelected
                            ? 'bg-indigo-600 text-white border-white scale-110'
                            : 'bg-zinc-950/90 text-indigo-200 border-indigo-400/70 hover:bg-indigo-600 hover:text-white'
                        )}
                        title={`${pin.role}: ${pin.label} (${formatTimeHms(pin.timelineTime)})`}
                      >
                        <span className="font-mono tabular-nums">#{pin.order}</span>
                        <span className="max-w-[90px] truncate">{pin.role}</span>
                      </button>

                      {/* Compact Inline Pin Info Popover */}
                      {isSelected && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 w-56 bg-zinc-900 border border-white/15 rounded-xl p-2.5 shadow-2xl z-30 text-left space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold text-indigo-300 truncate">
                              {pin.role}
                            </span>
                            <span className="text-[10px] font-mono tabular-nums text-zinc-400">
                              {formatTimeHms(pin.timelineTime)}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-200 leading-snug break-words">{pin.label}</p>
                          <div className="flex items-center justify-end pt-1 border-t border-white/10">
                            <button
                              type="button"
                              onClick={() => {
                                onDeletePin(pin.id);
                                setSelectedPinId(null);
                              }}
                              className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Удалить</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Inline New Pin Creation Popover */}
                {draftPin && draftPin.chapterId === activeChapter.id && draftPin.pageIndex === idx && (
                  <div
                    style={{
                      left: `${Math.min(72, Math.max(28, draftPin.x))}%`,
                      top: `${Math.min(82, Math.max(12, draftPin.y))}%`,
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-40 w-64 bg-zinc-900 border border-indigo-500/50 rounded-xl p-3 shadow-2xl space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">Новая метка реплики</span>
                      <span className="text-[10px] font-mono tabular-nums text-indigo-300">
                        {formatTimeHms(draftPin.time)}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <input
                        type="text"
                        list="comic-pin-roles-list"
                        value={draftPin.role}
                        onChange={(e) => setDraftPin({ ...draftPin, role: e.target.value })}
                        placeholder="Персонаж (роль)"
                        className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                      <datalist id="comic-pin-roles-list">
                        {roles.map((r) => (
                          <option key={r} value={r} />
                        ))}
                      </datalist>

                      <input
                        type="text"
                        autoFocus
                        value={draftPin.text}
                        onChange={(e) => setDraftPin({ ...draftPin, text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleConfirmDraftPin();
                          } else if (e.key === 'Escape') {
                            setDraftPin(null);
                          }
                        }}
                        placeholder="Текст реплики (необязательно)"
                        className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => setDraftPin(null)}
                        className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 cursor-pointer flex items-center gap-1"
                      >
                        <X className="w-3 h-3" />
                        <span>Отмена</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmDraftPin}
                        className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white cursor-pointer flex items-center gap-1"
                      >
                        <Check className="w-3 h-3" />
                        <span>Добавить</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Floating Page Arrows for Single-Page Mode */}
        {comic.viewMode === 'page' && activeChapter.pages.length > 1 && (
          <div className="sticky bottom-3 mt-4 flex items-center gap-2 bg-zinc-900/90 backdrop-blur-md border border-white/10 rounded-xl px-2 py-1.5 shadow-xl z-20">
            <button
              type="button"
              disabled={!canPrevPage}
              onClick={() => canPrevPage && onActivePageChange(activeChapter.id, comic.activePageIndex - 1, 'nav')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors',
                canPrevPage
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-white cursor-pointer'
                  : 'text-zinc-600 cursor-not-allowed'
              )}
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Назад</span>
            </button>
            <span className="px-2 text-xs font-mono tabular-nums text-zinc-300">
              {comic.activePageIndex + 1} / {activeChapter.pages.length}
            </span>
            <button
              type="button"
              disabled={!canNextPage}
              onClick={() => canNextPage && onActivePageChange(activeChapter.id, comic.activePageIndex + 1, 'nav')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors',
                canNextPage
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-white cursor-pointer'
                  : 'text-zinc-600 cursor-not-allowed'
              )}
            >
              <span>Вперёд</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Confirmation Modal for Destructive Timeline Reset (keeps comic chapters intact) */}
      {isClearConfirmOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[260] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
            onClick={() => setIsClearConfirmOpen(false)}
          >
            <div
              className="w-full max-w-sm bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl p-5 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-white">Очистить таймлайн?</h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Записанные дубли на дорожках, авто-метки страниц и клик-метки реплик будут сброшены, а курсор вернётся на 00:00. Загруженный комикс и все главы останутся в проекте.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsClearConfirmOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition-colors cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsClearConfirmOpen(false);
                    setDraftPin(null);
                    setSelectedPinId(null);
                    onClearTimeline?.();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Очистить таймлайн</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default ComicReaderStage;
