/** @safehouse/web entry. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { reloadOnStaleChunk } from './staleChunks.js';
import '@material-symbols/font-400/outlined.css';
import './index.css';

reloadOnStaleChunk(window);

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
