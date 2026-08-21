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

const fns = [
  '  const handleMergeBackstage = async () => {',
  '  const handleSaveBlooper = async () => {'
];

const extracted = fns.map(getFnBody).filter(f => f !== null);

if (extracted.length === 2) {
  let exportContent = fs.readFileSync('src/hooks/useAppExport.ts', 'utf8');
  
  // Insert before the return statement in useAppExport
  const returnIdx = exportContent.lastIndexOf('  return {');
  if (returnIdx !== -1) {
    const newFunctions = extracted.map(e => e.text).join('\n\n') + '\n\n';
    exportContent = exportContent.substring(0, returnIdx) + newFunctions + exportContent.substring(returnIdx);
    
    // Update the return statement to include the new functions
    exportContent = exportContent.replace('  return {', '  return {\n    handleMergeBackstage,\n    handleSaveBlooper,');
    
    fs.writeFileSync('src/hooks/useAppExport.ts', exportContent);
    
    // Remove from App.tsx
    let newContent = content;
    extracted.sort((a, b) => b.startIdx - a.startIdx).forEach(e => {
      newContent = newContent.substring(0, e.startIdx) + newContent.substring(e.endIdx + (newContent[e.endIdx] === ';' ? 1 : 0));
    });
    
    // Add to hook destruction in App.tsx
    newContent = newContent.replace('handleMuxVideo\n  } = useAppExport', 'handleMuxVideo,\n    handleMergeBackstage,\n    handleSaveBlooper\n  } = useAppExport');
    
    fs.writeFileSync('src/App.tsx', newContent);
    console.log("Extracted handles");
  }
} else {
  console.log("Could not extract all functions");
}
