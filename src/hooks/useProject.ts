import { useState, useEffect } from 'react';
import { Project } from '../types';
import { logger } from '../lib/logger';
import { safeConfirm, getGlobalAudioSettings, getSafeFileUrl } from '../lib/utils';

const sanitizeProjectData = (p: Project): Project => {
  if (!p || !p.tracks) return p;
  return {
    ...p,
    tracks: (p.tracks || []).map(track => {
      let cleanVolume = track.volume;
      if (cleanVolume === undefined) {
        cleanVolume = 0;
      }

      return {
        ...track,
        volume: cleanVolume,
        segments: (track.segments || []).map(seg => {
          let cleanUrl = seg.blobUrl;
          if (seg.filePath) {
            cleanUrl = getSafeFileUrl(seg.filePath) || cleanUrl;
          } else if (cleanUrl && cleanUrl.startsWith('safe-file://')) {
            const extractedPath = cleanUrl.replace(/^safe-file:\/\/\/?/, '');
            const decoded = decodeURIComponent(extractedPath);
            cleanUrl = getSafeFileUrl(decoded) || cleanUrl;
          }

          let cleanGain = seg.gain;
          if (cleanGain === undefined) {
            cleanGain = 0;
          }

          return {
            ...seg,
            blobUrl: cleanUrl,
            gain: cleanGain
          };
        })
      };
    })
  };
};

export const useProject = () => {
  const [project, setProject] = useState<Project | null>(null);
  const [recentProjects, setRecentProjects] = useState<{ name: string; path: string }[]>(() => {
    try {
      const saved = localStorage.getItem('dubstudio_recent_projects');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      logger.error(`Failed to load recent projects from localStorage: ${e}`);
    }
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem('dubstudio_recent_projects', JSON.stringify(recentProjects));
    } catch (e) {
      logger.error(`Failed to save recent projects to localStorage: ${e}`);
    }
  }, [recentProjects]);


  const handleNewProject = async () => {
    if (!window.electronAPI) {
      alert("Эта функция доступна только в десктопном приложении.");
      return;
    }
    logger.info("Initializing new project creation...");
    try {
      const folderRes = await window.electronAPI.openFolder();
      if (folderRes.success && folderRes.data) {
        const folder = folderRes.data;
        logger.info(`Creating new project in folder: ${folder}`);
        await window.electronAPI.initProject(folder);
        const newProject: Project = {
          id: Math.random().toString(36).substr(2, 9),
          name: 'Новый проект',
          projectPath: folder,
          subtitles: [],
          roles: [],
          tracks: [
            { id: 'track-1', name: 'Дорога 1', segments: [], volume: 0, isMuted: false },
            { id: 'track-2', name: 'Дорога 2', segments: [], volume: 0, isMuted: false }
          ],
          latencyOffset: 0,
          audioOffsetMs: 0,
          audioSettings: getGlobalAudioSettings()
        };
        setProject(newProject);
        await window.electronAPI.saveProjectJson({ projectPath: folder, projectData: newProject });
        setRecentProjects(prev => [...prev, { name: newProject.name, path: folder }]);
        logger.info("New project created and saved.");
      }
    } catch (error) {
      logger.error('Failed to create new project:', error);
      alert(`Ошибка при создании проекта: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleOpenProject = async () => {
    if (!window.electronAPI) {
      alert("Эта функция доступна только в десктопном приложении.");
      return;
    }
    logger.info("Opening project...");
    try {
      const fileRes = await window.electronAPI.openFile({
        title: 'Выберите файл проекта',
        filters: [{ name: 'Dub Studio Project', extensions: ['dub'] }]
      });
      if (fileRes.success && fileRes.data) {
        const filePath = fileRes.data.path;
        logger.info(`Selected project file: ${filePath}`);
        const projectDataRes = await window.electronAPI.loadProjectJson(filePath);
        if (projectDataRes.success && projectDataRes.data) {
          logger.info(`Project data loaded successfully, sanitizing...`);
          const projectData = sanitizeProjectData(projectDataRes.data);
          projectData.audioSettings = { ...getGlobalAudioSettings(), ...projectData.audioSettings };
          logger.info(`Project loaded: ${projectData.name}, tracks: ${projectData.tracks?.length || 0}`);
          setProject(projectData);
          setRecentProjects(prev => {
            const path = projectData.projectPath || filePath;
            const filtered = prev.filter(p => p.path !== path);
            return [...filtered, { name: projectData.name, path }];
          });
        } else {
          logger.warn(`Project file load failed: ${projectDataRes.error}`);
          alert("Не удалось загрузить проект.");
        }
      } else {
        logger.info("Project open dialog cancelled or failed.");
      }
    } catch (error) {
      logger.error(`Failed to open project: ${error}`);
      alert(`Ошибка при открытии проекта: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleSaveProject = async () => {
    if (!project || !project.projectPath) {
      logger.warn("handleSaveProject: project or projectPath is missing.");
      alert("Проект не сохранен на диске. Используйте 'Создать проект'.");
      return;
    }
    if (window.electronAPI) {
      logger.info(`Saving project (useProject): ${project.name} to ${project.projectPath}`);
      try {
        await window.electronAPI.saveProjectJson({ projectPath: project.projectPath, projectData: project });
        alert("Проект сохранен!");
        logger.info("Project save (useProject) successful.");
      } catch (error) {
        logger.error(`Failed to save project (useProject): ${error}`);
        alert(`Ошибка при сохранении проекта: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  const onLoadProject = async (path: string) => {
    if (window.electronAPI) {
      logger.info(`Loading project from fixed path: ${path}`);
      try {
        const projectDataRes = await window.electronAPI.loadProjectJson(path);
        if (projectDataRes.success && projectDataRes.data) {
          logger.info(`Project data loaded from fixed path, sanitizing...`);
          const projectData = sanitizeProjectData(projectDataRes.data);
          projectData.audioSettings = { ...getGlobalAudioSettings(), ...projectData.audioSettings };
          logger.info(`Project loaded: ${projectData.name}, tracks: ${projectData.tracks?.length || 0}`);
          setProject(projectData);
          setRecentProjects(prev => {
            const filtered = prev.filter(p => p.path !== path);
            return [...filtered, { name: projectData.name, path }];
          });
        } else {
          logger.warn(`Project file load failed from fixed path: ${projectDataRes.error}`);
        }
      } catch (error) {
        logger.error(`Exception during onLoadProject: ${error}`);
      }
    }
  };

  const handleCloseProject = async () => {
    if (project) {
      const confirmed = await safeConfirm("Вы уверены, что хотите закрыть текущий проект?", true);
      if (confirmed) {
        setProject(null);
        logger.info("Project closed by user.");
      }
    }
  };

  return {
    project,
    setProject,
    recentProjects,
    handleNewProject,
    handleOpenProject,
    handleSaveProject,
    handleCloseProject,
    onLoadProject
  };
};
