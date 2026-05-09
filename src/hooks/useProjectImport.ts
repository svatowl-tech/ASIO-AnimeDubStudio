import React, { useCallback, useRef, useEffect } from 'react';
import { logger } from '../lib/logger';
import { Project, AudioTrack } from '../types';
import { getGlobalAudioSettings, getSafeFileUrl } from '../lib/utils';

export const useProjectImport = (
  project: Project | null,
  setProject: React.Dispatch<React.SetStateAction<Project | null>>,
  setDuration: (duration: number) => void
) => {
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const createDefaultProject = (name: string, path: string): Project => ({
    id: Math.random().toString(36).substr(2, 9),
    name,
    projectPath: path,
    subtitles: [],
    roles: [],
    tracks: [
      { id: '1', name: 'Dubs 1', segments: [], volume: 1, isMuted: false },
      { id: '2', name: 'Dubs 2', segments: [], volume: 1, isMuted: false }
    ],
    latencyOffset: 0,
    audioOffsetMs: 0,
    audioSettings: getGlobalAudioSettings()
  });

  const handleSelectVideo = useCallback(async () => {
    if (!window.electronAPI) return;
    logger.info("Opening video selection dialog");
    const videoDataRes = await window.electronAPI.openVideo();
    if (!isMounted.current) return;
    if (!videoDataRes.success || !videoDataRes.data) {
      logger.warn("Video selection cancelled");
      return;
    }
    const videoData = videoDataRes.data;
    
    logger.info(`Selected video: ${videoData.path}`);
    
    // Choose where to create the project
    let finalProjectRoot = project?.projectPath;
    if (!finalProjectRoot) {
      // Auto-create folder based on video path
      const isWin = videoData.path.includes('\\');
      const sep = isWin ? '\\' : '/';
      const lastSepIndex = videoData.path.lastIndexOf(sep);
      const videoDir = lastSepIndex !== -1 ? videoData.path.substring(0, lastSepIndex) : '';
      const videoNameWithoutExt = videoData.name.replace(/\.[^/.]+$/, "");
      
      finalProjectRoot = videoDir ? `${videoDir}${sep}${videoNameWithoutExt}_Project` : `${videoNameWithoutExt}_Project`;
    }

    // Initialize subdirs
    await window.electronAPI.initProject(finalProjectRoot);
    if (!isMounted.current) return;
    
    // Copy video to /assets
    const assetsDir = `${finalProjectRoot}/assets`.replace(/\\/g, '/');
    const copyRes = await window.electronAPI.copyFileToProject(videoData.path, assetsDir);
    if (!isMounted.current) return;
    const finalVideoPath = copyRes.success && copyRes.data ? copyRes.data : videoData.path;

    const currentProject = project || createDefaultProject(videoData.name.replace(/\.[^/.]+$/, ""), finalProjectRoot);
    
    let updatedTracks = [...currentProject.tracks];
    if (!updatedTracks.find(t => t.name === 'Оригинал')) {
      updatedTracks.unshift({ // Put original at top
        id: 'originals-track',
        name: 'Оригинал',
        volume: 1,
        isMuted: false,
        segments: []
      });
    }

    const updatedProject: Project = { 
      ...currentProject, 
      videoPath: finalVideoPath, 
      videoUrl: getSafeFileUrl(finalVideoPath), 
      projectPath: finalProjectRoot,
      tracks: updatedTracks
    };
    
    setProject(updatedProject);
    
    // Extract audio peaks in the background
    try {
      logger.info("Extracting audio peaks...");
      const takesDir = `${finalProjectRoot}/takes`.replace(/\\/g, '/');
      
      const audioDataRes = await window.electronAPI.extractAudioPeaks(finalVideoPath, takesDir);
      if (!isMounted.current) return;
      
      if (audioDataRes.success && audioDataRes.data) {
        const audioData = audioDataRes.data;
        logger.info("Audio peaks extracted successfully");
        const refPath = audioData.filePath || `${takesDir}/original_audio.wav`.replace(/\\/g, '/');
        
        setProject(prev => {
          if (!prev) return prev;
          return { 
            ...prev, 
            originalPeaks: Array.from(audioData.peaks),
            referenceAudioPath: refPath,
            tracks: prev.tracks.map(t => {
              if (t.name === 'Оригинал') {
                return {
                  ...t,
                  segments: [{
                    id: 'original-audio-seg',
                    startTime: 0,
                    duration: audioData.duration || 999999,
                    fileOffset: 0,
                    fileDuration: audioData.duration,
                    blobUrl: getSafeFileUrl(refPath),
                    filePath: refPath,
                    gain: 1,
                    playbackRate: 1,
                    waveform: Array.from(audioData.peaks)
                  }]
                };
              }
              return t;
            })
          };
        });
        if (audioData.duration) {
          setDuration(audioData.duration);
        }
      }
    } catch (e) {
      logger.error("Failed to extract peaks:", e);
    }
  }, [project, setProject, setDuration, createDefaultProject]);

  return { handleSelectVideo };
};
