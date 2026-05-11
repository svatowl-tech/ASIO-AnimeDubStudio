import React, { useEffect, useState, useRef } from 'react';
import { SubtitleLine } from '../types';

export const useSyncScriptScroll = (
  currentTime: number,
  subtitles: SubtitleLine[],
  containerRef: React.RefObject<HTMLDivElement | null>,
  idPrefix: string = ''
) => {
  const [isSyncEnabled, setIsSyncEnabled] = useState(true);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isSyncEnabled || !containerRef.current || !subtitles || subtitles.length === 0) return;

    const activeSub = subtitles.find(s => currentTime >= s.start && currentTime <= s.end);
    if (!activeSub) return;

    // Use ID if available, otherwise construct one from start time
    const activeId = activeSub.id || `sub-${activeSub.start.toFixed(3)}`;
    const element = document.getElementById(`${idPrefix}${activeId}`);

    if (element) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }, [currentTime, subtitles, isSyncEnabled, containerRef, idPrefix]);

  const handleManualInteraction = () => {
    setIsSyncEnabled(false);
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setIsSyncEnabled(true);
    }, 5000); // Re-enable after 5 seconds of inactivity
  };

  return { handleManualInteraction };
};
