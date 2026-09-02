import { getSafeFileUrl, getFriendlyFileLoadErrorMessage, getTrackLinearVolume, getSegmentLinearGain } from '../lib/utils';

const getSegmentUrl = (seg: any): string | null => {
  if (!seg) return null;
  if ((seg as any).url) return (seg as any).url;
  if (seg.filePath) {
    const safeUrl = getSafeFileUrl(seg.filePath);
    if (safeUrl) return safeUrl;
  }
  return seg.blobUrl || null;
};

export class PlaybackEngine {
  private audioContext: AudioContext | null = null;
  private sources: Map<string, AudioBufferSourceNode> = new Map();
  private gainNodes: Map<string, GainNode> = new Map();
  private bufferCache: Map<string, AudioBuffer> = new Map();
  private pendingBuffers: Map<string, Promise<AudioBuffer | null>> = new Map();
  private isPlaying = false;
  private currentSessionId = 0;
  private startVideoTime = 0;
  private scheduledSegments: Set<string> = new Set();
  private lookaheadSeconds = 0.3; 
  private videoSource: MediaElementAudioSourceNode | null = null;
  private referenceSource: MediaElementAudioSourceNode | null = null;
  private videoGain: GainNode | null = null;
  private videoDelay: DelayNode | null = null;
  private referenceGain: GainNode | null = null;
  private dubbingGain: GainNode | null = null;
  private dubbingDelay: DelayNode | null = null;
  private boundVideoElement: HTMLMediaElement | null = null;
  private boundReferenceElement: HTMLMediaElement | null = null;
  private audioOffsetMs = 0; 
  private currentTracks: any[] = [];
  private playOriginalTrackSegments = false;
  private playingMetadata: Map<string, {
    videoStartTime: number;
    ctxStartTime: number;
    fileOffset: number;
    basePlaybackRate: number;
    seg: any;
    track: any;
    monoNode?: GainNode;
  }> = new Map();

  constructor() {}

  public async setOutputDevice(deviceId: string) {
    const ctx = this.getContext();
    if (typeof (ctx as any).setSinkId === 'function') {
      try {
        await (ctx as any).setSinkId(deviceId === 'default' ? '' : deviceId);
        console.log(`[PlaybackEngine] Output device set to: ${deviceId}`);
      } catch (e) {
        console.error(`[PlaybackEngine] Failed to set output device:`, e);
      }
    } else {
      console.warn(`[PlaybackEngine] setSinkId not supported in this browser.`);
    }
  }

  public setPlayOriginalTrackSegments(play: boolean) {
    this.playOriginalTrackSegments = play;
    console.log(`[PlaybackEngine] Play original track segments direct set to: ${play}`);
  }

  public setAudioOffset(offsetMs: number) {
    this.audioOffsetMs = offsetMs;
    const ctx = this.getContext();
    
    if (this.dubbingDelay && this.videoDelay) {
      // Dynamic balancing of delays to handle positive/negative offsets
      // Positive offset = Dubs play LATER (delay Dubbing)
      // Negative offset = Video/Reference plays LATER (delay Video)
      
      const dubbingDelaySec = offsetMs > 0 ? offsetMs / 1000 : 0;
      const videoDelaySec = offsetMs < 0 ? Math.abs(offsetMs) / 1000 : 0;
      
      this.dubbingDelay.delayTime.setTargetAtTime(dubbingDelaySec, ctx.currentTime, 0.05);
      this.videoDelay.delayTime.setTargetAtTime(videoDelaySec, ctx.currentTime, 0.05);
      
      console.log(`[PlaybackEngine] Master Sync: Dubbing=${Math.round(dubbingDelaySec*1000)}ms, Original=${Math.round(videoDelaySec*1000)}ms`);
    }
  }

