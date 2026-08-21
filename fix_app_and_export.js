const fs = require('fs');

let appContent = fs.readFileSync('src/App.tsx', 'utf8');
let exportContent = fs.readFileSync('src/hooks/useAppExport.ts', 'utf8');

// The bad extracted part in useAppExport:
const badExportPart = `  const handleExport = async (options: { 
    format: 'WAV' | 'MP3' | 'FLAC', 
    includeVideo: boolean, 
    includeOriginalAudio: boolean,
    forceMono: boolean 
  };`;

// We need to find the rest of handleExport in App.tsx
// It starts with `) => {\n    logger.info("handleExport triggered`
const appLines = appContent.split('\n');
let startIndex = -1;
let endIndex = -1;
for (let i = 0; i < appLines.length; i++) {
  if (appLines[i].includes(') => {') && appLines[i+1] && appLines[i+1].includes('logger.info("handleExport triggered')) {
    startIndex = i;
  }
  if (startIndex !== -1 && appLines[i].includes('const handleImportAudioTrack = async () => {')) {
    endIndex = i;
    break;
  }
}

if (startIndex !== -1 && endIndex !== -1) {
  const restOfExport = appLines.slice(startIndex, endIndex).join('\n');
  
  // Reconstruct handleExport:
  const fullHandleExport = `  const handleExport = async (options: { 
    format: 'WAV' | 'MP3' | 'FLAC', 
    includeVideo: boolean, 
    includeOriginalAudio: boolean,
    forceMono: boolean 
  } ` + restOfExport.trim() + '\n';
  
  // Remove badExportPart from useAppExport
  // Note: the exact formatting might differ, so we can just replace the whole handleExport to handleMuxVideo part
  const idxStart = exportContent.indexOf('  const handleExport = async (options: {');
  const idxEnd = exportContent.indexOf('  const handleMuxVideo = async () => {');
  
  if (idxStart !== -1 && idxEnd !== -1) {
    exportContent = exportContent.substring(0, idxStart) + fullHandleExport + '\n\n' + exportContent.substring(idxEnd);
  }
  
  // Remove the restOfExport from App.tsx
  appLines.splice(startIndex, endIndex - startIndex);
  appContent = appLines.join('\n');
  
  fs.writeFileSync('src/hooks/useAppExport.ts', exportContent);
  fs.writeFileSync('src/App.tsx', appContent);
  console.log("Fixed.");
} else {
  console.log("Could not find bounds.");
}
