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
  'delete_take': { label: 'Удалить последний дубль', code: 'Backspace', ctrlKey: true },
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

/**
 * Formats time in seconds to ч:м:с (hh:mm:ss) format.
 * Example: 75 -> "00:01:15", 3665 -> "01:01:05"
 */
export const formatTimeHms = (seconds: number = 0): string => {
  if (isNaN(seconds) || seconds < 0) return '00:00:00';
  const totalSeconds = Math.floor(seconds);
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  
  const paddedHrs = hrs.toString().padStart(2, '0');
  const paddedMins = mins.toString().padStart(2, '0');
  const paddedSecs = secs.toString().padStart(2, '0');
  
  return `${paddedHrs}:${paddedMins}:${paddedSecs}`;
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
    webcamExportOverlay: true,
    isBackstageEnabled: false,
    asioMode: false,
    playOriginalTrackSegments: false,
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
export const safeConfirm = async (message: string, defaultValue: boolean = true): Promise<boolean> => {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const rawConfirm = (window as any).__original_confirm || window.confirm;
    const res = rawConfirm.call(window, message);
    if (res && typeof (res as any).then === 'function') {
      return await (res as any).catch((err: any) => {
        console.warn("[safeConfirm] Async confirm rejected:", err);
        return defaultValue;
      });
    }
    return res !== false;
  } catch (e) {
    console.warn("[safeConfirm] Native confirm failed, defaulting to:", defaultValue, e);
    return defaultValue;
  }
};

/**
 * Возвращает понятное сообщение об ошибке для аудио-устройств и записи звука с пошаговым решением.
 */
