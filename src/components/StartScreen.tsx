import React from 'react';
import { Plus, FolderOpen, Play } from 'lucide-react';

interface StartScreenProps {
  onNewProject: () => void;
  onOpenProject: () => void;
  recentProjects: { name: string; path: string }[];
}

export const StartScreen: React.FC<StartScreenProps> = ({ onNewProject, onOpenProject, recentProjects }) => {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 text-white p-8">
      <h1 className="text-4xl font-black mb-12">DubStudio Pro</h1>
      
      <div className="grid grid-cols-2 gap-8 w-full max-w-2xl">
        <button 
          onClick={onNewProject}
          className="flex flex-col items-center justify-center p-8 bg-zinc-900 border border-white/10 rounded-2xl hover:bg-indigo-900/20 transition-all group"
          title="Создать новый проект"
        >
          <Plus className="w-12 h-12 mb-4 text-indigo-500" />
          <span className="text-lg font-bold">Начать новый проект</span>
        </button>
        
        <button 
          onClick={onOpenProject}
          className="flex flex-col items-center justify-center p-8 bg-zinc-900 border border-white/10 rounded-2xl hover:bg-indigo-900/20 transition-all group"
          title="Открыть существующий проект"
        >
          <FolderOpen className="w-12 h-12 mb-4 text-indigo-500" />
          <span className="text-lg font-bold">Открыть проект</span>
        </button>
      </div>

      {recentProjects.length > 0 && (
        <div className="mt-12 w-full max-w-2xl">
          <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-widest mb-4">Недавние проекты</h2>
          <div className="space-y-2">
            {recentProjects.map((proj, i) => (
              <div key={i} className="flex items-center justify-between p-4 bg-zinc-900 border border-white/10 rounded-xl">
                <span className="font-medium">{proj.name}</span>
                <button className="p-2 hover:bg-white/10 rounded-lg" title="Открыть проект"><Play className="w-4 h-4 text-indigo-500" /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
