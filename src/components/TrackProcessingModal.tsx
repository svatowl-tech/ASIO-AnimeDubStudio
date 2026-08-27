import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, Trash2, Settings2, Check, Copy } from 'lucide-react';
import { cn } from '../lib/utils';
import { TrackProcessing } from '../types';

interface ProcessingPreset {
  id: string;
  name: string;
  settings: TrackProcessing;
  isCustom?: boolean;
}

const DEFAULT_PRESETS: ProcessingPreset[] = [
  {
    id: 'clean-voice',
    name: 'Чистый голос',
    settings: {
      enabled: true,
      lufsNormalize: { enabled: true, target: -16 },
      noiseGate: { enabled: true, threshold: -45 },
      compressor: { enabled: true, threshold: -20, ratio: 4 },
      eq: { enabled: true, highPass: 80 },
      fades: { enabled: true, duration: 50 }
    }
  },
  {
    id: 'raw',
    name: 'Без обработки',
    settings: {
      enabled: false
    }
  },
  {
    id: 'broadcast',
    name: 'Радио-эфир',
    settings: {
      enabled: true,
      lufsNormalize: { enabled: true, target: -14 },
      noiseGate: { enabled: true, threshold: -40 },
      compressor: { enabled: true, threshold: -24, ratio: 6 },
      eq: { enabled: true, highPass: 100, lowPass: 15000 },
      fades: { enabled: true, duration: 20 }
    }
  }
];

import { useUIState } from '../contexts/UIContext';
import { useProjectData } from '../contexts/ProjectContext';

