import { Project, AudioTrack, AudioSegment } from '../types';
import { getSafeFileUrl } from './utils';
import { logger } from './logger';

export interface PendingTakeData {
  segmentId: string;
  role: string;
  startTime: number;
  audioData: Uint8Array;
  peaks: number[];
  duration?: number;
}

/**
 * Sanitizes a project or file name so it can safely be used as a Windows/macOS/Linux folder name.
 */
export function sanitizeFolderName(rawName: string): string {
  const cleaned = (rawName || 'DubStudio_Project')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\.+$/g, '')
    .trim();
  return cleaned || 'DubStudio_Project';
}

/**
 * Builds a `<ChosenDir>/<SanitizedProjectName>_Project` path unless `chosenDir` already ends with `_Project`.
 */
export function buildProjectFolderPath(chosenDir: string, projectName?: string): string {
  const normalizedParent = chosenDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const baseName = sanitizeFolderName((projectName || 'DubStudio').replace(/_Project$/i, ''));
  const folderName = `${baseName}_Project`;

  if (normalizedParent.toLowerCase().endsWith(`/${folderName.toLowerCase()}`) || normalizedParent.toLowerCase().endsWith('_project')) {
    return normalizedParent;
  }
  return `${normalizedParent}/${folderName}`;
}

/**
 * Decodes an audio Blob in the browser, computes RMS waveform peaks,
 * and encodes a standard 16-bit PCM RIFF WAVE Uint8Array so the Rust backend
 * can write it directly to disk without needing to spawn FFmpeg.
 */
export async function encodeAudioBlobToWavAndPeaks(
  blob: Blob,
  numPeaks: number = 1024
): Promise<{ wavBytes: Uint8Array; peaks: number[]; duration: number }> {
  const rawBuffer = await blob.arrayBuffer();

  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx({ sampleRate: 48000 });
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await ctx.decodeAudioData(rawBuffer.slice(0));
    } finally {
      ctx.close().catch(() => {});
    }

    const sampleRate = audioBuffer.sampleRate || 48000;
    const length = audioBuffer.length;
    const duration = audioBuffer.duration || length / sampleRate;

    // Mix down to mono Float32Array
    const mono = new Float32Array(length);
    const channels = audioBuffer.numberOfChannels;
    if (channels === 1) {
      mono.set(audioBuffer.getChannelData(0));
    } else {
      for (let ch = 0; ch < channels; ch++) {
        const chData = audioBuffer.getChannelData(ch);
        for (let i = 0; i < length; i++) {
          mono[i] += chData[i] / channels;
        }
      }
    }

    // Compute RMS peaks
    const totalPoints = Math.max(64, numPeaks);
    const samplesPerPeak = Math.max(1, Math.floor(length / totalPoints));
    const peaks: number[] = [];
    for (let i = 0; i < totalPoints; i++) {
      const start = i * samplesPerPeak;
      if (start >= length) break;
      const end = Math.min(start + samplesPerPeak, length);
      let sumSq = 0;
      for (let j = start; j < end; j++) {
        const s = mono[j];
        sumSq += s * s;
      }
      const rms = Math.sqrt(sumSq / (end - start));
      peaks.push(Math.min(1.0, rms * 2.5));
    }

    // Encode mono Float32Array to 16-bit PCM RIFF WAVE
    const dataByteLength = length * 2;
    const wavBuffer = new ArrayBuffer(44 + dataByteLength);
    const view = new DataView(wavBuffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataByteLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true);  // PCM format = 1
    view.setUint16(22, 1, true);  // Mono = 1 channel
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // Byte rate
    view.setUint16(32, 2, true);  // Block align
    view.setUint16(34, 16, true); // Bits per sample
    writeString(36, 'data');
    view.setUint32(40, dataByteLength, true);

    let offset = 44;
    for (let i = 0; i < length; i++) {
      const clamped = Math.max(-1, Math.min(1, mono[i]));
      const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
      view.setInt16(offset, int16, true);
      offset += 2;
    }

    return {
      wavBytes: new Uint8Array(wavBuffer),
      peaks,
      duration
    };
  } catch (err) {
    logger.warn('Fallback: decodeAudioData failed when encoding WAV, using raw bytes', err);
    const fallbackPeaks = Array.from({ length: 256 }, () => 0.15);
    return {
      wavBytes: new Uint8Array(rawBuffer),
      peaks: fallbackPeaks,
      duration: Math.max(0.5, blob.size / 48000 / 2)
    };
  }
}

/**
 * Creates a new project folder inside `chosenParentDir`, migrates any existing project files,
 * copies external media into `assets/` and `takes/`, saves any in-memory recorded takes to disk,
 * and writes the `.dub` project file.
 */
