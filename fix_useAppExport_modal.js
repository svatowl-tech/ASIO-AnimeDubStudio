const fs = require('fs');

let exportContent = fs.readFileSync('src/hooks/useAppExport.ts', 'utf8');
exportContent = exportContent.replace('setExportOperation: (v: string) => void\n) {', 'setExportOperation: (v: string) => void,\n  setIsExportModalOpen: (v: boolean) => void\n) {');
fs.writeFileSync('src/hooks/useAppExport.ts', exportContent);

let appContent = fs.readFileSync('src/App.tsx', 'utf8');
appContent = appContent.replace('const {\n    handleBatchExport,', 'const {\n    handleBatchExport,');
appContent = appContent.replace('setExportOperation);', 'setExportOperation, setIsExportModalOpen);');
fs.writeFileSync('src/App.tsx', appContent);
