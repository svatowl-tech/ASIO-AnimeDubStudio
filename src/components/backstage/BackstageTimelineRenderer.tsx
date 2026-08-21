import React from "react";
import { Star } from "lucide-react";
import { TimelineBlock, ExportSettings } from "../../types";

export interface BackstageTimelineRendererProps {
  blocks: TimelineBlock[];
  totalEditedDuration: number;
  selectedBlockId: string | null;
  exportSettings: ExportSettings;
  setSelectedBlockId: (id: string) => void;
  setBlocks: (blocks: TimelineBlock[]) => void;
  handleDrop: (e: React.DragEvent<HTMLDivElement>, targetBlockId: string) => void;
  currentTimelineTime?: number;
  onTimelineClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export const BackstageTimelineRenderer: React.FC<BackstageTimelineRendererProps> = ({
  blocks,
  totalEditedDuration,
  selectedBlockId,
  exportSettings,
  setSelectedBlockId,
  setBlocks,
  handleDrop,
  currentTimelineTime = 0,
  onTimelineClick,
}) => {
  const playheadPercent = totalEditedDuration > 0 ? (currentTimelineTime / totalEditedDuration) * 100 : 0;

  return (
    <div 
      className="relative w-full h-full flex items-center bg-zinc-950 overflow-hidden cursor-pointer select-none"
      onClick={onTimelineClick}
    >
      {/* Playhead Line */}
      {totalEditedDuration > 0 && (
        <div 
          className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-30 pointer-events-none shadow-[0_0_8px_rgba(244,63,94,0.8)]"
          style={{ left: `${Math.min(100, Math.max(0, playheadPercent))}%` }}
        >
          <div className="w-2.5 h-2.5 bg-rose-500 rounded-full -ml-[4px] -mt-1 shadow-md" />
        </div>
      )}

      {(blocks || []).map((block) => {
        const safeDuration = Number.isFinite(block?.duration) && block.duration > 0 ? block.duration : 0.1;
        const safeTotal = Number.isFinite(totalEditedDuration) && totalEditedDuration > 0 ? totalEditedDuration : 1;
        const widthPercent = Math.min(100, Math.max(0.1, (safeDuration / safeTotal) * 100));
        const isSelected = selectedBlockId === block.id;
        const isDimmed = exportSettings?.onlyFavorites && !block.isFavorite;

        let bgColor = "bg-zinc-800/30";
        let borderColor = "border-white/5";
        let textColor = "text-zinc-500";
        let label = "ТИШИНА";

        if (block.type === "dub") {
          bgColor = "bg-emerald-500/40 hover:bg-emerald-500/60";
          borderColor = "border-emerald-400/50";
          textColor = "text-emerald-300";
          label = "ДУБЛЬ";
        } else if (block.type === "speaking") {
          bgColor = "bg-blue-500/30 hover:bg-blue-500/50";
          borderColor = "border-blue-400/30";
          textColor = "text-blue-300";
          label = "РАЗГОВОР";
        } else {
          bgColor = "bg-zinc-800/50 hover:bg-zinc-700/50";
        }

        // Умное оформление рамок
        let borderStyle = "border-white/5";
        if (isSelected) {
          borderStyle = block.isFavorite
            ? "border-amber-400 border-2"
            : "border-white border-2";
        } else if (block.isFavorite) {
          borderStyle = "border-amber-500 border";
        }

        return (
          <div
            key={block.id}
            draggable={true}
            onDragStart={(e) => e.dataTransfer.setData("blockId", block.id)}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => handleDrop(e, block.id)}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedBlockId(block.id);
            }}
            className={`relative h-full flex flex-col justify-between cursor-grab active:cursor-grabbing transition-all ${bgColor} ${borderStyle} ${isDimmed ? "opacity-10 pointer-events-none blur-[0.5px]" : "opacity-100"} overflow-hidden min-w-0 flex-shrink`}
            style={{ width: `${widthPercent}%` }}
          >
            <div className="flex justify-between items-start p-1 overflow-hidden">
              <div
                className={`text-[8px] font-black truncate ${textColor} min-w-0 flex-shrink`}
              >
                {label}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setBlocks(
                    (blocks || []).map((b) =>
                      b.id === block.id
                        ? { ...b, isFavorite: !b.isFavorite }
                        : b
                    )
                  );
                }}
                className="p-0.5 hover:bg-white/10 rounded transition-all flex-shrink-0"
                title={block.isFavorite ? "Убрать из Избранного" : "Добавить в Избранное"}
              >
                <Star
                  className={`w-3 h-3 transition-colors ${
                    block.isFavorite
                      ? "fill-amber-400 text-amber-400"
                      : "text-zinc-600 hover:text-amber-400"
                  }`}
                />
              </button>
            </div>
            <div className="text-[8px] text-zinc-500 p-1 select-none text-right font-mono">
              {block.duration.toFixed(1)}s
            </div>
          </div>
        );
      })}
    </div>
  );
};
