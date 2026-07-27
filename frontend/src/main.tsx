import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
// English + Hindi only — Hindi already falls back to the system font (IBM
// Plex ships no Devanagari family), so only the latin/latin-ext subsets can
// ever render a glyph here. The full @fontsource CSS also pulls cyrillic,
// cyrillic-ext, greek and vietnamese subsets that are pure precache weight
// (§ 9.8-W6). Kept the same weight set as before (mono 500/600/700, sans
// 400/500/600/700) — several `font-display` elements carry no explicit
// weight class and rely on the browser's font-matching fallback to the
// nearest *registered* weight (500), so dropping mono-500 would silently
// make that text heavier, not just save bytes.
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-ext-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-ext-600.css';
import '@fontsource/ibm-plex-mono/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-ext-700.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-ext-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-ext-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-ext-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-sans/latin-ext-700.css';
import './index.css';
import App from './App.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import { ToastProvider } from './components/ui/Toast.tsx';
import { ErrorBoundary } from './components/layout/ErrorBoundary.tsx';
import { unlockAudioOnFirstTouch } from './lib/sound.ts';
// Side-effecting import: registers the `beforeinstallprompt`/`appinstalled`
// listeners at MODULE SCOPE, before React mounts (STATUS.md § 9.7 P2/P6).
// `beforeinstallprompt` can fire before any component ever mounts — a
// listener registered inside a component (the old InstallPrompt.tsx shape)
// misses it on every render after the first with nothing listening, which is
// why the old install card was one-shot. Importing here, ahead of
// `createRoot(...).render(...)`, is what makes the capture reliable.
import './lib/install.ts';

unlockAudioOnFirstTouch();

// Installable PWA: precache the shell, auto-update in the background.
registerSW({ immediate: true });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </QueryClientProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
