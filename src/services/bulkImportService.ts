import { Project, AudioTrack, AudioSegment, SubtitleLine } from '../types';

export class BulkImportService {
  static async importFolder(folderPath: string): Promise<{ tracks: AudioTrack[], duration: number, subtitles: SubtitleLine[] }> {
    if (!window.electronAPI) throw new Error("Electron API not available");

    const filesRes = await window.electronAPI.getAudioFiles(folderPath);
    if (!filesRes.success || !filesRes.data) {
      throw new Error("Failed to read audio files from directory");
    }
    const files = filesRes.data;
    
    const originalTrack: AudioTrack = {
      id: 'original-track-' + Math.random().toString(36).substr(2, 9),
      name: 'Оригинал',
      segments: [],
      volume: 1,
      isMuted: false
    };

    const dubTrack: AudioTrack = {
      id: 'dub-track-' + Math.random().toString(36).substr(2, 9),
      name: 'Dubs',
      segments: [],
      volume: 1,
      isMuted: false
    };

    const subtitles: SubtitleLine[] = [];
    let currentTime = 0;
    const gap = 1.0; // 1 second gap between segments

    files.forEach(file => {
      const segmentId = Math.random().toString(36).substr(2, 9);
      const normalizedPath = file.path.replace(/\\/g, '/');
      const safeUrl = /^[a-zA-Z]:/.test(normalizedPath) ? `safe-file:///${normalizedPath}` : `safe-file://${normalizedPath}`;

      const segment: AudioSegment = {
        id: segmentId,
        startTime: currentTime,
        duration: file.duration,
        fileOffset: 0,
        fileDuration: file.duration,
        blobUrl: safeUrl,
        filePath: file.path,
        waveform: file.peaks,
        gain: 1,
        playbackRate: 1,
        originalFileName: file.name
      };

      originalTrack.segments.push(segment);

      subtitles.push({
        id: 'sub-' + segmentId,
        start: currentTime,
        end: currentTime + file.duration,
        text: file.name, // Use filename as text
        role: 'Original'
      });

      currentTime += file.duration + gap;
    });

    return {
      tracks: [originalTrack, dubTrack],
      duration: currentTime,
      subtitles
    };
  }
}
