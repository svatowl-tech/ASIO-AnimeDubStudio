import React, { useState, useRef, useEffect, useCallback } from 'react';
import { BackstageSession, TimelineBlock } from '../types';

export const useBackstageSession = (
  projectPath?: string,
  previewStream?: MediaStream | null,
  audioDeviceId?: string,
  isAudioActive?: boolean
) => {
  const [isSessionRecording, setIsSessionRecording] = useState(false);
  const [currentSession, setCurrentSession] = useState<BackstageSession | null>(null);
  const currentSessionRef = useRef<BackstageSession | null>(null);
  const [backstageStream, setBackstageStream] = useState<MediaStream | null>(null);
  const [hasSessions, setHasSessions] = useState(false);
  const [audioSilenceError, setAudioSilenceError] = useState<boolean>(false);
  
  // Проверка наличия сессий
  const checkSessions = useCallback(async () => {
    if (projectPath && window.electronAPI) {
      try {
        const res = await window.electronAPI.listBackstageSessions(projectPath);
        if (res.success && res.data) {
          setHasSessions(res.data.length > 0);
        }
      } catch (e) {}
    }
  }, [projectPath]);

  useEffect(() => {
    checkSessions();
  }, [checkSessions]);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Ссылки для Web Audio API (анализатор RMS громкости и VAD)
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioIntervalRef = useRef<number | null>(null);

  // Тайминги и списки блоков
  const completedBlocksRef = useRef<TimelineBlock[]>([]);
  const activeBlockRef = useRef<TimelineBlock | null>(null);
  const startTimeRef = useRef<number>(0);

  // Состояния VAD-детектора
  const inDubRef = useRef<boolean>(false);
  const hearingVoiceRef = useRef<boolean>(false);
  const voiceStartSecRef = useRef<number>(0);
  const activeSpeakingBlockRef = useRef<boolean>(false);
  const silenceStartSecRef = useRef<number | null>(null);

  // Ссылка на текущий записываемый дубль для совместимости с массивом dubs
  const currentDubRef = useRef<{
    segmentId: string;
    timelineStartTime: number;
    backstageStartTime: number;
    backstageEndTime: number;
  } | null>(null);

  // Инициализация аудио потока для бекстейджа (для VUMeter)
  useEffect(() => {
    let active = true;
    let localStream: MediaStream | null = null;
    
    if (!isAudioActive) {
      setBackstageStream(prev => {
        if (prev) {
          prev.getTracks().forEach(t => t.stop());
        }
        return null;
      });
      return;
    }
    
    const initAudio = async () => {
      try {
        let stream: MediaStream;
        const audioConstraints: any = {
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
          }
        };
        if (audioDeviceId && audioDeviceId !== "none" && audioDeviceId !== "default") {
          audioConstraints.audio.deviceId = { ideal: audioDeviceId };
        }
          
        try {
          stream = await navigator.mediaDevices.getUserMedia(audioConstraints);
        } catch (err: any) {
          console.warn("[useBackstageSession] Specific audio device failed, falling back to default mic:", err);
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 1,
              }
            });
          } catch (fallbackErr) {
            console.error("[useBackstageSession] All microphone access failed:", fallbackErr);
            throw fallbackErr;
          }
        }

        if (active) {
          localStream = stream;
          setBackstageStream(stream);
        } else {
          stream.getTracks().forEach(t => t.stop());
        }
      } catch (e) {
        console.warn("Could not get microphone for backstage session preview", e);
      }
    };
    initAudio();
    
    return () => {
      active = false;
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
      }
      setBackstageStream(prev => {
        if (prev) {
          prev.getTracks().forEach(t => t.stop());
        }
        return null;
      });
    };
  }, [audioDeviceId, isAudioActive]);

  // Очистка при размонтировании
  useEffect(() => {
    return () => {
      if (audioIntervalRef.current) {
        window.clearInterval(audioIntervalRef.current);
      }
      if (analyserRef.current) {
        analyserRef.current.disconnect();
        analyserRef.current = null;
      }
      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      if (audioContextRef.current) {
        if (audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(console.error);
        }
        audioContextRef.current = null;
      }
    };
  }, []);

  const cancelSessionAndTriggerError = useCallback(async () => {
    console.warn("[useBackstageSession] No audio detected. Cancelling session and triggering error.");
    setIsSessionRecording(false);
    
    if (audioIntervalRef.current) {
      window.clearInterval(audioIntervalRef.current);
      audioIntervalRef.current = null;
    }
    
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(console.error);
      }
      audioContextRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = null; // Prevent finalize
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        console.error("Failed to stop media recorder on cancel:", e);
      }
    }

    // Attempt to delete temporary backstage session file
    if (currentSessionRef.current && projectPath && window.electronAPI) {
      const sessionId = currentSessionRef.current.id;
      try {
        await window.electronAPI.deleteFile(`${projectPath}/takes/backstage_session_${sessionId}.webm`).catch(() => {});
        await window.electronAPI.deleteFile(`${projectPath}/takes/backstage_session_${sessionId}.json`).catch(() => {});
      } catch (e) {
        console.warn("Failed to delete temp files on cancel:", e);
      }
    }

    setCurrentSession(null);
    currentSessionRef.current = null;
    setAudioSilenceError(true);
  }, [projectPath]);

  // Вспомогательные методы управления блоками
  const closeActiveBlock = useCallback((endTime: number, extraFields: Partial<TimelineBlock> = {}) => {
    if (!activeBlockRef.current) return;
    const duration = endTime - activeBlockRef.current.start;
    if (duration > 0) {
      completedBlocksRef.current.push({
        ...activeBlockRef.current,
        end: endTime,
        duration: Number(duration.toFixed(3)),
        ...extraFields
      });
    }
    activeBlockRef.current = null;
  }, []);

  const startNewBlock = useCallback((
    type: 'silence' | 'speaking' | 'dub',
    startTime: number,
    extraFields: Partial<TimelineBlock> = {}
  ) => {
    const id = "block_" + Date.now() + "_" + Math.random().toString(36).substring(2, 11);
    activeBlockRef.current = {
      id,
      type,
      start: startTime,
      duration: 0,
      isFavorite: false,
      ...extraFields
    };
  }, []);

  const startSession = useCallback(async (originalVideoPath: string) => {
    const webcamStream = previewStream;
    if (!projectPath || !webcamStream || !window.electronAPI) {
      console.error("[useBackstageSession] Cannot start session: missing projectPath, webcamStream, or electronAPI");
      return;
    }
    
    let finalStream = webcamStream;
    try {
      let activeAudioTracks = backstageStream ? backstageStream.getAudioTracks().filter(t => t.readyState === 'live') : [];
      
      if (activeAudioTracks.length === 0 && audioDeviceId !== "none") {
        console.warn("[useBackstageSession] No active audio tracks in backstageStream, re-requesting...");
        try {
          const audioConstraints: any = {
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              channelCount: 1,
            }
          };
          if (audioDeviceId && audioDeviceId !== "none" && audioDeviceId !== "default") {
            audioConstraints.audio.deviceId = { ideal: audioDeviceId };
          }
          let fallbackStream;
          try {
            fallbackStream = await navigator.mediaDevices.getUserMedia(audioConstraints);
          } catch (innerErr) {
            console.warn("[useBackstageSession] Specific backstage mic failed, trying default mic:", innerErr);
            fallbackStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 1,
              }
            });
          }
          activeAudioTracks = fallbackStream.getAudioTracks();
          setBackstageStream(fallbackStream);
        } catch (e) {
          console.error("Failed to re-request audio for backstage:", e);
        }
      }

      if (activeAudioTracks.length > 0) {
        activeAudioTracks.forEach(track => {
          track.onmute = () => {
            console.warn(`[useBackstageSession] Audio track muted (possibly locked by ASIO or exclusive mode): ${track.label}`);
          };
          track.onunmute = () => {
            console.log(`[useBackstageSession] Audio track unmuted: ${track.label}`);
          };
        });
        
        finalStream = new MediaStream([
          ...webcamStream.getVideoTracks(),
          ...activeAudioTracks
        ]);
      }
    } catch (e) {
      console.warn("Could not setup audio for backstage session", e);
    }
    
    const sessionId = Date.now().toString();
    const startTime = Date.now();
    startTimeRef.current = startTime;
    
    const newSession = {
      id: sessionId,
      startTime,
      duration: 0,
      videoPath: '',
      originalVideoPath,
      dubs: [],
      speakingActivities: []
    };
    setCurrentSession(newSession);
    currentSessionRef.current = newSession;
    
    setIsSessionRecording(true);
    
    const hasAudio = finalStream.getAudioTracks().length > 0;
    
    const getMimeType = () => {
      const types = hasAudio 
        ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
        : ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'];
      return types.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
    };

    const recorder = new MediaRecorder(finalStream, { 
      mimeType: getMimeType(),
      videoBitsPerSecond: 5000000,
      ...(hasAudio && { audioBitsPerSecond: 128000 })
    });
    mediaRecorderRef.current = recorder;
    
    recorder.ondataavailable = async (e) => {
      if (e.data.size > 0 && window.electronAPI) {
        const buffer = await e.data.arrayBuffer();
        await window.electronAPI.appendBackstageChunk({
          projectPath,
          sessionId,
          chunkData: new Uint8Array(buffer)
        });
      }
    };

    // Сброс и запуск системы блоков
    completedBlocksRef.current = [];
    activeBlockRef.current = null;
    inDubRef.current = false;
    hearingVoiceRef.current = false;
    activeSpeakingBlockRef.current = false;
    silenceStartSecRef.current = null;
    currentDubRef.current = null;

    // Начинаем с тишины на таймлайне
    startNewBlock('silence', 0);

    // Настраиваем отслеживание голосовой активности (VAD)
    if (hasAudio) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        audioContextRef.current = ctx;
        
        const source = ctx.createMediaStreamSource(finalStream);
        sourceRef.current = source;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        analyserRef.current = analyser;
        
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Float32Array(bufferLength);
        
        const checkInterval = 100; // Проверка каждые 100мс
        let consecutiveZeroRmsCount = 0;
        
        audioIntervalRef.current = window.setInterval(() => {
          if (!analyserRef.current || inDubRef.current) {
            consecutiveZeroRmsCount = 0;
            return;
          }
          
          analyserRef.current.getFloatTimeDomainData(dataArray);
          
          // Вычисление RMS громкости
          let sumSquares = 0;
          for (let i = 0; i < bufferLength; i++) {
            sumSquares += dataArray[i] * dataArray[i];
          }
          const rms = Math.sqrt(sumSquares / bufferLength);
          
          if (rms === 0) {
            consecutiveZeroRmsCount++;
            if (consecutiveZeroRmsCount === 30) { // 3 секунды абсолютной тишины
              console.warn("[useBackstageSession] Микрофон передает 100% тишину (RMS = 0). Возможно устройство захвачено в эксклюзивном режиме (ASIO).");
              cancelSessionAndTriggerError();
              return;
            }
          } else {
            consecutiveZeroRmsCount = 0;
          }
          
          const nowSec = (Date.now() - startTimeRef.current) / 1000;
          const threshold = 0.015; // Порог громкости для фиксации голоса
          
          if (rms > threshold) {
            silenceStartSecRef.current = null;
            if (!hearingVoiceRef.current) {
              hearingVoiceRef.current = true;
              voiceStartSecRef.current = nowSec;
            } else if (!activeSpeakingBlockRef.current) {
              // Если голос идет дольше 1 секунды, переключаем на блок speaking
              if (nowSec - voiceStartSecRef.current > 1.0) {
                activeSpeakingBlockRef.current = true;
                // Ретроспективно закрываем тишину на моменте начала голоса
                closeActiveBlock(voiceStartSecRef.current);
                startNewBlock('speaking', voiceStartSecRef.current);
              }
            }
          } else {
            if (hearingVoiceRef.current) {
              if (silenceStartSecRef.current === null) {
                silenceStartSecRef.current = nowSec;
              } else if (nowSec - silenceStartSecRef.current > 0.8) {
                // Если тишина длится более 800мс, закрываем блок речи
                if (activeSpeakingBlockRef.current) {
                  closeActiveBlock(silenceStartSecRef.current);
                  startNewBlock('silence', silenceStartSecRef.current);
                  activeSpeakingBlockRef.current = false;
                }
                hearingVoiceRef.current = false;
                silenceStartSecRef.current = null;
              }
            }
          }
        }, checkInterval);
      } catch (err) {
        console.error("Ошибка инициализации спектроанализатора речи (VAD):", err);
      }
    }
    
    try {
      recorder.start(2000); // Отправляем чанки каждые 2 секунды
    } catch (e) {
      console.error("Failed to start MediaRecorder:", e);
      setIsSessionRecording(false);
      setCurrentSession(null);
    }
  }, [projectPath, previewStream, audioDeviceId, backstageStream, cancelSessionAndTriggerError, closeActiveBlock, startNewBlock]);

  const stopSession = useCallback(async (): Promise<BackstageSession | null> => {
    return new Promise(async (resolve) => {
      const activeSession = currentSessionRef.current;
      
      console.log("[stopSession] Called. MediaRecorder state:", mediaRecorderRef.current?.state, "Has projectPath:", !!projectPath, "Has API:", !!window.electronAPI, "Has activeSession:", !!activeSession);
      
      if (!mediaRecorderRef.current || !projectPath || !window.electronAPI || !activeSession) {
        console.warn("[stopSession] Early exit. Missing essential references.");
        setIsSessionRecording(false);
        resolve(null);
        return;
      }
      
      const isAlreadyInactive = mediaRecorderRef.current.state === "inactive";
      console.log("[stopSession] Proceeding to stop session. isAlreadyInactive:", isAlreadyInactive);
      
      setIsSessionRecording(false);
      
      // Очистка таймера и Web Audio API для освобождения ресурсов
      if (audioIntervalRef.current) {
        window.clearInterval(audioIntervalRef.current);
        audioIntervalRef.current = null;
      }
      
      const nowSec = (Date.now() - startTimeRef.current) / 1000;
      closeActiveBlock(nowSec);
      
      if (analyserRef.current) {
        analyserRef.current.disconnect();
        analyserRef.current = null;
      }
      
      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      
      if (audioContextRef.current) {
        if (audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(console.error);
        }
        audioContextRef.current = null;
      }

      // Подготавливаем финальный массив блоков для BackstageSessionJSON
      const finalizedBlocks = completedBlocksRef.current.map(b => ({
        ...b,
        duration: Number((b.end! - b.start!).toFixed(3)),
        originalStart: b.originalStart !== undefined ? Number(b.originalStart.toFixed(3)) : undefined,
        originalEnd: b.originalEnd !== undefined ? Number(b.originalEnd.toFixed(3)) : undefined,
        start: Number(b.start!.toFixed(3)),
        end: Number(b.end!.toFixed(3)),
      }));

      // Для обратной совместимости вытащим speakingActivities
      const finalizedSpeakingSegments = finalizedBlocks
        .filter(b => b.type === 'speaking')
        .map(b => ({ start: b.start, end: b.end }));
      
      const session: BackstageSession = { 
        ...activeSession, 
        duration: Date.now() - startTimeRef.current,
        speakingActivities: finalizedSpeakingSegments,
        blocks: finalizedBlocks
      };
      
      const finalizeAndResolve = async () => {
        try {
          // Ждем запись последнего чанка, если он еще пишется
          await new Promise(r => setTimeout(r, 500));
          const res = await window.electronAPI!.finalizeBackstageSession({
            projectPath,
            sessionId: session.id
          });
          
          if (res.success && res.data) {
             session.videoPath = res.data;
          } else {
             console.warn("FFMPEG finalize failed or missing, using original webm file:", res.error);
             session.videoPath = `${projectPath}/takes/backstage_session_${session.id}.webm`;
          }
          
          // Структура BackstageSessionJSON согласно требованиям
          session.sessionId = session.id;
          session.rawVideoPath = session.videoPath;
          session.totalDuration = session.duration / 1000;
          session.blocks = finalizedBlocks;
          
          // Запись файла метаданных сессии
          const sessionJsonStr = JSON.stringify(session, null, 2);
          await window.electronAPI!.writeTextFile({
            path: `${projectPath}/takes/backstage_session_${session.id}.json`,
            data: sessionJsonStr
          });
          
          checkSessions(); // Обновляем наличие сессий
          
          setCurrentSession(null);
          currentSessionRef.current = null;
          resolve(session);
        } catch(e) {
          console.error("Failed to finalize session:", e);
          setCurrentSession(null);
          currentSessionRef.current = null;
          resolve(null);
        }
      };

      if (isAlreadyInactive) {
        // Если уже inactive, onstop не сработает, поэтому финализируем сразу
        await finalizeAndResolve();
      } else {
        mediaRecorderRef.current.onstop = finalizeAndResolve;
        try {
          mediaRecorderRef.current.stop();
        } catch (e) {
          console.error("Failed to stop media recorder:", e);
          await finalizeAndResolve();
        }
      }
    });
  }, [projectPath, closeActiveBlock]);

  // Метод начала дубля
  const startDub = useCallback((originalStartTime: number) => {
    if (!isSessionRecording || !currentSession) return;
    const nowSec = (Date.now() - startTimeRef.current) / 1000;
    
    // Сбрасываем VAD-детекторы, так как идет дубляж
    hearingVoiceRef.current = false;
    activeSpeakingBlockRef.current = false;
    silenceStartSecRef.current = null;
    
    closeActiveBlock(nowSec);
    startNewBlock('dub', nowSec, { originalStart: originalStartTime });
    inDubRef.current = true;
    
    currentDubRef.current = {
      segmentId: "dub_" + Date.now(),
      timelineStartTime: originalStartTime,
      backstageStartTime: nowSec,
      backstageEndTime: 0
    };
  }, [isSessionRecording, currentSession, closeActiveBlock, startNewBlock]);

  // Метод остановки дубля
  const stopDub = useCallback(() => {
    if (!isSessionRecording || !currentSession || !inDubRef.current) return;
    const nowSec = (Date.now() - startTimeRef.current) / 1000;
    
    let originalEnd: number | undefined = undefined;
    if (activeBlockRef.current && activeBlockRef.current.type === 'dub') {
      const origStart = activeBlockRef.current.originalStart ?? 0;
      const duration = nowSec - activeBlockRef.current.start;
      originalEnd = origStart + duration;
    }
    
    closeActiveBlock(nowSec, { originalEnd });
    startNewBlock('silence', nowSec);
    inDubRef.current = false;
    
    if (currentDubRef.current) {
      currentDubRef.current.backstageEndTime = nowSec;
      const finishedDub = { ...currentDubRef.current };
      setCurrentSession(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          dubs: [...prev.dubs, finishedDub]
        };
      });
      currentDubRef.current = null;
    }
  }, [isSessionRecording, currentSession, closeActiveBlock, startNewBlock]);

  // Legacy метод для поддержки обратной совместимости (если вызывается из старого UI)
  const recordDub = useCallback((segmentId: string, timelineStartTime: number, dubDuration: number) => {
    if (!isSessionRecording || !currentSession) return;
    
    const now = Date.now();
    const backstageStartTime = (now - dubDuration - startTimeRef.current) / 1000;
    const backstageEndTime = (now - startTimeRef.current) / 1000;
    
    // Добавим готовый дуб в список сессии
    setCurrentSession(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        dubs: [...prev.dubs, {
          segmentId,
          timelineStartTime,
          backstageStartTime,
          backstageEndTime
        }]
      };
    });
  }, [isSessionRecording, currentSession]);

  return {
    isSessionRecording,
    currentSession,
    startSession,
    stopSession,
    recordDub,
    startDub,
    stopDub,
    backstageStream,
    hasSessions,
    audioSilenceError,
    setAudioSilenceError
  };
};
