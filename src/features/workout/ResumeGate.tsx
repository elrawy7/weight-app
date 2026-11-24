/** WO-11 AC2: after the app was closed or killed mid-workout, offer a full-screen Resume on launch. */
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Modal, Stack, Text, Title, ThemeIcon } from '@mantine/core';
import { IconBarbell } from '@tabler/icons-react';
import { useDb } from '../../app/db';
import { t } from '../../i18n';
import { formatDate } from '../../domain/dates';
import type { WorkoutSession } from '../../db/types';
import { activeSession } from './workoutOps';

export function ResumeGate() {
  const db = useDb();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const checked = useRef(false);
  const [s, setS] = useState<{ session: WorkoutSession; name: string } | null>(null);
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    if (pathname.startsWith('/workout/')) return;
    void (async () => {
      const a = await activeSession(db);
      if (!a) return;
      const tpl = a.templateId ? await db.templates.get(a.templateId) : undefined;
      setS({ session: a, name: tpl?.name ?? t('wo.emptyName') });
    })();
  }, [db, pathname]);
  if (!s) return null;
  return (
    <Modal opened fullScreen onClose={() => setS(null)} withCloseButton={false} data-testid="resume-gate">
      <Stack align="center" justify="center" mih="80vh" ta="center" gap="md">
        <ThemeIcon size={72} radius="xl" variant="light"><IconBarbell size={40} /></ThemeIcon>
        <Title order={2}>{t('wo.resumeTitle')}</Title>
        <Text c="dimmed">{t('wo.resumeBody', { name: s.name, date: formatDate(s.session.localDate) })}</Text>
        <Button size="lg" fullWidth maw={360} onClick={() => { const id = s.session.id; setS(null); nav(`/workout/${id}`); }} data-testid="resume-go">{t('wo.resume')}</Button>
        <Button size="lg" fullWidth maw={360} variant="default" onClick={() => setS(null)} data-testid="resume-later">{t('wo.notNow')}</Button>
      </Stack>
    </Modal>
  );
}
