import { useCallback, useEffect, useRef, useState, Dispatch, SetStateAction, MutableRefObject } from 'react';
import {
  ComicBubblePin,
  ComicProjectData,
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
  duration: number;
  setDuration: (d: number) => void;
  onSeek: (time: number) => void;
  saveSnapshot?: () => void;
}

export function useComicSync({
  project,
  setProject,
  currentTime,
  currentTimeRef,
  isRecording,
  duration,
  setDuration,
  onSeek,
  saveSnapshot,
}: UseComicSyncParams) {
  const [stageView, setStageView] = useState<'comic' | 'video'>('comic');
  const [rightNavWidth, setRightNavWidth] = useState<number>(216);
  const [isRightNavCollapsed, setIsRightNavCollapsed] = useState<boolean>(false);
  const [scrollRequestToken, setScrollRequestToken] = useState<number>(0);

  const lastAutoMarkerRef = useRef<{ key: string; timestamp: number }>({ key: '', timestamp: 0 });
  const lastTimelineSyncedKeyRef = useRef<string>('');

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
          projectPath: prev.projectPath && prev.projectPath !== '/mock/path' ? prev.projectPath : resolvedProjectPath || prev.projectPath,
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
      setScrollRequestToken((t) => t + 1);
    },
    [saveSnapshot, setProject, duration, setDuration]
  );

  const recordAutoPageMarker = useCallback(
    (chapterId: string, pageIndex: number) => {
      const now = Date.now();
      const key = `${chapterId}:${pageIndex}`;
      if (lastAutoMarkerRef.current.key === key && now - lastAutoMarkerRef.current.timestamp < 600) {
        return;
      }
      lastAutoMarkerRef.current = { key, timestamp: now };

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
        };
        const newSync: ComicSyncPoint = {
          id: syncId,
          time,
          chapterId,
          pageIndex,
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

  const handleActivePageChange = useCallback(
    (chapterId: string, pageIndex: number, source: 'scroll' | 'nav') => {
      if (isRecording) {
        recordAutoPageMarker(chapterId, pageIndex);
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
        setScrollRequestToken((t) => t + 1);
      }
    },
    [isRecording, recordAutoPageMarker, setProject]
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
    },
    [setProject]
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
    },
    [onSeek]
  );

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

  // Drop an initial page marker immediately when recording starts on a comic page
  const wasRecordingRef = useRef(false);
  useEffect(() => {
    if (isRecording && !wasRecordingRef.current && project?.comic) {
      recordAutoPageMarker(project.comic.activeChapterId, project.comic.activePageIndex);
    }
    wasRecordingRef.current = isRecording;
  }, [isRecording, project?.comic?.activeChapterId, project?.comic?.activePageIndex, recordAutoPageMarker]);

  // Bidirectional sync: scrubbing/playing timeline moves comic reader to matching synced page or bubble pin
  useEffect(() => {
    if (isRecording || !project?.comic?.syncTimelineWithComic) return;

    let targetChapterId: string | null = null;
    let targetPageIndex: number | null = null;

    // 1. Check exact match with a comic-linked subtitle/pin first
    const matchedSub = (project.subtitles || []).find(
      (s) =>
        s.comicChapterId !== undefined &&
        s.comicPageIndex !== undefined &&
        currentTime >= s.start - 0.15 &&
        currentTime <= s.end + 0.15
    );
    if (matchedSub && matchedSub.comicChapterId && matchedSub.comicPageIndex !== undefined) {
      targetChapterId = matchedSub.comicChapterId;
      targetPageIndex = matchedSub.comicPageIndex;
    } else {
      // 2. Fall back to latest recorded page syncPoint at or before currentTime
      const syncPoints = project.comic.syncPoints || [];
      for (let i = 0; i < syncPoints.length; i++) {
        if (syncPoints[i].time <= currentTime + 0.05) {
          targetChapterId = syncPoints[i].chapterId;
          targetPageIndex = syncPoints[i].pageIndex;
        } else {
          break;
        }
      }
    }

    if (!targetChapterId || targetPageIndex === null) return;
    const key = `${targetChapterId}:${targetPageIndex}`;
    if (
      key !== lastTimelineSyncedKeyRef.current &&
      (project.comic.activeChapterId !== targetChapterId ||
        project.comic.activePageIndex !== targetPageIndex)
    ) {
      lastTimelineSyncedKeyRef.current = key;
      const nextCh = targetChapterId;
      const nextPg = targetPageIndex;
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
      setScrollRequestToken((t) => t + 1);
    }
  }, [
    currentTime,
    isRecording,
    project?.comic?.syncTimelineWithComic,
    project?.comic?.syncPoints,
    project?.subtitles,
    setProject,
  ]);

  return {
    stageView,
    setStageView,
    rightNavWidth,
    setRightNavWidth,
    isRightNavCollapsed,
    setIsRightNavCollapsed,
    scrollRequestToken,
    handleComicImported,
    handleSelectChapter,
    handleSelectPage,
    handleActivePageChange,
    handleViewModeChange,
    handleZoomChange,
    handleToggleTimelineSync,
    handleAddBubblePin,
    handleDeleteBubblePin,
    handleSelectPin,
    handlePdfPageCountResolved,
  };
}
