const fs = require('fs');
const content = fs.readFileSync('src/components/BackstageEditor.tsx', 'utf8');

const startHookIdx = content.indexOf('  // Автоматическое сохранение сессии при изменении блоков на таймлайне');
const endHookIdx = content.indexOf('  const handleSelectPreset = (presetId: string) => {');

const hookContent = content.substring(startHookIdx, endHookIdx);

const finalHook = `import { useState, useEffect } from "react";
import { TimelineBlock, BackstageSession, TimelineBlockType } from "../../types";

const MIN_DURATION = 0.5;

export function useBackstageBlocks(
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

${hookContent}

  return { blocks, setBlocks, selectedBlockId, setSelectedBlockId, handleDeleteBlock, handleCopyBlock, handleRemoveAllSilence, handleRemoveGarbage, handleUpdateBlockTimes, handleChangeBlockType, handleSplitBlock, handleDrop };
}
`;
fs.writeFileSync('src/hooks/backstage/useBackstageBlocks.ts', finalHook);
