/**
 * Backstage Recorder Service
 * Encapsulates MediaRecorder lifecycle, codec negotiation, and chunk streaming to the Electron bridge.
 */

export interface RecorderOptions {
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
  chunkIntervalMs?: number;
}

export class BackstageRecorderService {
  private mediaRecorder: MediaRecorder | null = null;
  private projectPath: string;
  private sessionId: string;
  private options: Required<RecorderOptions>;

  constructor(
    projectPath: string,
    sessionId: string,
    options?: RecorderOptions
  ) {
    this.projectPath = projectPath;
    this.sessionId = sessionId;
    this.options = {
      videoBitsPerSecond: options?.videoBitsPerSecond ?? 5000000,
      audioBitsPerSecond: options?.audioBitsPerSecond ?? 128000,
      chunkIntervalMs: options?.chunkIntervalMs ?? 2000
    };
  }

  public static getSupportedMimeType(hasAudio: boolean): string {
    const candidates = hasAudio
      ? [
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm;codecs=h264,opus',
          'video/webm'
        ]
      : [
          'video/webm;codecs=vp9',
          'video/webm;codecs=vp8',
          'video/webm'
        ];

    for (const type of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return 'video/webm';
  }

  public start(stream: MediaStream): boolean {
    this.stop();

    try {
      const hasAudio = stream.getAudioTracks().length > 0;
      const mimeType = BackstageRecorderService.getSupportedMimeType(hasAudio);

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: this.options.videoBitsPerSecond,
        ...(hasAudio && { audioBitsPerSecond: this.options.audioBitsPerSecond })
      });

      recorder.ondataavailable = async (e: BlobEvent) => {
        if (e.data && e.data.size > 0 && window.electronAPI) {
          try {
            const buffer = await e.data.arrayBuffer();
            await window.electronAPI.appendBackstageChunk({
              projectPath: this.projectPath,
              sessionId: this.sessionId,
              chunkData: new Uint8Array(buffer)
            });
          } catch (chunkErr) {
            console.error('[BackstageRecorder] Error writing chunk:', chunkErr);
          }
        }
      };

      recorder.onerror = (err) => {
        console.error('[BackstageRecorder] MediaRecorder error:', err);
      };

      this.mediaRecorder = recorder;
      recorder.start(this.options.chunkIntervalMs);
      return true;
    } catch (err) {
      console.error('[BackstageRecorder] Failed to start MediaRecorder:', err);
      this.mediaRecorder = null;
      return false;
    }
  }

  public async stop(): Promise<void> {
    if (!this.mediaRecorder) return;

    return new Promise((resolve) => {
      const recorder = this.mediaRecorder;
      if (!recorder) {
        resolve();
        return;
      }

      if (recorder.state === 'inactive') {
        this.mediaRecorder = null;
        resolve();
        return;
      }

      recorder.onstop = () => {
        this.mediaRecorder = null;
        resolve();
      };

      try {
        recorder.stop();
      } catch (err) {
        console.warn('[BackstageRecorder] Exception while stopping recorder:', err);
        this.mediaRecorder = null;
        resolve();
      }
    });
  }

  public abort(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.onstop = null;
        this.mediaRecorder.stop();
      } catch (e) {
        // ignore abort errors
      }
    }
    this.mediaRecorder = null;
  }

  public get isRecording(): boolean {
    return this.mediaRecorder !== null && this.mediaRecorder.state === 'recording';
  }
}
