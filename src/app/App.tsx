import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { MantineProvider, useMantineColorScheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { theme } from './theme';
import { DbProvider, useSettings } from './db';
import { Shell } from './Shell';
import type { WeightDB } from '../db/schema';
import { TodayPage } from '../features/today/TodayPage';
import { PlanPage } from '../features/today/PlanPage';
import { WorkoutPage } from '../features/workout/WorkoutPage';

/* NFR-PERF-05: only the gym path (Today, plan, workout) loads up front; every other screen is its own chunk.
   The service worker precaches all chunks, so they still open offline. */
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));
const HistoryPage = page(() => import('../features/history/HistoryPage'), 'HistoryPage');
const SessionDetailPage = page(() => import('../features/history/SessionDetailPage'), 'SessionDetailPage');
const ComparePage = page(() => import('../features/history/ComparePage'), 'ComparePage');
const LibraryPage = page(() => import('../features/library/LibraryPage'), 'LibraryPage');
const ExerciseDetailPage = page(() => import('../features/library/ExerciseDetailPage'), 'ExerciseDetailPage');
const NewExercisePage = page(() => import('../features/library/NewExercisePage'), 'NewExercisePage');
const ProgressPage = page(() => import('../features/progress/ProgressPage'), 'ProgressPage');
const ExerciseProgressPage = page(() => import('../features/progress/ExerciseProgressPage'), 'ExerciseProgressPage');
const RecordsPage = page(() => import('../features/progress/RecordsPage'), 'RecordsPage');
const MusclesPage = page(() => import('../features/progress/MusclesPage'), 'MusclesPage');
const MorePage = page(() => import('../features/more/MorePages'), 'MorePage');
const SettingsPage = page(() => import('../features/more/MorePages'), 'SettingsPage');
const EquipmentPage = page(() => import('../features/more/MorePages'), 'EquipmentPage');
const StoragePage = page(() => import('../features/more/MorePages'), 'StoragePage');
const InstallPage = page(() => import('../features/more/MorePages'), 'InstallPage');
const ProgramsPage = page(() => import('../features/programs/ProgramsPage'), 'ProgramsPage');
const ProgramDetailPage = page(() => import('../features/programs/ProgramsPage'), 'ProgramDetailPage');
const TemplateEditorPage = page(() => import('../features/programs/TemplateEditorPage'), 'TemplateEditorPage');
const BackupPage = page(() => import('../features/backup/BackupPage'), 'BackupPage');
const ImportPage = page(() => import('../features/import/ImportPages'), 'ImportPage');
const MigrationReportPage = page(() => import('../features/import/ImportPages'), 'MigrationReportPage');
const GalleryPage = page(() => import('../features/dev/GalleryPage'), 'GalleryPage');

/** SET-01 AC2: theme follows the setting; "system" follows iOS appearance. */
function ThemeSync() {
  const s = useSettings();
  const { setColorScheme } = useMantineColorScheme();
  useEffect(() => { setColorScheme(s.theme === 'system' ? 'auto' : s.theme); }, [s.theme, setColorScheme]);
  return null;
}

export function App({ db }: { db: WeightDB }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <Notifications position="top-center" />
      <DbProvider db={db}>
        <ThemeSync />
        <HashRouter>
          <Shell>
            <Suspense fallback={null}>
            <Routes>
              <Route path="/" element={<TodayPage />} />
              <Route path="/plan" element={<PlanPage />} />
              <Route path="/workout/:id" element={<WorkoutPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/history/compare" element={<ComparePage />} />
              <Route path="/history/:id" element={<SessionDetailPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/library/new" element={<NewExercisePage />} />
              <Route path="/library/:id" element={<ExerciseDetailPage />} />
              <Route path="/progress" element={<ProgressPage />} />
              <Route path="/progress/exercise/:id" element={<ExerciseProgressPage />} />
              <Route path="/progress/records" element={<RecordsPage />} />
              <Route path="/progress/muscles" element={<MusclesPage />} />
              <Route path="/more" element={<MorePage />} />
              <Route path="/programs" element={<ProgramsPage />} />
              <Route path="/programs/:id" element={<ProgramDetailPage />} />
              <Route path="/templates/:id" element={<TemplateEditorPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/equipment" element={<EquipmentPage />} />
              <Route path="/settings/storage" element={<StoragePage />} />
              <Route path="/backup" element={<BackupPage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/migration" element={<MigrationReportPage />} />
              <Route path="/install" element={<InstallPage />} />
              <Route path="/dev/components" element={<GalleryPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </Shell>
        </HashRouter>
      </DbProvider>
    </MantineProvider>
  );
}
