import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
// Self-hosted rather than fetched from a font service, so sign-in never
// waits on a third party -- and a shared branch device never contacts one
// on a customer's behalf.
import '@fontsource-variable/figtree';
import './index.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element #root is missing from index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
