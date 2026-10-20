import React from 'react';
import ReactDOM from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import * as Tooltip from '@radix-ui/react-tooltip';
import '@fontsource/geist/400.css';
import '@fontsource/geist/500.css';
import '@fontsource/geist/600.css';
import './style.css';
import { About } from './About';
import { Auth } from './Auth';
import { setLanguage } from './i18n';
try {
  setLanguage(localStorage.getItem('ledger-language') === 'uz' ? 'uz' : 'ru');
} catch {
  setLanguage('ru');
}

try {
  const theme = localStorage.getItem('ledger-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  /* System theme remains active when storage is unavailable. */
}
// iOS Safari can ignore the viewport scale restriction: cancel multi-touch gestures too.
document.addEventListener('gesturestart', (event) => event.preventDefault(), { passive: false });
document.addEventListener('gesturechange', (event) => event.preventDefault(), { passive: false });
document.addEventListener(
  'touchmove',
  (event) => {
    if (event.touches.length > 1) event.preventDefault();
  },
  { passive: false },
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <Tooltip.Provider delayDuration={350}>
        {window.location.pathname === '/about' ? <About /> : <Auth />}
      </Tooltip.Provider>
    </MotionConfig>
  </React.StrictMode>,
);
