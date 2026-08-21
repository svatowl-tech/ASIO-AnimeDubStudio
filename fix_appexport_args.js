const fs = require('fs');

let exportContent = fs.readFileSync('src/hooks/useAppExport.ts', 'utf8');

// Add AudioSegment to imports
exportContent = exportContent.replace("import { Project } from '../types';", "import { Project, AudioSegment } from '../types';");

// Replace hook signature
exportContent = exportContent.replace(
  'setExportOperation: (v: string) => void,\n  setIsExportModalOpen: (v: boolean) => void\n) {',
  'setExportOperation: (v: string) => void,\n  setIsExportModalOpen: (v: boolean) => void,\n  isRecording: boolean,\n  selectedSegmentIds: string[]\n) {'
);

// Replace track.isOriginal with track.name === 'Оригинал'
exportContent = exportContent.replace(/!track\.isOriginal/g, "track.name !== 'Оригинал'");

fs.writeFileSync('src/hooks/useAppExport.ts', exportContent);

let appContent = fs.readFileSync('src/App.tsx', 'utf8');

// Update hook call
appContent = appContent.replace(
  'setExportOperation, setIsExportModalOpen);',
  'setExportOperation, setIsExportModalOpen, isRecording, selectedSegmentIds);'
);

fs.writeFileSync('src/App.tsx', appContent);