export async function relocateProjectToChosenFolder(options: {
  project: Project;
  chosenParentDir: string;
  pendingTake?: PendingTakeData | null;
  onStatus?: (message: string) => void;
}): Promise<{
  success: boolean;
  newProjectRoot?: string;
  updatedProject?: Project;
  error?: string;
}> {
  const { project, chosenParentDir, pendingTake, onStatus } = options;

  if (!window.electronAPI) {
    return { success: false, error: 'Файловая система недоступна' };
  }

  try {
    const newProjectRoot = buildProjectFolderPath(chosenParentDir, project.name);
    const oldPath = project.projectPath ? project.projectPath.replace(/\\/g, '/').replace(/\/+$/, '') : '';

    onStatus?.('Создание структуры папки проекта...');
    const initRes = await window.electronAPI.initProject(newProjectRoot);
    if (!initRes.success) {
      return {
        success: false,
        error: initRes.error || `Не удалось создать папку проекта: ${newProjectRoot}`
      };
    }

    // 1. If there was a previous valid projectPath, move/copy existing files over
    if (oldPath && oldPath !== '/mock/path' && oldPath.toLowerCase() !== newProjectRoot.toLowerCase()) {
      onStatus?.('Перенос существующих файлов проекта...');
      try {
        await window.electronAPI.moveProject(oldPath, newProjectRoot);
      } catch (moveErr) {
        logger.warn('Non-fatal warning during moveProject (old folder might not exist):', moveErr);
      }
    }

    const assetsDir = `${newProjectRoot}/assets`.replace(/\\/g, '/');
    const takesDir = `${newProjectRoot}/takes`.replace(/\\/g, '/');

    // Helper to rewrite paths that were inside oldPath
    const rewritePathIfFromOld = (p?: string): string | undefined => {
      if (!p) return p;
      const norm = p.replace(/\\/g, '/');
      if (oldPath && oldPath !== '/mock/path' && norm.startsWith(oldPath + '/')) {
        return `${newProjectRoot}/${norm.substring(oldPath.length + 1)}`;
      }
      return norm;
    };

    // 2. Ensure main video file is inside newProjectRoot/assets if possible
    let updatedVideoPath = rewritePathIfFromOld(project.videoPath);
    let updatedVideoUrl = project.videoUrl;

    if (
      project.videoPath &&
      !project.videoPath.startsWith('blob:') &&
      !project.videoPath.startsWith('http')
    ) {
      const normVideo = project.videoPath.replace(/\\/g, '/');
      if (!normVideo.toLowerCase().startsWith(newProjectRoot.toLowerCase() + '/')) {
        onStatus?.('Копирование медиафайла в папку проекта...');
        const copyRes = await window.electronAPI.copyFileToProject(project.videoPath, assetsDir);
        if (copyRes.success && copyRes.data) {
          updatedVideoPath = copyRes.data.replace(/\\/g, '/');
          updatedVideoUrl = getSafeFileUrl(updatedVideoPath);
        }
      } else {
        updatedVideoUrl = getSafeFileUrl(updatedVideoPath || normVideo);
      }
    }

    // 3. Ensure reference audio is inside newProjectRoot/takes if possible
    let updatedRefAudioPath = rewritePathIfFromOld(project.referenceAudioPath);
    if (
      project.referenceAudioPath &&
      !project.referenceAudioPath.startsWith('blob:') &&
      !project.referenceAudioPath.startsWith('http')
    ) {
      const normRef = project.referenceAudioPath.replace(/\\/g, '/');
      if (!normRef.toLowerCase().startsWith(newProjectRoot.toLowerCase() + '/')) {
        const copyRef = await window.electronAPI.copyFileToProject(project.referenceAudioPath, takesDir);
        if (copyRef.success && copyRef.data) {
          updatedRefAudioPath = copyRef.data.replace(/\\/g, '/');
        }
      }
    }

    // 4. Process tracks & segments: rewrite paths and save any in-memory takes to disk
    onStatus?.('Сохранение записанных дублей на диск...');
    let pendingTakeSaved = false;
    let savedPendingFilePath: string | undefined;
    let savedPendingPeaks: number[] | undefined;

    const updatedTracks: AudioTrack[] = [];
    for (const track of project.tracks || []) {
      const newSegments: AudioSegment[] = [];
      for (const seg of track.segments || []) {
        let segFilePath = rewritePathIfFromOld(seg.filePath);
        let segBlobUrl = seg.blobUrl;
        let segWaveform = seg.waveform;

        const isPendingTarget = pendingTake && seg.id === pendingTake.segmentId;

        if (isPendingTarget && pendingTake) {
          const saveRes = await window.electronAPI.saveTake({
            projectPath: newProjectRoot,
            role: pendingTake.role || project.selectedRole || 'unknown',
            startTime: pendingTake.startTime,
            audioData: pendingTake.audioData
          });
          if (saveRes.success && saveRes.data) {
            segFilePath = saveRes.data.filePath;
            savedPendingFilePath = saveRes.data.filePath;
            const backendPeaks = Array.from(saveRes.data.peaks || []);
            segWaveform = backendPeaks.length > 0 ? backendPeaks : (pendingTake.peaks || segWaveform);
            savedPendingPeaks = segWaveform;
            pendingTakeSaved = true;
          } else {
            return {
              success: false,
              error: saveRes.error || 'Не удалось сохранить записанную реплику в выбранную папку'
            };
          }
        } else if (!segFilePath && segBlobUrl && segBlobUrl.startsWith('blob:')) {
          // Segment only exists in memory as a blob URL -> persist it to disk in the new project folder
          try {
            const resp = await fetch(segBlobUrl);
            const blob = await resp.blob();
            const { wavBytes, peaks } = await encodeAudioBlobToWavAndPeaks(blob);
            const saveRes = await window.electronAPI.saveTake({
              projectPath: newProjectRoot,
              role: project.selectedRole || track.name || 'dub',
              startTime: seg.startTime,
              audioData: wavBytes
            });
            if (saveRes.success && saveRes.data) {
              segFilePath = saveRes.data.filePath;
              const backendPeaks = Array.from(saveRes.data.peaks || []);
              if (!segWaveform || segWaveform.length === 0) {
                segWaveform = backendPeaks.length > 0 ? backendPeaks : peaks;
              }
            }
          } catch (blobErr) {
            logger.warn(`Could not persist in-memory segment ${seg.id}:`, blobErr);
          }
        } else if (segFilePath && !segFilePath.startsWith('blob:') && !segFilePath.startsWith('http')) {
          if (!segBlobUrl || !segBlobUrl.startsWith('blob:')) {
            segBlobUrl = getSafeFileUrl(segFilePath);
          }
        }

        newSegments.push({
          ...seg,
          filePath: segFilePath,
          blobUrl: segBlobUrl,
          waveform: segWaveform
        });
      }

      updatedTracks.push({
        ...track,
        segments: newSegments
      });
    }

    // 5. If pendingTake was not yet in project.tracks, save it now and insert it onto the armed/dub track
    if (pendingTake && !pendingTakeSaved) {
      const saveRes = await window.electronAPI.saveTake({
        projectPath: newProjectRoot,
        role: pendingTake.role || project.selectedRole || 'unknown',
        startTime: pendingTake.startTime,
        audioData: pendingTake.audioData
      });
      if (!saveRes.success || !saveRes.data) {
        return {
          success: false,
          error: saveRes.error || 'Не удалось сохранить запись в выбранную папку'
        };
      }
      savedPendingFilePath = saveRes.data.filePath;
      const backendPeaks = Array.from(saveRes.data.peaks || []);
      savedPendingPeaks = backendPeaks.length > 0 ? backendPeaks : pendingTake.peaks;

      const offsetSec = (project.audioOffsetMs || 0) / 1000;
      const dur = pendingTake.duration || 3;
      const newSeg: AudioSegment = {
        id: pendingTake.segmentId,
        startTime: Math.max(0, pendingTake.startTime - offsetSec),
        duration: dur,
        fileOffset: 0,
        fileDuration: dur,
        blobUrl: getSafeFileUrl(savedPendingFilePath),
        filePath: savedPendingFilePath,
        waveform: savedPendingPeaks,
        gain: 1,
        playbackRate: 1
      };

      let targetTrackId = updatedTracks.find(t => t.isArmed)?.id
        || updatedTracks.find(t => ['Dubs', 'Озвучка', 'Takes', 'Дубли'].includes(t.name))?.id
        || updatedTracks.find(t => t.name !== 'Оригинал')?.id
        || updatedTracks[updatedTracks.length - 1]?.id;

      if (targetTrackId) {
        for (let i = 0; i < updatedTracks.length; i++) {
          if (updatedTracks[i].id === targetTrackId) {
            updatedTracks[i] = {
              ...updatedTracks[i],
              segments: [...updatedTracks[i].segments, newSeg]
            };
            break;
          }
        }
      }
    }

    const updatedProject: Project = {
      ...project,
      projectPath: newProjectRoot,
      videoPath: updatedVideoPath,
      videoUrl: updatedVideoUrl,
      referenceAudioPath: updatedRefAudioPath,
      tracks: updatedTracks
    };

    // 6. Save .dub project file to the new folder
    onStatus?.('Сохранение файла проекта (.dub)...');
    const projectToSave = JSON.parse(JSON.stringify(updatedProject));
    delete projectToSave.audioSettings;
    await window.electronAPI.saveProjectJson({
      projectPath: newProjectRoot,
      projectData: projectToSave
    });

    return {
      success: true,
      newProjectRoot,
      updatedProject
    };
  } catch (err: any) {
    logger.error('Error in relocateProjectToChosenFolder:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
