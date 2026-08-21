import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  X, Trash2, Copy, Settings2, Video, Scissors, Star, Sparkles, Download, Play, Pause, RotateCcw,
  AlertTriangle, FileQuestion, RefreshCw, FolderOpen, VideoOff, Info, Check, ExternalLink, ShieldAlert, FileText, AlertCircle 
} from "lucide-react";
import { BackstageSession, TimelineBlock, ExportSettings, ExportPreset, TimelineBlockType } from "../types";
import { getSafeFileUrl } from "../lib/utils";
import { ExportSettingsPanel } from "./backstage/ExportSettingsPanel";
import { BackstageTimelineRenderer } from "./backstage/BackstageTimelineRenderer";
import { BlockEditorPanel } from "./backstage/BlockEditorPanel";
import { useBackstageBlocks } from "../hooks/backstage/useBackstageBlocks";
import { useBackstageExport } from "../hooks/backstage/useBackstageExport";

export interface BackstageReadDiagnostic {
  id: string;
  resource: string;
  errorType: "session_json_corrupt" | "file_missing" | "media_unreadable" | "invalid_data" | "io_error";
  message: string;
  timestamp: string;
}

interface BackstageEditorProps {
  onClose: () => void;
  projectPath: string;
  projectSubtitles: { start: number; end: number; text: string }[];
}

