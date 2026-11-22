import { Project, SubtitleLine } from '../types';

/**
 * Resolves the active roles list from a project (preferring multi-role `selectedRoles`,
 * falling back to legacy single `selectedRole`).
 */
export function getActiveRoles(
  project: Pick<Project, 'selectedRoles' | 'selectedRole'> | null | undefined
): string[] {
  if (!project) return [];
  if (project.selectedRoles && project.selectedRoles.length > 0) {
    return project.selectedRoles;
  }
  return project.selectedRole ? [project.selectedRole] : [];
}

/**
 * Returns subtitles matching `activeRoles` (or all subtitles if `activeRoles` is empty
 * or matches nothing), sorted chronologically with stable tie-breaking so multi-role
 * and overlapping scripts behave identically to single-role scripts.
 */
export function getSortedActiveSubtitles(
  subtitles: SubtitleLine[] | undefined | null,
  activeRoles: string[]
): SubtitleLine[] {
  const all = subtitles || [];
  if (all.length === 0) return [];

  const filtered =
    activeRoles.length > 0
      ? all.filter((s) => activeRoles.includes(s.role))
      : all;
  const base = filtered.length > 0 ? filtered : all;

  // Decorate with original index for deterministic stable sorting on identical timestamps
  return base
    .map((line, originalIndex) => ({ line, originalIndex }))
    .sort(
      (a, b) =>
        a.line.start - b.line.start ||
        a.line.end - b.line.end ||
        a.originalIndex - b.originalIndex
    )
    .map((entry) => entry.line);
}

export interface SubtitleNavParams {
  subtitles: SubtitleLine[];
  activeRoles: string[];
  currentTime: number;
  subtitlesOffset?: number;
  lastTargetId?: string | null;
  lastTargetSeekTime?: number | null;
  /**
   * When jumping backwards from the middle of a line (free playhead without consecutive nav),
   * if `currentTime` is more than this many seconds past the line start, restart the current line first.
   */
  snapToCurrentStartThreshold?: number;
}

/**
 * Finds the next active-role subtitle line in chronological order.
 * Supports consecutive step-by-step navigation even when lines overlap, share identical timestamps,
 * or are spaced closer than the configured preroll.
 */
export function findNextSubtitleTarget(params: SubtitleNavParams): SubtitleLine | null {
  const {
    subtitles,
    activeRoles,
    currentTime,
    subtitlesOffset = 0,
    lastTargetId,
    lastTargetSeekTime,
  } = params;

  const ordered = getSortedActiveSubtitles(subtitles, activeRoles);
  if (ordered.length === 0) return null;

  // 1. Consecutive navigation from a known target line (prevents preroll / tight-spacing skips)
  if (
    lastTargetId &&
    typeof lastTargetSeekTime === 'number' &&
    Math.abs(currentTime - lastTargetSeekTime) <= 0.35
  ) {
    const lastIdx = ordered.findIndex((s) => s.id === lastTargetId);
    if (lastIdx !== -1) {
      return lastIdx + 1 < ordered.length ? ordered[lastIdx + 1] : null;
    }
  }

  // 2. Free playhead navigation
  const effectiveTime = currentTime - subtitlesOffset;

  // If currently inside one or more active-role lines, advance past the earliest active line
  // (or if multiple share the same start, advance past the first active index)
  const activeIdx = ordered.findIndex(
    (s) => effectiveTime >= s.start - 0.05 && effectiveTime <= s.end
  );
  if (activeIdx !== -1) {
    return activeIdx + 1 < ordered.length ? ordered[activeIdx + 1] : null;
  }

  // Otherwise pick the first line strictly ahead of the playhead
  const nextLine = ordered.find((s) => s.start > effectiveTime + 0.05);
  return nextLine ?? null;
}

/**
 * Finds the previous active-role subtitle line in chronological order.
 * Supports consecutive step-by-step navigation even when lines overlap or preroll shifts playhead back.
 */
export function findPrevSubtitleTarget(params: SubtitleNavParams): SubtitleLine | null {
  const {
    subtitles,
    activeRoles,
    currentTime,
    subtitlesOffset = 0,
    lastTargetId,
    lastTargetSeekTime,
    snapToCurrentStartThreshold = 0,
  } = params;

  const ordered = getSortedActiveSubtitles(subtitles, activeRoles);
  if (ordered.length === 0) return null;

  // 1. Consecutive navigation from a known target line
  if (
    lastTargetId &&
    typeof lastTargetSeekTime === 'number' &&
    Math.abs(currentTime - lastTargetSeekTime) <= 0.35
  ) {
    const lastIdx = ordered.findIndex((s) => s.id === lastTargetId);
    if (lastIdx !== -1) {
      return lastIdx > 0 ? ordered[lastIdx - 1] : null;
    }
  }

  // 2. Free playhead navigation
  const effectiveTime = currentTime - subtitlesOffset;

  if (snapToCurrentStartThreshold > 0) {
    // Check if we are in the middle of an active line; if so, restart it first
    for (let i = ordered.length - 1; i >= 0; i--) {
      const s = ordered[i];
      if (effectiveTime >= s.start && effectiveTime <= s.end) {
        if (effectiveTime > s.start + snapToCurrentStartThreshold) {
          return s;
        }
        return i > 0 ? ordered[i - 1] : null;
      }
    }
  }

  // Find the latest line that started strictly before effectiveTime
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (ordered[i].start < effectiveTime - 0.08) {
      return ordered[i];
    }
  }

  return null;
}
