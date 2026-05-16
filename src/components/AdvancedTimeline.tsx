import React, { useRef, useState, useEffect } from 'react';
import { useTimelineData } from '../contexts/TimelineContext';
import { 
  Play, 
  Pause, 
  Circle, 
  Square, 
  Repeat,
  Archive,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Magnet
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Project, AudioTrack, AudioSegment } from '../types';
import TrackHeader from './TrackHeader';
import TimelineCanvas from './TimelineCanvas';
import AudioSegmentView from './AudioSegmentView';
import { TimelineMinimap } from './TimelineMinimap';

import VirtualizedWaveform from './VirtualizedWaveform';


export const Playhead = ({ zoom }: { zoom: number }) => {
  const { currentTime } = useTimelineData();
  return (
    <div 
      className="absolute top-0 bottom-0 w-px bg-rose-500 z-50 pointer-events-none shadow-[0_0_15px_rgba(244,63,94,0.5)]"
      style={{ left: `${currentTime * zoom}px` }}
    >
      <div className="absolute -top-1 -left-1.5 w-3 h-3 bg-rose-500 rotate-45 shadow-lg" />
      <div className="absolute top-0 bottom-0 -left-1 w-2 bg-rose-500/10" />
    </div>
  );
};


export const CurrentTimeDisplay = () => {
  const { currentTime } = useTimelineData();
  return (
    <span className="text-xl font-mono font-bold text-indigo-400 tracking-widest leading-none">
      {Math.floor(currentTime / 60).toString().padStart(2, '0')}:
      {Math.floor(currentTime % 60).toString().padStart(2, '0')}:
      {Math.floor((currentTime % 1) * 30).toString().padStart(2, '0')}
    </span>
  );
};


export const TimelineAutoScroller = ({ timelineRef, isPlaying, zoom }: any) => {
  const { currentTime } = useTimelineData();
  
  useEffect(() => {
    if (!timelineRef.current) return;
    const el = timelineRef.current;
    const scrollLeft = el.scrollLeft;
    const clientWidth = el.clientWidth;
    const currentX = currentTime * zoom;
    
    // Auto-scroll if playhead goes beyond 95% of visible width, or behind current view
    const isOutRight = currentX > scrollLeft + clientWidth * 0.95;
    const isOutLeft = currentX < scrollLeft;

    if (isOutRight || isOutLeft) {
      if (isPlaying) {
        // Simple assignment during playback for a clean "page turn" or to follow along instantly
        el.scrollLeft = Math.max(0, currentX - clientWidth * 0.1);
      } else {
        // Smooth snap to center if seeking or clicking around while paused
        el.scrollTo({
          left: Math.max(0, currentX - clientWidth * 0.4),
          behavior: 'smooth'
        });
      }
    }
  }, [currentTime, isPlaying, zoom, timelineRef]);
  return null;
};

interface LiveRecordingSegmentProps {
  recordingStartTime?: number;
  currentTime: number;
  zoom: number;
  recordingPeaks?: number[];
  timelineWidth?: number;
}

const LiveRecordingSegment = ({ recordingStartTime, zoom, recordingPeaks, timelineWidth }: Omit<LiveRecordingSegmentProps, 'currentTime'>) => {
  const { currentTime } = useTimelineData();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !recordingPeaks?.length) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    
    // Resize canvas if needed
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    // Show last N peaks that fit the width
    const maxPeaks = Math.floor(width / 3);
    const peaksToShow = recordingPeaks.slice(-maxPeaks);
    const step = width / (maxPeaks || 1);

    peaksToShow.forEach((p: number, i: number) => {
      const x = i * step;
      const peakHeight = Math.max(2, p * height * 0.8);
      ctx.moveTo(x, height / 2 - peakHeight / 2);
      ctx.lineTo(x, height / 2 + peakHeight / 2);
    });
    ctx.stroke();
    ctx.restore();
  }, [recordingPeaks, timelineWidth, zoom]);

  if (recordingStartTime === undefined) return null;
  
  return (
    <div 
      className="absolute top-0 bottom-0 bg-rose-500/20 border-l-2 border-rose-500 z-10 overflow-hidden"
      style={{ 
        left: `${recordingStartTime * zoom}px`, 
        width: `${Math.max(0, currentTime - recordingStartTime) * zoom}px`
      }}
    >
      <canvas 
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />
      <div className="absolute top-2 left-2 flex items-center gap-2 bg-black/40 px-2 py-0.5 rounded backdrop-blur-sm border border-rose-500/30">
        <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
        <span className="text-[9px] font-black text-rose-500 uppercase tracking-tighter">Эфир</span>
      </div>
    </div>
  );
};

