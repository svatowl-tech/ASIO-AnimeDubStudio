import { useCallback, useState, useRef, useEffect, Dispatch, SetStateAction } from 'react';
import { Project } from '../types';
import { playbackEngine } from '../services/playbackEngine';

const MAX_HISTORY_STEPS = 50;

function cloneProjectForHistory(p: Project | null): Project | null {
  if (!p) return null;

  return {
    ...p,
    roles: p.roles ? [...p.roles] : [],
    selectedRoles: p.selectedRoles ? [...p.selectedRoles] : undefined,
    subtitles: p.subtitles ? p.subtitles.map(sub => ({ ...sub })) : [],
    markers: p.markers ? p.markers.map(m => ({ ...m })) : undefined,
    fixes: p.fixes ? p.fixes.map(f => ({ ...f })) : undefined,
    uiState: p.uiState ? { ...p.uiState } : undefined,
    audioSettings: p.audioSettings
      ? {
          ...p.audioSettings,
          exportSettings: p.audioSettings.exportSettings ? { ...p.audioSettings.exportSettings } : undefined,
          keyMap: p.audioSettings.keyMap ? { ...p.audioSettings.keyMap } : undefined,
        }
      : p.audioSettings,
    tracks: p.tracks
      ? p.tracks.map(track => ({
          ...track,
          processing: track.processing
            ? {
                ...track.processing,
                lufsNormalize: track.processing.lufsNormalize ? { ...track.processing.lufsNormalize } : undefined,
                noiseGate: track.processing.noiseGate ? { ...track.processing.noiseGate } : undefined,
                compressor: track.processing.compressor ? { ...track.processing.compressor } : undefined,
                eq: track.processing.eq ? { ...track.processing.eq } : undefined,
                fades: track.processing.fades ? { ...track.processing.fades } : undefined,
              }
            : undefined,
          segments: track.segments
            ? track.segments.map(seg => ({
                ...seg,
                // Preserve exact array reference for waveform to avoid duplicating heavy arrays across 50 history steps
                waveform: seg.waveform,
              }))
            : [],
        }))
      : [],
    // Preserve exact array reference for originalPeaks
    originalPeaks: p.originalPeaks,
  };
}

function projectToJsonWithoutPeaks(p: Project | null): string {
  if (!p) return '';
  return JSON.stringify(p, (key, value) => {
    if (key === 'waveform' || key === 'originalPeaks') {
      return undefined;
    }
    return value;
  });
}

