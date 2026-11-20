import { isTauri } from '@tauri-apps/api/core';
import {
  ComicChapter,
  ComicImportProgress,
  ComicImportResultPayload,
  ComicProjectData,
  LibChapterMeta,
  LibDownloadChapterSpec,
  LibTitleInfo,
} from '../../types/comic';
import { parseLibUrl } from './libUrlParser';
import {
  chunkParagraphsToPages,
  extractPlainParagraphsFromContent,
  parseNumericChapterValue,
  sanitizeSlug,
} from './comicUtils';
import {
  parseLocalCbzInBrowser,
  parseLocalEpubInBrowser,
  parseLocalPdfInBrowser,
} from './localComicParser';

const DEFAULT_API_BASES = [
  'https://api.cdnlibs.org/api',
  'https://api.lib.social/api',
];

const FALLBACK_IMAGE_SERVERS = [
  'https://img3.cdnlibs.org',
  'https://img3.cdnrulib.link',
  'https://img2.imglib.info',
  'https://img33.imgslib.link',
];

function isDesktopRuntime(): boolean {
  try {
    return isTauri() && !!window.electronAPI?.libFetchMangaInfo;
  } catch {
    return false;
  }
}

export function buildComicProjectFromImport(result: ComicImportResultPayload): ComicProjectData {
  const firstChapter = result.chapters[0];
  return {
    id: result.id,
    title: result.title,
    sourceType: result.sourceType,
    sourceUrl: result.sourceUrl || undefined,
    siteDomain: result.siteDomain || undefined,
    coverPath: result.coverPath || undefined,
    pdfPath: result.pdfPath || undefined,
    isRanobe: result.isRanobe,
    chapters: result.chapters,
    activeChapterId: firstChapter?.id || '',
    activePageIndex: 0,
    viewMode: result.isRanobe ? 'page' : 'webtoon',
    zoom: 100,
    syncTimelineWithComic: true,
    pins: [],
    syncPoints: [],
  };
}

/**
 * Fetch manga/ranobe info & chapter list from a Lib family URL.
 * Uses native Rust HTTP client in Tauri desktop (bypassing CORS & setting proper Site-Id / Referer headers),
 * with a clean browser fallback when running in Web Preview.
 */
export async function fetchLibTitleInfo(
  rawUrl: string,
  options?: { token?: string; apiBase?: string }
): Promise<LibTitleInfo> {
  const parsed = parseLibUrl(rawUrl);
  if (parsed.ok === false) {
    throw new Error(parsed.error);
  }

  if (isDesktopRuntime() && window.electronAPI?.libFetchMangaInfo) {
    const res = await window.electronAPI.libFetchMangaInfo({
      url: parsed.data.url,
      token: options?.token?.trim() || null,
      apiBase: options?.apiBase?.trim() || null,
    });
    if (!res.success || !res.data) {
      throw new Error(res.error || 'Не удалось загрузить информацию о тайтле с Lib API.');
    }
    return res.data;
  }

  // Browser preview direct fetch attempt
  const bases = options?.apiBase?.trim()
    ? [options.apiBase.trim().replace(/\/+$/, '')]
    : DEFAULT_API_BASES;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Site-Id': String(parsed.data.siteId),
  };
  if (options?.token?.trim()) {
    const tok = options.token.trim();
    headers.Authorization = tok.toLowerCase().startsWith('bearer ') ? tok : `Bearer ${tok}`;
  }

  let mangaJson: any = null;
  let activeBase = '';
  let lastError = '';

  for (const base of bases) {
    try {
      let resp = await fetch(
        `${base}/manga/${parsed.data.slug}?fields[]=summary&fields[]=otherNames`,
        { headers }
      );
      if (resp.status === 422) {
        resp = await fetch(`${base}/manga/${parsed.data.slug}`, { headers });
      }
      if (resp.status === 401 || resp.status === 403) {
        throw new Error(
          `Сервер ограничил доступ (HTTP ${resp.status}). Попробуйте указать Bearer-токен в настройках доступа.`
        );
      }
      if (!resp.ok) {
        lastError = `HTTP ${resp.status}`;
        continue;
      }
      mangaJson = await resp.json();
      activeBase = base;
      break;
    } catch (err: any) {
      lastError = err?.message || String(err);
    }
  }

  if (!mangaJson) {
    throw new Error(
      `Не удалось обратиться к API Lib из браузера (${lastError}). В десктопной версии DubStudio Pro загрузка выполняется через встроенный Rust-клиент без CORS-ограничений; в веб-предпросмотре вы также можете загрузить локальный файл .cbz, .pdf или .epub.`
    );
  }

  const chResp = await fetch(`${activeBase}/manga/${parsed.data.slug}/chapters`, { headers });
  if (!chResp.ok) {
    throw new Error(`Не удалось загрузить список глав (HTTP ${chResp.status}).`);
  }
  const chJson = await chResp.json();
  const data = mangaJson.data || mangaJson;

  const chapters: LibChapterMeta[] = (Array.isArray(chJson.data) ? chJson.data : []).map((ch: any) => ({
    id: String(ch.id ?? `${ch.volume}-${ch.number}`),
    volume: String(ch.volume ?? '1'),
    number: String(ch.number ?? '1'),
    name: String(ch.name ?? '').trim(),
    branches: Array.isArray(ch.branches)
      ? ch.branches.map((b: any) => ({
          branchId: typeof b.branch_id === 'number' ? b.branch_id : null,
          teamNames: Array.isArray(b.teams)
            ? b.teams.map((t: any) => String(t.name || '')).filter(Boolean)
            : [],
        }))
      : [],
  }));

  chapters.sort((a, b) => {
    const va = parseNumericChapterValue(a.volume) || 0;
    const vb = parseNumericChapterValue(b.volume) || 0;
    if (va !== vb) return va - vb;
    const na = parseNumericChapterValue(a.number) || 0;
    const nb = parseNumericChapterValue(b.number) || 0;
    return na - nb;
  });

  const rusTitle = data.rus_name ? String(data.rus_name).trim() : null;
  const engTitle = String(data.eng_name || data.name || parsed.data.slug).trim();

  const summaryText = data.summary
    ? typeof data.summary === 'string'
      ? data.summary.trim()
      : extractPlainParagraphsFromContent(data.summary).join(' ').trim()
    : null;

  return {
    slug: parsed.data.slug,
    siteId: parsed.data.siteId,
    siteDomain: parsed.data.siteDomain,
    siteLabel: parsed.data.siteLabel,
    title: rusTitle || engTitle,
    rusTitle,
    coverUrl: data.cover?.default || data.cover?.thumbnail || null,
    summary: summaryText || null,
    isRanobe: parsed.data.isRanobe,
    chapters,
  };
}

