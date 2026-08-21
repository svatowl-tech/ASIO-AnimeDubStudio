const fs = require('fs');
const content = fs.readFileSync('src/components/BackstageEditor.tsx', 'utf8');

const startIdx = content.indexOf('const EXPORT_PRESETS');
const endIdx = content.indexOf('const BackstageEditor');

const newContent = content.substring(0, startIdx) + content.substring(endIdx);
fs.writeFileSync('src/components/BackstageEditor.tsx', newContent);
