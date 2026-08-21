const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// add import
content = content.replace("import { useProjectImport } from './hooks/useProjectImport';", "import { useProjectImport } from './hooks/useProjectImport';\nimport { useAppExport } from './hooks/useAppExport';");

// add hook call
const anchor = '  const { saveSnapshot, undo, redo, canUndo, canRedo } = useTimelineHistory(project, setProject);';
const hookCall = `
  const {
    handleBatchExport,
    handleExportAudioBook,
    handleExportStems,
    handleExportAllStemsZip,
    handleExport,
    handleMuxVideo
  } = useAppExport(project, setIsExporting, setExportProgress, setExportOperation);
`;

content = content.replace(anchor, anchor + hookCall);

fs.writeFileSync('src/App.tsx', content);