export const getFriendlyAudioErrorMessage = (err: any): string => {
  if (!err) return "Произошла неизвестная ошибка при работе со звуком.";
  
  const errName = typeof err === 'object' && err?.name ? String(err.name) : '';
  const errMsg = typeof err === 'object' && err?.message ? String(err.message) : String(err);
  const errString = `${errName} ${errMsg}`.toLowerCase();

  // 1. Ошибки разрешений (Permissions)
  if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError' || errString.includes('permission') || errString.includes('allow')) {
    return [
      "❌ Ошибка доступа: Доступ к микрофону заблокирован в браузере.",
      "💡 Решение:",
      "1. Нажмите на иконку замочка (или настроек сайта) слева от адресной строки браузера.",
      "2. Найдите пункт 'Микрофон' (Microphone) и установите для него значение 'Разрешить' (Allow).",
      "3. Перезагрузите страницу приложения и попробуйте снова."
    ].join('\n');
  }

  // 2. Ошибки отсутствия оборудования (Not Found)
  if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError' || errString.includes('not found') || errString.includes('no device')) {
    return [
      "❌ Ошибка оборудования: Микрофон не обнаружен.",
      "💡 Решение:",
      "1. Проверьте физическое подключение микрофона или звуковой карты к компьютеру (USB-кабель, разъём Jack 3.5мм).",
      "2. Убедитесь, что устройство включено и распознаётся в настройках звука вашей операционной системы (Windows/macOS).",
      "3. Если вы используете внешнюю звуковую карту, проверьте, установлены ли необходимые системные драйверы."
    ].join('\n');
  }

  // 3. Устройство занято другим процессом (Busy / Locked)
  if (errName === 'NotReadableError' || errName === 'TrackStartError' || errString.includes('readable') || errString.includes('could not start') || errString.includes('hardware') || errString.includes('busy')) {
    return [
      "❌ Ошибка интерфейса: Микрофон занят другим приложением или заблокирован.",
      "💡 Решение:",
      "1. Закройте другие программы, которые могут использовать микрофон в монопольном режиме: Discord, Telegram, Zoom, Skype, OBS, браузерные вкладки с видеосвязью или сторонние DAW (FL Studio, Reaper).",
      "2. Если вы используете ASIO, убедитесь, что другие аудиоредакторы полностью закрыты для освобождения аудиоинтерфейса.",
      "3. Попробуйте отключить и заново подключить микрофон к порту компьютера."
    ].join('\n');
  }

  // 4. Несовместимые параметры устройства (Overconstrained)
  if (errName === 'OverconstrainedError' || errString.includes('constraint') || errString.includes('parameter')) {
    return [
      "❌ Ошибка параметров: Микрофон не поддерживает запрашиваемый формат записи.",
      "💡 Решение:",
      "1. Перейдите в настройки аудио в правом верхнем углу приложения.",
      "2. Отключите функции шумоподавления (Noise Suppression) и эхоподавления (Echo Cancellation) — они могут конфликтовать с профессиональными картами.",
      "3. Сбросьте частоту дискретизации на стандартные 44100 Гц или 48000 Гц.",
      "4. Попробуйте установить аудиоустройство в режим 'По умолчанию' (Default)."
    ].join('\n');
  }

  // 5. Ошибки песочницы/iframe (Security)
  if (errName === 'SecurityError' || errString.includes('security') || errString.includes('sandbox')) {
    return [
      "❌ Ошибка безопасности: Браузер заблокировал доступ к медиа-устройствам в этой вкладке.",
      "💡 Решение:",
      "1. Скорее всего, приложение запущено во встроенном фрейме (iframe), у которого нет прав на захват аудио.",
      "2. Откройте приложение в новой полноценной вкладке браузера (кнопка 'Open in new tab' в правом верхнем углу экрана).",
      "3. В новой вкладке права доступа будут предоставлены штатно."
    ].join('\n');
  }

  // 6. Специфичные ошибки ASIO драйверов через Tauri-бэкэнд
  if (errString.includes('asio')) {
    let subReason = "Не удалось инициализировать ASIO звуковой интерфейс.";
    let steps = [
      "1. Убедитесь, что для вашей звуковой карты установлены оригинальные официальные драйверы ASIO (например, Focusrite USB ASIO, Behringer USB ASIO, Steinberg ASIO).",
      "2. Если у вас нет специальной внешней звуковой карты, установите бесплатный универсальный драйвер ASIO4ALL с официального сайта и настройте его.",
      "3. Закройте все сторонние DAW и плееры (Reaper, Cubase, AIMP, FL Studio), так как ASIO захватывает звуковую карту монопольно.",
      "4. Проверьте настройки частоты дискретизации проекта (44100 или 48000 Гц) — они должны совпадать с частотой вашей звуковой карты в панели управления Windows."
    ];

    if (errString.includes('driver not found') || errString.includes('no driver')) {
      subReason = "Драйвер ASIO не найден в системе.";
    } else if (errString.includes('rate') || errString.includes('sample rate')) {
      subReason = "Выбранная частота дискретизации не поддерживается вашей звуковой картой в режиме ASIO.";
    } else if (errString.includes('channel') || errString.includes('invalid channel')) {
      subReason = "Неверно указан индекс входного или выходного канала ASIO.";
    } else if (errString.includes('in use') || errString.includes('locked')) {
      subReason = "Интерфейс ASIO заблокирован другим аудиоредактором в монопольном режиме.";
    }

    return [
      `❌ Ошибка ASIO: ${subReason}`,
      "💡 Решение:",
      ...steps
    ].join('\n');
  }

  // Дефолтный вывод технической информации для разработчика и пользователя
  return [
    `❌ Произошел сбой при инициализации аудио-захвата.`,
    `Код ошибки: ${errName || 'AudioCaptureError'}`,
    `Детали: ${errMsg}`,
    "",
    "💡 Общие рекомендации по исправлению:",
    "- Проверьте, разрешен ли доступ к микрофону в вашем браузере.",
    "- Переподключите микрофон в другой USB-порт (желательно USB 2.0 / на задней панели компьютера).",
    "- Убедитесь, что микрофон не отключен кнопкой (Mute) на самом устройстве.",
    "- Перезапустите страницу или всё приложение, чтобы освободить зависшие потоки звуковой карты."
  ].join('\n');
};

/**
 * Возвращает понятное сообщение об ошибке при загрузке или чтении медиафайлов.
 */
