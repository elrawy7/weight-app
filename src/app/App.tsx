import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { MantineProvider, useMantineColorScheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { theme } from './theme';
import { DbProvider, useSettings } from './db';
import { Shell } from './Shell';
import type { WeightDB } from '../db/schema';
import { TodayPage } from '../features/today/TodayPage';
import { HistoryPage } from '../features/history/HistoryPage';
import { LibraryPage } from '../features/library/LibraryPage';
import { ExerciseDetailPage } from '../features/library/ExerciseDetailPage';
import { NewExercisePage } from '../features/library/NewExercisePage';
import { ProgressPage } from '../features/progress/ProgressPage';
import { MorePage, SettingsPage, EquipmentPage, StoragePage, InstallPage } from '../features/more/MorePages';
import { ProgramsPage, ProgramDetailPage } from '../features/programs/ProgramsPage';
import { TemplateEditorPage } from '../features/programs/TemplateEditorPage';
import { BackupPage } from '../features/backup/BackupPage';
import { ImportPage, MigrationReportPage } from '../features/import/ImportPages';
import { GalleryPage } from '../features/dev/GalleryPage';

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
            <Routes>
              <Route path="/" element={<TodayPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/library/new" element={<NewExercisePage />} />
              <Route path="/library/:id" element={<ExerciseDetailPage />} />
              <Route path="/progress" element={<ProgressPage />} />
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
          </Shell>
        </HashRouter>
      </DbProvider>
    </MantineProvider>
  );
}