/**
 * Download selected chapters from Lib family into the project folder (Tauri desktop)
 * or into browser session state (Web Preview).
 */
export async function downloadLibChapters(params: {
  url: string;
  titleInfo: LibTitleInfo;
  chapters: LibDownloadChapterSpec[];
  projectPath?: string;
  token?: string;
  apiBase?: string;
  onProgress?: (progress: ComicImportProgress) => void;
}): Promise<ComicProjectData> {
  if (params.chapters.length === 0) {
    throw new Error('Выберите хотя бы одну главу для загрузки.');
  }

  if (isDesktopRuntime() && window.electronAPI?.libDownloadChapters) {
    let projectPath = params.projectPath;
    if (!projectPath || projectPath === '/mock/path') {
      const folderRes = await window.electronAPI.openFolder();
      if (!folderRes.success || !folderRes.data) {
        throw new Error('Выберите папку проекта, чтобы сохранить загруженные главы комикса на диск.');
      }
      projectPath = folderRes.data;
    }

    const unlisten = params.onProgress && window.electronAPI.onComicImportProgress
      ? window.electronAPI.onComicImportProgress(params.onProgress)
      : () => {};

    try {
      const res = await window.electronAPI.libDownloadChapters({
        url: params.url,
        slug: params.titleInfo.slug,
        siteId: params.titleInfo.siteId,
        siteDomain: params.titleInfo.siteDomain,
        title: params.titleInfo.title,
        coverUrl: params.titleInfo.coverUrl || null,
        isRanobe: params.titleInfo.isRanobe,
        projectPath,
        chapters: params.chapters,
        token: params.token?.trim() || null,
        apiBase: params.apiBase?.trim() || null,
      });

      if (!res.success || !res.data) {
        throw new Error(res.error || 'Не удалось скачать выбранные главы.');
      }

      return buildComicProjectFromImport(res.data);
    } finally {
      unlisten();
    }
  }

  // Web Preview fallback
  const base = params.apiBase?.trim()
    ? params.apiBase.trim().replace(/\/+$/, '')
    : DEFAULT_API_BASES[0];

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Site-Id': String(params.titleInfo.siteId),
  };
  if (params.token?.trim()) {
    const tok = params.token.trim();
    headers.Authorization = tok.toLowerCase().startsWith('bearer ') ? tok : `Bearer ${tok}`;
  }

  let imageServer = FALLBACK_IMAGE_SERVERS[0];
  if (!params.titleInfo.isRanobe) {
    try {
      const constResp = await fetch(`${base}/constants?fields[]=imageServers`, { headers });
      if (constResp.ok) {
        const constJson = await constResp.json();
        const servers = constJson?.data?.imageServers;
        if (Array.isArray(servers)) {
          const valid = servers.filter(
            (s: any) =>
              s?.id !== 'crop' &&
              typeof s?.url === 'string' &&
              s.url.trim().startsWith('https://') &&
              (!Array.isArray(s.site_ids) || s.site_ids.includes(params.titleInfo.siteId))
          );
          const priority = ['download', 'secondary', 'compress', 'main'];
          valid.sort((a: any, b: any) => {
            const ia = priority.indexOf(a.id);
            const ib = priority.indexOf(b.id);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
          });
          if (valid[0]?.url) imageServer = String(valid[0].url).replace(/\/+$/, '');
        }
      }
    } catch {
      // keep fallback image server
    }
  }

  const safeSlug = sanitizeSlug(params.titleInfo.slug, 'comic');
  const loadedChapters: ComicChapter[] = [];

  for (let i = 0; i < params.chapters.length; i++) {
    const ch = params.chapters[i];
    const chLabel = ch.name
      ? `Том ${ch.volume} · Глава ${ch.number} — ${ch.name}`
      : `Том ${ch.volume} · Глава ${ch.number}`;

    params.onProgress?.({
      stage: 'chapter',
      currentChapter: i + 1,
      totalChapters: params.chapters.length,
      currentPage: 0,
      totalPages: 0,
      message: `Загрузка: ${chLabel}`,
    });

    const query = new URLSearchParams({
      number: ch.number,
      volume: ch.volume,
    });
    if (typeof ch.branchId === 'number') {
      query.set('branch_id', String(ch.branchId));
    }

    const resp = await fetch(`${base}/manga/${params.titleInfo.slug}/chapter?${query.toString()}`, {
      headers,
    });
    if (!resp.ok) {
      throw new Error(`Не удалось загрузить ${chLabel} (HTTP ${resp.status}).`);
    }
    const chJson = await resp.json();
    const data = chJson.data || chJson;
    const chId = `lib-${safeSlug}-v${ch.volume}-n${ch.number}`;

    if (params.titleInfo.isRanobe || (!data.pages && data.content)) {
      const paras = extractPlainParagraphsFromContent(data.content);
      const pages = chunkParagraphsToPages(paras, chId);
      loadedChapters.push({
        id: chId,
        volume: ch.volume,
        number: ch.number,
        title: chLabel,
        branchName: ch.branchName || undefined,
        pages,
      });
    } else {
      const rawPages = Array.isArray(data.pages) ? data.pages : [];
      const pages = rawPages.map((p: any, pIdx: number) => {
        const rawUrl = String(p.url || p.image || '');
        const fullUrl = rawUrl.startsWith('https://')
          ? rawUrl
          : `${imageServer}/${rawUrl.replace(/^\/+/, '')}`;
        return {
          id: `${chId}-p-${pIdx + 1}`,
          index: pIdx,
          imagePath: fullUrl,
          width: typeof p.width === 'number' ? p.width : undefined,
          height: typeof p.height === 'number' ? p.height : undefined,
        };
      });
      loadedChapters.push({
        id: chId,
        volume: ch.volume,
        number: ch.number,
        title: chLabel,
        branchName: ch.branchName || undefined,
        pages,
      });
    }
  }

  return buildComicProjectFromImport({
    id: `comic-lib-${safeSlug}`,
    title: params.titleInfo.title,
    sourceType: 'lib',
    sourceUrl: params.url,
    siteDomain: params.titleInfo.siteDomain,
    coverPath: params.titleInfo.coverUrl || null,
    isRanobe: params.titleInfo.isRanobe,
    chapters: loadedChapters,
  });
}

