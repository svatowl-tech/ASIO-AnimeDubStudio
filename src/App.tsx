import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Mic, 
  Play, 
  Pause, 
  SkipBack, 
  Settings, 
  FileVideo, 
  FolderOpen,
  Type, 
  Layers, 
  Download, 
  Plus,
  Trash2,
  Volume2,
  Monitor,
  Video as VideoIcon,
  ChevronRight,
  Upload,
  FileText,
  AlertTriangle,
  LayoutTemplate,
  ZoomIn,
  ZoomOut,
  Activity,
  Star,
  GripVertical,
  X,
  Bookmark,
  Music,
  ScrollText,
  ArrowUp,
  ArrowDown,
  Maximize2,
  Minimize2,
  Minus,
  BookOpen,
  Archive,
  Circle,
  Square,
  Repeat,
  Smile,
  Film
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDropzone } from 'react-dropzone';
import WaveSurfer from 'wavesurfer.js';
import { cn, getSafeFileUrl, getGlobalAudioSettings, getDefaultKeyMap, safeConfirm, getFriendlySubtitleErrorMessage, getFriendlyFileLoadErrorMessage } from './lib/utils';
import { FixesPanel } from './components/FixesPanel';
import { Waveform } from './components/Waveform';
import AudioSegmentView from './components/AudioSegmentView';
import VUMeter from './components/VUMeter';
import AudioDeviceManager from './components/AudioDeviceManager';
import ExportModal from './components/ExportModal';
import CastingImportModal from './components/CastingImportModal';
import DocumentImportModal from './components/DocumentImportModal';
import QuickImportModal from './components/QuickImportModal';
import FixImportModal from './components/FixImportModal';
import { ensureBlankVideoForProject } from './services/blankVideoService';
import PreRollCountdown from './components/PreRollCountdown';
import Teleprompter from './components/Teleprompter';
import { Project, SubtitleLine, AudioTrack, AudioSegment, Fix, Marker, TrackProcessing, TeleprompterMode } from './types';
import { getStoredTeleprompterPref, saveTeleprompterPref } from './components/teleprompter/useTeleprompterLayout';
import { SubtitleService, ParsedSubtitles } from './services/subtitleService';
import { TextImportService } from './services/textImportService';
import { LatencyCalibration } from './components/LatencyCalibration';
import { WaveformService } from './services/waveformService';
import { SmartAlignService } from './services/smartAlignService';
import { FixService } from './services/fixService';
import { BulkImportService } from './services/bulkImportService';
import { UniversalParserService } from './services/UniversalParserService';
import { playbackEngine } from './services/playbackEngine';
import { logger } from './lib/logger';
import { splitSegmentAtTime } from './lib/timelineUtils';

import { MissingSubtitlesBanner } from './components/MissingSubtitlesBanner';
import { getSubtitleCoverageStats } from './lib/subtitleCoverage';

// Extracted Components
import { AudioDAWView } from './components/AudioDAWView';
import ActorOverlay from './components/ActorOverlay';
import PopoutWindow from './components/PopoutWindow';
import StudioDashboard from './components/StudioDashboard';
import AdvancedTimeline from './components/AdvancedTimeline';
import DocumentViewer from './components/DocumentViewer';
import VirtualizedWaveform from './components/VirtualizedWaveform';
import TimelineCanvas from './components/TimelineCanvas';
import TrackHeader from './components/TrackHeader';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import TransportControls from './components/TransportControls';




import { useProject } from './hooks/useProject';
import { useTimelineState } from './hooks/useTimelineState';
import { useTimelineHotkeys } from './hooks/useTimelineHotkeys';
import { useTimelineHistory } from './hooks/useTimelineHistory';
import { useProjectActions } from './hooks/useProjectActions';
import { ProjectProvider } from './contexts/ProjectContext';
import { TimelineProvider } from './contexts/TimelineContext';
import LeftSidebar from './components/layout/LeftSidebar';
import { UIProvider } from './contexts/UIContext';
import ModalsManager from './components/layout/ModalsManager';
import BackstageEditor from './components/BackstageEditor';
import { BackstageErrorBoundary } from './components/backstage/BackstageErrorBoundary';
import { MkvTrackSelectorModal } from './components/MkvTrackSelectorModal';
import TopHeader from './components/layout/TopHeader';
import StyledExportOverlay from './components/layout/ExportOverlay';
import VideoPreparationModal from './components/VideoPreparationModal';
import { prepareVideoProxy, syncProxyVideoWithProject } from './services/videoProxyService';
import { useAudioEngine } from './hooks/useAudioEngine';
import { useBackstageSession } from './hooks/useBackstageSession';
import { useProjectImport } from './hooks/useProjectImport';
import { useAppExport } from './hooks/useAppExport';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openStudioWindow, closeStudioWindow } from './lib/windowHelpers';

