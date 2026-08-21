import { useState, useEffect, useRef } from 'react';

/**
 * Hook for backstage audio level analysis, VU monitoring, and input diagnostics.
 */
export const useBackstageAudio = (stream: MediaStream | null) => {
  const [rmsLevel, setRmsLevel] = useState<number>(0);
  const [isAudioDetected, setIsAudioDetected] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setRmsLevel(0);
      setIsAudioDetected(false);
      setIsMuted(true);
      return;
    }

    const track = stream.getAudioTracks()[0];
    setIsMuted(track.muted || !track.enabled);

    const onMuteChange = () => {
      setIsMuted(track.muted || !track.enabled);
    };

    track.addEventListener('mute', onMuteChange);
    track.addEventListener('unmute', onMuteChange);

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Float32Array(bufferLength);

      let active = true;
      const analyze = () => {
        if (!active || !analyserRef.current) return;
        analyserRef.current.getFloatTimeDomainData(dataArray);

        let sumSquares = 0;
        for (let i = 0; i < bufferLength; i++) {
          sumSquares += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sumSquares / bufferLength);

        setRmsLevel(rms);
        setIsAudioDetected(rms > 0.005);

        animFrameRef.current = requestAnimationFrame(analyze);
      };

      analyze();

      return () => {
        active = false;
        track.removeEventListener('mute', onMuteChange);
        track.removeEventListener('unmute', onMuteChange);

        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = null;
        }
        if (analyserRef.current) {
          analyserRef.current.disconnect();
          analyserRef.current = null;
        }
        if (sourceRef.current) {
          sourceRef.current.disconnect();
          sourceRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(() => {});
          audioContextRef.current = null;
        }
      };
    } catch (err) {
      console.warn('[useBackstageAudio] Failed to initialize audio level monitoring:', err);
    }
  }, [stream]);

  return {
    rmsLevel,
    isAudioDetected,
    isMuted
  };
};
