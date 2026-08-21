import { useState, useRef, useCallback, useEffect, Dispatch, SetStateAction, RefObject, MutableRefObject } from 'react';
import { Project, AudioSegment } from '../types';
import { logger } from '../lib/logger';
import { getSafeFileUrl, getGlobalAudioSettings, getFriendlyAudioErrorMessage } from '../lib/utils';
import { punchInSegment } from '../lib/timelineUtils';

export const useAudioEngine = (
  project: Project | null,
  setProject: Dispatch<SetStateAction<Project | null>>,
  videoRef: RefObject<HTMLVideoElement | null>,
  currentTimeRef: MutableRefObject<number>,
  isPlayingRef: MutableRefObject<boolean>,
  togglePlay: () => Promise<void>,
  previewStream?: MediaStream | null,
  saveSnapshot?: () => void
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
  const isStartingRecordingRef = useRef(false);
  const isRecordingAsioRef = useRef(false);
  const recordingSegmentIdRef = useRef<string | null>(null);
  const backstageVideoPathsRef = useRef<Record<string, string>>({});

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
      const targetWidth = project?.audioSettings?.webcamResolutionX || 1920;
      const targetHeight = project?.audioSettings?.webcamResolutionY || 1080;

      let videoStream: MediaStream | null = null;
      let isClonedStream = false;

      // 1. Prioritize existing active preview stream to prevent device locking
      if (previewStream) {
        videoStream = previewStream;
        isClonedStream = true;
        logger.info("[AudioEngine] startBackstageRecording: cloning from existing previewStream");
      } else {
        logger.info("[AudioEngine] startBackstageRecording: previewStream not available, requesting getUserMedia");
        videoStream = await navigator.mediaDevices.getUserMedia({ 
          video: project?.audioSettings?.webcamDeviceId 
            ? { 
                deviceId: { exact: project.audioSettings.webcamDeviceId },
                width: { ideal: targetWidth },
                height: { ideal: targetHeight },
                frameRate: { ideal: 30 }
              } 
            : { 
                width: { ideal: targetWidth },
                height: { ideal: targetHeight },
                frameRate: { ideal: 30 }
              }
        });
      }

      let audioTrack = processedAudioTrack;
      const backstageAudioId = project?.audioSettings?.backstageAudioDeviceId;
      const mainAudioId = project?.audioSettings?.deviceId;
      
      console.log(`[AudioEngine Routing] startBackstageRecording setup:`);
      console.log(`- Incoming processedAudioTrack provided: ${!!processedAudioTrack}`);
      console.log(`- Project backstageAudioDeviceId: ${backstageAudioId}`);
      console.log(`- Project main deviceId: ${mainAudioId}`);
      
      if (!audioTrack && backstageAudioId !== "none") {
        let audioConstraint: any = true;
        
        if (backstageAudioId && backstageAudioId !== 'default') {
            try {
              const devices = await navigator.mediaDevices.enumerateDevices();
              const audioDevices = devices.filter(d => d.kind === 'audioinput');
              const matchedDevice = audioDevices.find(d => d.deviceId === backstageAudioId || d.label === backstageAudioId);
              
              if (matchedDevice) {
                audioConstraint = { deviceId: { ideal: matchedDevice.deviceId } };
                console.log(`[AudioEngine Routing] Resolved device: ${matchedDevice.label} (ID: ${matchedDevice.deviceId})`);
              } else {
                audioConstraint = { deviceId: { ideal: backstageAudioId } };
                console.log(`[AudioEngine Routing] Device not found in enumerateDevices, using as-is: ${backstageAudioId}`);
              }
            } catch (e) {
              audioConstraint = { deviceId: { ideal: backstageAudioId } };
              console.log(`[AudioEngine Routing] Using explicit backstage mic: ${backstageAudioId}`);
            }
        } else {
            audioConstraint = true;
            console.log(`[AudioEngine Routing] Using system default mic for backstage (avoiding conflict with main mic)`);
        }

        console.log(`[AudioEngine Routing] Final getUserMedia constraint:`, JSON.stringify(audioConstraint));
          
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ 
            audio: audioConstraint 
          });
          const track = stream.getAudioTracks()[0];
          console.log(`[AudioEngine Routing] Successfully acquired track: ${track.label} (${track.id})`);
        } catch (err: any) {
          console.error(`[AudioEngine Routing] Error acquiring track with constraint:`, err);
          if (err.name === 'OverconstrainedError' && audioConstraint !== true) {
            logger.warn("[AudioEngine] Specific audio device failed, falling back to default");
            console.log(`[AudioEngine Routing] OverconstrainedError, falling back to audio: true`);
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const track = stream.getAudioTracks()[0];
            console.log(`[AudioEngine Routing] Successfully acquired fallback track: ${track.label} (${track.id})`);
          } else {
            throw err;
          }
        }
        audioTrack = stream.getAudioTracks()[0];
        if (!audioTrack) {
          logger.error("[AudioEngine] No audio track could be obtained for backstage recording.");
          throw new Error("Не удалось получить доступ к микрофону для видео-записи");
        }
      } else if (audioTrack) {
          console.log(`[AudioEngine Routing] Using provided processedAudioTrack: ${audioTrack.label} (${audioTrack.id})`);
      } else {
          console.log(`[AudioEngine Routing] Backstage audio is disabled (none).`);
      }
      
      // Clone all tracks so we don't accidentally stop original preview streams
      const tracks = [...videoStream.getVideoTracks().map(t => t.clone())];
      if (audioTrack) {
        tracks.unshift(audioTrack.clone());
      }
      const combinedStream = new MediaStream(tracks);
      
      const getMimeType = () => {
        const types = [
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm'
        ];
        return types.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
      };

      const backstageRecorder = new MediaRecorder(combinedStream, { 
        mimeType: getMimeType(),
        videoBitsPerSecond: project?.audioSettings?.webcamBitrate || 5000000,
        audioBitsPerSecond: 128000
      });
      backstageRecorderRef.current = backstageRecorder;
      backstageChunksRef.current = [];
      backstageRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) backstageChunksRef.current.push(e.data);
      };
      backstageRecorder.onstop = async () => {
        if (!backstageChunksRef.current.length || isDiscardingRef.current) {
          // Cleanup cloned tracks even if no data chunks were generated
          combinedStream.getTracks().forEach(t => t.stop());
          return;
        }
        const videoBlob = new Blob(backstageChunksRef.current, { type: 'video/webm' });
        
        // If the blob is too small (e.g., < 1000 bytes max, meaning it's likely just headers), ignore it
        if (videoBlob.size < 1000) {
          console.warn("[useAudioEngine] Backstage video blob too small/empty, skipping save");
          combinedStream.getTracks().forEach(t => t.stop());
          return;
        }

        const backstagePath = project?.projectPath;
        
        if (backstagePath && window.electronAPI) {
          try {
            const arrayBuffer = await videoBlob.arrayBuffer();
            const saveRes = await window.electronAPI.saveTake({
              projectPath: backstagePath,
              role: 'backstage',
              startTime: recordingStartTimeRef.current,
              audioData: new Uint8Array(arrayBuffer)
            });
            
            if (saveRes.success && saveRes.data && isMounted.current) {
              const videoPath = saveRes.data.filePath;
              // Save in ref in case audio recorder hasn't punched it into project yet
              backstageVideoPathsRef.current[segmentId] = videoPath;

              // Also link to segment if it already exists
              setProject(prev => {
                if (!prev || !prev.tracks) return prev;
                return {
                  ...prev,
                  tracks: (prev.tracks || []).map(t => ({
                    ...t,
                    segments: (t.segments || []).map(s => s.id === segmentId ? { ...s, backstageVideoPath: videoPath } : s)
                  }))
                };
              });
            }
          } catch (e) {
            logger.error("Failed to save backstage take:", e);
          }
        }
        
        // Stop ONLY the cloned tracks in combinedStream, leaving original preview tracks intact!
        combinedStream.getTracks().forEach(t => t.stop());
        
        // If we opened a temporary un-cloned videoStream (not via webcamRef), stop its tracks too
        if (!isClonedStream && videoStream) {
          videoStream.getTracks().forEach(t => t.stop());
        }
      };
      
      backstageRecorder.start(1000);
    } catch (err) {
      logger.error("Failed to start backstage recording", err);
      setIsManualBackstageRecording(false);
      isManualBackstageRecordingRef.current = false;
    }
  }, [project, setProject, previewStream]);

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current || isStartingRecordingRef.current) return;
    
    isStartingRecordingRef.current = true;
    logger.info("Starting recording process...");
    
    const segmentId = Math.random().toString(36).substr(2, 9);
    recordingSegmentIdRef.current = segmentId;
    
    try {
      const isAsio = project?.audioSettings?.asioMode;

      if (isAsio && window.electronAPI) {
        logger.info("Starting ASIO recording via Tauri Backend");
        const device = project?.audioSettings?.deviceId || "ASIO";
        const sampleRate = project?.audioSettings?.sampleRate || 48000;
        
        const startTime = (!isPlayingRef.current ? currentTimeRef.current : (videoRef.current?.currentTime ?? currentTimeRef.current));
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
        const limiterEnabled = project?.audioSettings?.limiterEnabled ?? false;
        const limiterThreshold = project?.audioSettings?.limiterThreshold ?? -9.0;

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
          gateThreshold,
          limiterEnabled,
          limiterThreshold
        );
        
        if (!isMounted.current) return;

        if (res.success) {
          isRecordingAsioRef.current = true;
          // Trigger WebRTC frontal backstage recording if enabled (parallel mode)
          // This avoids reliance purely on backend FFMPEG webcam fetching which often fails.
          if (backstageRecord && project?.audioSettings?.backstageMode !== 'manual') {
            startBackstageRecording(segmentId);
          }
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
          
          const friendlyMessage = getFriendlyAudioErrorMessage(`asio: ${res.error}`);
          alert(friendlyMessage);
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
      
      const isLimiterEnabled = project?.audioSettings?.limiterEnabled ?? false;
      const limiterThreshold = project?.audioSettings?.limiterThreshold ?? -9;
      
      if (isLimiterEnabled) {
          const compressor = audioCtx.createDynamicsCompressor();
          compressor.threshold.value = limiterThreshold;
          compressor.knee.value = 0.0; // Hard knee for limiting
          compressor.ratio.value = 20.0; // High ratio for limiter
          compressor.attack.value = 0.002; // Very fast attack 2ms
          compressor.release.value = 0.1; // 100ms release
          
          source.connect(compressor);
          compressor.connect(gainNode);
      } else {
          source.connect(gainNode);
      }

      // More aggressive fade-in (300ms) to hide hardware surges and AGC settling
      // We start at true zero and ramp up
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.05); // Initial silence
      gainNode.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.3); // Smooth ramp
      
      source.connect(gainNode);
      gainNode.connect(destination);
      
      const processedAudioTrack = destination.stream.getAudioTracks()[0];
      const recordedStream = new MediaStream([processedAudioTrack]);

      // If backstage recording is enabled (Parallel Mode), also start backstage
      const isBackstageEnabled = project?.audioSettings?.isBackstageEnabled ?? false;
      if (isBackstageEnabled && project?.audioSettings?.backstageMode !== 'manual') {
        startBackstageRecording(segmentId);
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
      
      const rawStartTime = (!isPlayingRef.current ? currentTimeRef.current : (videoRef.current?.currentTime ?? currentTimeRef.current));
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
        const tempUrl = URL.createObjectURL(audioBlob);
        tempAudio.src = tempUrl;
        
        await new Promise((resolve) => {
          tempAudio.onloadedmetadata = () => resolve(true);
          setTimeout(() => resolve(false), 1000);
        });

        const recordedDuration = tempAudio.duration && isFinite(tempAudio.duration) 
          ? tempAudio.duration 
          : (audioBlob.size / 48000 / 2);

        URL.revokeObjectURL(tempUrl);

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
                const saveError = resultRes?.error || 'Unknown error';
                alert([
                  "❌ Ошибка сохранения записи на диск.",
                  `Детали: ${saveError}`,
                  "",
                  "💡 Решение:",
                  "1. Проверьте, достаточно ли свободного места на жестком диске.",
                  "2. Убедитесь, что папка проекта доступна для записи и у приложения есть права на изменение файлов в этой директории.",
                  "3. Попробуйте перезапустить приложение от имени администратора."
                ].join('\n'));
              }
            }
            
            if (filePath && isMounted.current) {
              const offsetSec = (project.audioOffsetMs || 0) / 1000;
              
              // Resolve matching original file name for batch export
              let matchedOriginalFileName: string | undefined;
              if (activeLine) {
                const origSegmentId = activeLine.id.startsWith('sub-') ? activeLine.id.substring(4) : activeLine.id;
                const originalTrack = project.tracks.find(t => t.name === 'Оригинал');
                const origSeg = originalTrack?.segments.find(s => s.id === origSegmentId);
                if (origSeg) {
                  matchedOriginalFileName = origSeg.originalFileName;
                } else {
                  // Fallback: find by overlapping time
                  const timeSeg = originalTrack?.segments.find(s => 
                    recordingStartTimeRef.current >= s.startTime - 0.5 && 
                    recordingStartTimeRef.current <= s.startTime + s.duration + 0.5
                  );
                  if (timeSeg) {
                    matchedOriginalFileName = timeSeg.originalFileName;
                  }
                }
              }

              const newSegment: AudioSegment = {
                id: segmentId,
                startTime: Math.max(0, recordingStartTimeRef.current - offsetSec),
                duration: recordedDuration,
                fileOffset: 0,
                fileDuration: recordedDuration,
                blobUrl: URL.createObjectURL(audioBlob),
                filePath,
                backstageVideoPath: backstageVideoPathsRef.current[segmentId],
                waveform: finalWaveform,
                gain: 1,
                playbackRate: 1,
                text: activeLine?.text,
                originalFileName: matchedOriginalFileName
              };
            
            if (saveSnapshot) saveSnapshot();
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
      const friendlyMessage = getFriendlyAudioErrorMessage(err);
      alert(friendlyMessage);
      setIsRecording(false);
      isRecordingRef.current = false;
      if (isPlayingRef.current) togglePlay();
    } finally {
      isStartingRecordingRef.current = false;
    }
  }, [project, setProject, videoRef, currentTimeRef, isPlayingRef, togglePlay, isBackstageRecording, startBackstageRecording]);

  const stopRecording = useCallback(async () => {
    if (isRecordingRef.current) {
      setIsBackstageRecording(false);
      
      // Stop webcam FIRST to avoid capturing trailing seconds while ASIO flushes to disk
      if (backstageRecorderRef.current && backstageRecorderRef.current.state === 'recording') {
        backstageRecorderRef.current.stop();
      }

      if (isRecordingAsioRef.current && window.electronAPI) {
        const res = await window.electronAPI.stopAsioRecording();
        if (!isMounted.current) return;
        
        if (res.success && res.data && project) {
          const { filePath, metadata, videoPath } = res.data;
          
          const activeLine = project.subtitles.find(line => 
            recordingStartTimeRef.current >= line.start - 0.5 && 
            recordingStartTimeRef.current <= line.end + 0.5
          );

          const segmentId = recordingSegmentIdRef.current || Math.random().toString(36).substr(2, 9);
          const newSegment: AudioSegment = {
            id: segmentId,
            startTime: recordingStartTimeRef.current,
            duration: metadata.duration,
            fileOffset: 0,
            fileDuration: metadata.duration,
            blobUrl: getSafeFileUrl(filePath),
            filePath,
            backstageVideoPath: backstageVideoPathsRef.current[segmentId] || videoPath,
            waveform: Array.from(metadata.peaks || []),
            gain: 1,
            playbackRate: 1,
            text: activeLine?.text,
            recordedAt: Date.now()
          };
          
          if (saveSnapshot) saveSnapshot();
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
      
      setIsRecording(false);
      isRecordingRef.current = false;
      if (isPlayingRef.current) togglePlay();
    }
  }, [togglePlay, isPlayingRef, project, setProject]);

  const discardRecording = useCallback(async () => {
    if (isRecordingRef.current) {
      isDiscardingRef.current = true;
      setIsBackstageRecording(false);
      
      if (isRecordingAsioRef.current && window.electronAPI) {
        const res = await window.electronAPI.stopAsioRecording();
        if (!isMounted.current) return;
        
        // Since we are discarding, delete the file immediately
        if (res.success && res.data) {
           await window.electronAPI.deleteFile(res.data.filePath);
           if (res.data.videoPath) {
             await window.electronAPI.deleteFile(res.data.videoPath);
           }
        }
      } else if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
      
      backstageChunksRef.current = [];
      if (backstageRecorderRef.current && backstageRecorderRef.current.state !== 'inactive') {
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
    isBackstageRecording,
    setIsBackstageRecording,
    recordingStartTimeRef,
    startRecording,
    stopRecording,
    discardRecording,
    handleToggleRecord,
    handleDeleteLastTake,
    isRecordingRef,
    isStartingRecordingRef
  };
};
