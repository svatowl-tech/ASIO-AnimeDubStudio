/**
 * Utility for sanitizing filenames and building beautiful, clean export filenames.
 */

/**
 * Sanitizes a single filename segment by removing OS-forbidden characters and special symbols.
 */
export function sanitizeFilenameSegment(segment: string): string {
  if (!segment) return '';

  return segment
    // Remove control characters (0x00 - 0x1F)
    .replace(/[\x00-\x1F\x7F]/g, '')
    // Replace OS forbidden characters \ / : * ? " < > | with underscore
    .replace(/[\\/:*?"<>|]/g, '_')
    // Replace brackets, parentheses, quotes, colons in roles like "John [Boss] / Lead" -> "John_Boss_Lead"
    .replace(/[\[\]\(\)\{\}'"`]/g, '')
    // Replace dots, commas, semicolons with underscore if surrounded by non-digits
    .replace(/(?<!\d)[.,;]+(?!\d)/g, '_')
    // Replace multiple spaces or underscores with a single underscore
    .replace(/[\s_\-]+/g, '_')
    // Trim leading and trailing underscores and whitespace
    .replace(/^_+|_+$/g, '')
    .trim();
}

/**
 * Removes duplicated or repetitive words/phrases in filename tokens.
 * Example: ["Svat", "Svat", "Hero", "Episode_1", "final", "final"] -> "Svat_Hero_Episode_1_final"
 */
export function deduplicateFilenameTokens(tokens: string[]): string[] {
  const result: string[] = [];
  const seenLower = new Set<string>();

  for (const token of tokens) {
    if (!token) continue;
    const cleanToken = sanitizeFilenameSegment(token);
    if (!cleanToken) continue;

    // Split token into sub-parts by underscore to catch nested duplicates
    const parts = cleanToken.split('_');
    for (const part of parts) {
      if (!part) continue;
      const lower = part.toLowerCase();
      
      // If it's an adjacent duplicate like "final_final" or "svat_svat", skip
      const lastPart = result.length > 0 ? result[result.length - 1].toLowerCase() : '';
      if (lastPart === lower) {
        continue;
      }
      
      seenLower.add(lower);
      result.push(part);
    }
  }

  return result;
}

export interface BuildExportFilenameOptions {
  dubberNick?: string;
  activeRoles?: string[];
  projectName?: string;
  videoName?: string;
  prefix?: string;
  suffix?: string;
  extension: string;
}

/**
 * Builds a clean, sanitized export filename from project metadata.
 * Example: buildCleanExportFilename({ dubberNick: "Volodarsky", activeRoles: ["Joker"], videoName: "Batman_Ep1.mp4", extension: "wav" })
 * Output: "Volodarsky_Joker_Batman_Ep1.wav"
 */
export function buildCleanExportFilename(options: BuildExportFilenameOptions): string {
  const {
    dubberNick = '',
    activeRoles = [],
    projectName = '',
    videoName = '',
    prefix = '',
    suffix = '',
    extension = 'wav'
  } = options;

  // Extract base video/project name without extension
  let baseMedia = videoName || projectName || 'project';
  const lastDot = baseMedia.lastIndexOf('.');
  if (lastDot > 0) {
    baseMedia = baseMedia.substring(0, lastDot);
  }

  const roleLabel = activeRoles.filter(Boolean).join('_');

  const rawTokens = [
    prefix,
    dubberNick,
    roleLabel,
    baseMedia,
    suffix
  ].filter(Boolean);

  const cleanTokens = deduplicateFilenameTokens(rawTokens);

  let finalBaseName = cleanTokens.length > 0 ? cleanTokens.join('_') : 'dubstudio_export';
  
  // Guarantee finalBaseName has no lingering illegal characters
  finalBaseName = sanitizeFilenameSegment(finalBaseName) || 'dubstudio_export';

  const cleanExt = extension.toLowerCase().replace(/^\.+/, '');
  return `${finalBaseName}.${cleanExt}`;
}
