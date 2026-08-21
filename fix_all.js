const fs = require('fs');

// Fix BackstageEditor.tsx
let beContent = fs.readFileSync('src/components/BackstageEditor.tsx', 'utf8');

// Remove dummy handleExportShorts
beContent = beContent.replace(/  const handleExportShorts = \(\) => \{\n.*\n.*\n  \};\n/g, '');

// Remove handleDrop
const dropStart = beContent.indexOf('  const handleDrop = useCallback((e: React.DragEvent, targetBlockId: string) => {');
const dropEnd = beContent.indexOf('  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {');
if (dropStart !== -1 && dropEnd !== -1) {
  beContent = beContent.substring(0, dropStart) + beContent.substring(dropEnd);
}
fs.writeFileSync('src/components/BackstageEditor.tsx', beContent);

// Fix useBackstageBlocks.ts
let ubContent = fs.readFileSync('src/hooks/backstage/useBackstageBlocks.ts', 'utf8');
ubContent = ubContent.replace('videoRefStart: d.start,', 'videoRefStart: d.timelineStartTime,');
ubContent = ubContent.replace('videoRefEnd: d.end,', 'videoRefEnd: d.timelineStartTime + (d.backstageEndTime - d.backstageStartTime),');

fs.writeFileSync('src/hooks/backstage/useBackstageBlocks.ts', ubContent);
