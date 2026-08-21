const fs = require('fs');
let content = fs.readFileSync('src/hooks/backstage/useBackstageBlocks.ts', 'utf8');

const returnStatement = '  return { blocks, setBlocks, selectedBlockId, setSelectedBlockId, handleDeleteBlock, handleCopyBlock, handleRemoveAllSilence, handleRemoveGarbage, handleUpdateBlockTimes, handleChangeBlockType, handleSplitBlock, handleDrop, handleRemoveSilence, handleExportShorts };\n';

content = content.replace(returnStatement, '');
content = content.replace('  };\n}', '  };\n\n' + returnStatement + '}');

fs.writeFileSync('src/hooks/backstage/useBackstageBlocks.ts', content);