export default function App() {
  const { 
    project, 
    setProject, 
    recentProjects, 
    handleNewProject, 
    handleOpenProject, 
    handleSaveProject: origHandleSaveProject, 
    handleCloseProject,
    onLoadProject 
  } = useProject();

  const [saveTrigger, setSaveTrigger] = useState(0);

  const handleSaveProject = async () => {
    setProject(prev => {
      if (!prev || !prev.projectPath) {
        logger.warn("Save Project Attempted: Project not saved on disk or no projectPath.");
        alert("Проект не сохранен на диске. Используйте 'Создать проект'.");
        return prev;
      }
      return {
        ...prev,
        uiState: {
          zoomLevel,
          timelineHeight,
          sidebarWidth,
          teleprompterMode,
          teleprompterFontSize,
          teleprompterLineHeight,
          teleprompterPacing,
          teleprompterPosition,
          teleprompterSize,
          showFixes
        }
      };
    });
    
    // Trigger the actual disk save in useEffect after state has committed
    setSaveTrigger(t => t + 1);
  };

  useEffect(() => {
    if (saveTrigger > 0 && project && project.projectPath && window.electronAPI) {
      const projectToSave = JSON.parse(JSON.stringify(project));
      delete projectToSave.audioSettings;
      
      logger.info(`Saving project: ${projectToSave.name} at ${projectToSave.projectPath}`);
      window.electronAPI.saveProjectJson({ projectPath: projectToSave.projectPath, projectData: projectToSave })
        .then(() => {
          logger.info("Project saved successfully.");
          alert("Проект сохранен!");
        })
        .catch((error) => {
          logger.error(`Save Project Failed: ${error}`);
          alert(`Ошибка при сохранении проекта: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
  }, [saveTrigger]); // We intentionally do not include 'project' to prevent auto-saving on every project change


  const [duration, setDuration] = useState(0);
  const [isWebcamSimulated, setIsWebcamSimulated] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const referenceAudioRef = useRef<HTMLAudioElement>(null);
  const lastLoggedIdRef = useRef<string | null>(null);
  const webcamRef = useRef<HTMLVideoElement>(null);

  const {
    currentTime, setCurrentTime,
    zoomLevel, setZoomLevel,
    isPlaying, setIsPlaying,
    isLooping, setIsLooping,
    loopRange, setLoopRange,
    isExporting, setIsExporting,
    exportProgress, setExportProgress,
    exportOperation, setExportOperation,
    timelineHeight, setTimelineHeight,
    isAutoHeight, setIsAutoHeight,
    sidebarWidth, setSidebarWidth,
    isRippleEnabled, setIsRippleEnabled,
    selectedSegmentIds, setSelectedSegmentIds,
    videoError, setVideoError,
    handleSeek,
    togglePlay,
    handleFitToWidth,
    isPlayingRef,
    currentTimeRef,
    timelineRef
  } = useTimelineState(project, duration, setDuration, videoRef, referenceAudioRef);

  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);

  const {
    isRecording,
    recordingStream,
    clippingDetected, setClippingDetected,
    recordingPeaks,
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
  } = useAudioEngine(project, setProject, videoRef, currentTimeRef, isPlayingRef, togglePlay, previewStream);

  const { saveSnapshot, undo, redo, canUndo, canRedo } = useTimelineHistory(project, setProject);


  const {
    isSessionRecording: isBackstageSessionRecording,
    startSession: startBackstageSession,
    stopSession: stopBackstageSession,
    recordDub,
    startDub,
    stopDub,
    backstageStream,
    hasSessions: hasBackstageSessions,
    audioSilenceError,
    setAudioSilenceError
  } = useBackstageSession(
    project?.projectPath, 
    previewStream, 
    project?.audioSettings?.backstageAudioDeviceId,
    !!project?.audioSettings?.isBackstageEnabled
  );
  
  // Track dubs automatically based on isRecording state
  const lastDubStartTimeRef = useRef<number | null>(null);
  useEffect(() => {
    if (isRecording) {
      lastDubStartTimeRef.current = Date.now();
      if (startDub) {
        startDub(currentTimeRef.current);
      }
    } else {
      if (lastDubStartTimeRef.current !== null && project?.selectedRole) {
        if (stopDub) {
          stopDub();
        }
        lastDubStartTimeRef.current = null;
      }
    }
  }, [isRecording, startDub, stopDub, project?.selectedRole]);
  
  const isRippleEnabledRef = useRef(isRippleEnabled);
  useEffect(() => { isRippleEnabledRef.current = isRippleEnabled; }, [isRippleEnabled]);

  const {
    handleSplit,
    deleteSegments,
    updateSegment,
    updateAllTracks,
    deleteTrack,
    addMarker,
    handleJoinSegments,
    handleArmTrack,
    handleUpdateProcessing,
    handleAddTrack,
    handleDuplicateSegment,
    moveSegmentToTrack
  } = useProjectActions({
    project,
    setProject,
    saveSnapshot,
    selectedSegmentIds,
    setSelectedSegmentIds,
    isPlayingRef,
    currentTimeRef,
    videoRef,
    isRippleEnabledRef
  });

  const { 
    handleSelectVideo, 
    mkvImportData, 
    handleMkvConfirm, 
    handleMkvCancel 
  } = useProjectImport(
    project, 
    setProject, 
    setDuration, 
    setIsExporting, 
    setExportProgress, 
    setExportOperation
  );

  const [isDesktop, setIsDesktop] = useState(!!(window as any).__TAURI_INTERNALS__);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showBackstageEditor, setShowBackstageEditor] = useState(false);
  const [showFixes, setShowFixes] = useState(true);
  const [showQuickImport, setShowQuickImport] = useState(false);
  const [processingTrackId, setProcessingTrackId] = useState<string | null>(null);
  const [quickImportText, setQuickImportText] = useState('');
  const [quickImportDuration, setQuickImportDuration] = useState(5);
  
  const [showFixImport, setShowFixImport] = useState(false);
  const [isPopoutOpen, setIsPopoutOpen] = useState(false);
  const [externalWindow, setExternalWindow] = useState<Window | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [fixImportText, setFixImportText] = useState('');

  const [videoPreparation, setVideoPreparation] = useState<{
    isOpen: boolean;
    progress: number;
    time?: string;
    statusText?: string;
    error?: string | null;
    isSuccess?: boolean;
  }>({
    isOpen: false,
    progress: 0,
    time: '',
    statusText: 'Конвертирование видео в совместимый формат MP4 (H.264)...',
    error: null,
    isSuccess: false
  });

  const handleCreateProxyVideo = useCallback(async (videoPathOverride?: string, projectPathOverride?: string) => {
    const targetVideoPath = videoPathOverride || project?.videoPath;
    const targetProjectPath = projectPathOverride || project?.projectPath || (targetVideoPath ? `${targetVideoPath.replace(/\.[^/.]+$/, "")}_Project` : '');

    if (!targetVideoPath || !targetProjectPath) {
      logger.warn("Cannot create proxy: videoPath or projectPath is missing");
      setVideoError("Не найден путь к видео или проекту для конвертирования.");
      return;
    }

    setVideoPreparation({
      isOpen: true,
      progress: 0,
      time: '',
      statusText: 'Подготовка видео через FFmpeg в формат MP4 (H.264)...',
      error: null,
      isSuccess: false
    });

    try {
      const res = await prepareVideoProxy({
        videoPath: targetVideoPath,
        projectPath: targetProjectPath,
        duration: duration > 0 ? duration : undefined,
        onProgress: (data) => {
          setVideoPreparation(prev => ({
            ...prev,
            progress: data.percent,
            time: data.time,
            statusText: data.operation ? `${data.operation}...` : prev.statusText
          }));
        }
      });

      if (res.success && res.proxyPath) {
        setVideoPreparation(prev => ({
          ...prev,
          progress: 100,
          isSuccess: true,
          statusText: 'Видео успешно сконвертировано!'
        }));

        if (project) {
          const updatedProject = await syncProxyVideoWithProject(project, res.proxyPath);
          setProject(updatedProject);
        }

        setVideoError(null);
        if (videoRef.current) {
          videoRef.current.load();
        }

        setTimeout(() => {
          setVideoPreparation(prev => ({ ...prev, isOpen: false, isSuccess: false }));
        }, 900);
      } else {
        setVideoPreparation(prev => ({
          ...prev,
          error: res.error || 'Не удалось сконвертировать видео. Проверьте файл.'
        }));
      }
    } catch (err: any) {
      setVideoPreparation(prev => ({
        ...prev,
        error: String(err?.message || err)
      }));
    }
  }, [project, duration, setProject]);

  // Exit app handler for Tauri main window
  useEffect(() => {
    const handleUnload = () => {
      // Close browser popups
      if (externalWindow && externalWindow !== window && typeof (externalWindow as any).close === 'function') {
        try { (externalWindow as any).close(); } catch(e) {}
      }
    };
    
    let unlistenTauriClose: any = null;
    if (isDesktop && !!(window as any).__TAURI_INTERNALS__) {
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        const mainWindow = getCurrentWindow();
        mainWindow.onCloseRequested(async (event) => {
          event.preventDefault();
          try {
            const { closeStudioWindow } = await import('./lib/windowHelpers');
            await closeStudioWindow();
          } catch(e) {
            console.error("Cleanup error", e);
          } finally {
            // Now force destroy the main window which terminates the app if it's the last window
            mainWindow.destroy().catch(() => {});
          }
        }).then(unlisten => unlistenTauriClose = unlisten);
      });
    }
    
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      if (unlistenTauriClose) unlistenTauriClose();
    };
  }, [externalWindow, isDesktop]);

  const handleTogglePopout = async () => {
    if (isPopoutOpen) {
      if (externalWindow && externalWindow !== window && typeof (externalWindow as any).close === 'function') {
        try {
          (externalWindow as any).close();
        } catch (e) {
          console.warn('Error closing popout window:', e);
        }
      }
      if (isDesktop) {
        await closeStudioWindow();
      }
      setExternalWindow(null);
      setIsPopoutOpen(false);
      setPopupBlocked(false);
    } else {
      // 1. If we're inside an iframe (like AI Studio preview),
      // directly use Studio Mode (fullscreen overlay) because popups and PiP might be fully blocked
      if (window.top !== window.self) {
        setExternalWindow(window);
        setIsPopoutOpen(true);
        setPopupBlocked(false);
        return;
      }
      
      // 2. Native Desktop popup
      if (isDesktop) {
        const success = await openStudioWindow();
        if (success) {
          setIsPopoutOpen(true);
          setPopupBlocked(false);
          // Set external window to 'pseudo' truthy to satisfy conditional rendering logic
          setExternalWindow('DESKTOP_POPOUT' as any);
        } else {
          setPopupBlocked(true);
        }
        return;
      }

      // 2. Try Document Picture in Picture (Chrome 116+, shares JS Context perfectly)
      if ("documentPictureInPicture" in window) {
        try {
          const pipWindow = await (window as any).documentPictureInPicture.requestWindow({
            width: 1280,
            height: 720,
          });
          setExternalWindow(pipWindow);
          setIsPopoutOpen(true);
          setPopupBlocked(false);
          return;
        } catch (e) {
          console.warn("Document PiP failed:", e);
          // Fallback to error
        }
      }

      // 3. Try window.open popup
      const newWin = window.open(
        '',
        'DubStudioProDualScreenWindow',
        'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no,resizable=yes'
      );
      
      if (!newWin) {
        console.warn('Window.open returned null. Popups are blocked.');
        setPopupBlocked(true);
        setIsPopoutOpen(false);
        setExternalWindow(null);
      } else {
        setPopupBlocked(false);
        setExternalWindow(newWin);
        setIsPopoutOpen(true);
      }
    }
  };

  const handleFixImport = () => {
    if (!project || !project.subtitles) return;
    const fixes = FixService.parseRawFixes(fixImportText, project.subtitles);
    
    let updatedSubtitles = [...project.subtitles];
    
    // Helper to recognize Russian and English keywords for skipped or missing lines
    const isSkipOrMissingOrOverride = (comment: string): boolean => {
      const normalized = comment.toLowerCase();
      const ruKeywords = [
        'пропуск', 'пропустил', 'пропустила', 'пропущена', 'пропущено',
        'твое', 'твоё', 'твоя реплика', 'твоя фраза', 'возьми фразу', 'возьми себе',
        'озвучь тут', 'озвучить тут', 'озвучь', 'добавь', 'добавить реплику', 'добавить',
        'хардсаб', 'хардсаба', 'хардсабах', 'нет в сабах', 'нет реплики', 'нет фразы',
        'пропущен', 'пропущенная'
      ];
      const enKeywords = [
        'skip', 'skipped', 'missing', 'missed', 'add sub', 'add subtitle',
        'your phrase', 'your line', 'yours', 'add replica', 'not in subs', 'hardsub'
      ];
      return ruKeywords.some(kw => normalized.includes(kw)) || enKeywords.some(kw => normalized.includes(kw));
    };

    fixes.forEach(fix => {
      // Find the closest subtitle line to double check
      let matchingSub = updatedSubtitles.find(s => s.id === fix.segmentId);
      if (!matchingSub && fix.timestamp !== undefined) {
        // Fallback search in updatedSubtitles
        matchingSub = updatedSubtitles.find(s => fix.timestamp >= s.start && fix.timestamp <= s.end);
      }

      const commentIsSkip = isSkipOrMissingOrOverride(fix.comment);
      const isTooFar = matchingSub ? (Math.abs(matchingSub.start - fix.timestamp) > 4.0 && Math.abs(matchingSub.end - fix.timestamp) > 4.0) : true;
      const isWrongActor = matchingSub && fix.actor && fix.actor !== 'Unknown' && matchingSub.role !== fix.actor;

      if (commentIsSkip || isTooFar || (isWrongActor && commentIsSkip)) {
        if (isWrongActor && matchingSub && !isTooFar) {
          // Duplicate the existing sub for the correct actor so they can record in this time alignment
          const newSubId = `sub_fix_${Math.random().toString(36).substr(2, 9)}`;
          const duplicatedSub = {
            id: newSubId,
            start: matchingSub.start,
            end: matchingSub.end,
            text: `[ФИКС: Перенос от ${matchingSub.role}] ${matchingSub.text}`,
            role: fix.actor,
            needsFix: true,
            fixComment: fix.comment
          };
          updatedSubtitles.push(duplicatedSub);
          fix.segmentId = newSubId;
        } else {
          // Create a brand new subtitle line for the missing part
          const newSubId = `sub_fix_${Math.random().toString(36).substr(2, 9)}`;
          const newSub = {
            id: newSubId,
            start: fix.timestamp,
            end: fix.timestamp + 3.0,
            text: `[Пропущенная реплика] ${fix.comment}`,
            role: fix.actor && fix.actor !== 'Unknown' ? fix.actor : (project.selectedRole || 'Default'),
            needsFix: true,
            fixComment: fix.comment
          };
          updatedSubtitles.push(newSub);
          fix.segmentId = newSubId;
        }
      } else if (fix.segmentId) {
        // Normal fix mapping on exact/closest sub
        updatedSubtitles = updatedSubtitles.map(s => {
          if (s.id === fix.segmentId) {
            return {
              ...s,
              needsFix: true,
              fixComment: fix.comment
            };
          }
          return s;
        });
      }
    });

    // Make sure subtitles remain sorted by start time so chronological UI orders work perfectly
    updatedSubtitles.sort((a, b) => a.start - b.start);

    setProject({
      ...project,
      subtitles: updatedSubtitles,
      fixes: fixes
    });
    
    setShowFixImport(false);
    setFixImportText('');
  };

  const showWebcam = !!project?.audioSettings?.isBackstageEnabled;
  const [videoType, setVideoType] = useState<string | null>(null);
  const [showCalibration, setShowCalibration] = useState(false);
  const initialTpPref = getStoredTeleprompterPref();
  const [teleprompterMode, setTeleprompterMode] = useState<TeleprompterMode>(initialTpPref.mode || 'compact');
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [teleprompterPosition, setTeleprompterPosition] = useState({ x: 0, y: 0 });
  const [teleprompterSize, setTeleprompterSize] = useState({ 
    width: initialTpPref.floatWidth || 460, 
    height: initialTpPref.floatHeight || 200 
  });


  useEffect(() => {
    const check = () => {
      // Check for Tauri internals explicitly to avoid false positives from the legacy wrapper
      const isEl = !!(window as any).__TAURI_INTERNALS__;
      if (isEl !== isDesktop) setIsDesktop(isEl);
    };
    check();
    const interval = setInterval(check, 1000);
    
    // Inject demo project for web preview immediately if not in desktop mode
    if (!project && !(window as any).__TAURI_INTERNALS__) {
      setProject({
        id: 'demo-project',
        name: 'Демо Превью',
        projectPath: '/mock/path',
        videoUrl: '/sample-video.mp4',
        subtitles: [
          { id: 1, start: 0, end: 3, role: 'Character 1', text: 'This is a demo project', combined: 'This is a demo project' },
          { id: 2, start: 3, end: 7, role: 'Character 2', text: 'For AI Studio preview!', combined: 'For AI Studio preview!' }
        ],
        roles: ['Character 1', 'Character 2'],
        selectedRole: 'Character 1',
        tracks: [
          { id: 'original', name: 'Оригинал', segments: [], volume: 1, isMuted: false },
          { id: 'track-1', name: 'Dubs 1', segments: [
            {
               id: 'demo-seg',
               startTime: 1,
               duration: 6,
               fileOffset: 0,
               fileDuration: 6,
               blobUrl: '',
               filePath: '',
               gain: 1,
               playbackRate: 1,
               waveform: new Array(120).fill(0).map(() => Math.random() * 0.8 + 0.1),
               originalFileName: 'demo-dub.wav'
            }
          ], volume: 1, isMuted: false, isArmed: true }
        ],
        latencyOffset: 0,
        audioOffsetMs: 0,
        audioSettings: {
          deviceId: 'default',
          outputDeviceId: 'default',
          sampleRate: 48000,
          channels: 1,
          noiseSuppression: true,
          echoCancellation: true,
          backstageMode: 'parallel',
          isBackstageEnabled: false
        }
      });
      setDuration(10);
    }
    
    return () => clearInterval(interval);
  }, [isDesktop]);
  const [preRollCountdown, setPreRollCountdown] = useState<number | null>(null);
  const [sidebarScrollTop, setSidebarScrollTop] = useState(0);
  const [isHighlightingMissingSubtitles, setIsHighlightingMissingSubtitles] = useState(false);

  const handleStartRecordingMissing = useCallback(() => {
    setIsHighlightingMissingSubtitles(true);
    const stats = getSubtitleCoverageStats(project);
    if (stats.unrecordedLines.length > 0) {
      const firstUnrecorded = stats.unrecordedLines[0];
      const preroll = project?.audioSettings?.prerollSeconds ?? 2;
      const offset = project?.subtitlesOffset || 0;
      handleSeek(Math.max(0, firstUnrecorded.start + offset - preroll));
    }
  }, [project, handleSeek]);
  const [teleprompterFontSize, setTeleprompterFontSize] = useState(32);
  const [teleprompterLineHeight, setTeleprompterLineHeight] = useState(1.4);
  const [teleprompterPacing, setTeleprompterPacing] = useState<'auto' | 'manual'>('auto');

  useEffect(() => {
    if (project?.id && project.uiState) {
      if (project.uiState.zoomLevel !== undefined) setZoomLevel(project.uiState.zoomLevel);
      if (project.uiState.timelineHeight !== undefined) setTimelineHeight(project.uiState.timelineHeight);
      if (project.uiState.sidebarWidth !== undefined) setSidebarWidth(project.uiState.sidebarWidth);
      if (project.uiState.teleprompterMode !== undefined) setTeleprompterMode(project.uiState.teleprompterMode);
      if (project.uiState.teleprompterFontSize !== undefined) setTeleprompterFontSize(project.uiState.teleprompterFontSize);
      if (project.uiState.teleprompterLineHeight !== undefined) setTeleprompterLineHeight(project.uiState.teleprompterLineHeight);
      if (project.uiState.teleprompterPacing !== undefined) setTeleprompterPacing(project.uiState.teleprompterPacing);
      if (project.uiState.teleprompterPosition !== undefined) setTeleprompterPosition(project.uiState.teleprompterPosition);
      if (project.uiState.teleprompterSize !== undefined) setTeleprompterSize(project.uiState.teleprompterSize);
      if (project.uiState.showFixes !== undefined) setShowFixes(project.uiState.showFixes);
    }
  }, [project?.id]);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<Project | null>(null);

  useEffect(() => {
    if (!window.electronAPI) return;
    const unlisten = window.electronAPI.onMediaProgress((data) => {
      setExportProgress(data.percent);
      setExportOperation(data.operation || 'Processing...');
    });
    return () => unlisten();
  }, [setExportProgress, setExportOperation]);

  // Keep projectRef always up to date
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    // When switching projects, clear the buffer cache to save memory
    if (project?.id) {
       playbackEngine.clearCache();
    }
    if (project) {
      playbackEngine.setAudioOffset(project.audioOffsetMs || 0);
      playbackEngine.setPlayOriginalTrackSegments(!!project.audioSettings?.playOriginalTrackSegments);
      if (project.audioSettings?.outputDeviceId && project.audioSettings.outputDeviceId !== 'default') {
        playbackEngine.setOutputDevice(project.audioSettings.outputDeviceId);
      }
    }
  }, [project?.id, project?.audioOffsetMs, project?.audioSettings?.playOriginalTrackSegments, project?.audioSettings?.outputDeviceId]);

  useEffect(() => {
    return () => {
      playbackEngine.stop();
      playbackEngine.clearCache();
    };
  }, []);

  // Dynamic duration control for audio-only projects
  useEffect(() => {
    if (!project) {
      setDuration(0);
      return;
    }
    // If there is a video or reference audio, their metadata listeners will set the duration
    if (project.videoPath || project.videoUrl || project.referenceAudioPath) {
      return;
    }

    // Default duration for empty audio projects: 5 minutes (300 seconds)
    let maxTime = 300;
    
    project.tracks.forEach(track => {
      track.segments.forEach(seg => {
        const segEnd = (seg.startTime || 0) + (seg.duration || 0);
        if (segEnd > maxTime) {
          maxTime = segEnd;
        }
      });
    });

    if (project.subtitles) {
      project.subtitles.forEach(sub => {
        if (sub.end > maxTime) {
          maxTime = sub.end;
        }
      });
    }

    const finalDuration = maxTime > 300 ? maxTime + 15 : 300;
    setDuration(finalDuration);
  }, [project?.id, project?.tracks, project?.subtitles, project?.videoPath, project?.videoUrl, project?.referenceAudioPath, setDuration]);

  // Hydrator for missing waveforms (e.g. loaded from DB)
  useEffect(() => {
    if (!project || !window.electronAPI) return;

    // 1. Check Original Track
    const origTrack = project.tracks.find(t => t.name === 'Оригинал');
    if (origTrack && origTrack.segments.length > 0 && project.originalPeaks && project.originalPeaks.length > 0) {
      const seg = origTrack.segments[0];
      if (!seg.waveform || seg.waveform.length === 0) {
        console.log("[Hydrator] Restoring Original track waveform from project.originalPeaks...");
        setProject(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            tracks: (prev.tracks || []).map(t => {
              if (t.name === 'Оригинал') {
                return {
                  ...t,
                  segments: (t.segments || []).map(s => {
                     if (s.id === 'original-audio-seg' || !s.waveform || s.waveform.length === 0) {
                        return { ...s, waveform: Array.from(prev.originalPeaks!) };
                     }
                     return s;
                  })
                };
              }
              return t;
            })
          };
        });
      }
    }

    // 2. Check Dub Tracks
    let needsUpdate = false;
    const tracksToUpdate = [...project.tracks];

    for (let trackIndex = 0; trackIndex < tracksToUpdate.length; trackIndex++) {
        const track = tracksToUpdate[trackIndex];
        if (track.name === 'Оригинал') continue;

        let trackUpdated = false;
        const newSegments = [...track.segments];

        for (let i = 0; i < newSegments.length; i++) {
            const seg = newSegments[i];
            if (seg.filePath && (!seg.waveform || seg.waveform.length === 0) && !seg.isExtractingWaveform) {
                newSegments[i] = { ...seg, isExtractingWaveform: true };
                trackUpdated = true;
                needsUpdate = true;
                
                const segmentId = seg.id;
                const trackId = track.id;
                
                const pts = Math.max(1024, Math.floor((seg.fileDuration || seg.duration || 20) * 50));
                window.electronAPI.generateWaveformPeaks({ filePath: seg.filePath, points: pts })
                  .then(res => {
                      if (res.success && res.data) {
                          setProject(p => {
                              if (!p) return p;
                              return {
                                  ...p,
                                  tracks: (p.tracks).map(t => t.id === trackId ? {
                                      ...t,
                                      segments: (t.segments || []).map(s => s.id === segmentId ? { ...s, waveform: Array.from(res.data as any), isExtractingWaveform: false } : s)
                                  } : t)
                              };
                          });
                      } else {
                          setProject(p => p ? {
                              ...p,
                              tracks: (p.tracks).map(t => t.id === trackId ? {
                                  ...t,
                                  segments: (t.segments || []).map(s => s.id === segmentId ? { ...s, isExtractingWaveform: false } : s)
                              } : t)
                          } : p);
                      }
                  })
                  .catch(err => {
                      console.warn("Failed to generate waveform for", seg.filePath, err);
                      setProject(p => p ? {
                          ...p,
                          tracks: (p.tracks).map(t => t.id === trackId ? {
                              ...t,
                              segments: (t.segments || []).map(s => s.id === segmentId ? { ...s, isExtractingWaveform: false } : s)
                          } : t)
                      } : p);
                  });
            }
        }
        if (trackUpdated) {
            tracksToUpdate[trackIndex] = { ...track, segments: newSegments };
        }
    }

    if (needsUpdate) {
        setProject(p => p ? { ...p, tracks: tracksToUpdate } : p);
    }
  }, [project]);

  const createDefaultProject = useCallback((name: string, path?: string): Project => ({
    id: Math.random().toString(36).substr(2, 9),
    name,
    projectPath: path,
    subtitles: [],
    roles: [],
    tracks: [
      { id: 'track-1', name: 'Дорога 1', segments: [], volume: 1, isMuted: false }
    ],
    latencyOffset: 0,
    audioOffsetMs: 0,
    audioSettings: getGlobalAudioSettings()
  }), []);

  // Removed redundant auto-save effect that conflicted with the one at line 1719

  const handleNativeDrop = useCallback(async (paths: string[]) => {
    for (const path of paths) {
      const fileName = path.split(/[/\\]/).pop() || 'file';
      const fileExt = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
      const fileDir = path.replace(/\\/g, '/').substring(0, path.replace(/\\/g, '/').lastIndexOf('/'));

      const isVideo = ['.mp4', '.mkv', '.webm', '.mov', '.avi', '.hevc', '.h265', '.265', '.ts', '.m2ts'].includes(fileExt);
      const isAudio = ['.mp3', '.wav', '.flac', '.ogg', '.m4a'].includes(fileExt);

      const isProjectActive = !!project?.videoUrl || !!project?.projectPath;

      if (isAudio && isProjectActive && !project?.projectPath) {
        alert("Настройте или сохраните проект перед импортом аудио.");
        continue;
      }

      if (isAudio && isProjectActive && project?.projectPath && window.electronAPI) {
        // Handle audio drop on active project -> new track (Import Audio logic)
        try {
          setIsExporting(true);
          setExportOperation(`Импорт аудио: ${fileName}...`);
          
          const assetsDir = `${project.projectPath}/assets`.replace(/\\/g, '/');
          const copyRes = await window.electronAPI.copyFileToProject(path, assetsDir);
          const finalPath = copyRes.success && copyRes.data ? copyRes.data : path;
          
          let duration = 0;
          let peaks: number[] = [];
          
          const infoRes = await window.electronAPI.getFileInfo(finalPath);
          if (infoRes.success && infoRes.data) {
             duration = infoRes.data.duration || 0;
          }
          
          if (duration <= 0) {
              const fileUrl = getSafeFileUrl(finalPath);
              duration = await new Promise<number>((resolve) => {
                  const audioInfo = new Audio();
                  audioInfo.onloadedmetadata = () => resolve(audioInfo.duration);
                  audioInfo.onerror = () => resolve(1); 
                  audioInfo.src = fileUrl;
              });
          }
          
          const pts = Math.max(1024, Math.floor((duration || 20) * 50));
          const peaksRes = await window.electronAPI.generateWaveformPeaks({ filePath: finalPath, points: pts });
          if (peaksRes.success && peaksRes.data) {
             peaks = peaksRes.data;
          }
          
          if (duration === 0 && peaks.length > 0) {
             duration = peaks.length / 50.0;
          } else if (duration === 0) {
             duration = 1;
          }

          const newSegment: AudioSegment = {
             id: `drop-${Date.now()}-${Math.random().toString(36).substr(2,9)}`,
             startTime: currentTimeRef.current || 0,
             duration: duration,
             fileOffset: 0,
             fileDuration: duration,
             blobUrl: getSafeFileUrl(finalPath),
             filePath: finalPath,
             gain: 1,
             playbackRate: 1,
             waveform: peaks.length > 0 ? peaks : undefined,
             originalFileName: fileName
          };

          const newTrack: AudioTrack = {
             id: `track-drop-${Date.now()}`,
             name: fileName.replace(/\.[^/.]+$/, ""),
             volume: 1,
             isMuted: false,
             segments: [newSegment]
          };

          setProject(prev => {
             if (!prev) return prev;
             return {
                ...prev,
                tracks: [...prev.tracks, newTrack]
             };
          });
        } catch (e) {
          logger.error("Failed importing audio drop natively:", e);
        } finally {
          setIsExporting(false);
        }
      } else if (isVideo || isAudio) {
        // Handle video or standalone audio (Project initialization / original replace)
        let projectRoot = project?.projectPath;
        if (!projectRoot) {
           // Create a new project folder next to the video
           const baseName = fileName.replace(/\.[^/.]+$/, "");
           projectRoot = `${fileDir}/${baseName}_Project`.replace(/\\/g, '/');
        }

        if (window.electronAPI) {
          try {
            await window.electronAPI.initProject(projectRoot);
            
            // Copy to assets
            const assetsDir = `${projectRoot}/assets`.replace(/\\/g, '/');
            const copyRes = await window.electronAPI.copyFileToProject(path, assetsDir);
            const finalPath = copyRes.success && copyRes.data ? copyRes.data : path;

            setProject(prev => {
              const baseProject = prev || createDefaultProject(fileName.replace(/\.[^/.]+$/, ""), projectRoot);
              return { ...baseProject, videoUrl: getSafeFileUrl(finalPath), videoPath: finalPath, projectPath: projectRoot };
            });

            const takesDir = `${projectRoot}/takes`.replace(/\\/g, '/');
            const res = await window.electronAPI.extractAudioPeaks(finalPath, takesDir);
            if (res.success && res.data) {
                const audioData = res.data;
                const refPath = audioData.filePath || `${takesDir}/original_audio.wav`.replace(/\\/g, '/');
                
                setProject(p => {
                  if (!p) return p;
                  let updatedTracks = [...p.tracks];
                  if (!updatedTracks.find(t => t.name === 'Оригинал')) {
                    updatedTracks.unshift({
                      id: 'originals-track',
                      name: 'Оригинал',
                      volume: 1,
                      isMuted: false,
                      segments: []
                    });
                  }
                  const audioDuration = audioData.duration || (audioData.peaks.length / 50.0);
                  const extractedPeaks = Array.from(audioData.peaks);
                  
                  // LOG for debugging transcoding duration mismatch
                  console.log(`[Import] Project hydrator: Video path: ${finalPath}, Duration: ${audioDuration}s`);

                  return { 
                    ...p, 
                    originalPeaks: extractedPeaks,
                    audioOffsetMs: p.audioOffsetMs || 0, // Reset default to 0 for cleaner calibration
                    referenceAudioPath: refPath,
                    tracks: updatedTracks.map(t => {
                      if (t.name === 'Оригинал') {
                        return {
                          ...t,
                          segments: [{
                            id: 'original-audio-seg',
                            startTime: 0,
                            duration: audioDuration,
                            fileOffset: 0,
                            fileDuration: audioDuration,
                            blobUrl: getSafeFileUrl(refPath),
                            filePath: refPath,
                            gain: 1,
                            playbackRate: 1,
                            waveform: extractedPeaks
                          }]
                        };
                      }
                      return t;
                    })
                  };
                });
            }
          } catch (err) {
            console.error("Native drop video peaks error:", err);
          }
        }
      } else if (['.srt', '.ass', '.vtt', '.csv', '.fb2', '.txt', '.epub', '.docx', '.pdf'].includes(fileExt)) {
        // Handle subtitles
        if (window.electronAPI) {
            let contentToParse: string | ArrayBuffer;
            if (fileExt === '.epub' || fileExt === '.docx' || fileExt === '.pdf') {
                try {
                    // Try to read binary as we did in openSubtitles via fetch/Tauri
                    const arr = await (window as any).__TAURI_INVOKE__?.('read_binary_file', { path: path });
                    if (arr) {
                        contentToParse = new Uint8Array(arr).buffer;
                    } else {
                        // Fallback
                        const res = await window.electronAPI.readTextFile(path);
                        contentToParse = res.data || '';
                    }
                } catch (e) {
                    const res = await window.electronAPI.readTextFile(path);
                    contentToParse = res.data || '';
                }
            } else {
                const res = await window.electronAPI.readTextFile(path);
                contentToParse = res.data || '';
            }
            
            if (contentToParse) {
                const content = contentToParse;
                try {
                  const subtitles = await UniversalParserService.parse(content, fileName);
                  if (!subtitles || subtitles.length === 0) {
                    throw new Error("Файл пуст или имеет неверную структуру.");
                  }
                  const roles = Array.from(new Set(subtitles.map(s => s.role)));
                  
                  setProject(p => {
                    const base = p || createDefaultProject(fileName.split('.')[0]);
                    return {
                      ...base,
                      subtitles,
                      roles,
                      selectedRole: roles[0] || 'Default'
                    };
                  });
                } catch (parseErr) {
                  const msg = getFriendlySubtitleErrorMessage(parseErr, fileName);
                  alert(msg);
                }
            }
        }
      }
    }
  }, [setProject, createDefaultProject]);

  useEffect(() => {
    logger.info("Application mounted. Desktop API available:", !!window.electronAPI);
    
    // Add DevTools shortcut
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+I or F12
      if ((e.ctrlKey && e.shiftKey && e.code === 'KeyI') || e.code === 'F12') {
        if (window.electronAPI) {
          import('@tauri-apps/api/core').then(mod => {
             mod.invoke('open_devtools').catch(console.error);
          }).catch(console.error);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Listen for Tauri native file drop events to get full paths
    let unlisten: any;
    let isCancelled = false;
    if (isDesktop && window.electronAPI) {
      const setupDrop = async () => {
        try {
          const u = await getCurrentWindow().onDragDropEvent((event) => {
            if (isCancelled) return;
            if (event.payload.type === 'drop') {
              const paths = event.payload.paths;
              if (paths && paths.length > 0) {
                logger.info("Native drop detected:", paths);
                handleNativeDrop(paths);
              }
            }
          });
          if (isCancelled) {
            if (typeof u === 'function') u();
          } else {
            unlisten = u;
          }
        } catch (e) {
          logger.warn("Failed to listen for native drop events:", e);
        }
      };
      setupDrop();
    }

    return () => {
      isCancelled = true;
      logger.info("Application unmounting.");
      window.removeEventListener('keydown', handleKeyDown);
      if (typeof unlisten === 'function') unlisten();
      playbackEngine.stop();
    };
  }, [handleNativeDrop, isDesktop]);


  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const isProjectActive = !!project?.videoUrl || !!project?.projectPath;
    
    const mediaFiles = acceptedFiles.filter(f => f.type.startsWith('video/') || f.type.startsWith('audio/') || ['.mp4', '.mkv', '.webm', '.mov', '.avi', '.hevc', '.h265', '.265', '.ts', '.m2ts', '.mp3', '.wav', '.flac', '.ogg', '.m4a'].some(ext => f.name.toLowerCase().endsWith(ext)));
    const textFiles = acceptedFiles.filter(f => ['.ass', '.srt', '.vtt', '.csv', '.fb2', '.txt', '.epub', '.docx', '.pdf'].some(ext => f.name.toLowerCase().endsWith(ext)));

    const isAudioDropOnly = mediaFiles.length > 0 && mediaFiles.every(f => f.type.startsWith('audio/') || ['.mp3', '.wav', '.flac', '.ogg', '.m4a'].some(ext => f.name.toLowerCase().endsWith(ext)));

    if (isProjectActive && isAudioDropOnly && (!window.electronAPI || !project?.projectPath)) {
        alert("Настройте или сохраните проект перед импортом аудио.");
        return;
    }

    if (isProjectActive && mediaFiles.length > 0 && window.electronAPI && project?.projectPath) {
      // Add drops as a new track
      const newTrackId = `track-drop-${Date.now()}`;
      const newTrackName = mediaFiles[0].name.replace(/\.[^/.]+$/, "");
      
      let currentStartTime = currentTimeRef.current;
      const newSegments: AudioSegment[] = [];
      
      for (const file of mediaFiles) {
        const filePath = (file as any).path;
        const assetsDir = `${project.projectPath}/assets`.replace(/\\/g, '/');
        const copyRes = await window.electronAPI.copyFileToProject(filePath, assetsDir);
        const finalPath = copyRes.success && copyRes.data ? copyRes.data : filePath;
        
        let duration = 0;
        let peaks: number[] = [];
        
        const infoRes = await window.electronAPI.getFileInfo(finalPath);
        if (infoRes.success && infoRes.data) {
           duration = infoRes.data.duration || 0;
        }
        
        const pts = Math.max(1024, Math.floor((duration || 20) * 50));
        const peaksRes = await window.electronAPI.generateWaveformPeaks({ filePath: finalPath, points: pts });
        if (peaksRes.success && peaksRes.data) {
           peaks = peaksRes.data;
        }
        
        if (duration === 0 && peaks.length > 0) {
           duration = peaks.length / 50.0;
        } else if (duration === 0) {
           duration = 1;
        }

        newSegments.push({
           id: `drop-${Date.now()}-${Math.random().toString(36).substr(2,9)}`,
           startTime: currentStartTime,
           duration: duration,
           fileOffset: 0,
           fileDuration: duration,
           blobUrl: getSafeFileUrl(finalPath),
           filePath: finalPath,
           gain: 1,
           playbackRate: 1,
           waveform: peaks,
           originalFileName: file.name
        });
        
        currentStartTime += duration;
      }
      
      setProject(prev => {
        if (!prev) return prev;
        return {
           ...prev,
           tracks: [
              ...prev.tracks,
              {
                 id: newTrackId,
                 name: newTrackName,
                 volume: 1,
                 isMuted: false,
                 segments: newSegments
              }
           ]
        };
      });
    } else {
      // Logic for new project initialization
      for (const file of mediaFiles) {
        const filePath = (file as any).path;
        const fileDir = filePath ? filePath.replace(/\\/g, '/').substring(0, filePath.replace(/\\/g, '/').lastIndexOf('/')) : undefined;

        setVideoType(file.type);
        const url = URL.createObjectURL(file);
        
        let projectRoot = project?.projectPath;
        if (!projectRoot && fileDir) {
           const baseName = file.name.replace(/\.[^/.]+$/, "");
           projectRoot = `${fileDir}/${baseName}_Project`.replace(/\\/g, '/');
        }

        const isVideo = file.type.startsWith('video/') || ['.mp4', '.mkv', '.webm', '.mov', '.avi', '.hevc', '.h265', '.265', '.ts', '.m2ts'].some(ext => file.name.toLowerCase().endsWith(ext));
        setProject(prev => {
          const baseProject = prev || createDefaultProject(file.name.replace(/\.[^/.]+$/, ""), projectRoot);
          return { 
            ...baseProject, 
            videoUrl: url, 
            videoPath: filePath, 
            projectPath: projectRoot,
            audioSettings: {
              ...(baseProject.audioSettings || getGlobalAudioSettings()),
              playOriginalTrackSegments: !isVideo
            }
          };
        });
        
        if (window.electronAPI && filePath && projectRoot) {
            window.electronAPI.initProject(projectRoot).then(async () => {
              const assetsDir = `${projectRoot}/assets`.replace(/\\/g, '/');
              const copyRes = await window.electronAPI.copyFileToProject(filePath, assetsDir);
              const finalPath = copyRes.success && copyRes.data ? copyRes.data : filePath;

              const takesDir = `${projectRoot}/takes`.replace(/\\/g, '/');
              window.electronAPI.extractAudioPeaks(finalPath, takesDir).then(res => {
                if (res.success && res.data) {
                  const audioData = res.data;
                  const refPath = audioData.filePath || `${takesDir}/original_audio.wav`.replace(/\\/g, '/');
                  const extractedPeaks = Array.from(audioData.peaks);
                  const audioDuration = audioData.duration || (extractedPeaks.length / 50.0);

                  setProject(p => {
                    if (!p) return p;
                    let updatedTracks = [...p.tracks];
                    if (!updatedTracks.find(t => t.name === 'Оригинал')) {
                      updatedTracks.unshift({
                        id: 'originals-track',
                        name: 'Оригинал',
                        volume: 1,
                        isMuted: false,
                        segments: []
                      });
                    }
                  return { 
                    ...p, 
                    videoPath: finalPath,
                    videoUrl: getSafeFileUrl(finalPath),
                    audioOffsetMs: p.audioOffsetMs || 0,
                    originalPeaks: extractedPeaks,
                    referenceAudioPath: refPath,
                    audioSettings: {
                      ...(p.audioSettings || getGlobalAudioSettings()),
                      playOriginalTrackSegments: !isVideo
                    },
                    tracks: updatedTracks.map(t => {
                      if (t.name === 'Оригинал') {
                        return {
                          ...t,
                          segments: [{
                            id: 'original-audio-seg',
                            startTime: 0,
                            duration: audioDuration,
                            fileOffset: 0,
                            fileDuration: audioDuration,
                            blobUrl: getSafeFileUrl(refPath),
                            filePath: refPath,
                            gain: 1,
                            playbackRate: 1,
                            waveform: extractedPeaks
                          }]
                        };
                      }
                      return t;
                    })
                  };
                  });
                }
              }).catch(err => console.error("Drop video peaks error:", err));
            });
        } else if (!window.electronAPI) {
          WaveformService.generatePeaks(file, 20000)
            .then(peaks => {
              setProject(p => p ? { ...p, originalPeaks: peaks } : p);
            })
            .catch(err => {
              console.warn("Could not generate peaks locally inside browser:", err);
            });
        }
      }
    }

    for (const file of textFiles) {
      const fileDir = (file as any).path ? (file as any).path.replace(/\\/g, '/').substring(0, (file as any).path.replace(/\\/g, '/').lastIndexOf('/')) : undefined;
      let content: string | ArrayBuffer;
      if (file.name.toLowerCase().endsWith('.epub') || file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.pdf')) {
          content = await file.arrayBuffer();
      } else {
          content = await file.text();
      }
      
      try {
        const subtitles = await UniversalParserService.parse(content, file.name);
        if (!subtitles || subtitles.length === 0) {
          throw new Error("Файл пуст или имеет неверную структуру.");
        }
        const roles = Array.from(new Set(subtitles.map(s => s.role)));
        
        setProject(prev => {
          const baseProject = prev || createDefaultProject(file.name.replace(/\.[^/.]+$/, ""), fileDir);
          return {
            ...baseProject,
            subtitles,
            roles,
            selectedRole: roles[0] || 'Default'
          };
        });
      } catch (parseErr) {
        const msg = getFriendlySubtitleErrorMessage(parseErr, file.name);
        alert(msg);
      }
    }
  }, [project, currentTimeRef.current]);

  const { getRootProps, getInputProps, isDragActive: dropzoneActive } = useDropzone({ 
    onDrop,
    noClick: true,
    accept: {
      'video/*': ['.mp4', '.webm', '.mkv', '.mov', '.avi', '.hevc', '.h265', '.265', '.ts', '.m2ts'],
      'audio/*': ['.mp3', '.wav', '.flac', '.ogg', '.m4a'],
      'text/plain': ['.txt', '.csv', '.vtt'],
      'application/x-subrip': ['.srt'],
      'application/octet-stream': ['.ass', '.srt', '.fb2']
    }
  } as any);

  useEffect(() => {
    if (isDesktop && (window as any).electronAPI) {
      (window as any).electronAPI.requestPermissions().catch(err => {
        console.error('Failed to request media permissions:', err);
      });
    }
  }, [isDesktop]);

  // --- App Startup Check ---
  useEffect(() => {
    if (isDesktop && window.electronAPI) {
      window.electronAPI.checkCrashes().then(async (res) => {
        if (res.success && res.data && res.data.length > 0) {
          logger.info(`Found ${res.data.length} interrupted recordings. Attempting recovery...`);
          
          for (const recoveryInfo of res.data) {
            if (await safeConfirm(`Была обнаружена прерванная запись (${recoveryInfo.file_path}).\nВосстановить этот фрагмент на таймлайне?`)) {
              let durToUse = 20;
              if (window.electronAPI.getFileInfo) {
                const info = await window.electronAPI.getFileInfo(recoveryInfo.file_path);
                if (info.success && info.data) {
                  durToUse = info.data.duration || 20;
                }
              }

              const pts = Math.max(1024, Math.floor(durToUse * 50));
              const peaksRes = await window.electronAPI.generateWaveformPeaks({ 
                filePath: recoveryInfo.file_path, 
                points: pts 
              });
              
              const recoveredSegment: AudioSegment = {
                id: recoveryInfo.segment_id || Math.random().toString(36).substr(2, 9),
                startTime: recoveryInfo.start_time,
                duration: durToUse, // Updated 
                fileOffset: 0,
                fileDuration: durToUse,
                filePath: recoveryInfo.file_path,
                blobUrl: `asset://${recoveryInfo.file_path}`,
                waveform: peaksRes.success ? (peaksRes.data as any) : [],
                gain: 1,
                playbackRate: 1
              };

              setProject(prev => {
                if (!prev) return null;
                const updatedTracks = (prev.tracks || []).map(track => {
                  if (track.id === recoveryInfo.track_id || track.name === 'Dubs') {
                    return { ...track, segments: [...track.segments, recoveredSegment] };
                  }
                  return track;
                });
                return { ...prev, tracks: updatedTracks };
              });
            }
          }
        }
      }).catch(err => logger.error("Crash check failed:", err));
    }
  }, [setProject]);

  // --- Electron Handlers ---

  const handleSelectSubs = async () => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.openSubtitles();
    if (!res.success || !res.data) return;
    const subsData = res.data;
    
    let finalProjectRoot = project?.projectPath;
    if (!finalProjectRoot && subsData.path) {
      const isWin = subsData.path.includes('\\');
      const sep = isWin ? '\\' : '/';
      const lastSepIndex = subsData.path.lastIndexOf(sep);
      const fileDir = lastSepIndex !== -1 ? subsData.path.substring(0, lastSepIndex) : '';
      const nameWithoutExt = subsData.name.replace(/\.[^/.]+$/, "");
      finalProjectRoot = fileDir ? `${fileDir}${sep}${nameWithoutExt}_Project` : `${nameWithoutExt}_Project`;
      await window.electronAPI.initProject(finalProjectRoot);
    }

    setProject(prev => {
      const currentProject = prev || createDefaultProject(subsData.name.replace(/\.[^/.]+$/, ""), finalProjectRoot || "");
      return {
        ...currentProject,
        subtitles: subsData.parsed.subtitles,
        roles: subsData.parsed.roles,
        selectedRole: subsData.parsed.roles[0] || 'Default'
      };
    });
  };

  const handleSelectDocument = async () => {
    if (!window.electronAPI) return;
    logger.info("Opening Document Selection dialog...");
    const bridgeResponse = await window.electronAPI.openFile({
      title: 'Select Document',
      filters: [{ name: 'Documents', extensions: ['txt'] }]
    });
    if (!bridgeResponse.success || !bridgeResponse.data) {
      logger.info("Document selection cancelled.");
      return;
    }
    const fileData = bridgeResponse.data;
    logger.info(`Selected document: ${fileData.path}`);
    
    let finalProjectRoot = project?.projectPath;
    if (!finalProjectRoot && fileData.path) {
      const isWin = fileData.path.includes('\\');
      const sep = isWin ? '\\' : '/';
      const lastSepIndex = fileData.path.lastIndexOf(sep);
      const fileDir = lastSepIndex !== -1 ? fileData.path.substring(0, lastSepIndex) : '';
      const nameWithoutExt = fileData.name.replace(/\.[^/.]+$/, "");
      finalProjectRoot = fileDir ? `${fileDir}${sep}${nameWithoutExt}_Project` : `${nameWithoutExt}_Project`;
      await window.electronAPI.initProject(finalProjectRoot);
    }

    setProject(prev => {
      const currentProject = prev || createDefaultProject(fileData.name.replace(/\.[^/.]+$/, ""), finalProjectRoot || "");
      
      let updatedSubtitles = currentProject.subtitles;
      let updatedRoles = currentProject.roles;
      let selectedRole = currentProject.selectedRole;

      if (fileData.content) {
        const parsedSubtitles = TextImportService.parseRawText(fileData.content);
        if (parsedSubtitles.length > 0) {
          updatedSubtitles = parsedSubtitles;
          updatedRoles = Array.from(new Set(parsedSubtitles.map(s => s.role)));
          selectedRole = updatedRoles[0] || 'Default';
        }
      }

      return {
        ...currentProject,
        documentPath: fileData.path,
        documentContent: fileData.content,
        subtitles: updatedSubtitles,
        roles: updatedRoles,
        selectedRole: selectedRole
      };
    });
  };





  const handleSelectReferenceAudio = async () => {
    if (!window.electronAPI) return;
    logger.info("Opening Reference Audio Selection dialog...");
    const fileDataRes = await window.electronAPI.openFile({
      title: 'Select Reference Audio',
      filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }]
    });
    if (!fileDataRes.success || !fileDataRes.data) {
      logger.info("Reference Audio selection cancelled.");
      return;
    }
    const fileData = fileDataRes.data;
    logger.info(`Selected reference audio: ${fileData.path}`);
    
    let finalProjectRoot = project?.projectPath;
    if (!finalProjectRoot && fileData.path) {
      logger.info("No active project, auto-creating folder for reference audio...");
      const isWin = fileData.path.includes('\\');
      const sep = isWin ? '\\' : '/';
      const lastSepIndex = fileData.path.lastIndexOf(sep);
      const fileDir = lastSepIndex !== -1 ? fileData.path.substring(0, lastSepIndex) : '';
      const nameWithoutExt = fileData.name.replace(/\.[^/.]+$/, "");
      finalProjectRoot = fileDir ? `${fileDir}${sep}${nameWithoutExt}_Project` : `${nameWithoutExt}_Project`;
      logger.info(`Initializing project root at: ${finalProjectRoot}`);
      await window.electronAPI.initProject(finalProjectRoot);
    }
    
    const currentProject = project || createDefaultProject(fileData.name.replace(/\.[^/.]+$/, ""), finalProjectRoot || "");
    
    let videoPath = currentProject.videoPath;
    let videoUrl = currentProject.videoUrl;
    if (!videoPath && finalProjectRoot) {
      const blank = await ensureBlankVideoForProject(finalProjectRoot, 120);
      videoPath = blank.videoPath;
      videoUrl = blank.videoUrl;
    }

    setProject({
      ...currentProject,
      videoPath,
      videoUrl,
      referenceAudioPath: fileData.path,
      audioSettings: {
        ...(currentProject.audioSettings || getGlobalAudioSettings()),
        playOriginalTrackSegments: true
      }
    });
    logger.info("Reference audio loaded and project state updated.");
  };

  const handleBulkImport = async () => {
    if (!window.electronAPI) return;
    logger.info("Bulk Import: Requesting folder selection...");
    const folderPathRes = await window.electronAPI.openFolder();
    if (!folderPathRes.success || !folderPathRes.data) {
      logger.info("Bulk Import: Folder selection cancelled.");
      return;
    }
    const folderPath = folderPathRes.data;
    logger.info(`Bulk Import: Scanning folder ${folderPath}`);

    try {
      const { tracks, duration, subtitles } = await BulkImportService.importFolder(folderPath);
      logger.info(`Bulk Import Successful: Scanned ${tracks.length} tracks and ${subtitles.length} subtitles.`);

      let videoPath = project?.videoPath;
      let videoUrl = project?.videoUrl;
      if (!videoPath && folderPath) {
        const blank = await ensureBlankVideoForProject(folderPath, Math.max(duration, 60));
        videoPath = blank.videoPath;
        videoUrl = blank.videoUrl;
      }

      setProject(prev => {
        const baseProject = prev || {
          id: Math.random().toString(36).substr(2, 9),
          name: "Bulk Import Project",
          latencyOffset: 0,
          audioOffsetMs: 0,
          tracks: [],
          subtitles: [],
          roles: [],
          audioSettings: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
            bitDepth: 24,
            noiseGateThreshold: -40,
            compressorThreshold: -20,
            compressorRatio: 4,
            highPassFrequency: 80,
            isDestructive: false,
            backstageMode: 'parallel',
            playOriginalTrackSegments: true
          }
        } as Project;

        return {
          ...baseProject,
          videoPath: videoPath || baseProject.videoPath,
          videoUrl: videoUrl || baseProject.videoUrl,
          tracks: [...(baseProject.tracks), ...tracks],
          subtitles: [...(baseProject.subtitles || []), ...subtitles],
          roles: Array.from(new Set([...(baseProject.roles || []), "Original", "Dub"])),
          selectedRole: "Dub",
          projectPath: folderPath, // Use folder as project path for now
          audioSettings: {
            ...(baseProject.audioSettings || getGlobalAudioSettings()),
            playOriginalTrackSegments: true
          }
        };
      });
      setDuration(duration);
    } catch (error) {
      console.error("Bulk import failed:", error);
      alert("Bulk import failed. See console for details.");
    }
  };

  const handleGameDubbingImport = async () => {
    if (!window.electronAPI) return;
    
    logger.info("Game Dubbing Import: Starting folder selection for WAV files...");
    // 1. Choose folder of WAV files
    const folderPathRes = await window.electronAPI.openFolder();
    if (!folderPathRes.success || !folderPathRes.data) {
      logger.info("Game Dubbing Import: Folder selection cancelled.");
      return;
    }
    const folderPath = folderPathRes.data;
    logger.info(`Game Dubbing Import: Selected folder ${folderPath}`);

    // 2. Choose text document
    logger.info("Game Dubbing Import: Requesting translation file selection...");
    const fileRes = await window.electronAPI.openFile({
      title: 'Выберите текстовый файл перевода',
      filters: [{ name: 'Text', extensions: ['txt'] }]
    });
    if (!fileRes.success || !fileRes.data) {
      logger.info("Game Dubbing Import: Translation file selection cancelled.");
      return;
    }
    const fileData = fileRes.data;
    logger.info(`Game Dubbing Import: Selected translation file ${fileData.path}`);
    if (!fileData.content) {
      logger.warn("Game Dubbing Import: Translation file is empty.");
      alert("Выбранный файл перевода пуст.");
      return;
    }

    try {
      logger.info("Game Dubbing Import: Processing data via BulkImportService...");
      const { tracks, duration, subtitles } = await BulkImportService.importGameDubbing(folderPath, fileData.content);
      logger.info(`Game Dubbing Import Successful: Found ${tracks.length} tracks.`);
      // Auto-generate a blank master video of the exact project duration to neutralize non-video playback limits
      const blankVideoName = "blank_master_video.mp4";
      const blankVideoPath = `${folderPath}/${blankVideoName}`.replace(/\\/g, '/');
      
      try {
        const videoRes = await window.electronAPI.createBlankVideo(duration, blankVideoPath);
        if (!videoRes.success) {
          console.warn("Failed to create blank video file:", videoRes.error);
        }
      } catch (err) {
        console.warn("Error creating blank video file:", err);
      }

      setProject(prev => {
        const baseProject = prev || {
          id: Math.random().toString(36).substr(2, 9),
          name: "Game Dubbing Project",
          latencyOffset: 0,
          audioOffsetMs: 0,
          tracks: [],
          subtitles: [],
          roles: [],
          audioSettings: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
            bitDepth: 24,
            noiseGateThreshold: -40,
            compressorThreshold: -20,
            compressorRatio: 4,
            highPassFrequency: 80,
            isDestructive: false,
            backstageMode: 'parallel',
            playOriginalTrackSegments: true
          }
        } as Project;

        return {
          ...baseProject,
          tracks: [...(baseProject.tracks), ...tracks],
          subtitles: [...(baseProject.subtitles || []), ...subtitles],
          roles: Array.from(new Set([...(baseProject.roles || []), "Original", "Dub"])),
          selectedRole: "Dub",
          projectPath: folderPath,
          videoPath: blankVideoName,
          videoUrl: undefined,
          audioSettings: {
            ...(baseProject.audioSettings || getGlobalAudioSettings()),
            playOriginalTrackSegments: true
          }
        };
      });
      setDuration(duration);
      alert("Проект игровой озвучки успешно импортирован с автогенерацией пустого видеофайла!");
    } catch (error) {
      console.error("Game dubbing import failed:", error);
      alert("Ошибка при импорте игровой озвучки: " + (error instanceof Error ? error.message : String(error)));
    }
  };









  const handleQuickImport = () => {
    if (!project) return;
    const parsedSegments = TextImportService.parseRawText(quickImportText, quickImportDuration * 1000);
    const uniqueRoles = Array.from(new Set(parsedSegments.map(s => s.role)));
    if (uniqueRoles.length === 0) uniqueRoles.push('Default');
    
    setProject({
      ...project,
      subtitles: parsedSegments,
      roles: uniqueRoles,
      selectedRole: uniqueRoles[0]
    });
    setShowQuickImport(false);
    setQuickImportText('');
  };

  useEffect(() => {
    // Prevent default browser reload shortcuts which would close the project
    const handleBeforeReload = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyR' || e.key.toLowerCase() === 'r')) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (e.code === 'F5') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handleBeforeReload, { capture: true });
    return () => window.removeEventListener('keydown', handleBeforeReload, { capture: true });
  }, []);

  useEffect(() => {
    if (typeof project?.projectPath === 'string' && project.projectPath.endsWith('.dubstudio')) {
      const parentDir = project.projectPath.substring(0, Math.max(project.projectPath.lastIndexOf('/'), project.projectPath.lastIndexOf('\\')));
      console.log(`[Auto-Fix] Repairing projectPath: ${project.projectPath} -> ${parentDir}`);
      setProject({ ...project, projectPath: parentDir });
    }
  }, [project?.projectPath]);

  useEffect(() => {
    if (!project || !window.electronAPI) return;

    let hasUpdates = false;
    const promises = project.tracks.flatMap(track => 
      track.segments.filter(seg => !seg.waveform && seg.filePath).map(async seg => {
        try {
          const pts = Math.max(1024, Math.floor((seg.fileDuration || seg.duration || 20) * 50));
          const res = await window.electronAPI.generateWaveformPeaks({ filePath: seg.filePath!, points: pts });
          if (res.success && res.data) {
            return { trackId: track.id, segId: seg.id, waveform: res.data };
          }
        } catch (e) {
          console.warn(`Failed to generate peaks for missing waveform: ${seg.filePath}`, e);
        }
        return null; // or empty waveform?
      })
    );
    
    if (promises.length > 0) {
      Promise.all(promises).then(results => {
        const validUpdates = results.filter(Boolean) as { trackId: string, segId: string, waveform: number[] }[];
        if (validUpdates.length > 0) {
          setProject(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              tracks: (prev.tracks || []).map(track => {
                const updatesForTrack = validUpdates.filter(u => u.trackId === track.id);
                if (updatesForTrack.length === 0) return track;
                return {
                  ...track,
                  segments: (track.segments || []).map(seg => {
                    const update = updatesForTrack.find(u => u.segId === seg.id);
                    if (update) {
                      return { ...seg, waveform: update.waveform };
                    }
                    return seg;
                  })
                };
              })
            };
          });
        }
      });
    }
  }, [project?.id, (project?.tracks || []).map(t => (t.segments || []).length).join(',')]);

  const lastSavedProjectStateRef = useRef<string>("");

  useEffect(() => {
    if (project) {
        if (project.audioSettings) {
          localStorage.setItem('dubstudio_global_audio_settings', JSON.stringify(project.audioSettings));
        }

        // Debounce auto-save to disk/db to avoid high frequency I/O (e.g. during dragging)
        const saveTimer = setTimeout(() => {
          if (window.electronAPI && project.projectPath) {
            const projectToSave = { ...project };
            delete projectToSave.audioSettings;
            const currentHash = JSON.stringify(projectToSave);
            
            if (currentHash === lastSavedProjectStateRef.current) {
              return; // Skip writing to disk if no project data actually changed
            }
            
            logger.debug(`Auto-saving project: ${project.name} at ${project.projectPath}`);
            lastSavedProjectStateRef.current = currentHash;
            window.electronAPI.saveProjectJson({
              projectPath: project.projectPath,
              projectData: projectToSave
            })
            .then(() => {
                logger.debug(`Auto-save completed for project: ${project.name}`);
            })
            .catch(err => {
                logger.error(`Auto-save failed: ${err}`);
            });
          }
        }, 1500); // 1.5s delay for stability

        return () => clearTimeout(saveTimer);
    }
  }, [project]);

  // Subtitle File Handling
  const handleSubtitleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      let parsed: ParsedSubtitles;
      
      if (file.name.endsWith('.ass')) {
        parsed = SubtitleService.parseASS(content);
      } else if (file.name.endsWith('.srt')) {
        parsed = SubtitleService.parseSRT(content);
      } else {
        alert("Unsupported subtitle format. Please use .ass or .srt");
        return;
      }

      if (!parsed || !parsed.subtitles || parsed.subtitles.length === 0) {
        throw new Error("Файл не содержит реплик или формат не распознан.");
      }

      setProject(prev => {
        const baseProject = prev || createDefaultProject(file.name.replace(/\.[^/.]+$/, ""));

        return {
          ...baseProject,
          subtitles: parsed.subtitles,
          roles: parsed.roles,
          selectedRole: parsed.roles[0] || 'Default'
        };
      });
    } catch (parseErr) {
      const msg = getFriendlySubtitleErrorMessage(parseErr, file.name);
      alert(msg);
    }
  };

  const triggerVideoPicker = async () => {
    if (isDesktop && (window as any).electronAPI) {
      const res = await (window as any).electronAPI.openVideo();
      if (res.success && res.data) {
        // Simulate a file object with path
        const fakeFile = {
          name: res.data.name,
          path: res.data.path,
          type: 'video/mp4', // basic assumption
          size: res.data.size
        } as any;
        onDrop([fakeFile]);
      }
    } else {
      document.getElementById('video-input')?.click();
    }
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    logger.info(`Loading video file via upload: ${file.name}`);

    if (!file.type.startsWith('video/')) {
      logger.warn(`Invalid video file type: ${file.type}`);
      setVideoError("Please select a valid video file (e.g., .mp4, .mkv, .hevc, .webm).");
      return;
    }

    setVideoType(file.type);
    const url = URL.createObjectURL(file);
    
    setProject(prev => {
      const baseProject = prev || createDefaultProject(file.name.replace(/\.[^/.]+$/, ""));

      return {
        ...baseProject,
        videoUrl: url
      };
    });
  };

  // Revoke blob URLs to prevent memory leaks
  useEffect(() => {
    const currentUrl = project?.videoUrl;
    return () => {
      if (currentUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [project?.videoUrl]);

  useEffect(() => {
    let activeStream: MediaStream | null = null;
    let isCancelled = false;
    let mockCleanup: (() => void) | null = null;

    const createMockWebcamStream = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');
      let animationId = 0;
      
      const draw = () => {
        if (!ctx) return;
        
        const gradient = ctx.createRadialGradient(320, 180, 50, 320, 180, 300);
        gradient.addColorStop(0, '#1e1b4b'); 
        gradient.addColorStop(1, '#090514'); 
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 640, 360);
        
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.08)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 640; i += 40) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i, 360);
          ctx.stroke();
        }
        for (let j = 0; j < 360; j += 40) {
          ctx.beginPath();
          ctx.moveTo(0, j);
          ctx.lineTo(640, j);
          ctx.stroke();
        }
        
        const time = Date.now() * 0.0025;
        const pulse = Math.sin(time) * 8 + 70;
        
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(320, 150, pulse, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.beginPath();
        ctx.arc(320, 140, 32, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(320, 230, 60, 40, 0, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
        ctx.beginPath();
        ctx.arc(320, 140, 4, 0, Math.PI * 2);
        ctx.fill();
        
        const blink = Math.floor(Date.now() / 500) % 2 === 0;
        ctx.fillStyle = blink ? '#ef4444' : '#7f1d1d';
        ctx.beginPath();
        ctx.arc(40, 40, 5, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('LIVE (SIMULATED)', 53, 43);
        
        ctx.fillStyle = '#818cf8';
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('[ ДЕМО-РЕЖИМ ВЕБ-КАМЕРЫ ]', 320, 290);
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.font = '10px sans-serif';
        ctx.fillText('Доступ к оборудованию заблокирован либо ограничен', 320, 312);
        ctx.fillText('Используется виртуальный поток для тестирования записи', 320, 328);
        
        animationId = requestAnimationFrame(draw);
      };
      
      draw();
      
      const stream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : null;
      return {
        stream: stream || new MediaStream(),
        cleanup: () => cancelAnimationFrame(animationId)
      };
    };

    if (showWebcam || project?.audioSettings?.isBackstageEnabled) {
      const targetWidth = project?.audioSettings?.webcamResolutionX || 1920;
      const targetHeight = project?.audioSettings?.webcamResolutionY || 1080;
      
      const constraints: MediaStreamConstraints = { 
        video: project?.audioSettings?.webcamDeviceId 
          ? { 
              deviceId: { ideal: project.audioSettings.webcamDeviceId },
              width: { ideal: targetWidth },
              height: { ideal: targetHeight },
              frameRate: { ideal: 30 }
            } 
          : { 
              width: { ideal: targetWidth },
              height: { ideal: targetHeight },
              frameRate: { ideal: 30 }
            },
        audio: false
      };
      
      console.log(`[Webcam] Attempting to start webcam. Backstage: ${project?.audioSettings?.isBackstageEnabled}, Source constraints:`, constraints);

      const startWebcam = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (isCancelled) {
            stream.getTracks().forEach(t => t.stop());
            return;
          }

          console.log(`[Webcam] Webcam stream acquired. Video tracks:`, stream.getVideoTracks().map(t => t.label));
          activeStream = stream;
          setIsWebcamSimulated(false);
          setPreviewStream(stream);
          if (webcamRef.current) {
            webcamRef.current.srcObject = stream;
            webcamRef.current.onloadedmetadata = () => {
              if (isCancelled) return;
              console.log(`[Webcam] Video metadata loaded. Resolution: ${webcamRef.current?.videoWidth}x${webcamRef.current?.videoHeight}`);
            };
            try {
              await webcamRef.current.play();
            } catch (e: any) {
              if (e.name !== 'AbortError') {
                console.error("[Webcam] Play failed:", e);
              }
            }
          }
        } catch (err) {
          if (isCancelled) return;
          console.warn("[Webcam] Primary webcam access failed, trying fallback:", err);
          try {
            const fallbackStream = await navigator.mediaDevices.getUserMedia({ 
              video: true,
              audio: false
            });
            if (isCancelled) {
              fallbackStream.getTracks().forEach(t => t.stop());
              return;
            }
            activeStream = fallbackStream;
            setIsWebcamSimulated(false);
            setPreviewStream(fallbackStream);
            if (webcamRef.current) {
              webcamRef.current.srcObject = fallbackStream;
              try {
                await webcamRef.current.play();
              } catch (e: any) {
                if (e.name !== 'AbortError') {
                  console.error("[Webcam] Fallback play failed:", e);
                }
              }
            }
          } catch (fallbackErr) {
            if (isCancelled) return;
            console.error("[Webcam] Webcam access completely failed:", fallbackErr);
            
            // Fallback to custom simulated stream
            console.log("[Webcam] Starting simulated webcam stream fallback.");
            try {
              const mock = createMockWebcamStream();
              activeStream = mock.stream;
              mockCleanup = mock.cleanup;
              setIsWebcamSimulated(true);
              setPreviewStream(mock.stream);
              if (webcamRef.current) {
                webcamRef.current.srcObject = mock.stream;
                try {
                  await webcamRef.current.play();
                } catch (e: any) {
                  if (e.name !== 'AbortError') {
                    console.error("[Webcam] Simulated webcam play failed:", e);
                  }
                }
              }
            } catch (simErr) {
              console.error("[Webcam] Simulated webcam generation failed:", simErr);
            }
          }
        }
      };

      startWebcam();
    }

    return () => {
      isCancelled = true;
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
      if (mockCleanup) {
        mockCleanup();
      }
      setIsWebcamSimulated(false);
      setPreviewStream(null);
      if (webcamRef.current) {
        webcamRef.current.srcObject = null;
      }
    };
  }, [showWebcam, project?.audioSettings?.isBackstageEnabled, project?.audioSettings?.webcamDeviceId]);

  const [clipboardSegments, setClipboardSegments] = useState<any[]>([]);

  const handleCopySegments = () => {
      if (!project || selectedSegmentIds.length === 0) return;
      const copied: any[] = [];
      project.tracks.forEach(track => {
        track.segments.forEach(seg => {
          if (selectedSegmentIds.includes(seg.id)) {
            copied.push({
              trackId: track.id,
              segment: { ...seg }
            });
          }
        });
      });
      setClipboardSegments(copied);
  };

  const handleCutSegments = () => {
      handleCopySegments();
      deleteSegments();
  };

  const handlePasteSegments = () => {
      if (!project || clipboardSegments.length === 0) return;
      saveSnapshot();

      const minStartTime = Math.min(...clipboardSegments.map(c => c.segment.startTime));
      const pasteTime = currentTimeRef.current;
      const timeOffset = pasteTime - minStartTime;

      const newSegmentsMap = new Map<string, any[]>();
      const newSelectedIds: string[] = [];

      clipboardSegments.forEach(c => {
        const newSeg = {
          ...c.segment,
          id: "seg_" + crypto.randomUUID(),
          startTime: c.segment.startTime + timeOffset
        };
        
        let targetTrackId = c.trackId;
        const armedTrack = project.tracks.find(t => t.isArmed);
        if (armedTrack && clipboardSegments.length === 1) {
            targetTrackId = armedTrack.id;
        } else if (!project.tracks.some(t => t.id === targetTrackId)) {
            targetTrackId = project.tracks[0]?.id;
        }

        if (targetTrackId) {
            if (!newSegmentsMap.has(targetTrackId)) newSegmentsMap.set(targetTrackId, []);
            newSegmentsMap.get(targetTrackId)!.push(newSeg);
            newSelectedIds.push(newSeg.id);
        }
      });

      if (newSegmentsMap.size === 0) return;

      const updatedTracks = (project.tracks || []).map(t => {
        if (newSegmentsMap.has(t.id)) {
          return {
            ...t,
            segments: [...t.segments, ...(newSegmentsMap.get(t.id) || [])].sort((a, b) => a.startTime - b.startTime)
          };
        }
        return t;
      });

      setProject({ ...project, tracks: updatedTracks });
      setSelectedSegmentIds(newSelectedIds);
  };


  useTimelineHotkeys({
    projectRef,
    selectedSegmentIds,
    currentTimeRef,
    isRecordingRef,
    isStartingRecordingRef,
    togglePlay,
    stopRecording,
    discardRecording,
    handleSplitSegment: handleSplit,
    handleSeek,
    addMarker,
    deleteSegments,
    handleToggleRecord,
    handleDeleteLastTake,
    handleJoinSegments,
    handleCopySegments,
    handleCutSegments,
    handlePasteSegments,
    onUndo: undo,
    onRedo: redo
  });

  useEffect(() => {
    const updateAutoHeight = () => {
      if (isAutoHeight && project) {
        // Base height: 
        // Transport (56px) + DAW Bar (56px) + Minimap (48px) + Ruler (40px) + Add Track button (40px) + padding/buffer (20px) = ~260px
        let totalTimelinePx = 260;
        project.tracks.forEach(t => {
          totalTimelinePx += t.height || 80;
        });
        const vh = (totalTimelinePx / window.innerHeight) * 100;
        setTimelineHeight(Math.max(15, Math.min(vh, 80)));
      }
    };

    updateAutoHeight();
    window.addEventListener('resize', updateAutoHeight);
    return () => window.removeEventListener('resize', updateAutoHeight);
  }, [project?.tracks, isAutoHeight, setTimelineHeight]);

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isCastingModalOpen, setIsCastingModalOpen] = useState(false);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [pendingExportFormat, setPendingExportFormat] = useState<'WAV' | 'MP3' | 'FLAC'>('WAV');

  const handleUpdateDubberNick = (nick: string) => {
    localStorage.setItem('dubstudio_dubber_nick', nick);
    setProject(prev => prev ? { ...prev, dubberNick: nick } : prev);
  };

  const handleImportDocumentData = async (data: {
    filePath?: string;
    fileName?: string;
    fileContent?: string;
    subtitles: SubtitleLine[];
    defaultRole: string;
  }) => {
    let finalProjectRoot = project?.projectPath;
    const baseName = data.fileName ? data.fileName.replace(/\.[^/.]+$/, "") : "Document_Project";
    if (!finalProjectRoot) {
      finalProjectRoot = `${baseName}_Project`;
      if (window.electronAPI) {
        await window.electronAPI.initProject(finalProjectRoot);
      }
    }

    const roles = Array.from(new Set(data.subtitles.map(s => s.role)));
    const maxEnd = data.subtitles.length > 0 ? Math.max(...data.subtitles.map(s => s.end)) : 60;

    let videoPath = project?.videoPath || '';
    let videoUrl = project?.videoUrl || '';

    if (!videoPath && finalProjectRoot) {
      const blank = await ensureBlankVideoForProject(finalProjectRoot, Math.max(maxEnd, 60));
      videoPath = blank.videoPath;
      videoUrl = blank.videoUrl;
    }

    setProject(prev => {
      const currentProject = prev || createDefaultProject(baseName, finalProjectRoot || "");
      return {
        ...currentProject,
        videoPath,
        videoUrl,
        subtitles: data.subtitles,
        roles: roles.length > 0 ? roles : [data.defaultRole || 'Narrator'],
        selectedRole: roles[0] || data.defaultRole || 'Narrator',
        documentPath: data.filePath,
        documentContent: data.fileContent
      };
    });
  };

  const handleImportCasting = async (data: {
    mediaPath?: string;
    mediaFile?: File;
    textSourceType: 'subtitles_file' | 'text_file' | 'clipboard' | 'none';
    textFilePath?: string;
    textFileContent?: string;
    clipboardText?: string;
    dubberNick?: string;
    roleName?: string;
  }) => {
    if (data.dubberNick) {
      localStorage.setItem('dubstudio_dubber_nick', data.dubberNick);
    }

    let parsedSubtitles: SubtitleLine[] = [];
    const roleName = data.roleName || 'Кастинг';

    if (data.textSourceType === 'subtitles_file' || data.textSourceType === 'text_file') {
      if (data.textFileContent && data.textFilePath) {
        parsedSubtitles = await UniversalParserService.parse(data.textFileContent, data.textFilePath);
      }
    } else if (data.textSourceType === 'clipboard' && data.clipboardText) {
      parsedSubtitles = TextImportService.parseRawText(data.clipboardText);
    }

    let mediaPath = data.mediaPath || '';
    let mediaName = mediaPath ? (mediaPath.split(/[/\\]/).pop() || 'Casting_Media') : 'Casting_Media';
    let baseName = mediaName.substring(0, mediaName.lastIndexOf('.')) || mediaName;

    const isWin = mediaPath.includes('\\') || (data.textFilePath ? data.textFilePath.includes('\\') : false);
    const sep = isWin ? '\\' : '/';
    const sourcePath = mediaPath || data.textFilePath || '';
    const lastSep = sourcePath.lastIndexOf(sep);
    const fileDir = lastSep !== -1 ? sourcePath.substring(0, lastSep) : '';
    const projPath = project?.projectPath || (fileDir ? `${fileDir}${sep}${baseName}_Project` : `${baseName}_Project`);

    if (window.electronAPI && typeof window.electronAPI.initProject === 'function') {
      await window.electronAPI.initProject(projPath);
    }

    const ext = mediaPath.split('.').pop()?.toLowerCase() || '';
    const isAudio = ['wav', 'mp3', 'flac', 'm4a', 'aac', 'ogg', 'wma'].includes(ext);

    let mediaDuration = 60;
    if (mediaPath && window.electronAPI) {
      try {
        const infoRes = await window.electronAPI.getFileInfo(mediaPath);
        if (infoRes.success && infoRes.data?.duration) {
          mediaDuration = infoRes.data.duration;
        }
      } catch (e) {
        console.warn('Could not get casting media duration:', e);
      }
    }

    let finalVideoPath = mediaPath;
    let finalVideoUrl = mediaPath ? getSafeFileUrl(mediaPath) : '';

    if (!mediaPath || isAudio) {
      const blank = await ensureBlankVideoForProject(projPath, Math.max(mediaDuration, 60));
      finalVideoPath = blank.videoPath;
      finalVideoUrl = blank.videoUrl;
    }

    const dubTrack: AudioTrack = {
      id: 'track-dubs',
      name: 'Dubs',
      volume: 1.0,
      isMuted: false,
      isSolo: false,
      segments: []
    };

    const tracks: AudioTrack[] = [];

    // If media is audio, add an original reference segment and waveform
    if (isAudio && mediaPath) {
      let waveform: number[] | undefined;
      try {
        const pts = Math.max(1000, Math.floor(mediaDuration * 50));
        const peaksRes = await window.electronAPI?.generateWaveformPeaks({ filePath: mediaPath, points: pts });
        if (peaksRes?.success && peaksRes.data) {
          waveform = peaksRes.data;
        }
      } catch (e) {
        console.warn('Could not generate casting waveform:', e);
      }

      const refSegment: AudioSegment = {
        id: `seg-ref-${Date.now()}`,
        startTime: 0,
        duration: mediaDuration,
        filePath: mediaPath,
        blobUrl: getSafeFileUrl(mediaPath),
        fileOffset: 0,
        fileDuration: mediaDuration,
        gain: 1.0,
        playbackRate: 1.0,
        text: mediaName,
        waveform
      };

      tracks.push({
        id: 'track-original',
        name: 'Оригинал',
        volume: 1.0,
        isMuted: false,
        isSolo: false,
        segments: [refSegment]
      });
    }

    tracks.push(dubTrack);

    const maxSubEnd = parsedSubtitles.length > 0 
      ? Math.max(...parsedSubtitles.map(s => s.end))
      : mediaDuration;
    const finalDuration = Math.max(mediaDuration, maxSubEnd, 10);

    const newProject: Project = {
      id: `casting-${Date.now()}`,
      name: `Casting_${baseName}`,
      videoPath: finalVideoPath,
      videoUrl: finalVideoUrl,
      referenceAudioPath: isAudio ? mediaPath : undefined,
      projectPath: projPath,
      subtitles: parsedSubtitles.length > 0 ? parsedSubtitles : [
        {
          id: `sub-${Date.now()}`,
          start: 0,
          end: Math.min(10, finalDuration),
          text: `[${roleName}] Текст реплики для кастинга...`,
          role: roleName
        }
      ],
      roles: [roleName],
      selectedRole: roleName,
      selectedRoles: [roleName],
      dubberNick: data.dubberNick || localStorage.getItem('dubstudio_dubber_nick') || '',
      tracks,
      latencyOffset: project?.latencyOffset || 0,
      audioOffsetMs: project?.audioOffsetMs || 0,
      audioSettings: {
        ...(project?.audioSettings || getGlobalAudioSettings()),
        playOriginalTrackSegments: true
      }
    };

    setDuration(finalDuration);
    setProject(newProject);
    logger.info(`Casting session initialized successfully: ${newProject.name}, duration: ${finalDuration}s`);
  };

  const {
    handleBatchExport,
    handleExportAudioBook,
    handleExportStems,
    handleExportAllStemsZip,
    handleExport,
    handleMuxVideo,
    handleMergeBackstage,
    handleSaveBlooper,
    handleQuickPreview
  } = useAppExport(project, setIsExporting, setExportProgress, setExportOperation, setIsExportModalOpen, isRecording, selectedSegmentIds);

  const handleImportAudioTrack = async () => {
    logger.info("handleImportAudioTrack: Start");

    if (!window.electronAPI) {
      logger.error("handleImportAudioTrack: window.electronAPI is missing.");
      return;
    }

    logger.info("handleImportAudioTrack: Opening file dialog...");
    const res = await window.electronAPI.openFile({
      title: 'Выберите аудиофайл для импорта',
      filters: [
        { name: 'Audio Files', extensions: ['wav', 'mp3', 'flac', 'm4a', 'aac', 'ogg', 'wma'] }
      ]
    });

    logger.info(`handleImportAudioTrack: openFile response success=${res.success}, hasData=${!!res.data}`);
    
    if (!res.success || !res.data) {
      logger.info("handleImportAudioTrack: User cancelled or selection failed.");
      return;
    }

    // Handle both { path: '...' } and '...' (if it returns path directly)
    const filePath = typeof res.data === 'string' ? res.data : res.data.path;
    const fileName = (typeof res.data === 'object' ? res.data.name : null) || filePath?.split(/[/\\]/).pop() || 'Imported Track';

    if (!filePath) {
      logger.error("handleImportAudioTrack: Could not determine file path from response.", res.data);
      return;
    }

    logger.info(`handleImportAudioTrack: Proceeding with filePath=${filePath}`);

    setIsExporting(true);
    setExportOperation("Importing audio...");

    try {
      logger.info(`Starting Import Audio Track: ${filePath}`);
      const baseName = fileName.replace(/\.[^/.]+$/, "");
      const isWin = filePath.includes('\\');
      const sep = isWin ? '\\' : '/';
      const lastSepIndex = filePath.lastIndexOf(sep);
      const fileDir = lastSepIndex !== -1 ? filePath.substring(0, lastSepIndex) : '';

      let currentProject = project;
      let finalProjectRoot = currentProject?.projectPath;

      if (!finalProjectRoot) {
        finalProjectRoot = fileDir ? `${fileDir}${sep}${baseName}_Project` : `${baseName}_Project`;
        logger.info(`Auto-initializing project root for imported audio at: ${finalProjectRoot}`);
        if (window.electronAPI && typeof window.electronAPI.initProject === 'function') {
          await window.electronAPI.initProject(finalProjectRoot);
        }
        currentProject = createDefaultProject(baseName, finalProjectRoot);
      }

      // Get duration
      let duration = 0;
      const infoRes = await window.electronAPI.getFileInfo(filePath);
      if (infoRes.success && infoRes.data?.duration) {
        duration = infoRes.data.duration;
      }
      
      if (!duration || duration <= 0) {
          logger.info(`Duration not provided by backend, falling back to HTMLAudioElement for ${filePath}`);
          const fileUrl = getSafeFileUrl(filePath);
          duration = await new Promise<number>((resolve) => {
              const audioInfo = new Audio();
              audioInfo.onloadedmetadata = () => {
                  resolve(audioInfo.duration);
              };
              audioInfo.onerror = (e) => {
                  logger.error(`Failed to load audio metadata for ${filePath}`, e);
                  resolve(0);
              };
              audioInfo.src = fileUrl || '';
          });
      }
      
      if (!duration || duration <= 0) {
          duration = 60; // Safe fallback
      }

      logger.info(`Imported file info: duration=${duration}s`);

      // Generate waveform peaks
      let waveform: number[] | undefined;
      try {
        logger.info(`Generating waveform for: ${filePath}`);
        const pts = Math.max(1000, Math.floor(duration * 50));
        const peaksRes = await window.electronAPI.generateWaveformPeaks({ filePath, points: pts });
        if (peaksRes.success && peaksRes.data) {
          waveform = peaksRes.data;
          logger.info(`Waveform generated successfully: ${waveform.length} points`);
        } else {
          logger.warn(`Waveform extraction failed: ${peaksRes.error || "Unknown error"}`);
        }
      } catch (e) {
        logger.warn(`Non-critical: Could not generate waveform for ${filePath}: ${e}`);
      }

      // Create new segment
      const newSegment: AudioSegment = {
        id: Math.random().toString(36).substr(2, 9),
        startTime: 0,
        duration: duration,
        filePath: filePath,
        blobUrl: getSafeFileUrl(filePath),
        fileOffset: 0,
        fileDuration: duration,
        gain: 1.0,
        playbackRate: 1.0,
        text: fileName,
        waveform
      };

      // Create new track
      const newTrack: AudioTrack = {
        id: Math.random().toString(36).substr(2, 9),
        name: fileName,
        segments: [newSegment],
        volume: 1.0,
        isMuted: false,
        isSolo: false
      };

      // Ensure blank video if project has no videoPath
      let videoPath = currentProject.videoPath;
      let videoUrl = currentProject.videoUrl;
      if (!videoPath && finalProjectRoot) {
        const blank = await ensureBlankVideoForProject(finalProjectRoot, Math.max(duration, 60));
        videoPath = blank.videoPath;
        videoUrl = blank.videoUrl;
      }

      const updatedProject: Project = {
        ...currentProject,
        videoPath,
        videoUrl,
        projectPath: finalProjectRoot,
        tracks: [...(currentProject.tracks || []), newTrack]
      };

      setDuration(prev => Math.max(prev || 0, duration));
      setProject(updatedProject);
      
      logger.info(`Imported audio track: ${fileName} (${duration}s)`);
    } catch (err) {
      alert(`Ошибка при импорте: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsExporting(false);
      setExportOperation('');
    }
  };

  
  // Actions moved to useProjectActions
  const handleGlueSegments = useCallback(async () => {
    if (!project || !project.projectPath || selectedSegmentIds.length < 2) return;
    
    // Find all selected segments across all tracks
    const segmentsToGlue: AudioSegment[] = [];
    let targetTrackId = '';
    
    project.tracks.forEach(track => {
      track.segments.forEach(seg => {
        if (selectedSegmentIds.includes(seg.id)) {
          segmentsToGlue.push(seg);
          targetTrackId = track.id; // Assume they are on the same track or use the last one
        }
      });
    });
    
    if (segmentsToGlue.length < 2) return;
    
    // Sort by start time
    segmentsToGlue.sort((a, b) => a.startTime - b.startTime);
    
    const firstSeg = segmentsToGlue[0];
    const lastSeg = segmentsToGlue[segmentsToGlue.length - 1];
    const totalDuration = (lastSeg.startTime + lastSeg.duration) - firstSeg.startTime;
    
    setIsExporting(true);
    setExportProgress(0);
    
    try {
      const outputPath = `${project.projectPath}/takes/glued_${Date.now()}.wav`;
      const resultRes = await window.electronAPI.mergeSegments({
        segments: segmentsToGlue.map(s => ({
          filePath: s.filePath || '',
          startTime: s.startTime,
          gain: s.gain
        })),
        outputPath
      });
      
      if (resultRes.success && resultRes.data) {
        // Create new segment
        const newSeg: AudioSegment = {
          id: Math.random().toString(36).substr(2, 9),
          startTime: firstSeg.startTime,
          duration: totalDuration,
          filePath: outputPath,
          blobUrl: getSafeFileUrl(outputPath),
          fileOffset: 0,
          fileDuration: totalDuration,
          gain: 1.0,
          playbackRate: 1.0,
          text: `Glued (${segmentsToGlue.length} items)`
        };
        
        // Update project: remove old segments, add new one
        setProject(prev => {
          if (!prev) return prev;
          const newTracks = (prev.tracks || []).map(track => {
            if (track.id !== targetTrackId) return track;
            const filtered = track.segments.filter(s => !selectedSegmentIds.includes(s.id));
            return { ...track, segments: [...filtered, newSeg] };
          });
          return { ...prev, tracks: newTracks };
        });
        
        setSelectedSegmentIds([]);
        alert("Segments glued successfully!");
      }
    } catch (error) {
      console.error("Glue failed:", error);
      alert("Glue failed. Check console.");
    } finally {
      setIsExporting(false);
    }
  }, [project, selectedSegmentIds]);



  useEffect(() => {
    if (videoRef.current && project) {
      playbackEngine.bindVideoElement(videoRef.current);
      if (referenceAudioRef.current) {
        playbackEngine.bindReferenceAudio(referenceAudioRef.current);
      }
    }
  }, [project, videoRef, referenceAudioRef, isPopoutOpen]);



  const currentLine = project?.subtitles?.find(l => currentTime >= l.start - 0.5 && currentTime <= l.end);
  const nextLine = project?.subtitles?.find(l => l.start > currentTime);

  const studioSyncDataRef = useRef({
    project, currentTime, currentLine, nextLine, showWebcam, isRecording,
    teleprompterMode, teleprompterFontSize, teleprompterLineHeight, teleprompterPacing,
    teleprompterPosition, teleprompterSize, isBackstageRecording,
    duration
  });

  useEffect(() => {
    studioSyncDataRef.current = {
      project, currentTime, currentLine, nextLine, showWebcam, isRecording,
      teleprompterMode, teleprompterFontSize, teleprompterLineHeight, teleprompterPacing,
      teleprompterPosition, teleprompterSize, isBackstageRecording,
      duration
    };
  });

  useEffect(() => {
    if (isPopoutOpen) {
      let interval: any;
      let lastDataSync = 0;
      let lastTauriTimeSync = 0;
      let lastDataHash = "";
      const channel = new BroadcastChannel('studio-mode');
      
      let tauriEmit: any = null;
      if (isDesktop && !!(window as any).__TAURI_INTERNALS__) {
        import('@tauri-apps/api/event').then(({ emit }) => {
          tauriEmit = emit;
        }).catch(() => {});
      }
      
      let isTimeSyncPending = false;
      
      const sendDataSync = (force: boolean = false) => {
        const state = studioSyncDataRef.current;
        let resolvedVideoPath = state.project?.videoPath;
        if (resolvedVideoPath && state.project?.projectPath && !resolvedVideoPath.startsWith('http') && !resolvedVideoPath.startsWith('blob:')) {
          if (!resolvedVideoPath.startsWith('/') && !resolvedVideoPath.match(/^[a-zA-Z]:/)) {
            // It's a relative path or just a filename
            const cleanPath = resolvedVideoPath.startsWith('./') ? resolvedVideoPath.slice(2) : resolvedVideoPath;
            resolvedVideoPath = `${state.project.projectPath}/${cleanPath}`.replace(/\\/g, '/');
          }
        }
        
        const minimalProject = state.project ? {
          videoUrl: state.project.videoUrl,
          videoPath: state.project.videoPath,
          projectPath: state.project.projectPath,
          selectedRole: state.project.selectedRole,
          audioSettings: state.project.audioSettings,
          originalPeaks: state.project.originalPeaks
        } : null;
        
        const dataPayload = {
            videoSrc: resolvedVideoPath ? getSafeFileUrl(resolvedVideoPath) : state.project?.videoUrl,
            showWebcam: state.showWebcam || !!state.project?.audioSettings?.isBackstageEnabled,
            subtitles: state.project?.subtitles,
            teleprompterMode: state.teleprompterMode,
            teleprompterFontSize: state.teleprompterFontSize,
            teleprompterLineHeight: state.teleprompterLineHeight,
            teleprompterPacing: state.teleprompterPacing,
            teleprompterPosition: state.teleprompterPosition,
            teleprompterSize: state.teleprompterSize,
            isAudiobook: !!state.project?.documentContent,
            activeRole: state.project?.selectedRole || '',
            project: minimalProject,
            duration: state.duration || 0,
        };
        
        try {
          const newHash = JSON.stringify(dataPayload);
          if (force || newHash !== lastDataHash) {
            lastDataHash = newHash;
            channel.postMessage({ type: 'SYNC_DATA', payload: dataPayload });
            
            if (tauriEmit) {
              tauriEmit('studio-sync-data', dataPayload).catch(() => {});
            }
          }
        } catch (e) {
          console.warn("Failed to stringify data payload for sync", e);
        }
      };

      const syncState = () => {
        const state = studioSyncDataRef.current;
        const now = Date.now();
        const timePayload = {
            currentTime: state.currentTime,
            isPlaying: isPlayingRef.current,
            isRecording: state.isRecording,
            isBackstageRecording: state.isRecording && state.isBackstageRecording,
            currentLine: state.currentLine,
            nextLine: state.nextLine,
        };

        channel.postMessage({ type: 'SYNC_TIME', payload: timePayload });
        
        // Throttled high-performance fallback over Tauri events (only every 150ms and simplified payloads)
        if (tauriEmit && !isTimeSyncPending && now - lastTauriTimeSync > 150) {
          lastTauriTimeSync = now;
          isTimeSyncPending = true;
          
          const simpleTimePayload = {
            currentTime: state.currentTime,
            isPlaying: isPlayingRef.current,
            isRecording: state.isRecording,
            isBackstageRecording: state.isRecording && state.isBackstageRecording,
            currentLine: state.currentLine ? { id: state.currentLine.id, start: state.currentLine.start, end: state.currentLine.end, text: state.currentLine.text, role: state.currentLine.role } : null,
            nextLine: state.nextLine ? { id: state.nextLine.id, start: state.nextLine.start, end: state.nextLine.end, text: state.nextLine.text, role: state.nextLine.role } : null,
          };

          tauriEmit('studio-sync-time', simpleTimePayload)
            .catch(() => {})
            .finally(() => { isTimeSyncPending = false; });
        }
        
        if (now - lastDataSync > 500) {
          lastDataSync = now;
          sendDataSync(false);
        }
      };

      interval = setInterval(syncState, 1000 / 30); // 30fps sync

      channel.onmessage = (e) => {
        if (e.data.type === 'STUDIO_PING') {
          // Connection acknowledged - force send the full data immediately
          sendDataSync(true);
        } else if (e.data.type === 'STUDIO_CLOSED') {
          setIsPopoutOpen(false);
          setExternalWindow(null);
        } else if (e.data.type === 'UPDATE_TELEPROMPTER_SETTINGS') {
          const { fontSize, lineHeight, pacing, mode, size, position } = e.data.payload;
          if (fontSize !== undefined) setTeleprompterFontSize(fontSize);
          if (lineHeight !== undefined) setTeleprompterLineHeight(lineHeight);
          if (pacing !== undefined) setTeleprompterPacing(pacing);
          if (mode !== undefined) setTeleprompterMode(mode);
          if (size !== undefined) setTeleprompterSize(size);
          if (position !== undefined) setTeleprompterPosition(position);
        }
      };

      let unlistenTauri: any = null;
      let unlistenTauri2: any = null;
      let unlistenTauriSettings: any = null;
      if (isDesktop && !!(window as any).__TAURI_INTERNALS__) {
        import('@tauri-apps/api/event').then(({ listen }) => {
          listen('studio-ping', () => {
            sendDataSync(true);
          }).then(u => unlistenTauri2 = u);
          listen('studio-closed', () => {
            setIsPopoutOpen(false);
            setExternalWindow(null);
          }).then(unlisten => unlistenTauri = unlisten);
          listen('update-teleprompter-settings', (event: any) => {
            const { fontSize, lineHeight, pacing, mode, size, position } = event.payload;
            if (fontSize !== undefined) setTeleprompterFontSize(fontSize);
            if (lineHeight !== undefined) setTeleprompterLineHeight(lineHeight);
            if (pacing !== undefined) setTeleprompterPacing(pacing);
            if (mode !== undefined) setTeleprompterMode(mode);
            if (size !== undefined) setTeleprompterSize(size);
            if (position !== undefined) setTeleprompterPosition(position);
          }).then(u => unlistenTauriSettings = u);
        });
      }

      return () => {
        clearInterval(interval);
        channel.close();
        if (unlistenTauri) unlistenTauri();
        if (unlistenTauri2) unlistenTauri2();
        if (unlistenTauriSettings) unlistenTauriSettings();
      };
    }
  }, [isPopoutOpen]);

  const projectContextValue = {
    project, setProject, recentProjects, handleNewProject, handleOpenProject, handleSaveProject, handleCloseProject, onLoadProject,
    undo, redo, canUndo, canRedo, saveSnapshot
  };
  const timelineContextValue = {
    currentTime, duration, isPlaying, zoomLevel, timelineHeight, isAutoHeight, sidebarWidth,
    isRippleEnabled, selectedSegmentIds, isLooping, loopRange, currentTimeRef, videoRef, referenceAudioRef,
    isHighlightingMissingSubtitles,
    setCurrentTime, setDuration, setIsPlaying, setZoomLevel, setTimelineHeight, setIsAutoHeight, setSidebarWidth,
    setIsRippleEnabled, setSelectedSegmentIds, setIsLooping, setLoopRange, togglePlay, handleSeek,
    setIsHighlightingMissingSubtitles
  };

  let resolvedMainVideoPath = project?.videoPath;
  if (resolvedMainVideoPath && project?.projectPath && !resolvedMainVideoPath.startsWith('http') && !resolvedMainVideoPath.startsWith('blob:')) {
    if (!resolvedMainVideoPath.startsWith('/') && !resolvedMainVideoPath.match(/^[a-zA-Z]:/)) {
      const cleanPath = resolvedMainVideoPath.startsWith('./') ? resolvedMainVideoPath.slice(2) : resolvedMainVideoPath;
      resolvedMainVideoPath = `${project.projectPath}/${cleanPath}`.replace(/\\/g, '/');
    }
  }

  const IS_TAURI = !!(window as any).__TAURI_INTERNALS__;
  const getVideoSource = () => {
    if (project?.videoUrl && (!IS_TAURI || !resolvedMainVideoPath)) {
      return project.videoUrl; // Prefer blob URL in web preview
    }
    return resolvedMainVideoPath ? getSafeFileUrl(resolvedMainVideoPath) : undefined;
  };

  return (
    <ProjectProvider value={projectContextValue}>
      <UIProvider>
      <TimelineProvider value={timelineContextValue}>
        <div 
          {...getRootProps()}
      className="h-screen bg-zinc-950 text-white flex flex-col overflow-hidden font-sans relative"
    >
      <input {...getInputProps()} />
      
      <AnimatePresence>
        {dropzoneActive && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[200] bg-indigo-600/20 backdrop-blur-md border-4 border-dashed border-indigo-500 m-4 rounded-3xl flex flex-col items-center justify-center pointer-events-none"
          >
            <div className="w-24 h-24 bg-indigo-500 rounded-full flex items-center justify-center mb-6 shadow-2xl shadow-indigo-500/50">
              <Upload className="w-12 h-12 text-white animate-bounce" />
            </div>
            <h2 className="text-3xl font-black mb-2">Загрузить файл</h2>
            <p className="text-indigo-200 font-bold">Видео, аудио, книги или субтитры</p>
            <p className="text-zinc-400 text-sm mt-2">
              (Поддерживается: mp4, mkv, hevc, mov, wav, flac, ass, srt, vtt, fb2, txt, csv и др.)
            </p>
          </motion.div>
        )}
      </AnimatePresence>

            <TopHeader 
        showProjectMenu={showProjectMenu}
        setShowProjectMenu={setShowProjectMenu}
        handleSelectVideo={handleSelectVideo}
        handleSelectSubs={handleSelectSubs}
        handleSelectDocument={handleSelectDocument}
        handleSelectReferenceAudio={handleSelectReferenceAudio}
        handleMergeBackstage={handleMergeBackstage}
        setShowQuickImport={setShowQuickImport}
        setShowFixImport={setShowFixImport}
        handleBulkImport={handleBulkImport}
        handleGameDubbingImport={handleGameDubbingImport}
        handleImportAudio={handleImportAudioTrack}
        isDesktop={isDesktop}
        handleExport={(format) => {
          setPendingExportFormat(format);
          setIsExportModalOpen(true);
        }}
        isBackstageSessionRecording={isBackstageSessionRecording}
        hasBackstageSessions={hasBackstageSessions}
        onOpenBackstageEditor={() => setShowBackstageEditor(true)}
        onOpenCastingModal={() => setIsCastingModalOpen(true)}
        onOpenDocumentModal={() => setIsDocumentModalOpen(true)}
        onUpdateDubberNick={handleUpdateDubberNick}
        handleBatchExport={handleBatchExport}
        handleMuxVideo={handleMuxVideo}
        handleExportAudioBook={handleExportAudioBook}
        handleExportStems={handleExportStems}
        handleExportAllStemsZip={handleExportAllStemsZip}
        setIsExporting={setIsExporting}
        setExportOperation={setExportOperation}
      />

      {/* Main Content */}
      <main className="flex-1 flex min-h-0 overflow-hidden relative">
        <LeftSidebar />

        {/* Sidebar Resizer Handle */}
        <div 
          className="w-1 bg-zinc-800 hover:bg-indigo-500 cursor-col-resize transition-colors flex-shrink-0 z-50 relative"
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = sidebarWidth;
            const onMouseMove = (moveEvent: MouseEvent) => {
              const deltaX = moveEvent.clientX - startX;
              const newWidth = startWidth + deltaX;
              setSidebarWidth(Math.max(200, Math.min(newWidth, 600)));
            };
            const onMouseUp = () => {
              document.removeEventListener('mousemove', onMouseMove);
              document.removeEventListener('mouseup', onMouseUp);
            };
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
          }}
        />

        {/* Center: Video & Teleprompter */}
        <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-black relative">
          <MissingSubtitlesBanner
            project={project}
            currentTime={currentTime}
            onSeek={handleSeek}
            isActive={isHighlightingMissingSubtitles}
            onClose={() => setIsHighlightingMissingSubtitles(false)}
          />
          <div className="flex-1 min-h-0 relative flex items-center justify-center group">
            {!project ? (
              <div className="flex flex-col items-center justify-center gap-6">
                <div className="w-24 h-24 bg-zinc-900 rounded-full flex items-center justify-center border border-white/5">
                  <FileVideo className="w-10 h-10 text-zinc-700" />
                </div>
                <div className="text-center">
                  <h3 className="text-xl font-bold text-zinc-400 mb-2">Рабочая область готова</h3>
                  <p className="text-sm text-zinc-600">Выберите существующий проект или создайте новый, чтобы начать</p>
                </div>
              </div>
            ) : (!project.videoPath && !project.videoUrl) ? (
              <AudioDAWView 
                project={project}
                isPlaying={isPlaying}
                isRecording={isRecording}
                currentTime={currentTime}
                onSelectVideo={handleSelectVideo}
                onImportAudioTrack={handleImportAudioTrack}
                onImportSubtitles={async () => {
                  if (!window.electronAPI) return;
                  const res = await window.electronAPI.openFile({
                    title: 'Импортировать субтитры',
                    filters: [{ name: 'Субтитры', extensions: ['srt', 'ass', 'vtt', 'txt'] }]
                  });
                  if (res.success && res.data) {
                    const textRes = await window.electronAPI.readTextFile(res.data.path);
                    if (textRes.success && textRes.data) {
                      try {
                        const subtitles = await UniversalParserService.parse(textRes.data, res.data.name);
                        if (!subtitles || subtitles.length === 0) {
                          throw new Error("Файл пуст или имеет неверную структуру.");
                        }
                        const roles = Array.from(new Set(subtitles.map(s => s.role)));
                        setProject(prev => {
                          if (!prev) return prev;
                          return {
                            ...prev,
                            subtitles,
                            roles,
                            selectedRole: roles[0] || 'Default'
                          };
                        });
                      } catch (parseErr) {
                        const msg = getFriendlySubtitleErrorMessage(parseErr, res.data.name);
                        alert(msg);
                      }
                    }
                  }
                }}
                onAddTrack={() => {
                  setProject(p => {
                    if (!p) return p;
                    const newTrackId = `track-${Date.now()}`;
                    const newTrackNum = p.tracks.length + 1;
                    return {
                      ...p,
                      tracks: [
                        ...p.tracks,
                        { id: newTrackId, name: `Дорожка ${newTrackNum}`, segments: [], volume: 1, isMuted: false }
                      ]
                    };
                  });
                }}
              />
            ) : popupBlocked ? (
              <div className="flex flex-col items-center justify-center p-8 text-center bg-zinc-900 border border-amber-500/30 rounded-2xl max-w-lg mx-auto shadow-2xl relative overflow-hidden backdrop-blur-sm">
                <div className="absolute top-0 left-0 w-full h-1 bg-amber-500" />
                <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center border border-amber-500/20 mb-6">
                  <Monitor className="w-10 h-10 text-amber-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2 uppercase tracking-wide font-sans">Второе окно не поддерживается</h3>
                <p className="text-sm text-zinc-400 max-w-sm mb-6 leading-relaxed">
                  Ваша текущая среда (Desktop) не поддерживает создание дополнительных всплывающих окон. Вместо этого вы можете использовать «Студийный режим» (развернуть интерфейс на весь экран).
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setPopupBlocked(false)}
                    className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white rounded-xl text-xs font-black transition-all active:scale-95 border border-zinc-700 font-sans uppercase"
                  >
                    Понятно
                  </button>
                  <button
                    onClick={() => {
                      setPopupBlocked(false);
                      // Fallback to overlay mode (we just set an internal state)
                      setExternalWindow(window);
                      setIsPopoutOpen(true);
                    }}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black transition-all active:scale-95 shadow-md shadow-indigo-600/30 flex items-center gap-1.5 font-sans uppercase"
                  >
                    Студийный режим
                  </button>
                </div>
              </div>
            ) : isPopoutOpen ? (
              <StudioDashboard
                project={project}
                currentTime={currentTime}
                currentLine={currentLine}
                isPlaying={isPlaying}
                isRecording={isRecording}
                onToggleBackstage={() => {
                  if (project) {
                    setProject({
                      ...project,
                      audioSettings: {
                        ...project.audioSettings,
                        isBackstageEnabled: !project.audioSettings?.isBackstageEnabled
                      }
                    });
                  }
                }}
              />
            ) : (
              <video 
                key={project.videoPath || project.videoUrl || 'default'}
                ref={videoRef}
                className="w-full h-full object-contain shadow-2xl"
                playsInline
                crossOrigin="anonymous"
                preload="metadata"
                onKeyDown={(e) => e.preventDefault()}
                onPlay={() => {
                  if (!isPlayingRef.current) {
                    setIsPlaying(true);
                    if (projectRef.current) {
                      playbackEngine.play(projectRef.current.tracks, videoRef.current?.currentTime || 0);
                    }
                  }
                }}
                onPause={() => {
                  if (isPlayingRef.current) {
                    setIsPlaying(false);
                    playbackEngine.stop();
                  }
                }}
                src={getVideoSource()}
                onLoadedMetadata={(e) => {
                  let newDuration = e.currentTarget.duration;
                  logger.info("Video metadata loaded. Duration:", newDuration);
                  
                  if (newDuration === Infinity || newDuration < 1) {
                    e.currentTarget.currentTime = 1e101;
                    return;
                  }
                  setDuration(newDuration);
                  setVideoError(null);
                  
                  // Update Оригинал track duration if it exists
                  setProject(p => {
                    if (!p) return p;
                    const tracks = (p.tracks).map(t => {
                      if (t.name === 'Оригинал') {
                        return {
                          ...t,
                          segments: (t.segments || []).map(s => 
                            s.id === 'original-audio-seg' ? { ...s, duration: newDuration, fileDuration: newDuration } : s
                          )
                        };
                      }
                      return t;
                    });
                    return { ...p, tracks };
                  });
                }}
                onDurationChange={(e) => {
                  const newDuration = e.currentTarget.duration;
                  if (newDuration !== Infinity && newDuration > 0) {
                    setDuration(newDuration);
                    // Also update Оригинал track duration here to keep it in sync
                    setProject(p => {
                      if (!p) return p;
                      const tracks = (p.tracks).map(t => {
                        if (t.name === 'Оригинал') {
                          return {
                            ...t,
                            segments: (t.segments || []).map(s => 
                              s.id === 'original-audio-seg' ? { ...s, duration: newDuration, fileDuration: newDuration } : s
                            )
                          };
                        }
                        return t;
                      });
                      return { ...p, tracks };
                    });
                  }
                }}
                onError={(e) => {
                  const video = e.currentTarget;
                  const error = video.error;
                  if (!project?.videoPath && !project?.videoUrl) {
                    return; // Ignore error if no video is expected
                  }

                  // If code 4 occurs on an element with crossOrigin, attempt fallback without crossOrigin
                  if (error?.code === 4 && video.getAttribute('crossorigin')) {
                    console.warn("Video failed with crossOrigin, attempting fallback without crossOrigin...");
                    video.removeAttribute('crossorigin');
                    video.load();
                    return;
                  }

                  let message = "Видео не может быть загружено. Пожалуйста, проверьте формат файла.";
                  
                  if (error) {
                    if (error.code === 1) message = "Воспроизведение прервано пользователем.";
                    else if (error.code === 2) message = "Ошибка сети при загрузке видео.";
                    else if (error.code === 3) message = "Ошибка декодирования (вероятно, из-за аудиокодека). Нажмите «Исправить воспроизведение» ниже, чтобы создать прокси.";
                    else if (error.code === 4) message = "Формат видео не поддерживается или файл отсутствует.";
                  }
                  
                  setVideoError(message);
                  console.error("Video Playback Error:", {
                    code: error?.code,
                    message: error?.message,
                    src: video.src || "Multiple sources",
                    videoPath: project.videoPath,
                    videoUrl: project.videoUrl
                  });
                }}
              />
            )}

            {project?.referenceAudioPath && (
              <audio 
                ref={referenceAudioRef} 
                crossOrigin="anonymous"
                onPlay={() => {
                  if (!isPlayingRef.current) {
                    setIsPlaying(true);
                    if (projectRef.current) {
                      playbackEngine.play(projectRef.current.tracks, referenceAudioRef.current?.currentTime || 0);
                    }
                  }
                }}
                onPause={() => {
                  if (isPlayingRef.current) {
                    setIsPlaying(false);
                    playbackEngine.stop();
                  }
                }}
                src={getSafeFileUrl(project?.referenceAudioPath?.startsWith('./') && project?.projectPath ? `${project.projectPath}/${project.referenceAudioPath.slice(2)}` : project?.referenceAudioPath)} 
                onLoadedMetadata={(e) => {
                  if (!project?.videoPath && !project?.videoUrl) {
                    setDuration(e.currentTarget.duration);
                  }
                }}
              />
            )}
            
            {!isPopoutOpen && project && (
              <ActorOverlay 
                currentLine={currentLine} 
                nextLine={nextLine} 
                currentTime={currentTime}
                showWebcam={showWebcam || !!project.audioSettings?.isBackstageEnabled}
                webcamRef={webcamRef}
                isRecording={isRecording}
                recordingStream={backstageStream || recordingStream}
                previewStream={previewStream}
                isWebcamSimulated={isWebcamSimulated}
                duration={duration}
                onSettingsChange={(newSettings) => {
                  setProject(p => p ? { ...p, audioSettings: newSettings } : null);
                }}
                onClipping={(clipping) => {
                  if (isRecording) setClippingDetected(clipping);
                }}
                subtitles={project.subtitles}
                teleprompterMode={teleprompterMode}
                teleprompterFontSize={teleprompterFontSize}
                teleprompterLineHeight={teleprompterLineHeight}
                teleprompterPacing={teleprompterPacing}
                setTeleprompterFontSize={setTeleprompterFontSize}
                setTeleprompterLineHeight={setTeleprompterLineHeight}
                setTeleprompterPacing={setTeleprompterPacing}
                setTeleprompterMode={setTeleprompterMode}
                teleprompterPosition={teleprompterPosition}
                setTeleprompterPosition={setTeleprompterPosition}
                teleprompterSize={teleprompterSize}
                setTeleprompterSize={setTeleprompterSize}
                isAudiobook={!!project.documentContent}
                isBackstageRecording={isRecording && isBackstageRecording}
                activeRole={project.selectedRole || ''}
                project={project}
                onSeek={handleSeek}
              />
            )}

            {isPopoutOpen && externalWindow && project && (() => {
              const content = (
                <div className="w-full h-full relative flex items-center justify-center bg-black overflow-hidden select-none">
                  {/* Fullscreen popup content */}
                  {(project.videoPath || project.videoUrl) && (
                    <video 
                      ref={videoRef}
                      className="w-full h-full object-contain shadow-2xl"
                      playsInline
                      crossOrigin="anonymous"
                      preload="metadata"
                      onKeyDown={(e) => e.preventDefault()}
                      onPlay={() => {
                        if (!isPlayingRef.current) {
                          setIsPlaying(true);
                          if (projectRef.current) {
                            playbackEngine.play(projectRef.current.tracks, videoRef.current?.currentTime || 0);
                          }
                        }
                      }}
                      onPause={() => {
                        if (isPlayingRef.current) {
                          setIsPlaying(false);
                          playbackEngine.stop();
                        }
                      }}
                      src={getVideoSource()}
                      onLoadedMetadata={(e) => {
                        let newDuration = e.currentTarget.duration;
                        if (newDuration !== Infinity && newDuration > 0) {
                          setDuration(newDuration);
                        }
                      }}
                      onDurationChange={(e) => {
                        const newDuration = e.currentTarget.duration;
                        if (newDuration !== Infinity && newDuration > 0) {
                          setDuration(newDuration);
                        }
                      }}
                      onError={(e) => {
                        const video = e.currentTarget;
                        const error = video.error;
                        if (!project?.videoPath && !project?.videoUrl) return;
                        setVideoError(`Ошибка воспроизведения видео во втором окне: ${error?.message || error?.code}`);
                      }}
                    />
                  )}
                  
                  {/* Actor overlay including teleprompter and webcam over the video, fully responsive */}
                  <ActorOverlay 
                    currentLine={currentLine} 
                    nextLine={nextLine} 
                    currentTime={currentTime}
                    showWebcam={showWebcam || !!project.audioSettings?.isBackstageEnabled}
                    webcamRef={webcamRef}
                    isRecording={isRecording}
                    recordingStream={backstageStream || recordingStream}
                    previewStream={previewStream}
                    isWebcamSimulated={isWebcamSimulated}
                    duration={duration}
                    onSettingsChange={(newSettings) => {
                      setProject(p => p ? { ...p, audioSettings: newSettings } : null);
                    }}
                    onClipping={(clipping) => {
                      if (isRecording) setClippingDetected(clipping);
                    }}
                    subtitles={project.subtitles}
                    teleprompterMode={teleprompterMode}
                    teleprompterFontSize={teleprompterFontSize}
                    teleprompterLineHeight={teleprompterLineHeight}
                    teleprompterPacing={teleprompterPacing}
                    setTeleprompterFontSize={setTeleprompterFontSize}
                    setTeleprompterLineHeight={setTeleprompterLineHeight}
                    setTeleprompterPacing={setTeleprompterPacing}
                    setTeleprompterMode={setTeleprompterMode}
                    teleprompterPosition={teleprompterPosition}
                    setTeleprompterPosition={setTeleprompterPosition}
                    teleprompterSize={teleprompterSize}
                    setTeleprompterSize={setTeleprompterSize}
                    isAudiobook={!!project.documentContent}
                    isBackstageRecording={isRecording && isBackstageRecording}
                    activeRole={project.selectedRole || ''}
                    project={project}
                    onSeek={handleSeek}
                    isPopout={true}
                  />

                  {/* Dynamic popup visual helpers */}
                  <div className="absolute top-4 left-4 z-[100] pointer-events-auto flex items-center gap-2">
                    <button
                      onClick={() => {
                        let doc = window.document;
                        if (externalWindow && externalWindow !== window) {
                          doc = externalWindow.document;
                        }
                        const elem = doc.documentElement;
                        if (!doc.fullscreenElement) {
                          elem.requestFullscreen().catch((err) => {
                            console.error(`Fullscreen error: ${err.message}`);
                          });
                        } else {
                          doc.exitFullscreen();
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-zinc-900/80 hover:bg-zinc-800 text-white border border-white/10 text-[10px] font-black transition-all flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer uppercase tracking-tight"
                      title="Развернуть во весь экран"
                    >
                      <Monitor className="w-3.5 h-3.5" />
                      Во весь экран
                    </button>
                    <button
                      onClick={handleTogglePopout}
                      className="px-3 py-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900/80 text-rose-200 border border-rose-500/30 text-[10px] font-black transition-all flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer uppercase tracking-tight"
                      title="Закрыть второе окно"
                    >
                      Вернуть на базу
                    </button>
                  </div>
                </div>
              );

              if (externalWindow === window) {
                return (
                  <div className="fixed inset-0 w-full h-full z-[99999] bg-black">
                    {content}
                  </div>
                );
              }
              
              if ((externalWindow as any) === 'DESKTOP_POPOUT') {
                return (
                  <div className="hidden">
                    <video 
                      ref={videoRef}
                      src={getVideoSource()}
                      crossOrigin="anonymous"
                      onLoadedMetadata={(e) => {
                        let newDuration = e.currentTarget.duration;
                        if (newDuration !== Infinity && newDuration > 0) {
                          setDuration(newDuration);
                        }
                      }}
                      onPlay={() => {
                        if (!isPlayingRef.current) {
                          setIsPlaying(true);
                          if (projectRef.current) {
                            playbackEngine.play(projectRef.current.tracks, videoRef.current?.currentTime || 0);
                          }
                        }
                      }}
                      onPause={() => {
                        if (isPlayingRef.current) {
                          setIsPlaying(false);
                          playbackEngine.stop();
                        }
                      }}
                    />
                  </div>
                );
              }

              return (
                <PopoutWindow externalWindow={externalWindow} onClose={() => { setIsPopoutOpen(false); setExternalWindow(null); }}>
                  {content}
                </PopoutWindow>
              );
            })()}

            {showCalibration && project && (
              <LatencyCalibration 
                inputDeviceId={project?.audioSettings?.deviceId}
                outputDeviceId={project?.audioSettings?.outputDeviceId}
                onComplete={(offset) => {
                  setProject({ ...project, audioOffsetMs: offset });
                  setShowCalibration(false);
                }}
                onClose={() => setShowCalibration(false)}
              />
            )}

            <PreRollCountdown countdown={preRollCountdown} />

            {videoError && (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/90 z-50 p-8 text-center">
                <div className="max-w-md">
                  <div className="w-16 h-16 bg-rose-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <AlertTriangle className="w-8 h-8 text-rose-500" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">Ошибка воспроизведения</h3>
                  <p className="text-sm text-zinc-400 mb-8 leading-relaxed">
                    {videoError} <br/>
                    <span className="text-xs mt-2 block opacity-60 italic">Для лучшей совместимости используйте MP4 (H.264).</span>
                  </p>
                  <div className="flex flex-wrap gap-3 justify-center">
                    {window.electronAPI && (project?.videoPath || project?.projectPath) && (
                      <button 
                        onClick={() => handleCreateProxyVideo()} 
                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-bold transition-all shadow-lg shadow-indigo-600/20 flex items-center gap-2 cursor-pointer active:scale-95"
                      >
                        <Film className="w-4 h-4" />
                        Исправить воспроизведение (Прокси)
                      </button>
                    )}
                    <button 
                      onClick={() => {
                        setVideoError(null);
                        if (videoRef.current) videoRef.current.load();
                      }} 
                      className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-bold transition-all"
                    >
                      Повторить
                    </button>
                    <button 
                      onClick={() => {
                        if (project) {
                          setProject({ ...project, videoUrl: "/sample-video.mp4" });
                        }
                        setVideoError(null);
                      }} 
                      className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-bold transition-all"
                    >
                      Сбросить
                    </button>
                    <button 
                      onClick={() => {
                        if (window.electronAPI) {
                          handleSelectVideo();
                        }
                      }} 
                      className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-bold transition-all shadow-lg shadow-indigo-600/20"
                    >
                      Выбрать файл
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Video Overlay Controls */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button onClick={togglePlay} className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center hover:scale-110 transition-transform" title={isPlaying ? "Пауза" : "Воспроизведение"}>
                    {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
                  </button>
                  <div className="text-sm font-mono">
                    <span className="text-white">{Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')}</span>
                    <span className="text-zinc-500"> / {Math.floor(duration / 60)}:{Math.floor(duration % 60).toString().padStart(2, '0')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => {
                      const modeCycle: Record<TeleprompterMode, TeleprompterMode> = {
                        left: 'right',
                        right: 'bottom',
                        bottom: 'compact',
                        compact: 'expanded',
                        expanded: 'left',
                      };
                      const next = modeCycle[teleprompterMode] || 'left';
                      setTeleprompterMode(next);
                      saveTeleprompterPref({ mode: next });
                    }}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all border text-xs font-bold",
                      teleprompterMode === 'expanded' 
                        ? "bg-indigo-600 border-indigo-500 text-white shadow-sm" 
                        : teleprompterMode === 'left' || teleprompterMode === 'right' || teleprompterMode === 'bottom'
                          ? "bg-indigo-950/80 border-indigo-500/50 text-indigo-200"
                          : "hover:bg-white/10 text-zinc-400 border-transparent"
                    )}
                    title={`Суфлер: ${
                      teleprompterMode === 'left' ? 'Привязан слева (клик: переключить)' :
                      teleprompterMode === 'right' ? 'Привязан справа (клик: переключить)' :
                      teleprompterMode === 'bottom' ? 'Привязан снизу (клик: переключить)' :
                      teleprompterMode === 'expanded' ? 'Во весь экран (клик: переключить)' : 'Плавающий (клик: переключить)'
                    }`}
                  >
                    <LayoutTemplate className="w-4 h-4" />
                    <span className="hidden sm:inline text-[10px]">
                      {teleprompterMode === 'left' ? 'Слева' :
                       teleprompterMode === 'right' ? 'Справа' :
                       teleprompterMode === 'bottom' ? 'Снизу' :
                       teleprompterMode === 'expanded' ? 'Экран' : 'Суфлер'}
                    </span>
                  </button>
                  <button className="p-2 hover:bg-white/10 rounded-lg transition-colors" title="Настройки громкости"><Volume2 className="w-5 h-5" /></button>
                  <button 
                    onClick={handleTogglePopout}
                    className={cn(
                      "p-2 rounded-lg transition-colors",
                      isPopoutOpen ? "bg-indigo-600 text-white animate-pulse" : "hover:bg-white/10 text-zinc-400"
                    )} 
                    title="Студийный режим / Второй экран"
                  >
                    <Monitor className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Webcam Overlay removed - consolidated into ActorOverlay */}
          </div>

          {/* Resizer Handle */}
          <div 
            className="h-1 bg-zinc-800 hover:bg-indigo-500 cursor-row-resize transition-colors flex-shrink-0 z-50 relative"
            onMouseDown={(e) => {
              e.preventDefault();
              setIsAutoHeight(false);
              const startY = e.clientY;
              const startHeight = timelineHeight;
              const onMouseMove = (moveEvent: MouseEvent) => {
                const deltaY = startY - moveEvent.clientY;
                const newHeightVh = startHeight + (deltaY / window.innerHeight) * 100;
                setTimelineHeight(Math.max(15, Math.min(newHeightVh, 80)));
              };
              const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
              };
              document.addEventListener('mousemove', onMouseMove);
              document.addEventListener('mouseup', onMouseUp);
            }}
          />

          {/* Timeline Area */}
          <div 
            className="flex-shrink-0 bg-zinc-900 border-t border-white/5 flex flex-col"
            style={{ height: `${timelineHeight}vh` }}
          >
            <TransportControls 
              isRecording={isRecording}
              onToggleRecord={async () => {
                if (isRecording) {
                  handleToggleRecord();
                  if (isBackstageSessionRecording) {
                    stopBackstageSession();
                  }
                } else {
                  if (project?.audioSettings?.isBackstageEnabled && !isBackstageSessionRecording) {
                    await startBackstageSession(project?.videoPath || '');
                  }
                  handleToggleRecord();
                }
              }}
              recordingStream={backstageStream || recordingStream}
              showWebcam={showWebcam}
              onToggleWebcam={() => {
                if (project) {
                  const newIsBackstageEnabled = !project.audioSettings?.isBackstageEnabled;
                  setProject({
                    ...project,
                    audioSettings: {
                      ...project.audioSettings,
                      isBackstageEnabled: newIsBackstageEnabled
                    }
                  });
                  if (!newIsBackstageEnabled && isBackstageSessionRecording) {
                    stopBackstageSession().then(session => {
                      if (session) setShowBackstageEditor(true);
                    });
                  }
                }
              }}
              onClipping={(clipping) => {
                if (isRecording) setClippingDetected(clipping);
              }}
              isLooping={isLooping}
              onToggleLoop={() => setIsLooping(!isLooping)}
              onFitToWidth={handleFitToWidth}
              isAutoHeight={isAutoHeight}
              onToggleAutoHeight={() => setIsAutoHeight(!isAutoHeight)}
              zoomLevel={zoomLevel}
              onZoomChange={setZoomLevel}
              isBackstageSessionRecording={isBackstageSessionRecording}
              onToggleBackstageSession={async () => {
                if (isBackstageSessionRecording) {
                  const session = await stopBackstageSession();
                  if (session) setShowBackstageEditor(true);
                } else {
                  await startBackstageSession(project?.videoPath || '');
                }
              }}
              onSaveBlooper={handleSaveBlooper}
            />
            <div ref={timelineContainerRef} className="flex-1 overflow-hidden flex flex-col">
              {project ? (
                <AdvancedTimeline 
                  project={project} 
                  duration={duration} 
                  isPlaying={isPlaying}
                  isRecording={isRecording}
                  onPlayPause={togglePlay}
                  onRecord={handleToggleRecord}
                  onSeek={handleSeek} 
                  zoom={zoomLevel}
                  onZoom={setZoomLevel}
                  onUpdateSegment={(sourceTrackId, segmentId, updates, targetTrackId) => {
                    if (targetTrackId && targetTrackId !== sourceTrackId) {
                      moveSegmentToTrack(segmentId, sourceTrackId, targetTrackId, updates.startTime ?? 0);
                    } else {
                      updateSegment(segmentId, updates, targetTrackId);
                    }
                  }}
                  onSplitSegment={handleSplit}
                  onDeleteSegment={(trackId, segmentId) => deleteSegments([segmentId])}
                  onDuplicateSegment={handleDuplicateSegment}
                  onAddTrack={handleAddTrack}
                  onArmTrack={handleArmTrack}
                  loopRange={loopRange}
                  onSetLoopRange={setLoopRange}
                  isLooping={isLooping}
                  onToggleLoop={() => setIsLooping(!isLooping)}
                  isRippleEnabled={isRippleEnabled}
                  onToggleRipple={() => setIsRippleEnabled(!isRippleEnabled)}
                  selectedSegmentIds={selectedSegmentIds}
                  onCopySegments={handleCopySegments}
                  onCutSegments={handleCutSegments}
                  onPasteSegments={handlePasteSegments}
                  onSelectSegment={(segmentId, multi) => {
                    setSelectedSegmentIds(prev => {
                      if (multi) {
                        return prev.includes(segmentId) ? prev.filter(id => id !== segmentId) : [...prev, segmentId];
                      } else {
                        return [segmentId];
                      }
                    });
                  }}
                  onSelectBatchSegments={(segmentIds, multi) => {
                    setSelectedSegmentIds(prev => {
                      if (multi) {
                         const currentSet = new Set(prev);
                         segmentIds.forEach(id => {
                           if (currentSet.has(id)) currentSet.delete(id);
                           else currentSet.add(id);
                         });
                         return Array.from(currentSet);
                      }
                      return segmentIds;
                    });
                  }}
                  onClearSelection={() => setSelectedSegmentIds([])}
                  onGlueSegments={handleGlueSegments}
                  onUpdateTrack={(trackId, updates) => {
                    if (!project) return;
                    const shouldSave = ('segments' in updates) || ('processing' in updates);
                    if (shouldSave) {
                      saveSnapshot();
                    }
                    const updatedTracks = (project.tracks || []).map(t => t.id === trackId ? { ...t, ...updates } : t);
                    const newProject = { ...project, tracks: updatedTracks };
                    setProject(newProject);
                    
                    // Update playback engine if playing
                    if (isPlayingRef.current) {
                      const tracksToUpdate = [...updatedTracks];
                      const originalsTrack = updatedTracks.find(t => t.name === 'Оригинал');
                      
                      if (project.referenceAudioPath) {
                        tracksToUpdate.push({
                          id: 'reference-track',
                          name: 'Reference',
                          volume: originalsTrack?.volume ?? 1.0,
                          isMuted: originalsTrack?.isMuted ?? false,
                          isSolo: originalsTrack?.isSolo ?? false,
                          segments: [{ id: 'reference-seg' }] // Only need ID for updateTracks to find it
                        } as any);
                      }
                      playbackEngine.updateTracks(tracksToUpdate);
                    }
                  }}
                  onUpdateAllTracks={(updates) => {
                    updateAllTracks(updates);
                    if (isPlayingRef.current && project) {
                      const updatedTracks = (project.tracks || []).map(track => ({ ...track, ...updates }));
                      playbackEngine.updateTracks(updatedTracks);
                    }
                  }}
                  onDeleteTrack={deleteTrack}
                  recordingPeaks={recordingPeaks}
                  recordingStartTime={recordingStartTimeRef.current}
                  onOpenProcessing={setProcessingTrackId}
                  currentTimeRef={currentTimeRef}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center bg-zinc-950 text-zinc-600 gap-4">
                  <Layers size={48} className="opacity-20" />
                  <div className="text-center">
                    <p className="text-sm font-bold uppercase tracking-widest mb-1">Проект не загружен</p>
                    <p className="text-xs opacity-50">Создайте новый проект или откройте существующий, чтобы начать.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      <QuickImportModal 
        show={showQuickImport}
        onClose={() => setShowQuickImport(false)}
        text={quickImportText}
        onTextChange={setQuickImportText}
        duration={quickImportDuration}
        onDurationChange={setQuickImportDuration}
        onImport={handleQuickImport}
      />

      <FixImportModal 
        show={showFixImport}
        onClose={() => setShowFixImport(false)}
        text={fixImportText}
        onTextChange={setFixImportText}
        onImport={handleFixImport}
      />

      {mkvImportData && (
        <MkvTrackSelectorModal 
          mediaInfo={mkvImportData.mediaInfo}
          videoPath={mkvImportData.videoPath}
          videoName={mkvImportData.videoName}
          onConfirm={handleMkvConfirm}
          onCancel={handleMkvCancel}
        />
      )}

      <ModalsManager />
      
      {showBackstageEditor && project && (
        <BackstageErrorBoundary 
          projectPath={project.projectPath} 
          onClose={() => setShowBackstageEditor(false)}
        >
          <BackstageEditor 
            projectPath={project.projectPath} 
            projectSubtitles={project.subtitles || []}
            onClose={() => setShowBackstageEditor(false)} 
          />
        </BackstageErrorBoundary>
      )}

      {isExportModalOpen && (
        <ExportModal 
          project={project}
          onExport={(options) => handleExport(options)} 
          onCancel={() => setIsExportModalOpen(false)} 
          initialFormat={pendingExportFormat}
          onStartRecordingMissing={handleStartRecordingMissing}
        />
      )}

      {isCastingModalOpen && (
        <CastingImportModal
          isDesktop={isDesktop}
          onClose={() => setIsCastingModalOpen(false)}
          onImportCasting={handleImportCasting}
        />
      )}

      {isDocumentModalOpen && (
        <DocumentImportModal
          isDesktop={isDesktop}
          projectDuration={duration}
          onClose={() => setIsDocumentModalOpen(false)}
          onImportDocument={handleImportDocumentData}
        />
      )}
      
      <StyledExportOverlay 
        isExporting={isExporting} 
        exportProgress={exportProgress} 
        exportOperation={exportOperation} 
      />

      <VideoPreparationModal
        isOpen={videoPreparation.isOpen}
        progress={videoPreparation.progress}
        time={videoPreparation.time}
        statusText={videoPreparation.statusText}
        error={videoPreparation.error}
        isSuccess={videoPreparation.isSuccess}
        onClose={() => setVideoPreparation(prev => ({ ...prev, isOpen: false, error: null }))}
        onRetry={() => handleCreateProxyVideo()}
      />

      {audioSilenceError && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/90 backdrop-blur-md z-[200] p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-zinc-900 border border-red-500/30 p-8 rounded-2xl shadow-2xl max-w-lg w-full flex flex-col gap-6"
          >
            <div className="flex items-center gap-3 border-b border-white/5 pb-4">
              <div className="p-3 bg-red-500/10 text-red-400 rounded-xl">
                <AlertTriangle className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Внимание: Отсутствует аудиосигнал!</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Обнаружена абсолютная тишина (RMS = 0)</p>
              </div>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Запись бэкстейджа без звука <strong>бессмысленна</strong>. Скорее всего, выбранное аудиоустройство занято в эксклюзивном режиме (например, ASIO) или микрофон отключен. Пожалуйста, выберите другой рабочий источник звука для веб-камеры бэкстейджа:
            </p>

            <div className="bg-zinc-950/50 p-4 rounded-xl border border-white/5 max-h-[300px] overflow-y-auto custom-scrollbar">
              <AudioDeviceManager 
                settings={project?.audioSettings || getGlobalAudioSettings()}
                onSettingsChange={(newSettings) => {
                  setProject(p => p ? { ...p, audioSettings: newSettings } : p);
                }}
              />
            </div>

            <div className="flex gap-3 justify-end pt-2 border-t border-white/5">
              <button
                onClick={() => {
                  setAudioSilenceError(false);
                }}
                className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold transition-all"
              >
                Закрыть
              </button>
              <button
                onClick={async () => {
                  setAudioSilenceError(false);
                  setTimeout(async () => {
                    await startBackstageSession(project?.videoPath || '');
                  }, 300);
                }}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/20 transition-all flex items-center justify-center gap-2"
              >
                Начать запись заново
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
      </TimelineProvider>
    </UIProvider>
    </ProjectProvider>
  );
}