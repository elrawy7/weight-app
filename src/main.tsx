import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './app/styles.css';
import { theme } from './app/theme';
import { App } from './app/App';
import { RecoveryScreen } from './app/Recovery';
import { openDatabase } from './db/open';
import { ensureSeed } from './db/seed';
import { requestPersistence } from './features/settings/storage';
import { initServiceWorker } from './pwa/update';
import { maintenance } from './features/progress/recordsOps';

const root = createRoot(document.getElementById('root')!);

async function boot() {
  initServiceWorker();
  const r = await openDatabase();
  if (!r.ok) {
    root.render(<MantineProvider theme={theme} defaultColorScheme="dark"><RecoveryScreen error={r.error} /></MantineProvider>);
    return;
  }
  try {
    await ensureSeed(r.db);
    await maintenance(r.db); // Phase 3: purge discarded > 30 days, build PRs once
  } catch (e) {
    root.render(<MantineProvider theme={theme} defaultColorScheme="dark"><RecoveryScreen error={e as Error} /></MantineProvider>);
    return;
  }
  void requestPersistence(r.db); // PWA-04 AC1 – result stored in settings
  (window as unknown as { __weightDb?: unknown }).__weightDb = import.meta.env.DEV || new URLSearchParams(location.search).has('e2e') ? r.db : undefined;
  root.render(<StrictMode><App db={r.db} /></StrictMode>);
}

boot().catch((e) => root.render(<MantineProvider theme={theme} defaultColorScheme="dark"><RecoveryScreen error={e as Error} /></MantineProvider>));
