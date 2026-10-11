import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PopupApp } from '@/popup/PopupApp';
import '@/ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>,
);
