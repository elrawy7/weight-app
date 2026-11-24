import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useParams } from 'react-router-dom';
import { ActionIcon, Badge, Button, Card, Drawer, Group, NumberInput, Select, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconGripVertical, IconPlus, IconTrash, IconArrowUp, IconArrowDown, IconReplace, IconPencil } from '@tabler/icons-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDb } from '../../app/db';
import { t, type MsgKey } from '../../i18n';
import { nowIso } from '../../domain/dates';
import { EmptyState, PageHeader, Section } from '../../components/ui';
import { ExercisePicker } from '../../components/ExercisePicker';
import * as P from './programOps';
import * as R from '../../db/repos';
import type { Exercise, WarmupItem, WorkoutTemplateExercise } from '../../db/types';

const err = (e: unknown) => notifications.show({ color: 'red', message: e instanceof Error ? e.message : t('common.error') });

export function TemplateEditorPage() {
  const { id = '' } = useParams();
  const db = useDb();
  const d = useLiveQuery(async () => {
    const tp = await db.templates.get(id);
    if (!tp) return { tp: null } as const;
    const rows = await R.rowsOfTemplate(db, id);
    const exs = await db.exercises.bulkGet(rows.map((r) => r.exerciseId));
    const wex = await db.exercises.bulkGet(tp.warmup.map((w) => w.exerciseId ?? '__none'));
    const prog = await db.programs.get(tp.programId);
    const names = new Map((await db.exercises.toArray()).map((e) => [e.id, e.name]));
    return { tp, rows, names, exMap: new Map(exs.filter((e): e is Exercise => !!e).map((e) => [e.id, e])), wex, weeks: Math.max(1, prog?.weeksCount ?? rows[0]?.targetSetsByWeek.length ?? 1) } as const;
  }, [db, id]);
  const [order, setOrder] = useState<string[]>([]);
  const [picker, setPicker] = useState<null | { mode: 'add' } | { mode: 'replace'; rowId: string } | { mode: 'warmup'; index: number }>(null);
  const [edit, setEdit] = useState<WorkoutTemplateExercise | null>(null);
  const [warmEdit, setWarmEdit] = useState<WarmupItem[] | null>(null);
  useEffect(() => { if (d?.tp) setOrder(d.rows.map((r) => r.id)); }, [d]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  if (!d) return null;
  if (!d.tp) return <><PageHeader title={t('tpl.notFound')} back /><EmptyState title={t('tpl.notFound')} /></>;
  const { tp, rows, exMap, wex, weeks, names } = d;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = order.map((x) => byId.get(x)).filter((x): x is WorkoutTemplateExercise => !!x);

  const commitOrder = (ids: string[]) => { setOrder(ids); void P.reorderRows(db, tp.id, ids).catch(err); };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    commitOrder(arrayMove(order, order.indexOf(String(e.active.id)), order.indexOf(String(e.over.id))));
  };
  const move = (i: number, dir: -1 | 1) => { const j = i + dir; if (j < 0 || j >= order.length) return; commitOrder(arrayMove(order, i, j)); };

  return (
    <>
      <PageHeader title={tp.name} back={`/programs/${tp.programId}`} subtitle={tp.focus || undefined} />
      <TextInput label={t('tpl.focus')} defaultValue={tp.focus} onBlur={(e) => void db.templates.update(tp.id, { focus: e.currentTarget.value, updatedAt: nowIso() })} />

      <Section title={t('tpl.warmup')} right={<Button size="xs" variant="subtle" onClick={() => setWarmEdit(tp.warmup.map((w) => ({ ...w })))} leftSection={<IconPencil size={14} />} data-testid="edit-warmup">{t('tpl.editWarmup')}</Button>}>
        <Card withBorder padding="sm">
          {tp.warmup.length === 0 ? <Text c="dimmed" fz="sm">{t('common.none')}</Text> : (
            <Stack gap={4}>{tp.warmup.map((w, i) => <Group key={w.id} justify="space-between" wrap="nowrap" data-testid="warmup-row"><Text fz="sm" fw={500}>{wex[i]?.name ?? w.label}</Text><Text fz="sm" c="dimmed">{w.prescription}</Text></Group>)}</Stack>
          )}
        </Card>
      </Section>

      <Section title={t('today.exercises')} right={<Text fz="xs" c="dimmed">{t('common.reorder')}</Text>}>
        {ordered.length === 0 && <EmptyState title={t('tpl.empty')} body={t('tpl.emptyBody')} />}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <Stack gap="xs">
              {ordered.map((r, i) => (
                <SortableRow key={r.id} row={r} ex={exMap.get(r.exerciseId)} index={i} total={ordered.length} onMove={move} onEdit={() => setEdit({ ...r })} />
              ))}
            </Stack>
          </SortableContext>
        </DndContext>
        <Button leftSection={<IconPlus size={18} />} variant="light" size="lg" onClick={() => setPicker({ mode: 'add' })} data-testid="add-exercise">{t('tpl.addExercise')}</Button>
      </Section>

      <ExercisePicker opened={!!picker} onClose={() => setPicker(null)}
        onPick={(e) => {
          if (!picker) return;
          if (picker.mode === 'add') void P.addRow(db, tp.id, e.id).catch(err);
          else if (picker.mode === 'replace') void P.replaceRowExercise(db, picker.rowId, e.id);
          else if (warmEdit) setWarmEdit(warmEdit.map((w, j) => (j === picker.index ? { ...w, exerciseId: e.id, label: null } : w)));
        }} />

      <RowEditor row={edit} weeks={weeks} exName={edit ? exMap.get(edit.exerciseId)?.name ?? '' : ''} onClose={() => setEdit(null)}
        onReplace={() => { const rid = edit!.id; setEdit(null); setPicker({ mode: 'replace', rowId: rid }); }}
        onRemove={() => { const rid = edit!.id; setEdit(null); void P.removeRow(db, rid); }}
        onSave={(r) => void P.updateRow(db, r.id, { targetSetsByWeek: r.targetSetsByWeek, targetReps: r.targetReps, restSec: r.restSec, notes: r.notes, supersetGroup: r.supersetGroup, role: r.role }).then(() => setEdit(null)).catch(err)} />

      <Drawer opened={!!warmEdit} onClose={() => setWarmEdit(null)} size="90%" title={<Text fw={700}>{t('tpl.editWarmup')}</Text>} closeButtonProps={{ 'aria-label': t('common.close') }}>
        {warmEdit && (
          <Stack gap="sm">
            {warmEdit.map((w, i) => (
              <Card key={w.id || i} withBorder padding="xs"><Stack gap={6}>
                <Group justify="space-between" wrap="nowrap">
                  <Button variant="default" style={{ flex: 1 }} onClick={() => setPicker({ mode: 'warmup', index: i })}>{w.exerciseId ? (names.get(w.exerciseId) ?? w.exerciseId) : t('tpl.warmupExercise')}</Button>
                  <ActionIcon color="red" aria-label={t('common.remove')} onClick={() => setWarmEdit(warmEdit.filter((_, j) => j !== i))}><IconTrash size={20} /></ActionIcon>
                </Group>
                {!w.exerciseId && <TextInput label={t('tpl.warmupLabel')} value={w.label ?? ''} onChange={(e) => setWarmEdit(warmEdit.map((x, j) => (j === i ? { ...x, label: e.currentTarget.value } : x)))} />}
                <TextInput label={t('tpl.warmupDose')} value={w.prescription} onChange={(e) => setWarmEdit(warmEdit.map((x, j) => (j === i ? { ...x, prescription: e.currentTarget.value } : x)))} />
              </Stack></Card>
            ))}
            <Button variant="light" leftSection={<IconPlus size={18} />} onClick={() => setWarmEdit([...warmEdit, { id: '', exerciseId: null, altExerciseIds: [], label: '', prescription: '' }])}>{t('tpl.addWarmupItem')}</Button>
            <Button size="lg" onClick={() => void P.setWarmup(db, tp.id, warmEdit).then(() => setWarmEdit(null))} data-testid="save-warmup">{t('common.save')}</Button>
          </Stack>
        )}
      </Drawer>
    </>
  );
}