  private getContext(): AudioContext {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx({
        latencyHint: 'interactive',
        sampleRate: 48000,
      });
      
      console.log(`[PlaybackEngine] AudioContext initialized at ${this.audioContext.sampleRate}Hz`);
      // Initialize Dubbing Bus
      this.dubbingGain = this.audioContext.createGain();
      this.dubbingDelay = this.audioContext.createDelay(4.0); // Allow up to 4s compensation
      this.dubbingGain.connect(this.dubbingDelay);
      this.dubbingDelay.connect(this.audioContext.destination);

      // Initialize Original/Video Bus
      this.videoGain = this.audioContext.createGain();
      this.videoDelay = this.audioContext.createDelay(4.0);
      this.videoGain.connect(this.videoDelay);
      this.videoDelay.connect(this.audioContext.destination);

      // Reference track uses its own gain but same delay line as video
      this.referenceGain = this.audioContext.createGain();
      this.referenceGain.gain.value = 0;
      this.referenceGain.connect(this.videoDelay); 
    }
    return this.audioContext;
  }

  public getCurrentTime(): number {
    return this.audioContext ? this.audioContext.currentTime : 0;
  }

  public clearCache() {
    this.bufferCache.clear();
    console.log("[PlaybackEngine] Cache cleared");
  }

  public bindVideoElement(video: HTMLMediaElement) {
    if (this.boundVideoElement === video && this.videoSource) return;
    const ctx = this.getContext();
    console.log("[PlaybackEngine] Binding video element for audio routing...");
    
    try {
      if (this.videoSource && this.boundVideoElement !== video) {
        console.log("[PlaybackEngine] Disconnecting previous video source");
        this.videoSource.disconnect();
      }
      
      const isNewVideo = this.boundVideoElement !== video;
      this.boundVideoElement = video;
      
      if (!this.videoSource || isNewVideo) {
         this.videoSource = ctx.createMediaElementSource(video);
      }
      
      if (!this.videoGain) {
        this.videoGain = ctx.createGain();
        this.videoGain.gain.value = 1.0;
      }

      if (!this.videoDelay) {
        this.videoDelay = ctx.createDelay(4.0);
        this.videoDelay.delayTime.value = this.audioOffsetMs < 0 ? Math.abs(this.audioOffsetMs) / 1000 : 0;
      }
      
      this.videoSource.connect(this.videoGain);
      // Ensure the master bus graph is consistent
      if (this.videoGain.numberOfOutputs === 0) {
         try { this.videoGain.disconnect(); } catch(e){}
         this.videoGain.connect(this.videoDelay);
      }
      
      console.log("[PlaybackEngine] Video element bound to master original bus");
    } catch (e) {
      console.warn("[PlaybackEngine] Failed to bind video element:", e);
    }
  }

  public bindReferenceAudio(audio: HTMLMediaElement) {
    if (this.boundReferenceElement === audio && this.referenceSource) return;
    const ctx = this.getContext();
    console.log("[PlaybackEngine] Binding reference audio for routing...");
    
    try {
      if (this.referenceSource && this.boundReferenceElement !== audio) {
        this.referenceSource.disconnect();
      }
      
      const isNewAudio = this.boundReferenceElement !== audio;
      this.boundReferenceElement = audio;
      
      if (!this.referenceSource || isNewAudio) {
        this.referenceSource = ctx.createMediaElementSource(audio);
      }
      
      if (!this.referenceGain) {
        this.referenceGain = ctx.createGain();
        this.referenceGain.gain.value = 0.0;
      }
      
      this.referenceSource.connect(this.referenceGain);
      
      // Route through videoDelay if available
      if (this.videoDelay) {
         try { this.referenceGain.disconnect(); } catch(e) {}
         this.referenceGain.connect(this.videoDelay);
      } else {
         try { this.referenceGain.disconnect(); } catch(e) {}
         this.referenceGain.connect(ctx.destination);
      }
      
      console.log("[PlaybackEngine] Reference audio bound to original bus");
    } catch (e) {
      console.warn("[PlaybackEngine] Failed to bind reference audio:", e);
    }
  }

  public async loadBuffer(url: string, filePath?: string): Promise<AudioBuffer | null> {
    if (this.bufferCache.has(url)) {
      return this.bufferCache.get(url)!;
    }

    if (this.pendingBuffers.has(url)) {
      return this.pendingBuffers.get(url)!;
    }
    
    if (this.bufferCache.size > 200) {
      console.log("[PlaybackEngine] Cache size exceeded 200, pruning cache to save memory");
      
      const activeUrls = new Set<string>();
      activeUrls.add(url);

      const currentVideoTime = this.boundVideoElement ? this.boundVideoElement.currentTime : 0;
      
      this.playingMetadata.forEach((meta) => {
        const activeUrl = getSegmentUrl(meta.seg);
        if (activeUrl) activeUrls.add(activeUrl);
      });

      this.currentTracks.forEach(track => {
        track.segments.forEach((seg: any) => {
           if (seg.startTime <= currentVideoTime + 5 && seg.startTime + seg.duration >= currentVideoTime) {
               const activeUrl = getSegmentUrl(seg);
               if (activeUrl) activeUrls.add(activeUrl);
           }
        });
      });

      for (const [cacheUrl] of this.bufferCache) {
        if (!activeUrls.has(cacheUrl)) {
          this.bufferCache.delete(cacheUrl);
        }
      }
    }

    const loadPromise = (async () => {
      try {
        const ctx = this.getContext();
        let arrayBuffer: ArrayBuffer;
        
        if (window.electronAPI && filePath) {
            // Using fetch with the safe URL is much more stable than IPC readBinaryFile for large files (30MB+ FLAC/WAV).
            // Tauri converts file paths into asset://localhost/ paths that fetch() can natively handle without JSON serialization overhead.
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            arrayBuffer = await response.arrayBuffer();
        } else {
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            arrayBuffer = await response.arrayBuffer();
        }
        
        let audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        console.log(`[PlaybackEngine] Loaded buffer: ${url}. Segment SR: ${audioBuffer.sampleRate}, Context SR: ${ctx.sampleRate}`);
        
        // Manual resampling if decodeAudioData didn't match (though it usually does)
        if (audioBuffer.sampleRate !== ctx.sampleRate) {
          console.warn(`[PlaybackEngine] Resampling buffer from ${audioBuffer.sampleRate} to ${ctx.sampleRate}`);
          const offlineCtx = new OfflineAudioContext(
            audioBuffer.numberOfChannels,
            Math.max(1, Math.ceil(audioBuffer.duration * ctx.sampleRate)),
            ctx.sampleRate
          );
          const source = offlineCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(offlineCtx.destination);
          source.start(0);
          audioBuffer = await offlineCtx.startRendering();
        }
        
        this.bufferCache.set(url, audioBuffer);
        return audioBuffer;
      } catch (e) {
        const friendlyMsg = getFriendlyFileLoadErrorMessage(e, filePath || url);
        console.error("[PlaybackEngine] Failed to load audio buffer:\n" + friendlyMsg);
        return null;
      } finally {
        this.pendingBuffers.delete(url);
      }
    })();

    this.pendingBuffers.set(url, loadPromise);
    return loadPromise;
  }

  public async play(tracks: any[], currentTime: number) {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    
    this.stop(); 
    this.isPlaying = true;
    this.currentSessionId = Date.now();
    this.startVideoTime = currentTime;
    this.scheduledSegments.clear();
    this.currentTracks = tracks;
    
    // Log context latency for debugging sync issues
    const outputLatency = (ctx as any).outputLatency || 0;
    console.log(`[PlaybackEngine] Starting playback. Context latency: ${Math.round(outputLatency * 1000)}ms`);
    
    this.tick(currentTime, tracks);
  }

  private performSync() {
    if (!this.boundVideoElement || !this.isPlaying || this.boundVideoElement.paused || this.boundVideoElement.error || this.boundVideoElement.readyState < 2) {
      return;
    }
    
    const ctx = this.getContext();
    const videoTime = this.boundVideoElement.currentTime;
    const videoRate = this.boundVideoElement.playbackRate || 1.0;

    this.sources.forEach((source, segId) => {
      const meta = this.playingMetadata.get(segId);
      if (!meta) {
        this.sources.delete(segId);
        return;
      }

      // Cleanup finished segments
      const videoEnd = meta.seg.startTime + meta.seg.duration;
      if (videoTime > videoEnd + 0.1) {
        try { source.stop(); source.disconnect(); } catch(e) {}
        if (meta.monoNode) { try { meta.monoNode.disconnect(); } catch(e) {} }
        this.sources.delete(segId);
        const gain = this.gainNodes.get(segId);
        if (gain) {
          try { gain.disconnect(); } catch(e) {}
          this.gainNodes.delete(segId);
        }
        this.playingMetadata.delete(segId);
        this.scheduledSegments.delete(segId);
        return;
      }

      // Calculate where we SHOULD be in the audio file
      const elapsedVideoTime = videoTime - meta.videoStartTime;
      const intendedAudioPos = meta.fileOffset + (elapsedVideoTime * meta.basePlaybackRate);
      
      // Calculate where the AudioContext thinks we are
      const elapsedCtxTime = ctx.currentTime - meta.ctxStartTime;
      const actualAudioPos = meta.fileOffset + (elapsedCtxTime * source.playbackRate.value);

      const drift = actualAudioPos - intendedAudioPos;
      const driftMs = drift * 1000;

      // Master Sync: Tiered Synchronization Logic
      if (Math.abs(driftMs) > 150) {
        // HARD SYNC: Drift exceeds 150ms. Restart node with precise offset.
        console.log(`[PlaybackEngine] Master Sync (Restarting) for ${segId}: ${Math.round(driftMs)}ms drift`);
        this.restartSegment(meta.track, meta.seg);
      } else if (Math.abs(driftMs) >= 10) {
        // SOFT SYNC: Drift from 10ms to 150ms. Adjust playback rate slightly.
        const correction = driftMs > 0 ? 0.99 : 1.01;
        source.playbackRate.setTargetAtTime(
          meta.basePlaybackRate * videoRate * correction, 
          ctx.currentTime, 
          0.1
        );
      } else {
        // NORMAL: Minimal drift (< 10ms). Return to baseline rate.
        source.playbackRate.setTargetAtTime(
          meta.basePlaybackRate * videoRate, 
          ctx.currentTime, 
          0.1
        );
      }
    });
  }

  private restartSegment(track: any, seg: any) {
    const ctx = this.getContext();
    const source = this.sources.get(seg.id);
    const now = ctx.currentTime;
    
    if (source) {
      const gain = this.gainNodes.get(seg.id);
      const meta = this.playingMetadata.get(seg.id);
      
      // Implement clean stop via Web Audio scheduling to avoid timing desync
      try {
        if (gain) {
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(0, now + 0.005);
        }
        source.stop(now + 0.008);
      } catch (e) {}

      setTimeout(() => {
        try { source.disconnect(); } catch(e) {}
        if (meta?.monoNode) { try { meta.monoNode.disconnect(); } catch(e) {} }
        if (gain) { try { gain.disconnect(); } catch(e) {} }
      }, 30);

      this.sources.delete(seg.id);
      this.gainNodes.delete(seg.id);
      this.playingMetadata.delete(seg.id);
      this.scheduledSegments.delete(seg.id);
    } else {
      this.scheduledSegments.delete(seg.id);
    }
  }

  public async tick(currentVideoTime: number, tracks: any[]) {
    if (!this.isPlaying) return;

    this.performSync();

    const ctx = this.getContext();
    const sessionId = this.currentSessionId;
    const now = ctx.currentTime;
    
    // Use the most up-to-date time from the element if available and playing to reduce latency
    const isVideoActive = this.boundVideoElement && 
      !this.boundVideoElement.paused && 
      !this.boundVideoElement.error && 
      this.boundVideoElement.readyState >= 2;
    const liveVideoTime = isVideoActive ? this.boundVideoElement!.currentTime : currentVideoTime;
    const playbackRate = isVideoActive ? (this.boundVideoElement!.playbackRate || 1.0) : 1.0;
    
    // Cleanup segments that have passed
    this.sources.forEach((source, segId) => {
      const meta = this.playingMetadata.get(segId);
      if (meta && liveVideoTime > meta.seg.startTime + meta.seg.duration + 0.1) {
        try { source.stop(); source.disconnect(); } catch(e) {}
        if (meta.monoNode) { try { meta.monoNode.disconnect(); } catch(e) {} }
        this.sources.delete(segId);
        const gain = this.gainNodes.get(segId);
        if (gain) {
          try { gain.disconnect(); } catch(e) {}
          this.gainNodes.delete(segId);
        }
        this.playingMetadata.delete(segId);
        this.scheduledSegments.delete(segId);
      }
    });

    const lookaheadEnd = liveVideoTime + this.lookaheadSeconds * playbackRate;

    // (Drift correction moved to performSync)

    const anySolo = tracks.some(t => t.isSolo);
    const originalTrack = tracks.find(t => {
      const n = t.name?.toLowerCase() || '';
      return n.includes('оригинал') || n.includes('original');
    });
    const referenceTrack = tracks.find(t => t.id === 'reference-track' || (t.name?.toLowerCase().includes('reference')));

    if (this.videoGain) {
      const isOriginalActive = anySolo 
        ? (originalTrack?.isSolo || false) 
        : !(originalTrack?.isMuted || false);
      const targetVolume = isOriginalActive ? getTrackLinearVolume(originalTrack?.volume) : 0;
      this.videoGain.gain.setTargetAtTime(targetVolume, now, 0.03);
    }

    if (this.referenceGain) {
      const isRefActive = anySolo
        ? (referenceTrack?.isSolo || false)
        : !(referenceTrack?.isMuted || false);
      const targetVolume = isRefActive ? getTrackLinearVolume(referenceTrack?.volume) : 0;
      this.referenceGain.gain.setTargetAtTime(targetVolume, now, 0.03);
    }

    const activeTracks = anySolo 
      ? tracks.filter(t => t.isSolo) 
      : tracks.filter(t => !t.isMuted);

    for (const track of activeTracks) {
      const lowerName = track.name?.toLowerCase() || '';
      const isOriginalOrRef = lowerName.includes('оригинал') || lowerName.includes('original') || track.id === 'reference-track' || lowerName.includes('reference');
      if (isOriginalOrRef && !this.playOriginalTrackSegments) {
        continue;
      }

      for (const seg of track.segments) {
        const segmentEnd = seg.startTime + seg.duration;
        
        if (seg.startTime <= lookaheadEnd && segmentEnd > liveVideoTime && !this.scheduledSegments.has(seg.id)) {
          this.scheduledSegments.add(seg.id);
          
          const urlToLoad = getSegmentUrl(seg);
          if (!urlToLoad) continue;

          this.loadBuffer(urlToLoad, seg.filePath).then(buffer => {
            if (!buffer || !this.isPlaying || sessionId !== this.currentSessionId) return;

            // Make sure segment hasn't been cancelled or removed while buffer was loading
            if (!this.scheduledSegments.has(seg.id)) return;

            // Clean up any existing active source for this segment ID before creating a new one
            const existingSource = this.sources.get(seg.id);
            if (existingSource) {
              try { existingSource.stop(); existingSource.disconnect(); } catch(e) {}
              const existingGain = this.gainNodes.get(seg.id);
              if (existingGain) { try { existingGain.disconnect(); } catch(e) {} }
              const existingMeta = this.playingMetadata.get(seg.id);
              if (existingMeta?.monoNode) { try { existingMeta.monoNode.disconnect(); } catch(e) {} }
              this.sources.delete(seg.id);
              this.gainNodes.delete(seg.id);
              this.playingMetadata.delete(seg.id);
            }

            // Use the captured 'now' for start time calculation to ensure uniformity 
            // but we might need a fresh read if Buffer loading was LONG. 
            // However, the requirements say 'use time in the beginning of tick'.
            
            // Get the most precise current time and rate directly from the source if possible
            const freshCtxTime = ctx.currentTime;
            const freshVideoTime = this.boundVideoElement ? this.boundVideoElement.currentTime : liveVideoTime;
            const currentVideoRate = this.boundVideoElement ? this.boundVideoElement.playbackRate : playbackRate;

            if (freshVideoTime > seg.startTime + seg.duration) {
              return; // Segment is already in the past
            }

            const schedulingDelay = 0.02; // 20ms pre-roll for smooth start
            
            let when: number;
            let bufferOffset: number;
            let timeOffsetInSegment: number;

            // Capture the exact video time for metadata synchronization
            const audioStartVideoTime = freshVideoTime + (schedulingDelay * currentVideoRate);

            if (freshVideoTime > seg.startTime) {
              // 1. Starting from the middle of the segment
              timeOffsetInSegment = freshVideoTime - seg.startTime;
              // Add fixed pre-roll as requested
              when = freshCtxTime + schedulingDelay;
              // User requested NOT to add schedulingDelay to buffer offset to prevent "jumping"
              bufferOffset = (seg.fileOffset || 0) + timeOffsetInSegment;
            } else {
              // 2. Future segment
              timeOffsetInSegment = 0;
              const timeUntilStart = (seg.startTime - freshVideoTime) / currentVideoRate;
              when = freshCtxTime + timeUntilStart;
              bufferOffset = seg.fileOffset || 0;
            }

            // Protect against negative offset from rounding errors.
            bufferOffset = Math.max(0, bufferOffset);
            
            // 4. Calculate how much buffer is left to play for this segment
            const remainingBuffer = Math.max(0, buffer.duration - bufferOffset);
            const remainingTimelineDuration = Math.max(0, seg.duration - timeOffsetInSegment);
            const duration = Math.min(remainingTimelineDuration, remainingBuffer);

            if (duration <= 0 || bufferOffset >= buffer.duration) return;

            const source = ctx.createBufferSource();
            source.buffer = buffer;
            
            const baseRate = 1.0; 
            source.playbackRate.value = baseRate * currentVideoRate;

            const gainNode = ctx.createGain();
            const baseVolume = getSegmentLinearGain(seg.gain) * getTrackLinearVolume(track.volume);
            const FADE_TIME = 0.003;
            
            // Micro-fade in at start
            gainNode.gain.setValueAtTime(0, when);
            gainNode.gain.linearRampToValueAtTime(baseVolume, when + FADE_TIME);

            source.connect(gainNode);
            
            let currentMonoNode: GainNode | undefined;
            const lowerTrackName = track.name?.toLowerCase() || '';
            if (lowerTrackName.includes('озвучк') || lowerTrackName.includes('dub') || buffer.numberOfChannels === 1) {
              const monoNode = ctx.createGain();
              monoNode.channelCount = 1;
              monoNode.channelCountMode = 'explicit';
              source.disconnect(gainNode);
              source.connect(monoNode);
              monoNode.connect(gainNode);
              currentMonoNode = monoNode;
            }

            const isOriginalOrRefTrack = lowerTrackName.includes('оригинал') || lowerTrackName.includes('original') || track.id === 'reference-track' || lowerTrackName.includes('reference');
            if (isOriginalOrRefTrack) {
              gainNode.connect(this.videoGain || ctx.destination);
            } else {
              gainNode.connect(this.dubbingGain || ctx.destination);
            }
            source.start(when, Math.max(0, bufferOffset), Math.max(0, duration));
            
            // Micro-fade out at end
            const fadeOutStart = when + duration - FADE_TIME;
            gainNode.gain.setValueAtTime(baseVolume, Math.max(when, fadeOutStart));
            gainNode.gain.linearRampToValueAtTime(0, when + duration);
            
            this.sources.set(seg.id, source);
            this.gainNodes.set(seg.id, gainNode);

            // Store metadata for sync loop
            this.playingMetadata.set(seg.id, {
              videoStartTime: currentVideoTime > seg.startTime ? audioStartVideoTime : seg.startTime,
              ctxStartTime: when,
              fileOffset: bufferOffset,
              basePlaybackRate: baseRate,
              seg,
              track,
              monoNode: currentMonoNode
            });
          });
        }
      }
    }
  }

  public stop() {
    this.isPlaying = false;
    this.currentSessionId = Date.now();
    this.scheduledSegments.clear();
    this.currentTracks = [];
    
    this.sources.forEach((source, segId) => {
      try {
        source.stop();
        source.disconnect();
      } catch (e) {}
      const meta = this.playingMetadata.get(segId);
      if (meta && meta.monoNode) {
        try {
          meta.monoNode.disconnect();
        } catch (e) {}
      }
    });
    this.sources.clear();
    this.gainNodes.forEach(gain => {
      try {
        gain.disconnect();
      } catch (e) {}
    });
    this.gainNodes.clear();
    this.playingMetadata.clear();
  }

  /**
   * Reconciles current playback with updated tracks without stopping all audio.
   * Efficiently handles segment splits, deletions, and volume changes.
   */
  public reconcile(tracks: any[]) {
    this.currentTracks = tracks;
    if (!this.isPlaying) return;

    const ctx = this.getContext();
    const liveVideoTime = this.boundVideoElement ? this.boundVideoElement.currentTime : 0;
    
    // 1. Build map of current active segments in updated tracks
    const activeSegmentsMap = new Map<string, { seg: any; track: any }>();
    tracks.forEach(track => {
      track.segments.forEach((seg: any) => activeSegmentsMap.set(String(seg.id), { seg, track }));
    });

    // 2. Find segments that are no longer present in tracks and stop them
    this.sources.forEach((source, segId) => {
      if (!activeSegmentsMap.has(segId)) {
        console.log(`[PlaybackEngine] Reconcile: Stopping removed segment ${segId}`);
        this.restartSegment(null, { id: segId });
      }
    });

    // 3. Cleanup scheduledSegments set for segments that were removed but not yet playing
    this.scheduledSegments.forEach(segId => {
      if (!activeSegmentsMap.has(segId)) {
        this.scheduledSegments.delete(segId);
      }
    });

    // 4. Detect playing segments whose boundary/offset changed and restart them
    this.playingMetadata.forEach((meta, segId) => {
      const updatedInfo = activeSegmentsMap.get(segId);
      if (updatedInfo) {
        const oldSeg = meta.seg;
        const newSeg = updatedInfo.seg;
        const positionChanged = 
          Math.abs((oldSeg.startTime || 0) - (newSeg.startTime || 0)) > 0.001 ||
          Math.abs((oldSeg.duration || 0) - (newSeg.duration || 0)) > 0.001 ||
          Math.abs((oldSeg.fileOffset || 0) - (newSeg.fileOffset || 0)) > 0.001;
        
        if (positionChanged) {
          console.log(`[PlaybackEngine] Reconcile: Restarting modified segment ${segId}`);
          this.restartSegment(updatedInfo.track, newSeg);
        }
      }
    });

    // 5. Update gains and rates for existing segments
    this.updateTracks(tracks);

    // 6. Tick once to schedule any newly added or modified segments
    this.tick(liveVideoTime, tracks);
    
    console.log("[PlaybackEngine] Reconciliation complete");
  }

  public seek(currentTime: number, tracks: any[]) {
    const wasPlaying = this.isPlaying;
    this.stop();
    
    // If was playing, we continue playing from the new position
    if (wasPlaying) {
      this.isPlaying = true;
      this.currentSessionId = Date.now();
    }
    
    this.currentTracks = tracks;
    this.tick(currentTime, tracks);
  }

  public updateTracks(tracks: any[]) {
    this.currentTracks = tracks;
    if (!this.isPlaying) return;

    const ctx = this.getContext();
    const anySolo = tracks.some(t => t.isSolo);
    
    // Update Video/Reference gains
    const originalTrack = tracks.find(t => {
      const n = t.name?.toLowerCase() || '';
      return n.includes('оригинал') || n.includes('original');
    });
    const referenceTrack = tracks.find(t => t.id === 'reference-track' || (t.name?.toLowerCase().includes('reference')));

    if (this.videoGain) {
      const isOriginalActive = anySolo 
        ? (originalTrack?.isSolo || false) 
        : !(originalTrack?.isMuted || false);
      const targetVolume = isOriginalActive ? getTrackLinearVolume(originalTrack?.volume) : 0;
      this.videoGain.gain.setTargetAtTime(targetVolume, ctx.currentTime, 0.03);
    }

    if (this.referenceGain) {
      const isRefActive = anySolo
        ? (referenceTrack?.isSolo || false)
        : !(referenceTrack?.isMuted || false);
      const targetVolume = isRefActive ? getTrackLinearVolume(referenceTrack?.volume) : 0;
      this.referenceGain.gain.setTargetAtTime(targetVolume, ctx.currentTime, 0.03);
    }

    const currentPlaybackRate = this.boundVideoElement ? this.boundVideoElement.playbackRate : 1.0;

    tracks.forEach(track => {
      const isTrackActive = anySolo ? track.isSolo : !track.isMuted;
      
      track.segments.forEach((seg: any) => {
        const gainNode = this.gainNodes.get(seg.id);
        if (gainNode) {
          const targetGain = isTrackActive ? getSegmentLinearGain(seg.gain) * getTrackLinearVolume(track.volume) : 0;
          gainNode.gain.setTargetAtTime(targetGain, this.getContext().currentTime, 0.02);
        }

        const source = this.sources.get(seg.id);
        if (source && this.boundVideoElement) {
          // Update playback rate in real-time to match video speed, maintaining strictly 1.0 base rate
          source.playbackRate.setTargetAtTime(1.0 * currentPlaybackRate, this.getContext().currentTime, 0.02);
        }
      });
    });
  }
}

export const playbackEngine = new PlaybackEngine();
