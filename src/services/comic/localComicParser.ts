import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import { ComicChapter, ComicImportResultPayload, ComicPage } from '../../types/comic';
import {
  chunkParagraphsToPages,
  compareNatural,
  extractPlainParagraphsFromContent,
  isImageFile,
  sanitizeSlug,
} from './comicUtils';

// Configure PDF.js worker once using Vite's bundled asset URL (cross-platform, offline-safe)
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
}

interface CachedPdfEntry {
  loadingTask: pdfjsLib.PDFDocumentLoadingTask;
  promise: Promise<pdfjsLib.PDFDocumentProxy>;
}

// Keep loaded PDF documents cached in memory by source key so page rendering & thumbnails are instant
const pdfDocumentCache = new Map<string, CachedPdfEntry>();

export function getPdfDocument(sourceUrl: string): Promise<pdfjsLib.PDFDocumentProxy> {
  const existing = pdfDocumentCache.get(sourceUrl);
  if (existing) return existing.promise;

  const loadingTask = pdfjsLib.getDocument({
    url: sourceUrl,
    useSystemFonts: true,
  });

  const promise = loadingTask.promise.catch((err) => {
    pdfDocumentCache.delete(sourceUrl);
    throw err;
  });

  pdfDocumentCache.set(sourceUrl, { loadingTask, promise });
  return promise;
}

export function clearPdfDocumentCache(sourceUrl?: string): void {
  if (sourceUrl) {
    const entry = pdfDocumentCache.get(sourceUrl);
    pdfDocumentCache.delete(sourceUrl);
    entry?.loadingTask.destroy().catch(() => {});
    return;
  }
  for (const [, entry] of pdfDocumentCache.entries()) {
    entry.loadingTask.destroy().catch(() => {});
  }
  pdfDocumentCache.clear();
}

function resolveZipRelativePath(baseDir: string, href: string): string | null {
  const cleanHref = decodeURIComponent(href.split('#')[0].split('?')[0]);
  const combined = baseDir ? `${baseDir.replace(/\/+$/, '')}/${cleanHref}` : cleanHref;
  const parts: string[] = [];
  for (const seg of combined.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

function mimeFromFileName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return 'image/jpeg';
}

export async function parseLocalCbzInBrowser(file: File): Promise<ComicImportResultPayload> {
  const zip = await JSZip.loadAsync(file);
  const stem = file.name.replace(/\.[^.]+$/, '') || 'comic';
  const safeSlug = sanitizeSlug(stem, 'cbz_comic');

  const grouped = new Map<string, { path: string; entry: JSZip.JSZipObject }[]>();

  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    if (relativePath.includes('__MACOSX') || relativePath.startsWith('.')) return;
    if (relativePath.includes('..')) return;
    const parts = relativePath.split('/');
    const fileName = parts[parts.length - 1] || '';
    if (fileName.startsWith('.') || !isImageFile(fileName)) return;

    const dirKey = parts.slice(0, -1).join('/');
    if (!grouped.has(dirKey)) grouped.set(dirKey, []);
    grouped.get(dirKey)!.push({ path: relativePath, entry });
  });

  if (grouped.size === 0) {
    throw new Error('В CBZ-архиве не найдено изображений страниц.');
  }

  const sortedDirs = Array.from(grouped.keys()).sort(compareNatural);
  const chapters: ComicChapter[] = [];
  let coverPath: string | null = null;

  for (let chIdx = 0; chIdx < sortedDirs.length; chIdx++) {
    const dirKey = sortedDirs[chIdx];
    const items = grouped.get(dirKey)!.sort((a, b) => compareNatural(a.path, b.path));
    const chId = `cbz-${safeSlug}-ch-${chIdx + 1}`;
    const pages: ComicPage[] = [];

    for (let pIdx = 0; pIdx < items.length; pIdx++) {
      const item = items[pIdx];
      const blob = await item.entry.async('blob');
      const typedBlob = blob.type ? blob : new Blob([blob], { type: mimeFromFileName(item.path) });
      const blobUrl = URL.createObjectURL(typedBlob);
      if (!coverPath) coverPath = blobUrl;

      pages.push({
        id: `${chId}-p-${pIdx + 1}`,
        index: pIdx,
        imagePath: blobUrl,
      });
    }

    const dirTitle = dirKey ? dirKey.split('/').pop() || dirKey : `Глава ${chIdx + 1}`;
    chapters.push({
      id: chId,
      volume: '1',
      number: String(chIdx + 1),
      title: dirTitle,
      pages,
    });
  }

  return {
    id: `comic-cbz-${safeSlug}`,
    title: stem,
    sourceType: 'cbz',
    coverPath,
    isRanobe: false,
    chapters,
  };
}

