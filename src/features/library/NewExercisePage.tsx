import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Button, MultiSelect, NumberInput, Select, Stack, TextInput, Textarea } from '@mantine/core';
import { useDb } from '../../app/db';
import { t, type MsgKey } from '../../i18n';
import { categories } from '../../seed/exercises';
import { createCustomExercise, LibraryError, type CustomExerciseInput } from './libraryOps';
import { PageHeader } from '../../components/ui';
import type { Category, LoadMode, Mechanic, Tracking } from '../../db/types';

const LOADS: LoadMode[] = ['total', 'per_hand', 'stack', 'bodyweight', 'assist', 'band', 'none'];
const TRACK: Tracking[] = ['weight_reps', 'reps', 'reps_per_side', 'duration', 'duration_distance', 'rounds'];
const MECH: Mechanic[] = ['compound', 'isolation', 'cardio', 'mobility'];

export function NewExercisePage() {
  const db = useDb();
  const nav = useNavigate();
  const equipment = useLiveQuery(() => db.equipment.toArray(), [db]) ?? [];
  const muscles = useLiveQuery(() => db.muscleGroups.toArray(), [db]) ?? [];
  const [f, setF] = useState<CustomExerciseInput & { instructionsText: string }>({
    name: '', nameAr: '', category: 'chest', mechanic: 'isolation', tracking: 'weight_reps', loadMode: 'stack', equipmentId: 'machine', primary: [], secondary: [], defaultRestSec: 60, incrementKg: 5, instructionsText: '',
  });
  const [error, setError] = useState<string | null>(null);
  const up = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const mData = muscles.map((m) => ({ value: m.id, label: m.name }));
  const submit = async () => {
    try {
      const ex = await createCustomExercise(db, { ...f, instructions: f.instructionsText.split('\n').map((s) => s.trim()).filter(Boolean) });
      nav(`/library/${ex.id}`, { replace: true });
    } catch (e) { setError(e instanceof LibraryError ? e.message : t('common.error')); }
  };
  return (
    <>
      <PageHeader title={t('ex.newTitle')} back />
      <Stack>
        <TextInput label={t('ex.name')} required value={f.name} onChange={(e) => up('name', e.currentTarget.value)} error={error} data-testid="new-name" />
        <TextInput label={`${t('ex.arabic')} (${t('common.optional')})`} dir="rtl" lang="ar" value={f.nameAr} onChange={(e) => up('nameAr', e.currentTarget.value)} />
        <Select label={t('library.category')} data={categories.map((c) => ({ value: c, label: t(`cat.${c}` as MsgKey) }))} value={f.category} onChange={(v) => v && up('category', v as Category)} />
        <Select label={t('ex.equipment')} data={equipment.map((e) => ({ value: e.id, label: e.name }))} value={f.equipmentId}
          onChange={(v) => { if (!v) return; const e = equipment.find((x) => x.id === v); setF((x) => ({ ...x, equipmentId: v, loadMode: e?.loadMode ?? x.loadMode, incrementKg: e?.incrementKg ?? x.incrementKg })); }} />
        <Select label={t('ex.loadMode')} data={LOADS.map((l) => ({ value: l, label: t(`loadMode.${l}` as MsgKey) }))} value={f.loadMode} onChange={(v) => v && up('loadMode', v as LoadMode)} />
        <Select label={t('ex.tracking')} data={TRACK.map((l) => ({ value: l, label: t(`tracking.${l}` as MsgKey) }))} value={f.tracking} onChange={(v) => v && up('tracking', v as Tracking)} />
        <Select label={t('ex.mechanic')} data={MECH.map((l) => ({ value: l, label: t(`mechanic.${l}` as MsgKey) }))} value={f.mechanic} onChange={(v) => v && up('mechanic', v as Mechanic)} />
        <MultiSelect label={t('ex.primaryMuscles')} data={mData} value={f.primary} onChange={(v) => up('primary', v)} searchable required data-testid="new-primary" />
        <MultiSelect label={t('ex.secondaryMuscles')} data={mData.filter((m) => !f.primary.includes(m.value))} value={f.secondary} onChange={(v) => up('secondary', v)} searchable />
        <NumberInput label={t('ex.defaultRest')} min={0} max={900} value={f.defaultRestSec} onChange={(v) => up('defaultRestSec', Number(v) || 0)} />
        <NumberInput label={t('ex.incrementKg')} min={0} max={50} decimalScale={2} value={f.incrementKg} onChange={(v) => up('incrementKg', Number(v) || 0)} />
        <Textarea label={t('ex.instructionsInput')} autosize minRows={3} value={f.instructionsText} onChange={(e) => up('instructionsText', e.currentTarget.value)} />
        <Button size="lg" onClick={() => void submit()} data-testid="new-create">{t('ex.create')}</Button>
      </Stack>
    </>
  );
}
