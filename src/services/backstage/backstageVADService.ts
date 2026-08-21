/**
 * Backstage VAD (Voice Activity Detection) Service
 * Analyzes audio levels in real time to categorize timeline activity into speech and silence,
 * and detects hardware audio lockouts (e.g. ASIO exclusive access).
 */

export interface VADConfig {
  fftSize?: number;
  checkIntervalMs?: number;
  speechThreshold?: number;
  speechMinDurationSec?: number;
  silenceMinDurationSec?: number;
  maxConsecutiveZeroRms?: number;
}

export interface VADCallbacks {
  onSpeechStart: (timeSec: number) => void;
  onSpeechEnd: (timeSec: number) => void;
  onZeroSignal: () => void;
}

export class BackstageVADAnalyzer {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private intervalId: number | null = null;

  private isHearingVoice: boolean = false;
  private voiceStartSec: number = 0;
  private isSpeakingBlockActive: boolean = false;
  private silenceStartSec: number | null = null;
  private consecutiveZeroRmsCount: number = 0;
  private isInDub: boolean = false;

  private config: Required<VADConfig>;
  private callbacks: VADCallbacks;
  private getElapsedTimeSec: () => number;

  constructor(
    getElapsedTimeSec: () => number,
    callbacks: VADCallbacks,
    config?: VADConfig
  ) {
    this.getElapsedTimeSec = getElapsedTimeSec;
    this.callbacks = callbacks;
    this.config = {
      fftSize: config?.fftSize ?? 512,
      checkIntervalMs: config?.checkIntervalMs ?? 100,
      speechThreshold: config?.speechThreshold ?? 0.015,
      speechMinDurationSec: config?.speechMinDurationSec ?? 1.0,
      silenceMinDurationSec: config?.silenceMinDurationSec ?? 0.8,
      maxConsecutiveZeroRms: config?.maxConsecutiveZeroRms ?? 30 // 3 seconds at 100ms
    };
  }

  public setInDub(inDub: boolean): void {
    this.isInDub = inDub;
    if (inDub) {
      this.isHearingVoice = false;
      this.isSpeakingBlockActive = false;
      this.silenceStartSec = null;
    }
  }

  public start(stream: MediaStream): boolean {
    this.stop();

    if (stream.getAudioTracks().length === 0) {
      return false;
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
      this.source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.config.fftSize;
      this.source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Float32Array(bufferLength);

      this.consecutiveZeroRmsCount = 0;
      this.isHearingVoice = false;
      this.isSpeakingBlockActive = false;
      this.silenceStartSec = null;

      this.intervalId = window.setInterval(() => {
        if (!this.analyser || this.isInDub) {
          this.consecutiveZeroRmsCount = 0;
          return;
        }

        this.analyser.getFloatTimeDomainData(dataArray);

        let sumSquares = 0;
        for (let i = 0; i < bufferLength; i++) {
          sumSquares += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sumSquares / bufferLength);

        // Zero-signal detector (e.g. ASIO exclusive lock)
        if (rms === 0) {
          this.consecutiveZeroRmsCount++;
          if (this.consecutiveZeroRmsCount >= this.config.maxConsecutiveZeroRms) {
            console.warn('[BackstageVAD] Zero RMS detected for sustained period (possible exclusive audio lock).');
            this.callbacks.onZeroSignal();
            return;
          }
        } else {
          this.consecutiveZeroRmsCount = 0;
        }

        const nowSec = this.getElapsedTimeSec();

        // Speech vs Silence state evaluation
        if (rms > this.config.speechThreshold) {
          this.silenceStartSec = null;
          if (!this.isHearingVoice) {
            this.isHearingVoice = true;
            this.voiceStartSec = nowSec;
          } else if (!this.isSpeakingBlockActive) {
            if (nowSec - this.voiceStartSec > this.config.speechMinDurationSec) {
              this.isSpeakingBlockActive = true;
              this.callbacks.onSpeechStart(this.voiceStartSec);
            }
          }
        } else {
          if (this.isHearingVoice) {
            if (this.silenceStartSec === null) {
              this.silenceStartSec = nowSec;
            } else if (nowSec - this.silenceStartSec > this.config.silenceMinDurationSec) {
              if (this.isSpeakingBlockActive) {
                this.callbacks.onSpeechEnd(this.silenceStartSec);
                this.isSpeakingBlockActive = false;
              }
              this.isHearingVoice = false;
              this.silenceStartSec = null;
            }
          }
        }
      }, this.config.checkIntervalMs);

      return true;
    } catch (err) {
      console.error('[BackstageVAD] Failed to initialize AudioContext analyzer:', err);
      this.stop();
      return false;
    }
  }

  public stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.audioContext) {
      if (this.audioContext.state !== 'closed') {
        this.audioContext.close().catch(console.error);
      }
      this.audioContext = null;
    }

    this.isHearingVoice = false;
    this.isSpeakingBlockActive = false;
    this.silenceStartSec = null;
  }
}