export async function parseLocalEpubInBrowser(file: File): Promise<ComicImportResultPayload> {
  const zip = await JSZip.loadAsync(file);
  const stem = file.name.replace(/\.[^.]+$/, '') || 'book';
  const safeSlug = sanitizeSlug(stem, 'epub_comic');
  const parser = new DOMParser();

  // 1. Find OPF via META-INF/container.xml
  let opfPath: string | null = null;
  const containerEntry = zip.file('META-INF/container.xml');
  if (containerEntry) {
    const xml = await containerEntry.async('text');
    const doc = parser.parseFromString(xml, 'application/xml');
    const rootfile = doc.querySelector('rootfile');
    opfPath = rootfile?.getAttribute('full-path') || null;
  }

  const manifest = new Map<string, { href: string; mediaType: string }>();
  const spineIds: string[] = [];
  let bookTitle = stem;
  const opfDir = opfPath && opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';

  if (opfPath && zip.file(opfPath)) {
    const opfXml = await zip.file(opfPath)!.async('text');
    const opfDoc = parser.parseFromString(opfXml, 'application/xml');
    const titleEl = opfDoc.getElementsByTagName('dc:title')[0] || opfDoc.getElementsByTagName('title')[0];
    if (titleEl?.textContent?.trim()) {
      bookTitle = titleEl.textContent.trim();
    }

    const items = Array.from(opfDoc.getElementsByTagName('item'));
    for (const item of items) {
      const id = item.getAttribute('id');
      const href = item.getAttribute('href');
      const mediaType = item.getAttribute('media-type') || '';
      if (id && href) manifest.set(id, { href, mediaType });
    }

    const itemrefs = Array.from(opfDoc.getElementsByTagName('itemref'));
    for (const ref of itemrefs) {
      const idref = ref.getAttribute('idref');
      if (idref) spineIds.push(idref);
    }
  }

  let spineFiles: string[] = [];
  for (const idref of spineIds) {
    const entry = manifest.get(idref);
    if (entry) {
      const resolved = resolveZipRelativePath(opfDir, entry.href);
      if (resolved) spineFiles.push(resolved);
    }
  }

  if (spineFiles.length === 0) {
    zip.forEach((rel, entry) => {
      if (!entry.dir && /\.(xhtml|html|htm)$/i.test(rel)) {
        spineFiles.push(rel);
      }
    });
    spineFiles.sort(compareNatural);
  }

  const imagePages: ComicPage[] = [];
  const textChapters: ComicChapter[] = [];
  let coverPath: string | null = null;

  for (const xhtmlPath of spineFiles) {
    const entry = zip.file(xhtmlPath);
    if (!entry) continue;
    const xhtmlText = await entry.async('text');
    if (!xhtmlText.trim()) continue;

    const xhtmlDir = xhtmlPath.includes('/') ? xhtmlPath.slice(0, xhtmlPath.lastIndexOf('/')) : '';
    const doc = parser.parseFromString(xhtmlText, 'text/html');

    const imgEls = Array.from(doc.querySelectorAll('img, image'));
    const imgPaths: string[] = [];
    for (const el of imgEls) {
      const rawSrc =
        el.getAttribute('src') || el.getAttribute('xlink:href') || el.getAttribute('href');
      if (rawSrc) {
        const resolved = resolveZipRelativePath(xhtmlDir, rawSrc);
        if (resolved) imgPaths.push(resolved);
      }
    }

    const paragraphs = extractPlainParagraphsFromContent(xhtmlText);
    const totalChars = paragraphs.reduce((acc, p) => acc + p.length, 0);

    if (imgPaths.length > 0 && totalChars < 120) {
      for (const ip of imgPaths) {
        const imgFile = zip.file(ip);
        if (!imgFile) continue;
        const blob = await imgFile.async('blob');
        const typedBlob = blob.type ? blob : new Blob([blob], { type: mimeFromFileName(ip) });
        const url = URL.createObjectURL(typedBlob);
        if (!coverPath) coverPath = url;
        const idx = imagePages.length;
        imagePages.push({
          id: `epub-${safeSlug}-p-${idx + 1}`,
          index: idx,
          imagePath: url,
        });
      }
    } else if (paragraphs.length > 0) {
      const chNum = textChapters.length + 1;
      const chId = `epub-${safeSlug}-ch-${chNum}`;
      const chTitle =
        paragraphs[0] && paragraphs[0].length < 80 ? paragraphs[0] : `Глава ${chNum}`;
      textChapters.push({
        id: chId,
        volume: '1',
        number: String(chNum),
        title: chTitle,
        pages: chunkParagraphsToPages(paragraphs, chId),
      });
    }
  }

  if (imagePages.length > 0 && imagePages.length >= textChapters.length) {
    return {
      id: `comic-epub-${safeSlug}`,
      title: bookTitle,
      sourceType: 'epub',
      coverPath,
      isRanobe: false,
      chapters: [
        {
          id: `epub-${safeSlug}-ch-1`,
          volume: '1',
          number: '1',
          title: bookTitle,
          pages: imagePages,
        },
      ],
    };
  }

  if (textChapters.length > 0) {
    return {
      id: `comic-epub-${safeSlug}`,
      title: bookTitle,
      sourceType: 'epub',
      coverPath,
      isRanobe: true,
      chapters: textChapters,
    };
  }

  throw new Error('В EPUB-файле не найдено ни страниц с изображениями, ни текстовых глав.');
}

export async function parseLocalPdfInBrowser(file: File): Promise<ComicImportResultPayload> {
  const stem = file.name.replace(/\.[^.]+$/, '') || 'comic_pdf';
  const safeSlug = sanitizeSlug(stem, 'pdf_comic');
  const pdfUrl = URL.createObjectURL(file);

  const doc = await getPdfDocument(pdfUrl);
  const pageCount = Math.max(1, doc.numPages);
  const chId = `pdf-${safeSlug}-ch-1`;

  const pages: ComicPage[] = Array.from({ length: pageCount }, (_, i) => ({
    id: `${chId}-p-${i + 1}`,
    index: i,
    pdfPageNumber: i + 1,
  }));

  return {
    id: `comic-pdf-${safeSlug}`,
    title: stem,
    sourceType: 'pdf',
    pdfPath: pdfUrl,
    isRanobe: false,
    chapters: [
      {
        id: chId,
        volume: '1',
        number: '1',
        title: stem,
        pages,
      },
    ],
  };
}
