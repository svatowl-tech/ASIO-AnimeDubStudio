const fs = require('fs');
const content = fs.readFileSync('src/components/BackstageEditor.tsx', 'utf8');

const startHookIdx = content.indexOf('  // Автоматическое сохранение сессии при изменении блоков на таймлайне');
const endHookIdx = content.indexOf('  const handleSelectPreset = (presetId: string) => {');

const replacement = `  const {
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
    projectPath,
    projectSubtitles,
    selectedSession,
    setSelectedSession,
    setSessions,
    setCurrentTimelineTime,
    setIsPlaying
  );

`;

const newContent = content.substring(0, startHookIdx) + replacement + content.substring(endHookIdx);

fs.writeFileSync('src/components/BackstageEditor.tsx', newContent);
