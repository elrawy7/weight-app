import { describe, it, expect } from 'vitest';
import { planShift, ShiftError, slotsBetween } from '../../src/domain/reschedule';
import { planForDate } from '../../src/domain/schedule';
import type { WeekPhase, WorkoutSchedule } from '../../src/db/types';

// Generic 4-week, 5-day plan (Sun–Thu, Fri/Sat rest) starting on a Saturday, like the test fixture.
const weeks: WeekPhase[] = [
  { week: 1, startDate: '2026-11-21', endDate: '2026-11-28', phase: 'A', rpe: '6-7' },
  { week: 2, startDate: '2026-11-29', endDate: '2026-12-05', phase: 'B', rpe: '7-8' },
  { week: 3, startDate: '2026-12-06', endDate: '2026-12-12', phase: 'C', rpe: '8' },
  { week: 4, startDate: '2026-12-13', endDate: '2026-12-19', phase: 'D', rpe: '8-9' },
];
const order = ['UA', 'LA', 'CO', 'UB', 'LB'];
const w1 = ['2026-11-21', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'];
const later = [['2026-11-29', 2], ['2026-12-06', 3], ['2026-12-13', 4]] as const;
const addD = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const planned = [
  ...w1.map((date, i) => ({ date, templateId: order[i], week: 1, targetRpe: '6-7' })),
  ...later.flatMap(([sun, wk]) => order.map((tpl, i) => ({ date: addD(sun, i), templateId: tpl, week: wk, targetRpe: weeks[wk - 1].rpe }))),
];
const schedule: WorkoutSchedule = {
  id: 's', programId: 'p', pattern: { SUN: 'UA', MON: 'LA', TUE: 'CO', WED: 'UB', THU: 'LB', FRI: null, SAT: null }, startDate: '2026-11-21', endDate: '2026-12-19',
  exceptions: [{ date: '2026-11-21', templateId: 'UA', note: 'start' }, { date: '2026-11-22', templateId: null, note: 'skipped' }], planned, createdAt: '', updatedAt: '',
};
const day = (s: WorkoutSchedule, d: string) => { const p = planForDate(s, d, weeks); return p.kind === 'planned' ? `${p.templateId}${p.week}` : p.kind; };
const doneSet = (...keys: string[]) => (d: string, t: string) => keys.includes(`${d}|${t}`);

describe('PROG-07 shift the plan by training day', () => {
  it('catch-up: missed Mon Lower A done on Tue → everything moves one training day, plan ends Sun 20 Dec', () => {
    const r = planShift({ schedule, weeks, today: '2026-11-24', source: '2026-11-23', isDone: doneSet('2026-11-21|UA') });
    const s = r.schedule;
    expect(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01'].map((d) => day(s, d)))
      .toEqual(['rest', 'LA1', 'CO1', 'UB1', 'rest', 'rest', 'LB1', 'UA2', 'LA2']);
    expect(day(s, '2026-12-17')).toBe('UB4');
    expect(day(s, '2026-12-18')).toBe('rest');
    expect(day(s, '2026-12-20')).toBe('LB4');
    expect(r.newEnd).toBe('2026-12-20');
    expect(s.endDate).toBe('2026-12-20');
    expect(s.exceptions.find((e) => e.date === '2026-11-23')).toMatchObject({ templateId: null, note: 'Moved to 2026-11-24' });
    expect(r.replaced?.templateId).toBe('CO');
    // the past is untouched; still 20 workouts in total
    expect(day(s, '2026-11-21')).toBe('UA1');
    expect(slotsBetween(s, '2026-11-24', '2026-12-31', weeks)).toHaveLength(19);
  });
  it('a later day done early: only the days in between move; the rest of the plan is unchanged', () => {
    const r = planShift({ schedule, weeks, today: '2026-11-24', source: '2026-11-26', isDone: () => false });
    expect(['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-29'].map((d) => day(r.schedule, d))).toEqual(['LB1', 'CO1', 'UB1', 'UA2']);
    expect(r.newEnd).toBe('2026-12-19');
    expect(r.changes.map((c) => c.date)).toEqual(['2026-11-24', '2026-11-25', '2026-11-26']);
    expect(day(r.schedule, '2026-12-17')).toBe('LB4');
  });
  it('rest day: today becomes a training day and the plan finishes one training day earlier', () => {
    const r = planShift({ schedule, weeks, today: '2026-11-27', source: '2026-11-29', isDone: () => false });
    expect(['2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30'].map((d) => day(r.schedule, d))).toEqual(['UA2', 'rest', 'LA2', 'CO2']);
    expect(day(r.schedule, '2026-12-16')).toBe('LB4');
    expect(day(r.schedule, '2026-12-17')).toBe('rest');
  });
  it('a moved workout keeps its own week (targets/RPE travel with it)', () => {
    const r = planShift({ schedule, weeks, today: '2026-11-26', source: '2026-12-01', isDone: () => false });
    const p = planForDate(r.schedule, '2026-11-26', weeks);
    expect(p).toMatchObject({ kind: 'planned', templateId: 'CO', week: 2, targetRpe: '7-8' });
    expect(day(r.schedule, '2026-11-29')).toBe('LB1');
  });
  it('refuses: today already done, same day, nothing planned, source already done', () => {
    expect(() => planShift({ schedule, weeks, today: '2026-11-24', source: '2026-11-25', isDone: doneSet('2026-11-24|CO') })).toThrow(/already done/);
    expect(() => planShift({ schedule, weeks, today: '2026-11-24', source: '2026-11-24', isDone: () => false })).toThrow(ShiftError);
    expect(() => planShift({ schedule, weeks, today: '2026-11-24', source: '2026-11-27', isDone: () => false })).toThrow(/no workout/);
    expect(() => planShift({ schedule, weeks, today: '2026-11-24', source: '2026-11-21', isDone: doneSet('2026-11-21|UA') })).toThrow(/already done/);
  });
});