interface TrackRowProps {
  track: AudioTrack;
  project: Project;
  zoom: number;
  selectedSegmentIds: string[];
  onUpdateSegment: (trackId: string, segmentId: string, updates: Partial<AudioSegment>, targetTrackId?: string) => void;
  onDeleteSegment?: (trackId: string, segmentId: string) => void;
  snapTime: (time: number, excludeSegmentId?: string) => { time: number; snapped: boolean };
  setSnapLine: (time: number | null) => void;
  onSplitSegment?: (trackId: string, segmentId: string, time: number) => void;
  onDuplicateSegment?: (trackId: string, segmentId: string, newStartTime: number) => void;
  onSelectSegment?: (segmentId: string, multi: boolean) => void;
  onGlueSegments?: () => void;
  currentTimeRef: React.MutableRefObject<number>;
  timelineVisibleRange: { start: number; end: number };
}

const TrackRow = React.memo(({ 
  track, 
  project, 
  zoom, 
  selectedSegmentIds, 
  onUpdateSegment, 
  onDeleteSegment, 
  snapTime, 
  setSnapLine, 
  onSplitSegment, 
  onDuplicateSegment, 
  onSelectSegment, 
  onGlueSegments,
  currentTimeRef,
  timelineVisibleRange
}: TrackRowProps) => {
  const segmentsWithFades = React.useMemo(() => {
    let segmentsToRender = track.segments;
    
    if (timelineVisibleRange) {
      segmentsToRender = segmentsToRender.filter((s: AudioSegment) => 
        s.startTime < timelineVisibleRange.end && (s.startTime + s.duration) > timelineVisibleRange.start
      );
    }

    const sortedSegs = [...segmentsToRender]
      .sort((a: AudioSegment, b: AudioSegment) => a.startTime - b.startTime);
    
    return segmentsToRender.map((segment: AudioSegment) => {
      const idxInSorted = sortedSegs.findIndex((s: AudioSegment) => s.id === segment.id);
      const prevSeg = idxInSorted > 0 ? sortedSegs[idxInSorted - 1] : null;
      const nextSeg = idxInSorted < sortedSegs.length - 1 ? sortedSegs[idxInSorted + 1] : null;

      let autoFadeIn = 0;
      let autoFadeOut = 0;

      if (prevSeg && prevSeg.startTime + prevSeg.duration > segment.startTime) {
        autoFadeIn = Math.max(0, (prevSeg.startTime + prevSeg.duration) - segment.startTime);
      }
      if (nextSeg && segment.startTime + segment.duration > nextSeg.startTime) {
        autoFadeOut = Math.max(0, (segment.startTime + segment.duration) - nextSeg.startTime);
      }

      return { segment, autoFadeIn, autoFadeOut };
    });
  }, [track.segments, timelineVisibleRange]);

  return (
    <div className="border-b border-white/5 relative group timeline-track pointer-events-none" data-track-id={track.id} style={{ height: track.height || 80 }}>
      {/* Track Background Grid */}
      <div className="absolute inset-0 pointer-events-none opacity-20 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px)]" style={{ backgroundSize: `${zoom}px 100%` }} />
      
      {/* Audio Segments */}
      {segmentsWithFades.map(({ segment, autoFadeIn, autoFadeOut }) => (
        <AudioSegmentView 
          key={segment.id}
          seg={segment}
          zoom={zoom}
          audioOffsetMs={project.audioOffsetMs}
          timelineVisibleRange={timelineVisibleRange}
          onUpdate={(id, updates, targetTrackId) => onUpdateSegment(track.id, id, updates, targetTrackId)}
          onDelete={(id) => onDeleteSegment?.(track.id, id)}
          snapTime={snapTime}
          onSnapLine={setSnapLine}
          onSplit={onSplitSegment ? (id) => onSplitSegment(track.id, id, currentTimeRef.current) : undefined}
          onDuplicate={onDuplicateSegment ? (id, newStart) => onDuplicateSegment(track.id, id, newStart) : undefined}
          isSelected={selectedSegmentIds.includes(segment.id)}
          onSelect={(e) => {
            if (segment.id && onSelectSegment) {
              onSelectSegment(segment.id, e.shiftKey);
            }
          }}
          onGlue={(selectedSegmentIds.length > 1 && selectedSegmentIds.includes(segment.id)) ? onGlueSegments : undefined}
          autoFadeIn={autoFadeIn}
          autoFadeOut={autoFadeOut}
        />
      ))}
    </div>
  );
});

