import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { ActionIcon, Badge, Button, Card, Group, Menu, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDots, IconPlus, IconTrash, IconCalendar } from '@tabler/icons-react';
import { useDb } from '../../app/db';
import { t } from '../../i18n';
import { formatDate, nowIso } from '../../domain/dates';
import { WEEKDAYS, type WeekPhase } from '../../db/types';
import { ConfirmSheet, EmptyState, ExerciseCard, PageHeader, Section } from '../../components/ui';
import * as P from './programOps';
import * as R from '../../db/repos';

const statusColor = { active: 'mint', draft: 'blue', archived: 'gray' } as const;
const err = (e: unknown) => notifications.show({ color: 'red', message: e instanceof Error ? e.message : t('common.error') });

export function ProgramsPage() {
  const db = useDb();
  const nav = useNavigate();
  const list = useLiveQuery(async () => {
    const ps = await db.programs.toArray();
    return Promise.all(ps.map(async (p) => ({ p, n: await db.templates.where('programId').equals(p.id).count() })));
  }, [db]);
  const [name, setName] = useState('');
  if (!list) return null;
  const order = { active: 0, draft: 1, archived: 2 };
  return (
    <>
      <PageHeader title={t('prog.title')} back="/more" />
      <Stack gap="sm">
        {list.length === 0 && <EmptyState icon={<IconCalendar />} title={t('prog.empty')} body={t('prog.emptyBody')} action={<Button variant="light" onClick={() => nav('/import')}>{t('today.import')}</Button>} />}
        {list.sort((a, b) => order[a.p.status] - order[b.p.status]).map(({ p, n }) => (
          <ExerciseCard key={p.id} title={p.name} onClick={() => nav(`/programs/${p.id}`)} testId="program-item"
            meta={`${p.startDate && p.endDate ? t('prog.window', { start: formatDate(p.startDate), end: formatDate(p.endDate) }) + ' · ' : ''}${t('prog.templateCount', { n })}`}
            badges={<Badge color={statusColor[p.status]} variant="light">{t(`prog.${p.status}`)}</Badge>} />
        ))}
        <Card withBorder padding="sm">
          <Group align="flex-end" wrap="nowrap">
            <TextInput style={{ flex: 1 }} label={t('prog.newName')} value={name} onChange={(e) => setName(e.currentTarget.value)} data-testid="new-program-name" />
            <Button leftSection={<IconPlus size={18} />} disabled={!name.trim()} onClick={() => void P.createProgram(db, name).then((p) => { setName(''); nav(`/programs/${p.id}`); }).catch(err)}>{t('common.add')}</Button>
          </Group>
        </Card>
      </Stack>
    </>
  );
}

