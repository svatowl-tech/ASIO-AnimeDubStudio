const fs = require('fs');
let content = fs.readFileSync('src/components/BackstageEditor.tsx', 'utf8');

const useBackstageStart = content.indexOf('  const {\n    blocks,\n    setBlocks,');
const useBackstageEnd = content.indexOf('  const handleExportShorts = () => {');

const playStates = `  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimelineTime, setCurrentTimelineTime] = useState(0);
`;

content = content.replace(playStates, '');
content = content.substring(0, useBackstageStart) + playStates + '\n' + content.substring(useBackstageStart);

fs.writeFileSync('src/components/BackstageEditor.tsx', content);