export const getFriendlyFileLoadErrorMessage = (err: any, url?: string): string => {
  const errMsg = typeof err === 'object' && err?.message ? String(err.message) : String(err);
  const errString = errMsg.toLowerCase();
  const fileExt = url ? url.substring(url.lastIndexOf('.')).toLowerCase() : '';

  if (errString.includes('http error') || errString.includes('404') || errString.includes('not found')) {
    return [
      `❌ Ошибка: Файл не найден (404).`,
      `Путь/URL: ${url || 'Неизвестно'}`,
      "",
      "💡 Решение:",
      "1. Проверьте, существует ли файл по указанному пути на жестком диске.",
      "2. Если вы переместили, переименовали или удалили исходный файл проекта, приложение не сможет его воспроизвести.",
      "3. Попробуйте импортировать файл заново через кнопку добавления дорожек."
    ].join('\n');
  }

  if (errString.includes('decode') || errString.includes('codec') || errString.includes('format')) {
    return [
      `❌ Ошибка формата: Не удалось декодировать аудио-данные.`,
      `Расширение файла: ${fileExt || 'Неизвестно'}`,
      "",
      "💡 Решение:",
      "1. Файл может быть поврежден или использовать неподдерживаемый кодек (например, сжатый RAW, AAC в нетипичном контейнере или защищенный DRM).",
      "2. Рекомендуется конвертировать аудиофайл в стандартный несжатый 16/24-битный формат WAV (PCM) или качественный MP3 с частотой 44.1/48 кГц.",
      "3. Конвертировать файлы можно бесплатными инструментами, такими как Audacity или FFmpeg."
    ].join('\n');
  }

  if (errString.includes('cors') || errString.includes('security') || errString.includes('origin') || errString.includes('allow-origin')) {
    return [
      "❌ Ошибка безопасности (CORS): Доступ к локальному файлу заблокирован политикой браузера.",
      "",
      "💡 Решение:",
      "1. Веб-версии браузеров из соображений безопасности запрещают прямой доступ к файлам на вашем жестком диске.",
      "2. Пожалуйста, убедитесь, что приложение запущено в десктопном режиме (Tauri/Electron), либо импортируйте файл через форму выбора файлов, чтобы загрузить его в оперативную память браузера."
    ].join('\n');
  }

  return [
    `❌ Ошибка чтения медиафайла: ${errMsg}`,
    `Файл: ${url || 'Локальный ресурс'}`,
    "",
    "💡 Что делать:",
    "- Убедитесь, что файл полностью скачан и не занят другим процессом в вашей операционной системе.",
    "- Попробуйте открыть его в стандартном плеере, чтобы проверить работоспособность.",
    "- Повторите импорт файла в проект."
  ].join('\n');
};

/**
 * Возвращает понятное сообщение об ошибке для файлов субтитров.
 */
export const getFriendlySubtitleErrorMessage = (err: any, fileName: string): string => {
  const errMsg = typeof err === 'object' && err?.message ? String(err.message) : String(err);
  return [
    `❌ Ошибка разбора файла субтитров: "${fileName}"`,
    `Детали ошибки: ${errMsg}`,
    "",
    "💡 Решение:",
    "1. Убедитесь, что формат файла поддерживается (.srt, .ass, .vtt, .txt, .csv).",
    "2. Проверьте кодировку файла — рекомендуется использовать UTF-8. Если файл сохранен в кодировке Windows-1251 (CP1251) или UTF-16, пересохраните его в стандартную UTF-8.",
    "3. Убедитесь, что структура файла не нарушена (каждая реплика должна иметь корректные таймкоды начала и конца, например: 00:01:23,450 --> 00:01:26,900 для SRT)."
  ].join('\n');
};

/**
 * Возвращает понятное и подробное сообщение об ошибке при экспорте (сведение, стемы, видео, ZIP, аудиокниги).
 */
