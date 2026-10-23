import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  FolderOpen, 
  Settings, 
  FileVideo, 
  FileText, 
  Music, 
  Layers, 
  Video as VideoIcon,
  Plus,
  X,
  Bookmark,
  Mic,
  Download,
  Play,
  Keyboard,
  Sparkles,
  User,
  ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, formatHotkey, getDefaultKeyMap } from '../lib/utils';
import { Tooltip } from './Tooltip';
import { ImportModal } from './ImportModal';
import HistoryControls from './HistoryControls';
import { useUIState } from '../contexts/UIContext';

interface HeaderProps {
  project: any;
  recentProjects: { name: string; path: string; updatedAt?: number }[];
  handleRemoveRecentProject?: (path: string) => void;
  handleClearRecentProjects?: () => void;
  showProjectMenu: boolean;
  setShowProjectMenu: (show: boolean) => void;
  handleNewProject: () => void;
  handleOpenProject: () => void;
  handleSaveProject: () => void;
  handleCloseProject: () => void;
  handleSelectProjectFolder?: () => void;
  handleSelectBackstageFolder?: () => void;
  handleSelectVideo: () => void;
  handleSelectSubs: () => void;
  handleSelectDocument: () => void;
  handleSelectReferenceAudio: () => void;
  handleMergeBackstage: () => void;
  setShowQuickImport: (show: boolean) => void;
  setShowFixImport?: (show: boolean) => void;
  handleBulkImport: () => void;
  handleGameDubbingImport?: () => void;
  handleImportAudio?: () => void;
  isDesktop: boolean;
  handleExport: (format: 'WAV' | 'MP3' | 'FLAC') => void;
  onOpenBackstageEditor: () => void;
  isBackstageSessionRecording?: boolean;
  handleBatchExport: () => void;
  handleMuxVideo: () => void;
  handleExportAudioBook: (gap?: number) => void;
  handleExportStems: () => void;
  handleExportAllStemsZip: () => void;
  handleOpenProjectFolder?: () => void;
  onLoadProject: (path: string) => void;
  hasBackstageSessions?: boolean;
  onOpenCastingModal?: () => void;
  onOpenDocumentModal?: () => void;
  onUpdateDubberNick?: (nick: string) => void;
}

const HotkeyHints = ({ onClose, keyMap }: { onClose: () => void, keyMap: any }) => {
  const currentKeyMap = keyMap || getDefaultKeyMap();
  
  const content = (
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[300] flex justify-center items-start sm:items-center overflow-y-auto p-4 py-12 scrollbar-hide"
      onClick={onClose}
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl max-w-xl w-full p-6 my-auto relative z-[310]"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-indigo-400" />
            Горячие клавиши
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-zinc-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {Object.entries(currentKeyMap).map(([id, action]: [string, any]) => (
            <div key={id} className="flex flex-col gap-1 p-3 bg-zinc-800/30 rounded-lg border border-white/5">
              <div className="text-indigo-300 font-mono text-xs font-bold bg-indigo-500/10 self-start px-2 py-0.5 rounded">
                {formatHotkey(action)}
              </div>
              <div className="text-xs text-zinc-300">
                {action.label}
              </div>
            </div>
          ))}
          {/* Add explicit mention for special keys that aren't in the map but are hardcoded */}
          <div className="flex flex-col gap-1 p-3 bg-zinc-800/30 rounded-lg border border-white/5">
            <div className="text-indigo-300 font-mono text-xs font-bold bg-indigo-500/10 self-start px-2 py-0.5 rounded">
              Delete / Backspace
            </div>
            <div className="text-xs text-zinc-300">
              Удалить выбранные сегменты
            </div>
          </div>
        </div>
        
        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-sm font-bold transition-all">
            Закрыть
          </button>
        </div>
      </motion.div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }

  return content;
};

