import React, { useEffect, useRef } from 'react';

interface ScrollingWaveformProps {
  peaks?: number[];
  currentTime: number;
  duration: number;
}

export const ScrollingWaveform: React.FC<ScrollingWaveformProps> = ({
  peaks,
  currentTime,
  duration
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = React.useState({ w: window.innerWidth });

  useEffect(() => {
    let resizeTimer: NodeJS.Timeout;
    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (canvasRef.current) {
          // Just triggering a re-render will re-run the layout/drawing effect.
          // The easiest way is to add a small resize state, but we can also just
          // call a draw function if we extract it.
          // Let's just force a dummy state update.
          setDimensions({
            w: canvasRef.current.parentElement?.clientWidth || window.innerWidth
          });
        }
      }, 100);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.parentElement?.clientWidth || 800;
    const height = 80;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (!peaks || peaks.length === 0 || duration <= 0) return;

    // We want to show a window around currentTime, say 4 seconds total (-1.5s to +2.5s or -2 to +2)
    const windowSeconds = 6; // 6 seconds visible
    const pixelsPerSecond = width / windowSeconds;
    
    const visibleStart = currentTime - (windowSeconds / 2);
    const visibleEnd = currentTime + (windowSeconds / 2);

    let maxPeak = 0.0001;
    for (let i = 0; i < peaks.length; i++) {
      if (peaks[i] > maxPeak) maxPeak = peaks[i];
    }
    const scaleFactor = 1 / maxPeak;

    const totalPeaks = peaks.length;
    const peaksPerSecond = totalPeaks / duration;

    const barWidth = 3;
    const gap = 1;
    const step = barWidth + gap;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'; // semi-transparent white

    for (let x = 0; x < width; x += step) {
      const colTimeStart = visibleStart + (x / pixelsPerSecond);
      const colTimeEnd = visibleStart + ((x + step) / pixelsPerSecond);

      if (colTimeEnd < 0 || colTimeStart > duration) continue;

      const idxStart = Math.floor(colTimeStart * peaksPerSecond);
      const idxEnd = Math.ceil(colTimeEnd * peaksPerSecond);

      let maxVal = 0.0;
      const actualStart = Math.max(0, idxStart);
      const actualEnd = Math.min(totalPeaks, idxEnd);

      if (actualEnd > actualStart) {
        for (let i = actualStart; i < actualEnd; i++) {
          if (peaks[i] > maxVal) maxVal = peaks[i];
        }
      } else {
        const idx = Math.floor(colTimeStart * peaksPerSecond);
        if (idx >= 0 && idx < totalPeaks) {
          maxVal = peaks[idx];
        }
      }

      const normalizedPeak = maxVal * scaleFactor;
      const visualPeak = Math.pow(normalizedPeak, 0.6);

      const h = Math.max(2, visualPeak * height);
      const y = (height - h) / 2;

      ctx.fillRect(x, y, barWidth, h);
    }

    // Draw center line (playhead)
    ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
    ctx.fillRect(width / 2, 0, 2, height);
  }, [peaks, currentTime, duration, dimensions]);

  return (
    <div className="absolute bottom-10 left-0 right-0 h-[80px] pointer-events-none z-40 flex items-center justify-center">
      <canvas ref={canvasRef} className="opacity-80" />
    </div>
  );
};
