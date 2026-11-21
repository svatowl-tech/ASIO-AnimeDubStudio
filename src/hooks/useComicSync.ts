import { useCallback, useEffect, useMemo, useRef, useState, Dispatch, SetStateAction, MutableRefObject } from 'react';
import {
  ComicBubblePin,
  ComicProjectData,
  ComicScrollTarget,
  ComicSyncPoint,
  ComicViewMode,
  Marker,
  Project,
  SubtitleLine,
} from '../types';
import { getGlobalAudioSettings } from '../lib/utils';

interface UseComicSyncParams {
  project: Project | null;
  setProject: Dispatch<SetStateAction<Project | null>>;
  currentTime: number;
  currentTimeRef: MutableRefObject<number>;
  isRecording: boolean;
  isPlaying?: boolean;
  selectedSegmentIds?: string[];
  duration: number;
  setDuration: (d: number) => void;
  onSeek: (time: number) => void;
  onStopPlayback?: () => void;
  onClearSelection?: () => void;
  saveSnapshot?: () => void;
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

export function useComicSync({
  project,
  setProject,
  currentTime,
  currentTimeRef,
  isRecording,
  isPlaying,
  selectedSegmentIds,
  duration,
  setDuration,
  onSeek,
  onStopPlayback,
  onClearSelection,
  saveSnapshot,
}: UseComicSyncParams) {
  const [stageView, setStageView] = useState<'comic' | 'video'>('comic');
  const [rightNavWidth, setRightNavWidth] = useState<number>(216);
  const [isRightNavCollapsed, setIsRightNavCollapsed] = useState<boolean>(false);
  const [scrollTarget, setScrollTarget] = useState<ComicScrollTarget | null>(null);

  const scrollTokenCounterRef = useRef<number>(0);
  const currentScrollFractionRef = useRef<number>(0);
  const lastAutoMarkerRef = useRef<{ key: string; timestamp: number }>({ key: '', timestamp: 0 });
  const lastScrollSyncRef = useRef<{
    trackId: string;
    chapterId: string;
    pageIndex: number;
    fraction: number;
    timestamp: number;
  }>({
    trackId: '',
    chapterId: '',
    pageIndex: -1,
    fraction: -1,
    timestamp: 0,
  });
  const lastTimelineSyncedKeyRef = useRef<string>('');

  // Resolve the currently active audio track for comic sync isolation:
  // 1. Armed track (matching useAudioEngine recording target)
  // 2. Track of currently selected audio segment (if no track is armed)
  // 3. First non-original dub track
  const { activeTrackId, activeTrackName, isFirstDubTrack } = useMemo(() => {
    const tracks = project?.tracks || [];
    const firstDubTrack = tracks.find((t) => t.name !== 'Оригинал') || tracks[0];
    const armedTrack = tracks.find((t) => t.isArmed);

    let resolved = armedTrack;
    if (!resolved && selectedSegmentIds && selectedSegmentIds.length > 0) {
      const selSet = new Set(selectedSegmentIds);
      resolved = tracks.find((t) => (t.segments || []).some((s) => selSet.has(s.id)));
    }
    if (!resolved) {
      resolved = firstDubTrack;
    }

    return {
      activeTrackId: resolved?.id || '',
      activeTrackName: resolved?.name || 'Дубли',
      isFirstDubTrack: !!resolved && !!firstDubTrack && resolved.id === firstDubTrack.id,
    };
  }, [project?.tracks, selectedSegmentIds]);

  const activeTrackIdRef = useRef<string>(activeTrackId);
  useEffect(() => {
    if (activeTrackIdRef.current !== activeTrackId) {
      activeTrackIdRef.current = activeTrackId;
      // Clear cached sync key so switching to another track immediately uses only that track's links
      lastTimelineSyncedKeyRef.current = '';
    }
  }, [activeTrackId]);

  const matchesActiveTrack = useCallback(
    (itemTrackId?: string): boolean => {
      if (!activeTrackId) return true;
      if (itemTrackId) return itemTrackId === activeTrackId;
      // Backward compatibility for legacy untagged sync points/pins:
      // only bind them to the first dub track so newly armed tracks stay completely clean.
      return isFirstDubTrack;
    },
    [activeTrackId, isFirstDubTrack]
  );

  const emitScrollTarget = useCallback(
    (target: Omit<ComicScrollTarget, 'token'>) => {
      scrollTokenCounterRef.current += 1;
      setScrollTarget({
        ...target,
        scrollFraction: clampFraction(target.scrollFraction),
        token: scrollTokenCounterRef.current,
      });
    },
    []
  );

  // Auto-switch stage to comic when a comic is loaded into a project without video
  useEffect(() => {
    if (project?.comic && !project.videoPath && !project.videoUrl) {
      setStageView('comic');
    }
  }, [project?.comic?.id, project?.videoPath, project?.videoUrl]);

  const handleComicImported = useCallback(
    (comicData: ComicProjectData, resolvedProjectPath?: string) => {
      if (saveSnapshot) saveSnapshot();

      setProject((prev) => {
        if (!prev) {
          const defaultRole = 'Персонаж 1';
          const newProj: Project = {
            id: `proj-${Date.now()}`,
            name: comicData.title || 'Озвучка комикса',
            projectPath: resolvedProjectPath,
            subtitles: [],
            roles: [defaultRole],
            selectedRole: defaultRole,
            selectedRoles: [defaultRole],
            tracks: [
              {
                id: 'track-dubs-1',
                name: 'Дубли',
                segments: [],
                volume: 1,
                isMuted: false,
                isArmed: true,
              },
            ],
            markers: [],
            latencyOffset: 0,
            audioOffsetMs: 0,
            audioSettings: getGlobalAudioSettings(),
            comic: comicData,
          };
          return newProj;
        }

        const nextRoles = prev.roles && prev.roles.length > 0 ? prev.roles : ['Персонаж 1'];
        const nextTracks =
          prev.tracks && prev.tracks.length > 0
            ? prev.tracks
            : [
                {
                  id: 'track-dubs-1',
                  name: 'Дубли',
                  segments: [],
                  volume: 1,
                  isMuted: false,
                  isArmed: true,
                },
              ];

        return {
          ...prev,
          name: prev.name === 'Демо Превью' || !prev.name ? comicData.title : prev.name,
          projectPath:
            prev.projectPath && prev.projectPath !== '/mock/path'
              ? prev.projectPath
              : resolvedProjectPath || prev.projectPath,
          roles: nextRoles,
          selectedRole: prev.selectedRole || nextRoles[0],
          tracks: nextTracks,
          comic: comicData,
        };
      });

      // Ensure timeline has generous runway when dubbing a comic without video
      if (duration < 300) {
        setDuration(300);
      }
      setStageView('comic');
      setIsRightNavCollapsed(false);
      currentScrollFractionRef.current = 0;
      lastTimelineSyncedKeyRef.current = '';
      if (comicData.activeChapterId) {
        emitScrollTarget({
          chapterId: comicData.activeChapterId,
          pageIndex: comicData.activePageIndex || 0,
          scrollFraction: 0,
          behavior: 'auto',
        });
      }
    },
    [saveSnapshot, setProject, duration, setDuration, emitScrollTarget]
  );

  const recordAutoPageMarker = useCallback(
    (chapterId: string, pageIndex: number, scrollFraction?: number) => {
      const now = Date.now();
      const trackId = activeTrackIdRef.current || undefined;
      const fraction = clampFraction(
        scrollFraction !== undefined ? scrollFraction : currentScrollFractionRef.current
      );
      const key = `${trackId || ''}:${chapterId}:${pageIndex}`;
      if (lastAutoMarkerRef.current.key === key && now - lastAutoMarkerRef.current.timestamp < 600) {
        return;
      }
      lastAutoMarkerRef.current = { key, timestamp: now };
      lastScrollSyncRef.current = {
        trackId: trackId || '',
        chapterId,
        pageIndex,
        fraction,
        timestamp: now,
      };

      const time = Math.max(0, Math.round(currentTimeRef.current * 100) / 100);
      const markerId = `comic-mk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const syncId = `comic-sp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      setProject((prev) => {
        if (!prev?.comic) return prev;
        const chapter = prev.comic.chapters.find((c) => c.id === chapterId);
        const chNum = chapter?.number || '1';
        const label = `Гл.${chNum} · Стр.${pageIndex + 1}`;

        const newMarker: Marker = {
          id: markerId,
          time,
          label,
          color: '#6366f1',
          trackId,
        };
        const newSync: ComicSyncPoint = {
          id: syncId,
          time,
          chapterId,
          pageIndex,
          scrollFraction: fraction,
          trackId,
          markerId,
        };

        return {
          ...prev,
          markers: [...(prev.markers || []), newMarker],
          comic: {
            ...prev.comic,
            activeChapterId: chapterId,
            activePageIndex: pageIndex,
            syncPoints: [...(prev.comic.syncPoints || []), newSync].sort((a, b) => a.time - b.time),
          },
        };
      });
    },
    [currentTimeRef, setProject]
  );

  const handleViewportScrollPosition = useCallback(
    (chapterId: string, pageIndex: number, scrollFraction: number) => {
      const clamped = clampFraction(scrollFraction);
      currentScrollFractionRef.current = clamped;

      if (!isRecording) {
        lastTimelineSyncedKeyRef.current = '';
        return;
      }

      const now = Date.now();
      const trackId = activeTrackIdRef.current || '';
      const prevSync = lastScrollSyncRef.current;
      const sameTarget =
        prevSync.trackId === trackId &&
        prevSync.chapterId === chapterId &&
        prevSync.pageIndex === pageIndex;
      const movedEnough = !sameTarget || Math.abs(clamped - prevSync.fraction) >= 0.08;

      if (!movedEnough || now - prevSync.timestamp < 350) {
        return;
      }

      lastScrollSyncRef.current = {
        trackId,
        chapterId,
        pageIndex,
        fraction: clamped,
        timestamp: now,
      };

      const time = Math.max(0, Math.round(currentTimeRef.current * 100) / 100);
      const syncId = `comic-sp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      setProject((prev) => {
        if (!prev?.comic) return prev;
        const newSync: ComicSyncPoint = {
          id: syncId,
          time,
          chapterId,
          pageIndex,
          scrollFraction: clamped,
          trackId: trackId || undefined,
          markerId: '',
        };
        return {
          ...prev,
          comic: {
            ...prev.comic,
            syncPoints: [...(prev.comic.syncPoints || []), newSync].sort((a, b) => a.time - b.time),
          },
        };
      });
    },
    [isRecording, currentTimeRef, setProject]
  );

  const handleActivePageChange = useCallback(
    (chapterId: string, pageIndex: number, source: 'scroll' | 'nav') => {
      if (source === 'nav') {
        // Every manually opened page or chapter MUST start at the very top
        currentScrollFractionRef.current = 0;
        lastTimelineSyncedKeyRef.current = '';
      }

      if (isRecording) {
        recordAutoPageMarker(chapterId, pageIndex, source === 'nav' ? 0 : currentScrollFractionRef.current);
      } else {
        setProject((prev) => {
          if (!prev?.comic) return prev;
          if (prev.comic.activeChapterId === chapterId && prev.comic.activePageIndex === pageIndex) {
            return prev;
          }
          return {
            ...prev,
            comic: {
              ...prev.comic,
              activeChapterId: chapterId,
              activePageIndex: pageIndex,
            },
          };
        });
      }

      if (source === 'nav') {
        emitScrollTarget({
          chapterId,
          pageIndex,
          scrollFraction: 0,
          behavior: 'auto',
        });
      }
    },
    [isRecording, recordAutoPageMarker, setProject, emitScrollTarget]
  );

  const handleSelectChapter = useCallback(
    (chapterId: string) => {
      handleActivePageChange(chapterId, 0, 'nav');
    },
    [handleActivePageChange]
  );

  const handleSelectPage = useCallback(
    (pageIndex: number) => {
      if (!project?.comic) return;
      handleActivePageChange(project.comic.activeChapterId, pageIndex, 'nav');
    },
    [project?.comic, handleActivePageChange]
  );

  const handleViewModeChange = useCallback(
    (viewMode: ComicViewMode) => {
      setProject((prev) => {
        if (!prev?.comic) return prev;
        return { ...prev, comic: { ...prev.comic, viewMode } };
      });
      if (project?.comic) {
        emitScrollTarget({
          chapterId: project.comic.activeChapterId,
          pageIndex: project.comic.activePageIndex,
          scrollFraction: 0,
          behavior: 'auto',
        });
      }
    },
    [setProject, project?.comic, emitScrollTarget]
  );

  const handleZoomChange = useCallback(
    (zoom: number) => {
      setProject((prev) => {
        if (!prev?.comic) return prev;
        return { ...prev, comic: { ...prev.comic, zoom } };
      });
    },
    [setProject]
  );

  const handleToggleTimelineSync = useCallback(() => {
    setProject((prev) => {
      if (!prev?.comic) return prev;
      return {
        ...prev,
        comic: {
          ...prev.comic,
          syncTimelineWithComic: !prev.comic.syncTimelineWithComic,
        },
      };
    });
  }, [setProject]);

  const handleAddBubblePin = useCallback(
    (draft: {
      chapterId: string;
      pageIndex: number;
      x: number;
      y: number;
      role: string;
      text: string;
      timelineTime: number;
    }) => {
      if (saveSnapshot) saveSnapshot();
      const boundTrackId = activeTrackIdRef.current || undefined;

      setProject((prev) => {
        if (!prev?.comic) return prev;
        const pinId = `pin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const subtitleId = `sub-comic-${pinId}`;
        const existingPins = prev.comic.pins || [];
        const nextOrder = existingPins.length + 1;

        const start = Math.max(0, Math.round(draft.timelineTime * 100) / 100);
        const estDuration = Math.max(2.5, Math.min(12, Math.round((draft.text.length / 14) * 10) / 10));
        const end = Math.round((start + estDuration) * 100) / 100;

        const newPin: ComicBubblePin = {
          id: pinId,
          chapterId: draft.chapterId,
          pageIndex: draft.pageIndex,
          x: draft.x,
          y: draft.y,
          subtitleId,
          role: draft.role,
          label: draft.text,
          timelineTime: start,
          order: nextOrder,
          trackId: boundTrackId,
        };

        const newSubtitle: SubtitleLine = {
          id: subtitleId,
          start,
          end,
          text: draft.text,
          role: draft.role,
          comicPinId: pinId,
          comicChapterId: draft.chapterId,
          comicPageIndex: draft.pageIndex,
          comicTrackId: boundTrackId,
        };

        const nextRoles = prev.roles.includes(draft.role)
          ? prev.roles
          : [...prev.roles, draft.role];

        const nextSubtitles = [...(prev.subtitles || []), newSubtitle].sort(
          (a, b) => a.start - b.start
        );

        return {
          ...prev,
          roles: nextRoles,
          selectedRole: prev.selectedRole || draft.role,
          subtitles: nextSubtitles,
          comic: {
            ...prev.comic,
            pins: [...existingPins, newPin],
          },
        };
      });
    },
    [saveSnapshot, setProject]
  );

  const handleDeleteBubblePin = useCallback(
    (pinId: string) => {
      if (saveSnapshot) saveSnapshot();
      setProject((prev) => {
        if (!prev?.comic) return prev;
        const targetPin = (prev.comic.pins || []).find((p) => p.id === pinId);
        const remainingPins = (prev.comic.pins || [])
          .filter((p) => p.id !== pinId)
          .map((p, idx) => ({ ...p, order: idx + 1 }));

        const remainingSubs = targetPin
          ? (prev.subtitles || []).filter((s) => s.id !== targetPin.subtitleId && s.comicPinId !== pinId)
          : prev.subtitles;

        return {
          ...prev,
          subtitles: remainingSubs,
          comic: {
            ...prev.comic,
            pins: remainingPins,
          },
        };
      });
    },
    [saveSnapshot, setProject]
  );

  const handleSelectPin = useCallback(
    (pin: ComicBubblePin) => {
      onSeek(pin.timelineTime);
      emitScrollTarget({
        chapterId: pin.chapterId,
        pageIndex: pin.pageIndex,
        scrollFraction: pin.y / 100,
        isPinTarget: true,
        pinId: pin.id,
        behavior: 'smooth',
      });
    },
    [onSeek, emitScrollTarget]
  );

  /**
   * Reset timeline recordings, markers, comic sync points, and comic bubble pins while
   * keeping the loaded comic and all its chapters intact in the project.
   */
  const handleClearComicTimeline = useCallback(() => {
    if (isRecording) return;
    if (isPlaying && onStopPlayback) {
      onStopPlayback();
    }
    if (saveSnapshot) {
      saveSnapshot();
    }

    setProject((prev) => {
      if (!prev) return prev;
      const hasOriginalVideo = !!(prev.videoPath || prev.videoUrl);
      const clearedTracks = (prev.tracks || []).map((track) => {
        if (hasOriginalVideo && track.name === 'Оригинал') {
          return track;
        }
        return { ...track, segments: [] };
      });

      const remainingSubtitles = (prev.subtitles || []).filter(
        (s) => !s.comicPinId && !s.comicChapterId
      );

      return {
        ...prev,
        tracks: clearedTracks,
        markers: [],
        subtitles: remainingSubtitles,
        comic: prev.comic
          ? {
              ...prev.comic,
              pins: [],
              syncPoints: [],
            }
          : prev.comic,
      };
    });

    if (onClearSelection) {
      onClearSelection();
    }
    lastTimelineSyncedKeyRef.current = '';
    lastAutoMarkerRef.current = { key: '', timestamp: 0 };
    lastScrollSyncRef.current = {
      trackId: '',
      chapterId: '',
      pageIndex: -1,
      fraction: -1,
      timestamp: 0,
    };
    onSeek(0);
  }, [isRecording, isPlaying, onStopPlayback, saveSnapshot, setProject, onClearSelection, onSeek]);

  const handlePdfPageCountResolved = useCallback(
    (numPages: number) => {
      if (numPages <= 0) return;
      setProject((prev) => {
        if (!prev?.comic || prev.comic.sourceType !== 'pdf') return prev;
        const firstChapter = prev.comic.chapters[0];
        if (!firstChapter || firstChapter.pages.length === numPages) return prev;
        const updatedPages = Array.from({ length: numPages }, (_, i) => ({
          id: `${firstChapter.id}-p-${i + 1}`,
          index: i,
          pdfPageNumber: i + 1,
        }));
        const updatedChapters = prev.comic.chapters.map((ch, idx) =>
          idx === 0 ? { ...ch, pages: updatedPages } : ch
        );
        return {
          ...prev,
          comic: {
            ...prev.comic,
            chapters: updatedChapters,
          },
        };
      });
    },
    [setProject]
  );

  // Drop an initial page marker immediately when recording starts, capturing exact vertical scroll offset
  const wasRecordingRef = useRef(false);
  useEffect(() => {
    if (isRecording && !wasRecordingRef.current && project?.comic) {
      recordAutoPageMarker(
        project.comic.activeChapterId,
        project.comic.activePageIndex,
        currentScrollFractionRef.current
      );
    }
    wasRecordingRef.current = isRecording;
  }, [isRecording, project?.comic?.activeChapterId, project?.comic?.activePageIndex, recordAutoPageMarker]);

  // Bidirectional sync: scoped STRICTLY to the currently active/armed track so recording
  // multiple characters on different tracks never cross-jumps to another track's comic links
  useEffect(() => {
    if (isRecording || !project?.comic?.syncTimelineWithComic) return;

    const comic = project.comic;
    const preroll = Math.max(0, project.audioSettings?.prerollSeconds ?? 3);

    const trackSubtitles = (project.subtitles || []).filter(
      (s) =>
        s.comicChapterId !== undefined &&
        s.comicPageIndex !== undefined &&
        matchesActiveTrack(s.comicTrackId)
    );
    const trackPins = (comic.pins || []).filter((p) => matchesActiveTrack(p.trackId));
    const trackSyncPoints = (comic.syncPoints || []).filter((sp) => matchesActiveTrack(sp.trackId));

    let targetChapterId: string | null = null;
    let targetPageIndex: number | null = null;
    let targetScrollFraction = 0;
    let targetIsPin = false;
    let targetPinId: string | undefined = undefined;

    // 1. Check exact match with a comic-linked subtitle/bubble pin on the active track
    let matchedSub = trackSubtitles.find(
      (s) => currentTime >= s.start - 0.15 && currentTime <= s.end + 0.15
    );

    // 1b. Pre-roll lookahead when user clicks a line in the Left Sidebar
    if (!matchedSub && preroll > 0) {
      const lookahead = preroll + 0.35;
      const upcoming = trackSubtitles
        .filter((s) => s.start >= currentTime && s.start - currentTime <= lookahead)
        .sort((a, b) => a.start - b.start)[0];
      if (upcoming) {
        matchedSub = upcoming;
      }
    }

    if (matchedSub && matchedSub.comicChapterId && matchedSub.comicPageIndex !== undefined) {
      targetChapterId = matchedSub.comicChapterId;
      targetPageIndex = matchedSub.comicPageIndex;

      const linkedPin = trackPins.find(
        (p) =>
          (matchedSub!.comicPinId && p.id === matchedSub!.comicPinId) ||
          p.subtitleId === matchedSub!.id
      );

      if (linkedPin) {
        targetScrollFraction = clampFraction(linkedPin.y / 100);
        targetIsPin = true;
        targetPinId = linkedPin.id;
      } else {
        for (let i = 0; i < trackSyncPoints.length; i++) {
          if (trackSyncPoints[i].time <= matchedSub.start + 0.25) {
            if (
              trackSyncPoints[i].chapterId === targetChapterId &&
              trackSyncPoints[i].pageIndex === targetPageIndex &&
              trackSyncPoints[i].scrollFraction !== undefined
            ) {
              targetScrollFraction = clampFraction(trackSyncPoints[i].scrollFraction!);
            }
          } else {
            break;
          }
        }
      }
    } else {
      // 2. Fall back to latest recorded page/scroll syncPoint on the ACTIVE track
      let matchedSp: ComicSyncPoint | null = null;
      for (let i = 0; i < trackSyncPoints.length; i++) {
        if (trackSyncPoints[i].time <= currentTime + 0.05) {
          matchedSp = trackSyncPoints[i];
        } else {
          break;
        }
      }

      if (!matchedSp && preroll > 0) {
        const upcomingSp = trackSyncPoints.find(
          (sp) => sp.time >= currentTime && sp.time - currentTime <= preroll + 0.35
        );
        if (upcomingSp) {
          matchedSp = upcomingSp;
        }
      }

      if (matchedSp) {
        targetChapterId = matchedSp.chapterId;
        targetPageIndex = matchedSp.pageIndex;
        targetScrollFraction = clampFraction(matchedSp.scrollFraction ?? 0);
      }
    }

    if (!targetChapterId || targetPageIndex === null) return;

    const fractionBucket = Math.round(targetScrollFraction * 200);
    const key = `${activeTrackId}:${targetChapterId}:${targetPageIndex}:${fractionBucket}:${targetPinId || ''}`;
    const chapterOrPageChanged =
      comic.activeChapterId !== targetChapterId || comic.activePageIndex !== targetPageIndex;

    if (key !== lastTimelineSyncedKeyRef.current) {
      lastTimelineSyncedKeyRef.current = key;
      const nextCh = targetChapterId;
      const nextPg = targetPageIndex;

      if (chapterOrPageChanged) {
        setProject((prev) => {
          if (!prev?.comic) return prev;
          return {
            ...prev,
            comic: {
              ...prev.comic,
              activeChapterId: nextCh,
              activePageIndex: nextPg,
            },
          };
        });
      }

      emitScrollTarget({
        chapterId: nextCh,
        pageIndex: nextPg,
        scrollFraction: targetScrollFraction,
        isPinTarget: targetIsPin,
        pinId: targetPinId,
        behavior: chapterOrPageChanged ? 'auto' : 'smooth',
      });
    }
  }, [
    currentTime,
    isRecording,
    activeTrackId,
    matchesActiveTrack,
    project?.audioSettings?.prerollSeconds,
    project?.comic?.syncTimelineWithComic,
    project?.comic?.syncPoints,
    project?.comic?.pins,
    project?.comic?.activeChapterId,
    project?.comic?.activePageIndex,
    project?.subtitles,
    setProject,
    emitScrollTarget,
  ]);

  return {
    stageView,
    setStageView,
    rightNavWidth,
    setRightNavWidth,
    isRightNavCollapsed,
    setIsRightNavCollapsed,
    scrollTarget,
    activeTrackId,
    activeTrackName,
    isFirstDubTrack,
    handleComicImported,
    handleSelectChapter,
    handleSelectPage,
    handleActivePageChange,
    handleViewportScrollPosition,
    handleViewModeChange,
    handleZoomChange,
    handleToggleTimelineSync,
    handleAddBubblePin,
    handleDeleteBubblePin,
    handleSelectPin,
    handleClearComicTimeline,
    handlePdfPageCountResolved,
  };
}
