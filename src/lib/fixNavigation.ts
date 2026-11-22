import { Fix, SubtitleLine } from '../types';

const FIX_TIME_PRECISION = 1000;

const normalizeTimestamp = (time: number): number =>
  Math.round(Math.max(0, time) * FIX_TIME_PRECISION) / FIX_TIME_PRECISION;

/**
 * Returns sorted, deduplicated timeline timestamps for all unresolved fixes.
 *
 * Imported fixes are stored both in `project.fixes` (with the curator's raw
 * timestamp) and on matched subtitles (`sub.needsFix = true` at `sub.start`).
 * Because those two timestamps rarely match to the millisecond, merging both
 * arrays directly double-counts every linked fix. This helper resolves each
 * fix once via `fix.segmentId` and falls back to `sub.needsFix` only for
 * subtitles not already covered by `project.fixes`.
 */
export function getActiveFixTimestamps(
  subtitles: SubtitleLine[] | undefined,
  fixes: Fix[] | undefined,
  subtitlesOffset: number = 0
): number[] {
  const safeOffset = Number.isFinite(subtitlesOffset) ? subtitlesOffset : 0;
  const subtitleList = subtitles || [];
  const fixList = fixes || [];

  const subtitleById = new Map<string, SubtitleLine>();
  for (const sub of subtitleList) {
    subtitleById.set(sub.id, sub);
  }

  const coveredSubtitleIds = new Set<string>();
  const unlinkedFixTimestamps: number[] = [];
  const timestampSet = new Set<number>();

  for (const fix of fixList) {
    if (fix.segmentId) {
      coveredSubtitleIds.add(fix.segmentId);
    }

    if (fix.isResolved) {
      continue;
    }

    const linkedSub = fix.segmentId ? subtitleById.get(fix.segmentId) : undefined;
    if (linkedSub) {
      timestampSet.add(normalizeTimestamp(linkedSub.start + safeOffset));
    } else if (Number.isFinite(fix.timestamp)) {
      const normalized = normalizeTimestamp(fix.timestamp);
      unlinkedFixTimestamps.push(normalized);
      timestampSet.add(normalized);
    }
  }

  for (const sub of subtitleList) {
    if (!sub.needsFix) continue;
    if (coveredSubtitleIds.has(sub.id)) continue;

    const subStart = normalizeTimestamp(sub.start + safeOffset);
    const subEnd = normalizeTimestamp(sub.end + safeOffset);

    const coveredByUnlinkedFix = unlinkedFixTimestamps.some(
      t => t >= subStart - 0.5 && t <= subEnd + 0.5
    );
    if (coveredByUnlinkedFix) continue;

    timestampSet.add(subStart);
  }

  return Array.from(timestampSet).sort((a, b) => a - b);
}
