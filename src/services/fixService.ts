import { Fix, SubtitleLine } from '../types';

export class FixService {
  /**
   * Parses raw text feedback into structured Fix objects.
   * Expected format:
   * @ActorName
   * [MM:SS] comment
   * or
   * Name:
   * [MM:SS] comment
   */
  static parseRawFixes(text: string, subtitles: SubtitleLine[]): Fix[] {
    const fixes: Fix[] = [];
    const lines = text.split('\n');
    let currentActor = 'Unknown';

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // Check for Actor Name pattern
      const actorMatch = trimmedLine.match(/^@?([\w\d]+)(?:\s*\(.*\))?:?$/i);
      if (actorMatch) {
        currentActor = actorMatch[1];
        continue;
      }

      // Check for Timestamp + Comment pattern
      // Matches [MM:SS] or MM:SS
      const fixMatch = trimmedLine.match(/(?:\[?(\d{1,2}):(\d{2})\]?)\s*(?:-|:)?\s*(.*)/);
      if (fixMatch) {
        const minutes = parseInt(fixMatch[1], 10);
        const seconds = parseInt(fixMatch[2], 10);
        const timestamp = minutes * 60 + seconds;
        const comment = fixMatch[3].trim();

        // Try to find matching segment
        const segment = subtitles.find(s => timestamp >= s.start && timestamp <= s.end);

        fixes.push({
          id: Math.random().toString(36).substr(2, 9),
          segmentId: segment?.id,
          timestamp,
          actor: currentActor,
          comment,
          isResolved: false
        });
      }
    }

    return fixes;
  }
}
