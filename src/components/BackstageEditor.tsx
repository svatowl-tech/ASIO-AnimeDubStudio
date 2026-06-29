import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import {
  X,
  Trash2,
  Copy,
  Settings2,
  Video,
  Scissors,
  Star,
  Sparkles,
} from "lucide-react";
import {
  BackstageSession,
  TimelineBlock,
  ExportSettings,
  ExportPreset,
  TimelineBlockType,
} from "../types";
import { getSafeFileUrl } from "../lib/utils";

interface BackstageEditorProps {
  onClose: () => void;
  projectPath: string;
  projectSubtitles: { start: number; end: number; text: string }[];
}

// Список готовых пресетов экспорта для быстрого применения настроек
const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: "custom",
    name: "Пользовательский 🛠️",
    settings: {
      includeOriginal: true,
      aspectRatio: "16:9",
      splitShortVideos: false,
      professionalEditing: true,
      onlyFavorites: false,
      useAudioTransitions: false,
    },
  },
  {
    id: "tiktok_teaser",
    name: "TikTok Тизер 📱",
    settings: {
      includeOriginal: false,
      aspectRatio: "9:16",
      splitShortVideos: true,
      professionalEditing: true,
      onlyFavorites: true,
      useAudioTransitions: true,
    },
  },
  {
    id: "full_archive",
    name: "Полный Архив 📦",
    settings: {
      includeOriginal: true,
      aspectRatio: "16:9",
      splitShortVideos: false,
      professionalEditing: false,
      onlyFavorites: false,
      useAudioTransitions: false,
    },
  },
  {
    id: "dynamic_vlog",
    name: "Динамичный Влог 🔥",
    settings: {
      includeOriginal: true,
      aspectRatio: "16:9",
      splitShortVideos: false,
      professionalEditing: true,
      onlyFavorites: false,
      useAudioTransitions: true,
    },
  },
];

