export interface SubtitleLine {
  id: string;
  start: number; // seconds
  end: number;   // seconds
  text: string;
  role: string;
  needsFix?: boolean;
  fixComment?: string;
}

export interface AudioSettings {
  deviceId?: string;
  outputDeviceId?: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  sampleRate: number;
  bitDepth: 16 | 24 | 32;
  channelIndex?: number;
  asioMode?: boolean; // Experimental low-latency raw ASIO/WASAPI Exclusive mode
  host?: string; // ASIO, WASAPI, etc.
  limiterEnabled?: boolean;
  limiterThreshold?: number; // dB
  // New effects parameters
  noiseGateThreshold: number; // dB
  isNoiseGateEnabled?: boolean;
  compressorThreshold: number; // dB
  compressorRatio: number;
  highPassFrequency: number; // Hz
  isDestructive: boolean; // Whether to save processed audio
  webcamDeviceId?: string;
  backstageAudioDeviceId?: string;
  webcamResolutionX?: number;
  webcamResolutionY?: number;
  webcamBitrate?: number; // in bits per second
  webcamExportOverlay?: boolean; // Whether to export with overlay or just raw backstage video
  backstageFolderPath?: string;
  isBackstageEnabled?: boolean;
  backstageMode?: string;
  keyMap?: KeyMap;
  exportSettings?: {
    mp3Bitrate: number;
    flacCompression: number;
    sampleRate: number;
  };
  playOriginalTrackSegments?: boolean;
}

export interface BackstageSession {
  id: string;
  startTime: number;
  duration: number;
  videoPath: string;
  originalVideoPath?: string;
  dubs: {
    segmentId: string;
    backstageStartTime: number;
    backstageEndTime: number;
    timelineStartTime: number;
  }[];
  speakingActivities?: {
    start: number;
    end: number;
  }[];
  sessionId?: string; // Дублирует id по требованию
  rawVideoPath?: string; // Дублирует videoPath по требованию
  totalDuration?: number; // Общая длительность в секундах
  blocks?: TimelineBlock[]; // Блоки таймлайна
}

export type TimelineBlockType = 'dub' | 'speaking' | 'silence';

export interface TimelineBlock {
  id: string;
  type: TimelineBlockType;
  duration: number; // Длительность блока в секундах
  originalStart: number; // Абсолютное время начала в исходном файле
  originalEnd: number; // Абсолютное время конца в исходном файле
  isFavorite?: boolean; // Флаг добавления в Избранное
  videoRefStart?: number;
  videoRefEnd?: number;
  start?: number; // Время начала на таймлайне (в секундах)
  end?: number; // Время конца на таймлайне (в секундах)
  text?: string; // Текст субтитров или реплики
}

export interface ExportSettings {
  includeOriginal: boolean;
  aspectRatio: '16:9' | '9:16';
  splitShortVideos: boolean;
  professionalEditing: boolean;
  onlyFavorites?: boolean; // Только избранное
  useAudioTransitions?: boolean; // Использование J/L катов
}

export interface ExportPreset {
  id: string;
  name: string;
  settings: ExportSettings;
}

