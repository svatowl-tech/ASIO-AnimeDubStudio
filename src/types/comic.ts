export type ComicSourceType = 'lib' | 'cbz' | 'pdf' | 'epub';

export type ComicViewMode = 'webtoon' | 'page';

export interface ComicPage {
  id: string;
  index: number;
  imagePath?: string; // Relative ./comics/... in Tauri or blob:/data: URL in web
  pdfPageNumber?: number; // 1-based page number when sourceType === 'pdf'
  textBlocks?: string[]; // Clean plain-text paragraphs for RanobeLib / text EPUB
  width?: number;
  height?: number;
}

export interface ComicChapter {
  id: string;
  volume: string;
  number: string;
  title: string;
  branchName?: string;
  pages: ComicPage[];
}

export interface ComicBubblePin {
  id: string;
  chapterId: string;
  pageIndex: number;
  x: number; // 0..100 (% relative to page width)
  y: number; // 0..100 (% relative to page height)
  subtitleId: string; // 1-to-1 link with Project.subtitles
  role: string;
  label: string;
  timelineTime: number; // seconds on timeline
  order: number; // Sequential display number (#1, #2, ...)
}

export interface ComicSyncPoint {
  id: string;
  time: number; // seconds on timeline
  chapterId: string;
  pageIndex: number;
  markerId: string; // 1-to-1 link with Project.markers
}

export interface ComicProjectData {
  id: string;
  title: string;
  sourceType: ComicSourceType;
  sourceUrl?: string;
  siteDomain?: string;
  coverPath?: string;
  pdfPath?: string; // Relative ./comics/...pdf or object URL in browser
  isRanobe?: boolean;
  chapters: ComicChapter[];
  activeChapterId: string;
  activePageIndex: number;
  viewMode: ComicViewMode;
  zoom: number; // percentage 50..200
  syncTimelineWithComic: boolean;
  pins: ComicBubblePin[];
  syncPoints: ComicSyncPoint[];
}

export interface LibBranchInfo {
  branchId?: number | null;
  teamNames: string[];
}

export interface LibChapterMeta {
  id: string;
  volume: string;
  number: string;
  name: string;
  branches: LibBranchInfo[];
}

export interface LibTitleInfo {
  slug: string;
  siteId: number;
  siteDomain: string;
  siteLabel: string;
  title: string;
  rusTitle?: string | null;
  coverUrl?: string | null;
  summary?: string | null;
  isRanobe: boolean;
  chapters: LibChapterMeta[];
}

export interface LibDownloadChapterSpec {
  id: string;
  volume: string;
  number: string;
  name: string;
  branchId?: number | null;
  branchName?: string | null;
}

export interface LibDownloadRequest {
  url: string;
  slug: string;
  siteId: number;
  siteDomain: string;
  title: string;
  coverUrl?: string | null;
  isRanobe: boolean;
  projectPath: string;
  chapters: LibDownloadChapterSpec[];
  token?: string | null;
  apiBase?: string | null;
}

export interface ComicImportProgress {
  stage: 'chapter' | 'pages' | 'extract' | 'done';
  currentChapter: number;
  totalChapters: number;
  currentPage: number;
  totalPages: number;
  message: string;
}

export interface ComicImportResultPayload {
  id: string;
  title: string;
  sourceType: ComicSourceType;
  sourceUrl?: string | null;
  siteDomain?: string | null;
  coverPath?: string | null;
  pdfPath?: string | null;
  isRanobe: boolean;
  chapters: ComicChapter[];
}
