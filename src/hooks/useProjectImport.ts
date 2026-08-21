import React, { useCallback, useRef, useEffect } from 'react';
import { logger } from '../lib/logger';
import { Project, AudioTrack, SubtitleLine } from '../types';
import { getGlobalAudioSettings, getSafeFileUrl, getFriendlyImportErrorMessage } from '../lib/utils';

export const useProjectImport = (
  project: Project | null,
  setProject: React.Dispatch<React.SetStateAction<Project | null>>,
  setDuration: (duration: number) => void,
  setIsExporting?: (exp: boolean) => void,
  setExportProgress?: (prog: number) => void,
  setExportOperation?: (op: string) => void
) => {
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const [mkvImportData, setMkvImportData] = React.useState<{ videoPath: string, videoName: string, mediaInfo: any } | null>(null);

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
    try {
      logger.info("Opening video selection dialog");
      const videoDataRes = await window.electronAPI.openVideo();
      if (!isMounted.current) return;
      if (!videoDataRes.success || !videoDataRes.data) {
        logger.warn("Video selection cancelled");
        return;
      }
      const videoData = videoDataRes.data;
      
      logger.info(`Selected video: ${videoData.path}`);
      
      // Check for MKV, HEVC / H.265 or multi-track containers
      const videoPathLower = videoData.path.toLowerCase();
      const isContainerOrHevc = /\.(mkv|hevc|h265|265|ts|m2ts)$/i.test(videoPathLower);

      logger.info(`Analyzing video file: ${videoData.path}, fetching media info...`);
      const infoRes = await window.electronAPI.getMediaInfo(videoData.path);
      
      if (infoRes.success && infoRes.data) {
        try {
          const parsedInfo = JSON.parse(infoRes.data);
          const streams = parsedInfo.streams || [];
          const hasHevc = streams.some((s: any) => s.codec_name === 'hevc' || s.codec_name === 'h265');
          const audioStreamsCount = streams.filter((s: any) => s.codec_type === 'audio').length;
          const subStreamsCount = streams.filter((s: any) => s.codec_type === 'subtitle').length;

          if (isContainerOrHevc || hasHevc || audioStreamsCount > 1 || subStreamsCount > 0) {
            logger.info(`Container/HEVC or multi-track video detected (${streams.length} streams, HEVC=${hasHevc})`);
            setMkvImportData({
              videoPath: videoData.path,
              videoName: videoData.name,
              mediaInfo: parsedInfo
            });
            return; // Open track selector / remux modal
          }
        } catch (e) {
          logger.warn('Could not parse media info JSON, proceeding with standard import', e);
        }
      } else if (isContainerOrHevc) {
        logger.error(`getMediaInfo failed for container/HEVC file:`, infoRes);
        const errorMsg = getFriendlyImportErrorMessage(infoRes.error || "Неизвестная ошибка анализа видеофайла", "медиа-информации контейнера", videoData.path);
        alert(errorMsg);
        return;
      }
      
      logger.info(`Proceeding to import video: ${videoData.path}`);
      await continueImportVideo(videoData.path, videoData.name);
    } catch (error) {
      logger.error("Error in handleSelectVideo:", error);
      const errorMsg = getFriendlyImportErrorMessage(error, "видеофайла");
      alert(errorMsg);
    }
  }, [project, setProject, setDuration, createDefaultProject]);

  const continueImportVideo = async (originalVideoPath: string, videoName: string, subImportedPath?: string) => {
    if (!window.electronAPI) return;
    
    try {
      // Choose where to create the project
      let finalProjectRoot = project?.projectPath;
      if (!finalProjectRoot) {
        // Auto-create folder based on video path
        const isWin = originalVideoPath.includes('\\');
        const sep = isWin ? '\\' : '/';
        const lastSepIndex = originalVideoPath.lastIndexOf(sep);
        const videoDir = lastSepIndex !== -1 ? originalVideoPath.substring(0, lastSepIndex) : '';
        const videoNameWithoutExt = videoName.replace(/\.[^/.]+$/, "");
        
        finalProjectRoot = videoDir ? `${videoDir}${sep}${videoNameWithoutExt}_Project` : `${videoNameWithoutExt}_Project`;
      }

      // Initialize subdirs
      await window.electronAPI.initProject(finalProjectRoot);
      if (!isMounted.current) return;
      
      // Copy video to /assets
      const assetsDir = `${finalProjectRoot}/assets`.replace(/\\/g, '/');
      const copyRes = await window.electronAPI.copyFileToProject(originalVideoPath, assetsDir);
      if (!isMounted.current) return;
      const finalVideoPath = copyRes.success && copyRes.data ? copyRes.data : originalVideoPath;

      let initialSubtitles: SubtitleLine[] = project?.subtitles || [];
      let initialRoles: string[] = project?.roles || [];
      
      if (subImportedPath) {
         try {
           const res = await window.electronAPI.readTextFile(subImportedPath);
           if (res.success && res.data) {
              const parsed = await import('../services/UniversalParserService').then(m => m.UniversalParserService.parse(res.data, subImportedPath));
              if (parsed && parsed.length > 0) {
                  initialSubtitles = parsed;
                  initialRoles = Array.from(new Set(parsed.map(s => s.role)));
                  if (initialRoles.length === 0) initialRoles = ['Default'];
              }
           }
         } catch (err) {
           logger.error("Failed to load extracted subtitles", err);
         }
      }

      const currentProject = project || createDefaultProject(videoName.replace(/\.[^/.]+$/, ""), finalProjectRoot);
      
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
        tracks: updatedTracks,
        subtitles: initialSubtitles,
        roles: initialRoles,
        selectedRole: initialRoles[0] || currentProject.selectedRole,
        audioSettings: {
          ...(currentProject.audioSettings || getGlobalAudioSettings()),
          playOriginalTrackSegments: false
        }
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
          
          const rawDuration = audioData.duration;
          let safeDuration = 0;
          if (Number.isFinite(rawDuration) && !Number.isNaN(rawDuration) && rawDuration > 0) {
            safeDuration = rawDuration;
          } else if (audioData.peaks && audioData.peaks.length > 0) {
            safeDuration = audioData.peaks.length / 50.0;
          } else {
            safeDuration = 30;
          }
          
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
                      duration: safeDuration,
                      fileOffset: 0,
                      fileDuration: safeDuration,
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
          if (safeDuration > 0) {
            setDuration(safeDuration);
          }
        }
      } catch (e) {
        logger.error("Failed to extract peaks:", e);
      }
    } catch (error) {
      logger.error("Failed to continue import video:", error);
      const errorMsg = getFriendlyImportErrorMessage(error, "копирования видео и инициализации проекта", originalVideoPath);
      alert(errorMsg);
    }
  };

  const handleMkvConfirm = async (audioIndex: number, subIndex?: number) => {
    if (!mkvImportData || !window.electronAPI) return;
    const { videoPath, videoName, mediaInfo } = mkvImportData;
    setMkvImportData(null);
    
    let duration = 0;
    if (mediaInfo.format && mediaInfo.format.duration) {
      const parsed = parseFloat(mediaInfo.format.duration);
      if (Number.isFinite(parsed) && !Number.isNaN(parsed) && parsed > 0) {
        duration = parsed;
      }
    }
    
    if (setIsExporting) setIsExporting(true);
    if (setExportProgress) setExportProgress(0);
    if (setExportOperation) setExportOperation('Decoding MKV to MP4...');

    logger.info(`Extracting MKV: video=${videoPath}, audioIndex=${audioIndex}, subIndex=${subIndex}, duration=${duration}`);
    
    let isWin = videoPath.includes('\\');
    let sep = isWin ? '\\' : '/';
    let dir = videoPath.substring(0, videoPath.lastIndexOf(sep));
    let base = videoName.substring(0, videoName.lastIndexOf('.'));
    let outMp4 = `${dir}${sep}${base}_extracted.mp4`;
    let outSub = subIndex !== undefined ? `${dir}${sep}${base}_extracted.srt` : undefined;

    logger.info(`Extract output paths generated: outMp4=${outMp4}, outSub=${outSub}`);

    try {
        const res = await window.electronAPI.extractMkvAssets({
            inputPath: videoPath,
            videoOutput: outMp4,
            subOutput: outSub,
            audioIndex,
            subIndex,
            duration: duration > 0 ? duration : undefined
        });

        logger.info(`extractMkvAssets response: success=${res.success}`, res);

        if (setIsExporting) setIsExporting(false);

        if (res.success) {
           logger.info(`MKV extraction successful, continuing import with: outMp4=${outMp4}, outSub=${outSub}`);
           await continueImportVideo(outMp4, `${base}_extracted.mp4`, outSub);
        } else {
           logger.error('Failed to extract MKV', res.error);
           alert(`Ошибка декодирования MKV: ${res.error}`);
        }
    } catch (e) {
        if (setIsExporting) setIsExporting(false);
        logger.error('MKV extraction exception', e);
        alert(`Ошибка декодирования MKV: ${e}`);
    }
  };

  const handleMkvCancel = () => {
    setMkvImportData(null);
  };

  return { handleSelectVideo, mkvImportData, handleMkvConfirm, handleMkvCancel };
};
