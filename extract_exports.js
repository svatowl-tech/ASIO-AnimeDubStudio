const fs = require('fs');

const content = fs.readFileSync('src/App.tsx', 'utf8');

const getFnBody = (startStr) => {
  const startIdx = content.indexOf(startStr);
  if (startIdx === -1) return null;
  
  let openBraces = 0;
  let started = false;
  let endIdx = -1;
  
  for (let i = startIdx; i < content.length; i++) {
    if (content[i] === '{') {
      openBraces++;
      started = true;
    } else if (content[i] === '}') {
      openBraces--;
      if (started && openBraces === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }
  
  if (endIdx === -1) return null;
  
  const text = content.substring(startIdx, endIdx);
  // Add a trailing semicolon for the const declaration
  return { startIdx, endIdx, text: text + ';' };
};

const fns = [
  '  const handleBatchExport = async () => {',
  '  const handleExportAudioBook = async (gapSeconds: number = 1.5) => {',
  '  const handleExportStems = async () => {',
  '  const handleExportAllStemsZip = async () => {',
  '  const handleExport = async (options: { ',
  '  const handleMuxVideo = async () => {'
];

const extracted = fns.map(getFnBody).filter(f => f !== null);

const imports = `import { Project } from '../types';
import { logger } from '../lib/logger';

export function useAppExport(
  project: Project | null,
  setIsExporting: (v: boolean) => void,
  setExportProgress: (v: number) => void,
  setExportOperation: (v: string) => void
) {
`;

const returns = `
  return {
    handleBatchExport,
    handleExportAudioBook,
    handleExportStems,
    handleExportAllStemsZip,
    handleExport,
    handleMuxVideo
  };
}
`;

const fileContent = imports + extracted.map(e => e.text).join('\n\n') + returns;

fs.writeFileSync('src/hooks/useAppExport.ts', fileContent);

// Now remove them from App.tsx
let newContent = content;
extracted.sort((a, b) => b.startIdx - a.startIdx).forEach(e => {
  newContent = newContent.substring(0, e.startIdx) + newContent.substring(e.endIdx + (newContent[e.endIdx] === ';' ? 1 : 0));
});

fs.writeFileSync('src/App.tsx', newContent);
