import { CSSProperties, useMemo } from 'react';
import { TeleprompterMode } from '../../types';

export const TELEPROMPTER_STORAGE_KEY = 'dubstudio_teleprompter_pref_v2';

export interface TeleprompterSavedPref {
  mode: TeleprompterMode;
  dockWidth: number;
  dockHeight: number;
  floatWidth: number;
  floatHeight: number;
  fontSize: number;
  lineHeight: number;
  pacing: 'auto' | 'manual';
}

export const getStoredTeleprompterPref = (): Partial<TeleprompterSavedPref> => {
  try {
    const raw = localStorage.getItem(TELEPROMPTER_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore JSON errors
  }
  return {
    mode: 'compact',
    floatWidth: 460,
    floatHeight: 200,
    dockWidth: 380,
    dockHeight: 220,
    fontSize: 22,
    lineHeight: 1.4,
    pacing: 'auto',
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
    const width = size.width || 460;
    const height = size.height || 200;

    switch (mode) {
      case 'left':
        return {
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${width}px`,
          maxWidth: '80vw',
          zIndex: 45,
        };
      case 'right':
        return {
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: `${width}px`,
          maxWidth: '80vw',
          zIndex: 45,
        };
      case 'bottom':
        return {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: `${height}px`,
          maxHeight: '75vh',
          zIndex: 45,
        };
      case 'compact':
        return {
          position: 'absolute',
          left: 'calc(50% - 230px)',
          top: 'calc(100% - 250px)',
          width: `${width}px`,
          height: `${height}px`,
          zIndex: 45,
        };
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
