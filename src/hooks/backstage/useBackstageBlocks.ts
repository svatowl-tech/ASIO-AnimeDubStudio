import React from "react";
import { useState, useEffect } from "react";
import { TimelineBlock, BackstageSession, TimelineBlockType } from "../../types";

const MIN_DURATION = 0.5;

export function useBackstageBlocks(
  setIsProcessing: (b: boolean) => void,

  projectPath: string,
  projectSubtitles: any[],
  selectedSession: BackstageSession | null,
  setSelectedSession: (s: BackstageSession | null) => void,
  setSessions: React.Dispatch<React.SetStateAction<BackstageSession[]>>,
  setCurrentTimelineTime: (time: number) => void,
  setIsPlaying: (playing: boolean) => void
) {
  const [blocks, setBlocks] = useState<TimelineBlock[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  // Автоматическое сохранение сессии при изменении блоков на таймлайне
  useEffect(() => {
    if (!selectedSession || !projectPath || blocks.length === 0 || !window.electronAPI) return;

    const timer = setTimeout(() => {
      // Считаем start и end для каждого блока на итоговом таймлайне в секундах
      let accumulatedTime = 0;
      const blocksWithTimings = (blocks || []).map((block) => {
        const blockStart = accumulatedTime;
        const blockEnd = accumulatedTime + block.duration;
        accumulatedTime = blockEnd;

        // Попробуем сопоставить текст субтитров, если это дубль
        let matchedText = block.text;
        if (!matchedText && block.type === "dub") {
          const dubInfo = (selectedSession.dubs || []).find(
            (d) => Math.abs(d.backstageStartTime - block.originalStart) < 0.2,
          );
          if (dubInfo) {
            const matchingSub = (projectSubtitles || []).find(
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
        setSessions(prev => (prev || []).map(s => s.id === selectedSession.id ? updatedSession : s));
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
      // Migration for older sessions where originalStart/originalEnd was missing for silence/speaking
      const migratedBlocks = (selectedSession.blocks || []).map(b => {
        if (b.originalStart === undefined) {
          return {
            ...b,
            originalStart: b.start ?? 0,
            originalEnd: b.end ?? (b.start ?? 0) + b.duration
          };
        }
        return b;
      });
      setBlocks(migratedBlocks);
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
    (selectedSession.dubs || []).forEach((d) => {
      ranges.push({
        type: "dub",
        start: Math.max(0, d.backstageStartTime),
        end: Math.min(durationSec, d.backstageEndTime),
        videoRefStart: d.timelineStartTime,
        videoRefEnd: d.timelineStartTime + (d.backstageEndTime - d.backstageStartTime),
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

    const dubsToKeep = (selectedSession?.dubs || []).map((d) => ({
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


  
  const handleDrop = (e: React.DragEvent, targetBlockId: string) => {
    e.preventDefault();
    const draggedBlockId = e.dataTransfer.getData("blockId");
    if (!draggedBlockId || draggedBlockId === targetBlockId) return;

    setBlocks((prevBlocks) => {
      const draggedIndex = prevBlocks.findIndex((b) => b.id === draggedBlockId);
      const targetIndex = prevBlocks.findIndex((b) => b.id === targetBlockId);
      if (draggedIndex === -1 || targetIndex === -1) return prevBlocks;

      const newBlocks = [...prevBlocks];
      const [draggedBlock] = newBlocks.splice(draggedIndex, 1);
      newBlocks.splice(targetIndex, 0, draggedBlock);

      return newBlocks;
    });
  };

  return { blocks, setBlocks, selectedBlockId, setSelectedBlockId, handleDeleteBlock, handleCopyBlock, handleRemoveAllSilence, handleRemoveGarbage, handleUpdateBlockTimes, handleChangeBlockType, handleSplitBlock, handleDrop, handleRemoveSilence, handleExportShorts };

}
