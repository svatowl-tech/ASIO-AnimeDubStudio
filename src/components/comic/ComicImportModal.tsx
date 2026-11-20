import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  Globe,
  Upload,
  X,
  Download,
  Loader2,
  AlertCircle,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronUp,
  KeyRound,
  FileArchive,
} from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import {
  ComicImportProgress,
  ComicProjectData,
  LibDownloadChapterSpec,
  LibTitleInfo,
} from '../../types/comic';
import {
  downloadLibChapters,
  fetchLibTitleInfo,
  importLocalComicFile,
} from '../../services/comic/comicImportService';
import { parseNumericChapterValue } from '../../services/comic/comicUtils';
import { cn } from '../../lib/utils';

interface ComicImportModalProps {
  projectPath?: string;
  onClose: () => void;
  onComicImported: (comic: ComicProjectData, resolvedProjectPath?: string) => void;
}

export const ComicImportModal: React.FC<ComicImportModalProps> = ({
  projectPath,
  onClose,
  onComicImported,
}) => {
  const [activeTab, setActiveTab] = useState<'lib' | 'local'>('lib');

  // Lib Tab state
  const [urlInput, setUrlInput] = useState('');
  const [showAdvancedAccess, setShowAdvancedAccess] = useState(false);
  const [bearerToken, setBearerToken] = useState(''); // Kept in memory only, never persisted
  const [customApiBase, setCustomApiBase] = useState('');

  const [isFetchingInfo, setIsFetchingInfo] = useState(false);
  const [titleInfo, setTitleInfo] = useState<LibTitleInfo | null>(null);
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set());
  const [rangeFrom, setRangeFrom] = useState<string>('1');
  const [rangeTo, setRangeTo] = useState<string>('5');
  const [selectedTeamFilter, setSelectedTeamFilter] = useState<string>('__all__');
  const [coverFailed, setCoverFailed] = useState(false);

  // Shared import progress & error state
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<ComicImportProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Local file tab state
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDesktop = useMemo(() => {
    try {
      return isTauri();
    } catch {
      return false;
    }
  }, []);

  const availableTeams = useMemo(() => {
    if (!titleInfo) return [];
    const set = new Set<string>();
    for (const ch of titleInfo.chapters) {
      for (const b of ch.branches) {
        const label = b.teamNames.join(', ').trim();
        if (label) set.add(label);
      }
    }
    return Array.from(set).sort();
  }, [titleInfo]);

  const applyChapterRange = (chapters: LibTitleInfo['chapters'], fromVal: string, toVal: string) => {
    const fromNum = parseNumericChapterValue(fromVal);
    const toNum = parseNumericChapterValue(toVal);
    const next = new Set<string>();

    chapters.forEach((ch, idx) => {
      const chNum = parseNumericChapterValue(ch.number);
      const val = Number.isFinite(chNum) ? chNum : idx + 1;
      const meetsFrom = !Number.isFinite(fromNum) || val >= fromNum;
      const meetsTo = !Number.isFinite(toNum) || val <= toNum;
      if (meetsFrom && meetsTo) {
        next.add(ch.id);
      }
    });

    if (next.size === 0 && chapters.length > 0) {
      chapters.slice(0, Math.min(5, chapters.length)).forEach((c) => next.add(c.id));
    }
    setSelectedChapterIds(next);
  };

  const handleFetchLibInfo = async () => {
    setErrorMsg(null);
    setCoverFailed(false);
    setIsFetchingInfo(true);
    try {
      const info = await fetchLibTitleInfo(urlInput, {
        token: bearerToken || undefined,
        apiBase: customApiBase || undefined,
      });
      setTitleInfo(info);
      setSelectedTeamFilter('__all__');

      // Default to chapters 1-5 (ideal for casting auditions) or all if fewer
      const defaultFrom = info.chapters[0]?.number || '1';
      const defaultTo =
        info.chapters.length >= 5
          ? info.chapters[4]?.number || '5'
          : info.chapters[info.chapters.length - 1]?.number || '1';
      setRangeFrom(defaultFrom);
      setRangeTo(defaultTo);
      applyChapterRange(info.chapters, defaultFrom, defaultTo);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Не удалось загрузить список глав.');
    } finally {
      setIsFetchingInfo(false);
    }
  };

  const handleToggleChapter = (id: string) => {
    setSelectedChapterIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDownloadSelectedLibChapters = async () => {
    if (!titleInfo) return;
    const chosen = titleInfo.chapters.filter((ch) => selectedChapterIds.has(ch.id));
    if (chosen.length === 0) {
      setErrorMsg('Отметьте хотя бы одну главу для загрузки.');
      return;
    }

    setErrorMsg(null);
    setIsImporting(true);
    setProgress({
      stage: 'chapter',
      currentChapter: 0,
      totalChapters: chosen.length,
      currentPage: 0,
      totalPages: 0,
      message: 'Подготовка загрузки глав в папку проекта...',
    });

    try {
      const specs: LibDownloadChapterSpec[] = chosen.map((ch) => {
        let matchedBranch = ch.branches[0];
        if (selectedTeamFilter !== '__all__') {
          const found = ch.branches.find(
            (b) => b.teamNames.join(', ').trim() === selectedTeamFilter
          );
          if (found) matchedBranch = found;
        }
        return {
          id: ch.id,
          volume: ch.volume,
          number: ch.number,
          name: ch.name,
          branchId: matchedBranch?.branchId ?? null,
          branchName: matchedBranch?.teamNames?.join(', ') || null,
        };
      });

      let targetProjectPath = projectPath;
      if (isDesktop && (!targetProjectPath || targetProjectPath === '/mock/path') && window.electronAPI?.openFolder) {
        const folderRes = await window.electronAPI.openFolder();
        if (!folderRes.success || !folderRes.data) {
          throw new Error('Выберите папку проекта, чтобы сохранить главы комикса.');
        }
        targetProjectPath = folderRes.data;
      }

      const comicData = await downloadLibChapters({
        url: urlInput.trim(),
        titleInfo,
        chapters: specs,
        projectPath: targetProjectPath,
        token: bearerToken || undefined,
        apiBase: customApiBase || undefined,
        onProgress: (p) => setProgress(p),
      });

      onComicImported(comicData, targetProjectPath);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Ошибка загрузки глав комикса.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleLocalFileProcess = async (file?: File, filePath?: string) => {
    setErrorMsg(null);
    setIsImporting(true);
    setProgress({
      stage: 'extract',
      currentChapter: 1,
      totalChapters: 1,
      currentPage: 0,
      totalPages: 0,
      message: 'Распаковка и подготовка страниц...',
    });

    try {
      let targetProjectPath = projectPath;
      if (isDesktop && filePath && (!targetProjectPath || targetProjectPath === '/mock/path') && window.electronAPI?.openFolder) {
        const folderRes = await window.electronAPI.openFolder();
        if (!folderRes.success || !folderRes.data) {
          throw new Error('Выберите папку проекта для сохранения страниц комикса.');
        }
        targetProjectPath = folderRes.data;
      }

      const comicData = await importLocalComicFile({
        file,
        filePath,
        projectPath: targetProjectPath,
        onProgress: (p) => setProgress(p),
      });

      onComicImported(comicData, targetProjectPath);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Не удалось импортировать файл комикса.');
    } finally {
      setIsImporting(false);
    }
  };

  const handlePickLocalFile = async () => {
    if (isDesktop && window.electronAPI?.openFile) {
      const res = await window.electronAPI.openFile({
        title: 'Выберите файл комикса (.cbz, .pdf, .epub)',
        filters: [{ name: 'Комиксы и книги', extensions: ['cbz', 'pdf', 'epub', 'zip'] }],
      });
      if (res.success && res.data?.path) {
        await handleLocalFileProcess(undefined, res.data.path);
      }
      return;
    }
    fileInputRef.current?.click();
  };

  const progressPercent = useMemo(() => {
    if (!progress) return 0;
    if (progress.totalChapters <= 0) return 15;
    const chapterFrac = Math.max(0, progress.currentChapter - 1) / progress.totalChapters;
    const pageFrac =
      progress.totalPages > 0
        ? (progress.currentPage / progress.totalPages) / progress.totalChapters
        : 0;
    return Math.min(100, Math.round((chapterFrac + pageFrac) * 100));
  }, [progress]);

  const modalContent = (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[320] flex items-center justify-center p-4"
      onClick={() => !isImporting && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-white truncate">
                Импорт комикса / манхвы
              </h2>
              <p className="text-xs text-zinc-400 truncate">
                Сайты семейства Lib (MangaLib, RanobeLib...) и файлы CBZ, PDF, EPUB
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isImporting}
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Source Switch Tabs */}
        <div className="px-5 pt-4 shrink-0">
          <div className="flex items-center gap-1 p-1 bg-zinc-950 rounded-xl border border-white/10">
            <button
              type="button"
              disabled={isImporting}
              onClick={() => {
                setActiveTab('lib');
                setErrorMsg(null);
              }}
              className={cn(
                'flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer',
                activeTab === 'lib'
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              )}
            >
              <Globe className="w-4 h-4" />
              <span>Сайты Lib (MangaLib, RanobeLib...)</span>
            </button>
            <button
              type="button"
              disabled={isImporting}
              onClick={() => {
                setActiveTab('local');
                setErrorMsg(null);
              }}
              className={cn(
                'flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer',
                activeTab === 'local'
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              )}
            >
              <FileArchive className="w-4 h-4" />
              <span>Локальный файл (.cbz, .pdf, .epub)</span>
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4 custom-scrollbar">
          {activeTab === 'lib' ? (
            <>
              {/* URL input row */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-zinc-300">
                  Ссылка на тайтл (MangaLib, RanobeLib, SlashLib, HentaiLib)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    value={urlInput}
                    disabled={isFetchingInfo || isImporting}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && urlInput.trim() && !isFetchingInfo) {
                        handleFetchLibInfo();
                      }
                    }}
                    placeholder="https://mangalib.me/ru/manga/272748--yasuui-jeonbuini-doegetseupnida"
                    className="flex-1 bg-zinc-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    disabled={!urlInput.trim() || isFetchingInfo || isImporting}
                    onClick={handleFetchLibInfo}
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isFetchingInfo ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Globe className="w-4 h-4" />
                    )}
                    <span>Загрузить главы</span>
                  </button>
                </div>

                {/* Collapsible Access Options (Token / Mirror) */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowAdvancedAccess((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Токен доступа / зеркало API (для 18+ и закрытых тайтлов)</span>
                    {showAdvancedAccess ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {showAdvancedAccess && (
                    <div className="mt-2 p-3 bg-zinc-950/80 border border-white/10 rounded-xl grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">
                          Bearer-токен (только на время загрузки)
                        </label>
                        <input
                          type="password"
                          value={bearerToken}
                          onChange={(e) => setBearerToken(e.target.value)}
                          placeholder="Необязательно"
                          className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">
                          Зеркало API (по умолчанию api.cdnlibs.org)
                        </label>
                        <input
                          type="url"
                          value={customApiBase}
                          onChange={(e) => setCustomApiBase(e.target.value)}
                          placeholder="https://api.cdnlibs.org/api"
                          className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Loaded Title Metadata & Chapter Range Picker */}
              {titleInfo && (
                <div className="space-y-3 pt-1">
                  {/* Title Header */}
                  <div className="flex items-start gap-3.5 p-3 bg-zinc-950/70 border border-white/10 rounded-xl">
                    <div className="w-14 h-20 rounded-lg bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center border border-white/10">
                      {titleInfo.coverUrl && !coverFailed ? (
                        <img
                          src={titleInfo.coverUrl}
                          alt={titleInfo.title}
                          referrerPolicy="no-referrer"
                          onError={() => setCoverFailed(true)}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <BookOpen className="w-5 h-5 text-zinc-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <h3 className="text-sm font-bold text-white leading-snug line-clamp-2">
                        {titleInfo.title}
                      </h3>
                      <div className="text-xs text-zinc-400 flex flex-wrap items-center gap-1.5 font-mono tabular-nums">
                        <span>{titleInfo.siteLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span>{titleInfo.isRanobe ? 'Ранобэ' : 'Комикс / Манхва'}</span>
                        <span aria-hidden="true">·</span>
                        <span>Всего глав: {titleInfo.chapters.length}</span>
                      </div>
                      {titleInfo.summary && (
                        <p className="text-[11px] text-zinc-500 line-clamp-2 leading-relaxed">
                          {titleInfo.summary}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Range & Branch Controls */}
                  <div className="p-3 bg-zinc-950/60 border border-white/10 rounded-xl space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-zinc-400">Диапазон глав:</span>
                        <input
                          type="text"
                          value={rangeFrom}
                          onChange={(e) => {
                            setRangeFrom(e.target.value);
                            applyChapterRange(titleInfo.chapters, e.target.value, rangeTo);
                          }}
                          className="w-16 bg-zinc-900 border border-white/10 rounded-lg px-2 py-1 text-xs font-mono tabular-nums text-white text-center focus:outline-none focus:border-indigo-500"
                          aria-label="С главы"
                        />
                        <span className="text-zinc-500">—</span>
                        <input
                          type="text"
                          value={rangeTo}
                          onChange={(e) => {
                            setRangeTo(e.target.value);
                            applyChapterRange(titleInfo.chapters, rangeFrom, e.target.value);
                          }}
                          className="w-16 bg-zinc-900 border border-white/10 rounded-lg px-2 py-1 text-xs font-mono tabular-nums text-white text-center focus:outline-none focus:border-indigo-500"
                          aria-label="По главу"
                        />
                      </div>

                      <div className="flex items-center gap-1">
                        {[
                          { label: '1–5', from: '1', to: '5' },
                          { label: '1–10', from: '1', to: '10' },
                          { label: 'Все', from: '', to: '' },
                        ].map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => {
                              setRangeFrom(preset.from);
                              setRangeTo(preset.to);
                              applyChapterRange(titleInfo.chapters, preset.from, preset.to);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] font-medium text-zinc-200 transition-colors cursor-pointer"
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {availableTeams.length > 1 && (
                      <div className="flex items-center gap-2 text-xs pt-1 border-t border-white/5">
                        <span className="text-zinc-400 shrink-0">Переводчик:</span>
                        <select
                          value={selectedTeamFilter}
                          onChange={(e) => setSelectedTeamFilter(e.target.value)}
                          className="flex-1 bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="__all__">По умолчанию (основная ветка)</option>
                          {availableTeams.map((team) => (
                            <option key={team} value={team}>
                              {team}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Chapters Checklist */}
                  <div className="border border-white/10 rounded-xl bg-zinc-950/60 overflow-hidden">
                    <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between text-[11px] text-zinc-400">
                      <span>Выбрано глав: <strong className="text-white font-mono tabular-nums">{selectedChapterIds.size}</strong></span>
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedChapterIds.size === titleInfo.chapters.length) {
                            setSelectedChapterIds(new Set());
                          } else {
                            setSelectedChapterIds(new Set(titleInfo.chapters.map((c) => c.id)));
                          }
                        }}
                        className="text-indigo-400 hover:text-indigo-300 cursor-pointer"
                      >
                        {selectedChapterIds.size === titleInfo.chapters.length ? 'Снять все' : 'Выбрать все'}
                      </button>
                    </div>
                    <div className="max-h-52 overflow-y-auto divide-y divide-white/5 custom-scrollbar">
                      {titleInfo.chapters.map((ch) => {
                        const checked = selectedChapterIds.has(ch.id);
                        return (
                          <button
                            key={ch.id}
                            type="button"
                            onClick={() => handleToggleChapter(ch.id)}
                            className={cn(
                              'w-full px-3 py-2 flex items-center gap-2.5 text-left text-xs transition-colors cursor-pointer',
                              checked ? 'bg-indigo-600/10 text-white' : 'text-zinc-400 hover:bg-white/5'
                            )}
                          >
                            {checked ? (
                              <CheckSquare className="w-4 h-4 text-indigo-400 shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-zinc-600 shrink-0" />
                            )}
                            <span className="font-mono tabular-nums text-zinc-300 shrink-0">
                              Т.{ch.volume} Гл.{ch.number}
                            </span>
                            <span className="truncate flex-1 text-zinc-400">
                              {ch.name || 'Без названия'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Local File Tab (.cbz, .pdf, .epub) */
            <div className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".cbz,.pdf,.epub,.zip"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleLocalFileProcess(file);
                  }
                  e.target.value = '';
                }}
              />

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(true);
                }}
                onDragLeave={() => setIsDraggingOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) {
                    handleLocalFileProcess(file);
                  }
                }}
                onClick={() => !isImporting && handlePickLocalFile()}
                className={cn(
                  'border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center text-center gap-3 transition-colors cursor-pointer',
                  isDraggingOver
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : 'border-white/15 bg-zinc-950/60 hover:border-indigo-500/60 hover:bg-zinc-950'
                )}
              >
                <div className="w-12 h-12 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Upload className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-white">
                    Нажмите для выбора или перетащите файл комикса
                  </p>
                  <p className="text-xs text-zinc-400">
                    Поддерживаются архивы CBZ, документы PDF и книги/манга EPUB
                  </p>
                </div>
                <span className="mt-1 px-4 py-1.5 rounded-lg bg-indigo-600 text-xs font-semibold text-white">
                  Выбрать файл...
                </span>
              </div>
            </div>
          )}

          {/* Progress Bar */}
          {isImporting && progress && (
            <div className="p-3.5 bg-zinc-950 border border-indigo-500/30 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-200 truncate">{progress.message}</span>
                <span className="font-mono tabular-nums text-indigo-300 shrink-0 ml-2">
                  {progressPercent}%
                </span>
              </div>
              <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all duration-150"
                  style={{ width: `${Math.max(6, progressPercent)}%` }}
                />
              </div>
            </div>
          )}

          {/* Error Box */}
          {errorMsg && (
            <div className="p-3 bg-rose-950/60 border border-rose-500/30 rounded-xl flex items-start gap-2.5 text-xs text-rose-200">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-white/10 bg-zinc-900/90 flex items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            disabled={isImporting}
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition-colors cursor-pointer disabled:opacity-40"
          >
            Отмена
          </button>

          {activeTab === 'lib' && (
            <button
              type="button"
              disabled={!titleInfo || selectedChapterIds.size === 0 || isImporting}
              onClick={handleDownloadSelectedLibChapters}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-xs font-semibold text-white transition-colors flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
            >
              {isImporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span>
                Скачать в проект ({selectedChapterIds.size})
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};

export default ComicImportModal;
