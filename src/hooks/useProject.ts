import { useState, useEffect, useCallback } from 'react';
import { Project } from '../types';
import { logger } from '../lib/logger';
import { safeConfirm, getGlobalAudioSettings, getSafeFileUrl } from '../lib/utils';

const sanitizeProjectData = (p: Project): Project => {
  if (!p || !p.tracks) return p;
  let cleanVideoUrl = p.videoUrl;
  if (p.videoPath && !p.videoPath.startsWith('blob:') && !p.videoPath.startsWith('http')) {
    cleanVideoUrl = getSafeFileUrl(p.videoPath) || cleanVideoUrl;
  }
  return {
    ...p,
    videoUrl: cleanVideoUrl,
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

export interface RecentProjectItem {
  name: string;
  path: string;
  updatedAt?: number;
}

export const useProject = () => {
  const [project, setProject] = useState<Project | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProjectItem[]>(() => {
    try {
      const saved = localStorage.getItem('dubstudio_recent_projects');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Normalize items, backfill updatedAt for legacy entries, and sort newest first
          return parsed.map((item, idx) => ({
            name: (item.name || 'Проект').trim(),
            path: (item.path || item.name || '').trim(),
            updatedAt: item.updatedAt || (Date.now() - idx * 60000)
          })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        }
      }
    } catch (e) {
      logger.error(`Failed to load recent projects from localStorage: ${e}`);
    }
    return [];
  });

  const addRecentProject = useCallback((name: string, path: string) => {
    if (!name && !path) return;
    const cleanName = (name || 'Проект').trim();
    const cleanPath = (path || cleanName).trim();
    setRecentProjects(prev => {
      // Filter out existing matching entries
      const filtered = prev.filter(p => p.path !== cleanPath && p.name !== cleanName);
      // Place newest/freshest project at the TOP (index 0)
      const updated = [{ name: cleanName, path: cleanPath, updatedAt: Date.now() }, ...filtered].slice(0, 15);
      try {
        localStorage.setItem('dubstudio_recent_projects', JSON.stringify(updated));
      } catch (e) {
        logger.error(`Failed to save recent projects to localStorage: ${e}`);
      }
      return updated;
    });
  }, []);

  const removeRecentProject = useCallback((path: string) => {
    setRecentProjects(prev => {
      const updated = prev.filter(p => p.path !== path);
      try {
        localStorage.setItem('dubstudio_recent_projects', JSON.stringify(updated));
      } catch (e) {
        logger.error(`Failed to update recent projects in localStorage: ${e}`);
      }
      return updated;
    });
  }, []);

  const clearRecentProjects = useCallback(() => {
    setRecentProjects([]);
    try {
      localStorage.removeItem('dubstudio_recent_projects');
    } catch (e) {
      logger.error(`Failed to clear recent projects in localStorage: ${e}`);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('dubstudio_recent_projects', JSON.stringify(recentProjects));
    } catch (e) {
      logger.error(`Failed to save recent projects to localStorage: ${e}`);
    }
  }, [recentProjects]);

  const handleNewProject = async () => {
    logger.info("Initializing new project creation...");
    try {
      let folder = '';
      if (window.electronAPI) {
        const folderRes = await window.electronAPI.openFolder();
        if (folderRes.success && folderRes.data) {
          folder = folderRes.data;
        }
      }
      if (!folder) {
        folder = `/projects/Проект_${new Date().toISOString().slice(0, 10)}_${Math.random().toString(36).substr(2, 4)}`;
      }
      logger.info(`Creating new project in folder: ${folder}`);
      if (window.electronAPI) {
        await window.electronAPI.initProject(folder);
      }
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
      if (window.electronAPI) {
        await window.electronAPI.saveProjectJson({ projectPath: folder, projectData: newProject });
      }
      addRecentProject(newProject.name, folder);
      logger.info("New project created and saved.");
    } catch (error) {
      logger.error('Failed to create new project:', error);
      alert(`Ошибка при создании проекта: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleOpenProject = async () => {
    if (!window.electronAPI) {
      alert("API для открытия файлов недоступно");
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
        let projectData: any = null;
        // Always prefer loadProjectJson first so moved folder paths are relocalized & takes are relinked on disk
        const projectDataRes = await window.electronAPI.loadProjectJson(filePath);
        if (projectDataRes.success && projectDataRes.data) {
          projectData = projectDataRes.data;
        } else if (fileRes.data.content) {
          try {
            projectData = JSON.parse(fileRes.data.content);
          } catch (_) {}
        }
        if (projectData) {
          logger.info(`Project data loaded successfully, sanitizing...`);
          const sanitized = sanitizeProjectData(projectData);
          sanitized.audioSettings = { ...getGlobalAudioSettings(), ...sanitized.audioSettings };
          logger.info(`Project loaded: ${sanitized.name}, tracks: ${sanitized.tracks?.length || 0}`);
          setProject(sanitized);
          addRecentProject(sanitized.name, sanitized.projectPath || filePath);
        } else {
          logger.warn(`Project file load failed for ${filePath}`);
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
    if (!project) {
      alert("Нет открытого проекта для сохранения.");
      return;
    }
    const targetPath = project.projectPath || `/projects/${project.name || 'Проект'}`;
    if (window.electronAPI) {
      logger.info(`Saving project (useProject): ${project.name} to ${targetPath}`);
      try {
        await window.electronAPI.saveProjectJson({ projectPath: targetPath, projectData: { ...project, projectPath: targetPath } });
        addRecentProject(project.name, targetPath);
        alert("Проект сохранен!");
        logger.info("Project save (useProject) successful.");
      } catch (error) {
        logger.error(`Failed to save project (useProject): ${error}`);
        alert(`Ошибка при сохранении проекта: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  const onLoadProject = useCallback(async (path: string) => {
    if (window.electronAPI) {
      logger.info(`Loading project from path: ${path}`);
      try {
        const projectDataRes = await window.electronAPI.loadProjectJson(path);
        if (projectDataRes.success && projectDataRes.data) {
          logger.info(`Project data loaded from fixed path, sanitizing...`);
          const projectData = sanitizeProjectData(projectDataRes.data);
          projectData.audioSettings = { ...getGlobalAudioSettings(), ...projectData.audioSettings };
          logger.info(`Project loaded: ${projectData.name}, tracks: ${projectData.tracks?.length || 0}`);
          setProject(projectData);
          addRecentProject(projectData.name, projectData.projectPath || path);
        } else {
          logger.warn(`Project file load failed from fixed path: ${projectDataRes.error}`);
          alert(`Не удалось открыть проект: ${projectDataRes.error || 'Файл не найден'}`);
        }
      } catch (error) {
        logger.error(`Exception during onLoadProject: ${error}`);
        alert(`Ошибка при открытии проекта: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }, [addRecentProject]);

  const onLoadProjectFromFile = useCallback(async (file: File) => {
    const filePath = (file as any).path;
    if (filePath && window.electronAPI) {
      await onLoadProject(filePath);
      return;
    }
    try {
      const content = await file.text();
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        if (window.electronAPI && parsed.projectPath) {
          const diskRes = await window.electronAPI.loadProjectJson(parsed.projectPath);
          if (diskRes.success && diskRes.data) {
            const sanitizedDisk = sanitizeProjectData(diskRes.data);
            sanitizedDisk.audioSettings = { ...getGlobalAudioSettings(), ...sanitizedDisk.audioSettings };
            setProject(sanitizedDisk);
            addRecentProject(sanitizedDisk.name, sanitizedDisk.projectPath || parsed.projectPath);
            return;
          }
        }
        const fallbackName = file.name.replace(/\.dub$/i, '');
        const sanitized = sanitizeProjectData({
          ...parsed,
          name: parsed.name || fallbackName,
          tracks: parsed.tracks || [],
          subtitles: parsed.subtitles || [],
          roles: parsed.roles || []
        });
        sanitized.audioSettings = { ...getGlobalAudioSettings(), ...sanitized.audioSettings };
        setProject(sanitized);
        addRecentProject(sanitized.name, sanitized.projectPath || fallbackName);
      } else {
        alert("Не удалось загрузить проект: неверный формат файла .dub");
      }
    } catch (error) {
      logger.error(`Failed to load dropped .dub file: ${error}`);
      alert(`Ошибка при открытии файла проекта (.dub): ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [onLoadProject, addRecentProject]);

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
    addRecentProject,
    removeRecentProject,
    clearRecentProjects,
    handleNewProject,
    handleOpenProject,
    handleSaveProject,
    handleCloseProject,
    onLoadProject,
    onLoadProjectFromFile
  };
};
