import React from 'react';
import Header from '../Header';
import { useProjectData } from '../../contexts/ProjectContext';
import { safeConfirm } from '../../lib/utils';
import { relocateProjectToChosenFolder, buildProjectFolderPath } from '../../lib/projectRelocation';

// ... interface TopHeaderProps ...
interface TopHeaderProps {
  showProjectMenu: boolean;
  setShowProjectMenu: (v: boolean) => void;
  handleSelectVideo: () => void;
  handleSelectSubs: () => void;
  handleSelectDocument: () => void;
  handleSelectReferenceAudio: () => void;
  handleMergeBackstage: () => void;
  setShowQuickImport: (v: boolean) => void;
  setShowFixImport: (v: boolean) => void;
  handleBulkImport: () => void;
  handleGameDubbingImport?: () => void;
  handleImportAudio?: () => void;
  isDesktop: boolean;
  handleExport: (format: 'WAV' | 'MP3' | 'FLAC') => void;
  handleBatchExport: () => void;
  handleMuxVideo: () => void;
  handleExportAudioBook: () => void;
  handleExportStems: () => void;
  handleExportAllStemsZip: () => void;
  onOpenBackstageEditor: () => void;
  isBackstageSessionRecording?: boolean;
  hasBackstageSessions?: boolean;
  setIsExporting: (v: boolean) => void;
  setExportOperation: (o: string) => void;
  onOpenCastingModal?: () => void;
  onOpenDocumentModal?: () => void;
  onUpdateDubberNick?: (nick: string) => void;
}

export const TopHeader: React.FC<TopHeaderProps> = (props) => {
  const { 
    project, 
    setProject, 
    recentProjects, 
    addRecentProject,
    removeRecentProject, 
    clearRecentProjects, 
    handleNewProject, 
    handleOpenProject, 
    handleSaveProject, 
    handleCloseProject, 
    onLoadProject 
  } = useProjectData();

  const handleSelectProjectFolder = async () => {
    if (!window.electronAPI || !project) return;
    const newFolder = await window.electronAPI.openFolder();
    if (!newFolder.success || !newFolder.data) return;

    const oldPath = project.projectPath && project.projectPath !== '/mock/path' ? project.projectPath : '';
    const targetProjectPath = buildProjectFolderPath(newFolder.data, project.name);
    if (oldPath && oldPath.replace(/\\/g, '/') === targetProjectPath.replace(/\\/g, '/')) {
      return;
    }

    const confirmMessage = oldPath
      ? `Вы уверены, что хотите перенести все файлы проекта в новую папку?\nИз: ${oldPath}\nВ: ${targetProjectPath}`
      : `Создать папку проекта и сохранить все файлы в:\n${targetProjectPath}?`;

    if (await safeConfirm(confirmMessage)) {
      props.setExportOperation('Перенос и сохранение файлов проекта...');
      props.setIsExporting(true);
      try {
        const res = await relocateProjectToChosenFolder({
          project,
          chosenParentDir: newFolder.data,
          onStatus: (msg) => props.setExportOperation(msg)
        });
        if (res.success && res.updatedProject && res.newProjectRoot) {
          setProject(res.updatedProject);
          addRecentProject(res.updatedProject.name, res.newProjectRoot);
        } else {
          alert(`Ошибка при переносе проекта: ${res.error}`);
        }
      } catch (err) {
        alert('Критическая ошибка при перемещении файлов проекта.');
      } finally {
        props.setIsExporting(false);
        props.setExportOperation('');
      }
    }
  };

  const handleOpenProjectFolder = async () => {
    if (window.electronAPI && project?.projectPath) {
      await window.electronAPI.openPath(project.projectPath);
    }
  };

  const handleSelectBackstageFolder = async () => {
    if (window.electronAPI) {
      const folder = await window.electronAPI.openFolder();
      if (folder && folder.data && project) {
        const settings = project.audioSettings || {};
        setProject({
          ...project,
          audioSettings: { ...settings, backstageFolderPath: folder.data }
        });
      }
    }
  };

  return (
    <Header 
      project={project}
      recentProjects={recentProjects}
      showProjectMenu={props.showProjectMenu}
      setShowProjectMenu={props.setShowProjectMenu}
      handleNewProject={handleNewProject}
      handleOpenProject={handleOpenProject}
      handleSaveProject={handleSaveProject}
      handleCloseProject={handleCloseProject}
      handleSelectProjectFolder={handleSelectProjectFolder}
      handleOpenProjectFolder={handleOpenProjectFolder}
      handleSelectBackstageFolder={handleSelectBackstageFolder}
      handleSelectVideo={props.handleSelectVideo}
      handleSelectSubs={props.handleSelectSubs}
      handleSelectDocument={props.handleSelectDocument}
      handleSelectReferenceAudio={props.handleSelectReferenceAudio}
      handleMergeBackstage={props.handleMergeBackstage}
      setShowQuickImport={props.setShowQuickImport}
      setShowFixImport={props.setShowFixImport}
      handleBulkImport={props.handleBulkImport}
      handleGameDubbingImport={props.handleGameDubbingImport}
      handleImportAudio={props.handleImportAudio}
      isDesktop={props.isDesktop}
      handleExport={props.handleExport}
      onOpenBackstageEditor={props.onOpenBackstageEditor}
      isBackstageSessionRecording={props.isBackstageSessionRecording}
      hasBackstageSessions={props.hasBackstageSessions}
      handleBatchExport={props.handleBatchExport}
      handleMuxVideo={props.handleMuxVideo}
      handleExportAudioBook={props.handleExportAudioBook}
      handleExportStems={props.handleExportStems}
      handleExportAllStemsZip={props.handleExportAllStemsZip}
      onLoadProject={onLoadProject}
      handleRemoveRecentProject={removeRecentProject}
      handleClearRecentProjects={clearRecentProjects}
      onOpenCastingModal={props.onOpenCastingModal}
      onOpenDocumentModal={props.onOpenDocumentModal}
      onUpdateDubberNick={props.onUpdateDubberNick}
    />
  );
};

export default TopHeader;
