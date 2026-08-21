import { useState, useRef, useEffect, useCallback } from 'react';
import { BackstageSession, TimelineBlock } from '../types';
import { BackstageMediaSourceService } from '../services/backstage/backstageMediaSourceService';
import { BackstageVADAnalyzer } from '../services/backstage/backstageVADService';
import { BackstageRecorderService } from '../services/backstage/backstageRecorderService';
import { BackstageSessionStorage } from '../services/backstage/backstageSessionStorage';
import { useBackstageMediaStream } from './backstage/useBackstageMediaStream';

export const useBackstageSession = (
  projectPath?: string,
  previewStream?: MediaStream | null,
  audioDeviceId?: string,
  isAudioActive?: boolean
) => {
  const [isSessionRecording, setIsSessionRecording] = useState(false);
  const [currentSession, setCurrentSession] = useState<BackstageSession | null>(null);
  const currentSessionRef = useRef<BackstageSession | null>(null);
  const [hasSessions, setHasSessions] = useState(false);
  const [audioSilenceError, setAudioSilenceError] = useState<boolean>(false);

  // Dedicated backstage audio source stream management
  const { backstageStream, setBackstageStream } = useBackstageMediaStream({
    audioDeviceId,
    isAudioActive
  });

  // Services references
  const recorderServiceRef = useRef<BackstageRecorderService | null>(null);
  const vadAnalyzerRef = useRef<BackstageVADAnalyzer | null>(null);

  // Timeline blocks tracking
  const completedBlocksRef = useRef<TimelineBlock[]>([]);
  const activeBlockRef = useRef<TimelineBlock | null>(null);
  const startTimeRef = useRef<number>(0);

  // Current active dub reference
  const currentDubRef = useRef<{
    segmentId: string;
    timelineStartTime: number;
    backstageStartTime: number;
    backstageEndTime: number;
  } | null>(null);

  // Check existing recorded sessions for project
  const checkSessions = useCallback(async () => {
    if (projectPath) {
      const sessions = await BackstageSessionStorage.listSessions(projectPath);
      setHasSessions(sessions.length > 0);
    }
  }, [projectPath]);

  useEffect(() => {
    checkSessions();
  }, [checkSessions]);

  // Clean block management helpers
  const closeActiveBlock = useCallback((endTime: number, extraFields: Partial<TimelineBlock> = {}) => {
    if (!activeBlockRef.current) return;
    const duration = endTime - activeBlockRef.current.start;
    if (duration > 0) {
      completedBlocksRef.current.push({
        ...activeBlockRef.current,
        end: endTime,
        originalEnd: extraFields.originalEnd ?? endTime,
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
    const id = `block_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    activeBlockRef.current = {
      id,
      type,
      start: startTime,
      originalStart: extraFields.originalStart ?? startTime,
      duration: 0,
      isFavorite: false,
      ...extraFields
    };
  }, []);

  // Cancel session on critical failure (e.g. exclusive mic lock)
  const cancelSessionAndTriggerError = useCallback(async () => {
    console.warn('[useBackstageSession] No audio detected. Cancelling session and triggering error.');
    setIsSessionRecording(false);

    vadAnalyzerRef.current?.stop();
    recorderServiceRef.current?.abort();

    if (currentSessionRef.current && projectPath) {
      await BackstageSessionStorage.cleanupAbortedSession(projectPath, currentSessionRef.current.id);
    }

    setCurrentSession(null);
    currentSessionRef.current = null;
    setAudioSilenceError(true);
  }, [projectPath]);

  // Start recording session
  const startSession = useCallback(async (originalVideoPath: string) => {
    const webcamStream = previewStream;
    if (!projectPath || !webcamStream || !window.electronAPI) {
      console.error('[useBackstageSession] Cannot start session: missing projectPath, webcamStream, or electronAPI');
      return;
    }

    // Resolve audio stream with fallback if needed
    let activeAudioStream = backstageStream;
    let liveAudioTracks = activeAudioStream ? activeAudioStream.getAudioTracks().filter(t => t.readyState === 'live') : [];

    if (liveAudioTracks.length === 0 && audioDeviceId !== 'none') {
      console.warn('[useBackstageSession] No active audio tracks in backstageStream, acquiring fresh stream...');
      const fallbackResult = await BackstageMediaSourceService.acquireAudioStream(audioDeviceId);
      if (fallbackResult.stream) {
        activeAudioStream = fallbackResult.stream;
        setBackstageStream(fallbackResult.stream);
        liveAudioTracks = fallbackResult.stream.getAudioTracks();
      }
    }

    if (liveAudioTracks.length === 0 && audioDeviceId !== 'none') {
      console.warn('[useBackstageSession] No audio tracks available in stream, cancelling session.');
      cancelSessionAndTriggerError();
      return;
    }

    const finalStream = BackstageMediaSourceService.createCombinedStream(webcamStream, activeAudioStream);

    const sessionId = Date.now().toString();
    const startTime = Date.now();
    startTimeRef.current = startTime;

    const newSession: BackstageSession = {
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

    // Initialize blocks tracking
    completedBlocksRef.current = [];
    activeBlockRef.current = null;
    currentDubRef.current = null;
    startNewBlock('silence', 0);

    // Initialize VAD Analyzer
    if (finalStream.getAudioTracks().length > 0) {
      const getElapsedTime = () => (Date.now() - startTimeRef.current) / 1000;
      const vad = new BackstageVADAnalyzer(getElapsedTime, {
        onSpeechStart: (voiceStartSec) => {
          closeActiveBlock(voiceStartSec);
          startNewBlock('speaking', voiceStartSec);
        },
        onSpeechEnd: (silenceStartSec) => {
          closeActiveBlock(silenceStartSec);
          startNewBlock('silence', silenceStartSec);
        },
        onZeroSignal: () => {
          cancelSessionAndTriggerError();
        }
      });

      vad.start(finalStream);
      vadAnalyzerRef.current = vad;
    }

    // Initialize and start recorder
    const recorder = new BackstageRecorderService(projectPath, sessionId);
    const started = recorder.start(finalStream);
    recorderServiceRef.current = recorder;

    if (!started) {
      console.error('[useBackstageSession] Failed to start recorder');
      setIsSessionRecording(false);
      setCurrentSession(null);
      currentSessionRef.current = null;
    }
  }, [
    projectPath,
    previewStream,
    audioDeviceId,
    backstageStream,
    setBackstageStream,
    cancelSessionAndTriggerError,
    closeActiveBlock,
    startNewBlock
  ]);

  // Stop recording session and finalize metadata
  const stopSession = useCallback(async (): Promise<BackstageSession | null> => {
    const activeSession = currentSessionRef.current;
    if (!recorderServiceRef.current || !projectPath || !window.electronAPI || !activeSession) {
      console.warn('[stopSession] Early exit. Missing essential references.');
      setIsSessionRecording(false);
      return null;
    }

    setIsSessionRecording(false);

    // Stop VAD analyzer
    if (vadAnalyzerRef.current) {
      vadAnalyzerRef.current.stop();
      vadAnalyzerRef.current = null;
    }

    // Close final active block
    const nowSec = (Date.now() - startTimeRef.current) / 1000;
    closeActiveBlock(nowSec);

    // Stop MediaRecorder
    await recorderServiceRef.current.stop();
    recorderServiceRef.current = null;

    // Finalize session video and metadata
    const rawSession: BackstageSession = {
      ...activeSession,
      duration: Date.now() - startTimeRef.current
    };

    try {
      const savedSession = await BackstageSessionStorage.finalizeAndSaveSession(
        projectPath,
        rawSession,
        completedBlocksRef.current
      );

      await checkSessions();
      setCurrentSession(null);
      currentSessionRef.current = null;
      return savedSession;
    } catch (err) {
      console.error('[stopSession] Failed to finalize backstage session:', err);
      setCurrentSession(null);
      currentSessionRef.current = null;
      return null;
    }
  }, [projectPath, closeActiveBlock, checkSessions]);

  // Dub marker triggers
  const startDub = useCallback((originalStartTime: number) => {
    if (!isSessionRecording || !currentSessionRef.current) return;
    const nowSec = (Date.now() - startTimeRef.current) / 1000;

    vadAnalyzerRef.current?.setInDub(true);
    closeActiveBlock(nowSec);
    startNewBlock('dub', nowSec, { originalStart: originalStartTime });

    currentDubRef.current = {
      segmentId: `dub_${Date.now()}`,
      timelineStartTime: originalStartTime,
      backstageStartTime: nowSec,
      backstageEndTime: 0
    };
  }, [isSessionRecording, closeActiveBlock, startNewBlock]);

  const stopDub = useCallback(() => {
    if (!isSessionRecording || !currentSessionRef.current) return;
    const nowSec = (Date.now() - startTimeRef.current) / 1000;

    let originalEnd: number | undefined = undefined;
    if (activeBlockRef.current && activeBlockRef.current.type === 'dub') {
      const origStart = activeBlockRef.current.originalStart ?? 0;
      const duration = nowSec - activeBlockRef.current.start;
      originalEnd = origStart + duration;
    }

    closeActiveBlock(nowSec, { originalEnd });
    startNewBlock('silence', nowSec);
    vadAnalyzerRef.current?.setInDub(false);

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
  }, [isSessionRecording, closeActiveBlock, startNewBlock]);

  // Legacy method for backward compatibility
  const recordDub = useCallback((segmentId: string, timelineStartTime: number, dubDuration: number) => {
    if (!isSessionRecording || !currentSessionRef.current) return;

    const now = Date.now();
    const backstageStartTime = (now - dubDuration - startTimeRef.current) / 1000;
    const backstageEndTime = (now - startTimeRef.current) / 1000;

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
  }, [isSessionRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      vadAnalyzerRef.current?.stop();
      recorderServiceRef.current?.abort();
    };
  }, []);

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
