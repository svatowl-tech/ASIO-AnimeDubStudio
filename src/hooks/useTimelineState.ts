import { useState, useRef, useEffect, useCallback, RefObject } from 'react';
import { Project } from '../types';
import { playbackEngine } from '../services/playbackEngine';
import { logger } from '../lib/logger';

export const useTimelineState = (
  project: Project | null,
  duration: number,
  setDuration: (d: number) => void,
  videoRef: RefObject<HTMLVideoElement | null>,
  referenceAudioRef: RefObject<HTMLAudioElement | null>
) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [loopRange, setLoopRange] = useState<{ start: number, end: number } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportOperation, setExportOperation] = useState('');
  const [timelineHeight, setTimelineHeight] = useState(30);
  const [isAutoHeight, setIsAutoHeight] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isRippleEnabled, setIsRippleEnabled] = useState(false);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]);
  const [videoError, setVideoError] = useState<string | null>(null);

  const isPlayingRef = useRef(false);
  const currentTimeRef = useRef(0);
  const isTogglingPlayRef = useRef(false);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

  const timelineRef = useRef<HTMLDivElement>(null);

  const handleSeek = useCallback((time: number) => {
    logger.debug(`Seeking to ${time.toFixed(3)}s`);
    const safeTime = Math.max(0, Math.min(duration, time));
    if (videoRef.current) videoRef.current.currentTime = safeTime;
    if (referenceAudioRef.current) referenceAudioRef.current.currentTime = safeTime;
    setCurrentTime(safeTime);
    currentTimeRef.current = safeTime;
    
    if (project) {
      playbackEngine.seek(safeTime, project.tracks);
    }
  }, [duration, project, videoRef, referenceAudioRef, currentTimeRef]);

  const togglePlay = useCallback(async () => {
    if (isTogglingPlayRef.current) return;
    isTogglingPlayRef.current = true;
    logger.info(`Toggling play: current state is ${isPlayingRef.current ? 'playing' : 'stopped'}`);

    try {
      if (isPlayingRef.current) {
        videoRef.current?.pause();
        referenceAudioRef.current?.pause();
        playbackEngine.stop();
        setIsPlaying(false);
      } else {
        if (videoRef.current && !videoError) {
          try {
            if (Math.abs(videoRef.current.currentTime - currentTimeRef.current) > 0.05) {
               videoRef.current.currentTime = currentTimeRef.current;
            }
            await videoRef.current.play();
            setIsPlaying(true);
            if (project) {
              const tracksToPlay = [...project.tracks];
              const originalsTrack = project.tracks.find(t => t.name === 'Оригинал');
              
              if (project.referenceAudioPath && (!originalsTrack || originalsTrack.segments.length === 0)) {
                const refPath = project.referenceAudioPath;
                const fullPath = refPath.startsWith('./') && project.projectPath 
                  ? `${project.projectPath}/${refPath.slice(2)}` 
                  : refPath;
                
                tracksToPlay.push({
                  id: 'reference-track',
                  name: 'Reference',
                  volume: originalsTrack?.volume ?? 1.0,
                  isMuted: originalsTrack?.isMuted ?? false,
                  isSolo: originalsTrack?.isSolo ?? false,
                  segments: [{
                    id: 'reference-seg',
                    startTime: 0,
                    duration: duration,
                    filePath: fullPath
                  }]
                } as any);
              }
              playbackEngine.play(tracksToPlay, currentTimeRef.current);
            }
          } catch (error: any) {
            if (error.name !== 'AbortError') {
              console.error("Playback failed:", error);
              setVideoError(`Playback failed: ${error.message || "Unknown error"}`);
              
              if (error.name === 'NotSupportedError' || error.name === 'NotAllowedError') {
                // If video fails due to no src or permissions, we can still play audio
                setIsPlaying(true);
                if (project) {
                  const tracksToPlay = [...project.tracks];
                  const originalsTrack = project.tracks.find(t => t.name === 'Оригинал');
                  if (project.referenceAudioPath && (!originalsTrack || originalsTrack.segments.length === 0)) {
                    tracksToPlay.push({
                      id: 'reference-track',
                      name: 'Reference',
                      volume: originalsTrack?.volume ?? 1.0,
                      isMuted: originalsTrack?.isMuted ?? false,
                      isSolo: originalsTrack?.isSolo ?? false,
                      segments: [{
                        id: 'reference-seg',
                        startTime: 0,
                        duration: duration,
                        filePath: project.referenceAudioPath.startsWith('./') && project.projectPath ? `${project.projectPath}/${project.referenceAudioPath.slice(2)}` : project.referenceAudioPath
                      }]
                    } as any);
                  }
                  playbackEngine.play(tracksToPlay, currentTimeRef.current);
                }
              } else {
                setIsPlaying(false);
              }
            }
          }
        } else {
          setIsPlaying(true);
          if (project) {
            const tracksToPlay = [...project.tracks];
            const originalsTrack = project.tracks.find(t => t.name === 'Оригинал');
            
            if (project.referenceAudioPath && (!originalsTrack || originalsTrack.segments.length === 0)) {
              const refPath = project.referenceAudioPath;
              const fullPath = refPath.startsWith('./') && project.projectPath 
                ? `${project.projectPath}/${refPath.slice(2)}` 
                : refPath;
              tracksToPlay.push({
                id: 'reference-track',
                name: 'Reference',
                volume: originalsTrack?.volume ?? 1.0,
                isMuted: originalsTrack?.isMuted ?? false,
                isSolo: originalsTrack?.isSolo ?? false,
                segments: [{
                  id: 'reference-seg',
                  startTime: 0,
                  duration: duration,
                  filePath: fullPath
                }]
              } as any);
            }
            playbackEngine.play(tracksToPlay, currentTimeRef.current);
          }
        }
      }
    } finally {
      setTimeout(() => {
        isTogglingPlayRef.current = false;
      }, 150);
    }
  }, [project, duration, videoError, videoRef, referenceAudioRef]);

  const handleFitToWidth = useCallback((containerWidth: number) => {
    if (duration > 0) {
      const actualContainerWidth = containerWidth - 100; // padding
      const newZoom = actualContainerWidth / duration;
      setZoomLevel(Math.max(10, Math.min(newZoom, 2000)));
    }
  }, [duration]);

  // Sync playback engine with video currentTime periodically
  const lastTickRef = useRef<number>(performance.now());

  useEffect(() => {
    if (!isPlaying) return;

    let rafId: number;
    lastTickRef.current = performance.now();
    
    const sync = () => {
      if (!isPlaying) return;

      let time = currentTimeRef.current;
      
      if (videoRef.current && !videoRef.current.paused && !videoError) {
        time = videoRef.current.currentTime;
      } else {
        const now = performance.now();
        const elapsed = (now - lastTickRef.current) / 1000;
        time += elapsed;
      }
      
      lastTickRef.current = performance.now();
        
      // Loop Logic
      if (isLooping && loopRange && time >= loopRange.end && time - loopRange.end < 1.0) {
        time = loopRange.start;
        if (videoRef.current) videoRef.current.currentTime = time;
        if (referenceAudioRef.current) referenceAudioRef.current.currentTime = time;
        playbackEngine.seek(time, project?.tracks || []);
      }

      playbackEngine.tick(time, project?.tracks || []);
      setCurrentTime(time);
      currentTimeRef.current = time;
      
      rafId = requestAnimationFrame(sync);
    };

    rafId = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, isLooping, loopRange, project?.tracks, videoRef, referenceAudioRef, videoError]);

  // Update playback engine when video playback rate changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleRateChange = () => {
      if (project) {
        playbackEngine.updateTracks(project.tracks);
      }
    };

    video.addEventListener('ratechange', handleRateChange);
    return () => {
      video.removeEventListener('ratechange', handleRateChange);
    };
  }, [videoRef, project]);

  return {
    currentTime, setCurrentTime,
    zoomLevel, setZoomLevel,
    isPlaying, setIsPlaying,
    isLooping, setIsLooping,
    loopRange, setLoopRange,
    isExporting, setIsExporting,
    exportProgress, setExportProgress,
    exportOperation, setExportOperation,
    timelineHeight, setTimelineHeight,
    isAutoHeight, setIsAutoHeight,
    sidebarWidth, setSidebarWidth,
    isRippleEnabled, setIsRippleEnabled,
    selectedSegmentIds, setSelectedSegmentIds,
    videoError, setVideoError,
    handleSeek,
    togglePlay,
    handleFitToWidth,
    isPlayingRef,
    currentTimeRef,
    timelineRef
  };
};
