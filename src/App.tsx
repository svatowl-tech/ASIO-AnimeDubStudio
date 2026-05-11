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
  Repeat
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDropzone } from 'react-dropzone';
import WaveSurfer from 'wavesurfer.js';
import { cn, getSafeFileUrl, getGlobalAudioSettings, getDefaultKeyMap, safeConfirm } from './lib/utils';
import { FixesPanel } from './components/FixesPanel';
import { Waveform } from './components/Waveform';
import AudioSegmentView from './components/AudioSegmentView';
import VUMeter from './components/VUMeter';
import AudioDeviceManager from './components/AudioDeviceManager';
import ExportModal from './components/ExportModal';
import QuickImportModal from './components/QuickImportModal';
import PreRollCountdown from './components/PreRollCountdown';
import Teleprompter from './components/Teleprompter';
import { Project, SubtitleLine, AudioTrack, AudioSegment, Fix, Marker, TrackProcessing } from './types';
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

// Extracted Components
import ActorOverlay from './components/ActorOverlay';
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
import TopHeader from './components/layout/TopHeader';
import StyledExportOverlay from './components/layout/ExportOverlay';
import { useAudioEngine } from './hooks/useAudioEngine';
import { useProjectImport } from './hooks/useProjectImport';
import { getCurrentWindow } from '@tauri-apps/api/window';