function SortableRow({ row, ex, index, total, onMove, onEdit }: {
  row: WorkoutTemplateExercise; ex?: Exercise; index: number; total: number; onMove: (i: number, d: -1 | 1) => void; onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  const sets = row.targetSetsByWeek.every((n) => n === row.targetSetsByWeek[0]) ? String(row.targetSetsByWeek[0] ?? 0) : row.targetSetsByWeek.join('/');
  return (
    <Card ref={setNodeRef} withBorder padding="xs" radius="md" className={isDragging ? 'w-row-dragging' : undefined} style={{ transform: CSS.Transform.toString(transform), transition }} data-testid="template-row">
      <Group wrap="nowrap" gap={4} align="center">
        <ActionIcon className="w-drag-handle" aria-label={`${t('common.reorder')}: ${ex?.name ?? ''}`} {...attributes} {...listeners}><IconGripVertical /></ActionIcon>
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }} onClick={onEdit}>
          <Group gap={6} wrap="nowrap"><Text fw={600} lineClamp={2} lh={1.25} data-testid="row-name">{ex?.name ?? row.exerciseId}</Text>{row.supersetGroup && <Badge size="xs" variant="outline">{row.supersetGroup}</Badge>}</Group>
          <Text fz="xs" c="dimmed" data-testid="row-meta">{row.role === 'cardio' ? row.targetReps : `${sets} × ${row.targetReps} · ${t('common.rest', { s: row.restSec })}`}</Text>
        </Stack>
        <ActionIcon aria-label={`${t('common.moveUp')}: ${ex?.name ?? ''}`} disabled={index === 0} onClick={() => onMove(index, -1)} data-testid="row-up"><IconArrowUp size={20} /></ActionIcon>
        <ActionIcon aria-label={`${t('common.moveDown')}: ${ex?.name ?? ''}`} disabled={index === total - 1} onClick={() => onMove(index, 1)} data-testid="row-down"><IconArrowDown size={20} /></ActionIcon>
        <ActionIcon aria-label={`${t('common.edit')} ${ex?.name ?? ''}`} onClick={onEdit} data-testid="row-edit"><IconPencil size={20} /></ActionIcon>
      </Group>
    </Card>
  );
}