export const getFriendlyExportErrorMessage = (err: any, operationName: string, outputPath?: string): string => {
  const errMsg = typeof err === 'object' && err?.message ? String(err.message) : String(err);
  const errString = errMsg.toLowerCase();

  let cause = "Произошел непредвиденный сбой в процессе подготовки или сохранения медиаданных.";
  const recommendations: string[] = [];

  if (errString.includes('permission') || errString.includes('access denied') || errString.includes('readonly')) {
    cause = "Отсутствуют права на запись в целевую директорию или файл заблокирован другой программой.";
    recommendations.push(
      "1. Убедитесь, что папка назначения не защищена от записи.",
      "2. Проверьте, не открыт ли экспортируемый файл в другом проигрывателе, видеоредакторе или аудио-редакторе.",
      "3. Попробуйте выбрать другую папку для сохранения (например, Рабочий стол или Документы).",
      "4. Запустите приложение от имени администратора."
    );
  } else if (errString.includes('space') || errString.includes('disk full') || errString.includes('nospc')) {
    cause = "Недостаточно свободного места на жестком диске для завершения рендеринга.";
    recommendations.push(
      "1. Освободите место на диске, где находится папка проекта или временная папка операционной системы.",
      "2. Очистите корзину и удалите ненужные временные файлы.",
      "3. Попробуйте выполнить экспорт на другой диск с большим объемом свободной памяти."
    );
  } else if (errString.includes('ffmpeg') || errString.includes('ffprobe') || errString.includes('codec') || errString.includes('encode')) {
    cause = "Внутренний декодер/энкодер (FFmpeg) завершил работу с ошибкой при перекодировании или объединении потоков.";
    recommendations.push(
      "1. Проверьте форматы исходных файлов. Если вы используете редкие кодеки в исходном видео, попробуйте конвертировать его в стандартный MP4 (H.264 / AAC).",
      "2. Убедитесь, что пути к файлам в проекте не содержат специфических спецсимволов или слишком длинных путей (более 260 символов).",
      "3. Попробуйте отключить/включить аппаратное ускорение рендеринга в настройках системы."
    );
  } else if (errString.includes('missing') || errString.includes('not found') || errString.includes('enoent')) {
    cause = "Один или несколько исходных аудиофрагментов или видеофайл не найдены на диске.";
    recommendations.push(
      "1. Проверьте целостность проекта: не удаляли ли вы файлы из папки проекта /takes или /assets вручную.",
      "2. Выполните проверку здоровья проекта через 'Project Health Manager' на верхней панели.",
      "3. Перезагрузите проект для восстановления потерянных временных связей."
    );
  } else {
    // Дефолтные рекомендации для общего экспорта
    recommendations.push(
      "1. Убедитесь, что все дорожки корректно синхронизированы и на них нет поврежденных фрагментов.",
      "2. Перезапустите страницу или приложение, чтобы очистить оперативную память и освободить аудиоустройства.",
      "3. Попробуйте экспортировать в другой аудиоформат (например, в несжатый WAV вместо MP3)."
    );
  }

  return [
    `❌ Сбой операции: ${operationName}`,
    `Детали ошибки: ${errMsg}`,
    outputPath ? `Файл назначения: ${outputPath}` : "",
    "",
    `Причина: ${cause}`,
    "",
    "💡 Решение:",
    ...recommendations
  ].filter(line => line !== null && line !== undefined).join('\n');
};

/**
 * Возвращает понятное сообщение об ошибке при импорте проектов или видео.
 */
export const getFriendlyImportErrorMessage = (err: any, fileType: string, filePath?: string): string => {
  const errMsg = typeof err === 'object' && err?.message ? String(err.message) : String(err);
  const errString = errMsg.toLowerCase();

  const recommendations = [
    "1. Проверьте, поддерживается ли данный формат видео/аудио вашей системой (рекомендуется MP4, MOV, WAV, MP3).",
    "2. Убедитесь, что файл не поврежден и воспроизводится в стандартном системном плеере.",
    "3. Если вы импортируете MKV, убедитесь, что в файле присутствуют поддерживаемые аудио- и видеодорожки.",
    "4. Попробуйте скопировать файл в локальную папку без кириллицы в пути перед импортом."
  ];

  return [
    `❌ Не удалось импортировать ${fileType}`,
    filePath ? `Путь к файлу: ${filePath}` : "",
    `Техническая информация: ${errMsg}`,
    "",
    "💡 Рекомендации:",
    ...recommendations
  ].join('\n');
};

/**
 * Преобразует значение в децибелах (dB) в линейный коэффициент громкости (gain).
 * Формула: 10 ^ (db / 20)
 */
export const dbToLinear = (db: number): number => {
  const clampedDb = Math.max(-15, Math.min(15, db));
  return Math.pow(10, clampedDb / 20);
};

/**
 * Преобразует линейный коэффициент громкости в децибелы (dB).
 */
export const linearToDb = (linear: number): number => {
  if (linear <= 0) return -15;
  const db = 20 * Math.log10(linear);
  return Math.max(-15, Math.min(15, db));
};

/**
 * Возвращает линейный коэффициент громкости для дорожки.
 * Обратная совместимость: если значение равно 1.0 (старый дефолт), это трактуется как 0 dB (1.0x).
 * В противном случае значение считается в dB и преобразуется в линейный коэффициент.
 */
export const getTrackLinearVolume = (volume: number | undefined): number => {
  if (volume === undefined) return 1.0;
  if (volume === 1.0) return 1.0; // Старый дефолт (linear 1.0 -> 0 dB)
  return dbToLinear(volume);
};

/**
 * Возвращает линейный коэффициент громкости для сегмента (фрагмента).
 * Обратная совместимость: если значение равно 1.0 (старый дефолт), это трактуется как 0 dB (1.0x).
 * В противном случае значение считается в dB и преобразуется в линейный коэффициент.
 */
export const getSegmentLinearGain = (gain: number | undefined): number => {
  if (gain === undefined) return 1.0;
  if (gain === 1.0) return 1.0; // Старый дефолт (linear 1.0 -> 0 dB)
  return dbToLinear(gain);
};



