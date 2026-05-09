import { ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { convertFileSrc } from '@tauri-apps/api/core';
import { AudioSettings, HotkeyAction, KeyMap } from '../types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const getDefaultKeyMap = (): KeyMap => ({
  'play_pause': { label: 'Воспроизведение/Пауза', code: 'Space' },
  'record_toggle': { label: 'Начать/Остановить запись', code: 'KeyR' },
  'backstage_toggle': { label: 'Вкл/Выкл Backstage', code: 'KeyB' },
  'delete_take': { label: 'Удалить последний дубль', code: 'KeyZ', ctrlKey: true },
  'split_segment': { label: 'Разрезать сегмент', code: 'KeyS' },
  'join_segments': { label: 'Склеить сегменты', code: 'KeyJ' },
  'seek_start': { label: 'В начало', code: 'Home' },
  'seek_end': { label: 'В конец', code: 'End' },
  'seek_prev_sub': { label: 'Пред. субтитр', code: 'ArrowLeft', ctrlKey: true },
  'seek_next_sub': { label: 'След. субтитр', code: 'ArrowRight', ctrlKey: true },
  'add_marker': { label: 'Добавить маркер', code: 'KeyM' },
  'discard_recording': { label: 'Отменить запись', code: 'Escape' },
  'delete_selected': { label: 'Удалить выбранное', code: 'KeyD' },
});

export const formatHotkey = (action: HotkeyAction) => {
  if (!action) return 'None';
  const parts = [];
  if (action.ctrlKey) parts.push('Ctrl');
  if (action.shiftKey) parts.push('Shift');
  if (action.altKey) parts.push('Alt');
  
  let keyName = action.code || 'None';
  if (keyName.startsWith('Key')) keyName = keyName.substring(3);
  else if (keyName.startsWith('Digit')) keyName = keyName.substring(5);
  else if (keyName === 'Space') keyName = 'Space';
  
  parts.push(keyName);
  return parts.join(' + ');
};

export const getSafeFileUrl = (path: string | undefined): string | undefined => {
  if (!path) return undefined;
  try {
    // If it's already a URL, return it
    if (path.startsWith('http') || path.startsWith('blob:') || path.startsWith('data:')) {
      return path;
    }
    
    const converted = convertFileSrc(path);
    return converted;
  } catch (e) {
    console.error(`[getSafeFileUrl] CRITICAL: Failed to convert path "${path}":`, e);
    // On Windows, if absolute path fails, try normalized
    if (path.includes('\\')) {
      try {
        const normalized = path.replace(/\\/g, '/');
        return convertFileSrc(normalized);
      } catch (e2) {}
    }
    return path;
  }
};

export const getGlobalAudioSettings = (): AudioSettings => {
  const defaults: AudioSettings = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    sampleRate: 48000,
    bitDepth: 24,
    noiseGateThreshold: -45,
    isNoiseGateEnabled: false,
    compressorThreshold: -20,
    compressorRatio: 4,
    highPassFrequency: 80,
    isDestructive: false,
    backstageMode: 'parallel',
    isBackstageEnabled: false,
    asioMode: false,
    keyMap: getDefaultKeyMap(),
    exportSettings: {
      mp3Bitrate: 320,
      flacCompression: 5,
      sampleRate: 48000
    }
  };

  try {
    const saved = localStorage.getItem('dubstudio_global_audio_settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...defaults, ...parsed };
    }
  } catch(e) {}
  return defaults;
};

/**
 * Safe confirm that doesn't crash in environments where window.confirm is blocked by ACL
 */
export const safeConfirm = async (message: string, defaultValue: boolean = false): Promise<boolean> => {
  try {
    const res = window.confirm(message);
    if ((res as any) instanceof Promise) {
      return await (res as any);
    }
    return !!res;
  } catch (e) {
    console.warn("[safeConfirm] Native confirm failed (ACL?), defaulting to:", defaultValue, e);
    return defaultValue;
  }
};
