import { getSafeFileUrl } from '../lib/utils';
import { logger } from '../lib/logger';

export async function ensureBlankVideoForProject(
  projectPath: string,
  durationInSeconds: number = 60
): Promise<{ videoPath: string; videoUrl: string }> {
  const safeDuration = Math.max(5, Math.ceil(durationInSeconds || 60));
  const isWin = projectPath.includes('\\');
  const sep = isWin ? '\\' : '/';
  
  const cleanProjectPath = projectPath.replace(/\\/g, '/');
  const assetsDir = `${cleanProjectPath}/assets`;
  const blankVideoPath = `${assetsDir}/blank_master_video.mp4`;

  logger.info(`ensureBlankVideoForProject: Creating blank video at ${blankVideoPath} (duration: ${safeDuration}s)`);

  if (window.electronAPI && typeof window.electronAPI.createBlankVideo === 'function') {
    try {
      // Ensure assets dir initialized
      if (typeof window.electronAPI.initProject === 'function') {
        await window.electronAPI.initProject(cleanProjectPath);
      }
      const res = await window.electronAPI.createBlankVideo(safeDuration, blankVideoPath);
      if (res.success && res.data) {
        logger.info(`ensureBlankVideoForProject: Successfully created blank video: ${res.data}`);
        return {
          videoPath: res.data,
          videoUrl: getSafeFileUrl(res.data)
        };
      }
    } catch (err) {
      logger.warn('Failed to create blank video via electronAPI:', err);
    }
  }

  // Fallback return
  return {
    videoPath: blankVideoPath,
    videoUrl: getSafeFileUrl(blankVideoPath)
  };
}
