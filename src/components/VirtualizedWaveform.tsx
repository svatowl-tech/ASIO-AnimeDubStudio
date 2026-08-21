import React, { useEffect, useRef } from 'react';

export const VirtualizedWaveform = ({ 
  peaks, 
  zoom, 
  duration, 
  color, 
  visibleRange: vRange, 
  isRelative = false,
  segmentOffset = 0,
  segmentStartTime = 0,
  audioOffsetMs = 0,
}: { 
  peaks: number[], 
  zoom: number, 
  duration: number, 
  color: string, 
  visibleRange: { start: number, end: number }, 
  isRelative?: boolean,
  segmentOffset?: number, // fileOffset in the segment
  segmentStartTime?: number, // startTime on the timeline
  audioOffsetMs?: number // global project offset
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const scaleFactor = React.useMemo(() => {
    if (!peaks || peaks.length === 0) return 1;
    let maxPeak = 0.0001;
    for (let i = 0; i < peaks.length; i++) {
      if (peaks[i] > maxPeak) maxPeak = peaks[i];
    }
    return 1 / maxPeak;
  }, [peaks]);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Apply project-wide offset to visual start time
    const adjustedStartTime = segmentStartTime + (audioOffsetMs / 1000);
    
    // Calculate what part of the audio to draw
    let drawStart = vRange.start;
    let drawEnd = vRange.end;

    if (isRelative) {
      // For segments, visibleRange is timeline time (e.g. 10s to 30s)
      // adjustedStartTime might be 15s. So the local visible start is -5 to 15.
      // We only care about positive local time [0, duration]
      const localVisibleStart = Math.max(0, vRange.start - adjustedStartTime);
      const localVisibleEnd = Math.min(duration, vRange.end - adjustedStartTime);
      
      if (localVisibleStart >= localVisibleEnd) {
        // Completely out of view
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.display = 'none';
        return;
      }
      canvas.style.display = 'block';

      drawStart = localVisibleStart;
      drawEnd = localVisibleEnd;
    }
    
    // Add a bit of padding so we don't have artifacts at the edges when scrolling
    const padding = 20 / zoom; // 20 pixels padding
    drawStart = Math.max(0, drawStart - padding);
    drawEnd = Math.min(duration, drawEnd + padding);
    
    const width = Math.max(1, (drawEnd - drawStart) * zoom);
    const height = canvas.parentElement?.clientHeight || 48;
    
    const dpr = window.devicePixelRatio || 1;
    // Prevent giant canvases that crash the browser
    if (width > 32000) {
      console.warn("Waveform width exceeded 32000px, truncating.", width);
    }
    const safeWidth = Math.min(32000, width);
    
    canvas.width = safeWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${safeWidth}px`;
    canvas.style.height = `${height}px`;
    
    if (isRelative) {
      canvas.style.left = `${(drawStart) * zoom}px`;
    } else {
      canvas.style.left = `${drawStart * zoom}px`;
    }
    
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, safeWidth, height);
    
    if (!peaks || peaks.length === 0 || duration <= 0) return;
    
    ctx.fillStyle = color;
    
    const totalPeaks = peaks.length;
    const peaksPerSecond = totalPeaks / duration;
    
    const pixelWidth = safeWidth; // Physical canvas width before high-DPI scaling
    const barWidth = 2; // Width of each peak bar
    const gap = 1; // Gap between bars
    const step = barWidth + gap; // Step in pixels
    
    for (let x = 0; x < pixelWidth; x += step) {
      // Find the range of time representing this column of pixels
      const colTimeStart = drawStart + (x / zoom);
      const colTimeEnd = drawStart + ((x + step) / zoom);
      
      const idxStart = Math.floor((colTimeStart + segmentOffset) * peaksPerSecond);
      const idxEnd = Math.ceil((colTimeEnd + segmentOffset) * peaksPerSecond);
      
      let maxVal = 0.0;
      const actualStart = Math.max(0, idxStart);
      const actualEnd = Math.min(totalPeaks, idxEnd);
      
      if (actualEnd > actualStart) {
        for (let i = actualStart; i < actualEnd; i++) {
          if (peaks[i] > maxVal) {
            maxVal = peaks[i];
          }
        }
      } else {
        // Fallback to the closest single peak if the range is empty (due to high zoom level)
        const idx = Math.floor((colTimeStart + segmentOffset) * peaksPerSecond);
        if (idx >= 0 && idx < totalPeaks) {
          maxVal = peaks[idx];
        }
      }
      
      const normalizedPeak = maxVal * scaleFactor;
      const visualPeak = Math.pow(normalizedPeak, 0.6); 
      
      const h = Math.max(1, visualPeak * height);
      const y = (height - h) / 2;
      
      ctx.fillRect(x, y, barWidth, h);
    }
  }, [peaks, zoom, duration, color, vRange, isRelative, segmentOffset, segmentStartTime, audioOffsetMs, scaleFactor]);
  
  return <canvas ref={canvasRef} className="absolute top-0 h-full pointer-events-none" />;
};

export default VirtualizedWaveform;
