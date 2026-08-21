import React from "react";
import { ExportPreset, ExportSettings } from "../../types";

export interface ExportSettingsPanelProps {
  exportSettings?: ExportSettings;
  selectedPresetId?: string;
  isProcessing?: boolean;
  EXPORT_PRESETS?: ExportPreset[];
  presets?: ExportPreset[];
  handleSelectPreset?: (presetId: string) => void;
  onSelectPreset?: (presetId: string) => void;
  handleUpdateSetting?: (key: keyof ExportSettings, value: any) => void;
  onUpdateSetting?: (key: keyof ExportSettings, value: any) => void;
  onExport?: () => void;
  onExportShorts?: () => void;
  onExportPip?: () => void;
  onRemoveGarbage?: () => void;
  onRemoveAllSilence?: () => void;
  onRemoveSilence?: () => void;
}

export const ExportSettingsPanel: React.FC<ExportSettingsPanelProps> = ({
  exportSettings = {
    includeOriginal: true,
    aspectRatio: "16:9",
    professionalEditing: true,
    onlyFavorites: false,
    splitShortVideos: false,
  },
  selectedPresetId = "default",
  isProcessing = false,
  EXPORT_PRESETS,
  presets,
  handleSelectPreset,
  onSelectPreset,
  handleUpdateSetting,
  onUpdateSetting,
  onExport,
}) => {
  const activePresets = presets || EXPORT_PRESETS || [];
  const selectPresetHandler = onSelectPreset || handleSelectPreset;
  const updateSettingHandler = onUpdateSetting || handleUpdateSetting;

  return (
    <div className="w-80 bg-zinc-900 border border-white/5 rounded-xl p-4 flex flex-col gap-4 overflow-y-auto">
      <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest border-b border-white/5 pb-2 font-sans">
        Настройки сборки
      </h3>

      <div className="flex flex-col gap-1.5 border-b border-white/5 pb-3">
        <span className="text-xs font-bold text-zinc-400 font-sans">
          Готовый пресет
        </span>
        <select
          value={selectedPresetId}
          onChange={(e) => selectPresetHandler?.(e.target.value)}
          className="bg-zinc-800 border border-white/10 text-white text-sm rounded-lg p-2 outline-none focus:border-rose-500 font-sans"
        >
          {(activePresets || []).map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-start gap-3 cursor-pointer group">
        <div className="relative flex items-center justify-center mt-0.5">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={!!exportSettings.includeOriginal}
            onChange={(e) =>
              updateSettingHandler?.("includeOriginal", e.target.checked)
            }
          />
          <div className="w-4 h-4 rounded bg-zinc-800 border border-zinc-700 peer-checked:bg-rose-500 peer-checked:border-rose-500 transition-colors"></div>
          <svg
            className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <div className="flex flex-col font-sans">
          <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
            Оригинальное видео
          </span>
          <span className="text-[10px] text-zinc-500">
            Включить основное видео как фон или PIP
          </span>
        </div>
      </label>

      <div className="flex flex-col gap-2 font-sans">
        <span className="text-sm font-medium text-zinc-200">
          Формат (соотношение сторон)
        </span>
        <select
          value={exportSettings.aspectRatio || "16:9"}
          onChange={(e) =>
            updateSettingHandler?.(
              "aspectRatio",
              e.target.value as "16:9" | "9:16"
            )
          }
          className="bg-zinc-800 border border-white/10 text-white text-sm rounded-lg p-2 outline-none focus:border-rose-500 font-sans"
        >
          <option value="16:9">16:9 (YouTube, Десктоп)</option>
          <option value="9:16">9:16 (Shorts, Reels, TikTok)</option>
        </select>
      </div>

      <label className="flex items-start gap-3 cursor-pointer group">
        <div className="relative flex items-center justify-center mt-0.5">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={!!exportSettings.professionalEditing}
            onChange={(e) =>
              updateSettingHandler?.("professionalEditing", e.target.checked)
            }
          />
          <div className="w-4 h-4 rounded bg-zinc-800 border border-zinc-700 peer-checked:bg-rose-500 peer-checked:border-rose-500 transition-colors"></div>
          <svg
            className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <div className="flex flex-col font-sans">
          <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
            Профессиональный монтаж
          </span>
          <span className="text-[10px] text-zinc-500">
            Умное переключение камер: дубль = PIP камера, разговор = полный экран
          </span>
        </div>
      </label>

      <label className="flex items-start gap-3 cursor-pointer group">
        <div className="relative flex items-center justify-center mt-0.5">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={!!exportSettings.onlyFavorites}
            onChange={(e) =>
              updateSettingHandler?.("onlyFavorites", e.target.checked)
            }
          />
          <div className="w-4 h-4 rounded bg-zinc-800 border border-zinc-700 peer-checked:bg-rose-500 peer-checked:border-rose-500 transition-colors"></div>
          <svg
            className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <div className="flex flex-col font-sans">
          <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
            Только избранное ⭐
          </span>
          <span className="text-[10px] text-zinc-500">
            Экспортировать только отмеченные звездочкой блоки
          </span>
        </div>
      </label>

      <label className="flex items-start gap-3 cursor-pointer group border-b border-white/5 pb-4">
        <div className="relative flex items-center justify-center mt-0.5">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={!!exportSettings.splitShortVideos}
            onChange={(e) =>
              updateSettingHandler?.("splitShortVideos", e.target.checked)
            }
          />
          <div className="w-4 h-4 rounded bg-zinc-800 border border-zinc-700 peer-checked:bg-rose-500 peer-checked:border-rose-500 transition-colors"></div>
          <svg
            className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <div className="flex flex-col font-sans">
          <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
            Разбить на клипы
          </span>
          <span className="text-[10px] text-zinc-500">
            Сохранить каждый логический блок как отдельный видеофайл (идеально для Shorts)
          </span>
        </div>
      </label>

      <button
        onClick={onExport}
        disabled={isProcessing}
        className="mt-auto w-full py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg shadow-rose-500/20 transition-all font-sans flex items-center justify-center gap-2"
      >
        {isProcessing ? (
          <>
            <svg
              className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            Обработка...
          </>
        ) : (
          <>
            {exportSettings.splitShortVideos
              ? "Экспорт Shorts (9:16)"
              : "Сборка (PIP Бекстейдж)"}
          </>
        )}
      </button>
    </div>
  );
};
