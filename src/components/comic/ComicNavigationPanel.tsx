import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, PanelRightClose, PanelRightOpen, Image as ImageIcon, AlignLeft } from 'lucide-react';
import { ComicProjectData } from '../../types/comic';
import { resolveComicAssetUrl } from '../../services/comic/comicUtils';
import { cn } from '../../lib/utils';
import { PdfPageCanvas } from './PdfPageCanvas';

interface ComicNavigationPanelProps {
  comic: ComicProjectData;
  projectPath?: string;
  width: number;
  isCollapsed: boolean;
  onWidthChange: (width: number) => void;
  onToggleCollapse: () => void;
  onSelectChapter: (chapterId: string) => void;
  onSelectPage: (pageIndex: number) => void;
}

export const ComicNavigationPanel: React.FC<ComicNavigationPanelProps> = ({
  comic,
  projectPath,
  width,
  isCollapsed,
  onWidthChange,
  onToggleCollapse,
  onSelectChapter,
  onSelectPage,
}) => {
  const thumbRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const activeChapterIdx = useMemo(() => {
    const idx = comic.chapters.findIndex((c) => c.id === comic.activeChapterId);
    return idx >= 0 ? idx : 0;
  }, [comic.chapters, comic.activeChapterId]);

  const activeChapter = comic.chapters[activeChapterIdx] || comic.chapters[0];
  const pdfResolvedUrl = useMemo(
    () => (comic.pdfPath ? resolveComicAssetUrl(comic.pdfPath, projectPath) : undefined),
    [comic.pdfPath, projectPath]
  );

  // Count pins & timeline markers per page in current chapter for subtle indicators
  const pageActivityCounts = useMemo(() => {
    const map: Record<number, { pins: number; synced: boolean }> = {};
    if (!activeChapter) return map;
    for (const pin of comic.pins || []) {
      if (pin.chapterId === activeChapter.id) {
        if (!map[pin.pageIndex]) map[pin.pageIndex] = { pins: 0, synced: false };
        map[pin.pageIndex].pins += 1;
      }
    }
    for (const sp of comic.syncPoints || []) {
      if (sp.chapterId === activeChapter.id) {
        if (!map[sp.pageIndex]) map[sp.pageIndex] = { pins: 0, synced: false };
        map[sp.pageIndex].synced = true;
      }
    }
    return map;
  }, [activeChapter, comic.pins, comic.syncPoints]);

  // Keep active thumbnail smoothly visible
  useEffect(() => {
    const el = thumbRefs.current[comic.activePageIndex];
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [comic.activePageIndex, activeChapter?.id]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      onWidthChange(Math.max(168, Math.min(310, startWidth + delta)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  if (isCollapsed) {
    return (
      <aside className="w-9 shrink-0 h-full bg-zinc-950 border-l border-white/10 flex flex-col items-center py-2.5 gap-3 z-20 select-none">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          title="Развернуть навигацию по комиксу"
        >
          <PanelRightOpen className="w-4 h-4" />
        </button>
        <div className="text-[10px] font-mono tabular-nums text-zinc-500 [writing-mode:vertical-rl] rotate-180 tracking-wider">
          {activeChapter ? `Гл. ${activeChapter.number} · ${comic.activePageIndex + 1}/${activeChapter.pages.length}` : 'Комикс'}
        </div>
      </aside>
    );
  }

  const hasPrevChapter = activeChapterIdx > 0;
  const hasNextChapter = activeChapterIdx < comic.chapters.length - 1;

  return (
    <div className="flex h-full shrink-0 z-20 select-none">
      {/* Left resize handle */}
      <div
        onMouseDown={handleResizeStart}
        className="w-1 bg-zinc-800/80 hover:bg-indigo-500 cursor-col-resize transition-colors shrink-0"
        title="Изменить ширину панели навигации"
      />

      <aside
        style={{ width: `${width}px` }}
        className="h-full bg-zinc-950 border-l border-white/10 flex flex-col min-h-0 overflow-hidden"
      >
        {/* Top Chapter Switcher */}
        <div className="p-2.5 border-b border-white/10 bg-zinc-900/70 shrink-0 space-y-2">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[11px] font-semibold text-zinc-300 truncate" title={comic.title}>
              {comic.title}
            </span>
            <button
              type="button"
              onClick={onToggleCollapse}
              className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
              title="Свернуть панель навигации"
            >
              <PanelRightClose className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!hasPrevChapter}
              onClick={() => hasPrevChapter && onSelectChapter(comic.chapters[activeChapterIdx - 1].id)}
              className={cn(
                'p-1.5 rounded-lg border border-white/10 transition-colors shrink-0',
                hasPrevChapter
                  ? 'bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700 hover:text-white cursor-pointer'
                  : 'bg-zinc-900/50 text-zinc-600 cursor-not-allowed'
              )}
              title="Предыдущая глава"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            <select
              value={activeChapter?.id || ''}
              onChange={(e) => onSelectChapter(e.target.value)}
              className="flex-1 min-w-0 bg-zinc-900 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-indigo-500 truncate cursor-pointer"
              aria-label="Выбор главы"
            >
              {comic.chapters.map((ch) => (
                <option key={ch.id} value={ch.id} className="bg-zinc-900 text-zinc-100">
                  {ch.title || `Том ${ch.volume} · Гл. ${ch.number}`}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={!hasNextChapter}
              onClick={() => hasNextChapter && onSelectChapter(comic.chapters[activeChapterIdx + 1].id)}
              className={cn(
                'p-1.5 rounded-lg border border-white/10 transition-colors shrink-0',
                hasNextChapter
                  ? 'bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700 hover:text-white cursor-pointer'
                  : 'bg-zinc-900/50 text-zinc-600 cursor-not-allowed'
              )}
              title="Следующая глава"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-zinc-500 font-mono tabular-nums px-0.5">
            <span>Стр. {activeChapter ? `${comic.activePageIndex + 1} / ${activeChapter.pages.length}` : '0 / 0'}</span>
            <span>Гл. {activeChapterIdx + 1}/{comic.chapters.length}</span>
          </div>
        </div>

        {/* Vertical Page Thumbnails Strip */}
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2 custom-scrollbar">
          {activeChapter?.pages.map((page, idx) => {
            const isActive = idx === comic.activePageIndex;
            const imgUrl = resolveComicAssetUrl(page.imagePath, projectPath);
            const activity = pageActivityCounts[idx];
            const isFailed = failedImages[page.id];

            return (
              <button
                key={page.id}
                ref={(el) => {
                  thumbRefs.current[idx] = el;
                }}
                type="button"
                onClick={() => onSelectPage(idx)}
                className={cn(
                  'w-full group relative rounded-lg overflow-hidden border transition-all text-left cursor-pointer bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                  isActive
                    ? 'border-indigo-500 ring-1 ring-indigo-500/70 shadow-md shadow-indigo-500/10'
                    : 'border-white/10 hover:border-white/25 opacity-80 hover:opacity-100'
                )}
              >
                {/* Thumbnail Preview */}
                <div className="w-full bg-zinc-900 relative flex items-center justify-center min-h-[84px] max-h-[210px] overflow-hidden">
                  {imgUrl && !isFailed ? (
                    <img
                      src={imgUrl}
                      alt={`Страница ${idx + 1}`}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={() => setFailedImages((prev) => ({ ...prev, [page.id]: true }))}
                      className="w-full h-auto max-h-[210px] object-cover object-top block"
                    />
                  ) : page.pdfPageNumber && pdfResolvedUrl ? (
                    <PdfPageCanvas
                      pdfUrl={pdfResolvedUrl}
                      pageNumber={page.pdfPageNumber}
                      targetWidth={Math.max(120, width - 28)}
                      isThumbnail={true}
                    />
                  ) : page.textBlocks && page.textBlocks.length > 0 ? (
                    <div className="w-full p-2.5 text-[9px] leading-relaxed text-zinc-400 line-clamp-5 bg-zinc-900/90">
                      <div className="flex items-center gap-1 text-zinc-500 mb-1">
                        <AlignLeft className="w-3 h-3 shrink-0" />
                        <span>Текст</span>
                      </div>
                      {page.textBlocks[0]}
                    </div>
                  ) : (
                    <div className="py-6 flex flex-col items-center justify-center text-zinc-600 gap-1">
                      <ImageIcon className="w-4 h-4" />
                      <span className="text-[10px] font-mono tabular-nums">{idx + 1}</span>
                    </div>
                  )}
                </div>

                {/* Minimal Footer Strip (Page index + optional pin/marker indicator) */}
                <div
                  className={cn(
                    'flex items-center justify-between px-2 py-1 text-[10px] font-mono tabular-nums border-t',
                    isActive
                      ? 'bg-indigo-600/20 text-indigo-200 border-indigo-500/30'
                      : 'bg-zinc-950/90 text-zinc-400 border-white/5'
                  )}
                >
                  <span>{String(idx + 1).padStart(2, '0')}</span>
                  {activity && (activity.pins > 0 || activity.synced) && (
                    <span className="text-[10px] text-indigo-300 truncate">
                      {activity.pins > 0 ? `${activity.pins} репл.` : 'метка'}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
};

export default ComicNavigationPanel;
