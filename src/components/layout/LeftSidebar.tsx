import React, { useRef, useState } from 'react';
import Sidebar from '../Sidebar';
import { useProjectData } from '../../contexts/ProjectContext';
import { useTimelineData } from '../../contexts/TimelineContext';

export const LeftSidebar: React.FC = () => {
  const { project, setProject } = useProjectData();
  const { currentTime, handleSeek, togglePlay, isPlaying, sidebarWidth, setSidebarWidth, referenceAudioRef } = useTimelineData();
  
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [sidebarScrollTop, setSidebarScrollTop] = useState(0);

  const handleShiftSubtitles = (newOffset: number) => {
    if (!project) return;
    const currentOffset = project.subtitlesOffset || 0;
    const delta = newOffset - currentOffset;

    if (delta === 0) return;

    const shiftedSubtitles = project.subtitles.map((sub) => ({
      ...sub,
      start: Number((sub.start + delta).toFixed(3)),
      end: Number((sub.end + delta).toFixed(3)),
    }));

    setProject({
      ...project,
      subtitles: shiftedSubtitles,
      subtitlesOffset: Number(newOffset.toFixed(3)),
    });
  };

  return (
    <Sidebar 
      project={project}
      selectedRole={project?.selectedRole || ''}
      onRoleChange={(role) => project && setProject({ ...project, selectedRole: role })}
      currentTime={currentTime}
      onSeek={handleSeek}
      onTogglePlay={togglePlay}
      isPlaying={isPlaying}
      sidebarScrollTop={sidebarScrollTop}
      onScroll={setSidebarScrollTop}
      sidebarRef={sidebarRef}
      width={sidebarWidth}
      onResize={(w) => {
        const newWidth = Math.max(200, Math.min(w, 600));
        setSidebarWidth(newWidth);
      }}
      referenceAudioRef={referenceAudioRef as React.RefObject<HTMLAudioElement>}
      onShiftSubtitles={handleShiftSubtitles}
    />
  );
};

export default LeftSidebar;