const Header: React.FC<HeaderProps> = ({
  project,
  recentProjects,
  handleRemoveRecentProject,
  handleClearRecentProjects,
  showProjectMenu,
  setShowProjectMenu,
  handleNewProject,
  handleOpenProject,
  handleSaveProject,
  handleCloseProject,
  handleSelectProjectFolder,
  handleSelectBackstageFolder,
  handleSelectVideo,
  handleSelectSubs,
  handleSelectDocument,
  handleSelectReferenceAudio,
  handleMergeBackstage,
  setShowQuickImport,
  setShowFixImport,
  handleBulkImport,
  handleGameDubbingImport,
  handleImportAudio,
  isDesktop,
  handleExport,
  onOpenBackstageEditor,
  isBackstageSessionRecording,
  hasBackstageSessions,
  handleBatchExport,
  handleMuxVideo,
  handleExportAudioBook,
  handleExportStems,
  handleExportAllStemsZip,
  handleOpenProjectFolder,
  onLoadProject,
  onOpenCastingModal,
  onOpenDocumentModal,
  onUpdateDubberNick
}) => {
  const { toggleSettings } = useUIState();
  const [showHotkeys, setShowHotkeys] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const exportMenuRef = useRef<HTMLDivElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click safely without backdrop overlay glitches
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (showExportMenu && exportMenuRef.current && !exportMenuRef.current.contains(target)) {
        setShowExportMenu(false);
      }
      if (showProjectMenu && projectMenuRef.current && !projectMenuRef.current.contains(target)) {
        setShowProjectMenu(false);
      }
    };

    if (showExportMenu || showProjectMenu) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('touchstart', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [showExportMenu, showProjectMenu, setShowProjectMenu]);

  // Keep recent projects ordered newest first
  const sortedRecentProjects = useMemo(() => {
    if (!recentProjects || recentProjects.length === 0) return [];
    return [...recentProjects].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [recentProjects]);

  const baseImportOptions = [
    { icon: <FileVideo className="w-5 h-5 text-indigo-400" />, title: "Видео", description: "Открыть видеофайл для озвучки", onClick: () => { setShowImportModal(false); if (isDesktop) handleSelectVideo(); } },
    { icon: <FileText className="w-5 h-5 text-purple-400" />, title: "Субтитры", description: "Импортировать (.ass, .srt, .vtt, .fb2, .csv)", onClick: () => { setShowImportModal(false); if (isDesktop) handleSelectSubs(); } },
    { icon: <FileText className="w-5 h-5 text-blue-400" />, title: "Документ", description: "Импорт текстового документа с распределением времени", onClick: () => { setShowImportModal(false); if (onOpenDocumentModal) { onOpenDocumentModal(); } else if (isDesktop) { handleSelectDocument(); } } },
    { icon: <Music className="w-5 h-5 text-amber-400" />, title: "Аудиореференс", description: "Выбрать референсный аудиофайл", onClick: () => { setShowImportModal(false); if (isDesktop) handleSelectReferenceAudio(); } },
    { icon: <Layers className="w-5 h-5 text-indigo-400" />, title: "Пакетный импорт", description: "Импорт всех аудиофайлов из папки", onClick: () => { setShowImportModal(false); handleBulkImport(); } },
    { icon: <Layers className="w-5 h-5 text-emerald-400" />, title: "Импорт игровой озвучки", description: "Выбрать папку реплик + TXT перевод", onClick: () => { setShowImportModal(false); handleGameDubbingImport?.(); } },
  ];

  const projectOnlyOptions = project ? [
    { icon: <FileText className="w-5 h-5 text-rose-400" />, title: "Импорт фиксов", description: "Вставить текст правок от куратора", onClick: () => { setShowImportModal(false); setShowFixImport && setShowFixImport(true); } },
    { icon: <FileText className="w-5 h-5 text-green-400" />, title: "Быстрый импорт текста", description: "Вставить текст из буфера обмена", onClick: () => { setShowImportModal(false); setShowQuickImport(true); } },
    { icon: <Music className="w-5 h-5 text-emerald-500" />, title: "Импорт аудио", description: "Импорт готового аудио на новую дорожку", onClick: () => { setShowImportModal(false); handleImportAudio?.(); } },
  ] : [];

  const castingOption = [
    { icon: <Sparkles className="w-5 h-5 text-indigo-400" />, title: "Импорт кастинга", description: "Кастинг по аудио/видео с текстом или сабами", onClick: () => { setShowImportModal(false); onOpenCastingModal?.(); } }
  ];

  const importOptions = [
    ...baseImportOptions,
    ...projectOnlyOptions,
    ...castingOption
  ];

  return (
    <>
      <header className="h-14 border-b border-white/5 flex items-center justify-between px-6 bg-zinc-900/90 backdrop-blur-md relative z-[150]">
        <div className="flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Mic className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold tracking-tight hidden sm:inline">DubStudio <span className="text-indigo-400">Pro</span></span>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="text-sm text-zinc-400 font-medium truncate max-w-[150px]">{project?.name || 'Нет проекта'}</div>
          
          {/* Dubber Nickname Field in Header */}
          <div className="flex items-center gap-1.5 bg-zinc-800/80 hover:bg-zinc-800 px-2.5 py-1 rounded-lg border border-white/5 focus-within:border-indigo-500/50 transition-all" title="Ник даббера (автоматически добавляется в имя экспортируемого файла)">
            <User className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <input 
              type="text" 
              placeholder="Ник даббера..." 
              value={project?.dubberNick || localStorage.getItem('dubstudio_dubber_nick') || ''} 
              onChange={(e) => {
                const nick = e.target.value;
                localStorage.setItem('dubstudio_dubber_nick', nick);
                if (onUpdateDubberNick) {
                  onUpdateDubberNick(nick);
                }
              }} 
              className="bg-transparent text-xs font-semibold text-white placeholder-zinc-500 focus:outline-none w-20 sm:w-28 truncate"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 ml-auto">
          <HistoryControls />
          <button 
              type="button"
              onClick={() => {
                setShowExportMenu(false);
                setShowProjectMenu(false);
                setShowImportModal(true);
              }}
              className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-bold flex items-center gap-2 transition-all border border-white/5 cursor-pointer"
            >
              <FileVideo className="w-4 h-4 text-indigo-400" />
              Импорт
          </button>

          <div className="relative" ref={exportMenuRef}>
            <button 
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowExportMenu(prev => !prev);
                setShowProjectMenu(false);
                setShowImportModal(false);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-lg text-xs font-bold transition-all shadow-lg shadow-indigo-600/20 active:scale-95 cursor-pointer"
              title="Экспорт дорожек озвучки и проекта"
            >
              <Download className="w-3.5 h-3.5" /> 
              <span className="inline font-bold">Экспорт</span>
              <ChevronDown className={`w-3 h-3 text-indigo-200 transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
            </button>
            
            <AnimatePresence>
              {showExportMenu && (
                <motion.div 
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 top-full mt-2 w-64 max-h-[calc(100vh-4.5rem)] overflow-y-auto custom-scrollbar bg-zinc-900 border border-white/10 rounded-xl shadow-2xl z-[200]"
                >
                    <div className="p-2 space-y-1">
                      <div className="px-3 py-1 text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                        <span>Аудиодорожки</span>
                        <span className="text-[9px] text-indigo-400 font-mono">с нормализацией</span>
                      </div>
                      
                      <button 
                        onClick={() => { setShowExportMenu(false); handleExport('WAV'); }} 
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 rounded-lg text-xs font-bold transition-colors text-left group"
                      >
                        <span className="flex items-center gap-2 text-white">
                          <span className="w-2 h-2 rounded-full bg-indigo-500 group-hover:scale-125 transition-transform"></span>
                          WAV
                        </span>
                        <span className="text-[10px] text-zinc-400 font-normal">24-bit 48kHz</span>
                      </button>
                      
                      <button 
                        onClick={() => { setShowExportMenu(false); handleExport('MP3'); }} 
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 rounded-lg text-xs font-bold transition-colors text-left group"
                      >
                        <span className="flex items-center gap-2 text-white">
                          <span className="w-2 h-2 rounded-full bg-blue-500 group-hover:scale-125 transition-transform"></span>
                          MP3
                        </span>
                        <span className="text-[10px] text-zinc-400 font-normal">320 kbps</span>
                      </button>
                      
                      <button 
                        onClick={() => { setShowExportMenu(false); handleExport('FLAC'); }} 
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 rounded-lg text-xs font-bold transition-colors text-left group"
                      >
                        <span className="flex items-center gap-2 text-white">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 group-hover:scale-125 transition-transform"></span>
                          FLAC
                        </span>
                        <span className="text-[10px] text-zinc-400 font-normal">Lossless</span>
                      </button>
                    </div>

                    <div className="border-t border-white/5 p-2 space-y-1">
                      <div className="px-3 py-1 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                        Дополнительно
                      </div>
                      
                      <button 
                        onClick={() => { setShowExportMenu(false); handleBatchExport(); }} 
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-white/5 rounded-lg text-xs font-medium text-indigo-300 transition-colors text-left"
                      >
                        Пакетный экспорт
                      </button>
                      
                      <button 
                        onClick={() => { setShowExportMenu(false); handleMuxVideo(); }} 
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-white/5 rounded-lg text-xs font-medium text-purple-300 transition-colors text-left"
                      >
                        Экспорт видео с озвучкой
                      </button>
                      
                      <button 
                        onClick={() => { setShowExportMenu(false); handleExportAudioBook(1.5); }} 
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-white/5 rounded-lg text-xs font-medium text-emerald-300 transition-colors text-left"
                      >
                        Аудиокнига (1.5с пауз)
                      </button>

                      <button 
                        onClick={() => { setShowExportMenu(false); handleExportAudioBook(1.0); }} 
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-white/5 rounded-lg text-xs font-medium text-teal-300 transition-colors text-left"
                      >
                        Реплики единым (1.0с пауз)
                      </button>

                      <button 
                        onClick={() => { setShowExportMenu(false); handleExportStems(); }} 
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-white/5 rounded-lg text-xs font-medium text-amber-300 transition-colors text-left"
                      >
                        Экспорт стемов
                      </button>

                      <button 
                        onClick={() => { setShowExportMenu(false); handleExportAllStemsZip(); }} 
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-white/5 rounded-lg text-xs font-medium text-zinc-300 transition-colors text-left"
                      >
                        Экспорт стемов (ZIP)
                      </button>
                    </div>
                  </motion.div>
              )}
            </AnimatePresence>
          </div>

          {project && hasBackstageSessions && (
            <button
              onClick={onOpenBackstageEditor}
              disabled={isBackstageSessionRecording}
              className={`px-3 py-1.5 ${isBackstageSessionRecording ? 'bg-rose-900/50 text-rose-500/50 cursor-not-allowed' : 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20'} rounded-lg text-[10px] font-bold flex items-center gap-2 transition-all`}
              title={isBackstageSessionRecording ? "Остановите запись бекстейджа, чтобы открыть редактор" : "Редактор бекстейджа"}
            >
              <VideoIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Редактор бекстейджа</span>
            </button>
          )}
          
          <div className="relative" ref={projectMenuRef}>
            <button 
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowProjectMenu(!showProjectMenu);
                setShowExportMenu(false);
                setShowImportModal(false);
              }}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-bold flex items-center gap-2 transition-all shadow-lg shadow-indigo-600/20 active:scale-95 cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5" />
              <span className="inline font-bold">Проекты</span>
            </button>
            
            <AnimatePresence>
              {showProjectMenu && (
                <motion.div 
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute top-full right-0 mt-2 w-64 max-h-[calc(100vh-4.5rem)] overflow-y-auto custom-scrollbar bg-zinc-900 border border-white/10 rounded-xl shadow-2xl z-[200]"
                >
                    <div className="p-2 space-y-1">
                      <button 
                        onClick={() => { handleNewProject(); setShowProjectMenu(false); }}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 rounded-lg text-xs font-bold transition-colors"
                      >
                        <Plus className="w-4 h-4 text-emerald-400" />
                        Новый проект
                      </button>
                      <button 
                        onClick={() => { handleOpenProject(); setShowProjectMenu(false); }}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 rounded-lg text-xs font-bold transition-colors"
                      >
                        <FolderOpen className="w-4 h-4 text-indigo-400" />
                        Открыть проект
                      </button>
                      <button 
                        onClick={() => { handleSaveProject(); setShowProjectMenu(false); }}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 rounded-lg text-xs font-bold transition-colors"
                      >
                        <Bookmark className="w-4 h-4 text-amber-400" />
                        Сохранить проект
                      </button>
                      {project && (
                        <button 
                          onClick={() => { handleCloseProject(); setShowProjectMenu(false); }}
                          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-rose-500/10 rounded-lg text-xs font-bold transition-colors text-rose-400"
                        >
                          <X className="w-4 h-4" />
                          Закрыть проект
                        </button>
                      )}
                    </div>

                    {project && (handleSelectProjectFolder || handleOpenProjectFolder) && (
                      <div className="border-t border-white/5 p-2 space-y-1">
                        <div className="px-3 py-1 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Папки</div>
                        {handleOpenProjectFolder && (
                          <button 
                            onClick={() => { handleOpenProjectFolder(); setShowProjectMenu(false); }}
                            className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 rounded-lg text-xs font-bold transition-colors"
                          >
                            <FolderOpen className="w-4 h-4 text-indigo-400" />
                            Открыть папку проекта
                          </button>
                        )}
                        {handleSelectProjectFolder && (
                          <button 
                            onClick={() => { handleSelectProjectFolder(); setShowProjectMenu(false); }}
                            className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 rounded-lg text-xs font-bold transition-colors"
                            title={project?.projectPath || 'Выбрать...'}
                          >
                            <Plus className="w-4 h-4 text-zinc-400" />
                            Сменить / Переместить проект
                          </button>
                        )}
                        <button 
                          onClick={() => { handleSelectBackstageFolder?.(); setShowProjectMenu(false); }}
                          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 rounded-lg text-xs font-bold transition-colors"
                          title={project?.audioSettings?.backstageFolderPath || 'Выбрать...'}
                        >
                          <VideoIcon className="w-4 h-4 text-rose-400" />
                          Папка бекстейджа
                        </button>
                      </div>
                    )}
                    
                    {sortedRecentProjects.length > 0 && (
                      <div className="border-t border-white/5 p-2">
                        <div className="px-3 py-1.5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center justify-between">
                          <span>Недавние проекты</span>
                          {handleClearRecentProjects && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleClearRecentProjects();
                              }}
                              className="text-[9px] text-zinc-500 hover:text-rose-400 transition-colors uppercase tracking-normal"
                              title="Очистить список недавних проектов"
                            >
                              Очистить
                            </button>
                          )}
                        </div>
                        <div className="space-y-1 max-h-52 overflow-y-auto custom-scrollbar">
                          {sortedRecentProjects.map((proj, i) => (
                            <div 
                              key={`${proj.path}-${i}`}
                              onClick={() => {
                                onLoadProject(proj.path);
                                setShowProjectMenu(false);
                              }}
                              className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 rounded-lg text-xs transition-colors group cursor-pointer"
                              title={`Открыть: ${proj.path}`}
                            >
                              <div className="flex flex-col min-w-0 flex-1 text-left mr-2">
                                <span className="truncate font-semibold text-zinc-200 group-hover:text-indigo-300 transition-colors">
                                  {proj.name}
                                </span>
                                {proj.path && (
                                  <span className="truncate text-[10px] text-zinc-500 font-mono">
                                    {proj.path}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <Play className="w-3.5 h-3.5 text-indigo-400 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                                {handleRemoveRecentProject && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemoveRecentProject(proj.path);
                                    }}
                                    className="p-1 hover:text-rose-400 text-zinc-500 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Удалить из списка"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="h-6 w-px bg-white/10 mx-2" />

          <button 
            onClick={() => setShowHotkeys(true)}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors text-zinc-400 hover:text-white"
            title="Горячие клавиши"
          >
            <Keyboard className="w-5 h-5" />
          </button>
          <button 
            onClick={toggleSettings}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors text-zinc-400 hover:text-white"
            title="Настройки проекта"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <AnimatePresence>
        {showHotkeys && <HotkeyHints onClose={() => setShowHotkeys(false)} keyMap={project?.audioSettings?.keyMap} />}
        {showImportModal && <ImportModal onClose={() => setShowImportModal(false)} options={importOptions} />}
      </AnimatePresence>
    </>
  );
};

export default Header;
