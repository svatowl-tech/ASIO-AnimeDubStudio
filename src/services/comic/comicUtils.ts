import { getSafeFileUrl } from '../../lib/utils';
import { ComicPage } from '../../types/comic';

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function compareNatural(a: string, b: string): number {
  return naturalCollator.compare(a, b);
}

export function sanitizeSlug(raw: string, fallback = 'comic'): string {
  const cleaned = raw
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

export function isImageFile(name: string): boolean {
  return /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(name);
}

/**
 * Resolve a comic asset path (relative ./comics/..., absolute OS path, or blob:/data:/https: URL)
 * to a renderable browser/Tauri asset src URL.
 */
export function resolveComicAssetUrl(rawPath?: string | null, projectPath?: string | null): string | undefined {
  if (!rawPath) return undefined;
  if (
    rawPath.startsWith('blob:') ||
    rawPath.startsWith('data:') ||
    rawPath.startsWith('https://') ||
    rawPath.startsWith('http://') ||
    rawPath.startsWith('asset://')
  ) {
    return rawPath;
  }

  let absolutePath = rawPath;
  if (rawPath.startsWith('./') && projectPath) {
    const cleanProj = projectPath.replace(/[\\/]+$/, '');
    const rel = rawPath.slice(2).replace(/^\/+/, '');
    absolutePath = `${cleanProj}/${rel}`;
  }

  return getSafeFileUrl(absolutePath);
}

/**
 * Safely convert HTML or ProseMirror JSON from RanobeLib / EPUB into clean plain-text paragraphs
 * without ever using innerHTML / dangerouslySetInnerHTML in React rendering.
 */
export function extractPlainParagraphsFromContent(content: unknown): string[] {
  if (!content) return [];

  if (typeof content === 'string') {
    const normalized = content
      .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '');

    const decoded = normalized
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&laquo;/g, '«')
      .replace(/&raquo;/g, '»')
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–')
      .replace(/&hellip;/g, '...')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');

    return decoded
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  const out: string[] = [];
  const collectInline = (node: any): string => {
    if (!node || typeof node !== 'object') return '';
    if (typeof node.text === 'string') return node.text;
    if (node.type === 'hardBreak') return '\n';
    if (Array.isArray(node.content)) {
      return node.content.map(collectInline).join('');
    }
    return '';
  };

  const walk = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object') {
      if (['paragraph', 'heading', 'blockquote', 'listItem'].includes(node.type)) {
        const text = collectInline(node).replace(/\s+/g, ' ').trim();
        if (text) out.push(text);
        return;
      }
      if (Array.isArray(node.content)) {
        node.content.forEach(walk);
      }
    }
  };

  walk(content);
  return out;
}

export function chunkParagraphsToPages(paragraphs: string[], chapterId: string): ComicPage[] {
  const pages: ComicPage[] = [];
  let bucket: string[] = [];
  let charCount = 0;

  for (const para of paragraphs) {
    if (bucket.length > 0 && charCount + para.length > 1400) {
      const idx = pages.length;
      pages.push({
        id: `${chapterId}-p-${idx + 1}`,
        index: idx,
        textBlocks: bucket,
      });
      bucket = [];
      charCount = 0;
    }
    bucket.push(para);
    charCount += para.length;
  }

  if (bucket.length > 0 || pages.length === 0) {
    const idx = pages.length;
    pages.push({
      id: `${chapterId}-p-${idx + 1}`,
      index: idx,
      textBlocks: bucket.length > 0 ? bucket : ['(Пустая текстовая глава)'],
    });
  }

  return pages;
}

export function parseNumericChapterValue(raw: string): number {
  const cleaned = String(raw || '').trim().replace(',', '.');
  const m = cleaned.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : Number.NaN;
}
