import { Project, AudioSegment } from '../types';
import { logger } from '../lib/logger';
import { getFriendlyExportErrorMessage, getTrackLinearVolume, getSegmentLinearGain, safeConfirm } from '../lib/utils';
import { buildCleanExportFilename } from '../lib/filenameUtils';

export function useAppExport(
  project: Project | null,
  setIsExporting: (v: boolean) => void,
  setExportProgress: (v: number) => void,
  setExportOperation: (v: string) => void,
  setIsExportModalOpen: (v: boolean) => void,
  isRecording: boolean,
  selectedSegmentIds: string[]
) {
  const handleBatchExport = async () => {
    if (!project || !project.projectPath || !window.electronAPI) {
      logger.warn("Batch Export cancelled: Project or API not ready.");
      return;
    }
    
    logger.info(`Batch Export started for project: ${project.name}`);

    // 1. Identify original reference track
    const origTrack = project.tracks.find(t => t.name === 'Оригинал' || t.name === 'Original');
    if (!origTrack) {
      alert("Не найден оригинальный трек ('Оригинал') для определения временных интервалов и имен игровых реплик.");
      return;
    }

    // Accidental split mitigation: group segments on the reference track by duplicate `originalFileName`.
    const origGroupedMap = new Map<string, typeof origTrack.segments>();
    for (const s of origTrack.segments) {
      if (s.originalFileName) {
        let list = origGroupedMap.get(s.originalFileName);
        if (!list) {
          list = [];
          origGroupedMap.set(s.originalFileName, list);
        }
        list.push(s);
      }
    }

    const origSegments = [];
    for (const [fileName, segs] of origGroupedMap.entries()) {
      // Sort segments of this original file chronologically just in case
      segs.sort((a, b) => a.startTime - b.startTime);

      const minStartTime = Math.min(...segs.map(s => s.startTime));
      const maxEndTime = Math.max(...segs.map(s => s.startTime + s.duration));
      
      const spanDuration = maxEndTime - minStartTime;

      // Extract original file duration from the properties of the imported segment pieces
      const fileDuration = segs.find(s => s.fileDuration !== undefined && s.fileDuration > 0)?.fileDuration || 0;

      // Search matching subtitle line duration
      const matchingSub = project.subtitles.find(sub => 
        (sub.role === 'Original' || sub.role === 'original') && 
        Math.abs(sub.start - minStartTime) < 0.2
      );
      const subDuration = matchingSub ? (matchingSub.end - matchingSub.start) : 0;

      // Determine authoritative duration using precise priority
      let finalDuration = fileDuration;
      let durationSource = "оригинальному файлу";

      if (finalDuration <= 0) {
        finalDuration = subDuration;
        durationSource = "субтитрам";
      }
      if (finalDuration <= 0) {
        finalDuration = spanDuration;
        durationSource = "таймлайну (длине выделения)";
      }

      logger.info(`Пакетный экспорт [${fileName}]: реплика начинается с ${minStartTime.toFixed(4)}с. Длины: по таймлайну=${spanDuration.toFixed(4)}с, по файлу=${fileDuration.toFixed(4)}с, по сабам=${subDuration.toFixed(4)}с. Итоговая длина: ${finalDuration.toFixed(4)}с (выбрано по ${durationSource}).`);

      origSegments.push({
        startTime: minStartTime,
        duration: finalDuration,
        originalFileName: fileName
      });
    }

    if (origSegments.length === 0) {
      alert("Не найдено оригинальных сегментов реплик с информацией об имени файла на треке 'Оригинал'.");
      return;
    }

    // 2. Collect all active recorded dub segments across other tracks
    const dubTracks = project.tracks.filter(t => t.id !== origTrack.id && !t.isMuted);
    const dubSegmentsList = [];

    for (const track of dubTracks) {
      for (const segment of track.segments) {
        if (segment.filePath) {
          dubSegmentsList.push({
            filePath: segment.filePath,
            startTime: segment.startTime,
            duration: segment.duration,
            fileOffset: segment.fileOffset || 0,
            gain: getSegmentLinearGain(segment.gain),
            playbackRate: segment.playbackRate ?? 1
          });
        }
      }
    }

    if (dubSegmentsList.length === 0) {
      const confirmSilence = await safeConfirm("На дорожках дубляжа не обнаружено записанных фрагментов. Экспортировать пустые аудиофайлы (тишину) оригинальной длины с исходными именами?", false);
      if (!confirmSilence) return;
    }

    // 3. Ask destination folder
    const folderRes = await window.electronAPI.openFolder();
    if (!folderRes.success || !folderRes.data) return;
    const outDir = folderRes.data;

    setIsExporting(true);
    setExportProgress(0);
    setExportOperation(`Сборка и рендеринг ${origSegments.length} реплик...`);

    try {
      logger.info(`Starting batch render-export of ${origSegments.length} replicas to ${outDir}`);
      const exportedFilesRes = await window.electronAPI.batchExport({
        outDir,
        origSegments,
        dubSegments: dubSegmentsList,
      });

      if (exportedFilesRes.success && exportedFilesRes.data) {
        alert(`Успешно рендерировано и экспортировано ${exportedFilesRes.data.length} файлов в папку: ${outDir}\nВсе файлы соответствуют точной длине и именам оригиналов!`);
        logger.info("Batch render export successful.");
      } else {
        const errorMsg = getFriendlyExportErrorMessage(exportedFilesRes.error, "Пакетный рендеринг и экспорт реплик", outDir);
        alert(errorMsg);
        logger.error("Batch render export failed:", exportedFilesRes.error);
      }
    } catch (error) {
      console.error("Batch render export failed:", error);
      const errorMsg = getFriendlyExportErrorMessage(error, "Пакетный рендеринг и экспорт реплик", outDir);
      alert(errorMsg);
    } finally {
      setIsExporting(false);
      setExportOperation('');
    }
  };

  const handleExportAudioBook = async (gapSeconds: number = 1.5) => {
    if (!project || !project.projectPath || !window.electronAPI) return;
    const dubTrack = project.tracks.find(t => t.name === 'Dubs');
    if (!dubTrack || dubTrack.segments.length === 0) {
      alert("Не найдено фрагментов Dubs для экспорта.");
      return;
    }

    const activeRoles = project.selectedRoles && project.selectedRoles.length > 0
      ? project.selectedRoles
      : (project.selectedRole ? [project.selectedRole] : []);
    const dubberNick = project.dubberNick || localStorage.getItem('dubstudio_dubber_nick') || '';

    const defaultAudiobookName = buildCleanExportFilename({
      dubberNick,
      activeRoles,
      projectName: project.name,
      suffix: 'audiobook',
      extension: 'wav'
    });

    const saveRes = await window.electronAPI.saveFile({
        title: 'Экспорт аудиокниги',
        defaultPath: defaultAudiobookName,
        filters: [{ name: 'Audio', extensions: ['wav'] }]
    });

    if (!saveRes.success || !saveRes.data) return;
    const outputPath = saveRes.data;

    setIsExporting(true);
    setExportProgress(0);
    setExportOperation('Preparing audiobook segments...');
    
    try {
      logger.info(`Starting audiobook export to ${outputPath}`);
      const resultRes = await window.electronAPI.exportAudioBook({
        projectPath: project.projectPath,
        outputPath: outputPath,
        format: 'wav',
        gapDuration: gapSeconds,
        normalizeLUFS: true,
        segments: dubTrack.segments.filter(s => s.filePath).map(s => ({
          filePath: s.filePath!,
          gain: getSegmentLinearGain(s.gain) * getTrackLinearVolume(dubTrack.volume)
        }))
      });

      if (resultRes.success && resultRes.data) {
        alert(`Аудиокнига успешно экспортирована: ${outputPath}`);
        logger.info("Audiobook export successful.");
      } else {
        const errorMsg = getFriendlyExportErrorMessage(resultRes.error, "Экспорт проекта в формате Аудиокниги", outputPath);
        alert(errorMsg);
        logger.error("Audiobook export failed:", resultRes.error);
      }
    } catch (error) {
      console.error("Audio Book export failed:", error);
      const errorMsg = getFriendlyExportErrorMessage(error, "Экспорт проекта в формате Аудиокниги", outputPath);
      alert(errorMsg);
    } finally {
      setIsExporting(false);
      setExportOperation('');
    }
  };

  const handleExportStems = async () => {
    if (!project || !project.projectPath || !window.electronAPI) return;
    
    const folderRes = await window.electronAPI.openFolder();
    if (!folderRes.success || !folderRes.data) return;
    const outDir = folderRes.data;

    setIsExporting(true);
    setExportProgress(0);
    setExportOperation('Initializing stem export...');

    const unsubscribe = window.electronAPI.onStemProgress((data) => {
      const pct = (data.current / data.total) * 100;
      setExportProgress(pct);
      setExportOperation(`Stem ${data.current}/${data.total}: ${data.trackName}`);
    });

    try {
      logger.info(`Starting stem export to ${outDir}`);
      const resultRes = await window.electronAPI.exportStems({
        projectData: {
          tracks: project.tracks.map(t => ({
            name: t.name,
            isMuted: t.isMuted,
            isSolo: t.isSolo,
            volume: 1.0, // Громкость дорожки при экспорте стемов не применяется
            segments: t.segments.map(s => ({
              id: s.id,
              startTime: s.startTime,
              duration: s.duration,
              filePath: s.filePath,
              gain: getSegmentLinearGain(s.gain),
              fileOffset: s.fileOffset || 0,
              playbackRate: s.playbackRate
            }))
          })),
          audioOffsetMs: project.audioOffsetMs || 0
        },
        outputDir: outDir,
        bitDepth: project.audioSettings?.bitDepth?.toString() || '16'
      });
      if (resultRes.success) {
        alert(`Экспорт стемов завершен в папку: ${outDir}`);
        logger.info("Stem export successful.");
      } else {
        const errorMsg = getFriendlyExportErrorMessage(resultRes.error, "Раздельный экспорт дорожек (Стемы)", outDir);
        alert(errorMsg);
        logger.error("Stem export failed:", resultRes.error);
      }
    } catch (error) {
      console.error("Stem export failed:", error);
      const errorMsg = getFriendlyExportErrorMessage(error, "Раздельный экспорт дорожек (Стемы)", outDir);
      alert(errorMsg);
    } finally {
      unsubscribe();
      setIsExporting(false);
      setExportOperation('');
    }
  };

  const handleExportAllStemsZip = async () => {
    if (!project || !project.id || !window.electronAPI) return;
    
    const activeRoles = project.selectedRoles && project.selectedRoles.length > 0
      ? project.selectedRoles
      : (project.selectedRole ? [project.selectedRole] : []);
    const dubberNick = project.dubberNick || localStorage.getItem('dubstudio_dubber_nick') || '';

    const defaultZipName = buildCleanExportFilename({
      dubberNick,
      activeRoles,
      projectName: project.name,
      suffix: 'stems',
      extension: 'zip'
    });

    const saveRes = await window.electronAPI.saveFile({
        title: 'Экспорт всех дорожек в ZIP',
        defaultPath: defaultZipName,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
    });

    if (!saveRes.success || !saveRes.data) return;
    const outputPath = saveRes.data;

    setIsExporting(true);
    setExportProgress(0);
    setExportOperation('Saving project...');
    await window.electronAPI.saveProjectJson({ projectPath: project.projectPath || '', projectData: project });

    setExportOperation('Exporting all tracks as ZIP...');

    try {
      logger.info(`Starting all stems ZIP export to ${outputPath}`);
      const resultRes = await window.electronAPI.exportAllStems({
        projectId: project.id,
        projectName: project.name || 'Project',
        outputPath: outputPath
      });
      if (resultRes.success) {
        alert(`Проект успешно упакован в ZIP: ${resultRes.data}`);
        logger.info("ZIP export successful.");
      } else {
        const errorMsg = getFriendlyExportErrorMessage(resultRes.error, "Упаковка проекта в ZIP-архив", outputPath);
        alert(errorMsg);
        logger.error("ZIP export failed:", resultRes.error);
      }
    } catch (error) {
      console.error("ZIP export failed:", error);
      const errorMsg = getFriendlyExportErrorMessage(error, "Упаковка проекта в ZIP-архив", outputPath);
      alert(errorMsg);
    } finally {
      setIsExporting(false);
      setExportOperation('');
    }
  };

  const handleExport = async (options: { 
    format: 'WAV' | 'MP3' | 'FLAC', 
    includeVideo: boolean, 
    includeOriginalAudio: boolean,
    forceMono: boolean,
    exportFolder?: string,
    customFileName?: string
  } ) => {
    logger.info("handleExport triggered with options:", options);
    if (!project || !project.projectPath) {
      alert("Настройте или сохраните проект перед экспортом.");
      return;
    }

    const { format, includeVideo, includeOriginalAudio, forceMono, exportFolder, customFileName } = options;
    const safeFormat = format || 'WAV';

    const exportTracks = project.tracks.filter(t => {
      if (t.name === 'Оригинал') return includeOriginalAudio;
      return !t.isMuted; // Only include unmuted tracks by default for export if requested
    }).map(track => ({
      id: track.id,
      volume: getTrackLinearVolume(track.volume),
      isMuted: track.isMuted,
      isSolo: track.isSolo,
      segments: track.segments.map(seg => ({
        id: seg.id || `seg-${Date.now()}-${Math.random()}`,
        filePath: seg.filePath || '',
        startTime: seg.startTime,
        duration: seg.duration,
        fileOffset: seg.fileOffset || 0,
        fileDuration: seg.fileDuration || seg.duration,
        gain: getSegmentLinearGain(seg.gain),
        playbackRate: seg.playbackRate,
      })).filter(s => s.filePath !== '')
    }));

    const hasSegments = exportTracks.some(t => t.segments.length > 0);

    if (!hasSegments) {
      alert("Нет сегментов (или все дорожки заглушены) для экспорта.");
      return;
    }
    
    let videoName = '';
    if (project.videoPath) {
      const base = project.videoPath.split(/[/\\]/).pop() || '';
      const extIdx = base.lastIndexOf('.');
      videoName = extIdx !== -1 ? base.substring(0, extIdx) : base;
    } else if (project.videoUrl) {
      const base = project.videoUrl.split('/').pop()?.split('?')[0] || '';
      const extIdx = base.lastIndexOf('.');
      videoName = extIdx !== -1 ? base.substring(0, extIdx) : base;
    }
    if (!videoName) {
      videoName = project.name || 'project';
    }

    let exportFileName = '';
    if (customFileName && customFileName.trim()) {
      exportFileName = customFileName.trim();
    } else {
      const activeRoles = project.selectedRoles && project.selectedRoles.length > 0
        ? project.selectedRoles
        : (project.selectedRole ? [project.selectedRole] : []);
      const hasLoadedFixes = !!(project.fixes && project.fixes.length > 0);
      const dubberNick = project.dubberNick || localStorage.getItem('dubstudio_dubber_nick') || '';

      exportFileName = buildCleanExportFilename({
        dubberNick,
        activeRoles,
        projectName: project.name,
        videoName,
        prefix: hasLoadedFixes ? 'fix' : '',
        extension: safeFormat.toLowerCase()
      });
    }

    let outputPath = '';
    
    if (exportFolder) {
      const sep = exportFolder.includes('\\') ? '\\' : '/';
      outputPath = `${exportFolder}${exportFolder.endsWith(sep) ? '' : sep}${exportFileName}`;
    } else {
      const saveFileRes = await window.electronAPI.saveFile({
        title: 'Export Audio',
        defaultPath: exportFileName,
        filters: [{ name: safeFormat, extensions: [safeFormat.toLowerCase()] }]
      });
      if (!saveFileRes.success || !saveFileRes.data) return;
      outputPath = saveFileRes.data;
    }

    setIsExporting(true);
    setExportProgress(0);
    setIsExportModalOpen(false);

    let unsubscribe: (() => void) | undefined;

    if (window.electronAPI) {
      unsubscribe = window.electronAPI.onExportProgress((percent) => {
        setExportProgress(percent);
      });

      try {
        logger.info(`Starting audio export to ${outputPath} in format ${safeFormat}`);
        const resultRes = await window.electronAPI.exportAudio({ 
          projectJson: JSON.stringify({
            tracks: exportTracks.map(t => ({
              name: project.tracks.find(pt => pt.id === t.id)?.name || 'Track',
              isMuted: t.isMuted,
              isSolo: t.isSolo,
              volume: t.volume, // Pass track volume!
              segments: t.segments
            })),
            audioOffsetMs: project.audioOffsetMs || 0
          }),
          outputPath,
          format: safeFormat.toLowerCase() as any,
          bitDepth: project.audioSettings?.bitDepth?.toString() || '16',
          ...(project.audioSettings?.exportSettings && {
            bitrate: `${project.audioSettings.exportSettings.mp3Bitrate}k`
          })
        });

        if (resultRes.success) {
          alert(`Экспорт успешно завершен: ${outputPath}`);
          logger.info("Audio export successful.");
        } else {
          throw new Error(resultRes.error || 'Unknown export error');
        }
      } catch (error) {
        console.error("Export failed:", error);
        const errorMsg = getFriendlyExportErrorMessage(error, `Экспорт аудио в формате ${safeFormat}`, outputPath);
        alert(errorMsg);
        logger.error("Audio export operation failed:", error);
      } finally {
        if (unsubscribe) unsubscribe();
        setIsExporting(false);
      }
      return;
    }
  };


  const handleMuxVideo = async () => {
    if (!project || !project.projectPath || !project.videoPath) {
      alert("Сначала настройте проект и выберите видео.");
      return;
    }

    let videoName = '';
    if (project.videoPath) {
      const base = project.videoPath.split(/[/\\]/).pop() || '';
      const extIdx = base.lastIndexOf('.');
      videoName = extIdx !== -1 ? base.substring(0, extIdx) : base;
    } else if (project.videoUrl) {
      const base = project.videoUrl.split('/').pop()?.split('?')[0] || '';
      const extIdx = base.lastIndexOf('.');
      videoName = extIdx !== -1 ? base.substring(0, extIdx) : base;
    }
    if (!videoName) {
      videoName = project.name || 'project';
    }

    const activeRoles = project.selectedRoles && project.selectedRoles.length > 0
      ? project.selectedRoles
      : (project.selectedRole ? [project.selectedRole] : []);
    const hasLoadedFixes = !!(project.fixes && project.fixes.length > 0);
    const dubberNick = project.dubberNick || localStorage.getItem('dubstudio_dubber_nick') || '';

    const exportFileName = buildCleanExportFilename({
      dubberNick,
      activeRoles,
      projectName: project.name,
      videoName,
      prefix: hasLoadedFixes ? 'fix' : '',
      suffix: 'final',
      extension: 'mp4'
    });

    const saveRes = await window.electronAPI.saveFile({
        title: 'Экспорт финального видео (Mix)',
        defaultPath: exportFileName,
        filters: [{ name: 'Video', extensions: ['mp4'] }]
    });

    if (!saveRes.success || !saveRes.data) return;
    const finalOutputPath = saveRes.data;
    
    setIsExporting(true);
    setExportProgress(0);
    setExportOperation('Initializing video mix...');

    if (window.electronAPI) {
      const unsubscribe = window.electronAPI.onExportProgress((percent) => {
        setExportProgress(percent);
      });

      try {
        const tempAudioPath = `${project.projectPath}/temp_master_mux.wav`.replace(/\\/g, '/');
        
        // 1. Export current mix to a temp WAV first, because muxing needs one.
        setExportOperation('Mixing project audio...');
        logger.info(`Mixing project audio to ${tempAudioPath}`);
        
        const audioRes = await window.electronAPI.exportAudio({ 
          projectJson: JSON.stringify({
            tracks: project.tracks.map(t => ({
              name: t.name,
              isMuted: t.isMuted,
              isSolo: t.isSolo,
              volume: getTrackLinearVolume(t.volume), // Pass linear track volume!
              segments: t.segments.map(s => ({
                id: s.id,
                filePath: s.filePath || '',
                startTime: s.startTime,
                duration: s.duration,
                fileOffset: s.fileOffset || 0,
                fileDuration: s.fileDuration || s.duration,
                gain: getSegmentLinearGain(s.gain), // Pass linear segment gain!
                playbackRate: s.playbackRate,
              }))
            })),
            audioOffsetMs: project.audioOffsetMs || 0
          }),
          outputPath: tempAudioPath,
          format: 'wav',
          bitDepth: '16'
        });

        if (!audioRes.success) {
          throw new Error(`Ошибка сведения аудио: ${audioRes.error}`);
        }

        // 2. Mux video with the newly created temp audio
        setExportOperation('Muxing video with audio...');
        logger.info(`Muxing video from ${project.videoPath} with audio ${tempAudioPath} to ${finalOutputPath}`);
        
        const resultRes = await window.electronAPI.muxVideo({ 
          videoPath: project.videoPath,
          audioPath: tempAudioPath,
          outputPath: finalOutputPath
        });

        if (resultRes.success) {
          alert(`Финальное видео успешно сохранено: ${finalOutputPath}`);
          logger.info("Video muxing successful.");
        } else {
          throw new Error(resultRes.error || 'Unknown mux error');
        }
      } catch (error) {
        console.error("Muxing failed:", error);
        const errorMsg = getFriendlyExportErrorMessage(error, "Финальное сведение видео с аудио (Mux Video)", finalOutputPath);
        alert(errorMsg);
        logger.error("Muxing failed:", error);
      } finally {
        unsubscribe();
        setIsExporting(false);
        setExportOperation('');
      }
      return;
    }
  };
  const handleMergeBackstage = async () => {
    if (!project || !project.projectPath || !window.electronAPI) return;

    // Collect all unique backstage video paths from all segments
    const videoPaths: string[] = [];
    project.tracks.forEach(track => {
      track.segments.forEach(seg => {
        if (seg.backstageVideoPath && !videoPaths.includes(seg.backstageVideoPath)) {
          videoPaths.push(seg.backstageVideoPath);
        }
      });
    });

    if (videoPaths.length === 0) {
      alert("Нет записанных бекстейдж-видео для объединения.");
      return;
    }

    const saveRes = await window.electronAPI.saveFile({
      title: 'Сохранить финальный бекстейдж',
      defaultPath: `${project.projectPath}/final_backstage.mp4`,
      filters: [{ name: 'Video', extensions: ['mp4'] }]
    });

    if (!saveRes.success || !saveRes.data) return;
    const finalOutputPath = saveRes.data;

    setIsExporting(true);
    setExportProgress(0);
    setExportOperation("Preparing backstage video...");
    
    try {
      logger.info(`Starting backstage merge for ${videoPaths.length} videos to ${finalOutputPath}`);
      
      const tempVideoPath = `${project.projectPath}/temp_backstage_concat.mp4`;
      const tempAudioPath = `${project.projectPath}/temp_backstage_audio.wav`;

      // 1. Concat all backstage videos
      setExportOperation("Concatenating backstage video...");
      logger.info(`Concatenating backstage videos to ${tempVideoPath}`);
      const concatRes = await window.electronAPI.concatBackstageVideos({
        videoPaths,
        outputPath: tempVideoPath
      });

      if (!concatRes.success) {
        throw new Error(`Ошибка при объединении видео: ${concatRes.error}`);
      }

      // 2. Export project audio (Original + Dubs)
      setExportOperation("Mixing project audio for backstage...");
      logger.info(`Mixing project audio for backstage to ${tempAudioPath}`);
      const audioRes = await window.electronAPI.exportAudio({
        projectJson: JSON.stringify({
          tracks: project.tracks.map(t => ({
            name: t.name,
            isMuted: t.isMuted,
            isSolo: t.isSolo,
            segments: t.segments
          })),
          audioOffsetMs: project.audioOffsetMs || 0
        }),
        outputPath: tempAudioPath,
        format: 'wav'
      });

      if (!audioRes.success) {
        throw new Error(`Ошибка при экспорте аудио: ${audioRes.error}`);
      }

      // 3. Mux video from (1) and audio from (2)
      if (project.videoPath && project.audioSettings?.webcamExportOverlay !== false) {
        setExportOperation("Applying backstage overlay on main video...");
        logger.info(`Applying backstage overlay onto ${project.videoPath} to ${finalOutputPath}`);
        const overlayRes = await window.electronAPI.exportBackstageVideo({
          mainVideoPath: project.videoPath,
          backstageVideoPath: tempVideoPath,
          finalAudioPath: tempAudioPath,
          outputPath: finalOutputPath,
          webcamExportOverlay: project.audioSettings?.webcamExportOverlay
        });
        
        if (overlayRes.success) {
          alert(`Бекстейдж успешно создан с проектным звуком: ${finalOutputPath}`);
          logger.info("Backstage merge successful.");
          // Clean up temp files
          await window.electronAPI.deleteFile(tempVideoPath);
          await window.electronAPI.deleteFile(tempAudioPath);
        } else {
          const errorMsg = getFriendlyExportErrorMessage(overlayRes.error, "Накложение веб-камеры бекстейджа на видео", finalOutputPath);
          alert(errorMsg);
          logger.error("Backstage overlay failed:", overlayRes.error);
        }
      } else {
        setExportOperation("Muxing video with project audio...");
        logger.info(`Muxing joined video with audio to ${finalOutputPath}`);
        const muxRes = await window.electronAPI.muxVideo({
          videoPath: tempVideoPath,
          audioPath: tempAudioPath,
          outputPath: finalOutputPath
        });

        if (muxRes.success) {
          alert(`Бекстейдж успешно создан с проектным звуком: ${finalOutputPath}`);
          logger.info("Backstage merge successful.");
          // Clean up temp files
          await window.electronAPI.deleteFile(tempVideoPath);
          await window.electronAPI.deleteFile(tempAudioPath);
        } else {
          const errorMsg = getFriendlyExportErrorMessage(muxRes.error, "Сведение бекстейдж-видео со звуком", finalOutputPath);
          alert(errorMsg);
          logger.error("Backstage mux failed:", muxRes.error);
        }
      }
    } catch (err) {
      const errorMsg = getFriendlyExportErrorMessage(err, "Объединение бекстейдж-материалов", finalOutputPath);
      alert(errorMsg);
      logger.error("Backstage merge operation failed:", err);
    } finally {
      setIsExporting(false);
      setExportProgress(100);
      setExportOperation("");
    }
  };

  const handleSaveBlooper = async () => {
    if (isRecording) {
      alert("Остановите запись (Пробел), чтобы сохранить этот дубль!");
      return;
    }

    if (!project || !project.projectPath || !project.videoPath || !window.electronAPI) {
      alert("Откройте проект и добавьте оригинальное видео.");
      return;
    }

    let targetSegment: AudioSegment | null = null;

    // Check if user has a segment selected
    if (selectedSegmentIds && selectedSegmentIds.length > 0) {
      for (const track of project.tracks) {
        if (track.name !== 'Оригинал') {
          const found = track.segments.find(s => selectedSegmentIds.includes(s.id));
          if (found) {
            targetSegment = found;
            break;
          }
        }
      }
    }

    // Otherwise, fallback to the latest recorded segment (or max start time if recordedAt is missing)
    if (!targetSegment) {
      let maxRecordedAt = -1;
      let maxStartTimeFallback = -1;

      for (const track of project.tracks) {
        if (track.name !== 'Оригинал') {
          for (const seg of track.segments) {
            // Priority 1: Use recordedAt if available
            if (seg.recordedAt !== undefined) {
              if (seg.recordedAt > maxRecordedAt) {
                maxRecordedAt = seg.recordedAt;
                targetSegment = seg;
              }
            } 
            // Priority 2: Fallback to startTime if no segments have recordedAt yet
            else if (maxRecordedAt === -1 && seg.startTime > maxStartTimeFallback) {
              maxStartTimeFallback = seg.startTime;
              targetSegment = seg;
            }
          }
        }
      }
    }

    if (!targetSegment || !targetSegment.filePath) {
      alert("Нет записанных реплик (сегментов) для сохранения дубля.");
      return;
    }

    let finalOutputPath: string | undefined;
    try {
      const defaultFilename = `LoL_${targetSegment.text ? targetSegment.text.substring(0, 15).replace(/[^a-zA-Zа-яА-Я0-9]/g, '_') : 'blooper'}.mp4`;
      const dialogRes = await window.electronAPI.saveFile({
        title: 'Сохранить неудачный дубль',
        defaultPath: `${project.projectPath}/${defaultFilename}`,
        filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
      });

      if (!dialogRes.success || !dialogRes.data) return; // cancelled

      finalOutputPath = dialogRes.data;

      setIsExporting(true);
      setExportOperation("Сохранение смешного дубля...");
      setExportProgress(0);

      const blooperStartTime = Math.max(0, targetSegment.startTime - 3.0);
      const blooperEndTime = targetSegment.startTime + targetSegment.duration + 1.0;
      
      const audioOffsetSec = (project.audioOffsetMs || 0) / 1000.0;
      const originalRecordTimelineStart = targetSegment.startTime - (targetSegment.fileOffset || 0) + audioOffsetSec;
      
      let audioDelay = 0;
      let audioTrimStart = 0;
      
      if (originalRecordTimelineStart > blooperStartTime) {
         audioDelay = originalRecordTimelineStart - blooperStartTime;
      } else {
         audioTrimStart = blooperStartTime - originalRecordTimelineStart;
      }

      const blooperRes = await window.electronAPI.exportBlooper({
        videoPath: project.videoPath,
        audioPath: targetSegment.filePath,
        startTime: blooperStartTime,
        endTime: blooperEndTime,
        audioDelay: audioDelay,
        audioTrimStart: audioTrimStart,
        outputPath: finalOutputPath
      });

      if (blooperRes.success) {
        alert(`Неудачный дубль сохранен: ${finalOutputPath}`);
      } else {
        const errorMsg = getFriendlyExportErrorMessage(blooperRes.error, "Сохранение неудачного дубля", finalOutputPath);
        alert(errorMsg);
      }
    } catch (e) {
      const errorMsg = getFriendlyExportErrorMessage(e, "Сохранение неудачного дубля", finalOutputPath);
      alert(errorMsg);
    } finally {
      setIsExporting(false);
      setExportProgress(100);
      setExportOperation("");
    }
  };

  const handleQuickPreview = async (segmentId: string) => {
    if (!project || !project.projectPath) {
      alert("Please save the project first.");
      return;
    }
    
    setIsExporting(true);
    setExportProgress(0);

    if (window.electronAPI) {
      const unsubscribe = window.electronAPI.onExportProgress((percent) => {
        setExportProgress(percent);
      });

      try {
        const result = await window.electronAPI.quickPreviewExport({ 
          projectPath: project.projectPath,
          segmentId
        });
        if (result) {
          alert(`Экспорт превью завершен: ${result}`);
        }
      } catch (error) {
        console.error("Quick Preview failed:", error);
        const errorMsg = getFriendlyExportErrorMessage(error, "Быстрый экспорт превью фрагмента");
        alert(errorMsg);
      } finally {
        unsubscribe();
        setIsExporting(false);
      }
      return;
    }
  };

  return {
    handleQuickPreview,
    handleMergeBackstage,
    handleSaveBlooper,
    handleBatchExport,
    handleExportAudioBook,
    handleExportStems,
    handleExportAllStemsZip,
    handleExport,
    handleMuxVideo
  };
}
