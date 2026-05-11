import React, { useEffect, useRef } from 'react';
import { Project } from '../types';

export const TimelineCanvas = React.memo(({ 
  project, 
  duration, 
  zoom, 
  visibleRange: vRange,
  loopRange
}: { 
  project: Project, 
  duration: number, 
  zoom: number, 
  visibleRange: { start: number, end: number },
  loopRange: { start: number, end: number } | null
}) => {
  if (!project) return null;

  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const dynamicCanvasRef = useRef<HTMLCanvasElement>(null);

  // 1. Draw Static Elements (Grid, Ticks, Subtitles)
  useEffect(() => {
    const canvas = staticCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const width = (vRange.end - vRange.start) * zoom;
    const height = canvas.parentElement?.clientHeight || 120;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.left = `${vRange.start * zoom}px`;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const startSec = Math.floor(vRange.start);
    const endSec = Math.ceil(vRange.end);
    
    ctx.beginPath();
    for (let s = startSec; s <= endSec; s++) {
      const x = (s - vRange.start) * zoom;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    ctx.stroke();

    ctx.fillStyle = '#71717a';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    for (let s = startSec; s <= endSec; s++) {
      const x = (s - vRange.start) * zoom;
      ctx.moveTo(x, 0); ctx.lineTo(x, 12);
      if (zoom > 50) {
        for (let sub = 1; sub < 10; sub++) {
          const subX = x + (sub / 10) * zoom;
          ctx.moveTo(subX, 0); ctx.lineTo(subX, sub === 5 ? 8 : 4);
        }
      }
    }
    ctx.stroke();

    for (let s = startSec; s <= endSec; s++) {
      const x = (s - vRange.start) * zoom;
      const mins = Math.floor(s / 60);
      const secs = s % 60;
      ctx.fillText(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:00`, x + 4, 10);
    }

    project.subtitles.forEach(sub => {
      if (project.selectedRole && sub.role !== project.selectedRole) return;
      if (sub.end < vRange.start || sub.start > vRange.end) return;
      const x = (sub.start - vRange.start) * zoom;
      const w = (sub.end - sub.start) * zoom;
      ctx.fillStyle = 'rgba(99, 102, 241, 0.2)'; ctx.fillRect(x, 16, w, 14);
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)'; ctx.strokeRect(x, 16, w, 14);
      ctx.fillStyle = '#fff'; ctx.font = '8px sans-serif';
      ctx.fillText(sub.text.substring(0, Math.floor(w / 4)), x + 4, 26);
    });

  }, [project.subtitles, project.selectedRole, duration, zoom, vRange]);

  // 2. Draw Dynamic Elements (Loop Range)
  useEffect(() => {
    const canvas = dynamicCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = (vRange.end - vRange.start) * zoom;
    const height = canvas.parentElement?.clientHeight || 120;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.left = `${vRange.start * zoom}px`;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (loopRange) {
      const startX = (loopRange.start - vRange.start) * zoom;
      const endX = (loopRange.end - vRange.start) * zoom;
      ctx.fillStyle = 'rgba(99, 102, 241, 0.15)'; // indigo-500/15
      ctx.fillRect(startX, 0, endX - startX, height);
      
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(startX, 0);
      ctx.lineTo(startX, height);
      ctx.moveTo(endX, 0);
      ctx.lineTo(endX, height);
      ctx.stroke();
    }
  }, [loopRange, zoom, vRange]);

  return (
    <div className="absolute top-0 h-full w-full pointer-events-none z-20">
      <canvas ref={staticCanvasRef} className="absolute top-0 h-full pointer-events-none" />
      <canvas ref={dynamicCanvasRef} className="absolute top-0 h-full pointer-events-none" />
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.zoom === nextProps.zoom &&
    prevProps.duration === nextProps.duration &&
    prevProps.visibleRange.start === nextProps.visibleRange.start &&
    prevProps.visibleRange.end === nextProps.visibleRange.end &&
    prevProps.loopRange?.start === nextProps.loopRange?.start &&
    prevProps.loopRange?.end === nextProps.loopRange?.end &&
    prevProps.project.selectedRole === nextProps.project.selectedRole &&
    prevProps.project.subtitles === nextProps.project.subtitles
  );
});

export default TimelineCanvas;

