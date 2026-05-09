import { AudioSettings } from '../types';

export class AudioProcessor {
  private context: AudioContext;
  private source: MediaStreamAudioSourceNode | null = null;
  private monoMixer: GainNode;
  private highPass: BiquadFilterNode;
  private compressor: DynamicsCompressorNode;
  private gateGain: GainNode;
  private analyser: AnalyserNode;
  private destination: MediaStreamAudioDestinationNode;
  
  private settings: AudioSettings;
  private animationFrameId: number | null = null;
  private currentPeak: number = 0;

  constructor(context: AudioContext, settings: AudioSettings) {
    this.context = context;
    this.settings = settings;

    // Downmix to mono to fix audio interfaces where mic is on one channel
    this.monoMixer = context.createGain();
    this.monoMixer.channelCount = 1;
    this.monoMixer.channelCountMode = 'explicit';
    this.monoMixer.channelInterpretation = 'speakers';
    // Use 1.0 gain by default. If it's a stereo-to-mono downmix, 
    // the sum might exceed 1.0, but 2.0 was definitely too much.
    this.monoMixer.gain.value = 1.0;

    this.highPass = context.createBiquadFilter();
    this.highPass.type = 'highpass';
    
    this.compressor = context.createDynamicsCompressor();
    
    this.gateGain = context.createGain();
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    
    this.destination = context.createMediaStreamDestination();
    this.destination.channelCount = 2;
    this.destination.channelCountMode = 'explicit';
    this.destination.channelInterpretation = 'speakers';

    this.updateSettings(settings);
  }

  public updateSettings(settings: AudioSettings) {
    this.settings = settings;
    
    // High Pass Filter
    const hpfFreq = settings.highPassFrequency ?? 80;
    this.highPass.frequency.setTargetAtTime(hpfFreq, this.context.currentTime, 0.1);
    
    // Compressor
    const compThreshold = settings.compressorThreshold ?? -24;
    const compRatio = settings.compressorRatio ?? 4;
    this.compressor.threshold.setTargetAtTime(compThreshold, this.context.currentTime, 0.1);
    this.compressor.ratio.setTargetAtTime(compRatio, this.context.currentTime, 0.1);
    this.compressor.attack.setTargetAtTime(0.003, this.context.currentTime, 0.1);
    this.compressor.release.setTargetAtTime(0.25, this.context.currentTime, 0.1);
    
    // Start gate monitoring
    if (this.animationFrameId === null) {
      this.monitorGate();
    }
  }

  private monitorGate() {
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const check = () => {
      this.analyser.getByteTimeDomainData(dataArray);
      
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const val = (dataArray[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / bufferLength);
      this.currentPeak = rms;
      const db = 20 * Math.log10(rms || 0.00001);
      
      // Simple gate logic with smoothing
      const threshold = this.settings.noiseGateThreshold ?? -60;
      const targetGain = db > threshold ? 1 : 0;
      
      this.gateGain.gain.setTargetAtTime(targetGain, this.context.currentTime, 0.05);
      
      this.animationFrameId = requestAnimationFrame(check);
    };
    
    this.animationFrameId = requestAnimationFrame(check);
  }

  public getPeak(): number {
    return this.currentPeak;
  }

  public connectStream(stream: MediaStream) {
    this.source = this.context.createMediaStreamSource(stream);
    
    // Chain: Source -> MonoMixer -> HPF -> Gate -> Compressor -> Destination
    // Also connect MonoMixer to Analyser for gate detection
    this.source.connect(this.monoMixer);
    this.monoMixer.connect(this.highPass);
    this.monoMixer.connect(this.analyser);
    
    this.highPass.connect(this.gateGain);
    this.gateGain.connect(this.compressor);
    this.compressor.connect(this.destination);
  }

  public getDestinationStream(): MediaStream {
    return this.destination.stream;
  }

  public disconnect() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    this.monoMixer.disconnect();
    this.highPass.disconnect();
    this.gateGain.disconnect();
    this.compressor.disconnect();
    this.analyser.disconnect();
  }
}
