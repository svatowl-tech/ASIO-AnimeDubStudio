import { useState } from "react";
import { TimelineBlock, ExportSettings, BackstageSession, ExportPreset } from "../../types";

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: "youtube-standard",
    name: "YouTube (Полный экран, 16:9)",
    settings: {
      includeOriginal: false,
      aspectRatio: "16:9",
      splitShortVideos: false,
      professionalEditing: false,
      onlyFavorites: false,
      useAudioTransitions: true,
    },
  },
  {
    id: "youtube-pip",
    name: "YouTube (Реакция PIP, 16:9)",
    settings: {
      includeOriginal: true,
      aspectRatio: "16:9",
      splitShortVideos: false,
      professionalEditing: true,
      onlyFavorites: false,
      useAudioTransitions: true,
    },
  },
  {
    id: "shorts-auto",
    name: "Shorts (Авто-монтаж, 9:16)",
    settings: {
      includeOriginal: true,
      aspectRatio: "9:16",
      splitShortVideos: false,
      professionalEditing: true,
      onlyFavorites: true,
      useAudioTransitions: true,
    },
  },
  {
    id: "shorts-split",
    name: "Shorts (Разбить на клипы, 9:16)",
    settings: {
      includeOriginal: true,
      aspectRatio: "9:16",
      splitShortVideos: true,
      professionalEditing: true,
      onlyFavorites: true,
      useAudioTransitions: false,
    },
  },
];

export function useBackstageExport(
  selectedSession: BackstageSession | null,
  blocks: TimelineBlock[],
  projectSubtitles: any[],
  setIsProcessing: (processing: boolean) => void
) {
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    includeOriginal: true,
    aspectRatio: "16:9",
    splitShortVideos: false,
    professionalEditing: true,
    onlyFavorites: false,
    useAudioTransitions: false,
  });
  const [selectedPresetId, setSelectedPresetId] = useState<string>("custom");

  const handleSelectPreset = (presetId: string) => {
    console.log(`[BackstageEditor] Выбран пресет экспорта: ${presetId}`);
    setSelectedPresetId(presetId);
    const preset = EXPORT_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      setExportSettings(preset.settings);
    }
  };

  const handleUpdateSetting = <K extends keyof ExportSettings>(
    key: K,
    value: ExportSettings[K]
  ) => {
    console.log(`[BackstageEditor] Обновление настройки экспорта ${String(key)}:`, value);
    const updatedSettings = { ...exportSettings, [key]: value };
    setExportSettings(updatedSettings);

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

  const handleAssembleVideo = async (forceOnlyFavorites?: boolean, usePip?: boolean) => {
    if (!window.electronAPI || !selectedSession) return;
    const isOnlyFavorites = forceOnlyFavorites || exportSettings.onlyFavorites;

    const finalBlocksForExport = isOnlyFavorites
      ? blocks.filter((b) => b.isFavorite)
      : blocks;

    if (finalBlocksForExport.length === 0) {
      alert("Невозможно экспортировать: список блоков пуст! Выберите хотя бы один блок в Избранное.");
      return;
    }

    const saveRes = await window.electronAPI.saveFile({
      title: "Собрать видео",
      defaultPath: selectedSession.videoPath.replace(
        /\.(webm|mp4)$/i,
        usePip ? "_pip.mp4" : "_assembled.mp4"
      ),
      filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
    });

    if (!saveRes.success || !saveRes.data) return;
    const outPath = saveRes.data;

    console.log(`[BackstageEditor] Запуск сборки видео (Сборка избранного: ${isOnlyFavorites}) для сессии ${selectedSession.id}`);
    setIsProcessing(true);

    let currentOutputTime = 0;
    const blocksDataForExport: TimelineBlock[] = [];

    for (const block of finalBlocksForExport) {
      blocksDataForExport.push(block);
      currentOutputTime += block.duration;
    }

    const originalVideoPath = selectedSession.originalVideoPath;

    const res = await window.electronAPI.exportBackstageAssemble({
      videoPath: selectedSession.videoPath,
      originalVideoPath,
      subtitles: projectSubtitles,
      blocks: blocksDataForExport,
      settings: { ...exportSettings, onlyFavorites: isOnlyFavorites, pipCamera: usePip },
      outputPath: outPath,
    });

    if (res.success)
      alert("Сборка видео успешно завершена!\nСохранено в: " + res.data);
    else alert("Ошибка: " + res.error);
    setIsProcessing(false);
  };

  const handleExportSingleBlock = async (blockId: string) => {
    if (!window.electronAPI || !selectedSession) return;
    const block = blocks.find(b => b.id === blockId);
    if (!block) return;

    const saveRes = await window.electronAPI.saveFile({
      title: "Экспортировать блок",
      defaultPath: selectedSession.videoPath.replace(
        /\.(webm|mp4)$/i,
        `_block_${block.id.slice(0, 5)}.mp4`
      ),
      filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
    });

    if (!saveRes.success || !saveRes.data) return;
    const outPath = saveRes.data;

    setIsProcessing(true);

    const res = await window.electronAPI.exportBackstageAssemble({
      videoPath: selectedSession.videoPath,
      originalVideoPath: selectedSession.originalVideoPath,
      subtitles: projectSubtitles,
      blocks: [block],
      settings: exportSettings,
      outputPath: outPath,
    });

    if (res.success)
      alert("Экспорт блока успешно завершен!\nСохранено в: " + res.data);
    else alert("Ошибка: " + res.error);
    setIsProcessing(false);
  };

  return {
    exportSettings,
    selectedPresetId,
    handleSelectPreset,
    handleUpdateSetting,
    handleAssembleVideo,
    handleExportSingleBlock,
    EXPORT_PRESETS
  };
}
