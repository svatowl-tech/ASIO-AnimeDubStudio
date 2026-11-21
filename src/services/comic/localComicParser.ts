import JSZip from 'jszip';
import { createExtractorFromData } from 'node-unrar-js';
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

let cachedUnrarWasmPromise: Promise<ArrayBuffer> | null = null;

async function loadUnrarWasmBinary(): Promise<ArrayBuffer> {
  if (!cachedUnrarWasmPromise) {
    const wasmUrl = new URL('node-unrar-js/esm/js/unrar.wasm', import.meta.url).toString();
    cachedUnrarWasmPromise = fetch(wasmUrl)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Не удалось загрузить WASM-модуль unrar (HTTP ${res.status}).`);
        }
        return res.arrayBuffer();
      })
      .catch((err) => {
        cachedUnrarWasmPromise = null;
        throw err;
      });
  }
  return cachedUnrarWasmPromise;
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

export function mimeFromFileName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return 'image/jpeg';
}

export function guessExtFromName(name: string): string {
  const clean = name.split('?')[0].split('#')[0];
  const ext = clean.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'].includes(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return 'jpg';
}

function normalizeArchiveEntryPath(rawPath: string): string | null {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('__MACOSX') || normalized.includes('..')) {
    return null;
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  const fileName = parts[parts.length - 1];
  if (fileName.startsWith('.')) return null;
  return parts.join('/');
}

function isZipSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  );
}

export interface ExtractedArchiveImage {
  path: string;
  data: Uint8Array;
}

/**
 * Extracts image entries from a CBR archive (RAR4/RAR5 via WASM unrar, or ZIP-disguised CBR via JSZip).
 * Returns sanitized relative paths and raw image byte buffers.
 */
export async function extractCbrImageEntries(
  buffer: ArrayBuffer
): Promise<ExtractedArchiveImage[]> {
  const bytes = new Uint8Array(buffer);
  const results: ExtractedArchiveImage[] = [];

  if (isZipSignature(bytes)) {
    const zip = await JSZip.loadAsync(buffer);
    const pending: Array<{ path: string; entry: JSZip.JSZipObject }> = [];
    zip.forEach((rel, entry) => {
      if (entry.dir) return;
      const safe = normalizeArchiveEntryPath(rel);
      if (!safe) return;
      const fileName = safe.split('/').pop() || '';
      if (!isImageFile(fileName)) return;
      pending.push({ path: safe, entry });
    });

    for (const item of pending) {
      const data = await item.entry.async('uint8array');
      if (data.length > 0) {
        results.push({ path: item.path, data });
      }
    }
    return results;
  }

  const wasmBinary = await loadUnrarWasmBinary();
  let extractor;
  try {
    extractor = await createExtractorFromData({
      wasmBinary,
      data: buffer,
    });
  } catch (err: any) {
    throw new Error(
      `Не удалось открыть CBR-архив (${err?.message || 'повреждённый или неподдерживаемый RAR'}).`
    );
  }

  try {
    const extracted = extractor.extract({
      files: (header) => {
        if (header.flags.directory) return false;
        const safe = normalizeArchiveEntryPath(header.name);
        if (!safe) return false;
        const fileName = safe.split('/').pop() || '';
        return isImageFile(fileName);
      },
    });

    for (const file of extracted.files) {
      if (file.fileHeader.flags.directory || !file.extraction || file.extraction.length === 0) {
        continue;
      }
      const safe = normalizeArchiveEntryPath(file.fileHeader.name);
      if (!safe) continue;
      // Copy buffer so Emscripten heap reuse cannot mutate extracted page data
      results.push({
        path: safe,
        data: new Uint8Array(file.extraction),
      });
    }
  } catch (err: any) {
    const reason = String(err?.reason || err?.message || '');
    if (reason.includes('PASSWORD')) {
      throw new Error('CBR-архив защищён паролем. Снимите пароль с архива перед импортом.');
    }
    throw new Error(`Ошибка распаковки CBR-архива: ${err?.message || 'некорректный RAR-файл'}.`);
  }

  return results;
}

export async function parseLocalCbrInBrowser(file: File): Promise<ComicImportResultPayload> {
  const stem = file.name.replace(/\.[^.]+$/, '') || 'comic';
  const safeSlug = sanitizeSlug(stem, 'cbr_comic');
  const buffer = await file.arrayBuffer();
  const entries = await extractCbrImageEntries(buffer);

  if (entries.length === 0) {
    throw new Error('В CBR-архиве не найдено изображений страниц.');
  }

  const grouped = new Map<string, ExtractedArchiveImage[]>();
  for (const item of entries) {
    const parts = item.path.split('/');
    const dirKey = parts.slice(0, -1).join('/');
    if (!grouped.has(dirKey)) grouped.set(dirKey, []);
    grouped.get(dirKey)!.push(item);
  }

  const sortedDirs = Array.from(grouped.keys()).sort(compareNatural);
  const chapters: ComicChapter[] = [];
  let coverPath: string | null = null;

  for (let chIdx = 0; chIdx < sortedDirs.length; chIdx++) {
    const dirKey = sortedDirs[chIdx];
    const items = grouped.get(dirKey)!.sort((a, b) => compareNatural(a.path, b.path));
    const chId = `cbr-${safeSlug}-ch-${chIdx + 1}`;
    const pages: ComicPage[] = [];

    for (let pIdx = 0; pIdx < items.length; pIdx++) {
      const item = items[pIdx];
      const blob = new Blob([item.data as unknown as BlobPart], { type: mimeFromFileName(item.path) });
      const blobUrl = URL.createObjectURL(blob);
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
    id: `comic-cbr-${safeSlug}`,
    title: stem,
    sourceType: 'cbr',
    coverPath,
    isRanobe: false,
    chapters,
  };
}

function decodeFb2BytesInBrowser(bytes: Uint8Array): string {
  const slice =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes;

  const headerPreview = new TextDecoder('ascii', { fatal: false })
    .decode(slice.subarray(0, Math.min(256, slice.length)))
    .toLowerCase();

  const declaredCp1251 =
    headerPreview.includes('windows-1251') || headerPreview.includes('cp1251');

  if (!declaredCp1251) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(slice);
    } catch {
      // Fallback to windows-1251 below
    }
  }

  try {
    return new TextDecoder('windows-1251').decode(slice);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(slice);
  }
}

function base64ToBlobUrl(rawBase64: string, contentType: string, fallbackName: string): string | null {
  try {
    const cleaned = rawBase64.replace(/\s+/g, '');
    if (!cleaned) return null;
    const binStr = atob(cleaned);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    const mime = contentType.trim() || mimeFromFileName(fallbackName);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    return null;
  }
}

function getImageHrefAttr(el: Element): string | null {
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    const localName = attr.name.includes(':') ? attr.name.split(':').pop() : attr.name;
    if (localName === 'href') {
      const cleaned = attr.value.replace(/^#/, '').trim();
      if (cleaned) return cleaned;
    }
  }
  return null;
}

interface ParsedFb2Section {
  title: string;
  items: Array<{ type: 'text'; value: string } | { type: 'image'; id: string }>;
}

function collectFb2Sections(parent: Element, out: ParsedFb2Section[]): void {
  const childSections: Element[] = [];
  for (const child of Array.from(parent.children)) {
    const tag = child.localName?.toLowerCase() || child.tagName.toLowerCase();
    if (tag === 'section') {
      childSections.push(child);
    }
  }

  if (childSections.length === 0) {
    const items: ParsedFb2Section['items'] = [];
    let title = '';
    for (const child of Array.from(parent.children)) {
      const tag = child.localName?.toLowerCase() || child.tagName.toLowerCase();
      if (tag === 'title') {
        const text = (child.textContent || '').replace(/\s+/g, ' ').trim();
        if (text && !title) title = text;
      } else if (tag === 'image') {
        const href = getImageHrefAttr(child);
        if (href) items.push({ type: 'image', id: href });
      } else if (tag === 'p' || tag === 'v' || tag === 'subtitle' || tag === 'text-author') {
        const text = (child.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) items.push({ type: 'text', value: text });
      } else if (tag === 'poem' || tag === 'stanza' || tag === 'cite' || tag === 'epigraph') {
        const nested = Array.from(child.querySelectorAll('p, v, subtitle, text-author, image'));
        for (const n of nested) {
          const nTag = n.localName?.toLowerCase() || n.tagName.toLowerCase();
          if (nTag === 'image') {
            const href = getImageHrefAttr(n);
            if (href) items.push({ type: 'image', id: href });
          } else {
            const text = (n.textContent || '').replace(/\s+/g, ' ').trim();
            if (text) items.push({ type: 'text', value: text });
          }
        }
      }
    }
    if (items.length > 0) {
      out.push({ title, items });
    }
    return;
  }

  // Parent section has nested sections: flush any direct intro content first, then recurse
  let parentTitle = '';
  const directItems: ParsedFb2Section['items'] = [];
  for (const child of Array.from(parent.children)) {
    const tag = child.localName?.toLowerCase() || child.tagName.toLowerCase();
    if (tag === 'section') continue;
    if (tag === 'title') {
      const text = (child.textContent || '').replace(/\s+/g, ' ').trim();
      if (text && !parentTitle) parentTitle = text;
    } else if (tag === 'image') {
      const href = getImageHrefAttr(child);
      if (href) directItems.push({ type: 'image', id: href });
    } else if (tag === 'p' || tag === 'v' || tag === 'subtitle' || tag === 'text-author') {
      const text = (child.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) directItems.push({ type: 'text', value: text });
    }
  }
  if (directItems.length > 0) {
    out.push({ title: parentTitle, items: directItems });
  }
  for (const sec of childSections) {
    collectFb2Sections(sec, out);
  }
}

export function parseLocalFb2Bytes(bytes: Uint8Array, stem: string): ComicImportResultPayload {
  const xmlText = decodeFb2BytesInBrowser(bytes);
  const safeSlug = sanitizeSlug(stem, 'fb2_comic');
  const parser = new DOMParser();

  let doc = parser.parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    doc = parser.parseFromString(xmlText, 'text/html');
  }

  let bookTitle = stem;
  const bookTitleEl = doc.getElementsByTagName('book-title')[0];
  if (bookTitleEl?.textContent?.trim()) {
    bookTitle = bookTitleEl.textContent.replace(/\s+/g, ' ').trim();
  }

  // Decode embedded <binary> images
  const binaryMap = new Map<string, string>();
  const binaryOrder: string[] = [];
  const binaryEls = Array.from(doc.getElementsByTagName('binary'));
  for (const binEl of binaryEls) {
    const id = binEl.getAttribute('id')?.trim();
    if (!id) continue;
    const ct = binEl.getAttribute('content-type') || '';
    const url = base64ToBlobUrl(binEl.textContent || '', ct, id);
    if (url) {
      binaryMap.set(id, url);
      binaryOrder.push(url);
    }
  }

  let coverPath: string | null = null;
  const coverPageEl = doc.getElementsByTagName('coverpage')[0];
  if (coverPageEl) {
    const imgEl = coverPageEl.getElementsByTagName('image')[0];
    const href = imgEl ? getImageHrefAttr(imgEl) : null;
    if (href && binaryMap.has(href)) {
      coverPath = binaryMap.get(href)!;
    }
  }
  if (!coverPath && binaryOrder.length > 0) {
    coverPath = binaryOrder[0];
  }

  // Collect sections from primary <body> (skip footnotes/comments body)
  const sections: ParsedFb2Section[] = [];
  const bodyEls = Array.from(doc.getElementsByTagName('body'));
  for (const body of bodyEls) {
    const bodyName = (body.getAttribute('name') || '').toLowerCase();
    if (bodyName.includes('note') || bodyName.includes('comment')) continue;
    collectFb2Sections(body, sections);
  }

  let totalTextChars = 0;
  let totalBodyImages = 0;
  for (const sec of sections) {
    for (const item of sec.items) {
      if (item.type === 'text') totalTextChars += item.value.length;
      else if (binaryMap.has(item.id)) totalBodyImages += 1;
    }
  }

  const isImageComic =
    (totalBodyImages > 0 && totalTextChars < totalBodyImages * 80) ||
    (totalTextChars === 0 && binaryOrder.length > 0);

  if (isImageComic) {
    const chapters: ComicChapter[] = [];
    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
      const sec = sections[sIdx];
      const chId = `fb2-${safeSlug}-ch-${sIdx + 1}`;
      const pages: ComicPage[] = [];
      for (const item of sec.items) {
        if (item.type === 'image') {
          const url = binaryMap.get(item.id);
          if (url) {
            pages.push({
              id: `${chId}-p-${pages.length + 1}`,
              index: pages.length,
              imagePath: url,
            });
          }
        }
      }
      if (pages.length > 0) {
        chapters.push({
          id: chId,
          volume: '1',
          number: String(chapters.length + 1),
          title: sec.title || `Глава ${chapters.length + 1}`,
          pages,
        });
      }
    }

    if (chapters.length === 0 && binaryOrder.length > 0) {
      const chId = `fb2-${safeSlug}-ch-1`;
      chapters.push({
        id: chId,
        volume: '1',
        number: '1',
        title: bookTitle,
        pages: binaryOrder.map((url, idx) => ({
          id: `${chId}-p-${idx + 1}`,
          index: idx,
          imagePath: url,
        })),
      });
    }

    if (chapters.length > 0) {
      return {
        id: `comic-fb2-${safeSlug}`,
        title: bookTitle,
        sourceType: 'fb2',
        coverPath,
        isRanobe: false,
        chapters,
      };
    }
  }

  // Text / illustrated book FB2
  const chapters: ComicChapter[] = [];
  for (const sec of sections) {
    const chNum = chapters.length + 1;
    const chId = `fb2-${safeSlug}-ch-${chNum}`;
    const pages: ComicPage[] = [];
    let pendingParas: string[] = [];

    const flushPending = () => {
      if (pendingParas.length === 0) return;
      const chunked = chunkParagraphsToPages(pendingParas, chId);
      pendingParas = [];
      for (const pg of chunked) {
        const idx = pages.length;
        pages.push({
          ...pg,
          id: `${chId}-p-${idx + 1}`,
          index: idx,
        });
      }
    };

    for (const item of sec.items) {
      if (item.type === 'text') {
        pendingParas.push(item.value);
      } else {
        const url = binaryMap.get(item.id);
        if (url) {
          flushPending();
          const idx = pages.length;
          pages.push({
            id: `${chId}-p-${idx + 1}`,
            index: idx,
            imagePath: url,
          });
        }
      }
    }
    flushPending();

    if (pages.length > 0) {
      chapters.push({
        id: chId,
        volume: '1',
        number: String(chNum),
        title: sec.title || `Глава ${chNum}`,
        pages,
      });
    }
  }

  if (chapters.length === 0) {
    throw new Error('В FB2-файле не найдено ни текстовых глав, ни изображений страниц.');
  }

  return {
    id: `comic-fb2-${safeSlug}`,
    title: bookTitle,
    sourceType: 'fb2',
    coverPath,
    isRanobe: true,
    chapters,
  };
}

export async function parseLocalFb2InBrowser(file: File): Promise<ComicImportResultPayload> {
  const stem = file.name.replace(/\.fb2$/i, '').replace(/\.[^.]+$/, '') || 'book';
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseLocalFb2Bytes(bytes, stem);
}

export async function parseLocalCbzInBrowser(file: File): Promise<ComicImportResultPayload> {
  const zip = await JSZip.loadAsync(file);
  const stem = file.name.replace(/\.[^.]+$/, '') || 'comic';
  const safeSlug = sanitizeSlug(stem, 'cbz_comic');

  const grouped = new Map<string, { path: string; entry: JSZip.JSZipObject }[]>();
  let fb2Entry: { name: string; entry: JSZip.JSZipObject } | null = null;

  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    if (relativePath.includes('__MACOSX') || relativePath.startsWith('.')) return;
    if (relativePath.includes('..')) return;
    const parts = relativePath.split('/');
    const fileName = parts[parts.length - 1] || '';
    if (fileName.startsWith('.')) return;

    if (fileName.toLowerCase().endsWith('.fb2') && !fb2Entry) {
      fb2Entry = { name: fileName, entry };
    }
    if (!isImageFile(fileName)) return;

    const dirKey = parts.slice(0, -1).join('/');
    if (!grouped.has(dirKey)) grouped.set(dirKey, []);
    grouped.get(dirKey)!.push({ path: relativePath, entry });
  });

  if (grouped.size === 0) {
    if (fb2Entry) {
      const fb2Found = fb2Entry as { name: string; entry: JSZip.JSZipObject };
      const fb2Bytes = await fb2Found.entry.async('uint8array');
      const fb2Stem = fb2Found.name.replace(/\.fb2$/i, '') || stem;
      return parseLocalFb2Bytes(fb2Bytes, fb2Stem);
    }
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
