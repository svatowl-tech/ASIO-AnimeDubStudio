const fs = require('fs');
let beContent = fs.readFileSync('src/components/BackstageEditor.tsx', 'utf8');

// Remove duplicate handleTimelineClick
const hcStart = beContent.indexOf('  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {');
if (hcStart !== -1) {
  const hcEnd = beContent.indexOf('  };', hcStart);
  if (hcEnd !== -1) {
    const nextStart = beContent.indexOf('  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {', hcEnd);
    if (nextStart !== -1) {
       const nextEnd = beContent.indexOf('  };', nextStart);
       beContent = beContent.substring(0, nextStart) + beContent.substring(nextEnd + 4);
    }
  }
}

// Remove handleDrop definition completely
const hdStart = beContent.indexOf('  const handleDrop = useCallback((e: React.DragEvent, targetBlockId: string) => {');
if (hdStart !== -1) {
  const hdEnd = beContent.indexOf('  }, [blocks, setBlocks]);');
  beContent = beContent.substring(0, hdStart) + beContent.substring(hdEnd + '  }, [blocks, setBlocks]);'.length);
}

fs.writeFileSync('src/components/BackstageEditor.tsx', beContent);