export function useTimelineHistory(
  project: Project | null,
  setProject: Dispatch<SetStateAction<Project | null>>
) {
  const historyRef = useRef<(Project | null)[]>([]);
  const historyIndexRef = useRef<number>(-1);

  const isUndoRedoActionRef = useRef<boolean>(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const updateStateFlags = useCallback(() => {
    const len = historyRef.current.length;
    const idx = historyIndexRef.current;
    setCanUndo(idx > 0);
    setCanRedo(idx >= 0 && idx < len - 1);
  }, []);

  // Initialize or reset history when project is loaded/switched
  useEffect(() => {
    if (!project) {
      if (activeProjectIdRef.current !== null) {
        activeProjectIdRef.current = null;
        historyRef.current = [];
        historyIndexRef.current = -1;
        updateStateFlags();
      }
      return;
    }

    if (activeProjectIdRef.current !== project.id) {
      activeProjectIdRef.current = project.id;
      const initialSnapshot = cloneProjectForHistory(project);
      historyRef.current = [initialSnapshot];
      historyIndexRef.current = 0;
      updateStateFlags();
    }
  }, [project, updateStateFlags]);

  // Take an explicit snapshot (call before or after an action)
  const saveSnapshot = useCallback((_targetId?: string) => {
    if (!project) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (isUndoRedoActionRef.current) return;

    const clonedCurrent = cloneProjectForHistory(project);
    if (!clonedCurrent) return;

    const currentIndex = historyIndexRef.current;
    if (
      currentIndex >= 0 &&
      currentIndex < historyRef.current.length &&
      historyRef.current[currentIndex]
    ) {
      const lastSavedJson = projectToJsonWithoutPeaks(historyRef.current[currentIndex]);
      const currentJson = projectToJsonWithoutPeaks(clonedCurrent);
      if (lastSavedJson === currentJson) {
        return;
      }
    }

    const truncatedHistory = historyRef.current.slice(0, Math.max(0, currentIndex + 1));
    truncatedHistory.push(clonedCurrent);

    if (truncatedHistory.length > MAX_HISTORY_STEPS) {
      truncatedHistory.shift();
    }

    historyRef.current = truncatedHistory;
    historyIndexRef.current = truncatedHistory.length - 1;
    updateStateFlags();
  }, [project, updateStateFlags]);

  // Automatic debounced snapshot to catch ANY project state mutation across the app
  useEffect(() => {
    if (!project) return;

    if (isUndoRedoActionRef.current) {
      isUndoRedoActionRef.current = false;
      return;
    }

    if (activeProjectIdRef.current !== project.id) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;

      if (!project) return;
      const clonedCurrent = cloneProjectForHistory(project);
      if (!clonedCurrent) return;

      const currentIndex = historyIndexRef.current;
      if (
        currentIndex >= 0 &&
        currentIndex < historyRef.current.length &&
        historyRef.current[currentIndex]
      ) {
        const lastSavedJson = projectToJsonWithoutPeaks(historyRef.current[currentIndex]);
        const currentJson = projectToJsonWithoutPeaks(clonedCurrent);
        if (lastSavedJson === currentJson) {
          return;
        }
      }

      const truncatedHistory = historyRef.current.slice(0, Math.max(0, currentIndex + 1));
      truncatedHistory.push(clonedCurrent);

      if (truncatedHistory.length > MAX_HISTORY_STEPS) {
        truncatedHistory.shift();
      }

      historyRef.current = truncatedHistory;
      historyIndexRef.current = truncatedHistory.length - 1;
      updateStateFlags();
    }, 350);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [project, updateStateFlags]);

  // Undo implementation
  const undo = useCallback(() => {
    if (!project || historyRef.current.length === 0) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    let currentIndex = historyIndexRef.current;

    // Save unsaved tip if user made edits after the last snapshot
    if (currentIndex === historyRef.current.length - 1 && historyRef.current[currentIndex]) {
      const currentCloned = cloneProjectForHistory(project);
      const lastSavedJson = projectToJsonWithoutPeaks(historyRef.current[currentIndex]);
      const currentJson = projectToJsonWithoutPeaks(currentCloned);

      if (lastSavedJson !== currentJson && currentCloned) {
        historyRef.current.push(currentCloned);
        if (historyRef.current.length > MAX_HISTORY_STEPS) {
          historyRef.current.shift();
          currentIndex = historyRef.current.length - 2;
        } else {
          currentIndex = historyRef.current.length - 1;
        }
      }
    }

    if (currentIndex > 0) {
      const targetIndex = currentIndex - 1;
      const restoredProject = cloneProjectForHistory(historyRef.current[targetIndex]);
      if (restoredProject) {
        isUndoRedoActionRef.current = true;
        historyIndexRef.current = targetIndex;
        setProject(restoredProject);
        if (restoredProject.tracks) {
          playbackEngine.reconcile(restoredProject.tracks);
        }
        updateStateFlags();
      }
    }
  }, [project, setProject, updateStateFlags]);

  // Redo implementation
  const redo = useCallback(() => {
    if (!project || historyRef.current.length === 0) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const currentIndex = historyIndexRef.current;
    if (currentIndex < historyRef.current.length - 1) {
      const targetIndex = currentIndex + 1;
      const restoredProject = cloneProjectForHistory(historyRef.current[targetIndex]);
      if (restoredProject) {
        isUndoRedoActionRef.current = true;
        historyIndexRef.current = targetIndex;
        setProject(restoredProject);
        if (restoredProject.tracks) {
          playbackEngine.reconcile(restoredProject.tracks);
        }
        updateStateFlags();
      }
    }
  }, [project, setProject, updateStateFlags]);

  return { saveSnapshot, undo, redo, canUndo, canRedo };
}