export default function App() {
  const { 
    project, 
    setProject, 
    recentProjects, 
    handleNewProject, 
    handleOpenProject, 
    handleSaveProject: origHandleSaveProject, 
    onLoadProject 
  } = useProject();

  const handleSaveProject = async () => {
    if (!project || !project.projectPath) {
      alert("Проект не сохранен на диске. Используйте 'Создать проект'.");
      return;
    }
    const updatedProject = {
      ...project,
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
    setProject(updatedProject);
    if (window.electronAPI) {
      try {
        await window.electronAPI.saveProjectJson({ projectPath: project.projectPath, projectData: updatedProject });
        alert("Проект сохранен!");
      } catch (error) {
        alert(`Ошибка при сохранении проекта: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  const [duration, setDuration] = useState(0);

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

  const {
    isRecording,
    recordingStream,
    clippingDetected, setClippingDetected,
    recordingPeaks,
    isBackstageRecording,
    setIsBackstageRecording,
    isManualBackstageRecording,
    recordingStartTimeRef,
    startRecording,
    stopRecording,
    discardRecording,
    handleToggleRecord,
    handleToggleBackstage,
    handleDeleteLastTake,
    isRecordingRef
  } = useAudioEngine(project, setProject, videoRef, currentTimeRef, isPlayingRef, togglePlay);

  const { saveSnapshot, undo, redo, canUndo, canRedo } = useTimelineHistory(project, setProject);

  
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

  const { handleSelectVideo } = useProjectImport(project, setProject, setDuration);

  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showFixes, setShowFixes] = useState(true);
  const [showQuickImport, setShowQuickImport] = useState(false);
  const [processingTrackId, setProcessingTrackId] = useState<string | null>(null);
  const [quickImportText, setQuickImportText] = useState('');
  const [quickImportDuration, setQuickImportDuration] = useState(5);
  const showWebcam = !!project?.audioSettings?.isBackstageEnabled;
  const [videoType, setVideoType] = useState<string | null>(null);
  const [showCalibration, setShowCalibration] = useState(false);
  const [teleprompterMode, setTeleprompterMode] = useState<'compact' | 'expanded'>('compact');
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [teleprompterPosition, setTeleprompterPosition] = useState({ x: 0, y: 0 });
  const [teleprompterSize, setTeleprompterSize] = useState({ width: 800, height: 200 });
  const [isElectron, setIsElectron] = useState(!!(window as any).__TAURI_INTERNALS__);

  useEffect(() => {
    const check = () => {
      // Check for Tauri internals explicitly to avoid false positives from the legacy wrapper
      const isEl = !!(window as any).__TAURI_INTERNALS__;
      if (isEl !== isElectron) setIsElectron(isEl);
    };
    check();
    const interval = setInterval(check, 1000);
    
    // Inject demo project for web preview immediately if not in desktop mode
    if (!project && !(window as any).__TAURI_INTERNALS__) {
      setProject({
        id: 'demo-project',
        name: 'Демо Превью',
        projectPath: '/mock/path',
        videoUrl: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4',
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
  }, [isElectron]);
  const [preRollCountdown, setPreRollCountdown] = useState<number | null>(null);
  const [sidebarScrollTop, setSidebarScrollTop] = useState(0);
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

  useEffect(() => {
    projectRef.current = project;
    // When switching projects, clear the buffer cache to save memory
    if (project?.id) {
       playbackEngine.clearCache();
    }
    if (project) {
      playbackEngine.setAudioOffset(project.audioOffsetMs || 0);
    }
  }, [project?.id, project?.audioOffsetMs]);

  useEffect(() => {
    return () => {
      playbackEngine.stop();
      playbackEngine.clearCache();
    };
  }, []);

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
            tracks: prev.tracks.map(t => {
              if (t.name === 'Оригинал') {
                return {
                  ...t,
                  segments: t.segments.map(s => {
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
                
                window.electronAPI.generateWaveformPeaks({ filePath: seg.filePath, points: 1024 })
                  .then(res => {
                      if (res.success && res.data) {
                          setProject(p => {
                              if (!p) return p;
                              return {
                                  ...p,
                                  tracks: p.tracks.map(t => t.id === trackId ? {
                                      ...t,
                                      segments: t.segments.map(s => s.id === segmentId ? { ...s, waveform: Array.from(res.data as any), isExtractingWaveform: false } : s)
                                  } : t)
                              };
                          });
                      } else {
                          setProject(p => p ? {
                              ...p,
                              tracks: p.tracks.map(t => t.id === trackId ? {
                                  ...t,
                                  segments: t.segments.map(s => s.id === segmentId ? { ...s, isExtractingWaveform: false } : s)
                              } : t)
                          } : p);
                      }
                  })
                  .catch(err => {
                      console.warn("Failed to generate waveform for", seg.filePath, err);
                      setProject(p => p ? {
                          ...p,
                          tracks: p.tracks.map(t => t.id === trackId ? {
                              ...t,
                              segments: t.segments.map(s => s.id === segmentId ? { ...s, isExtractingWaveform: false } : s)
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

  // Auto-save effect
  useEffect(() => {
    if (project && project.projectPath && window.electronAPI) {
      const timer = setTimeout(() => {
        window.electronAPI.saveProjectJson({ projectPath: project.projectPath!, projectData: project })
          .then(res => {
            if (res.success) {
              console.log("[AutoSave] Project saved successfully");
            }
          })
          .catch(err => console.error("[AutoSave] Error:", err));
      }, 2000); // Debounce saves for 2 seconds
      return () => clearTimeout(timer);
    }
  }, [project]);

  const handleNativeDrop = useCallback(async (paths: string[]) => {
    for (const path of paths) {
      const fileName = path.split(/[/\\]/).pop() || 'file';
      const fileExt = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
      const fileDir = path.replace(/\\/g, '/').substring(0, path.replace(/\\/g, '/').lastIndexOf('/'));

      if (['.mp4', '.mkv', '.webm', '.mov', '.avi', '.mp3', '.wav', '.flac', '.ogg', '.m4a'].includes(fileExt)) {
        // Handle video or standalone audio
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
                const subtitles = await UniversalParserService.parse(content, fileName);
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
            }
        }
      }
    }
  }, [setProject, createDefaultProject]);

  useEffect(() => {
    logger.info("Application mounted. Electron API available:", !!window.electronAPI);
    
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
    if (isElectron && window.electronAPI) {
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
  }, [handleNativeDrop, isElectron]);


  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const isProjectActive = !!project?.videoUrl || !!project?.projectPath;
    
    const mediaFiles = acceptedFiles.filter(f => f.type.startsWith('video/') || f.type.startsWith('audio/') || ['.mp4', '.mkv', '.webm', '.mov', '.avi', '.mp3', '.wav', '.flac', '.ogg', '.m4a'].some(ext => f.name.toLowerCase().endsWith(ext)));
    const textFiles = acceptedFiles.filter(f => ['.ass', '.srt', '.vtt', '.csv', '.fb2', '.txt', '.epub', '.docx', '.pdf'].some(ext => f.name.toLowerCase().endsWith(ext)));

    if (isProjectActive && mediaFiles.length > 0 && window.electronAPI && project.projectPath) {
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
        
        const peaksRes = await window.electronAPI.generateWaveformPeaks({ filePath: finalPath, points: 1024 });
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

        setProject(prev => {
          const baseProject = prev || createDefaultProject(file.name.replace(/\.[^/.]+$/, ""), projectRoot);
          return { ...baseProject, videoUrl: url, videoPath: filePath, projectPath: projectRoot };
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
      
      const subtitles = await UniversalParserService.parse(content, file.name);
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
    }
  }, [project, currentTimeRef.current]);

  const { getRootProps, getInputProps, isDragActive: dropzoneActive } = useDropzone({ 
    onDrop,
    noClick: true,
    accept: {
      'video/*': ['.mp4', '.webm', '.mkv', '.mov', '.avi'],
      'audio/*': ['.mp3', '.wav', '.flac', '.ogg', '.m4a'],
      'text/plain': ['.txt', '.csv', '.vtt'],
      'application/x-subrip': ['.srt'],
      'application/octet-stream': ['.ass', '.srt', '.fb2']
    }
  } as any);

  useEffect(() => {
    if (isElectron && (window as any).electronAPI) {
      (window as any).electronAPI.requestPermissions().catch(err => {
        console.error('Failed to request media permissions:', err);
      });
    }
  }, [isElectron]);

  // --- App Startup Check ---
  useEffect(() => {
    if (isElectron && window.electronAPI) {
      window.electronAPI.checkCrashes().then(async (res) => {
        if (res.success && res.data && res.data.length > 0) {
          logger.info(`Found ${res.data.length} interrupted recordings. Attempting recovery...`);
          
          for (const recoveryInfo of res.data) {
            if (await safeConfirm(`Была обнаружена прерванная запись (${recoveryInfo.file_path}).\nВосстановить этот фрагмент на таймлайне?`)) {
              // Extract peaks for the recovered file
              const peaksRes = await window.electronAPI.generateWaveformPeaks({ 
                filePath: recoveryInfo.file_path, 
                points: 1024 
              });
              
              const recoveredSegment: AudioSegment = {
                id: recoveryInfo.segment_id || Math.random().toString(36).substr(2, 9),
                startTime: recoveryInfo.start_time,
                duration: 0, // Will be updated if we can get duration
                fileOffset: 0,
                fileDuration: 0,
                filePath: recoveryInfo.file_path,
                blobUrl: `asset://${recoveryInfo.file_path}`,
                waveform: peaksRes.success ? (peaksRes.data as any) : [],
                gain: 1,
                playbackRate: 1
              };

              // Try to get duration
              if (window.electronAPI.getFileInfo) {
                const info = await window.electronAPI.getFileInfo(recoveryInfo.file_path);
                if (info.success && info.data) {
                  recoveredSegment.duration = info.data.duration;
                  recoveredSegment.fileDuration = info.data.duration;
                }
              }

              setProject(prev => {
                if (!prev) return null;
                const updatedTracks = prev.tracks.map(track => {
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
    const bridgeResponse = await window.electronAPI.openFile({
      title: 'Select Document',
      filters: [{ name: 'Documents', extensions: ['txt'] }]
    });
    if (!bridgeResponse.success || !bridgeResponse.data) return;
    const fileData = bridgeResponse.data;
    
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

  const handleMergeBackstage = async () => {
    if (!project || !project.projectPath || !window.electronAPI) return;

    // Collect all unique backstage video paths from all segments
    const videoPaths: string[] = [];
    project.tracks.forEach(track => {
      track.segments.forEach(seg => {
        if (seg.backstageVideoPath && !videoPaths.includes(seg.backstageVideoPath)) {
          videoPaths.push(seg.backstageVideoPath);
        }
      });
    });

    if (videoPaths.length === 0) {
      alert("Нет записанных бекстейдж-видео для объединения.");
      return;
    }

    const saveRes = await window.electronAPI.saveFile({
      title: 'Сохранить финальный бекстейдж',
      defaultPath: `${project.projectPath}/final_backstage.mp4`,
      filters: [{ name: 'Video', extensions: ['mp4'] }]
    });

    if (!saveRes.success || !saveRes.data) return;
    const finalOutputPath = saveRes.data;

    setIsExporting(true);
    setExportProgress(0);
    setExportOperation("Preparing backstage video...");
    
    try {
      logger.info(`Starting backstage merge for ${videoPaths.length} videos to ${finalOutputPath}`);
      
      const tempVideoPath = `${project.projectPath}/temp_backstage_concat.mp4`;
      const tempAudioPath = `${project.projectPath}/temp_backstage_audio.wav`;

      // 1. Concat all backstage videos
      setExportOperation("Concatenating backstage video...");
      logger.info(`Concatenating backstage videos to ${tempVideoPath}`);
      const concatRes = await window.electronAPI.concatBackstageVideos({
        videoPaths,
        outputPath: tempVideoPath
      });

      if (!concatRes.success) {
        throw new Error(`Ошибка при объединении видео: ${concatRes.error}`);
      }

      // 2. Export project audio (Original + Dubs)
      setExportOperation("Mixing project audio for backstage...");
      logger.info(`Mixing project audio for backstage to ${tempAudioPath}`);
      const audioRes = await window.electronAPI.exportAudio({
        projectJson: JSON.stringify({
          tracks: project.tracks.map(t => ({
            name: t.name,
            isMuted: t.isMuted,
            isSolo: t.isSolo,
            segments: t.segments
          })),
          audioOffsetMs: project.audioOffsetMs || 0
        }),
        outputPath: tempAudioPath,
        format: 'wav'
      });

      if (!audioRes.success) {
        throw new Error(`Ошибка при экспорте аудио: ${audioRes.error}`);
      }

      // 3. Mux video from (1) and audio from (2)
      setExportOperation("Muxing video with project audio...");
      logger.info(`Muxing joined video with audio to ${finalOutputPath}`);
      const muxRes = await window.electronAPI.muxVideo({
        videoPath: tempVideoPath,
        audioPath: tempAudioPath,
        outputPath: finalOutputPath
      });

      if (muxRes.success) {
        alert(`Бекстейдж успешно создан с проектным звуком: ${finalOutputPath}`);
        logger.info("Backstage merge successful.");
      } else {
        alert(`Ошибка при финальном сведении: ${muxRes.error}`);
        logger.error("Backstage mux failed:", muxRes.error);
      }
    } catch (err) {
      alert(`Ошибка: ${err instanceof Error ? err.message : String(err)}`);
      logger.error("Backstage merge operation failed:", err);
    } finally {
      setIsExporting(false);
      setExportProgress(100);
      setExportOperation("");
    }
  };

  const handleSelectReferenceAudio = async () => {
    if (!window.electronAPI) return;
    const fileDataRes = await window.electronAPI.openFile({
      title: 'Select Reference Audio',
      filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }]
    });
    if (!fileDataRes.success || !fileDataRes.data) return;
    const fileData = fileDataRes.data;
    
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
    
    const currentProject = project || createDefaultProject(fileData.name.replace(/\.[^/.]+$/, ""), finalProjectRoot || "");
    
    setProject({
      ...currentProject,
      referenceAudioPath: fileData.path
    });
  };

  const handleBulkImport = async () => {
    if (!window.electronAPI) return;
    const folderPathRes = await window.electronAPI.openFolder();
    if (!folderPathRes.success || !folderPathRes.data) return;
    const folderPath = folderPathRes.data;

    try {
      const { tracks, duration, subtitles } = await BulkImportService.importFolder(folderPath);
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
            backstageMode: 'parallel'
          }
        } as Project;

        return {
          ...baseProject,
          tracks: [...(baseProject.tracks || []), ...tracks],
          subtitles: [...(baseProject.subtitles || []), ...subtitles],
          roles: Array.from(new Set([...(baseProject.roles || []), "Original", "Dub"])),
          selectedRole: "Dub",
          projectPath: folderPath // Use folder as project path for now
        };
      });
      setDuration(duration);
    } catch (error) {
      console.error("Bulk import failed:", error);
      alert("Bulk import failed. See console for details.");
    }
  };

  const handleBatchExport = async () => {
    if (!project || !project.projectPath || !window.electronAPI) return;

    const dubTrack = project.tracks.find(t => t.name === 'Dubs');
    if (!dubTrack) return;

    const segmentsToExport = dubTrack.segments
      .filter(s => s.filePath && s.originalFileName)
      .map(s => ({
        filePath: s.filePath!,
        originalFileName: s.originalFileName!
      }));

    if (segmentsToExport.length === 0) {
      alert("Не найдено фрагментов для экспорта (у фрагментов должно быть имя оригинала).");
      return;
    }

    const folderRes = await window.electronAPI.openFolder();
    if (!folderRes.success || !folderRes.data) return;
    const outDir = folderRes.data;

    setIsExporting(true);
    setExportProgress(0);
    setExportOperation(`Batch exporting ${segmentsToExport.length} files...`);

    try {
      logger.info(`Starting batch export of ${segmentsToExport.length} files to ${outDir}`);
      const exportedFilesRes = await window.electronAPI.batchExport({
        projectPath: project.projectPath,
        segments: segmentsToExport,
        outDir
      });
      if (exportedFilesRes.success && exportedFilesRes.data) {
        alert(`Успешно экспортировано ${exportedFilesRes.data.length} файлов в: ${outDir}`);
        logger.info("Batch export successful.");
      } else {
        alert(`Ошибка пакетного экспорта: ${exportedFilesRes.error}`);
        logger.error("Batch export failed:", exportedFilesRes.error);
      }
    } catch (error) {
      console.error("Batch export failed:", error);
      alert("Ошибка при пакетном экспорте.");
    } finally {
      setIsExporting(false);
      setExportOperation('');
    }
  };

  const handleExportAudioBook = async (gapSeconds: number = 1.5) => {
    if (!project || !project.projectPath || !window.electronAPI) return;
    const dubTrack = project.tracks.find(t => t.name === 'Dubs');
    if (!dubTrack || dubTrack.segments.length === 0) {
      alert("Не найдено фрагментов Dubs для экспорта.");
      return;
    }

    const saveRes = await window.electronAPI.saveFile({
        title: 'Экспорт аудиокниги',
        defaultPath: `${project.name}_audiobook.wav`,
        filters: [{ name: 'Audio', extensions: ['wav'] }]
    });

    if (!saveRes.success || !saveRes.data) return;
    const outputPath = saveRes.data;

    setIsExporting(true);
    setExportProgress(0);
    setExportOperation('Preparing audiobook segments...');
    
    try {
      logger.info(`Starting audiobook export to ${outputPath}`);
      const resultRes = await window.electronAPI.exportAudioBook({
        projectPath: project.projectPath,
        outputPath: outputPath,
        format: 'wav',
        gapDuration: gapSeconds,
        normalizeLUFS: true,
        segments: dubTrack.segments.filter(s => s.filePath).map(s => ({
          filePath: s.filePath!,
          gain: s.gain * (dubTrack.volume ?? 1)
        }))
      });

      if (resultRes.success && resultRes.data) {
        alert(`Аудиокнига успешно экспортирована: ${outputPath}`);
        logger.info("Audiobook export successful.");
      } else {
        alert(`Ошибка при экспорте аудиокниги: ${resultRes.error}`);
        logger.error("Audiobook export failed:", resultRes.error);
      }
    } catch (error) {
      console.error("Audio Book export failed:", error);
      alert(`Ошибка экспорта: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsExporting(false);
      setExportOperation('');
    }
  };

  const handleExportStems = async () => {
    if (!project || !project.projectPath || !window.electronAPI) return;
    
    const folderRes = await window.electronAPI.openFolder();
    if (!folderRes.success || !folderRes.data) return;
    const outDir = folderRes.data;

    setIsExporting(true);
    setExportProgress(0);
    setExportOperation('Initializing stem export...');

    const unsubscribe = window.electronAPI.onStemProgress((data) => {
      const pct = (data.current / data.total) * 100;
      setExportProgress(pct);
      setExportOperation(`Stem ${data.current}/${data.total}: ${data.trackName}`);
    });

    try {
      logger.info(`Starting stem export to ${outDir}`);
      const resultRes = await window.electronAPI.exportStems({
        projectData: {
          tracks: project.tracks.map(t => ({
            name: t.name,
            isMuted: t.isMuted,
            isSolo: t.isSolo,
            segments: t.segments.map(s => ({
              id: s.id,
              startTime: s.startTime,
              duration: s.duration,
              filePath: s.filePath,
              gain: s.gain,
              fileOffset: s.fileOffset || 0,
              playbackRate: s.playbackRate
            }))
          })),
          audioOffsetMs: project.audioOffsetMs || 0
        },
        outputDir: outDir,
        bitDepth: project.audioSettings?.bitDepth?.toString() || '16'
      });
      if (resultRes.success) {
        alert(`Экспорт стемов завершен в папку: ${outDir}`);
        logger.info("Stem export successful.");
      } else {
        alert(`Ошибка при экспорте стемов: ${resultRes.error}`);
        logger.error("Stem export failed:", resultRes.error);
      }
    } catch (error) {
      console.error("Stem export failed:", error);
      alert(`Ошибка при экспорте: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      unsubscribe();
      setIsExporting(false);
      setExportOperation('');
    }
  };

  const handleExportAllStemsZip = async () => {
    if (!project || !project.id || !window.electronAPI) return;
    
    const saveRes = await window.electronAPI.saveFile({
        title: 'Экспорт всех дорожек в ZIP',
        defaultPath: `${project.name}_stems.zip`,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
    });

    if (!saveRes.success || !saveRes.data) return;
    const outputPath = saveRes.data;

    setIsExporting(true);
    setExportProgress(0);
    setExportOperation('Saving project...');
    await window.electronAPI.saveProjectJson({ projectPath: project.projectPath || '', projectData: project });

    setExportOperation('Exporting all tracks as ZIP...');

    try {
      logger.info(`Starting all stems ZIP export to ${outputPath}`);
      const resultRes = await window.electronAPI.exportAllStems({
        projectId: project.id,
        projectName: project.name || 'Project',
        outputPath: outputPath
      });
      if (resultRes.success) {
        alert(`Проект успешно упакован в ZIP: ${resultRes.data}`);
        logger.info("ZIP export successful.");
      } else {
        alert(`Ошибка при экспорте ZIP: ${resultRes.error}`);
        logger.error("ZIP export failed:", resultRes.error);
      }
    } catch (error) {
      console.error("ZIP export failed:", error);
      alert(`Ошибка при экспорте ZIP: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsExporting(false);
      setExportOperation('');
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
          const res = await window.electronAPI.generateWaveformPeaks({ filePath: seg.filePath!, points: 1024 });
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
              tracks: prev.tracks.map(track => {
                const updatesForTrack = validUpdates.filter(u => u.trackId === track.id);
                if (updatesForTrack.length === 0) return track;
                return {
                  ...track,
                  segments: track.segments.map(seg => {
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
  }, [project?.id, project?.tracks.map(t => t.segments.length).join(',')]);

  useEffect(() => {
    if (project) {
        if (project.audioSettings) {
          localStorage.setItem('dubstudio_global_audio_settings', JSON.stringify(project.audioSettings));
        }

        // Debounce auto-save to disk/db to avoid high frequency I/O (e.g. during dragging)
        const saveTimer = setTimeout(() => {
          if (window.electronAPI && project.projectPath) {
            window.electronAPI.saveProjectJson({
              projectPath: project.projectPath,
              projectData: project
            }).catch(err => console.error("Auto-save failed:", err));
          }
        }, 1500); // 1.5s delay for stability

        return () => clearTimeout(saveTimer);
    }
  }, [project]);

  // Subtitle File Handling
  const handleSubtitleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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

    setProject(prev => {
      const baseProject = prev || createDefaultProject(file.name.replace(/\.[^/.]+$/, ""));

      return {
        ...baseProject,
        subtitles: parsed.subtitles,
        roles: parsed.roles,
        selectedRole: parsed.roles[0] || 'Default'
      };
    });
  };

  const triggerVideoPicker = async () => {
    if (isElectron && (window as any).electronAPI) {
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
      setVideoError("Please select a valid video file (e.g., .mp4, .webm).");
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

    if (showWebcam || project?.audioSettings?.isBackstageEnabled) {
      const constraints = { 
        video: project?.audioSettings?.webcamDeviceId 
          ? { deviceId: { ideal: project.audioSettings.webcamDeviceId } } 
          : true,
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
            const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
            if (isCancelled) {
              fallbackStream.getTracks().forEach(t => t.stop());
              return;
            }
            activeStream = fallbackStream;
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
            if (project?.audioSettings?.isBackstageEnabled) {
              handleToggleBackstage();
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
      if (webcamRef.current) {
        webcamRef.current.srcObject = null;
      }
    };
  }, [showWebcam, project?.audioSettings?.isBackstageEnabled, project?.audioSettings?.webcamDeviceId, handleToggleBackstage]);


  useTimelineHotkeys({
    projectRef,
    selectedSegmentIds,
    currentTimeRef,
    isRecordingRef,
    togglePlay,
    stopRecording,
    discardRecording,
    handleSplitSegment: handleSplit,
    handleSeek,
    addMarker,
    deleteSegments,
    handleToggleRecord,
    handleToggleBackstage,
    handleDeleteLastTake,
    handleJoinSegments,
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
  const [pendingExportFormat, setPendingExportFormat] = useState<'WAV' | 'MP3' | 'FLAC'>('WAV');

  const handleExport = async (options: { 
    format: 'WAV' | 'MP3' | 'FLAC', 
    includeVideo: boolean, 
    includeOriginalAudio: boolean,
    forceMono: boolean 
  }) => {
    logger.info("handleExport triggered with options:", options);
    if (!project || !project.projectPath) {
      alert("Настройте или сохраните проект перед экспортом.");
      return;
    }

    const { format, includeVideo, includeOriginalAudio, forceMono } = options;
    const safeFormat = format || 'WAV';

    const exportTracks = project.tracks.filter(t => {
      if (t.name === 'Оригинал') return includeOriginalAudio;
      return true; // Dubs track
    }).map(track => ({
      id: track.id,
      volume: track.volume,
      isMuted: track.isMuted,
      isSolo: track.isSolo,
      segments: track.segments.map(seg => ({
        id: seg.id || `seg-${Date.now()}-${Math.random()}`,
        filePath: seg.filePath || '',
        startTime: seg.startTime,
        duration: seg.duration,
        fileOffset: seg.fileOffset || 0,
        fileDuration: seg.fileDuration || seg.duration,
        gain: seg.gain,
        playbackRate: seg.playbackRate,
      })).filter(s => s.filePath !== '')
    }));

    const hasSegments = exportTracks.some(t => t.segments.length > 0);

    if (!hasSegments) {
      alert("No recorded segments to export.");
      return;
    }
    
    const saveFileRes = await window.electronAPI.saveFile({
      title: 'Export Audio',
      defaultPath: `${project.name}_export.${safeFormat.toLowerCase()}`,
      filters: [{ name: safeFormat, extensions: [safeFormat.toLowerCase()] }]
    });

    if (!saveFileRes.success || !saveFileRes.data) return;
    const outputPath = saveFileRes.data;
    
    setIsExporting(true);
    setExportProgress(0);
    setIsExportModalOpen(false);

    let unsubscribe: (() => void) | undefined;

    if (window.electronAPI) {
      unsubscribe = window.electronAPI.onExportProgress((percent) => {
        setExportProgress(percent);
      });

      try {
        logger.info(`Starting audio export to ${outputPath} in format ${safeFormat}`);
        const resultRes = await window.electronAPI.exportAudio({ 
          projectJson: JSON.stringify({
            tracks: exportTracks.map(t => ({
              name: project.tracks.find(pt => pt.id === t.id)?.name || 'Track',
              isMuted: t.isMuted,
              isSolo: t.isSolo,
              segments: t.segments
            })),
            audioOffsetMs: project.audioOffsetMs || 0
          }),
          outputPath,
          format: safeFormat.toLowerCase() as any,
          bitDepth: project.audioSettings?.bitDepth?.toString() || '16',
          ...(project.audioSettings?.exportSettings && {
            bitrate: `${project.audioSettings.exportSettings.mp3Bitrate}k`
          })
        });

        if (resultRes.success) {
          alert(`Экспорт успешно завершен: ${outputPath}`);
          logger.info("Audio export successful.");
        } else {
          throw new Error(resultRes.error || 'Unknown export error');
        }
      } catch (error) {
        console.error("Export failed:", error);
        alert(`Ошибка экспорта: ${error instanceof Error ? error.message : String(error)}`);
        logger.error("Audio export operation failed:", error);
      } finally {
        if (unsubscribe) unsubscribe();
        setIsExporting(false);
      }
      return;
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
          const newTracks = prev.tracks.map(track => {
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

  const handleMuxVideo = async () => {
    if (!project || !project.projectPath || !project.videoPath) {
      alert("Сначала настройте проект и выберите видео.");
      return;
    }

    const saveRes = await window.electronAPI.saveFile({
        title: 'Экспорт финального видео (Mix)',
        defaultPath: `${project.name}_final.mp4`,
        filters: [{ name: 'Video', extensions: ['mp4'] }]
    });

    if (!saveRes.success || !saveRes.data) return;
    const finalOutputPath = saveRes.data;
    
    setIsExporting(true);
    setExportProgress(0);
    setExportOperation('Initializing video mix...');

    if (window.electronAPI) {
      const unsubscribe = window.electronAPI.onExportProgress((percent) => {
        setExportProgress(percent);
      });

      try {
        const tempAudioPath = `${project.projectPath}/temp_master_mux.wav`.replace(/\\/g, '/');
        
        // 1. Export current mix to a temp WAV first, because muxing needs one.
        setExportOperation('Mixing project audio...');
        logger.info(`Mixing project audio to ${tempAudioPath}`);
        
        const audioRes = await window.electronAPI.exportAudio({ 
          projectJson: JSON.stringify({
            tracks: project.tracks.map(t => ({
              name: t.name,
              isMuted: t.isMuted,
              isSolo: t.isSolo,
              segments: t.segments
            })),
            audioOffsetMs: project.audioOffsetMs || 0
          }),
          outputPath: tempAudioPath,
          format: 'wav',
          bitDepth: '16'
        });

        if (!audioRes.success) {
          throw new Error(`Ошибка сведения аудио: ${audioRes.error}`);
        }

        // 2. Mux video with the newly created temp audio
        setExportOperation('Muxing video with audio...');
        logger.info(`Muxing video from ${project.videoPath} with audio ${tempAudioPath} to ${finalOutputPath}`);
        
        const resultRes = await window.electronAPI.muxVideo({ 
          videoPath: project.videoPath,
          audioPath: tempAudioPath,
          outputPath: finalOutputPath
        });

        if (resultRes.success) {
          alert(`Финальное видео успешно сохранено: ${finalOutputPath}`);
          logger.info("Video muxing successful.");
        } else {
          throw new Error(resultRes.error || 'Unknown mux error');
        }
      } catch (error) {
        console.error("Muxing failed:", error);
        alert(`Ошибка при создании видео: ${error instanceof Error ? error.message : String(error)}`);
        logger.error("Muxing failed:", error);
      } finally {
        unsubscribe();
        setIsExporting(false);
        setExportOperation('');
      }
      return;
    }
  };

  useEffect(() => {
    if (videoRef.current && project) {
      playbackEngine.bindVideoElement(videoRef.current);
      if (referenceAudioRef.current) {
        playbackEngine.bindReferenceAudio(referenceAudioRef.current);
      }
    }
  }, [project, videoRef, referenceAudioRef]);

  const handleQuickPreview = async (segmentId: string) => {
    if (!project || !project.projectPath) {
      alert("Please save the project first.");
      return;
    }
    
    setIsExporting(true);
    setExportProgress(0);

    if (window.electronAPI) {
      const unsubscribe = window.electronAPI.onExportProgress((percent) => {
        setExportProgress(percent);
      });

      try {
        const result = await window.electronAPI.quickPreviewExport({ 
          projectPath: project.projectPath,
          segmentId
        });
        if (result) {
          alert(`Экспорт превью завершен: ${result}`);
        }
      } catch (error) {
        console.error("Quick Preview failed:", error);
        alert(`Ошибка превью: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        unsubscribe();
        setIsExporting(false);
      }
      return;
    }
  };

  const currentLine = project?.subtitles.find(l => currentTime >= l.start - 0.5 && currentTime <= l.end);
  const nextLine = project?.subtitles.find(l => l.start > currentTime);

  const projectContextValue = {
    project, setProject, recentProjects, handleNewProject, handleOpenProject, handleSaveProject, onLoadProject,
    undo, redo, canUndo, canRedo
  };
  const timelineContextValue = {
    currentTime, duration, isPlaying, zoomLevel, timelineHeight, isAutoHeight, sidebarWidth,
    isRippleEnabled, selectedSegmentIds, isLooping, loopRange, currentTimeRef, videoRef, referenceAudioRef,
    setCurrentTime, setDuration, setIsPlaying, setZoomLevel, setTimelineHeight, setIsAutoHeight, setSidebarWidth,
    setIsRippleEnabled, setSelectedSegmentIds, setIsLooping, setLoopRange, togglePlay, handleSeek
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
              (Поддерживается: mp4, wav, flac, ass, srt, vtt, fb2, txt, csv и др.)
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
        handleToggleBackstage={handleToggleBackstage}
        setShowQuickImport={setShowQuickImport}
        handleBulkImport={handleBulkImport}
        isElectron={isElectron}
        handleExport={(format) => {
          setPendingExportFormat(format);
          setIsExportModalOpen(true);
        }}
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
          <div className="flex-1 min-h-0 relative flex items-center justify-center group">
            {!project || (!project.videoPath && !project.videoUrl) ? (
              <div className="flex flex-col items-center justify-center gap-6">
                <div className="w-24 h-24 bg-zinc-900 rounded-full flex items-center justify-center border border-white/5">
                  <FileVideo className="w-10 h-10 text-zinc-700" />
                </div>
                <div className="text-center">
                  <h3 className="text-xl font-bold text-zinc-400 mb-2">Рабочая область готова</h3>
                  <p className="text-sm text-zinc-600">Перетащите видео или субтитры, чтобы начать</p>
                </div>
              </div>
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
                src={project.videoPath ? getSafeFileUrl(project.videoPath.startsWith('./') && project.projectPath ? `${project.projectPath}/${project.videoPath.slice(2)}` : project.videoPath) : project.videoUrl ? project.videoUrl : undefined}
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
                    const tracks = p.tracks.map(t => {
                      if (t.name === 'Оригинал') {
                        return {
                          ...t,
                          segments: t.segments.map(s => 
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
                      const tracks = p.tracks.map(t => {
                        if (t.name === 'Оригинал') {
                          return {
                            ...t,
                            segments: t.segments.map(s => 
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
                src={getSafeFileUrl(project.referenceAudioPath.startsWith('./') && project.projectPath ? `${project.projectPath}/${project.referenceAudioPath.slice(2)}` : project.referenceAudioPath)} 
                onLoadedMetadata={(e) => {
                  if (!project.videoPath && !project.videoUrl) {
                    setDuration(e.currentTarget.duration);
                  }
                }}
              />
            )}
            
            {project && (
              <ActorOverlay 
                currentLine={currentLine} 
                nextLine={nextLine} 
                currentTime={currentTime}
                showWebcam={showWebcam || !!project.audioSettings?.isBackstageEnabled}
                webcamRef={webcamRef}
                isRecording={isRecording}
                recordingStream={recordingStream}
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
                isBackstageRecording={project?.audioSettings?.backstageMode === 'manual' ? isManualBackstageRecording : (isRecording && isBackstageRecording)}
                activeRole={project.selectedRole || ''}
                project={project}
                onSettingsChange={(newSettings) => setProject({ ...project, audioSettings: newSettings })}
                onSeek={handleSeek}
              />
            )}

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
                    {window.electronAPI && project?.videoPath && project?.projectPath && (
                      <button 
                        onClick={async () => {
                          try {
                            setVideoError("Создание прокси-видео (это может занять время)...");
                            const proxyRes = await window.electronAPI.createProxyVideo(project.videoPath!, project.projectPath!);
                            const proxyPath = proxyRes.success && proxyRes.data ? proxyRes.data : project.videoPath;
                            
                            // Also ensure peaks/audio are extracted if not already
                            if (!project.referenceAudioPath) {
                              const res = await window.electronAPI.extractAudioPeaks(project.videoPath!, project.projectPath!);
                              if (res.success && res.data) {
                                const audioData = res.data;
                                const refPath = audioData.filePath;
                                setProject({ 
                                  ...project, 
                                  videoPath: proxyPath,
                                  originalPeaks: audioData.peaks,
                                  referenceAudioPath: refPath
                                });
                              }
                            } else {
                              setProject({ 
                                ...project, 
                                videoPath: proxyPath
                              });
                            }
                            setVideoError(null);
                          } catch (err) {
                            setVideoError(`Ошибка создания прокси: ${err}`);
                          }
                        }} 
                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-bold transition-all shadow-lg shadow-indigo-600/20"
                      >
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
                          setProject({ ...project, videoUrl: "https://vjs.zencdn.net/v/oceans.mp4" });
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
                    onClick={() => setTeleprompterMode(m => m === 'compact' ? 'expanded' : 'compact')}
                    className={cn(
                      "p-2 rounded-lg transition-colors",
                      teleprompterMode === 'expanded' ? "bg-indigo-600 text-white" : "hover:bg-white/10 text-zinc-400"
                    )}
                    title="Переключить режим телесуфлера"
                  >
                    <LayoutTemplate className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={handleToggleBackstage}
                    className={cn(
                      "p-2 rounded-lg transition-colors",
                      project?.audioSettings?.isBackstageEnabled ? "bg-indigo-600 text-white" : "hover:bg-white/10 text-zinc-400"
                    )}
                    title="Переключить камеру актера"
                  >
                    <VideoIcon className="w-5 h-5" />
                  </button>
                  <button className="p-2 hover:bg-white/10 rounded-lg transition-colors" title="Настройки громкости"><Volume2 className="w-5 h-5" /></button>
                  <button className="p-2 hover:bg-white/10 rounded-lg transition-colors" title="Настройки монитора"><Monitor className="w-5 h-5" /></button>
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
              onToggleRecord={handleToggleRecord}
              recordingStream={recordingStream}
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
              isBackstageRecording={project?.audioSettings?.backstageMode === 'manual' ? isManualBackstageRecording : isBackstageRecording}
              onToggleBackstage={handleToggleBackstage}
              backstageMode={project?.audioSettings?.backstageMode || 'parallel'}
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
                  onSelectSegment={(segmentId, multi) => {
                    setSelectedSegmentIds(prev => {
                      if (multi) {
                        return prev.includes(segmentId) ? prev.filter(id => id !== segmentId) : [...prev, segmentId];
                      } else {
                        return [segmentId];
                      }
                    });
                  }}
                  onClearSelection={() => setSelectedSegmentIds([])}
                  onGlueSegments={handleGlueSegments}
                  onUpdateTrack={(trackId, updates) => {
                    if (!project) return;
                    const updatedTracks = project.tracks.map(t => t.id === trackId ? { ...t, ...updates } : t);
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
                      const updatedTracks = project.tracks.map(track => ({ ...track, ...updates }));
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

      <ModalsManager />

      {isExportModalOpen && (
        <ExportModal 
          onExport={(options) => handleExport(options)} 
          onCancel={() => setIsExportModalOpen(false)} 
          initialFormat={pendingExportFormat}
        />
      )}
      
      <StyledExportOverlay 
        isExporting={isExporting} 
        exportProgress={exportProgress} 
        exportOperation={exportOperation} 
      />
    </div>
      </TimelineProvider>
    </UIProvider>
    </ProjectProvider>
  );
}