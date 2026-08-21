import React from "react";
import { Scissors, Star, Trash2, Copy, Download, MousePointerClick } from "lucide-react";
import { TimelineBlock, TimelineBlockType } from "../../types";

export interface BlockEditorPanelProps {
  block?: TimelineBlock | null;
  selectedBlock?: TimelineBlock | null;
  blocks?: TimelineBlock[];
  isProcessing?: boolean;
  setBlocks?: (blocks: TimelineBlock[]) => void;
  handleChangeBlockType?: (id: string, newType: TimelineBlockType) => void;
  handleUpdateBlockTimes?: (id: string, newStart: number, newEnd: number) => void;
  handleSplitBlock?: (id: string) => void;
  handleCopyBlock?: (id: string) => void;
  handleExportSingleBlock?: (blockId: string) => void;
  handleDeleteBlock?: (id: string) => void;
}

export const BlockEditorPanel: React.FC<BlockEditorPanelProps> = ({
  block,
  selectedBlock,
  blocks = [],
  isProcessing = false,
  setBlocks,
  handleChangeBlockType,
  handleUpdateBlockTimes,
  handleSplitBlock,
  handleCopyBlock,
  handleExportSingleBlock,
  handleDeleteBlock,
}) => {
  const activeBlock = block || selectedBlock;

  if (!activeBlock) {
    return (
      <div className="p-4 bg-zinc-800/30 rounded-xl border border-white/5 flex items-center justify-center gap-2 text-zinc-500 text-xs font-medium my-2">
        <MousePointerClick className="w-4 h-4 opacity-50" />
        <span>Выберите блок на таймлайне для детальной настройки</span>
      </div>
    );
  }

  const activeStart = activeBlock.start ?? activeBlock.originalStart ?? 0;
  const activeEnd = activeBlock.end ?? activeBlock.originalEnd ?? (activeStart + (activeBlock.duration || 0));
  const activeDuration = activeBlock.duration ?? (activeEnd - activeStart);

  return (
    <div className="p-3 bg-zinc-800/50 rounded-lg border border-white/10 flex items-center justify-between gap-4 font-sans animate-fadeIn my-2">
      <div className="flex items-center gap-4 flex-wrap">
        {/* Изменение типа */}
        <div className="flex flex-col gap-1">
          <span className="text-[8px] text-zinc-500 uppercase font-black font-sans">
            Тип логического блока
          </span>
          <select
            value={activeBlock.type || "silence"}
            onChange={(e) =>
              handleChangeBlockType?.(
                activeBlock.id,
                e.target.value as TimelineBlockType,
              )
            }
            className="bg-zinc-800 border border-white/10 text-white text-xs rounded-lg px-2 py-1.5 outline-none focus:border-rose-500 font-bold"
          >
            <option value="silence">Серый: Полная тишина / фон</option>
            <option value="speaking">
              Синий: Разговор (камера во весь экран)
            </option>
            <option value="dub">
              Зеленый: Актер записывает дубль (PIP)
            </option>
          </select>
        </div>

        {/* Изменение времени начала */}
        <div className="flex flex-col gap-1">
          <span className="text-[8px] text-zinc-500 uppercase font-black font-sans">
            Начало (сек)
          </span>
          <input
            type="number"
            step="0.05"
            value={Number(activeStart.toFixed(3))}
            onChange={(e) =>
              handleUpdateBlockTimes?.(
                activeBlock.id,
                parseFloat(e.target.value) || 0,
                activeEnd,
              )
            }
            className="bg-zinc-800 border border-white/10 text-white text-xs font-mono rounded-lg px-2 py-1.5 w-24 outline-none focus:border-rose-500"
          />
        </div>

        {/* Изменение времени конца */}
        <div className="flex flex-col gap-1">
          <span className="text-[8px] text-zinc-500 uppercase font-black font-sans">
            Конец (сек)
          </span>
          <input
            type="number"
            step="0.05"
            value={Number(activeEnd.toFixed(3))}
            onChange={(e) =>
              handleUpdateBlockTimes?.(
                activeBlock.id,
                activeStart,
                parseFloat(e.target.value) || 0,
              )
            }
            className="bg-zinc-800 border border-white/10 text-white text-xs font-mono rounded-lg px-2 py-1.5 w-24 outline-none focus:border-rose-500"
          />
        </div>

        {/* Длительность */}
        <div className="flex flex-col gap-1">
          <span className="text-[8px] text-zinc-500 uppercase font-black font-sans">
            Длительность
          </span>
          <div className="text-xs text-zinc-300 font-mono py-1.5">
            {activeDuration.toFixed(2)}s
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        {/* Кнопка Избранное ⭐ */}
        <button
          onClick={() => {
            if (setBlocks) {
              setBlocks(
                (blocks || []).map((b) =>
                  b.id === activeBlock.id
                    ? { ...b, isFavorite: !b.isFavorite }
                    : b,
                ),
              );
            }
          }}
          className={`p-1.5 rounded-lg flex items-center gap-1 px-3 transition-all ${activeBlock.isFavorite ? "bg-amber-500 text-zinc-950 font-bold hover:bg-amber-400" : "bg-zinc-700 hover:bg-zinc-600 text-amber-400"}`}
          title="Добавить в избранное"
        >
          <Star
            className={`w-3.5 h-3.5 ${activeBlock.isFavorite ? "fill-zinc-950" : ""}`}
          />
          <span className="text-xs font-bold font-sans">
            {activeBlock.isFavorite ? "В Избранном" : "В Избранное"}
          </span>
        </button>

        {/* Разделение блока */}
        <button
          onClick={() => handleSplitBlock?.(activeBlock.id)}
          className="p-1.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg flex items-center gap-1.5 px-3 transition-all"
          title="Разрезать пополам"
        >
          <Scissors className="w-3.5 h-3.5" />
          <span className="text-xs font-bold font-sans">Разрезать</span>
        </button>

        {/* Копировать блок */}
        <button
          onClick={() => handleCopyBlock?.(activeBlock.id)}
          className="p-1.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg flex items-center gap-1.5 px-3 transition-all"
          title="Дублировать блок"
        >
          <Copy className="w-3.5 h-3.5" />
          <span className="text-xs font-bold font-sans">
            Дублировать
          </span>
        </button>

        {/* Экспортировать блок */}
        <button
          onClick={() => handleExportSingleBlock?.(activeBlock.id)}
          className="p-1.5 bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-400 rounded-lg flex items-center gap-1.5 px-3 transition-all"
          title="Экспортировать только этот фрагмент"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="text-xs font-bold font-sans">
            Экспорт блока
          </span>
        </button>

        {/* Удалить блок */}
        <button
          onClick={() => handleDeleteBlock?.(activeBlock.id)}
          className="p-1.5 bg-rose-500/20 hover:bg-rose-500/40 text-rose-400 rounded-lg flex items-center gap-1.5 px-3 transition-all"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="text-xs font-bold uppercase font-sans">
            Удалить
          </span>
        </button>
      </div>
    </div>
  );
};
