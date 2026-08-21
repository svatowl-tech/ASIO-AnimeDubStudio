import { Project } from '../types';
import { getSafeFileUrl } from '../lib/utils';
import { logger } from '../lib/logger';

export interface VideoProxyProgressData {
  percent: number;
  time: string;
  operation: string;
}

export interface PrepareProxyOptions {
  videoPath: string;
  projectPath: string;
  duration?: number;
  onProgress?: (data: VideoProxyProgressData) => void;
}

export interface PrepareProxyResult {
  success: boolean;
  proxyPath?: string;
  error?: string;
}

/**
 * Checks if the video file extension or codec suggests proxy conversion is needed
 */
export function isLikelyUnsupportedVideo(videoPath: string): boolean {
  if (!videoPath) return false;
  const lower = videoPath.toLowerCase();
  return /\.(mkv|avi|mov|wmv|flv|ts|m2ts|vob|webm|ogv|hevc|h265|265|m4v)$/i.test(lower);
}

/**
 * Executes FFmpeg proxy conversion with live progress callback
 */
export async function prepareVideoProxy(options: PrepareProxyOptions): Promise<PrepareProxyResult> {
  const { videoPath, projectPath, duration, onProgress } = options;
  if (!window.electronAPI) {
    return { success: false, error: 'Desktop bridge unavailable' };
  }

  logger.info(`Starting video proxy preparation for: ${videoPath}`);
  
  let unlistenProgress: (() => void) | null = null;
  if (onProgress && window.electronAPI.onMediaProgress) {
    unlistenProgress = window.electronAPI.onMediaProgress((data) => {
      onProgress({
        percent: data.percent ?? 0,
        time: data.time ?? '',
        operation: data.operation || 'Подготовка видео'
      });
    });
  }

  try {
    const res = await window.electronAPI.createProxyVideo(videoPath, projectPath, duration);
    if (unlistenProgress) {
      unlistenProgress();
      unlistenProgress = null;
    }

    if (res.success && res.data && res.data !== 'Generating') {
      logger.info(`Proxy video created successfully: ${res.data}`);
      return { success: true, proxyPath: res.data };
    } else if (res.success && res.data) {
      // Return the expected proxy path
      const rawFileName = videoPath.split(/[/\\]/).pop() || 'video';
      const baseName = rawFileName.replace(/\.[^/.]+$/, "");
      const proxyPath = `${projectPath}/proxies/proxy_${baseName}.mp4`.replace(/\\/g, '/');
      return { success: true, proxyPath };
    } else {
      logger.error('createProxyVideo failed:', res.error);
      return { success: false, error: res.error || 'Не удалось сконвертировать видео' };
    }
  } catch (err: any) {
    if (unlistenProgress) {
      unlistenProgress();
      unlistenProgress = null;
    }
    logger.error('Exception in prepareVideoProxy:', err);
    return { success: false, error: String(err?.message || err) };
  }
}

/**
 * Updates a project state with the newly created proxy video and ensures audio peaks are synced
 */
export async function syncProxyVideoWithProject(
  currentProject: Project,
  proxyPath: string
): Promise<Project> {
  const safeUrl = getSafeFileUrl(proxyPath) || proxyPath;
  let updatedProject: Project = {
    ...currentProject,
    videoPath: proxyPath,
    videoUrl: safeUrl
  };

  // If reference audio or peaks are missing, extract them from the new proxy
  if (window.electronAPI && (!currentProject.referenceAudioPath || !currentProject.originalPeaks)) {
    try {
      const audioDataRes = await window.electronAPI.extractAudioPeaks(proxyPath, currentProject.projectPath || '');
      if (audioDataRes.success && audioDataRes.data) {
        const audioData = audioDataRes.data;
        const refSafeUrl = getSafeFileUrl(audioData.filePath);
        
        const peaksArray = Array.from(audioData.peaks);
        updatedProject = {
          ...updatedProject,
          originalPeaks: peaksArray,
          referenceAudioPath: audioData.filePath,
          tracks: updatedProject.tracks.map(t => {
            if (t.id === '1' && (t.segments || []).some(s => s.id === 'original-audio-seg')) {
              return {
                ...t,
                segments: t.segments.map(s => s.id === 'original-audio-seg' ? {
                  ...s,
                  filePath: audioData.filePath,
                  blobUrl: refSafeUrl,
                  peaks: peaksArray,
                  duration: audioData.duration,
                  fileDuration: audioData.duration
                } : s)
              };
            }
            return t;
          })
        };
      }
    } catch (e) {
      logger.warn('Failed to auto-extract audio peaks for proxy video:', e);
    }
  }

  return updatedProject;
}
