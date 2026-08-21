const fs = require('fs');
let content = fs.readFileSync('src/hooks/backstage/useBackstageBlocks.ts', 'utf8');

const returnStatement = '  return { blocks, setBlocks, selectedBlockId, setSelectedBlockId, handleDeleteBlock, handleCopyBlock, handleRemoveAllSilence, handleRemoveGarbage, handleUpdateBlockTimes, handleChangeBlockType, handleSplitBlock, handleDrop, handleRemoveSilence, handleExportShorts };\n';

const lines = content.split('\n');
lines.splice(lines.length - 2, 0, returnStatement);

fs.writeFileSync('src/hooks/backstage/useBackstageBlocks.ts', lines.join('\n'));