/**
 * Import a local physical comic file (.cbz, .pdf, .epub) either via native Rust (Tauri)
 * or via pure-JS browser parser (Web Preview / drag-and-drop File object).
 */
export async function importLocalComicFile(params: {
  file?: File;
  filePath?: string;
  projectPath?: string;
  onProgress?: (progress: ComicImportProgress) => void;
}): Promise<ComicProjectData> {
  if (params.filePath && isDesktopRuntime() && window.electronAPI?.importLocalComic) {
    let projectPath = params.projectPath;
    if (!projectPath || projectPath === '/mock/path') {
      const folderRes = await window.electronAPI.openFolder();
      if (!folderRes.success || !folderRes.data) {
        throw new Error('Выберите папку проекта для сохранения страниц комикса.');
      }
      projectPath = folderRes.data;
    }

    params.onProgress?.({
      stage: 'extract',
      currentChapter: 1,
      totalChapters: 1,
      currentPage: 0,
      totalPages: 0,
      message: 'Распаковка и индексация страниц комикса...',
    });

    const res = await window.electronAPI.importLocalComic({
      filePath: params.filePath,
      projectPath,
    });
    if (!res.success || !res.data) {
      throw new Error(res.error || 'Не удалось импортировать локальный файл комикса.');
    }
    return buildComicProjectFromImport(res.data);
  }

  if (!params.file) {
    throw new Error('Файл комикса не выбран.');
  }

  const ext = params.file.name.split('.').pop()?.toLowerCase() || '';
  params.onProgress?.({
    stage: 'extract',
    currentChapter: 1,
    totalChapters: 1,
    currentPage: 0,
    totalPages: 0,
    message: `Обработка файла ${params.file.name}...`,
  });

  if (ext === 'cbz' || ext === 'zip') {
    const parsed = await parseLocalCbzInBrowser(params.file);
    return buildComicProjectFromImport(parsed);
  }
  if (ext === 'epub') {
    const parsed = await parseLocalEpubInBrowser(params.file);
    return buildComicProjectFromImport(parsed);
  }
  if (ext === 'pdf') {
    const parsed = await parseLocalPdfInBrowser(params.file);
    return buildComicProjectFromImport(parsed);
  }

  throw new Error(`Формат .${ext} не поддерживается. Поддерживаются .cbz, .pdf и .epub.`);
}
