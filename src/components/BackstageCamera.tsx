import React from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import VUMeter from './VUMeter';

interface BackstageCameraProps {
  webcamRef: React.RefObject<HTMLVideoElement | null>;
  recordingStream: MediaStream | null;
  previewStream?: MediaStream | null;
  onClipping?: (c: boolean) => void;
  project: any;
  onSettingsChange: (settings: any) => void;
  onRunStressTest?: () => void;
  isTimelineRecording?: boolean;
  isWebcamSimulated?: boolean;
}

export const BackstageCamera: React.FC<BackstageCameraProps> = ({
  webcamRef,
  recordingStream,
  previewStream,
  onClipping,
  project,
  onSettingsChange,
  isTimelineRecording,
  isWebcamSimulated
}) => {
  return (
    <motion.div 
      drag
      dragMomentum={false}
      initial={{ opacity: 0, x: 20, scale: 0.8 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 20, scale: 0.8 }}
      className="absolute flex flex-col bottom-8 right-8 w-72 bg-zinc-900 rounded-2xl border border-white/20 overflow-hidden shadow-2xl pointer-events-auto group cursor-grab active:cursor-grabbing"
    >
      <div className="relative aspect-video w-full bg-black">
        <video 
          ref={(el) => {
            if (webcamRef) {
              if (typeof webcamRef === 'function') {
                (webcamRef as any)(el);
              } else {
                (webcamRef as any).current = el;
              }
            }
            if (el && previewStream && el.srcObject !== previewStream) {
              el.srcObject = previewStream;
              el.play().catch((e) => console.warn("Video play error:", e));
            }
          }}
          autoPlay 
          playsInline 
          muted 
          className="w-full h-full object-cover mirror" 
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
        
        {/* Top-right close button */}
        <button 
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            if (project?.audioSettings) {
              onSettingsChange({
                ...project.audioSettings,
                isBackstageEnabled: false
              });
            }
          }}
          className="absolute top-2 right-2 w-7 h-7 bg-black/50 hover:bg-rose-500/80 rounded-full flex items-center justify-center text-white transition-colors cursor-pointer z-10"
          title="Выключить камеру"
        >
          <X className="w-4 h-4" />
        </button>

        {isWebcamSimulated && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-zinc-950/85 border border-amber-500/40 backdrop-blur-sm px-2 py-1 rounded text-[10px] text-amber-400 font-bold shadow-md select-none">
            <span>⚠️</span>
            <span>Камера симулируется</span>
          </div>
        )}

        <div className="absolute bottom-3 right-3 pointer-events-none">
          <VUMeter stream={recordingStream} onClipping={onClipping} />
        </div>
      </div>
    </motion.div>
  );
};

export default BackstageCamera;