export function ProgramDetailPage() {
  const { id = '' } = useParams();
  const db = useDb();
  const nav = useNavigate();
  const d = useLiveQuery(async () => {
    const p = await db.programs.get(id);
    if (!p) return { p: null } as const;
    const templates = await R.templatesOfProgram(db, id);
    const counts = await Promise.all(templates.map((x) => db.templateExercises.where('templateId').equals(x.id).count()));
    const schedule = await db.schedules.where('programId').equals(id).first();
    return { p, templates, counts, schedule } as const;
  }, [db, id]);
  const [tplName, setTplName] = useState('');
  const [del, setDel] = useState<{ id: string; name: string } | null>(null);
  const [exc, setExc] = useState({ date: '', templateId: '', note: '' });
  if (!d) return null;
  if (!d.p) return <><PageHeader title={t('prog.notFound')} back="/programs" /><EmptyState title={t('prog.notFound')} /></>;
  const { p, templates, counts, schedule } = d;
  const tplOptions = [{ value: '', label: t('prog.restDay') }, ...templates.map((x) => ({ value: x.id, label: x.name }))];
  const tplName_ = (tid: string | null) => templates.find((x) => x.id === tid)?.name ?? t('prog.restDay');
  const updateWeek = (i: number, patch: Partial<WeekPhase>) => void db.programs.update(p.id, { weeks: p.weeks.map((w, j) => (j === i ? { ...w, ...patch } : w)), updatedAt: nowIso() });

  return (
    <>
      <PageHeader title={p.name} back="/programs" subtitle={<Badge color={statusColor[p.status]} variant="light">{t(`prog.${p.status}`)}</Badge>}
        right={<Menu position="bottom-end"><Menu.Target><ActionIcon aria-label={t('common.edit')} data-testid="program-menu"><IconDots /></ActionIcon></Menu.Target>
          <Menu.Dropdown>
            {p.status !== 'active' && <Menu.Item onClick={() => void P.setProgramStatus(db, p.id, 'active')}>{t('prog.setActive')}</Menu.Item>}
            <Menu.Item onClick={() => void P.duplicateProgram(db, p.id).then((c) => { notifications.show({ message: t('prog.duplicated') }); nav(`/programs/${c.id}`); })}>{t('prog.duplicate')}</Menu.Item>
            {p.status !== 'archived' && <Menu.Item onClick={() => void P.setProgramStatus(db, p.id, 'archived')}>{t('prog.archive')}</Menu.Item>}
          </Menu.Dropdown></Menu>} />
      <Stack gap="xs">
        {p.startDate && p.endDate && <Text c="dimmed" fz="sm">{t('prog.window', { start: formatDate(p.startDate), end: formatDate(p.endDate) })}</Text>}
        {p.progressionRule && <Card withBorder padding="sm"><Text fz="xs" tt="uppercase" fw={700} c="dimmed">{t('prog.rule')}</Text><Text fz="sm">{p.progressionRule}</Text></Card>}
      </Stack>

      <Section title={t('prog.templates')}>
        {templates.map((x, i) => (
          <ExerciseCard key={x.id} title={x.name} meta={`${x.focus ? x.focus + ' · ' : ''}${t('prog.rows', { n: counts[i] })}`} onClick={() => nav(`/templates/${x.id}`)} testId="template-item"
            right={<ActionIcon aria-label={`${t('prog.deleteTemplate')} ${x.name}`} color="red" onClick={(e) => { e.stopPropagation(); setDel({ id: x.id, name: x.name }); }}><IconTrash size={20} /></ActionIcon>} />
        ))}
        <Group align="flex-end" wrap="nowrap">
          <TextInput style={{ flex: 1 }} label={t('prog.templateName')} value={tplName} onChange={(e) => setTplName(e.currentTarget.value)} />
          <Button leftSection={<IconPlus size={18} />} disabled={!tplName.trim()} onClick={() => void P.addTemplate(db, p.id, tplName).then(() => setTplName('')).catch(err)}>{t('prog.addTemplate')}</Button>
        </Group>
      </Section>

      {p.weeks.length > 0 && (
        <Section title={t('prog.weeks')}>
          <Card withBorder padding="xs">
            <Table verticalSpacing={6}>
              <Table.Tbody>
                {p.weeks.map((w, i) => (
                  <Table.Tr key={w.week} data-testid="week-row">
                    <Table.Td><Text fw={700}>{t('common.week', { n: w.week })}</Text><Text fz="xs" c="dimmed">{t('prog.weekRange', { start: formatDate(w.startDate), end: formatDate(w.endDate) })}</Text></Table.Td>
                    <Table.Td><TextInput aria-label={`${t('prog.phaseName')} ${w.week}`} defaultValue={w.phase} onBlur={(e) => updateWeek(i, { phase: e.currentTarget.value })} /></Table.Td>
                    <Table.Td w={90}><TextInput aria-label={`${t('prog.phaseRpe')} ${w.week}`} defaultValue={w.rpe} onBlur={(e) => updateWeek(i, { rpe: e.currentTarget.value })} /></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        </Section>
      )}

      {schedule && (
        <>
          <Section title={t('prog.schedule')}>
            <Card withBorder padding="sm"><Stack gap={6}>
              {WEEKDAYS.map((wd) => (
                <Group key={wd} justify="space-between" wrap="nowrap">
                  <Text fw={600} w={60}>{wd}</Text>
                  <Select style={{ flex: 1 }} aria-label={`${t('prog.schedule')} ${wd}`} data={tplOptions} value={schedule.pattern[wd] ?? ''} onChange={(v) => void P.setPattern(db, schedule.id, wd, v || null)} data-testid={`pattern-${wd}`} />
                </Group>
              ))}
            </Stack></Card>
          </Section>
          <Section title={t('prog.exceptions')}>
            {schedule.exceptions.map((e) => (
              <Card key={e.date} withBorder padding="xs" data-testid="exception-item"><Group justify="space-between" wrap="nowrap">
                <div><Text fw={600}>{formatDate(e.date)} · {tplName_(e.templateId)}</Text><Text fz="xs" c="dimmed">{e.note}</Text></div>
                <ActionIcon color="red" aria-label={`${t('common.remove')} ${e.date}`} onClick={() => void P.removeException(db, schedule.id, e.date)}><IconTrash size={20} /></ActionIcon>
              </Group></Card>
            ))}
            <Card withBorder padding="sm"><Stack gap="xs">
              <TextInput type="date" label={t('prog.exceptionDate')} value={exc.date} onChange={(e) => setExc({ ...exc, date: e.currentTarget.value })} />
              <Select label={t('prog.exceptionWorkout')} data={tplOptions} value={exc.templateId} onChange={(v) => setExc({ ...exc, templateId: v ?? '' })} />
              <TextInput label={t('prog.exceptionNote')} value={exc.note} onChange={(e) => setExc({ ...exc, note: e.currentTarget.value })} />
              <Button variant="light" disabled={!exc.date} onClick={() => void P.upsertException(db, schedule.id, { date: exc.date, templateId: exc.templateId || null, note: exc.note }).then(() => setExc({ date: '', templateId: '', note: '' })).catch(err)}>{t('prog.addException')}</Button>
            </Stack></Card>
          </Section>
          {schedule.planned.length > 0 && (
            <Section title={t('prog.planned')}>
              <Card withBorder padding="xs"><Table verticalSpacing={4} fz="sm"><Table.Tbody>
                {schedule.planned.map((x) => <Table.Tr key={x.date}><Table.Td>{formatDate(x.date)}</Table.Td><Table.Td>{tplName_(x.templateId)}</Table.Td><Table.Td c="dimmed">{t('common.weekShort', { n: x.week })} · {x.targetRpe}</Table.Td></Table.Tr>)}
              </Table.Tbody></Table></Card>
            </Section>
          )}
        </>
      )}
      <ConfirmSheet opened={!!del} danger title={t('prog.deleteTemplate')} body={t('prog.deleteTemplateBody', { name: del?.name ?? '' })} confirmLabel={t('common.delete')}
        onClose={() => setDel(null)} onConfirm={() => void P.deleteTemplate(db, del!.id).then(() => setDel(null))} />
    </>
  );
}