export interface HotkeyAction {
  label: string;
  code: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export type KeyMap = Record<string, HotkeyAction>;

export interface Fix {
  id: string;
  segmentId?: string; // Связь с сегментом, если найден
  timestamp: number; // В секундах
  actor: string;
  comment: string;
  isResolved: boolean;
}

export interface Marker {
  id: string;
  time: number; // seconds
  label?: string;
  color?: string;
}

export interface ProjectUIState {
  zoomLevel?: number;
  timelineHeight?: number;
  sidebarWidth?: number;
  teleprompterMode?: 'compact' | 'expanded';
  teleprompterFontSize?: number;
  teleprompterLineHeight?: number;
  teleprompterPacing?: 'auto' | 'manual';
  teleprompterSpeed?: number;
  teleprompterPosition?: { x: number; y: number };
  teleprompterSize?: { width: number; height: number };
  showFixes?: boolean;
}

export interface Project {
  id: string;
  name: string;
  videoUrl?: string;
  videoPath?: string; // Local path for Electron
  referenceAudioPath?: string; // Path to reference audio for shadowing
  documentPath?: string; // Path to .txt or .pdf
  documentContent?: string; // Cached content for .txt
  projectPath?: string; // Root folder for project files
  originalPeaks?: number[]; // Waveform peaks for original audio
  subtitles: SubtitleLine[];
  roles: string[];
  selectedRole?: string;
  tracks: AudioTrack[];
  markers?: Marker[]; // Timeline bookmarks
  latencyOffset: number; // ms
  audioOffsetMs: number; // New global offset for latency compensation
  audioSettings: AudioSettings;
  fixes?: Fix[]; // Сделаем опциональным
  uiState?: ProjectUIState;
  subtitlesOffset?: number; // Сдвиг таймингов субтитров в секундах
}

export interface AudioTrack {
  id: string;
  name: string;
  segments: AudioSegment[];
  volume: number;
  isMuted: boolean;
  isSolo?: boolean;
  isArmed?: boolean;
  processing?: TrackProcessing;
  height?: number;
}

export interface TrackProcessing {
  enabled: boolean;
  lufsNormalize?: {
    enabled: boolean;
    target?: number; // Default -16
  };
  noiseGate?: {
    enabled: boolean;
    threshold?: number; // dB
  };
  compressor?: {
    enabled: boolean;
    threshold?: number;
    ratio?: number;
  };
  eq?: {
    enabled: boolean;
    highPass?: number; // Hz
    lowPass?: number; // Hz
  };
  fades?: {
    enabled: boolean;
    duration?: number; // ms
  };
}

export interface AudioSegment {
  id: string;
  startTime: number; // Start on timeline (seconds)
  duration: number; // Visible duration on timeline (seconds)
  fileOffset: number; // Offset from start of recorded file (seconds)
  fileDuration: number; // Total duration of the recorded file (seconds)
  blobUrl: string;
  filePath?: string; // Local path for Electron
  backstageVideoPath?: string; // Local path for backstage recording
  waveform?: number[]; // Normalized peaks for visualization
  gain: number;
  playbackRate: number; // For Smart Align (Time Stretching)
  originalFileName?: string; // For bulk import/export
  text?: string;
  fadeIn?: number; // Fade in duration (seconds)
  fadeOut?: number; // Fade out duration (seconds)
  isExtractingWaveform?: boolean; // Temporary state for async loaded waveforms
  recordedAt?: number; // Timestamp when recorded
}

export interface BridgeResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

declare global {
  interface Window {
    electronAPI: {
      openVideo: () => Promise<BridgeResponse<{ path: string, name: string, projectPath: string, size: number }>>;
      createProxyVideo: (videoPath: string, projectPath: string) => Promise<BridgeResponse<string>>;
      openSubtitles: () => Promise<BridgeResponse<{ path: string, name: string, parsed: { roles: string[], subtitles: any[] } }>>;
      extractAudioPeaks: (videoPath: string, projectPath: string) => Promise<BridgeResponse<{ filePath: string, peaks: Float32Array, duration: number }>>;
      saveTake: (data: { projectPath: string, role: string, startTime: number, audioData: Uint8Array }) => Promise<BridgeResponse<{ filePath: string, peaks: Float32Array }>>;
      appendBackstageChunk: (data: { projectPath: string, sessionId: string, chunkData: Uint8Array }) => Promise<BridgeResponse<void>>;
      finalizeBackstageSession: (data: { projectPath: string, sessionId: string }) => Promise<BridgeResponse<string>>;
      listBackstageSessions: (projectPath: string) => Promise<BridgeResponse<string[]>>;
      writeTextFile: (data: { path: string, data: string }) => Promise<BridgeResponse<void>>;
      exportAudio: (options: any) => Promise<BridgeResponse<{ success: boolean }>>;
      initProject: (projectPath: string) => Promise<BridgeResponse<void>>;
      generateStressTest: (projectId: string, trackId: string, projectPath: string) => Promise<BridgeResponse<void>>;
      loadSegmentsInRange: (trackId: string, startTime: number, endTime: number) => Promise<BridgeResponse<any[]>>;
      saveProjectJson: (data: { projectPath: string, projectData: Project }) => Promise<BridgeResponse<boolean>>;
      loadProjectJson: (projectPath: string) => Promise<BridgeResponse<Project>>;
      copyFileToProject: (src: string, destDir: string) => Promise<BridgeResponse<string>>;
      deleteFile: (path: string) => Promise<BridgeResponse<void>>;
      importLegacyJson: (jsonString: string) => Promise<BridgeResponse<string>>;
      muxVideo: (data: { videoPath: string, audioPath: string, outputPath: string, duration?: number }) => Promise<BridgeResponse<{ success: boolean }>>;
      quickPreviewExport: (data: { projectPath: string, segmentId: string }) => Promise<BridgeResponse<{ success: boolean }>>;
      requestPermissions: () => Promise<BridgeResponse<boolean>>;
      onExportProgress: (callback: (progress: number) => void) => () => void;
      getAudioDevices: () => Promise<BridgeResponse<{ id: string, name: string, host: string, sampleRate: number, channels: number }[]>>;
      startAsioRecording: (device: string, sampleRate: number, bufferSize: number, trackId: string, segmentId: string, startTime: number, hostName?: string, channelIndex?: number, backstageRecord?: boolean, videoDevice?: string | null, audioDevice?: string | null, projectPath?: string | null, gateEnabled?: boolean, gateThreshold?: number, limiterEnabled?: boolean, limiterThreshold?: number) => Promise<BridgeResponse<void>>;
      checkCrashes: () => Promise<BridgeResponse<any[]>>;
      generateWaveformPeaks: (data: { filePath: string, points: number }) => Promise<BridgeResponse<number[]>>;
      getFileInfo: (filePath: string) => Promise<BridgeResponse<{ path: string, name: string, projectPath: string, size: number, duration: number }>>;
      stopAsioRecording: () => Promise<BridgeResponse<{ filePath: string, videoPath?: string, metadata: { peaks: Float32Array, duration: number } }>>;
      openFile: (options: { title: string, filters: { name: string, extensions: string[] }[] }) => Promise<BridgeResponse<{ path: string, name: string, content?: string }>>;
      saveFile: (options: { title: string, defaultPath: string, filters: { name: string, extensions: string[] }[] }) => Promise<BridgeResponse<string>>;
      openFolder: () => Promise<BridgeResponse<string>>;
      getAudioFiles: (folderPath: string) => Promise<BridgeResponse<{ path: string, name: string, duration: number, peaks: number[] }[]>>;
      batchExport: (options: { 
        outDir: string; 
        origSegments: { startTime: number; duration: number; originalFileName: string }[];
        dubSegments: { filePath: string; startTime: number; duration: number; fileOffset: number; gain: number; playbackRate: number }[];
      }) => Promise<BridgeResponse<string[]>>;
      exportAudioBook: (options: any) => Promise<BridgeResponse<{ success: boolean, path?: string }>>;
      exportAllStems: (args: { projectId: string, projectName: string, outputPath: string }) => Promise<BridgeResponse<string>>;
      exportStems: (options: { projectData: any, outputDir: string, bitDepth?: string }) => Promise<BridgeResponse<string[]>>;
      onStemProgress: (callback: (data: { current: number, total: number, trackName: string }) => void) => () => void;
      onMediaProgress: (callback: (data: { time: string, percent: number, operation: string }) => void) => () => void;
      mergeSegments: (data: { segments: { filePath: string, startTime: number, gain: number }[], outputPath: string }) => Promise<BridgeResponse<{ filePath: string, duration: number, peaks: Float32Array }>>;
      mergeProjectSegments: (data: { projectPath: string, trackId: string, segments: string[] }) => Promise<BridgeResponse<string>>;
      readTextFile: (path: string) => Promise<BridgeResponse<string>>;
      readBinaryFile: (path: string) => Promise<BridgeResponse<Uint8Array>>;
      verifyProjectFiles: (projectId: string, projectRoot: string) => Promise<BridgeResponse<{ missingSegments: any[], orphanedFiles: string[] }>>;
      calculateFileHash: (path: string) => Promise<BridgeResponse<string>>;
      findFileByHash: (searchRoot: string, targetHash: string) => Promise<BridgeResponse<string | null>>;
      relinkSegmentFile: (segmentId: string, newPath: string) => Promise<BridgeResponse<void>>;
      cleanupOrphanedFiles: (files: string[]) => Promise<BridgeResponse<void>>;
      concatBackstageVideos: (data: { videoPaths: string[], outputPath: string, backstageMode?: string, isBackstageEnabled?: boolean }) => Promise<BridgeResponse<string>>;
      exportBackstageVideo: (data: { mainVideoPath: string, backstageVideoPath: string, finalAudioPath: string, outputPath: string, webcamExportOverlay?: boolean }) => Promise<BridgeResponse<string>>;
      exportBlooper: (data: { videoPath: string, audioPath: string, startTime: number, endTime: number, voiceOffset: number, outputPath: string }) => Promise<BridgeResponse<string>>;
      processBackstageShorts: (data: { videoPath: string, outputPath: string }) => Promise<BridgeResponse<string>>;
      processBackstageRemoveSilence: (data: { videoPath: string, dubs: {start: number, end: number}[], outputPath: string }) => Promise<BridgeResponse<string>>;
      exportBackstageAssemble: (data: { videoPath: string, originalVideoPath?: string, subtitles: {start: number, end: number, text: string}[], blocks: TimelineBlock[], settings: ExportSettings, outputPath: string }) => Promise<BridgeResponse<string>>;
      moveProject: (oldPath: string, newPath: string) => Promise<BridgeResponse<boolean>>;
      openPath: (path: string) => Promise<BridgeResponse<void>>;
      forceStopAll: () => Promise<BridgeResponse<void>>;
      getMediaInfo: (path: string) => Promise<BridgeResponse<string>>;
      extractMkvAssets: (data: { inputPath: string, videoOutput: string, subOutput?: string, audioIndex: number, subIndex?: number, duration?: number }) => Promise<BridgeResponse<string>>;
      createBlankVideo: (duration: number, outputPath: string) => Promise<BridgeResponse<string>>;
    };
  }
}
