export interface ParsedLibUrl {
  url: string;
  siteDomain: string;
  siteId: number;
  siteLabel: string;
  isRanobe: boolean;
  slug: string;
}

const ALLOWED_LIB_HOSTS = [
  'mangalib.me',
  'ranobelib.me',
  'slashlib.me',
  'yaoilib.me',
  'hentailib.me',
  'lib.social',
  'v3.mangalib.me',
  'v2.mangalib.me',
  'v1.mangalib.me',
  'v2.ranobelib.me',
  'v2.slashlib.me',
  'v4.hentailib.me',
  'test-front.mangalib.me',
];

export function isAllowedLibHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return ALLOWED_LIB_HOSTS.some(
    (allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`)
  );
}

export function parseLibUrl(rawInput: string): { ok: true; data: ParsedLibUrl } | { ok: false; error: string } {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { ok: false, error: 'Введите ссылку на страницу манги, манхвы или ранобэ семейства Lib.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, error: 'Некорректный формат ссылки.' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Поддерживаются только HTTPS-ссылки.' };
  }

  const host = parsed.hostname.toLowerCase();
  if (!isAllowedLibHost(host)) {
    return {
      ok: false,
      error: 'Ссылка не относится к семейству Lib (mangalib.me, ranobelib.me, slashlib.me, hentailib.me, lib.social).',
    };
  }

  let siteId = 1;
  let siteLabel = 'MangaLib';
  let isRanobe = false;

  if (host.includes('ranobelib')) {
    siteId = 3;
    siteLabel = 'RanobeLib';
    isRanobe = true;
  } else if (host.includes('slashlib') || host.includes('yaoilib')) {
    siteId = 2;
    siteLabel = 'SlashLib';
  } else if (host.includes('hentailib')) {
    siteId = 4;
    siteLabel = 'HentaiLib';
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  let slug = '';

  for (let i = 0; i < segments.length; i++) {
    const lower = segments[i].toLowerCase();
    if ((lower === 'manga' || lower === 'book' || lower === 'ranobe') && i + 1 < segments.length) {
      slug = segments[i + 1];
      break;
    }
  }

  if (!slug) {
    slug = segments.find((s) => s.includes('--') && s.length > 3) || '';
  }

  if (!slug) {
    slug = segments.find((s) => !['ru', 'en', 'uk', 'read', 'manga', 'book'].includes(s.toLowerCase())) || '';
  }

  if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return {
      ok: false,
      error: 'Не удалось извлечь slug тайтла из ссылки. Откройте главную страницу манги/ранобэ и скопируйте URL.',
    };
  }

  return {
    ok: true,
    data: {
      url: `https://${host}${parsed.pathname}${parsed.search}`,
      siteDomain: host,
      siteId,
      siteLabel,
      isRanobe,
      slug,
    },
  };
}