function RowEditor({ row, weeks, exName, onClose, onSave, onReplace, onRemove }: { row: WorkoutTemplateExercise | null; weeks: number; exName: string; onClose: () => void; onSave: (r: WorkoutTemplateExercise) => void; onReplace: () => void; onRemove: () => void }) {
  const [r, setR] = useState<WorkoutTemplateExercise | null>(row);
  useEffect(() => setR(row ? { ...row, targetSetsByWeek: Array.from({ length: Math.max(weeks, row.targetSetsByWeek.length) }, (_, i) => row.targetSetsByWeek[i] ?? row.targetSetsByWeek.at(-1) ?? 3) } : null), [row, weeks]);
  const same = !!r && r.targetSetsByWeek.every((n) => n === r.targetSetsByWeek[0]);
  return (
    <Drawer opened={!!row} onClose={onClose} size="90%" title={<Text fw={700}>{t('tpl.editRow')} · {exName}</Text>} closeButtonProps={{ 'aria-label': t('common.close') }}>
      {r && (
        <Stack gap="sm">
          <Text fz="sm" fw={600}>{t('tpl.setsByWeek')}</Text>
          <Switch label={t('tpl.sameAll')} checked={same} onChange={(e) => e.currentTarget.checked && setR({ ...r, targetSetsByWeek: r.targetSetsByWeek.map(() => r.targetSetsByWeek[0]) })} />
          <Group grow>
            {r.targetSetsByWeek.map((n, i) => (
              <NumberInput key={i} label={t('common.weekShort', { n: i + 1 })} min={0} max={20} value={n} allowDecimal={false} data-testid={`sets-w${i + 1}`}
                onChange={(v) => setR({ ...r, targetSetsByWeek: same && i === 0 ? r.targetSetsByWeek.map(() => Number(v) || 0) : r.targetSetsByWeek.map((x, j) => (j === i ? Number(v) || 0 : x)) })} />
            ))}
          </Group>
          <TextInput label={t('tpl.reps')} value={r.targetReps} onChange={(e) => setR({ ...r, targetReps: e.currentTarget.value })} data-testid="row-reps" />
          <NumberInput label={t('tpl.restSec')} min={0} max={900} step={15} value={r.restSec} onChange={(v) => setR({ ...r, restSec: Number(v) || 0 })} data-testid="row-rest" />
          <Select label={t('tpl.superset')} data={[{ value: '', label: t('tpl.supersetNone') }, ...'ABCDEF'.split('').map((g) => ({ value: g, label: t('today.superset', { g }) }))]} value={r.supersetGroup ?? ''} onChange={(v) => setR({ ...r, supersetGroup: v || null })} />
          <Select label={t('tpl.role')} data={(['working', 'cardio', 'core'] as const).map((x) => ({ value: x, label: t(`tpl.role.${x}` as MsgKey) }))} value={r.role} onChange={(v) => v && setR({ ...r, role: v })} />
          <Textarea label={t('tpl.notes')} autosize minRows={2} value={r.notes} onChange={(e) => setR({ ...r, notes: e.currentTarget.value })} />
          <Button size="lg" onClick={() => onSave(r)} data-testid="row-save">{t('common.save')}</Button>
          <Group grow>
            <Button variant="default" leftSection={<IconReplace size={18} />} onClick={onReplace} data-testid="row-replace">{t('common.replace')}</Button>
            <Button variant="light" color="red" leftSection={<IconTrash size={18} />} onClick={onRemove} data-testid="row-remove">{t('common.remove')}</Button>
          </Group>
        </Stack>
      )}
    </Drawer>
  );
}
