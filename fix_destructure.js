const fs = require('fs');
let content = fs.readFileSync('src/components/BackstageEditor.tsx', 'utf8');

const anchor = `  const {
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
  );`;

const hookCall = `  const {
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
    handleDrop
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

  const handleExportShorts = () => {
    // This is handled by a preset in useBackstageExport now, or we can just call handleAssembleVideo with some parameters, but wait, the old handleExportShorts was in useBackstageBlocks.ts
    // Let's create a wrapper here if we really need it, but we can just use the handleExportShorts from useBackstageBlocks.
  };
`;

content = content.replace(anchor, hookCall + '\n\n' + anchor);

// Wait, the state `blocks` and `selectedBlockId` are currently defined as `useState` in BackstageEditor.tsx! We must remove them!
content = content.replace(`  const [blocks, setBlocks] = useState<TimelineBlock[]>([]);\n  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);`, '');

fs.writeFileSync('src/components/BackstageEditor.tsx', content);
