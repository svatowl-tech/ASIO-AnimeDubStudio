import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import StudioModeApp from './StudioModeApp.tsx';
import './index.css';
import { setupTauriLegacyWrapper } from './lib/tauriLegacyWrapper.ts';

// Global shortcut blocker to prevent accidental project close via Ctrl+R/F5
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyR' || e.key.toLowerCase() === 'r')) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (e.code === 'F5') {
    e.preventDefault();
    e.stopPropagation();
  }
}, { capture: true });

// Bridge the legacy electron API so existing code doesn't crash
setupTauriLegacyWrapper();

const isStudioMode = window.location.search.includes('mode=studio');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isStudioMode ? <StudioModeApp /> : <App />}
  </StrictMode>,
);
