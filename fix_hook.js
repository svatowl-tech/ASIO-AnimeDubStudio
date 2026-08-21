const fs = require('fs');
const content = fs.readFileSync('src/hooks/backstage/useBackstageBlocks.ts', 'utf8');

let newContent = content.replace(
  'export function useBackstageBlocks(',
  'export function useBackstageBlocks(\n  setIsProcessing: (b: boolean) => void,\n'
);

newContent = newContent.replace(
  'handleSplitBlock, handleDrop };',
  `handleSplitBlock, handleDrop };
  
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
`
);

fs.writeFileSync('src/hooks/backstage/useBackstageBlocks.ts', newContent);
