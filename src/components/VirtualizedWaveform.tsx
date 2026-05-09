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
    
    // Find the maximum peak for normalization
    let maxPeak = 0.0001; 
    // Optimization: only search visible peaks for max to avoid O(N) on huge arrays, 
    // or just assume max=1 since they are normalized to 0..1 from rust!
    // Wait, let's keep the existing loop but it's okay because 75k iterations in TS takes <1ms.
    for(let i = 0; i < peaks.length; i++) { 
        if (peaks[i] > maxPeak) maxPeak = peaks[i]; 
    }
    
    const scaleFactor = 1 / maxPeak;

    ctx.fillStyle = color;
    
    const totalPeaks = peaks.length;
    // Note: duration here is the file's duration, not the segment's duration!
    // But passed duration might be segment's fileDuration.
    const peaksPerSecond = totalPeaks / duration;
    
    // file map: local offset + segmentOffset
    const startIdx = Math.floor((drawStart + segmentOffset) * peaksPerSecond);
    const endIdx = Math.ceil((drawEnd + segmentOffset) * peaksPerSecond);
    
    const peakWidth = zoom / peaksPerSecond;
    const barWidth = Math.max(1, peakWidth - 0.5);
    
    for (let i = Math.max(0, startIdx); i < Math.min(totalPeaks, endIdx); i++) {
      const normalizedPeak = peaks[i] * scaleFactor;
      const visualPeak = Math.pow(normalizedPeak, 0.6); 

      // x relative to the canvas drawStart
      const localTime = (i / peaksPerSecond) - segmentOffset;
      const x = (localTime - drawStart) * zoom;
      
      const h = Math.max(1, visualPeak * height);
      const y = (height - h) / 2;
      
      ctx.fillRect(x, y, barWidth, h);
    }
  }, [peaks, zoom, duration, color, vRange, isRelative, segmentOffset, segmentStartTime, audioOffsetMs]);
  
  return <canvas ref={canvasRef} className="absolute top-0 h-full pointer-events-none" />;
};

export default VirtualizedWaveform;
