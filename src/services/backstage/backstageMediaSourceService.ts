/**
 * Backstage Media Source Service
 * Handles acquisition, device resolution, constraints, and lifecycle of backstage audio and video sources.
 */

export interface BackstageAudioSourceResult {
  stream: MediaStream | null;
  track: MediaStreamTrack | null;
  deviceLabel: string;
  error?: Error;
}

export class BackstageMediaSourceService {
  /**
   * Builds high-fidelity audio constraints for studio recording without unwanted processing.
   */
  static getStudioAudioConstraints(deviceId?: string): MediaTrackConstraints {
    const baseConstraints: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      sampleRate: 48000
    };

    if (!deviceId || deviceId === 'default' || deviceId === 'none') {
      return baseConstraints;
    }

    return {
      ...baseConstraints,
      deviceId: { ideal: deviceId }
    };
  }

  /**
   * Resolves audio input device from navigator.mediaDevices with fallback support.
   */
  static async resolveAudioDevice(requestedId?: string): Promise<{ deviceId?: string; label?: string }> {
    if (!requestedId || requestedId === 'default' || requestedId === 'none') {
      return {};
    }

    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        return { deviceId: requestedId };
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      const matched = audioInputs.find(d => d.deviceId === requestedId || d.label === requestedId);

      if (matched) {
        return { deviceId: matched.deviceId, label: matched.label };
      }
    } catch (err) {
      console.warn('[BackstageMediaSource] Could not enumerate devices for audio resolution:', err);
    }

    return { deviceId: requestedId };
  }

  /**
   * Acquires an audio MediaStream for the backstage recorder with intelligent fallbacks.
   */
  static async acquireAudioStream(deviceId?: string): Promise<BackstageAudioSourceResult> {
    if (deviceId === 'none') {
      return { stream: null, track: null, deviceLabel: 'None' };
    }

    const { deviceId: resolvedId, label } = await this.resolveAudioDevice(deviceId);
    const primaryConstraints = this.getStudioAudioConstraints(resolvedId);

    try {
      console.log(`[BackstageMediaSource] Requesting audio stream with device: "${label || resolvedId || 'default'}"`);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: primaryConstraints });
      const track = stream.getAudioTracks()[0] || null;
      const deviceLabel = track?.label || label || 'Microphone';

      console.log(`[BackstageMediaSource] Audio track acquired successfully: ${deviceLabel}`);
      return { stream, track, deviceLabel };
    } catch (err: any) {
      console.warn(`[BackstageMediaSource] Primary audio capture failed for "${resolvedId}", trying fallback to default:`, err);

      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1
          }
        });
        const fallbackTrack = fallbackStream.getAudioTracks()[0] || null;
        const fallbackLabel = fallbackTrack?.label || 'Default Microphone';

        console.log(`[BackstageMediaSource] Fallback audio track acquired: ${fallbackLabel}`);
        return { stream: fallbackStream, track: fallbackTrack, deviceLabel: fallbackLabel };
      } catch (fallbackErr: any) {
        console.error('[BackstageMediaSource] All audio acquisition attempts failed:', fallbackErr);
        return { stream: null, track: null, deviceLabel: 'Failed', error: fallbackErr };
      }
    }
  }

  /**
   * Combines webcam video tracks and backstage audio tracks into a unified MediaStream.
   */
  static createCombinedStream(
    videoStream: MediaStream,
    audioStream?: MediaStream | null
  ): MediaStream {
    const videoTracks = videoStream.getVideoTracks();
    const audioTracks = audioStream ? audioStream.getAudioTracks().filter(t => t.readyState === 'live') : [];

    return new MediaStream([...videoTracks, ...audioTracks]);
  }

  /**
   * Safely stops and disposes all tracks in a MediaStream.
   */
  static stopStream(stream?: MediaStream | null): void {
    if (!stream) return;
    try {
      stream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (e) {
          // ignore individual track stop errors
        }
      });
    } catch (err) {
      console.warn('[BackstageMediaSource] Error stopping stream tracks:', err);
    }
  }
}
