import { useState, useRef, useCallback, useEffect, Dispatch, SetStateAction, RefObject, MutableRefObject } from 'react';
import { Project, AudioSegment } from '../types';
import { logger } from '../lib/logger';
import { getSafeFileUrl, getGlobalAudioSettings } from '../lib/utils';
import { punchInSegment } from '../lib/timelineUtils';

export const useAudioEngine = (
  project: Project | null,
  setProject: Dispatch<SetStateAction<Project | null>>,
  videoRef: RefObject<HTMLVideoElement | null>,
  currentTimeRef: MutableRefObject<number>,
  isPlayingRef: MutableRefObject<boolean>,
  togglePlay: () => Promise<void>
) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  const [clippingDetected, setClippingDetected] = useState(false);
  const [recordingPeaks, setRecordingPeaks] = useState<number[]>([]);
  const [isBackstageRecording, setIsBackstageRecording] = useState(false);
  const [isManualBackstageRecording, setIsManualBackstageRecording] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const backstageRecorderRef = useRef<MediaRecorder | null>(null);
  const backstageChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const isDiscardingRef = useRef(false);
  const isManualBackstageRecordingRef = useRef(false);
  const isRecordingRef = useRef(false);
  const isRecordingAsioRef = useRef(false);
  const recordingSegmentIdRef = useRef<string | null>(null);

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    
    // Listen for recording start event from Rust
    let unlisten: (() => void) | null = null;
    if (window.electronAPI && (window.electronAPI as any).onRecordingStarted) {
      unlisten = (window.electronAPI as any).onRecordingStarted(() => {
        console.log("[AudioEngine] Received recording-started event from Rust");
        setIsRecording(true);
        isRecordingRef.current = true;
      });
    }

    return () => {
      isMounted.current = false;
      if (unlisten) unlisten();
      // Cleanup on unmount: unlisten is handled by emitAction helper eventually,
      // but we signal the backend to force stop any persistent operations.
      if (window.electronAPI && window.electronAPI.forceStopAll) {
         window.electronAPI.forceStopAll().catch(err => {
            console.warn("[AudioEngine] Force stop failed during unmount (possibly already stopped)", err);
         });
      }
    };
  }, []);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  const startBackstageRecording = useCallback(async (segmentId: string, processedAudioTrack?: MediaStreamTrack) => {
    if (backstageRecorderRef.current && backstageRecorderRef.current.state === 'recording') {
      logger.warn("Backstage recording already in progress, skipping.");
      return;
    }

    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({ 
        video: project?.audioSettings?.webcamDeviceId ? { deviceId: { exact: project.audioSettings.webcamDeviceId } } : true 
      });

      let audioTrack = processedAudioTrack;
      const backstageAudioId = project?.audioSettings?.backstageAudioDeviceId;
      
      if (!audioTrack && backstageAudioId !== "none") {
        const audioConstraint = backstageAudioId && backstageAudioId !== 'default' 
          ? { deviceId: { exact: backstageAudioId } } 
          : project?.audioSettings?.deviceId ? { deviceId: { exact: project.audioSettings.deviceId } } : true;
          
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: audioConstraint 
        });
        audioTrack = stream.getAudioTracks()[0];
      }
      
      const tracks = [...videoStream.getVideoTracks()];
      if (audioTrack) {
        tracks.unshift(audioTrack);
      }
      const combinedStream = new MediaStream(tracks);
      
      const backstageRecorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm' });
      backstageRecorderRef.current = backstageRecorder;
      backstageChunksRef.current = [];
      backstageRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) backstageChunksRef.current.push(e.data);
      };
      backstageRecorder.onstop = async () => {
        const videoBlob = new Blob(backstageChunksRef.current, { type: 'video/webm' });
        const backstagePath = project?.projectPath || null;
        if (backstagePath && window.electronAPI && isMounted.current) {
          const arrayBuffer = await videoBlob.arrayBuffer();
          const saveRes = await window.electronAPI.saveTake({
            projectPath: backstagePath,
            role: 'backstage',
            startTime: recordingStartTimeRef.current,
            audioData: new Uint8Array(arrayBuffer)
          });
          
          if (saveRes.success && saveRes.data && isMounted.current) {
            const videoPath = saveRes.data.filePath;
            // Link to segment
            setProject(prev => {
              if (!prev) return null;
              return {
                ...prev,
                tracks: prev.tracks.map(t => ({
                  ...t,
                  segments: t.segments.map(s => s.id === segmentId ? { ...s, backstageVideoPath: videoPath } : s)
                }))
              };
            });
          }
        }
        // Cleanup video tracks
        videoStream.getTracks().forEach(t => t.stop());
      };
      
      backstageRecorder.start();
    } catch (err) {
      logger.error("Failed to start backstage recording", err);
      setIsManualBackstageRecording(false);
      isManualBackstageRecordingRef.current = false;
    }
  }, [project, setProject]);

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current) return;
    logger.info("Starting recording process...");
    
    const segmentId = Math.random().toString(36).substr(2, 9);
    recordingSegmentIdRef.current = segmentId;
    
    try {
      const isAsio = project?.audioSettings?.asioMode;

      if (isAsio && window.electronAPI) {
        logger.info("Starting ASIO recording via Tauri Backend");
        const device = project?.audioSettings?.deviceId || "ASIO";
        const sampleRate = project?.audioSettings?.sampleRate || 48000;
        
        const startTime = videoRef.current?.currentTime ?? currentTimeRef.current;
        const targetTrack = project?.tracks?.find(t => t.isArmed) || project?.tracks?.find(t => t.name !== 'Оригинал') || project?.tracks?.[project?.tracks.length - 1];
        const trackId = targetTrack?.id || "dubs";
        const hostName = project?.audioSettings?.host || "ASIO";
        const channelIndex = project?.audioSettings?.channelIndex || 0;
        const backstageRecord = project?.audioSettings?.isBackstageEnabled ?? false;
        
        // Grab devices to map IDs to Labels for FFMPEG
        let videoDeviceName: string | null = null;
        let audioDeviceName: string | null = null;
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (project?.audioSettings?.webcamDeviceId) {
            const vd = devices.find(d => d.deviceId === project.audioSettings?.webcamDeviceId);
            videoDeviceName = vd ? vd.label : project.audioSettings.webcamDeviceId;
          }
          if (project?.audioSettings?.backstageAudioDeviceId && project.audioSettings.backstageAudioDeviceId !== "none") {
             if (project.audioSettings.backstageAudioDeviceId === "default") {
                const ad = devices.find(d => d.kind === "audioinput" && d.deviceId === "default");
                audioDeviceName = ad ? ad.label : "default";
             } else {
                const ad = devices.find(d => d.deviceId === project.audioSettings?.backstageAudioDeviceId || d.label === project.audioSettings?.backstageAudioDeviceId);
                audioDeviceName = ad ? ad.label : project.audioSettings.backstageAudioDeviceId;
             }
          }
        } catch (e) {
          videoDeviceName = project?.audioSettings?.webcamDeviceId || null;
          audioDeviceName = project?.audioSettings?.backstageAudioDeviceId || null;
        }

        const gateEnabled = project?.audioSettings?.isNoiseGateEnabled ?? false;
        const gateThreshold = project?.audioSettings?.noiseGateThreshold ?? -45.0;

        const res = await window.electronAPI.startAsioRecording(
          device, 
          sampleRate, 
          128, 
          trackId, 
          segmentId,
          startTime,
          hostName,
          channelIndex,
          backstageRecord,
          videoDeviceName,
          audioDeviceName,
          project?.projectPath || null,
          gateEnabled,
          gateThreshold
        );
        
        if (!isMounted.current) return;

        if (res.success) {
          isRecordingAsioRef.current = true;
          setIsBackstageRecording(backstageRecord);
          // Emulate start for the rest of state
          recordingStartTimeRef.current = startTime;
          setIsRecording(true);
          isRecordingRef.current = true;
          if (!isPlayingRef.current) {
            await togglePlay();
          }
        } else {
          logger.error("Failed to start ASIO recording", res.error);
          setIsRecording(false);
          isRecordingRef.current = false;
          if (isPlayingRef.current) togglePlay();
          alert("Не удалось запустить ASIO устройство: " + res.error);
        }
        return;
      }

      const audioConstraints: any = {
        echoCancellation: isAsio ? { exact: false } : (project?.audioSettings?.echoCancellation ?? false),
        noiseSuppression: isAsio ? { exact: false } : (project?.audioSettings?.noiseSuppression ?? false),
        autoGainControl:  isAsio ? { exact: false } : (project?.audioSettings?.autoGainControl ?? false),
        channelCount: isAsio ? 2 : 1, // Raw/ASIO mode often requires stereo, standard dubbing uses mono
      };

      if (isAsio) {
        audioConstraints.latency = { ideal: 0.001 }; // Force ultra low latency / raw mode
        if (project?.audioSettings?.sampleRate) {
          audioConstraints.sampleRate = project.audioSettings.sampleRate;
        }
      }

      if (project?.audioSettings?.deviceId) {
        audioConstraints.deviceId = { exact: project.audioSettings.deviceId };
      }

      const constraints: MediaStreamConstraints = {
        audio: audioConstraints
      };
      
      logger.info("Requesting user media with constraints", constraints);

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      isRecordingAsioRef.current = false;
      logger.info("User media stream acquired");

      // Setup Web Audio API to filter out initial transients
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const gainNode = audioCtx.createGain();
      const destination = audioCtx.createMediaStreamDestination();
      
      // More aggressive fade-in (300ms) to hide hardware surges and AGC settling
      // We start at true zero and ramp up
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.05); // Initial silence
      gainNode.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.3); // Smooth ramp
      
      source.connect(gainNode);
      gainNode.connect(destination);
      
      const processedAudioTrack = destination.stream.getAudioTracks()[0];
      const recordedStream = new MediaStream([processedAudioTrack]);

      // If backstage recording is enabled (Parallel Mode), also start backstage with PROCESSED track
      const isBackstageEnabled = project?.audioSettings?.isBackstageEnabled ?? false;
      if (isBackstageEnabled && project?.audioSettings?.backstageMode !== 'manual') {
        startBackstageRecording(segmentId, processedAudioTrack);
      }
      
      setRecordingStream(stream);
      setClippingDetected(false);
      
      const mediaRecorderOptions: MediaRecorderOptions = {};
      if (project?.audioSettings?.bitDepth) {
        const bitrate = project.audioSettings.bitDepth * (project.audioSettings.sampleRate || 48000);
        mediaRecorderOptions.audioBitsPerSecond = bitrate;
      }
      
      const mediaRecorder = new MediaRecorder(recordedStream, mediaRecorderOptions);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      const rawStartTime = videoRef.current?.currentTime ?? currentTimeRef.current;
      recordingStartTimeRef.current = Number.isFinite(rawStartTime) ? rawStartTime : 0;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        logger.info("Recording stopped, processing audio...");
        // Close audio context to free resources
        audioCtx.close().catch(e => logger.error("Error closing audio context", e));

        if (isDiscardingRef.current) {
          logger.info("Recording discarded by user.");
          isDiscardingRef.current = false;
          stream.getTracks().forEach(track => track.stop());
          setRecordingStream(null);
          return;
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const tempAudio = document.createElement('audio');
        tempAudio.src = URL.createObjectURL(audioBlob);
        
        await new Promise((resolve) => {
          tempAudio.onloadedmetadata = () => resolve(true);
          setTimeout(() => resolve(false), 1000);
        });

        const recordedDuration = tempAudio.duration && isFinite(tempAudio.duration) 
          ? tempAudio.duration 
          : (audioBlob.size / 48000 / 2);

        const arrayBuffer = await audioBlob.arrayBuffer();
        
        if (project) {
            const activeLine = project.subtitles.find(line => 
              recordingStartTimeRef.current >= line.start - 0.5 && 
              recordingStartTimeRef.current <= line.end + 0.5
            );

            let filePath: string | undefined;
            let finalWaveform: number[] = [];
            if (window.electronAPI && project.projectPath && isMounted.current) {
              const resultRes = await window.electronAPI.saveTake({
                projectPath: project.projectPath,
                role: project.selectedRole || 'unknown',
                startTime: recordingStartTimeRef.current,
                audioData: new Uint8Array(arrayBuffer)
              });
              if (resultRes && resultRes.success && resultRes.data && isMounted.current) {
                const result = resultRes.data;
                filePath = result.filePath;
                finalWaveform = Array.from(result.peaks || []);
              } else if (isMounted.current) {
                logger.error("Failed to save take:", resultRes?.error);
                alert("Ошибка сохранения записи: " + (resultRes?.error || 'Unknown error'));
              }
            }
            
            if (filePath && isMounted.current) {
              const offsetSec = (project.audioOffsetMs || 0) / 1000;
              const newSegment: AudioSegment = {
                id: segmentId,
                startTime: Math.max(0, recordingStartTimeRef.current - offsetSec),
                duration: recordedDuration,
                fileOffset: 0,
                fileDuration: recordedDuration,
                blobUrl: URL.createObjectURL(audioBlob),
                filePath,
                waveform: finalWaveform,
                gain: 1,
                playbackRate: 1,
                text: activeLine?.text
              };
            
            setProject(prev => {
              if (!prev || prev.tracks.length === 0) return prev;
              
              // Use armed track or fallback to Dubs/First-non-original
              let targetTrackId = prev.tracks.find(t => t.isArmed)?.id;
              
              if (!targetTrackId) {
                targetTrackId = prev.tracks.find(t => 
                  t.name === 'Dubs' || t.name === 'Озвучка' || t.name === 'Takes' || t.name === 'Дубли'
                )?.id;
              }

              if (!targetTrackId) {
                // Find first track that is not Original
                targetTrackId = prev.tracks.find(t => t.name !== 'Оригинал')?.id;
              }

              if (!targetTrackId) {
                targetTrackId = prev.tracks[prev.tracks.length - 1].id;
              }

              const updatedTracks = prev.tracks.map(track => {
                if (track.id === targetTrackId) {
                  return { ...track, segments: punchInSegment(track.segments, newSegment) };
                }
                return track;
              });
              return { ...prev, tracks: updatedTracks };
            });
          }
        }
        
        stream.getTracks().forEach(track => track.stop());
        setRecordingStream(null);
        setIsRecording(false);
        isRecordingRef.current = false;
      };

      if (mediaRecorder.state === 'inactive') {
        mediaRecorder.start();
      }
      
      setIsRecording(true);
      isRecordingRef.current = true;
      
      if (!isPlayingRef.current) {
        await togglePlay();
      }
    } catch (err) {
      logger.error("Error accessing microphone:", err);
      alert("Не удалось получить доступ к микрофону. Проверьте разрешения или выберите другое устройство. Ошибка: " + err);
      setIsRecording(false);
      isRecordingRef.current = false;
      if (isPlayingRef.current) togglePlay();
    }
  }, [project, setProject, videoRef, currentTimeRef, isPlayingRef, togglePlay, isBackstageRecording, startBackstageRecording]);

  const stopRecording = useCallback(async () => {
    if (isRecordingRef.current) {
      if (isRecordingAsioRef.current && window.electronAPI) {
        setIsBackstageRecording(false);
        const res = await window.electronAPI.stopAsioRecording();
        if (!isMounted.current) return;
        
        if (res.success && res.data && project) {
          const { filePath, metadata, videoPath } = res.data;
          
          const activeLine = project.subtitles.find(line => 
            recordingStartTimeRef.current >= line.start - 0.5 && 
            recordingStartTimeRef.current <= line.end + 0.5
          );

          const offsetSec = (project.audioOffsetMs || 0) / 1000;
          const newSegment: AudioSegment = {
            id: recordingSegmentIdRef.current || Math.random().toString(36).substr(2, 9),
            startTime: Math.max(0, recordingStartTimeRef.current - offsetSec),
            duration: metadata.duration,
            fileOffset: 0,
            fileDuration: metadata.duration,
            blobUrl: getSafeFileUrl(filePath),
            filePath,
            backstageVideoPath: videoPath,
            waveform: Array.from(metadata.peaks || []),
            gain: 1,
            playbackRate: 1,
            text: activeLine?.text
          };
          
          setProject(prev => {
            if (!prev || prev.tracks.length === 0) return prev;
            
            // Use armed track or fallback to Dubs/First-non-original
            let targetTrackId = prev.tracks.find(t => t.isArmed)?.id;
            
            if (!targetTrackId) {
              targetTrackId = prev.tracks.find(t => 
                t.name === 'Dubs' || t.name === 'Озвучка' || t.name === 'Takes' || t.name === 'Дубли'
              )?.id;
            }

            if (!targetTrackId) {
              // Find first track that is not Original
              targetTrackId = prev.tracks.find(t => t.name !== 'Оригинал')?.id;
            }

            if (!targetTrackId) {
              targetTrackId = prev.tracks[prev.tracks.length - 1].id;
            }

            const updatedTracks = prev.tracks.map(track => {
              if (track.id === targetTrackId) {
                return { ...track, segments: punchInSegment(track.segments, newSegment) };
              }
              return track;
            });
            return { ...prev, tracks: updatedTracks };
          });
        }
      } else if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
      
      if (backstageRecorderRef.current && backstageRecorderRef.current.state === 'recording') {
        backstageRecorderRef.current.stop();
      }
      setIsRecording(false);
      isRecordingRef.current = false;
      if (isPlayingRef.current) togglePlay();
    }
  }, [togglePlay, isPlayingRef, project, setProject]);

  const discardRecording = useCallback(async () => {
    if (isRecordingRef.current) {
      isDiscardingRef.current = true;
      if (isRecordingAsioRef.current && window.electronAPI) {
        await window.electronAPI.stopAsioRecording();
        if (!isMounted.current) return;
        // Since we are discarding, we don't process the response
      } else if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
      
      if (backstageRecorderRef.current && backstageRecorderRef.current.state === 'recording') {
        backstageRecorderRef.current.stop();
      }
      setIsRecording(false);
      isRecordingRef.current = false;
      if (isPlayingRef.current) togglePlay();
    }
  }, [togglePlay, isPlayingRef, project]);

  const handleToggleRecord = useCallback(() => {
    if (isRecordingRef.current) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [startRecording, stopRecording]);

  const handleToggleBackstage = useCallback(async () => {
    if (!project) return;
    const settings = project.audioSettings || getGlobalAudioSettings();
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        audioSettings: {
          ...settings,
          isBackstageEnabled: !settings.isBackstageEnabled
        }
      };
    });
  }, [project, setProject]);

  const handleDeleteLastTake = useCallback(() => {
    if (!project) return;
    setProject(prev => {
      if (!prev) return null;
      const updatedTracks = [...prev.tracks];
      const dubTrack = updatedTracks.find(t => t.name === 'Dubs');
      if (dubTrack && dubTrack.segments.length > 0) {
        dubTrack.segments.pop();
        return { ...prev, tracks: updatedTracks };
      }
      return prev;
    });
  }, [project, setProject]);

  return {
    isRecording, setIsRecording,
    recordingStream, setRecordingStream,
    clippingDetected, setClippingDetected,
    recordingPeaks, setRecordingPeaks,
    isBackstageRecording, setIsBackstageRecording,
    isManualBackstageRecording, setIsManualBackstageRecording,
    recordingStartTimeRef,
    startRecording,
    stopRecording,
    discardRecording,
    startBackstageRecording,
    handleToggleRecord,
    handleToggleBackstage,
    handleDeleteLastTake,
    isRecordingRef
  };
};