const BackstageEditor: React.FC<BackstageEditorProps> = ({
  onClose,
  projectPath,
  projectSubtitles,
}) => {
  const [sessions, setSessions] = useState<BackstageSession[]>([]);
  const [selectedSession, setSelectedSession] =
    useState<BackstageSession | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const [blocks, setBlocks] = useState<TimelineBlock[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  // Стейт для хранения настроек экспорта и выбранного пресета
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    includeOriginal: true,
    aspectRatio: "16:9",
    splitShortVideos: false,
    professionalEditing: true,
    onlyFavorites: false,
    useAudioTransitions: false,
  });
  const [selectedPresetId, setSelectedPresetId] = useState<string>("custom");

  // Загружаем сессии бэкстейджа из директории takes
  useEffect(() => {
    const loadSessions = async () => {
      if (!window.electronAPI) return;
      const res = await window.electronAPI.listBackstageSessions(projectPath);
      if (res.success && res.data) {
        const parsedSessions: BackstageSession[] = [];
        for (const str of res.data) {
          try {
            const parsed = JSON.parse(str) as BackstageSession;
            if (parsed && parsed.id) {
              parsedSessions.push(parsed);
            }
          } catch (e) {
            console.error("Ошибка парсинга отдельной сессии бэкстейджа:", e, str);
          }
        }
        // Сортировка по времени начала (новые сверху)
        parsedSessions.sort((a, b) => b.startTime - a.startTime);
        setSessions(parsedSessions);
        if (parsedSessions.length > 0 && !selectedSession) {
          setSelectedSession(parsedSessions[0]);
        }
      }
    };
    loadSessions();
  }, [projectPath]);

  // Автоматическое сохранение сессии при изменении блоков на таймлайне
  useEffect(() => {
    if (!selectedSession || !projectPath || blocks.length === 0 || !window.electronAPI) return;

    const timer = setTimeout(() => {
      // Считаем start и end для каждого блока на итоговом таймлайне в секундах
      let accumulatedTime = 0;
      const blocksWithTimings = blocks.map((block) => {
        const blockStart = accumulatedTime;
        const blockEnd = accumulatedTime + block.duration;
        accumulatedTime = blockEnd;

        // Попробуем сопоставить текст субтитров, если это дубль
        let matchedText = block.text;
        if (!matchedText && block.type === "dub") {
          const dubInfo = selectedSession.dubs.find(
            (d) => Math.abs(d.backstageStartTime - block.originalStart) < 0.2,
          );
          if (dubInfo) {
            const matchingSub = projectSubtitles.find(
              (sub) =>
                sub.start >= dubInfo.timelineStartTime - 1.0 &&
                sub.end <= dubInfo.timelineStartTime + (dubInfo.backstageEndTime - dubInfo.backstageStartTime) + 1.0
            );
            if (matchingSub) {
              matchedText = matchingSub.text;
            }
          }
        }

        return {
          ...block,
          start: Number(blockStart.toFixed(3)),
          end: Number(blockEnd.toFixed(3)),
          isFavorite: block.isFavorite ?? false,
          text: matchedText,
        };
      });

      // Сравниваем блоки, чтобы избежать бесконечного цикла сохранения
      const currentBlocksJson = JSON.stringify(selectedSession.blocks || []);
      const newBlocksJson = JSON.stringify(blocksWithTimings);
      if (currentBlocksJson === newBlocksJson) return;

      const updatedSession: BackstageSession = {
        ...selectedSession,
        sessionId: selectedSession.id,
        rawVideoPath: selectedSession.videoPath,
        totalDuration: selectedSession.duration / 1000,
        blocks: blocksWithTimings,
      };

      console.log(`[BackstageEditor] Авто-сохранение сессии с обновленными блоками... (${blocks.length} блоков)`);
      window.electronAPI!.writeTextFile({
        path: `${projectPath}/takes/backstage_session_${selectedSession.id}.json`,
        data: JSON.stringify(updatedSession, null, 2),
      }).then(() => {
        setSelectedSession(updatedSession);
        // Также обновим в списке сессий
        setSessions(prev => prev.map(s => s.id === selectedSession.id ? updatedSession : s));
      }).catch(err => {
        console.error("Ошибка автосохранения бэкстейдж сессии:", err);
      });
    }, 500); // дебаунс 500мс

    return () => clearTimeout(timer);
  }, [blocks, selectedSession, projectPath, projectSubtitles]);

  // Генерация логических блоков при выборе новой сессии
  useEffect(() => {
    if (!selectedSession) {
      console.log("[BackstageEditor] Сессия сброшена, очистка таймлайна");
      setBlocks([]);
      setSelectedBlockId(null);
      setCurrentTimelineTime(0);
      setIsPlaying(false);
      return;
    }

    setIsPlaying(false);
    setCurrentTimelineTime(0);
    console.log(
      `[BackstageEditor] Выбрана сессия: ${selectedSession.id}, длительность: ${selectedSession.duration}мс`,
    );

    if (selectedSession.blocks && selectedSession.blocks.length > 0) {
      console.log("[BackstageEditor] Загрузка сохраненных блоков из сессии");
      setBlocks(selectedSession.blocks);
      setSelectedBlockId(null);
      return;
    }

    const durationSec = selectedSession.duration / 1000;

    // Сформируем список всех "активных" интервалов
    interface ActiveRange {
      type: "dub" | "speaking";
      start: number;
      end: number;
      videoRefStart?: number;
      videoRefEnd?: number;
    }

    const ranges: ActiveRange[] = [];

    // Добавляем дубли
    selectedSession.dubs.forEach((d) => {
      ranges.push({
        type: "dub",
        start: Math.max(0, d.backstageStartTime),
        end: Math.min(durationSec, d.backstageEndTime),
        videoRefStart: d.start,
        videoRefEnd: d.end,
      });
    });

    // Добавляем реальные записи разговора, если они были сохранены (VAD)
    if (
      selectedSession.speakingActivities &&
      selectedSession.speakingActivities.length > 0
    ) {
      selectedSession.speakingActivities.forEach((s) => {
        ranges.push({
          type: "speaking",
          start: Math.max(0, s.start),
          end: Math.min(durationSec, s.end),
        });
      });
    }

    // Сортируем интервалы по времени начала
    ranges.sort((a, b) => a.start - b.start);

    // Разрешаем пересечения: дубли имеют абсолютный приоритет над разговором.
    const dubRanges = ranges
      .filter((r) => r.type === "dub")
      .sort((a, b) => a.start - b.start);
    const mergedDubs: ActiveRange[] = [];

    for (const r of dubRanges) {
      if (mergedDubs.length === 0) {
        mergedDubs.push(r);
      } else {
        const last = mergedDubs[mergedDubs.length - 1];
        if (r.start < last.end) {
          last.end = Math.max(last.end, r.end);
        } else {
          mergedDubs.push(r);
        }
      }
    }

    const rawSpeaking = ranges
      .filter((r) => r.type === "speaking")
      .sort((a, b) => a.start - b.start);
    const speakingRanges: ActiveRange[] = [];

    for (const sp of rawSpeaking) {
      let currentStart = sp.start;
      const currentEnd = sp.end;

      for (const dub of mergedDubs) {
        if (currentStart >= currentEnd) break;

        if (dub.start >= currentEnd || dub.end <= currentStart) {
          continue;
        }

        if (dub.start > currentStart) {
          speakingRanges.push({
            type: "speaking",
            start: currentStart,
            end: dub.start,
          });
        }
        currentStart = Math.max(currentStart, dub.end);
      }

      if (currentStart < currentEnd) {
        speakingRanges.push({
          type: "speaking",
          start: currentStart,
          end: currentEnd,
        });
      }
    }

    // Объединяем все активные интервалы
    const allActive = [...mergedDubs, ...speakingRanges].sort(
      (a, b) => a.start - b.start,
    );

    // Строим итоговый непрерывный таймлайн
    const finalBlocks: TimelineBlock[] = [];
    let lastTime = 0;
    let blockIdCounter = 1;

    for (const active of allActive) {
      if (active.start > lastTime + 0.05) {
        finalBlocks.push({
          id: `silence-${blockIdCounter++}`,
          type: "silence",
          duration: active.start - lastTime,
          originalStart: lastTime,
          originalEnd: active.start,
          isFavorite: false,
        });
      }

      finalBlocks.push({
        id: `${active.type}-${blockIdCounter++}`,
        type: active.type,
        duration: active.end - active.start,
        originalStart: active.start,
        originalEnd: active.end,
        videoRefStart: active.videoRefStart,
        videoRefEnd: active.videoRefEnd,
        isFavorite: false,
      });

      lastTime = active.end;
    }

    if (lastTime < durationSec - 0.05) {
      finalBlocks.push({
        id: `silence-${blockIdCounter++}`,
        type: "silence",
        duration: durationSec - lastTime,
        originalStart: lastTime,
        originalEnd: durationSec,
        isFavorite: false,
      });
    }

    setBlocks(finalBlocks);
    setSelectedBlockId(null);
  }, [selectedSession]);

  const handleDeleteBlock = (id: string) => {
    console.log(`[BackstageEditor] Удаление блока: ${id}`);
    setBlocks(blocks.filter((b) => b.id !== id));
    if (selectedBlockId === id) setSelectedBlockId(null);
  };

  const handleCopyBlock = (id: string) => {
    console.log(`[BackstageEditor] Копирование блока: ${id}`);
    const index = blocks.findIndex((b) => b.id === id);
    if (index === -1) return;
    const blockToCopy = blocks[index];
    const newBlock: TimelineBlock = {
      ...blockToCopy,
      id: `${blockToCopy.id}-copy-${Date.now()}`,
    };
    const newBlocks = [...blocks];
    newBlocks.splice(index + 1, 0, newBlock);
    setBlocks(newBlocks);
  };

  const handleRemoveAllSilence = () => {
    console.log("[BackstageEditor] Удаление всех блоков тишины с таймлайна");
    setBlocks(blocks.filter((b) => b.type !== "silence"));
    if (
      selectedBlockId &&
      blocks.find((b) => b.id === selectedBlockId)?.type === "silence"
    ) {
      setSelectedBlockId(null);
    }
  };

  // Метод автоматического удаления мелкого разговорного "мусора" (silence и speaking < 1.5 сек) с бесшовной стыковкой оставшихся блоков
  const handleRemoveGarbage = () => {
    console.log(
      "[BackstageEditor] Запущена очистка коротких блоков и тишины (авто-монтаж)",
    );
    const originalCount = blocks.length;
    
    // 1. Фильтруем блоки: убираем все "silence", а также "speaking" короче 1.5 секунд
    const filtered = blocks.filter(
      (b) => b.type !== "silence" && !(b.type === "speaking" && b.duration < 1.5),
    );

    // Обработка пограничного случая пустого таймлайна
    if (filtered.length === 0) {
      alert(
        "Удаление отменено: все блоки в сессии подходят под критерии удаления (тишина или короткие реплики < 1.5с). Таймлайн не может быть пустым!",
      );
      return;
    }

    // 2. Аккуратно сдвигаем оставшиеся блоки, чтобы они шли ровно встык без пустот
    let accumulatedTime = 0;
    const adjustedBlocks = filtered.map((block) => {
      const blockStart = accumulatedTime;
      const blockEnd = accumulatedTime + block.duration;
      accumulatedTime = blockEnd;

      return {
        ...block,
        start: Number(blockStart.toFixed(3)),
        end: Number(blockEnd.toFixed(3)),
        duration: Number(block.duration.toFixed(3)),
        originalStart: Number((block.originalStart ?? blockStart).toFixed(3)),
        originalEnd: Number((block.originalEnd ?? blockEnd).toFixed(3))
      };
    });

    setBlocks(adjustedBlocks);
    setSelectedBlockId(null);
    alert(
      `Авто-монтаж выполнен! Удалено блоков: ${originalCount - adjustedBlocks.length} (тишина и шумы). Оставшиеся блоки выстроены в стык.`,
    );
  };

  // Ручное обновление временных границ блока со скользящей валидацией соседей
  const handleUpdateBlockTimes = (
    id: string,
    newStart: number,
    newEnd: number,
  ) => {
    newStart = Number(Number(newStart).toFixed(3));
    newEnd = Number(Number(newEnd).toFixed(3));

    console.log(
      `[BackstageEditor] Обновление границ блока ${id}: [${newStart.toFixed(3)} - ${newEnd.toFixed(3)}]`,
    );
    const index = blocks.findIndex((b) => b.id === id);
    if (index === -1 || !selectedSession) return;

    const durationSec = Number((selectedSession.duration / 1000).toFixed(3));
    const updatedBlocks = JSON.parse(JSON.stringify(blocks)) as TimelineBlock[];
    const current = updatedBlocks[index];

    // Минимальная длительность любого блока - 0.1 секунды
    const MIN_DURATION = 0.1;

    // Вспомогательная функция для скользящего изменения левой границы i-го блока
    const pushLeft = (idx: number, targetStart: number): boolean => {
      if (targetStart < 0) return false;
      const block = updatedBlocks[idx];
      const maxAllowedStart = (block.end ?? (block.start! + block.duration)) - MIN_DURATION;
      const actualStart = Number(Math.min(targetStart, maxAllowedStart).toFixed(3));
      
      const delta = actualStart - block.start!;
      block.start = actualStart;
      block.duration = Number(((block.end ?? (block.start! + block.duration)) - actualStart).toFixed(3));
      block.originalStart = Number(Math.max(0, block.originalStart + delta).toFixed(3));
      if (block.videoRefStart !== undefined) {
        block.videoRefStart = Number(Math.max(0, block.videoRefStart + delta).toFixed(3));
      }

      if (idx > 0) {
        const prev = updatedBlocks[idx - 1];
        prev.end = actualStart;
        prev.duration = Number((actualStart - prev.start!).toFixed(3));
        if (prev.duration < MIN_DURATION) {
          // Если левый сосед сжался сильнее минимума, толкаем его левую границу дальше влево
          const neededStart = Number((actualStart - MIN_DURATION).toFixed(3));
          return pushLeft(idx - 1, neededStart);
        }
      }
      return true;
    };

    // Вспомогательная функция для скользящего изменения правой границы i-го блока
    const pushRight = (idx: number, targetEnd: number): boolean => {
      const block = updatedBlocks[idx];
      const minAllowedEnd = block.start! + MIN_DURATION;
      const actualEnd = Number(Math.max(targetEnd, minAllowedEnd).toFixed(3));
      
      const delta = actualEnd - block.end!;
      block.end = actualEnd;
      block.duration = Number((actualEnd - block.start!).toFixed(3));
      block.originalEnd = Number(Math.max(block.originalStart, block.originalEnd + delta).toFixed(3));
      if (block.videoRefEnd !== undefined) {
        block.videoRefEnd = Number(Math.max(0, block.videoRefEnd + delta).toFixed(3));
      }

      if (idx < updatedBlocks.length - 1) {
        const next = updatedBlocks[idx + 1];
        next.start = actualEnd;
        next.duration = Number((next.end! - actualEnd).toFixed(3));
        if (next.duration < MIN_DURATION) {
          // Если правый сосед сжался сильнее минимума, толкаем его правую границу дальше вправо
          const neededEnd = Number((actualEnd + MIN_DURATION).toFixed(3));
          return pushRight(idx + 1, neededEnd);
        }
      } else {
        // Последний блок уперся в общую длительность
        if (actualEnd > durationSec) {
          return false;
        }
      }
      return true;
    };

    // Проверяем, меняем мы старт или конец
    if (newStart !== current.start) {
      // Меняем левую границу
      if (newStart >= current.end! - MIN_DURATION) {
        newStart = Number((current.end! - MIN_DURATION).toFixed(3));
      }
      const success = pushLeft(index, newStart);
      if (success) {
        setBlocks(updatedBlocks);
      }
    } else if (newEnd !== current.end) {
      // Меняем правую границу
      if (newEnd <= current.start! + MIN_DURATION) {
        newEnd = Number((current.start! + MIN_DURATION).toFixed(3));
      }
      const success = pushRight(index, newEnd);
      if (success) {
        setBlocks(updatedBlocks);
      }
    }
  };

  // Смена типа блока (Дубль, Разговор, Тишина)
  const handleChangeBlockType = (id: string, newType: TimelineBlockType) => {
    console.log(`[BackstageEditor] Изменение типа блока ${id} на ${newType}`);
    setBlocks(
      blocks.map((b) =>
        b.id === id
          ? {
              ...b,
              type: newType,
              id: `${newType}-${b.id.split("-").slice(1).join("-")}`,
            }
          : b,
      ),
    );
  };

  // Разрезание выбранного блока пополам для точного редактирования
  const handleSplitBlock = (id: string) => {
    console.log(`[BackstageEditor] Разрезание блока ${id} пополам`);
    const index = blocks.findIndex((b) => b.id === id);
    if (index === -1) return;

    const block = blocks[index];
    if (block.duration <= 1) {
      alert("Блок слишком короткий для разделения");
      return;
    }

    const midPoint = block.originalStart + block.duration / 2;

    const firstPart: TimelineBlock = {
      id: `${block.id}-split-1-${Date.now()}`,
      type: block.type,
      duration: midPoint - block.originalStart,
      originalStart: block.originalStart,
      originalEnd: midPoint,
      videoRefStart: block.videoRefStart,
      videoRefEnd:
        block.videoRefStart !== undefined && block.videoRefEnd !== undefined
          ? block.videoRefStart + (block.videoRefEnd - block.videoRefStart) / 2
          : undefined,
      isFavorite: block.isFavorite,
    };

    const secondPart: TimelineBlock = {
      id: `${block.id}-split-2-${Date.now()}`,
      type: block.type,
      duration: block.originalEnd - midPoint,
      originalStart: midPoint,
      originalEnd: block.originalEnd,
      videoRefStart:
        block.videoRefStart !== undefined && block.videoRefEnd !== undefined
          ? block.videoRefStart + (block.videoRefEnd - block.videoRefStart) / 2
          : undefined,
      videoRefEnd: block.videoRefEnd,
      isFavorite: block.isFavorite,
    };

    const updatedBlocks = [...blocks];
    updatedBlocks.splice(index, 1, firstPart, secondPart);
    setBlocks(updatedBlocks);
    setSelectedBlockId(firstPart.id);
  };

  const handleRemoveSilence = async () => {
    if (!window.electronAPI || !selectedSession) return;

    const saveRes = await window.electronAPI.saveFile({
      title: "Сохранить видео без тишины",
      defaultPath: selectedSession.videoPath.replace(
        /\.(webm|mp4)$/i,
        "_no_silence.mp4",
      ),
      filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
    });

    if (!saveRes.success || !saveRes.data) return;
    const outPath = saveRes.data;

    console.log(
      `[BackstageEditor] Запуск экспорта с вырезанной тишиной для сессии ${selectedSession.id}`,
    );
    setIsProcessing(true);

    const dubsToKeep = selectedSession.dubs.map((d) => ({
      start: d.backstageStartTime,
      end: d.backstageEndTime,
    }));

    const res = await window.electronAPI.processBackstageRemoveSilence({
      videoPath: selectedSession.videoPath,
      dubs: dubsToKeep,
      outputPath: outPath,
    });

    if (res.success)
      alert("Удаление тишины успешно завершено!\nСохранено в: " + outPath);
    else alert("Ошибка: " + res.error);
    setIsProcessing(false);
  };

  const handleExportShorts = async () => {
    if (!window.electronAPI || !selectedSession) return;

    const saveRes = await window.electronAPI.saveFile({
      title: "Сохранить Shorts",
      defaultPath: selectedSession.videoPath.replace(
        /\.(webm|mp4)$/i,
        "_shorts.mp4",
      ),
      filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
    });

    if (!saveRes.success || !saveRes.data) return;
    const outPath = saveRes.data;

    console.log(
      `[BackstageEditor] Запуск экспорта Shorts для сессии ${selectedSession.id}`,
    );
    setIsProcessing(true);
    const res = await window.electronAPI.processBackstageShorts({
      videoPath: selectedSession.videoPath,
      outputPath: outPath,
    });

    if (res.success)
      alert("Экспорт для Shorts успешно завершен!\nСохранено в: " + outPath);
    else alert("Ошибка: " + res.error);
    setIsProcessing(false);
  };

  // Метод ручного выбора пресета и смены параметров экспорта
  const handleSelectPreset = (presetId: string) => {
    console.log(`[BackstageEditor] Выбран пресет экспорта: ${presetId}`);
    setSelectedPresetId(presetId);
    const preset = EXPORT_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      setExportSettings(preset.settings);
    }
  };

  // Метод обновления настроек экспорта вручную
  const handleUpdateSetting = <K extends keyof ExportSettings>(
    key: K,
    value: ExportSettings[K],
  ) => {
    console.log(
      `[BackstageEditor] Обновление настройки экспорта ${String(key)}:`,
      value,
    );
    const updatedSettings = { ...exportSettings, [key]: value };
    setExportSettings(updatedSettings);

    // Проверяем, совпадает ли ручная настройка с каким-либо стандартным пресетом
    const matchedPreset = EXPORT_PRESETS.find((p) => {
      if (p.id === "custom") return false;
      return JSON.stringify(p.settings) === JSON.stringify(updatedSettings);
    });

    if (matchedPreset) {
      setSelectedPresetId(matchedPreset.id);
    } else {
      setSelectedPresetId("custom");
    }
  };

  const handleAssembleVideo = async (forceOnlyFavorites?: boolean) => {
    if (!window.electronAPI || !selectedSession) return;
    const isOnlyFavorites = forceOnlyFavorites || exportSettings.onlyFavorites;

    // Фильтруем только избранное, если включен режим
    const finalBlocksForExport = isOnlyFavorites
      ? blocks.filter((b) => b.isFavorite)
      : blocks;

    if (finalBlocksForExport.length === 0) {
      alert(
        "Невозможно экспортировать: список блоков пуст! Выберите хотя бы один блок в Избранное.",
      );
      return;
    }

    const saveRes = await window.electronAPI.saveFile({
      title: "Собрать видео",
      defaultPath: selectedSession.videoPath.replace(
        /\.(webm|mp4)$/i,
        "_assembled.mp4",
      ),
      filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
    });

    if (!saveRes.success || !saveRes.data) return;
    const outPath = saveRes.data;

    console.log(
      `[BackstageEditor] Запуск сборки видео (Сборка избранного: ${isOnlyFavorites}) для сессии ${selectedSession.id}`,
    );
    setIsProcessing(true);

    const mappedSubtitles: { start: number; end: number; text: string }[] = [];

    let currentOutputTime = 0;
    const blocksDataForExport: TimelineBlock[] = [];

    for (const block of finalBlocksForExport) {
      blocksDataForExport.push(block);

      if (block.type === "dub") {
        const blockStart = block.originalStart ?? block.start ?? 0;
        const dubInfo = selectedSession.dubs.find(
          (d) => Math.abs(d.backstageStartTime - blockStart) < 0.2,
        );

        if (dubInfo) {
          for (const sub of projectSubtitles) {
            if (
              sub.start >= dubInfo.timelineStartTime - 1.0 &&
              sub.end <=
                dubInfo.timelineStartTime +
                  (dubInfo.backstageEndTime - dubInfo.backstageStartTime) +
                  1.0
            ) {
              const offsetInBlock = sub.start - dubInfo.timelineStartTime;
              const subDuration = sub.end - sub.start;
              mappedSubtitles.push({
                start: blockStart + offsetInBlock,
                end: blockStart + offsetInBlock + subDuration,
                text: sub.text,
              });
            }
          }
        }
      }

      currentOutputTime += block.duration;
    }

    const originalVideoPath = selectedSession.originalVideoPath;

    const res = await window.electronAPI.exportBackstageAssemble({
      videoPath: selectedSession.videoPath,
      originalVideoPath,
      subtitles: mappedSubtitles,
      blocks: blocksDataForExport,
      settings: { ...exportSettings, onlyFavorites: isOnlyFavorites },
      outputPath: outPath,
    });

    if (res.success)
      alert("Сборка видео успешно завершена!\nСохранено в: " + res.data);
    else alert("Ошибка: " + res.error);
    setIsProcessing(false);
  };

  const totalEditedDuration = useMemo(
    () => blocks.reduce((acc, b) => acc + b.duration, 0),
    [blocks],
  );
  const filteredBlocks = useMemo(
    () =>
      exportSettings.onlyFavorites
        ? blocks.filter((b) => b.isFavorite)
        : blocks,
    [blocks, exportSettings.onlyFavorites],
  );
  const filteredDuration = useMemo(
    () => filteredBlocks.reduce((acc, b) => acc + b.duration, 0),
    [filteredBlocks],
  );
  const selectedBlock = useMemo(
    () => blocks.find((b) => b.id === selectedBlockId),
    [blocks, selectedBlockId],
  );

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimelineTime, setCurrentTimelineTime] = useState(0);
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

    for (const b of blocks) {
      const isIncluded = exportSettings.onlyFavorites ? b.isFavorite : true;

      if (isIncluded) {
        const videoStart = b.videoRefStart ?? b.originalStart ?? b.start ?? 0;
        const videoEnd = b.videoRefEnd ?? b.originalEnd ?? b.end ?? (videoStart + b.duration);

        segs.push({
          blockId: b.id,
          exportStart: exportT,
          exportEnd: exportT + b.duration,
          timelineStart: timelineT,
          timelineEnd: timelineT + b.duration,
          videoStart,
          videoEnd,
        });
        exportT += b.duration;
      }

      timelineT += b.duration;
    }

    return segs;
  }, [blocks, exportSettings.onlyFavorites]);

  const currentTimelinePosPercent = useMemo(() => {
    // Find where we are in timelineT based on currentTimelineTime (which is exportT)
    if (playbackSegments.length === 0) return 0;

    const segment = playbackSegments.find(
      (s) =>
        currentTimelineTime >= s.exportStart &&
        currentTimelineTime < s.exportEnd,
    );

    let timelineT = 0;
    if (segment) {
      const timeInSegment = currentTimelineTime - segment.exportStart;
      timelineT = segment.timelineStart + timeInSegment;
    } else if (currentTimelineTime >= filteredDuration) {
      timelineT = totalEditedDuration;
    }

    return totalEditedDuration > 0
      ? (timelineT / totalEditedDuration) * 100
      : 0;
  }, [
    currentTimelineTime,
    playbackSegments,
    filteredDuration,
    totalEditedDuration,
  ]);

  useEffect(() => {
    if (!videoRef.current || !isPlaying) return;

    let lastTime = performance.now();

    const loop = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      setCurrentTimelineTime((prev) => {
        let nextTime = prev + delta;

        // Loop playback
        if (nextTime >= filteredDuration) {
          nextTime = 0;
        }

        // Sync video
        const segment = playbackSegments.find(
          (s) => nextTime >= s.exportStart && nextTime < s.exportEnd,
        );
        if (segment && videoRef.current) {
          const timeInSegment = nextTime - segment.exportStart;
          const expectedVideoTime = segment.videoStart + timeInSegment;

          // If drift > 0.1s, seek video
          if (
            Math.abs(videoRef.current.currentTime - expectedVideoTime) > 0.1
          ) {
            videoRef.current.currentTime = expectedVideoTime;
          }

          if (videoRef.current.paused) {
            videoRef.current.play().catch(console.error);
          }
        } else if (videoRef.current) {
          videoRef.current.pause();
        }

        return nextTime;
      });

      animationRef.current = requestAnimationFrame(loop);
    };

    animationRef.current = requestAnimationFrame(loop);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (videoRef.current) videoRef.current.pause();
    };
  }, [isPlaying, playbackSegments, filteredDuration]);

  // Pause when not playing
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

  // Allow clicking on timeline to seek
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const clickedTimelineT = percent * totalEditedDuration;

    // Map clickedTimelineT to exportT
    let targetExportT = 0;

    // Find segment that contains clickedTimelineT or the closest one
    let foundSegment = playbackSegments.find(
      (s) =>
        clickedTimelineT >= s.timelineStart && clickedTimelineT < s.timelineEnd,
    );

    if (foundSegment) {
      const timeInSegment = clickedTimelineT - foundSegment.timelineStart;
      targetExportT = foundSegment.exportStart + timeInSegment;
    } else {
      // Clicked on a skipped block. Find the nearest valid segment before it.
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

    if (foundSegment && videoRef.current) {
      videoRef.current.currentTime =
        foundSegment.videoStart +
        (clickedTimelineT - foundSegment.timelineStart);
    }
  };

  const timelineBlocksElements = useMemo(() => {
    return blocks.map((block) => {
      const widthPercent = (block.duration / totalEditedDuration) * 100;
      const isSelected = selectedBlockId === block.id;
      const isDimmed = exportSettings.onlyFavorites && !block.isFavorite;

      let bgColor = "bg-zinc-800/30";
      let borderColor = "border-white/5";
      let textColor = "text-zinc-500";
      let label = "ТИШИНА";

      if (block.type === "dub") {
        bgColor = "bg-emerald-500/40 hover:bg-emerald-500/60";
        borderColor = "border-emerald-400/50";
        textColor = "text-emerald-300";
        label = "ДУБЛЬ";
      } else if (block.type === "speaking") {
        bgColor = "bg-blue-500/30 hover:bg-blue-500/50";
        borderColor = "border-blue-400/30";
        textColor = "text-blue-300";
        label = "РАЗГОВОР";
      } else {
        bgColor = "bg-zinc-800/50 hover:bg-zinc-700/50";
      }

      // Умное оформление рамок
      let borderStyle = "border-white/5";
      if (isSelected) {
        borderStyle = block.isFavorite
          ? "border-amber-400 border-2"
          : "border-white border-2";
      } else if (block.isFavorite) {
        borderStyle = "border-amber-500 border";
      }

      return (
        <div
          key={block.id}
          onClick={() => setSelectedBlockId(block.id)}
          className={`relative h-full flex flex-col justify-between cursor-pointer transition-all ${bgColor} ${borderStyle} ${isDimmed ? "opacity-10 pointer-events-none blur-[0.5px]" : "opacity-100"} overflow-hidden min-w-0 flex-shrink`}
          style={{ width: `${widthPercent}%` }}
        >
          <div className="flex justify-between items-start p-1 overflow-hidden">
            <div className={`text-[8px] font-black truncate ${textColor} min-w-0 flex-shrink`}>
              {label}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setBlocks(
                  blocks.map((b) =>
                    b.id === block.id
                      ? { ...b, isFavorite: !b.isFavorite }
                      : b,
                  ),
                );
              }}
              className="p-0.5 hover:bg-white/10 rounded transition-all flex-shrink-0"
              title={block.isFavorite ? "Убрать из Избранного" : "Добавить в Избранное"}
            >
              <Star
                className={`w-3 h-3 transition-colors ${
                  block.isFavorite
                    ? "fill-amber-400 text-amber-400"
                    : "text-zinc-600 hover:text-amber-400"
                }`}
              />
            </button>
          </div>
          <div className="text-[8px] text-zinc-500 p-1 select-none text-right font-mono">
            {block.duration.toFixed(1)}s
          </div>
        </div>
      );
    });
  }, [
    blocks,
    totalEditedDuration,
    selectedBlockId,
    exportSettings.onlyFavorites,
  ]);

  return (
    <div className="fixed inset-0 z-[100] bg-zinc-950/90 backdrop-blur-md flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full h-full bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="h-14 border-b border-white/5 flex items-center justify-between px-6 bg-zinc-800/50">
          <h2 className="text-sm font-bold text-white flex items-center gap-2 font-sans">
            <Settings2 className="w-4 h-4 text-rose-500" />
            Редактор Бекстейджа (Профессиональный режим)
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Список сессий */}
          <div className="w-64 border-r border-white/5 bg-zinc-900/50 p-4 overflow-y-auto">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 font-sans">
              Сессии ({sessions.length})
            </h3>
            <div className="space-y-2">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSession(s)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition-all font-sans ${selectedSession?.id === s.id ? "bg-rose-500/20 text-rose-400 border border-rose-500/30" : "bg-white/5 text-zinc-400 hover:bg-white/10 border border-transparent"}`}
                >
                  Сессия {new Date(s.startTime).toLocaleTimeString()}
                </button>
              ))}
              {sessions.length === 0 && (
                <div className="text-xs text-zinc-500 text-center py-4 font-sans">
                  Нет записанных сессий
                </div>
              )}
            </div>
          </div>

          {/* Рабочая зона */}
          <div className="flex-1 flex flex-col relative min-w-0 overflow-hidden">
            {selectedSession ? (
              <>
                {/* Видеоплеер и панель настроек */}
                <div className="flex-1 bg-black p-4 flex gap-4 overflow-hidden">
                  <div
                    className="flex-1 flex items-center justify-center relative bg-zinc-950 rounded-xl border border-white/5 group cursor-pointer"
                    onClick={() => setIsPlaying(!isPlaying)}
                  >
                    <video
                      ref={videoRef}
                      src={getSafeFileUrl(selectedSession.videoPath)}
                      className="max-w-full max-h-full rounded-xl shadow-2xl"
                      preload="auto"
                    />

                    {/* Play/Pause Overlay */}
                    <div
                      className={`absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity duration-300 ${isPlaying ? "opacity-0" : "opacity-100"}`}
                    >
                      <div className="w-16 h-16 rounded-full bg-rose-500 flex items-center justify-center pl-1 shadow-lg shadow-rose-500/50">
                        {isPlaying ? (
                          <svg
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-white"
                          >
                            <rect x="6" y="4" width="4" height="16"></rect>
                            <rect x="14" y="4" width="4" height="16"></rect>
                          </svg>
                        ) : (
                          <svg
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-white"
                          >
                            <polygon points="5 3 19 12 5 21 5 3"></polygon>
                          </svg>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Настройки экспорта */}
                  <div className="w-80 bg-zinc-900 border border-white/5 rounded-xl p-4 flex flex-col gap-4 overflow-y-auto">
                    <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest border-b border-white/5 pb-2 font-sans">
                      Настройки сборки
                    </h3>

                    {/* Выпадающий список пресетов */}
                    <div className="flex flex-col gap-1.5 border-b border-white/5 pb-3">
                      <span className="text-xs font-bold text-zinc-400 font-sans">
                        Готовый пресет
                      </span>
                      <select
                        value={selectedPresetId}
                        onChange={(e) => handleSelectPreset(e.target.value)}
                        className="bg-zinc-800 border border-white/10 text-white text-sm rounded-lg p-2 outline-none focus:border-rose-500 font-sans"
                      >
                        {EXPORT_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <label className="flex items-start gap-3 cursor-pointer group">
                      <div className="relative flex items-center justify-center mt-0.5">
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={exportSettings.includeOriginal}
                          onChange={(e) =>
                            handleUpdateSetting(
                              "includeOriginal",
                              e.target.checked,
                            )
                          }
                        />
                        <div className="w-4 h-4 rounded bg-zinc-800 border border-zinc-700 peer-checked:bg-rose-500 peer-checked:border-rose-500 transition-colors"></div>
                        <svg
                          className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </div>
                      <div className="flex flex-col font-sans">
                        <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                          Оригинальное видео
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          Включить основное видео как фон или PIP
                        </span>
                      </div>
                    </label>

                    <div className="flex flex-col gap-2 font-sans">
                      <span className="text-sm font-medium text-zinc-200">
                        Формат (соотношение сторон)
                      </span>
                      <select
                        value={exportSettings.aspectRatio}
                        onChange={(e) =>
                          handleUpdateSetting(
                            "aspectRatio",
                            e.target.value as "16:9" | "9:16",
                          )
                        }
                        className="bg-zinc-800 border border-white/10 text-white text-sm rounded-lg p-2 outline-none focus:border-rose-500 font-sans"
                      >
                        <option value="16:9">16:9 (YouTube, Десктоп)</option>
                        <option value="9:16">
                          9:16 (Shorts, Reels, TikTok)
                        </option>
                      </select>
                    </div>

                    <label className="flex items-start gap-3 cursor-pointer group">
                      <div className="relative flex items-center justify-center mt-0.5">
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={exportSettings.professionalEditing}
                          onChange={(e) =>
                            handleUpdateSetting(
                              "professionalEditing",
                              e.target.checked,
                            )
                          }
                        />
                        <div className="w-4 h-4 rounded bg-zinc-800 border border-zinc-700 peer-checked:bg-rose-500 peer-checked:border-rose-500 transition-colors"></div>
                        <svg
                          className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </div>
                      <div className="flex flex-col font-sans">
                        <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                          Профессиональный монтаж
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          Умное переключение камер: дубль = PIP камера, разговор
                          = полный экран
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 cursor-pointer group">
                      <div className="relative flex items-center justify-center mt-0.5">
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={exportSettings.onlyFavorites || false}
                          onChange={(e) =>
                            handleUpdateSetting(
                              "onlyFavorites",
                              e.target.checked,
                            )
                          }
                        />
                        <div className="w-4 h-4 rounded bg-zinc-800 border border-zinc-700 peer-checked:bg-rose-500 peer-checked:border-rose-500 transition-colors"></div>
                        <svg
                          className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </div>
                      <div className="flex flex-col font-sans">
                        <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                          Только Избранное ⭐
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          Собрать видео только из отмеченных блоков
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 cursor-pointer group">
                      <div className="relative flex items-center justify-center mt-0.5">
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={exportSettings.useAudioTransitions || false}
                          onChange={(e) =>
                            handleUpdateSetting(
                              "useAudioTransitions",
                              e.target.checked,
                            )
                          }
                        />
                        <div className="w-4 h-4 rounded bg-zinc-800 border border-zinc-700 peer-checked:bg-rose-500 peer-checked:border-rose-500 transition-colors"></div>
                        <svg
                          className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </div>
                      <div className="flex flex-col font-sans">
                        <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                          J/L каты 🔀
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          Плавные аудиопереходы со смещением звука на стыках
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Таймлайн */}
                <div className="h-72 border-t border-white/5 bg-zinc-900 p-4 flex flex-col gap-3 min-w-0">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <span className="text-xs font-bold text-zinc-400 font-sans flex items-center gap-2 flex-wrap">
                      <span>
                        Таймлайн (Длительность: {totalEditedDuration.toFixed(1)}
                        s
                        {exportSettings.onlyFavorites &&
                          `, Избранное: ${filteredDuration.toFixed(1)}s`}
                        )
                      </span>
                      {exportSettings.onlyFavorites && (
                        <span className="px-1.5 py-0.5 text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded flex items-center gap-1 whitespace-nowrap">
                          <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                          Только избранное
                        </span>
                      )}
                    </span>
                    <div className="flex gap-2 font-sans flex-wrap justify-end">
                      <button
                        onClick={handleRemoveGarbage}
                        className="px-3 py-1.5 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg text-[10px] font-bold uppercase transition-all font-sans flex items-center gap-1"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Удалить мусор (Авто-монтаж)
                      </button>
                      <button
                        onClick={handleRemoveAllSilence}
                        className="px-3 py-1.5 bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 border border-amber-500/30 rounded-lg text-[10px] font-bold uppercase transition-all font-sans"
                      >
                        Удалить всю тишину
                      </button>
                      <button
                        onClick={handleRemoveSilence}
                        disabled={isProcessing}
                        className={`px-3 py-1.5 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/30 rounded-lg text-[10px] font-bold uppercase transition-all font-sans ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        {isProcessing
                          ? "Обработка..."
                          : "Экспорт (чистый звук)"}
                      </button>
                      <button
                        onClick={handleExportShorts}
                        disabled={isProcessing}
                        className={`px-3 py-1.5 bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 border border-indigo-500/30 rounded-lg text-[10px] font-bold uppercase transition-all font-sans ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        {isProcessing
                          ? "Обработка..."
                          : "Экспорт Shorts (9:16)"}
                      </button>
                      <button
                        onClick={() =>
                          handleUpdateSetting(
                            "onlyFavorites",
                            !exportSettings.onlyFavorites,
                          )
                        }
                        className={`px-3 py-1.5 border rounded-lg text-[10px] font-bold uppercase transition-all font-sans flex items-center gap-1 ${
                          exportSettings.onlyFavorites
                            ? "bg-amber-500/20 text-amber-400 border-amber-500/50"
                            : "bg-zinc-800/30 text-zinc-400 border-zinc-700/50 hover:bg-zinc-800"
                        }`}
                        title="Показать только избранные фрагменты на таймлайне"
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${exportSettings.onlyFavorites ? "fill-amber-400 text-amber-400" : "text-zinc-400"}`}
                        />
                        {exportSettings.onlyFavorites
                          ? "Все фрагменты"
                          : "Фильтр: ⭐"}
                      </button>
                      <button
                        onClick={() => handleAssembleVideo(true)}
                        disabled={isProcessing}
                        className={`px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-lg text-[10px] font-bold uppercase transition-all shadow-lg shadow-amber-500/20 font-sans flex items-center gap-1 ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
                        title="Экспортировать только избранные фрагменты"
                      >
                        <Star className="w-3.5 h-3.5 fill-zinc-950 text-zinc-950" />
                        Собрать Избранное ⭐
                      </button>
                      <button
                        onClick={() => handleAssembleVideo(false)}
                        disabled={isProcessing}
                        className={`px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-[10px] font-bold uppercase transition-all shadow-lg shadow-rose-600/20 font-sans ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        {isProcessing ? "Обработка..." : "Собрать видео (Reel)"}
                      </button>
                    </div>
                  </div>

                  {/* Контейнер блоков */}
                  <div className="overflow-x-auto overflow-y-hidden rounded-xl border border-white/5 bg-zinc-950 flex-shrink-0 custom-scrollbar">
                    <div
                      className="relative h-24 flex cursor-text"
                      onClick={handleTimelineClick}
                      style={{ minWidth: `max(100%, ${totalEditedDuration * 10}px)` }}
                    >
                      {timelineBlocksElements}

                      {/* Timeline Cursor */}
                      <div
                        className="absolute top-0 bottom-0 w-[2px] bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] z-10 pointer-events-none transition-transform duration-75"
                        style={{ left: `${currentTimelinePosPercent}%` }}
                      />
                    </div>
                  </div>

                  {/* Панель точного ручного редактирования выбранного блока */}
                  {selectedBlock && (
                    <div className="p-3 bg-zinc-800/50 rounded-lg border border-white/10 flex items-center justify-between gap-4 font-sans animate-fadeIn">
                      <div className="flex items-center gap-4 flex-wrap">
                        {/* Изменение типа */}
                        <div className="flex flex-col gap-1">
                          <span className="text-[8px] text-zinc-500 uppercase font-black font-sans">
                            Тип логического блока
                          </span>
                          <select
                            value={selectedBlock.type}
                            onChange={(e) =>
                              handleChangeBlockType(
                                selectedBlock.id,
                                e.target.value as TimelineBlockType,
                              )
                            }
                            className="bg-zinc-800 border border-white/10 text-white text-xs rounded-lg px-2 py-1.5 outline-none focus:border-rose-500 font-bold"
                          >
                            <option value="silence">
                              Серый: Полная тишина / фон
                            </option>
                            <option value="speaking">
                              Синий: Разговор (камера во весь экран)
                            </option>
                            <option value="dub">
                              Зеленый: Актер записывает дубль (PIP)
                            </option>
                          </select>
                        </div>

                        {/* Изменение времени начала */}
                        <div className="flex flex-col gap-1">
                          <span className="text-[8px] text-zinc-500 uppercase font-black font-sans">
                            Начало (сек)
                          </span>
                          <input
                            type="number"
                            step="0.05"
                            value={Number((selectedBlock.start ?? selectedBlock.originalStart).toFixed(3))}
                            onChange={(e) =>
                              handleUpdateBlockTimes(
                                selectedBlock.id,
                                parseFloat(e.target.value) || 0,
                                selectedBlock.end ?? selectedBlock.originalEnd,
                              )
                            }
                            className="bg-zinc-800 border border-white/10 text-white text-xs font-mono rounded-lg px-2 py-1.5 w-24 outline-none focus:border-rose-500"
                          />
                        </div>

                        {/* Изменение времени конца */}
                        <div className="flex flex-col gap-1">
                          <span className="text-[8px] text-zinc-500 uppercase font-black font-sans">
                            Конец (сек)
                          </span>
                          <input
                            type="number"
                            step="0.05"
                            value={Number((selectedBlock.end ?? selectedBlock.originalEnd).toFixed(3))}
                            onChange={(e) =>
                              handleUpdateBlockTimes(
                                selectedBlock.id,
                                selectedBlock.start ?? selectedBlock.originalStart,
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            className="bg-zinc-800 border border-white/10 text-white text-xs font-mono rounded-lg px-2 py-1.5 w-24 outline-none focus:border-rose-500"
                          />
                        </div>

                        {/* Длительность */}
                        <div className="flex flex-col gap-1">
                          <span className="text-[8px] text-zinc-500 uppercase font-black font-sans">
                            Длительность
                          </span>
                          <div className="text-xs text-zinc-300 font-mono py-1.5">
                            {selectedBlock.duration.toFixed(2)}s
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        {/* Кнопка Избранное ⭐ */}
                        <button
                          onClick={() => {
                            setBlocks(
                              blocks.map((b) =>
                                b.id === selectedBlock.id
                                  ? { ...b, isFavorite: !b.isFavorite }
                                  : b,
                              ),
                            );
                          }}
                          className={`p-1.5 rounded-lg flex items-center gap-1 px-3 transition-all ${selectedBlock.isFavorite ? "bg-amber-500 text-zinc-950 font-bold hover:bg-amber-400" : "bg-zinc-700 hover:bg-zinc-600 text-amber-400"}`}
                          title="Добавить в избранное"
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${selectedBlock.isFavorite ? "fill-zinc-950" : ""}`}
                          />
                          <span className="text-xs font-bold font-sans">
                            {selectedBlock.isFavorite
                              ? "В Избранном"
                              : "В Избранное"}
                          </span>
                        </button>

                        {/* Разделение блока */}
                        <button
                          onClick={() => handleSplitBlock(selectedBlock.id)}
                          className="p-1.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg flex items-center gap-1.5 px-3 transition-all"
                          title="Разрезать пополам"
                        >
                          <Scissors className="w-3.5 h-3.5" />
                          <span className="text-xs font-bold font-sans">
                            Разрезать
                          </span>
                        </button>

                        {/* Копировать блок */}
                        <button
                          onClick={() => handleCopyBlock(selectedBlock.id)}
                          className="p-1.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg flex items-center gap-1.5 px-3 transition-all"
                          title="Дублировать блок"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span className="text-xs font-bold font-sans">
                            Дублировать
                          </span>
                        </button>

                        {/* Удалить блок */}
                        <button
                          onClick={() => handleDeleteBlock(selectedBlock.id)}
                          className="p-1.5 bg-rose-500/20 hover:bg-rose-500/40 text-rose-400 rounded-lg flex items-center gap-1.5 px-3 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span className="text-xs font-bold uppercase font-sans">
                            Удалить
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center flex-col gap-4 text-zinc-500">
                <Video className="w-12 h-12 opacity-20" />
                <p className="text-sm font-medium font-sans">
                  Выберите сессию для редактирования
                </p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default BackstageEditor;
