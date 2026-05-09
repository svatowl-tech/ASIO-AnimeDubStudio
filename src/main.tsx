import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { setupTauriLegacyWrapper } from './lib/tauriLegacyWrapper.ts';

// Bridge the legacy electron API so existing code doesn't crash
setupTauriLegacyWrapper();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
