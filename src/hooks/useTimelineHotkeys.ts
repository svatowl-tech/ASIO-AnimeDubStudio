import React, { useEffect } from 'react';
import { Project } from '../types';
import { getDefaultKeyMap } from '../lib/utils';

interface UseTimelineHotkeysProps {
  projectRef: React.MutableRefObject<Project | null>;
  selectedSegmentIds: string[];
  currentTimeRef: React.MutableRefObject<number>;
  isRecordingRef: React.MutableRefObject<boolean>;
  isStartingRecordingRef?: React.MutableRefObject<boolean>;
  togglePlay: () => void;
  stopRecording?: () => void;
  discardRecording?: () => void;
  handleSplitSegment: (trackId: string, segmentId: string, splitTime: number) => void;
  handleSeek?: (time: number) => void;
  addMarker?: () => void;
  deleteSegments?: () => void;
  handleToggleRecord?: () => void;
  handleToggleBackstage?: () => void;
  handleDeleteLastTake?: () => void;
  handleJoinSegments?: () => void;
  handleCopySegments?: () => void;
  handleCutSegments?: () => void;
  handlePasteSegments?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

export function useTimelineHotkeys({
  projectRef,
  selectedSegmentIds,
  currentTimeRef,
  isRecordingRef,
  isStartingRecordingRef,
  togglePlay,
  stopRecording,
  discardRecording,
  handleSplitSegment,
  handleSeek,
  addMarker,
  deleteSegments,
  handleToggleRecord,
  handleToggleBackstage,
  handleDeleteLastTake,
  handleJoinSegments,
  handleCopySegments,
  handleCutSegments,
  handlePasteSegments,
  onUndo,
  onRedo
}: UseTimelineHotkeysProps) {
  const callbacksRef = React.useRef({
    togglePlay, stopRecording, discardRecording, handleSplitSegment,
    handleSeek, addMarker, deleteSegments, handleToggleRecord,
    handleToggleBackstage, handleDeleteLastTake, handleJoinSegments,
    handleCopySegments, handleCutSegments, handlePasteSegments,
    onUndo, onRedo
  });

  useEffect(() => {
    callbacksRef.current = {
      togglePlay, stopRecording, discardRecording, handleSplitSegment,
      handleSeek, addMarker, deleteSegments, handleToggleRecord,
      handleToggleBackstage, handleDeleteLastTake, handleJoinSegments,
      handleCopySegments, handleCutSegments, handlePasteSegments,
      onUndo, onRedo
    };
  });

  useEffect(() => {
    const isTyping = (el: Element | null): boolean => {
      if (!el || el === document.body) return false;

      // Real text editable areas
      if ((el as HTMLElement).isContentEditable) return true;
      if (el instanceof HTMLTextAreaElement) return true;

      // Text-like input elements
      if (el instanceof HTMLInputElement) {
        const nonTextInputs = ['range', 'checkbox', 'radio', 'button', 'submit', 'file', 'image', 'reset'];
        if (!nonTextInputs.includes(el.type)) {
          return true;
        }
      }

      // Native select dropdowns when focused
      if (el instanceof HTMLSelectElement) {
        return true;
      }

      // Inside open modal/dialog where hotkeys belong to the modal
      const modalContainer = el.closest('dialog, [role="dialog"], .modal');
      if (modalContainer) {
        return true;
      }

      return false;
    };

    const blurActiveElement = () => {
      const el = document.activeElement;
      if (el && el !== document.body && el instanceof HTMLElement) {
        el.blur();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const userIsTyping = isTyping(activeElement);

      // Undo/Redo shortcuts - work unless actively editing text
      if (e.ctrlKey || e.metaKey) {
        if (e.code === 'KeyZ' || e.key?.toLowerCase() === 'z' || e.key?.toLowerCase() === 'я') {
          if (!userIsTyping) {
            blurActiveElement();
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) {
              callbacksRef.current.onRedo?.();
            } else {
              callbacksRef.current.onUndo?.();
            }
            return;
          }
        }
        if (e.code === 'KeyY' || e.key?.toLowerCase() === 'y' || e.key?.toLowerCase() === 'н') {
          if (!userIsTyping) {
            blurActiveElement();
            e.preventDefault();
            e.stopPropagation();
            callbacksRef.current.onRedo?.();
            return;
          }
        }
      }

      if (userIsTyping) return;

      const currentKeyMap = projectRef.current?.audioSettings?.keyMap || getDefaultKeyMap();

      const isPressed = (actionId: string) => {
        const action = currentKeyMap[actionId];
        if (!action) return false;

        const matchesCtrl = action.ctrlKey === undefined ? !e.ctrlKey : !!e.ctrlKey === !!action.ctrlKey;
        const matchesShift = action.shiftKey === undefined ? !e.shiftKey : !!e.shiftKey === !!action.shiftKey;
        const matchesAlt = action.altKey === undefined ? !e.altKey : !!e.altKey === !!action.altKey;

        if (!matchesCtrl || !matchesShift || !matchesAlt) return false;

        // Code match (physical key e.g. 'KeyR', 'Space', 'Backspace', 'Home', 'End', 'ArrowLeft')
        if (e.code === action.code) return true;

        // Letter key fallback (e.g. action.code = 'KeyR' -> matches e.key = 'r' or 'R' or Russian layout)
        if (action.code && action.code.startsWith('Key')) {
          const char = action.code.substring(3).toLowerCase();
          if (e.key && e.key.toLowerCase() === char) return true;
        }

        // Exact key name match (e.g. 'Space', 'Delete', 'Backspace', 'Escape', 'Home', 'End')
        if (e.key === action.code) return true;

        return false;
      };

      // Backspace / Delete
      if (e.code === 'Delete' || e.code === 'Backspace' || isPressed('delete_selected')) {
        const selectedIds = selectedSegmentIds;
        if (selectedIds && selectedIds.length > 0) {
          blurActiveElement();
          e.preventDefault();
          e.stopPropagation();
          callbacksRef.current.deleteSegments?.();
          return;
        }
      }

      // Play/Pause
      if (isPressed('play_pause') || (!currentKeyMap['play_pause'] && e.code === 'Space')) {
        blurActiveElement();
        e.preventDefault();
        e.stopPropagation();
        
        // Wait if recording is in the middle of starting!
        if (isStartingRecordingRef?.current) return;
        
        if (isRecordingRef && isRecordingRef.current && callbacksRef.current.stopRecording) {
          callbacksRef.current.stopRecording();
        } else {
          callbacksRef.current.togglePlay();
        }
        return;
      }

      // Toggle record (R key or configured record_toggle)
      if (
        isPressed('record_toggle') || 
        (!currentKeyMap['record_toggle'] && (e.code === 'KeyR' || e.key?.toLowerCase() === 'r' || e.key?.toLowerCase() === 'к') && !e.ctrlKey && !e.altKey && !e.metaKey)
      ) {
        blurActiveElement();
        e.preventDefault();
        e.stopPropagation();
        callbacksRef.current.handleToggleRecord?.();
        return;
      }

      // Discard recording
      if (isPressed('discard_recording') || e.code === 'Escape') {
        if (isRecordingRef.current && callbacksRef.current.discardRecording) {
          blurActiveElement();
          e.preventDefault();
          e.stopPropagation();
          callbacksRef.current.discardRecording();
          return;
        }
      }

      // Seek prev subtitle
      if (isPressed('seek_prev_sub')) {
        blurActiveElement();
        e.preventDefault();
        e.stopPropagation();
        const proj = projectRef.current;
        if (proj && proj.subtitles.length > 0 && callbacksRef.current.handleSeek) {
          const subs = proj.subtitles;
          const role = proj.selectedRole;
          const currentTime = currentTimeRef.current;
          
          // 1. Find current index
          let currentIndex = -1;
          const exactIndex = subs.findIndex(s => currentTime >= s.start && currentTime <= s.end);
          if (exactIndex !== -1) {
            currentIndex = exactIndex;
          } else {
            for (let i = subs.length - 1; i >= 0; i--) {
              if (currentTime > subs[i].start) {
                currentIndex = i;
                break;
              }
            }
          }

          // 2. Logic: If inside sub and > 0.5s from start, go to start
          const currentSub = currentIndex !== -1 ? subs[currentIndex] : null;
          if (currentSub && currentTime > currentSub.start + 0.5) {
            callbacksRef.current.handleSeek(currentSub.start);
            window.dispatchEvent(new CustomEvent('syncScroll'));
            return;
          }

          // 3. Otherwise find previous
          let targetIndex = -1;
          for (let i = currentIndex - 1; i >= 0; i--) {
            if (subs[i].role === role || !role) {
              targetIndex = i;
              break;
            }
          }
          if (targetIndex === -1 && currentIndex > 0) targetIndex = currentIndex - 1;

          if (targetIndex !== -1) {
            callbacksRef.current.handleSeek(subs[targetIndex].start);
          } else {
            callbacksRef.current.handleSeek(0);
          }
          window.dispatchEvent(new CustomEvent('syncScroll'));
        }
        return;
      }

      // Seek next subtitle
      if (isPressed('seek_next_sub')) {
        blurActiveElement();
        e.preventDefault();
        e.stopPropagation();
        const proj = projectRef.current;
        if (proj && proj.subtitles.length > 0 && callbacksRef.current.handleSeek) {
          const subs = proj.subtitles;
          const role = proj.selectedRole;
          const currentTime = currentTimeRef.current;

          // 1. Find current index
          let currentIndex = -1;
          const exactIndex = subs.findIndex(s => currentTime >= s.start && currentTime <= s.end);
          if (exactIndex !== -1) {
            currentIndex = exactIndex;
          } else {
            for (let i = subs.length - 1; i >= 0; i--) {
              if (currentTime > subs[i].start) {
                currentIndex = i;
                break;
              }
            }
          }

          // 2. Find next
          let targetIndex = -1;
          for (let i = currentIndex + 1; i < subs.length; i++) {
            if (subs[i].role === role || !role) {
              targetIndex = i;
              break;
            }
          }
          if (targetIndex === -1 && currentIndex < subs.length - 1) {
            targetIndex = currentIndex + 1;
          }

          if (targetIndex !== -1) {
            callbacksRef.current.handleSeek(subs[targetIndex].start);
          } else {
            // Seek to end
            let maxEnd = 0;
            proj.tracks.forEach(t => {
              t.segments.forEach(s => {
                maxEnd = Math.max(maxEnd, s.startTime + s.duration);
              });
            });
            callbacksRef.current.handleSeek(maxEnd);
          }
          window.dispatchEvent(new CustomEvent('syncScroll'));
        }
        return;
      }

      // Add marker
      if (isPressed('add_marker')) {
        blurActiveElement();
        e.preventDefault();
        e.stopPropagation();
        callbacksRef.current.addMarker?.();
        return;
      }

      // Toggle backstage
      if (isPressed('backstage_toggle')) {
        blurActiveElement();
        e.preventDefault();
        e.stopPropagation();
        callbacksRef.current.handleToggleBackstage?.();
        return;
      }

      // Delete last take
      if (isPressed('delete_take')) {
        blurActiveElement();
        e.preventDefault();
        e.stopPropagation();
        callbacksRef.current.handleDeleteLastTake?.();
        return;
      }

      // Join segments
      if (isPressed('join_segments')) {
        blurActiveElement();
        e.preventDefault();
        e.stopPropagation();
        callbacksRef.current.handleJoinSegments?.();
        return;
      }

      // Seek start
      if (isPressed('seek_start')) {
        blurActiveElement();
        e.preventDefault();
        e.stopPropagation();
        callbacksRef.current.handleSeek?.(0);
        return;
      }

      // Seek end
      if (isPressed('seek_end')) {
        blurActiveElement();
        e.preventDefault();
        e.stopPropagation();
        const proj = projectRef.current;
        if (proj && callbacksRef.current.handleSeek) {
          let maxEnd = 0;
          proj.tracks.forEach(t => {
            t.segments.forEach(s => {
              maxEnd = Math.max(maxEnd, s.startTime + s.duration);
            });
          });
          callbacksRef.current.handleSeek(maxEnd);
        }
        return;
      }

      // S / split_segment
      if (
        isPressed('split_segment') || 
        (!currentKeyMap['split_segment'] && (e.code === 'KeyS' || e.key?.toLowerCase() === 's' || e.key?.toLowerCase() === 'ы') && !e.ctrlKey && !e.altKey && !e.metaKey)
      ) {
        if (e.repeat) return;
        blurActiveElement();
        e.preventDefault();
        e.stopPropagation();
        callbacksRef.current.handleSplitSegment('', '', -1); 
        return;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isTyping(document.activeElement)) return;
      
      if (e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleCopy = (e: ClipboardEvent) => {
      if (isTyping(document.activeElement)) return;
      if (callbacksRef.current.handleCopySegments && selectedSegmentIds && selectedSegmentIds.length > 0) {
        e.preventDefault();
        callbacksRef.current.handleCopySegments();
      }
    };

    const handleCut = (e: ClipboardEvent) => {
      if (isTyping(document.activeElement)) return;
      if (callbacksRef.current.handleCutSegments && selectedSegmentIds && selectedSegmentIds.length > 0) {
        e.preventDefault();
        callbacksRef.current.handleCutSegments();
      }
    };

    const handlePaste = (e: ClipboardEvent) => {
      if (isTyping(document.activeElement)) return;
      if (callbacksRef.current.handlePasteSegments) {
        e.preventDefault();
        callbacksRef.current.handlePasteSegments();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });
    document.addEventListener('copy', handleCopy);
    document.addEventListener('cut', handleCut);
    document.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keyup', handleKeyUp, { capture: true });
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('cut', handleCut);
      document.removeEventListener('paste', handlePaste);
    };
  }, [
    projectRef, selectedSegmentIds, currentTimeRef, isRecordingRef
  ]);
}
