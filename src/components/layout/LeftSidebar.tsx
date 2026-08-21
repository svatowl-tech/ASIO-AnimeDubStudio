import React, { useRef, useState } from 'react';
import Sidebar from '../Sidebar';
import { useProjectData } from '../../contexts/ProjectContext';
import { useTimelineData } from '../../contexts/TimelineContext';

export const LeftSidebar: React.FC = () => {
  const { project, setProject, saveSnapshot } = useProjectData();
  const { currentTime, handleSeek, togglePlay, isPlaying, sidebarWidth, setSidebarWidth, referenceAudioRef, isHighlightingMissingSubtitles } = useTimelineData();
  
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [sidebarScrollTop, setSidebarScrollTop] = useState(0);

  const handleShiftSubtitles = (newOffset: number) => {
    if (!project) return;
    const currentOffset = project.subtitlesOffset || 0;
    const delta = newOffset - currentOffset;

    if (delta === 0) return;

    const shiftedSubtitles = (project.subtitles || []).map((sub) => ({
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

  const handleRolesChange = (newRoles: string[]) => {
    if (!project) return;
    setProject({
      ...project,
      selectedRoles: newRoles,
      // Sync main selectedRole with the first active role in the selection
      selectedRole: newRoles[0] || project.selectedRole || 'Default'
    });
  };

  const handleAddProjectRole = (newRole: string) => {
    if (!project) return;
    const sanitized = newRole.trim();
    if (!sanitized) return;
    
    const updatedRoles = project.roles.includes(sanitized) 
      ? project.roles 
      : [...project.roles, sanitized];
    
    const currentActive = project.selectedRoles && project.selectedRoles.length > 0
      ? project.selectedRoles
      : (project.selectedRole ? [project.selectedRole] : []);

    const updatedActive = currentActive.includes(sanitized)
      ? currentActive
      : [...currentActive, sanitized];

    setProject({
      ...project,
      roles: updatedRoles,
      selectedRoles: updatedActive,
      selectedRole: sanitized
    });
  };

  const handleAddSubtitlesAsRole = (newSubtitles: any[], newRoles: string[]) => {
    if (!project) return;
    saveSnapshot();

    // 1. Merge subtitles and sort by start time
    const mergedSubtitles = [...project.subtitles, ...newSubtitles].sort((a, b) => a.start - b.start);

    // 2. Merge roles
    const updatedRoles = [...project.roles];
    newRoles.forEach(r => {
      if (!updatedRoles.includes(r)) {
        updatedRoles.push(r);
      }
    });

    // 3. Update active roles
    const currentActive = project.selectedRoles && project.selectedRoles.length > 0
      ? project.selectedRoles
      : (project.selectedRole ? [project.selectedRole] : []);

    const updatedActive = [...currentActive];
    newRoles.forEach(r => {
      if (!updatedActive.includes(r)) {
        updatedActive.push(r);
      }
    });

    setProject({
      ...project,
      subtitles: mergedSubtitles,
      roles: updatedRoles,
      selectedRoles: updatedActive,
      selectedRole: newRoles[0] || project.selectedRole || 'Default'
    });
  };

  return (
    <Sidebar 
      project={project}
      selectedRole={project?.selectedRole || ''}
      onRoleChange={(role) => {
        if (!project) return;
        const currentActive = project.selectedRoles && project.selectedRoles.length > 0
          ? project.selectedRoles
          : (project.selectedRole ? [project.selectedRole] : []);
        // When changing primary role, ensure it is also active in the multi-role list
        const updatedActive = currentActive.includes(role) 
          ? currentActive 
          : [role, ...currentActive.filter(r => r !== project.selectedRole)];
        setProject({ 
          ...project, 
          selectedRole: role,
          selectedRoles: updatedActive
        });
      }}
      onRolesChange={handleRolesChange}
      onAddSubtitlesAsRole={handleAddSubtitlesAsRole}
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
      isHighlightingMissingSubtitles={isHighlightingMissingSubtitles}
    />
  );
};

export default LeftSidebar;
