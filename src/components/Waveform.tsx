import React, { useEffect, useRef } from 'react';
import { logger } from '../lib/logger';

export const Waveform = ({ peaks, color = '#3b82f6' }: { peaks: number[], color?: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      logger.debug("Waveform: canvas is null");
      return;
    }
    if (!peaks || peaks.length === 0) {
      logger.debug("Waveform: peaks are empty or undefined", { length: peaks?.length });
      return;
    }
    logger.debug(`Waveform: drawing peaks. Length: ${peaks.length}, color: ${color}`);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      if (!canvas) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return; // Wait for layout

      const dpr = window.devicePixelRatio || 1;

      // Always reset canvas size properly for high DPI
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.resetTransform();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);
      
      // Find maximum peak to normalize the visual waveform
      let maxPeak = 0.0001;
      for (let i = 0; i < peaks.length; i++) {
          if (peaks[i] > maxPeak) maxPeak = peaks[i];
      }
      const scaleFactor = 1 / maxPeak;

      ctx.fillStyle = color;
      
      // Optimization: if we have 75k peaks but only 1000 pixels, we shouldn't draw 75000 rects.
      // But we will just use a fast linear step.
      const step = Math.max(1, Math.floor(peaks.length / (width * 2))); // 2 samples per pixel wide max
      const barWidth = Math.max(1, width / (peaks.length / step));
      
      for (let i = 0; i < peaks.length; i += step) {
        // Average or simple downsample. We'll downsample for speed.
        const peak = peaks[i];
        const normalizedPeak = peak * scaleFactor;
        const visualPeak = Math.pow(normalizedPeak, 0.6);

        const x = (i / peaks.length) * width;
        const h = Math.max(1, visualPeak * height * 0.9);
        const y = (height - h) / 2;
        ctx.fillRect(x, y, barWidth, h); // user fillRect instead of beginPath+roundRect for massive speed boost
      }
    };

    draw();

    // Redraw if resized
    const resizeObserver = new ResizeObserver(() => {
      draw();
    });
    resizeObserver.observe(canvas);

    return () => {
      resizeObserver.disconnect();
    };
  }, [peaks, color]);

  return <canvas ref={canvasRef} className="w-full h-full opacity-60 pointer-events-none block" />;
};

