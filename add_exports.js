const fs = require('fs');
let content = fs.readFileSync('src/hooks/backstage/useBackstageBlocks.ts', 'utf8');
content = content.replace(
  'handleSplitBlock, handleDrop };',
  'handleSplitBlock, handleDrop, handleRemoveSilence, handleExportShorts };'
);
fs.writeFileSync('src/hooks/backstage/useBackstageBlocks.ts', content);

let beContent = fs.readFileSync('src/components/BackstageEditor.tsx', 'utf8');
beContent = beContent.replace(
  'handleSplitBlock,\n    handleDrop\n  } = useBackstageBlocks(',
  'handleSplitBlock,\n    handleDrop,\n    handleRemoveSilence,\n    handleExportShorts\n  } = useBackstageBlocks('
);
fs.writeFileSync('src/components/BackstageEditor.tsx', beContent);