export const TrackProcessingModal = () => {
  const { activeModal, setActiveModal, processingTrackId, setProcessingTrackId } = useUIState();
  const { project, setProject } = useProjectData();
  
  const isOpen = activeModal === 'processing' && !!processingTrackId;
  const track = project?.tracks.find(t => t.id === processingTrackId);
  const trackName = track?.name || '';
  const initialSettings = track?.processing || { enabled: false };

  const onClose = () => {
    setActiveModal(null);
    setProcessingTrackId(null);
  };

  const onSave = (settings: TrackProcessing) => {
    if (!project || !processingTrackId) return;
    const newTracks = (project.tracks || []).map(t => 
      t.id === processingTrackId ? { ...t, processing: settings } : t
    );
    setProject({ ...project, tracks: newTracks });
    onClose();
  };

  const [settings, setSettings] = useState<TrackProcessing>(initialSettings);
  const [presets, setPresets] = useState<ProcessingPreset[]>([]);
  const [presetName, setPresetName] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('dubstudio_presets');
    const customPresets = saved ? JSON.parse(saved) : [];
    setPresets([...DEFAULT_PRESETS, ...customPresets]);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setSettings(initialSettings || { enabled: false });
      setPresetName('');
    }
  }, [isOpen, initialSettings]);

  const savePreset = () => {
    if (!presetName) return;
    const newPreset: ProcessingPreset = {
      id: `custom-${Date.now()}`,
      name: presetName,
      settings: { ...settings },
      isCustom: true
    };
    const updated = [...presets.filter(p => p.isCustom), newPreset];
    localStorage.setItem('dubstudio_presets', JSON.stringify(updated));
    setPresets([...DEFAULT_PRESETS, ...updated]);
    setPresetName('');
  };

  const deletePreset = (id: string) => {
    const updated = presets.filter(p => p.id !== id && p.isCustom);
    localStorage.setItem('dubstudio_presets', JSON.stringify(updated));
    setPresets([...DEFAULT_PRESETS, ...updated]);
  };

  const applyPreset = (preset: ProcessingPreset) => {
    setSettings({ ...preset.settings });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-zinc-800/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                  <Settings2 className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Обработка дорожки</h2>
                  <p className="text-xs text-zinc-500">Настройка эффектов для "{trackName}"</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                <X className="w-6 h-6 text-zinc-500" />
              </button>
            </div>

            <div className="flex-1 overflow-hidden flex">
              {/* Sidebar: Presets */}
              <div className="w-64 border-r border-white/5 p-6 bg-black/20 overflow-y-auto">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">Шаблоны</h3>
                <div className="space-y-2">
                  {presets.map(p => (
                    <div key={p.id} className="group relative">
                      <button
                        onClick={() => applyPreset(p)}
                        className={cn(
                          "w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center justify-between",
                          JSON.stringify(p.settings) === JSON.stringify(settings)
                            ? "bg-indigo-600 text-white"
                            : "hover:bg-white/5 text-zinc-400"
                        )}
                      >
                        <span className="truncate pr-4">{p.name}</span>
                        {JSON.stringify(p.settings) === JSON.stringify(settings) && <Check className="w-3.5 h-3.5" />}
                      </button>
                      {p.isCustom && (
                        <button 
                          onClick={() => deletePreset(p.id)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-rose-500 opacity-0 group-hover:opacity-100 hover:bg-rose-500/10 rounded"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-8 pt-6 border-t border-white/5">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">Создать шаблон</h3>
                  <div className="space-y-3">
                    <input 
                      type="text" 
                      placeholder="Название..."
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none transition-all"
                    />
                    <button 
                      onClick={savePreset}
                      disabled={!presetName}
                      className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
                    >
                      <Copy size={14} /> Сохранить текущие
                    </button>
                  </div>
                </div>
              </div>

              {/* Main Content: Settings */}
              <div className="flex-1 p-8 overflow-y-auto space-y-8">
                {/* Global Toggle */}
                <div className="flex items-center justify-between p-4 bg-indigo-500/5 border border-indigo-500/20 rounded-xl mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-white">Включить обработку</h3>
                    <p className="text-xs text-zinc-500">Применить цепочку эффектов при экспорте</p>
                  </div>
                  <button 
                    onClick={() => setSettings(s => ({ ...s, enabled: !s.enabled }))}
                    className={cn(
                      "w-12 h-6 rounded-full transition-all relative",
                      settings.enabled ? "bg-indigo-600" : "bg-zinc-700"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                      settings.enabled ? "left-7" : "left-1"
                    )} />
                  </button>
                </div>

                <div className={cn("space-y-6 transition-all", !settings.enabled && "opacity-40 grayscale")}>
                  {/* LUFS Normalize */}
                  <section className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black uppercase tracking-widest text-zinc-400">Нормализация (LUFS)</h4>
                      <input 
                        type="checkbox" 
                        checked={settings.lufsNormalize?.enabled} 
                        onChange={e => setSettings(s => ({ ...s, lufsNormalize: { ...s.lufsNormalize, enabled: e.target.checked } }))}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] text-zinc-500 uppercase font-bold">Цель (dB)</label>
                        <input 
                          type="number" 
                          value={typeof settings.lufsNormalize?.target === 'number' && !isNaN(settings.lufsNormalize.target) ? settings.lufsNormalize.target : -16}
                          onChange={e => {
                            const val = Number(e.target.value);
                            setSettings(s => ({ ...s, lufsNormalize: { ...s.lufsNormalize, target: isNaN(val) ? -16 : val } }));
                          }}
                          className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
                        />
                      </div>
                    </div>
                  </section>

                  {/* Noise Gate */}
                  <section className="space-y-4 pt-6 border-t border-white/5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black uppercase tracking-widest text-zinc-400">Noise Gate (Шумоподавление)</h4>
                      <input 
                        type="checkbox" 
                        checked={settings.noiseGate?.enabled} 
                        onChange={e => setSettings(s => ({ ...s, noiseGate: { ...s.noiseGate, enabled: e.target.checked } }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px] text-zinc-500 uppercase font-bold">
                        <span>Порог (dB)</span>
                        <span>{typeof settings.noiseGate?.threshold === 'number' && !isNaN(settings.noiseGate.threshold) ? settings.noiseGate.threshold : -45} dB</span>
                      </div>
                      <input 
                        type="range" min="-100" max="0" step="1"
                        value={typeof settings.noiseGate?.threshold === 'number' && !isNaN(settings.noiseGate.threshold) ? settings.noiseGate.threshold : -45}
                        onChange={e => {
                          const val = Number(e.target.value);
                          setSettings(s => ({ ...s, noiseGate: { ...s.noiseGate, threshold: isNaN(val) ? -45 : val } }));
                        }}
                        className="w-full accent-indigo-500"
                      />
                    </div>
                  </section>

                  {/* Compressor */}
                  <section className="space-y-4 pt-6 border-t border-white/5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black uppercase tracking-widest text-zinc-400">Компрессор</h4>
                      <input 
                        type="checkbox" 
                        checked={settings.compressor?.enabled} 
                        onChange={e => setSettings(s => ({ ...s, compressor: { ...s.compressor, enabled: e.target.checked } }))}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] text-zinc-500 uppercase font-bold">
                          <span>Порог (dB)</span>
                          <span>{typeof settings.compressor?.threshold === 'number' && !isNaN(settings.compressor.threshold) ? settings.compressor.threshold : -20} dB</span>
                        </div>
                        <input 
                          type="range" min="-60" max="0" step="1"
                          value={typeof settings.compressor?.threshold === 'number' && !isNaN(settings.compressor.threshold) ? settings.compressor.threshold : -20}
                          onChange={e => {
                            const val = Number(e.target.value);
                            setSettings(s => ({ ...s, compressor: { ...s.compressor, threshold: isNaN(val) ? -20 : val } }));
                          }}
                          className="w-full accent-indigo-500"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] text-zinc-500 uppercase font-bold">
                          <span>Ratio</span>
                          <span>{typeof settings.compressor?.ratio === 'number' && !isNaN(settings.compressor.ratio) ? settings.compressor.ratio : 4}:1</span>
                        </div>
                        <input 
                          type="range" min="1" max="20" step="0.5"
                          value={typeof settings.compressor?.ratio === 'number' && !isNaN(settings.compressor.ratio) ? settings.compressor.ratio : 4}
                          onChange={e => {
                            const val = Number(e.target.value);
                            setSettings(s => ({ ...s, compressor: { ...s.compressor, ratio: isNaN(val) ? 4 : val } }));
                          }}
                          className="w-full accent-indigo-500"
                        />
                      </div>
                    </div>
                  </section>

                  {/* EQ */}
                  <section className="space-y-4 pt-6 border-t border-white/5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black uppercase tracking-widest text-zinc-400">Эквалайзер (Фильтры)</h4>
                      <input 
                        type="checkbox" 
                        checked={settings.eq?.enabled} 
                        onChange={e => setSettings(s => ({ ...s, eq: { ...s.eq, enabled: e.target.checked } }))}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-[10px] text-zinc-500 uppercase font-bold">High Pass (Hz)</label>
                        <input 
                          type="number" 
                          value={typeof settings.eq?.highPass === 'number' && !isNaN(settings.eq.highPass) ? settings.eq.highPass : 80}
                          onChange={e => {
                            const val = Number(e.target.value);
                            setSettings(s => ({ ...s, eq: { ...s.eq, highPass: isNaN(val) ? 80 : val } }));
                          }}
                          className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] text-zinc-500 uppercase font-bold">Low Pass (Hz)</label>
                        <input 
                          type="number" 
                          value={typeof settings.eq?.lowPass === 'number' && !isNaN(settings.eq.lowPass) ? settings.eq.lowPass : 20000}
                          onChange={e => {
                            const val = Number(e.target.value);
                            setSettings(s => ({ ...s, eq: { ...s.eq, lowPass: isNaN(val) ? 20000 : val } }));
                          }}
                          className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
                        />
                      </div>
                    </div>
                  </section>

                  {/* Fades */}
                  <section className="space-y-4 pt-6 border-t border-white/5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black uppercase tracking-widest text-zinc-400">Кроссфейды (Склейки)</h4>
                      <input 
                        type="checkbox" 
                        checked={settings.fades?.enabled} 
                        onChange={e => setSettings(s => ({ ...s, fades: { ...s.fades, enabled: e.target.checked } }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px] text-zinc-500 uppercase font-bold">
                        <span>Длительность (ms)</span>
                        <span>{typeof settings.fades?.duration === 'number' && !isNaN(settings.fades.duration) ? settings.fades.duration : 50} ms</span>
                      </div>
                      <input 
                        type="range" min="0" max="500" step="5"
                        value={typeof settings.fades?.duration === 'number' && !isNaN(settings.fades.duration) ? settings.fades.duration : 50}
                        onChange={e => {
                          const val = Number(e.target.value);
                          setSettings(s => ({ ...s, fades: { ...s.fades, duration: isNaN(val) ? 50 : val } }));
                        }}
                        className="w-full accent-indigo-500"
                      />
                    </div>
                  </section>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/5 bg-black/40 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl text-sm font-bold text-zinc-400 hover:text-white hover:bg-white/5 transition-all"
          >
            Отмена
          </button>
          <button 
            onClick={() => {
              onSave(settings);
              onClose();
            }}
            className="px-8 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-2"
          >
            <Save size={18} /> Применить настройки
          </button>
        </div>
      </motion.div>
    </div>
  )}
</AnimatePresence>
  );
};