const BackstageEditor: React.FC<BackstageEditorProps> = ({
  onClose,
  projectPath,
  projectSubtitles = [],
}) => {
  const [sessions, setSessions] = useState<BackstageSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<BackstageSession | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimelineTime, setCurrentTimelineTime] = useState(0);

  // Diagnostics state
  const [readDiagnostics, setReadDiagnostics] = useState<BackstageReadDiagnostic[]>([]);
  const [showDiagnosticsPanel, setShowDiagnosticsPanel] = useState(false);
  const [videoLoadError, setVideoLoadError] = useState<string | null>(null);
  const [ignoreVideoError, setIgnoreVideoError] = useState(false);

  const addDiagnostic = useCallback((diag: Omit<BackstageReadDiagnostic, "timestamp">) => {
    setReadDiagnostics((prev) => {
      if (prev.some((d) => d.resource === diag.resource && d.message === diag.message)) return prev;
      return [
        ...prev,
        {
          ...diag,
          timestamp: new Date().toLocaleTimeString(),
        },
      ];
    });
  }, []);

  const {
    blocks,
    setBlocks,
    selectedBlockId,
    setSelectedBlockId,
    handleDeleteBlock,
    handleCopyBlock,
    handleRemoveAllSilence,
    handleRemoveGarbage,
    handleUpdateBlockTimes,
    handleChangeBlockType,
    handleSplitBlock,
    handleDrop,
    handleRemoveSilence,
    handleExportShorts
  } = useBackstageBlocks(
    setIsProcessing,
    projectPath,
    projectSubtitles,
    selectedSession,
    setSelectedSession,
    setSessions,
    setCurrentTimelineTime,
    setIsPlaying
  );

  const {
    exportSettings,
    selectedPresetId,
    handleSelectPreset,
    handleUpdateSetting,
    handleAssembleVideo,
    handleExportSingleBlock,
    EXPORT_PRESETS
  } = useBackstageExport(
    selectedSession,
    blocks,
    projectSubtitles,
    setIsProcessing
  );

  // Load sessions safely with diagnostic capture
  const loadSessions = useCallback(() => {
    if (!projectPath || !window.electronAPI) return;
    setVideoLoadError(null);
    setIgnoreVideoError(false);

    window.electronAPI.listBackstageSessions(projectPath).then((res) => {
      if (!res || !res.success) {
        addDiagnostic({
          id: "list_sessions_fail",
          resource: `${projectPath}/takes`,
          errorType: "io_error",
          message: res?.error || "Не удалось прочитать список сессий из папки проекта",
        });
        return;
      }

      const rawList = Array.isArray(res.data) ? res.data : [];
      const parsedList: BackstageSession[] = [];

      rawList.forEach((s: any, index: number) => {
        let itemObj: any = s;
        const itemLabel = `Сессия #${index + 1}`;

        if (typeof s === "string") {
          try {
            itemObj = JSON.parse(s);
          } catch (jsonErr: any) {
            addDiagnostic({
              id: `session_json_${index}`,
              resource: `${projectPath}/takes/backstage_session_${index}.json`,
              errorType: "session_json_corrupt",
              message: `Ошибка синтаксиса JSON: ${jsonErr?.message || "Некорректный формат файла"}`,
            });
            return;
          }
        }

        if (!itemObj || typeof itemObj !== "object") {
          addDiagnostic({
            id: `session_invalid_${index}`,
            resource: itemLabel,
            errorType: "invalid_data",
            message: "Файл сессии пуст или содержит данные неизвестного формата",
          });
          return;
        }

        if (!itemObj.id) {
          addDiagnostic({
            id: `session_noid_${index}`,
            resource: itemLabel,
            errorType: "invalid_data",
            message: "В структуре данных сессии отсутствует обязательное поле id",
          });
          return;
        }

        const durationSec = Number(itemObj.duration);
        const validDuration = !isNaN(durationSec) && durationSec > 0 ? durationSec : 1000;

        if (isNaN(durationSec) || durationSec <= 0) {
          addDiagnostic({
            id: itemObj.id,
            resource: `backstage_session_${itemObj.id}.json`,
            errorType: "invalid_data",
            message: `Повреждено значение длительности записи (${itemObj.duration}). Применено резервное значение 1с.`,
          });
        }

        parsedList.push({
          ...itemObj,
          duration: validDuration,
          blocks: Array.isArray(itemObj.blocks) ? itemObj.blocks : [],
          dubs: Array.isArray(itemObj.dubs) ? itemObj.dubs : [],
          speakingActivities: Array.isArray(itemObj.speakingActivities) ? itemObj.speakingActivities : [],
        });
      });

      setSessions(parsedList);
      if (parsedList.length > 0 && !selectedSession) {
        setSelectedSession(parsedList[0]);
      }
    }).catch((err) => {
      addDiagnostic({
        id: "list_sessions_exception",
        resource: `${projectPath}/takes`,
        errorType: "io_error",
        message: `Исключение файловой системы: ${err?.message || String(err)}`,
      });
    });
  }, [projectPath, selectedSession, addDiagnostic]);

  useEffect(() => {
    loadSessions();
  }, [projectPath]);

  // Reset video error on session change
  useEffect(() => {
    setVideoLoadError(null);
    setIgnoreVideoError(false);
  }, [selectedSession?.id]);

  // Relink video file
  const handleRelinkVideo = async () => {
    if (!selectedSession || !window.electronAPI) return;
    try {
      const res = await window.electronAPI.openVideo();
      if (res && res.success && res.data) {
        const newPath = res.data;
        const updatedSession: BackstageSession = {
          ...selectedSession,
          videoPath: newPath,
          rawVideoPath: newPath,
        };
        setSelectedSession(updatedSession);
        setSessions((prev) => prev.map((s) => (s.id === selectedSession.id ? updatedSession : s)));
        setVideoLoadError(null);
        setIgnoreVideoError(false);

        // Save updated session JSON
        window.electronAPI.writeTextFile({
          path: `${projectPath}/takes/backstage_session_${selectedSession.id}.json`,
          data: JSON.stringify(updatedSession, null, 2),
        }).catch((err) => {
          console.warn("Не удалось сохранить обновленный путь видео:", err);
        });
      }
    } catch (e: any) {
      addDiagnostic({
        id: selectedSession.id,
        resource: selectedSession.videoPath,
        errorType: "io_error",
        message: `Ошибка выбора нового видеофайла: ${e?.message || String(e)}`,
      });
    }
  };

  // Delete corrupted session file
  const handleDeleteCorruptedSession = async (sessionId: string) => {
    if (!projectPath || !window.electronAPI) return;
    try {
      await window.electronAPI.deleteFile(`${projectPath}/takes/backstage_session_${sessionId}.json`).catch(() => {});
      await window.electronAPI.deleteFile(`${projectPath}/takes/backstage_session_${sessionId}.webm`).catch(() => {});
      
      const remaining = sessions.filter((s) => s.id !== sessionId);
      setSessions(remaining);
      setSelectedSession(remaining.length > 0 ? remaining[0] : null);
      setReadDiagnostics((prev) => prev.filter((d) => d.id !== sessionId));
      setVideoLoadError(null);
    } catch (e: any) {
      console.error("Ошибка удаления поврежденной сессии:", e);
    }
  };

  const totalEditedDuration = useMemo(
    () => (blocks || []).reduce((acc, b) => acc + (b?.duration || 0), 0),
    [blocks],
  );

  const filteredBlocks = useMemo(
    () =>
      exportSettings?.onlyFavorites
        ? (blocks || []).filter((b) => b?.isFavorite)
        : (blocks || []),
    [blocks, exportSettings?.onlyFavorites],
  );

  const filteredDuration = useMemo(
    () => (filteredBlocks || []).reduce((acc, b) => acc + (b?.duration || 0), 0),
    [filteredBlocks],
  );

  const selectedBlock = useMemo(
    () => (blocks || []).find((b) => b?.id === selectedBlockId),
    [blocks, selectedBlockId],
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const animationRef = useRef<number>();

  interface PlaybackSegment {
    blockId: string;
    exportStart: number;
    exportEnd: number;
    timelineStart: number;
    timelineEnd: number;
    videoStart: number;
    videoEnd: number;
  }

  const playbackSegments = useMemo<PlaybackSegment[]>(() => {
    let exportT = 0;
    let timelineT = 0;
    const segs: PlaybackSegment[] = [];

    for (const b of blocks || []) {
      if (!b) continue;
      const isIncluded = exportSettings?.onlyFavorites ? b.isFavorite : true;
      const dur = Number.isFinite(b.duration) && b.duration > 0 ? b.duration : 0.1;

      if (isIncluded) {
        const videoStart = b.originalStart ?? b.start ?? 0;
        const videoEnd = b.originalEnd ?? b.end ?? (videoStart + dur);
        segs.push({
          blockId: b.id,
          exportStart: exportT,
          exportEnd: exportT + dur,
          timelineStart: timelineT,
          timelineEnd: timelineT + dur,
          videoStart,
          videoEnd,
        });
        exportT += dur;
      }
      timelineT += dur;
    }

    return segs;
  }, [blocks, exportSettings?.onlyFavorites]);

  useEffect(() => {
    let lastTime = performance.now();

    const loop = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      setCurrentTimelineTime((prev) => {
        let newTime = prev + delta;
        if (newTime >= filteredDuration) {
          setIsPlaying(false);
          return filteredDuration;
        }
        return newTime;
      });

      animationRef.current = requestAnimationFrame(loop);
    };

    if (isPlaying) {
      if (currentTimelineTime >= filteredDuration) {
        setCurrentTimelineTime(0);
      }
      if (videoRef.current && !videoLoadError) {
        const activeSeg = playbackSegments.find(
          (s) =>
            currentTimelineTime >= s.exportStart &&
            currentTimelineTime < s.exportEnd,
        );
        if (activeSeg) {
          const expectedVideoTime =
            activeSeg.videoStart + (currentTimelineTime - activeSeg.exportStart);
          if (Math.abs(videoRef.current.currentTime - expectedVideoTime) > 0.2) {
            videoRef.current.currentTime = expectedVideoTime;
          }
        }
        videoRef.current.play().catch((e) => console.log("Playback error", e));
      }
      lastTime = performance.now();
      animationRef.current = requestAnimationFrame(loop);
    } else {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (videoRef.current) videoRef.current.pause();
    }

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (videoRef.current) videoRef.current.pause();
    };
  }, [isPlaying, playbackSegments, filteredDuration, videoLoadError]);

  useEffect(() => {
    if (!isPlaying && videoRef.current) {
      videoRef.current.pause();
    }
  }, [isPlaying]);

  useEffect(() => {
    if (currentTimelineTime >= filteredDuration && filteredDuration > 0) {
      setCurrentTimelineTime(0);
    }
  }, [filteredDuration]);

  // Hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if ((e.code === "Delete" || e.code === "Backspace") && selectedBlockId) {
        e.preventDefault();
        handleDeleteBlock(selectedBlockId);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedBlockId, handleDeleteBlock]);

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return "0:00.0";
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return `${mins}:${secs.padStart(4, "0")}`;
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (totalEditedDuration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const clickedTimelineT = percent * totalEditedDuration;

    let targetExportT = 0;
    const foundSegment = playbackSegments.find(
      (s) =>
        clickedTimelineT >= s.timelineStart && clickedTimelineT < s.timelineEnd,
    );

    if (foundSegment) {
      const timeInSegment = clickedTimelineT - foundSegment.timelineStart;
      targetExportT = foundSegment.exportStart + timeInSegment;
    } else {
      const prevSegs = playbackSegments.filter(
        (s) => s.timelineEnd <= clickedTimelineT,
      );
      if (prevSegs.length > 0) {
        targetExportT = prevSegs[prevSegs.length - 1].exportEnd;
      } else {
        targetExportT = 0;
      }
    }

    setCurrentTimelineTime(targetExportT);
    if (foundSegment && videoRef.current && !videoLoadError) {
      videoRef.current.currentTime =
        foundSegment.videoStart +
        (clickedTimelineT - foundSegment.timelineStart);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-zinc-950/90 backdrop-blur-md flex items-center justify-center p-6 font-sans">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full h-full bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Top Navigation Header */}
        <div className="h-14 border-b border-white/5 flex items-center justify-between px-6 bg-zinc-800/50">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-rose-500" />
              Монтаж (Бэкстейдж)
            </h2>
            {readDiagnostics.length > 0 && (
              <button
                onClick={() => setShowDiagnosticsPanel(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 text-xs font-medium transition-all"
                title="Открыть панель диагностики ошибок чтения"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                <span>Диагностика ({readDiagnostics.length})</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-4">
            {sessions.length > 0 ? (
              <select
                className="bg-zinc-800 text-xs text-zinc-300 border border-white/10 rounded-md px-2 py-1 outline-none focus:border-rose-500"
                value={selectedSession?.id || ""}
                onChange={(e) => {
                  const s = sessions.find((x) => x.id === e.target.value);
                  if (s) setSelectedSession(s);
                }}
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    Сессия {new Date(s.startTime).toLocaleTimeString()} ({Math.round((s.duration || 0) / 1000)}с)
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-zinc-500">Нет валидных сессий</span>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-white transition-colors hover:bg-white/10 rounded-lg"
              title="Закрыть"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Read Warning Banner */}
        {readDiagnostics.length > 0 && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-2 flex items-center justify-between text-xs text-amber-300">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>Защита бэкстейджа:</strong> Обнаружено {readDiagnostics.length} проблем при чтении сессий с диска. Редактор работает в безопасном режиме.
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowDiagnosticsPanel(true)}
                className="underline hover:text-white font-medium"
              >
                Просмотреть подробности
              </button>
              <button
                onClick={loadSessions}
                className="hover:text-white flex items-center gap-1 font-medium"
                title="Перечитатать"
              >
                <RefreshCw className="w-3 h-3" />
                Обновить
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col min-w-0">
            {/* Player View */}
            <div className="flex-1 bg-black flex flex-col relative p-4 min-h-0">
              {selectedSession ? (
                <div className="relative flex-1 w-full h-full flex items-center justify-center rounded-xl overflow-hidden border border-white/5 bg-zinc-900/50 shadow-inner">
                  {/* Video Player or Fallback Overlay */}
                  {videoLoadError && !ignoreVideoError ? (
                    <div className="absolute inset-0 bg-zinc-950/90 flex flex-col items-center justify-center p-6 text-center z-30">
                      <VideoOff className="w-12 h-12 text-rose-500 mb-3 opacity-80" />
                      <h3 className="text-sm font-bold text-white mb-1">
                        Не удалось прочитать видеозапись бэкстейджа
                      </h3>
                      <p className="text-xs text-zinc-400 max-w-md mb-3 font-mono bg-zinc-900 p-2 rounded border border-white/5 break-all">
                        {selectedSession.videoPath}
                      </p>
                      <p className="text-xs text-rose-300/80 mb-5 max-w-sm">
                        Причина: {videoLoadError}. Файл мог быть перемещен, удален или заблокирован внешней программой.
                      </p>
                      <div className="flex items-center gap-3 flex-wrap justify-center">
                        <button
                          onClick={handleRelinkVideo}
                          className="px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all shadow-md"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                          Указать новый видеофайл...
                        </button>
                        <button
                          onClick={() => setIgnoreVideoError(true)}
                          className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium transition-colors"
                        >
                          Продолжить только монтаж блоков
                        </button>
                        <button
                          onClick={() => handleDeleteCorruptedSession(selectedSession.id)}
                          className="px-3.5 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 rounded-lg text-xs font-medium transition-colors"
                        >
                          Удалить эту сессию
                        </button>
                      </div>
                    </div>
                  ) : (
                    <video
                      ref={videoRef}
                      src={getSafeFileUrl(selectedSession.videoPath)}
                      className="max-w-full max-h-full object-contain"
                      controls={false}
                      muted={false}
                      onError={() => {
                        const err = videoRef.current?.error;
                        const msg = err
                          ? `Код ошибки ${err.code}: ${err.message || "Файл недоступен"}`
                          : "Видеофайл не найден по указанному пути";
                        setVideoLoadError(msg);
                        addDiagnostic({
                          id: selectedSession.id,
                          resource: selectedSession.videoPath,
                          errorType: "media_unreadable",
                          message: `Ошибка чтения видео: ${msg}`,
                        });
                      }}
                    />
                  )}

                  {isProcessing && (
                    <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center z-50">
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-10 h-10 border-4 border-rose-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-rose-400 font-medium text-sm animate-pulse">
                          Обработка видео бэкстейджа...
                        </p>
                      </div>
                    </div>
                  )}

                  {selectedBlock && (
                    <div className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-md border border-white/10 text-white px-6 py-2.5 rounded-xl shadow-2xl text-center max-w-2xl font-medium tracking-wide z-20">
                      <div className="text-rose-400 text-[10px] font-bold uppercase tracking-widest mb-0.5 opacity-80">
                        {selectedBlock.type === "dub" ? "Дубль" : selectedBlock.type === "speaking" ? "Разговор" : "Тишина"}
                      </div>
                      <div className="text-xs truncate">{selectedBlock.text || "..."}</div>
                    </div>
                  )}

                  {/* Playbar Control Overlay */}
                  <div className="absolute bottom-2 left-4 right-4 bg-zinc-950/80 backdrop-blur-md border border-white/10 rounded-xl px-4 py-1.5 flex items-center justify-between z-20 shadow-lg">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setIsPlaying(!isPlaying)}
                        className="w-8 h-8 rounded-lg bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center transition-all shadow-md active:scale-95"
                        title={isPlaying ? "Пауза (Пробел)" : "Воспроизведение (Пробел)"}
                      >
                        {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                      </button>
                      <button
                        onClick={() => {
                          setCurrentTimelineTime(0);
                          if (videoRef.current && !videoLoadError) videoRef.current.currentTime = 0;
                        }}
                        className="p-1.5 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors"
                        title="В начало"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      <div className="text-xs font-mono text-zinc-300 font-medium">
                        <span className="text-rose-400">{formatTime(currentTimelineTime)}</span>
                        <span className="text-zinc-600 mx-1">/</span>
                        <span>{formatTime(filteredDuration)}</span>
                      </div>
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">
                      {blocks.length} блоков | [Пробел] - Старт/Пауза
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-zinc-500 flex flex-col items-center justify-center h-full gap-3">
                  <Video className="w-12 h-12 opacity-20" />
                  <p>Нет доступных сессий бэкстейджа</p>
                  {readDiagnostics.length > 0 && (
                    <button
                      onClick={() => setShowDiagnosticsPanel(true)}
                      className="text-xs text-rose-400 hover:underline flex items-center gap-1 mt-2"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Открыть отчет об ошибках чтения ({readDiagnostics.length})
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Timeline */}
            {selectedSession && blocks.length > 0 && (
              <div className="h-64 border-t border-white/5 bg-zinc-900 flex flex-col shrink-0 relative z-10 shadow-[0_-10px_40px_rgba(0,0,0,0.3)]">
                <BackstageTimelineRenderer
                  blocks={blocks}
                  selectedBlockId={selectedBlockId}
                  setSelectedBlockId={setSelectedBlockId}
                  totalEditedDuration={totalEditedDuration}
                  exportSettings={exportSettings}
                  setBlocks={setBlocks}
                  handleDrop={handleDrop}
                  currentTimelineTime={currentTimelineTime}
                  onTimelineClick={handleTimelineClick}
                />
              </div>
            )}
          </div>

          {/* Settings Sidebar */}
          <div className="w-80 border-l border-white/5 bg-zinc-900/95 overflow-y-auto shrink-0 flex flex-col shadow-[-10px_0_40px_rgba(0,0,0,0.2)]">
            <ExportSettingsPanel
              exportSettings={exportSettings}
              selectedPresetId={selectedPresetId}
              presets={EXPORT_PRESETS}
              onSelectPreset={handleSelectPreset}
              onUpdateSetting={handleUpdateSetting}
              onExport={handleAssembleVideo}
              onExportShorts={handleExportShorts}
              onExportPip={() => handleAssembleVideo(false, true)}
              onRemoveGarbage={handleRemoveGarbage}
              onRemoveAllSilence={handleRemoveAllSilence}
              onRemoveSilence={handleRemoveSilence}
            />

            <BlockEditorPanel
              block={selectedBlock}
              selectedBlock={selectedBlock}
              blocks={blocks}
              isProcessing={isProcessing}
              setBlocks={setBlocks}
              onUpdateBlockTimes={handleUpdateBlockTimes}
              onChangeBlockType={handleChangeBlockType}
              onSplitBlock={handleSplitBlock}
              onCopyBlock={handleCopyBlock}
              onDeleteBlock={handleDeleteBlock}
              onExportSingleBlock={handleExportSingleBlock}
            />
          </div>
        </div>

        {/* Read Diagnostics Modal */}
        <AnimatePresence>
          {showDiagnosticsPanel && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
            >
              <div className="w-full max-w-2xl bg-zinc-900 border border-amber-500/30 rounded-2xl p-6 shadow-2xl flex flex-col gap-4 text-white">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                    <ShieldAlert className="w-5 h-5" />
                    Диагностика чтения файлов бэкстейджа
                  </div>
                  <button
                    onClick={() => setShowDiagnosticsPanel(false)}
                    className="p-1 text-zinc-400 hover:text-white transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <p className="text-xs text-zinc-400 leading-relaxed">
                  Ниже приведен список ресурсов и файлов, при чтении которых произошли сбои. Система автоматически пропустила невалидные файлы для предотвращения аварийного завершения.
                </p>

                <div className="max-h-80 overflow-y-auto space-y-2.5 pr-1">
                  {readDiagnostics.map((diag, index) => (
                    <div
                      key={index}
                      className="p-3 bg-zinc-950 border border-white/10 rounded-xl space-y-1 font-sans text-xs"
                    >
                      <div className="flex items-center justify-between text-zinc-400 font-mono text-[11px]">
                        <span className="font-semibold text-rose-400 flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5" />
                          {diag.errorType}
                        </span>
                        <span>{diag.timestamp}</span>
                      </div>
                      <div className="font-mono text-zinc-200 truncate select-all">
                        Ресурс: {diag.resource}
                      </div>
                      <div className="text-rose-300 font-medium">
                        {diag.message}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between border-t border-white/10 pt-4 mt-2">
                  <button
                    onClick={() => {
                      if (window.electronAPI && projectPath) {
                        window.electronAPI.openPath?.(`${projectPath}/takes`).catch(() => {});
                      }
                    }}
                    className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
                  >
                    <FolderOpen className="w-4 h-4" />
                    Папка записей (/takes)
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setReadDiagnostics([]);
                        loadSessions();
                      }}
                      className="px-3.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Перечитатать
                    </button>
                    <button
                      onClick={() => setShowDiagnosticsPanel(false)}
                      className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium transition-colors"
                    >
                      Закрыть
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default BackstageEditor;
