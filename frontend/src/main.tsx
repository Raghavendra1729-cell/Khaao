import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-mono/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
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
