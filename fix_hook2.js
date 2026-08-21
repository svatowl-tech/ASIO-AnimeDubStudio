const fs = require('fs');
let content = fs.readFileSync('src/hooks/backstage/useBackstageBlocks.ts', 'utf8');

content = content.replace(
  `  return { blocks, setBlocks, selectedBlockId, setSelectedBlockId, handleDeleteBlock, handleCopyBlock, handleRemoveAllSilence, handleRemoveGarbage, handleUpdateBlockTimes, handleChangeBlockType, handleSplitBlock, handleDrop };
}
  
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
`,
  `  const handleDrop = (e: any, targetBlockId: string) => {
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

  return { blocks, setBlocks, selectedBlockId, setSelectedBlockId, handleDeleteBlock, handleCopyBlock, handleRemoveAllSilence, handleRemoveGarbage, handleUpdateBlockTimes, handleChangeBlockType, handleSplitBlock, handleDrop };
}`
);

fs.writeFileSync('src/hooks/backstage/useBackstageBlocks.ts', content);
