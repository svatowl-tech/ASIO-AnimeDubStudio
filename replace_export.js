const fs = require('fs');
const content = fs.readFileSync('src/components/BackstageEditor.tsx', 'utf8');

const startHookIdx = content.indexOf('  // Стейт для хранения настроек экспорта и выбранного пресета');
const endHookIdx = content.indexOf('  const totalEditedDuration = useMemo(');

const replacement = `  const {
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

`;

const newContent = content.substring(0, startHookIdx) + replacement + content.substring(endHookIdx);

fs.writeFileSync('src/components/BackstageEditor.tsx', newContent);
