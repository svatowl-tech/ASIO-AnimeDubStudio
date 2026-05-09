import { useCallback, useRef, useState, Dispatch, SetStateAction } from 'react';
import { Project, AudioTrack } from '../types';

export function useTimelineHistory(
  project: Project | null,
  setProject: Dispatch<SetStateAction<Project | null>>
) {
  const [history, setHistory] = useState<AudioTrack[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isUndoRedoActionRef = useRef<boolean>(false);

  // Take a snapshot manually before an action
  const saveSnapshot = useCallback(() => {
    if (!project) return;
    setHistory(prev => {
      const currentHistory = prev.slice(0, historyIndex + 1);
      const newHistory = [...currentHistory, JSON.parse(JSON.stringify(project.tracks))];
      setHistoryIndex(newHistory.length - 1);
      return newHistory;
    });
  }, [project, historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex > 0 && project) {
      isUndoRedoActionRef.current = true;
      const previousTracks = history[historyIndex - 1];
      setProject(prev => prev ? { ...prev, tracks: JSON.parse(JSON.stringify(previousTracks)) } : prev);
      setHistoryIndex(prev => prev - 1);
    } else if (historyIndex === 0 && project && history.length > 0) {
      // If we go back to the original state right before our first snapshot:
      // Wait, let's keep index 0 as the initial state of the first modification.
      // So index 0 is our earliest state.
      // We can't undo beyond the first snapshot unless we take an initial one on load.
      isUndoRedoActionRef.current = true;
      const previousTracks = history[0];
      setProject(prev => prev ? { ...prev, tracks: JSON.parse(JSON.stringify(previousTracks)) } : prev);
    }
  }, [historyIndex, history, project, setProject]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1 && project) {
      isUndoRedoActionRef.current = true;
      const nextTracks = history[historyIndex + 1];
      setProject(prev => prev ? { ...prev, tracks: JSON.parse(JSON.stringify(nextTracks)) } : prev);
      setHistoryIndex(prev => prev + 1);
    }
  }, [historyIndex, history, project, setProject]);

  return { saveSnapshot, undo, redo };
}
