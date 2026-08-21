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
  return { startIdx, endIdx, text: text + ';' };
};

const extracted = getFnBody('  const handleQuickPreview = async (segmentId: string) => {');

if (extracted) {
  let exportContent = fs.readFileSync('src/hooks/useAppExport.ts', 'utf8');
  
  const returnIdx = exportContent.lastIndexOf('  return {');
  if (returnIdx !== -1) {
    const newFunction = extracted.text + '\n\n';
    exportContent = exportContent.substring(0, returnIdx) + newFunction + exportContent.substring(returnIdx);
    
    exportContent = exportContent.replace('  return {', '  return {\n    handleQuickPreview,');
    fs.writeFileSync('src/hooks/useAppExport.ts', exportContent);
    
    let newContent = content;
    newContent = newContent.substring(0, extracted.startIdx) + newContent.substring(extracted.endIdx + (newContent[extracted.endIdx] === ';' ? 1 : 0));
    
    newContent = newContent.replace('handleSaveBlooper\n  } = useAppExport', 'handleSaveBlooper,\n    handleQuickPreview\n  } = useAppExport');
    
    fs.writeFileSync('src/App.tsx', newContent);
    console.log("Moved quick preview");
  }
}