export const AdvancedTimeline = ({ 
  project, 
  duration, 
  isPlaying, 
  isRecording, 
  onPlayPause, 
  onRecord, 
  onSeek, 
  onZoom, 
  zoom,
  onUpdateSegment,
  onDeleteSegment,
  loopRange,
  onSetLoopRange,
  onUpdateTrack,
  onUpdateAllTracks,
  onDeleteTrack,
  onAddTrack,
  onArmTrack,
  onSplitSegment,
  onDuplicateSegment,
  isLooping,
  onToggleLoop,
  isRippleEnabled,
  onToggleRipple,
  selectedSegmentIds = [],
  onSelectSegment,
  onClearSelection,
  onGlueSegments,
  recordingPeaks,
  recordingStartTime,
  onOpenProcessing,
  currentTimeRef
}: { 
  project: Project, 
  duration: number, 
  isPlaying: boolean, 
  isRecording: boolean, 
  onPlayPause: () => void, 
  onRecord: () => void, 
  onSeek: (time: number) => void, 
  onZoom: (zoom: number) => void, 
  zoom: number,
  onUpdateSegment: (trackId: string, segmentId: string, updates: Partial<AudioSegment>, targetTrackId?: string) => void,
  onDeleteSegment?: (trackId: string, segmentId: string) => void,
  loopRange: { start: number, end: number } | null,
  onSetLoopRange: (range: { start: number, end: number } | null) => void,
  onUpdateTrack: (trackId: string, updates: Partial<AudioTrack>) => void,
  onUpdateAllTracks?: (updates: Partial<AudioTrack>) => void,
  onDeleteTrack?: (trackId: string) => void,
  onAddTrack?: () => void,
  onArmTrack?: (trackId: string) => void,
  onSplitSegment?: (trackId: string, segmentId: string, time: number) => void,
  onDuplicateSegment?: (trackId: string, segmentId: string, newStartTime: number) => void,
  isLooping: boolean,
  onToggleLoop: () => void,
  isRippleEnabled?: boolean,
  onToggleRipple?: () => void,
  selectedSegmentIds?: string[],
  onSelectSegment?: (segmentId: string, multi: boolean) => void,
  onClearSelection?: () => void,
  onGlueSegments?: () => void,
  recordingPeaks?: number[],
  recordingStartTime?: number,
  onOpenProcessing?: (id: string) => void,
  currentTimeRef: React.MutableRefObject<number>
}) => {
  const handleSeek = (time: number) => {
    onSeek(time);
    
    // Force scroll to center the new position
    if (timelineRef.current) {
      const scrollTarget = (time * zoom) - (timelineRef.current.clientWidth / 2);
      timelineRef.current.scrollTo({
        left: Math.max(0, scrollTarget),
        behavior: 'instant' 
      });
    }
  };

  if (!project) return null;

  const timelineRef = useRef<HTMLDivElement>(null);
  const trackHeadersRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isSelectingRange, setIsSelectingRange] = useState(false);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [isMarqueeSelecting, setIsMarqueeSelecting] = useState(false);
  const [marqueeStart, setMarqueeStart] = useState<{ x: number, y: number } | null>(null);
  const [marqueeCurrent, setMarqueeCurrent] = useState<{ x: number, y: number } | null>(null);

  const [isSnapEnabled, setIsSnapEnabled] = useState(true);
  const [snapLine, setSnapLine] = useState<number | null>(null);

  const sortedTracks = React.useMemo(() => {
    return [...project.tracks].sort((a, b) => {
      if (a.name === 'Оригинал') return -1;
      if (b.name === 'Оригинал') return 1;
      return 0;
    });
  }, [project.tracks]);

  const zoomRef = useRef(zoom);
  const sortedTracksRef = useRef(sortedTracks);
  const onZoomRef = useRef(onZoom);
  const onUpdateAllTracksRef = useRef(onUpdateAllTracks);
  const onUpdateTrackRef = useRef(onUpdateTrack);

  useEffect(() => {
    zoomRef.current = zoom;
    sortedTracksRef.current = sortedTracks;
    onZoomRef.current = onZoom;
    onUpdateAllTracksRef.current = onUpdateAllTracks;
    onUpdateTrackRef.current = onUpdateTrack;
  }, [zoom, sortedTracks, onZoom, onUpdateAllTracks, onUpdateTrack]);

  const getSnapPoints = React.useCallback((excludeSegmentId?: string) => {
    const points = new Set<number>();
    project.subtitles.forEach(sub => {
      points.add(sub.start);
      points.add(sub.end);
    });
    sortedTracks.forEach(track => {
      track.segments.forEach(seg => {
        if (seg.id !== excludeSegmentId) {
          points.add(seg.startTime);
          points.add(seg.startTime + seg.duration);
        }
      });
    });
    return Array.from(points);
  }, [project.subtitles, sortedTracks]);

  const snapTime = React.useCallback((time: number, excludeSegmentId?: string): { time: number, snapped: boolean } => {
    if (!isSnapEnabled) return { time, snapped: false };
    
    const threshold = 10 / zoom;
    let closestTime = time;
    let minDiff = threshold;
    let snapped = false;

    const snapPoints = getSnapPoints(excludeSegmentId);
    for (const pt of snapPoints) {
      const diff = Math.abs(time - pt);
      if (diff < minDiff) {
        minDiff = diff;
        closestTime = pt;
        snapped = true;
      }
    }

    const gridStep = zoom > 50 ? 0.1 : 1.0;
    const gridPt = Math.round(time / gridStep) * gridStep;
    const gridDiff = Math.abs(time - gridPt);
    if (gridDiff < minDiff) {
      minDiff = gridDiff;
      closestTime = gridPt;
      snapped = true;
    }

    return { time: closestTime, snapped };
  }, [isSnapEnabled, zoom, getSnapPoints]);

  useEffect(() => {
    return () => {
      // Upon unmounting the timeline, we ensure any long running backend operations 
      // triggered by this session are halted.
      if (window.electronAPI && window.electronAPI.forceStopAll) {
         window.electronAPI.forceStopAll().catch(() => {});
      }
    };
  }, []);

  const [timelineVisibleRange, setTimelineVisibleRange] = useState({ start: 0, end: 30 });
  const prevZoomRef = useRef(zoom);

  const updateVisibleRange = () => {
    if (!timelineRef.current) return;
    const scrollLeft = timelineRef.current.scrollLeft;
    const clientWidth = timelineRef.current.clientWidth;
    const start = scrollLeft / zoom;
    const end = (scrollLeft + clientWidth) / zoom;
    setTimelineVisibleRange({ start, end });
  };

  useEffect(() => {
    if (timelineRef.current && prevZoomRef.current !== zoom) {
      // Calculate the time at the center of the current view
      const scrollLeft = timelineRef.current.scrollLeft;
      const clientWidth = timelineRef.current.clientWidth;
      const centerTime = (scrollLeft + clientWidth / 2) / prevZoomRef.current;
      
      // Set the new scrollLeft to keep the center time in the middle
      const newScrollLeft = centerTime * zoom - clientWidth / 2;
      timelineRef.current.scrollLeft = Math.max(0, newScrollLeft);
      
      prevZoomRef.current = zoom;
    }
    updateVisibleRange();
  }, [zoom, duration]);

  /* Auto-scroll moved to component */

  const handleTimelineInteraction = (e: React.MouseEvent | React.TouchEvent) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const x = clientX - rect.left + timelineRef.current.scrollLeft;
    const time = x / zoom;
    
    if (e.shiftKey || isSelectingRange) {
      if (selectionStart === null) {
        setSelectionStart(time);
        setIsSelectingRange(true);
      } else {
        onSetLoopRange({
          start: Math.min(selectionStart, time),
          end: Math.max(selectionStart, time)
        });
      }
    } else {
      const { time: snappedTime, snapped } = snapTime(time);
      handleSeek(Math.max(0, Math.min(duration, snappedTime)));
      setSnapLine(snapped ? snappedTime : null);
    }
  };

  useEffect(() => {
    const handleWheelNative = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
        onZoomRef.current(Math.max(10, Math.min(1000, zoomRef.current * zoomDelta)));
      } else if (e.altKey) {
        e.preventDefault();
        const heightDelta = e.deltaY > 0 ? -10 : 10;
        if (onUpdateAllTracksRef.current) {
          onUpdateAllTracksRef.current({ height: Math.max(60, (sortedTracksRef.current[0]?.height || 80) + heightDelta) });
        } else {
          sortedTracksRef.current.forEach(track => {
            onUpdateTrackRef.current(track.id, { height: Math.max(60, (track.height || 80) + heightDelta) });
          });
        }
      } else {
        // Horizontal scroll with normal wheel
        if (timelineRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          // Limit delta to avoid "infinite" scroll feel on some mice
          const delta = Math.max(-500, Math.min(500, e.deltaY));
          timelineRef.current.scrollLeft += delta;
        }
      }
    };

    const el = timelineRef.current;
    if (el) {
      el.addEventListener('wheel', handleWheelNative, { passive: false });
      return () => el.removeEventListener('wheel', handleWheelNative);
    }
  }, []); // Run only once to attach event listener

  // Synchronize scrolling
  useEffect(() => {
    const timelineEl = timelineRef.current;
    const headerEl = trackHeadersRef.current;
    
    if (!timelineEl || !headerEl) return;

    let isSyncingLeft = false;
    let isSyncingRight = false;
    
    const handleTimelineScroll = () => {
      if (!isSyncingLeft) {
        isSyncingRight = true;
        headerEl.scrollTop = timelineEl.scrollTop;
        updateVisibleRange();
      }
      isSyncingLeft = false;
    };
    
    const handleHeaderScroll = () => {
      if (!isSyncingRight) {
        isSyncingLeft = true;
        timelineEl.scrollTop = headerEl.scrollTop;
      }
      isSyncingRight = false;
    };

    timelineEl.addEventListener('scroll', handleTimelineScroll);
    headerEl.addEventListener('scroll', handleHeaderScroll);
    
    return () => {
      timelineEl.removeEventListener('scroll', handleTimelineScroll);
      headerEl.removeEventListener('scroll', handleHeaderScroll);
    };
  }, []);

  const handleDoubleClick = (e: React.MouseEvent) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (rect && e.clientY - rect.top > 40) {
      onClearSelection?.();
    }
  };

  // Find the armed track for the live recording overlay
  const recordingTrackIndex = sortedTracks.findIndex(t => t.isArmed) !== -1 
    ? sortedTracks.findIndex(t => t.isArmed)
    : sortedTracks.findIndex(t => t.name !== 'Оригинал');

  return (
    <div className="flex-1 flex flex-col bg-zinc-950 border-t border-zinc-800 select-none">
      {/* DAW Transport Bar */}
      <div className="h-14 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-md flex items-center z-50">
        <div className="flex items-center gap-4 px-6">
          <div className="flex items-center bg-black/40 rounded-lg p-1 border border-white/5">
            <button 
              onClick={onPlayPause}
              className={cn(
                "w-10 h-10 rounded-md flex items-center justify-center transition-all",
                isPlaying ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-zinc-400 hover:text-white hover:bg-zinc-800"
              )}
            >
              {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
            </button>
            <button 
              onClick={onRecord}
              className={cn(
                "w-10 h-10 rounded-md flex items-center justify-center transition-all",
                isRecording ? "bg-rose-500 text-white shadow-lg shadow-rose-500/20 animate-pulse" : "text-zinc-400 hover:text-rose-500 hover:bg-zinc-800"
              )}
            >
              {isRecording ? <Square size={18} fill="currentColor" /> : <Circle size={18} fill="currentColor" />}
            </button>
            <button 
              onClick={onToggleLoop}
              className={cn(
                "w-10 h-10 rounded-md flex items-center justify-center transition-all",
                isLooping ? "bg-amber-500 text-white shadow-lg shadow-amber-500/20" : "text-zinc-400 hover:text-amber-500 hover:bg-zinc-800"
              )}
            >
              <Repeat size={18} />
            </button>
            <button 
              onClick={() => setIsSnapEnabled(!isSnapEnabled)}
              className={cn(
                "w-10 h-10 rounded-md flex items-center justify-center transition-all ml-2",
                isSnapEnabled ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-zinc-400 hover:text-indigo-500 hover:bg-zinc-800"
              )}
              title="Магнит (Snapping)"
            >
              <Magnet size={18} />
            </button>
            {onToggleRipple && (
              <button 
                onClick={onToggleRipple}
                className={cn(
                  "w-10 h-10 rounded-md flex items-center justify-center transition-all ml-2",
                  isRippleEnabled ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-zinc-400 hover:text-indigo-500 hover:bg-zinc-800"
                )}
                title="Ripple Edit (Сдвиг сегментов при удалении/изменении длины)"
              >
                <ChevronRight size={18} />
              </button>
            )}
          </div>

          <div className="flex flex-col items-center justify-center bg-black/60 px-4 py-1 rounded border border-white/5 min-w-[140px]">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-tighter leading-none mb-1">Текущее время</span>
            <CurrentTimeDisplay />
          </div>
        </div>

        {/* Minimap positioned to the right of current time */}
        {duration > 0 && (
          <div className="flex-1 h-full pl-2">
            <TimelineMinimap 
              project={project}
              duration={duration}
              onSeek={handleSeek}
              visibleRange={timelineVisibleRange}
            />
          </div>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Track Headers Column */}
        <div className="w-64 border-r border-zinc-800 bg-zinc-950 flex flex-col z-40 relative">
          <div className="h-10 min-h-10 border-b border-zinc-800 bg-zinc-900/50 flex items-center px-4 relative z-50">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Дорожки</span>
          </div>
          <div 
            ref={trackHeadersRef}
            className="flex-1 overflow-hidden no-scrollbar bg-zinc-950"
          >
            {sortedTracks.map(track => (
              <TrackHeader 
                key={track.id} 
                track={track} 
                isMuted={track.isMuted} 
                isSoloed={!!track.isSolo} 
                volume={track.volume} 
                onMute={(id) => onUpdateTrack(id, { isMuted: !track.isMuted })} 
                onSolo={(id) => onUpdateTrack && onUpdateTrack(id, { isSolo: !track.isSolo })} 
                onVolumeChange={(id, vol) => onUpdateTrack && onUpdateTrack(id, { volume: vol })} 
                onArm={(id) => onArmTrack && onArmTrack(id)}
                onRename={(id, name) => onUpdateTrack && onUpdateTrack(id, { name })}
                onClear={(id) => onUpdateTrack(id, { segments: [] })}
                onDelete={(id) => onDeleteTrack?.(id)}
                onUpdateProcessing={(id, processing) => onUpdateTrack(id, { processing })}
                onHeightChange={(id, height) => onUpdateTrack(id, { height })}
                onSelectSegment={onSelectSegment}
                onOpenProcessing={onOpenProcessing}
              />
            ))}
            {onAddTrack && (
              <button 
                onClick={onAddTrack}
                className="w-full h-10 border-t border-zinc-800 bg-zinc-900/30 flex items-center justify-center gap-2 hover:bg-zinc-800 transition-colors text-zinc-500 hover:text-zinc-300 shrink-0"
              >
                <Circle size={10} className="text-zinc-600" />
                <span className="text-[10px] font-black uppercase tracking-widest">+ Добавить дорожку</span>
              </button>
            )}
          </div>
        </div>

        {/* Timeline Area */}
        <div 
          ref={timelineRef}
          onDoubleClick={handleDoubleClick}
          className="flex-1 overflow-auto relative bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] bg-repeat"
          onMouseDown={(e) => {
            if (e.button === 0) {
              const rect = e.currentTarget.getBoundingClientRect();
              const scrollLeft = e.currentTarget.scrollLeft;
              const scrollTop = e.currentTarget.scrollTop;
              
              const clickX = e.clientX - rect.left;
              const time = (clickX + scrollLeft) / zoom;
              
              onSeek(Math.max(0, Math.min(duration, time)));
              
              if (e.shiftKey && e.clientY - rect.top > 40) {
                // Marquee selection with Shift
                onClearSelection?.();
                setIsMarqueeSelecting(true);
                setMarqueeStart({ x: clickX + scrollLeft, y: e.clientY - rect.top + scrollTop });
                setMarqueeCurrent({ x: clickX + scrollLeft, y: e.clientY - rect.top + scrollTop });
              } else {
                // Normal scrubbing
                setIsScrubbing(true);
                handleTimelineInteraction(e);
              }
            }
          }}
          onMouseMove={(e) => {
            if (isScrubbing || isSelectingRange) {
              handleTimelineInteraction(e);
            } else if (isMarqueeSelecting && marqueeStart) {
              const rect = timelineRef.current?.getBoundingClientRect();
              if (rect) {
                const x = e.clientX - rect.left + (timelineRef.current?.scrollLeft || 0);
                const y = e.clientY - rect.top + (timelineRef.current?.scrollTop || 0);
                setMarqueeCurrent({ x, y });
              }
            }
          }}
          onMouseUp={() => {
            if (isMarqueeSelecting && marqueeStart && marqueeCurrent) {
              const minX = Math.min(marqueeStart.x, marqueeCurrent.x);
              const maxX = Math.max(marqueeStart.x, marqueeCurrent.x);
              const minY = Math.min(marqueeStart.y, marqueeCurrent.y);
              const maxY = Math.max(marqueeStart.y, marqueeCurrent.y);
              
              const newSelectedIds: string[] = [];
              let currentY = 40; // Ruler height
              
              sortedTracks.forEach(track => {
                const trackTop = currentY;
                const trackBottom = currentY + (track.height || 80);
                
                if (trackBottom > minY && trackTop < maxY) {
                  track.segments.forEach(seg => {
                    const segLeft = seg.startTime * zoom;
                    const segRight = (seg.startTime + seg.duration) * zoom;
                    
                    if (segRight > minX && segLeft < maxX) {
                      newSelectedIds.push(seg.id);
                    }
                  });
                }
                currentY += (track.height || 80);
              });
              
              if (onSelectSegment && newSelectedIds.length > 0) {
                onClearSelection?.();
                newSelectedIds.forEach(id => onSelectSegment(id, true));
              }
            }

            setIsScrubbing(false);
            setIsSelectingRange(false);
            setIsMarqueeSelecting(false);
            setSelectionStart(null);
            setSnapLine(null);
            setMarqueeStart(null);
            setMarqueeCurrent(null);
          }}
          onMouseLeave={() => {
            setIsScrubbing(false);
            setIsSelectingRange(false);
            setIsMarqueeSelecting(false);
            setSelectionStart(null);
            setSnapLine(null);
            setMarqueeStart(null);
            setMarqueeCurrent(null);
          }}
        >
          <div 
            className="relative h-full"
            style={{ width: `${duration * zoom}px`, minHeight: '100%' }}
          >
            {/* Ruler & Grid */}
            <div 
              className="sticky top-0 h-10 w-full bg-zinc-900/90 backdrop-blur-sm border-b border-zinc-800 z-30 cursor-pointer"
              onMouseDown={(e) => {
                e.stopPropagation();
                if (e.button === 0) {
                  if (e.shiftKey) {
                    setIsSelectingRange(true);
                    const rect = timelineRef.current?.getBoundingClientRect();
                    if (rect) {
                      const x = e.clientX - rect.left + (timelineRef.current?.scrollLeft || 0);
                      setSelectionStart(x / zoom);
                    }
                  } else {
                    setIsScrubbing(true);
                    handleTimelineInteraction(e);
                  }
                }
              }}
            >
              <TimelineCanvas 
                project={project} 
                duration={duration} 
                zoom={zoom} 
                visibleRange={timelineVisibleRange}
                loopRange={loopRange}
              />
            </div>

            {/* Tracks Content */}
            <div className="relative">
              {sortedTracks.map((track, idx) => (
                <div key={track.id} className="relative">
                  <TrackRow 
                    track={track}
                    project={project}
                    zoom={zoom}
                    selectedSegmentIds={selectedSegmentIds}
                    onUpdateSegment={onUpdateSegment}
                    onDeleteSegment={onDeleteSegment}
                    snapTime={snapTime}
                    setSnapLine={setSnapLine}
                    onSplitSegment={onSplitSegment}
                    onDuplicateSegment={onDuplicateSegment}
                    onSelectSegment={onSelectSegment}
                    onGlueSegments={onGlueSegments}
                    currentTimeRef={currentTimeRef}
                    timelineVisibleRange={timelineVisibleRange}
                  />
                  {/* Live Recording Segment */}
                  {isRecording && idx === recordingTrackIndex && (
                    <LiveRecordingSegment 
                      recordingStartTime={recordingStartTime} 
                      zoom={zoom} 
                      recordingPeaks={recordingPeaks} 
                      timelineWidth={timelineRef.current?.clientWidth} 
                    />
                  )}
                </div>
              ))}
              {/* Spacer for Add Track button alignment */}
              {onAddTrack && <div className="h-10 border-b border-white/5 bg-zinc-900/10" />}
            </div>

            {/* Playhead */}
            <Playhead zoom={zoom} />
            
            {/* Auto-scroller */}
            <TimelineAutoScroller timelineRef={timelineRef} isPlaying={isPlaying} zoom={zoom} />

            {/* Snap Line */}
            {snapLine !== null && (
              <div 
                className="absolute top-0 bottom-0 w-px bg-white z-[60] pointer-events-none shadow-[0_0_8px_rgba(255,255,255,0.8)]"
                style={{ left: `${snapLine * zoom}px` }}
              />
            )}

            {/* Marquee Selection Box */}
            {isMarqueeSelecting && marqueeStart && marqueeCurrent && (
              <div 
                className="absolute bg-indigo-500/20 border border-indigo-500/50 z-[70] pointer-events-none"
                style={{
                  left: `${Math.min(marqueeStart.x, marqueeCurrent.x)}px`,
                  top: `${Math.min(marqueeStart.y, marqueeCurrent.y)}px`,
                  width: `${Math.abs(marqueeCurrent.x - marqueeStart.x)}px`,
                  height: `${Math.abs(marqueeCurrent.y - marqueeStart.y)}px`
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(AdvancedTimeline, (prev, next) => {
  return prev.project === next.project && 
         prev.zoom === next.zoom && 
         prev.isPlaying === next.isPlaying &&
         prev.isRecording === next.isRecording &&
         prev.loopRange === next.loopRange &&
         prev.isLooping === next.isLooping &&
         prev.isRippleEnabled === next.isRippleEnabled &&
         prev.selectedSegmentIds === next.selectedSegmentIds &&
         prev.recordingStartTime === next.recordingStartTime &&
         prev.recordingPeaks === next.recordingPeaks;
});
