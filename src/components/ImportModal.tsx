import React from 'react';
import { createPortal } from 'react-dom';
import { 
  FileVideo, 
  FileText, 
  Music, 
  Layers, 
  X,
  Video as VideoIcon
} from 'lucide-react';
import { motion } from 'framer-motion';

interface ImportModalProps {
  onClose: () => void;
  options: {
    icon: React.ReactNode;
    title: string;
    description: string;
    onClick: () => void;
  }[];
}

export const ImportModal: React.FC<ImportModalProps> = ({ onClose, options }) => {
  const modalContent = (
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[300] flex justify-center items-start sm:items-center overflow-y-auto p-4 py-12"
      onClick={onClose}
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl max-w-lg w-full p-6 my-auto relative z-[310]"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            Центр импорта
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-zinc-400 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {options.map((option, i) => (
            <button 
              key={i}
              onClick={() => { option.onClick(); onClose(); }}
              className="flex items-center gap-4 p-3 bg-zinc-800/50 hover:bg-zinc-800 rounded-xl border border-white/5 transition-all text-left cursor-pointer"
            >
              <div className="p-2 bg-white/5 rounded-lg">
                {option.icon}
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold text-white">{option.title}</div>
                <div className="text-xs text-zinc-400">{option.description}</div>
              </div>
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};

