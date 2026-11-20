import React, { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { getPdfDocument } from '../../services/comic/localComicParser';
import { cn } from '../../lib/utils';

interface PdfPageCanvasProps {
  pdfUrl: string;
  pageNumber: number;
  targetWidth: number;
  isThumbnail?: boolean;
  className?: string;
  onNumPagesResolved?: (numPages: number) => void;
}

export const PdfPageCanvas: React.FC<PdfPageCanvasProps> = ({
  pdfUrl,
  pageNumber,
  targetWidth,
  isThumbnail = false,
  className,
  onNumPagesResolved,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [aspectRatio, setAspectRatio] = useState<number>(isThumbnail ? 0.7 : 0.707);

  // Lazy visibility detection so large PDFs never exhaust GPU memory
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsVisible(true);
        }
      },
      { rootMargin: isThumbnail ? '240px 0px' : '900px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isThumbnail]);

  useEffect(() => {
    if (!isVisible || !pdfUrl) return;

    let cancelled = false;
    let renderTask: any = null;

    const renderPage = async () => {
      try {
        setStatus((prev) => (prev === 'ready' ? 'ready' : 'loading'));
        const doc = await getPdfDocument(pdfUrl);
        if (cancelled) return;

        if (onNumPagesResolved && doc.numPages > 0) {
          onNumPagesResolved(doc.numPages);
        }

        const safePage = Math.max(1, Math.min(pageNumber, doc.numPages));
        const page = await doc.getPage(safePage);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        if (baseViewport.height > 0) {
          setAspectRatio(baseViewport.width / baseViewport.height);
        }

        const clampedWidth = Math.max(isThumbnail ? 96 : 280, Math.min(targetWidth, isThumbnail ? 240 : 1800));
        const dpr = Math.min(window.devicePixelRatio || 1, isThumbnail ? 1.5 : 2);
        const scale = (clampedWidth / baseViewport.width) * dpr;
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        renderTask = page.render({
          canvasContext: ctx,
          viewport,
          canvas,
        });
        await renderTask.promise;

        if (!cancelled) {
          setStatus('ready');
        }
      } catch (err: any) {
        if (!cancelled && err?.name !== 'RenderingCancelledException') {
          console.error('[PdfPageCanvas] Render failed:', err);
          setStatus('error');
        }
      }
    };

    renderPage();

    return () => {
      cancelled = true;
      if (renderTask && typeof renderTask.cancel === 'function') {
        try {
          renderTask.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [isVisible, pdfUrl, pageNumber, targetWidth, isThumbnail, onNumPagesResolved]);

  return (
    <div
      ref={wrapperRef}
      style={{
        width: isThumbnail ? '100%' : `${targetWidth}px`,
        aspectRatio: status === 'ready' ? undefined : `${aspectRatio}`,
      }}
      className={cn(
        'relative flex items-center justify-center bg-zinc-900 overflow-hidden select-none',
        className
      )}
    >
      <canvas
        ref={canvasRef}
        className={cn(
          'block max-w-full h-auto transition-opacity duration-150',
          status === 'ready' ? 'opacity-100' : 'opacity-0'
        )}
      />

      {status !== 'ready' && status !== 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/90 text-zinc-500 gap-1.5">
          <div className="w-5 h-5 border-2 border-zinc-700 border-t-indigo-500 rounded-full animate-spin" />
          {!isThumbnail && (
            <span className="text-[11px] font-mono tabular-nums text-zinc-500">
              Стр. {pageNumber}
            </span>
          )}
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 text-zinc-500 p-3 text-center gap-1">
          <FileText className="w-5 h-5 text-zinc-600" />
          <span className="text-[10px] font-mono">PDF стр. {pageNumber}</span>
        </div>
      )}
    </div>
  );
};

export default PdfPageCanvas;
