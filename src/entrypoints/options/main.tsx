import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/dashboard/App';
import '@/ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
