import { Project, SubtitleLine, AudioSegment, AudioTrack } from '../types';

export interface SubtitleCoverageStats {
  totalTargetLines: number;
  recordedLinesCount: number;
  unrecordedLinesCount: number;
  recordedLineIds: Set<string>;
  unrecordedLineIds: Set<string>;
  unrecordedLines: SubtitleLine[];
  targetSubtitles: SubtitleLine[];
  activeRoles: string[];
}

/**
 * Identifies whether a track is an original or reference track (should not count as recorded dubbing lines).
 */
export function isOriginalTrack(track: AudioTrack | undefined | null): boolean {
  if (!track) return false;
  const idLower = (track.id || '').toLowerCase().trim();
  const nameLower = (track.name || '').toLowerCase().trim();

  return (
    idLower === 'original' ||
    idLower === 'originals-track' ||
    idLower === 'original-audio-track' ||
    idLower === 'track-original' ||
    idLower === 'reference-track' ||
    idLower.startsWith('original-track-') ||
    idLower.includes('original') ||
    idLower.includes('reference') ||
    nameLower.includes('оригинал') ||
    nameLower.includes('original') ||
    nameLower.includes('референс') ||
    nameLower.includes('reference')
  );
}

/**
 * Identifies whether a segment is part of the original media rather than a recorded dub.
 */
export function isOriginalSegment(segment: AudioSegment | undefined | null): boolean {
  if (!segment) return false;
  const idLower = (segment.id || '').toLowerCase().trim();
  const origNameLower = (segment.originalFileName || '').toLowerCase().trim();

  return (
    idLower === 'original-audio-seg' ||
    idLower.startsWith('original-') ||
    idLower.includes('original') ||
    idLower.includes('reference') ||
    origNameLower.startsWith('original_audio')
  );
}

/**
 * Checks if a specific subtitle line is covered by any recorded audio segment on the timeline.
 */
export function isSubtitleRecorded(
  line: SubtitleLine,
  segments: AudioSegment[],
  subtitlesOffset: number = 0
): boolean {
  if (!segments || segments.length === 0) return false;

  const lineStart = line.start + subtitlesOffset;
  const lineEnd = line.end + subtitlesOffset;
  const lineDuration = Math.max(0.1, lineEnd - lineStart);
  const lineMid = lineStart + lineDuration / 2;

  for (const seg of segments) {
    if (isOriginalSegment(seg)) continue;

    const segStart = seg.startTime;
    const segEnd = seg.startTime + seg.duration;

    // Calculate time overlap between segment and subtitle line
    const overlapStart = Math.max(lineStart, segStart);
    const overlapEnd = Math.min(lineEnd, segEnd);
    const overlapDuration = Math.max(0, overlapEnd - overlapStart);

    // Criteria for line being recorded:
    // 1) Overlap is at least 0.2 seconds
    // 2) Overlap covers at least 30% of the line duration
    // 3) Segment covers the midpoint of the line
    if (
      overlapDuration >= 0.2 ||
      overlapDuration / lineDuration >= 0.3 ||
      (segStart <= lineMid && segEnd >= lineMid)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Returns comprehensive coverage statistics for the user's selected roles in a project.
 */
export function getSubtitleCoverageStats(project: Project | null): SubtitleCoverageStats {
  if (!project || !project.subtitles || project.subtitles.length === 0) {
    return {
      totalTargetLines: 0,
      recordedLinesCount: 0,
      unrecordedLinesCount: 0,
      recordedLineIds: new Set(),
      unrecordedLineIds: new Set(),
      unrecordedLines: [],
      targetSubtitles: [],
      activeRoles: [],
    };
  }

  // Determine active roles being recorded
  const activeRoles =
    project.selectedRoles && project.selectedRoles.length > 0
      ? project.selectedRoles
      : project.selectedRole
      ? [project.selectedRole]
      : [];

  // Filter subtitle lines for the active roles
  const targetSubtitles =
    activeRoles.length > 0
      ? project.subtitles.filter((sub) => activeRoles.includes(sub.role))
      : project.subtitles;

  // Filter out all original and reference audio tracks
  const dubTracks = (project.tracks || []).filter((t) => !isOriginalTrack(t));
  const armedDubTracks = dubTracks.filter((t) => t.isArmed);
  const targetTracks = armedDubTracks.length > 0 ? armedDubTracks : dubTracks;

  // Gather audio segments from target tracks, strictly ignoring original segments
  const allSegments: AudioSegment[] = targetTracks.flatMap((t) =>
    (t.segments || []).filter((s) => !isOriginalSegment(s))
  );
  const subtitlesOffset = project.subtitlesOffset || 0;

  const recordedLineIds = new Set<string>();
  const unrecordedLineIds = new Set<string>();
  const unrecordedLines: SubtitleLine[] = [];

  for (const line of targetSubtitles) {
    if (isSubtitleRecorded(line, allSegments, subtitlesOffset)) {
      recordedLineIds.add(line.id);
    } else {
      unrecordedLineIds.add(line.id);
      unrecordedLines.push(line);
    }
  }

  return {
    totalTargetLines: targetSubtitles.length,
    recordedLinesCount: recordedLineIds.size,
    unrecordedLinesCount: unrecordedLineIds.size,
    recordedLineIds,
    unrecordedLineIds,
    unrecordedLines,
    targetSubtitles,
    activeRoles,
  };
}

/**
 * Finds the next unrecorded subtitle line starting after currentTime (or loops from start if none ahead).
 */
export function getNextUnrecordedSubtitle(
  project: Project | null,
  currentTime: number,
  unrecordedLineIds: Set<string>
): SubtitleLine | null {
  if (!project || !project.subtitles || unrecordedLineIds.size === 0) {
    return null;
  }

  const offset = project.subtitlesOffset || 0;
  const unrecordedList = project.subtitles.filter((s) => unrecordedLineIds.has(s.id));

  // Find next unrecorded line after currentTime + 0.1s
  const next = unrecordedList.find((s) => s.start + offset > currentTime + 0.1);
  if (next) return next;

  // Wrap around to first unrecorded line
  return unrecordedList[0] || null;
}
