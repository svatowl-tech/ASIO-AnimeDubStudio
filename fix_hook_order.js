const fs = require('fs');

let appContent = fs.readFileSync('src/App.tsx', 'utf8');

const hookCall = `  const {
    handleBatchExport,
    handleExportAudioBook,
    handleExportStems,
    handleExportAllStemsZip,
    handleExport,
    handleMuxVideo
  } = useAppExport(project, setIsExporting, setExportProgress, setExportOperation, setIsExportModalOpen);`;

appContent = appContent.replace(hookCall + '\n', '');

const hookTarget = `  const [pendingExportFormat, setPendingExportFormat] = useState<'WAV' | 'MP3' | 'FLAC'>('WAV');`;
appContent = appContent.replace(hookTarget, hookTarget + '\n\n' + hookCall);

fs.writeFileSync('src/App.tsx', appContent);
