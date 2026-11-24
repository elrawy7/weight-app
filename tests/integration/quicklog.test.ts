import { describe, it, expect, beforeEach } from 'vitest';
import { WeightDB } from '../../src/db/schema';
import { ensureSeed } from '../../src/db/seed';
import { markDone, updateQuickLog, undoQuickLog, dayStatus, QuickLogError } from '../../src/features/today/quickLog';

let db: WeightDB;
const base = { programId: 'p', templateId: 'tpl_cond', week: 1, today: '2026-11-24', durationMin: 45, kneePain: 2, energy: 4, notes: ' swim 1 km ' };
beforeEach(async () => { db = new WeightDB(`t-ql-${Math.random()}`); await db.open(); await ensureSeed(db); });

describe('QL-01 quick completion log', () => {
  it('AC1: marks today done with summary; one per date + workout', async () => {
    const s = await markDone(db, { ...base, date: '2026-11-24' });
    expect(s).toMatchObject({ status: 'completed', logType: 'quick', localDate: '2026-11-24', durationMin: 45, kneePain: 2, energy: 4, notes: 'swim 1 km', source: 'app' });
    await expect(markDone(db, { ...base, date: '2026-11-24' })).rejects.toThrow(/already marked/);
  });
  it('AC2: past missed day can be back-filled; future day refused', async () => {
    await expect(markDone(db, { ...base, date: '2026-11-22' })).resolves.toBeTruthy();
    await expect(markDone(db, { ...base, date: '2026-11-25' })).rejects.toThrow(QuickLogError);
  });
  it('AC3: validation of minutes, knee pain and energy', async () => {
    await expect(markDone(db, { ...base, date: '2026-11-24', kneePain: 11 })).rejects.toThrow(/Knee pain/);
    await expect(markDone(db, { ...base, date: '2026-11-24', energy: 0 })).rejects.toThrow(/Energy/);
    await expect(markDone(db, { ...base, date: '2026-11-24', durationMin: -1 })).rejects.toThrow(/Minutes/);
    await expect(markDone(db, { ...base, date: '2026-11-24', durationMin: null, kneePain: null, energy: null })).resolves.toBeTruthy();
  });
  it('AC4: edit and undo quick logs only; imported sessions are protected', async () => {
    const s = await markDone(db, { ...base, date: '2026-11-24' });
    await updateQuickLog(db, s.id, { durationMin: 50, kneePain: 1, energy: 5, notes: 'boxing' });
    expect(await db.sessions.get(s.id)).toMatchObject({ durationMin: 50, kneePain: 1, energy: 5, notes: 'boxing' });
    await undoQuickLog(db, s.id);
    expect(await db.sessions.get(s.id)).toBeUndefined();
    await db.sessions.add({ id: 'imp', status: 'completed', startedAt: null, endedAt: null, pausedMs: 0, localDate: '2026-11-21', notes: '', source: 'notion_import', createdAt: '', updatedAt: '' });
    await expect(undoQuickLog(db, 'imp')).rejects.toThrow(/Only quick logs/);
    await expect(updateQuickLog(db, 'imp', { durationMin: 1, kneePain: null, energy: null, notes: '' })).rejects.toThrow();
  });
});

describe('PROG-06 day status', () => {
  const planned = { kind: 'planned' as const, templateId: 'A', week: 1, source: 'pattern' as const };
  const done = [{ localDate: '2026-11-21', templateId: 'A' }];
  it('done / today / missed / upcoming / rest / none', () => {
    expect(dayStatus('2026-11-21', '2026-11-24', planned, done)).toBe('done');
    expect(dayStatus('2026-11-24', '2026-11-24', planned, done)).toBe('today');
    expect(dayStatus('2026-11-23', '2026-11-24', planned, done)).toBe('missed');
    expect(dayStatus('2026-11-25', '2026-11-24', planned, done)).toBe('upcoming');
    expect(dayStatus('2026-11-27', '2026-11-24', { kind: 'rest', source: 'pattern' }, done)).toBe('rest');
    expect(dayStatus('2026-12-30', '2026-11-24', { kind: 'none' }, done)).toBe('none');
  });
});
