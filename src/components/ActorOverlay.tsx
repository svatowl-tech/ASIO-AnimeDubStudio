import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { cn } from '../lib/utils';
import { SubtitleLine, Project, TeleprompterMode } from '../types';
import Teleprompter from './Teleprompter';
import BackstageCamera from './BackstageCamera';
import { ScrollingWaveform } from './ScrollingWaveform';
import { useTeleprompterLayout } from './teleprompter/useTeleprompterLayout';

export const ActorOverlay = ({ 
  currentLine, 
  nextLine, 
  currentTime, 
  showWebcam, 
  webcamRef,
  isRecording,
  recordingStream,
  onClipping,
  subtitles = [],
  teleprompterMode = 'bottom',
  teleprompterFontSize,
  teleprompterLineHeight,
  teleprompterPacing,
  setTeleprompterFontSize,
  setTeleprompterLineHeight,
  setTeleprompterPacing,
  setTeleprompterMode,
  teleprompterPosition,
  setTeleprompterPosition,
  teleprompterSize,
  setTeleprompterSize,
  isAudiobook = false,
  isBackstageRecording = false,
  activeRole = '',
  project,
  onSettingsChange,
  onSeek,
  isWebcamSimulated,
  duration = 0,
  isPopout = false,
  previewStream
}: { 
  currentLine?: SubtitleLine, 
  nextLine?: SubtitleLine,
  currentTime: number,
  showWebcam: boolean,
  webcamRef: React.RefObject<HTMLVideoElement | null>,
  isRecording: boolean,
  recordingStream: MediaStream | null,
  previewStream?: MediaStream | null,
  onClipping?: (clipping: boolean) => void,
  subtitles?: SubtitleLine[],
  teleprompterMode: TeleprompterMode,
  teleprompterFontSize: number,
  teleprompterLineHeight: number,
  teleprompterPacing: 'auto' | 'manual',
  setTeleprompterFontSize: (s: number) => void,
  setTeleprompterLineHeight: (h: number) => void,
  setTeleprompterPacing: (p: 'auto' | 'manual') => void,
  setTeleprompterMode: (m: TeleprompterMode) => void,
  teleprompterPosition: { x: number, y: number },
  setTeleprompterPosition: (pos: { x: number, y: number }) => void,
  teleprompterSize: { width: number, height: number },
  setTeleprompterSize: (size: { width: number, height: number }) => void,
  isAudiobook?: boolean,
  isBackstageRecording?: boolean,
  activeRole?: string,
  project?: Project,
  onSettingsChange?: (settings: any) => void,
  onSeek?: (time: number) => void,
  isWebcamSimulated?: boolean,
  duration?: number,
  isPopout?: boolean
}) => {
  const overlayRootRef = useRef<HTMLDivElement>(null);
  const tpWrapperRef = useRef<HTMLDivElement>(null);

  const { containerStyle, motionAnimate } = useTeleprompterLayout(
    teleprompterMode,
    teleprompterSize,
    teleprompterPosition
  );
  const dragControls = useDragControls();

  const hasTeleprompter = subtitles.length > 0 || isAudiobook;

  // Automatically shift the sibling video viewport in all docked modes (left, right, top, bottom)
  useEffect(() => {
    const parentStage = overlayRootRef.current?.parentElement;
    if (!parentStage) return;

    const resetOffsets = () => {
      parentStage.style.setProperty('--tp-left', '0px');
      parentStage.style.setProperty('--tp-right', '0px');
      parentStage.style.setProperty('--tp-top', '0px');
      parentStage.style.setProperty('--tp-bottom', '0px');
    };

    if (!hasTeleprompter || teleprompterMode === 'compact' || teleprompterMode === 'expanded') {
      resetOffsets();
      return () => resetOffsets();
    }

    const updateOffsets = () => {
      const el = tpWrapperRef.current;
      if (!el) {
        resetOffsets();
        return;
      }
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      parentStage.style.setProperty('--tp-left', teleprompterMode === 'left' ? `${w}px` : '0px');
      parentStage.style.setProperty('--tp-right', teleprompterMode === 'right' ? `${w}px` : '0px');
      parentStage.style.setProperty('--tp-top', teleprompterMode === 'top' ? `${h}px` : '0px');
      parentStage.style.setProperty('--tp-bottom', teleprompterMode === 'bottom' ? `${h}px` : '0px');
    };

    updateOffsets();
    const observer = new ResizeObserver(updateOffsets);
    if (tpWrapperRef.current) {
      observer.observe(tpWrapperRef.current);
    }

    return () => {
      observer.disconnect();
      resetOffsets();
    };
  }, [hasTeleprompter, teleprompterMode, teleprompterSize.width, teleprompterSize.height]);

  return (
    <div ref={overlayRootRef} className="absolute inset-0 pointer-events-none z-40 overflow-hidden">
      {/* Backstage Recording Indicator */}
      {isBackstageRecording && (
        <div className="absolute top-8 right-8 flex items-center gap-2 bg-amber-600/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-amber-400/50 shadow-lg z-50">
          <div className="w-2 h-2 bg-white rounded-full" />
          <span className="text-[10px] font-black uppercase tracking-widest text-white">Запись бекстейджа</span>
        </div>
      )}

      {/* Teleprompter (Dockable / Floating / Fullscreen) */}
      {hasTeleprompter && (
        <motion.div 
          ref={tpWrapperRef}
          drag={teleprompterMode === 'compact'}
          dragControls={dragControls}
          dragListener={false}
          dragMomentum={false}
          dragConstraints={{ left: -window.innerWidth / 2, right: window.innerWidth / 2, top: -window.innerHeight + 80, bottom: 20 }}
          onDragEnd={(_, info) => {
            if (teleprompterMode === 'compact') {
              setTeleprompterPosition({ 
                x: teleprompterPosition.x + info.offset.x, 
                y: teleprompterPosition.y + info.offset.y 
              });
            }
          }}
          className={cn(
            "pointer-events-auto",
            teleprompterMode === 'expanded' ? "transition-all duration-300" : ""
          )}
          style={containerStyle}
          animate={motionAnimate}
          transition={teleprompterMode === 'compact' ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 260 }}
        >
          <Teleprompter 
            subtitles={subtitles}
            currentTime={currentTime}
            mode={teleprompterMode}
            fontSize={teleprompterFontSize}
            lineHeight={teleprompterLineHeight}
            pacing={teleprompterPacing}
            activeRole={activeRole}
            dragControls={dragControls}
            onFontSizeChange={setTeleprompterFontSize}
            onLineHeightChange={setTeleprompterLineHeight}
            onPacingChange={setTeleprompterPacing}
            onModeChange={setTeleprompterMode}
            onResize={(w, h) => setTeleprompterSize({ width: w, height: h })}
            onSeek={onSeek}
          />
        </motion.div>
      )}

      {/* Actor Cam (PiP) */}
      <AnimatePresence>
        {showWebcam && (
          <BackstageCamera 
            webcamRef={webcamRef} 
            recordingStream={recordingStream}
            previewStream={previewStream}
            onClipping={onClipping}
            project={project}
            onSettingsChange={onSettingsChange!}
            isTimelineRecording={isRecording}
            isWebcamSimulated={isWebcamSimulated}
          />
        )}
      </AnimatePresence>

      {/* Scrolling Waveform (Popout/Actor Overlay) */}
      {isPopout && project?.originalPeaks && project.originalPeaks.length > 0 && (
        <ScrollingWaveform 
          peaks={project.originalPeaks}
          currentTime={currentTime}
          duration={duration}
        />
      )}
    </div>
  );
};

export default ActorOverlay;

