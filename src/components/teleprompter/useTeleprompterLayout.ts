import { CSSProperties, useMemo } from 'react';
import { TeleprompterMode } from '../../types';

export const TELEPROMPTER_STORAGE_KEY = 'dubstudio_teleprompter_pref_v3';

export interface TeleprompterSavedPref {
  mode: TeleprompterMode;
  dockWidth: number;
  dockHeight: number;
  floatWidth: number;
  floatHeight: number;
  fontSize: number;
  lineHeight: number;
  pacing: 'auto' | 'manual';
  autoFit: boolean;
  speed: number;
  pipWidth: number;
  pipHeight: number;
  pipX: number;
  pipY: number;
}

export const getStoredTeleprompterPref = (): Partial<TeleprompterSavedPref> => {
  try {
    const raw = localStorage.getItem(TELEPROMPTER_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore JSON errors
  }
  return {
    mode: 'bottom',
    floatWidth: 640,
    floatHeight: 68,
    dockWidth: 320,
    dockHeight: 68,
    fontSize: 21,
    lineHeight: 1.25,
    pacing: 'auto',
    autoFit: true,
    speed: 1,
    pipWidth: 320,
    pipHeight: 180,
    pipX: 0,
    pipY: 0,
  };
};

export const saveTeleprompterPref = (pref: Partial<TeleprompterSavedPref>) => {
  try {
    const current = getStoredTeleprompterPref();
    const updated = { ...current, ...pref };
    localStorage.setItem(TELEPROMPTER_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
};

export const useTeleprompterLayout = (
  mode: TeleprompterMode,
  size: { width: number; height: number },
  position: { x: number; y: number }
) => {
  const containerStyle = useMemo<CSSProperties>(() => {
    const stored = getStoredTeleprompterPref();
    const width = size.width || 320;
    const height = size.height || 68;

    switch (mode) {
      case 'left':
        return {
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${Math.max(240, Math.min(width, 640))}px`,
          maxWidth: '55vw',
          zIndex: 45,
        };
      case 'right':
        return {
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: `${Math.max(240, Math.min(width, 640))}px`,
          maxWidth: '55vw',
          zIndex: 45,
        };
      case 'top':
        return {
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: 'auto',
          minHeight: `${Math.max(48, Math.min(height, 240))}px`,
          maxHeight: '40vh',
          zIndex: 45,
        };
      case 'bottom':
        return {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 'auto',
          minHeight: `${Math.max(48, Math.min(height, 240))}px`,
          maxHeight: '40vh',
          zIndex: 45,
        };
      case 'compact': {
        // Ensure compact floating strip is wide and horizontal even if size.width held a narrow sidebar width
        const rawW = width > 380 ? width : (stored.floatWidth || 640);
        const floatW = Math.max(420, rawW);
        return {
          position: 'absolute',
          left: `calc(50% - ${Math.round(floatW / 2)}px)`,
          bottom: '16px',
          width: `${floatW}px`,
          maxWidth: 'calc(100vw - 32px)',
          height: 'auto',
          minHeight: `${Math.max(48, Math.min(height, 180))}px`,
          maxHeight: '36vh',
          zIndex: 45,
        };
      }
      case 'expanded':
      default:
        return {
          position: 'absolute',
          inset: 0,
          zIndex: 60,
        };
    }
  }, [mode, size.width, size.height]);

  const motionAnimate = useMemo(() => {
    if (mode === 'compact') {
      return {
        x: position.x,
        y: position.y,
        opacity: 1,
        scale: 1,
      };
    }
    return {
      x: 0,
      y: 0,
      opacity: 1,
      scale: 1,
    };
  }, [mode, position.x, position.y]);

  return {
    containerStyle,
    motionAnimate,
  };
};

