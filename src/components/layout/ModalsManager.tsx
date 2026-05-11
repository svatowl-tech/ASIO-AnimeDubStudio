import React from 'react';
import { useUIState } from '../../contexts/UIContext';
import QuickImportModal from '../QuickImportModal';
import { TrackProcessingModal } from '../TrackProcessingModal';
import SettingsModal from '../SettingsModal';
import ExportModal from '../ExportModal';
import ExportOverlay from './ExportOverlay';
import { ProjectHealthManager } from '../ProjectHealthManager';

export const ModalsManager: React.FC = () => {
  return (
    <>
      <TrackProcessingModal />
      <SettingsModal />
      <ProjectHealthManager />
    </>
  );
};

export default ModalsManager;
