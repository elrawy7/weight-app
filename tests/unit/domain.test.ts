import { describe, it, expect } from 'vitest';
import { toDisplay, formatWeight, fromDisplay } from '../../src/domain/units';
import { epley, setVolume } from '../../src/domain/e1rm';
import { roundToIncrement, step, resolveIncrement } from '../../src/domain/rounding';
import { sessionLocalDate, addDays, weekdayOf, weekStart, diffDays, isValidIsoDate } from '../../src/domain/dates';
import { uuidv7, isUuidV7 } from '../../src/domain/uuid';
import { parseYoutubeUrl, youtubeSearchUrl } from '../../src/domain/youtube';
import { matches, normalize } from '../../src/domain/search';
import { canonicalJson, sha256Hex } from '../../src/domain/hash';
import { planForDate, weekOf, setsForWeek } from '../../src/domain/schedule';
import type { WorkoutSchedule, WeekPhase } from '../../src/db/types';

describe('FND-04 units (BR-CALC-06)', () => {
  it('AC1: 100 kg displays as 220.5 lb; stored value unchanged', () => {
    const stored = 100;
    expect(toDisplay(stored, 'lb')).toBe(220.5);
    expect(formatWeight(stored, 'lb')).toBe('220.5 lb');
    expect(stored).toBe(100);
    expect(toDisplay(stored, 'kg')).toBe(100);
  });
  it('round-trips lb input to kg', () => { expect(fromDisplay(220.462, 'lb')).toBeCloseTo(100, 2); });
  it('formats missing values', () => { expect(formatWeight(null, 'kg')).toBe('–'); expect(formatWeight(17.5, 'kg')).toBe('17.5 kg'); });
});

describe('FND-04 e1RM (BR-CALC-02)', () => {
  it('AC2: 80 kg × 8 → 101.3 kg (Epley)', () => expect(epley(80, 8)).toBe(101.3));
  it('AC2: 15 reps → no e1RM', () => expect(epley(80, 15)).toBeNull());
  it('AC2: bodyweight mode → no e1RM', () => expect(epley(80, 8, 'bodyweight')).toBeNull());
  it('1 rep = the weight', () => expect(epley(100, 1)).toBe(100));
  it('12 reps is the upper limit', () => expect(epley(50, 12)).toBe(70));
  it('volume counts both hands for per-hand loads', () => { expect(setVolume(20, 10, 'per_hand')).toBe(400); expect(setVolume(20, 10, 'stack')).toBe(200); expect(setVolume(0, 10, 'bodyweight')).toBe(0); });
});

describe('FND-04 rounding/increments (BR-CALC-04, BR-PO-10)', () => {
  it('rounds to the nearest increment', () => { expect(roundToIncrement(41.2, 2.5)).toBe(40); expect(roundToIncrement(58.4, 6.5)).toBe(58.5); expect(roundToIncrement(41.3, 2.5, 'up')).toBe(42.5); });
  it('SET-02 AC1: + on a 6.5 kg machine adds exactly 6.5', () => { expect(step(52, 6.5, 1)).toBe(58.5); expect(step(4.5, 1.25, 1)).toBe(5.75); expect(step(1, 2.5, -1)).toBe(0); });
  it('override precedence exercise > equipment > default', () => {
    const ex = { id: 'lat_pulldown_wide', equipmentId: 'cable_machine', incrementKg: 5 };
    expect(resolveIncrement(ex, {})).toBe(5);
    expect(resolveIncrement(ex, { 'eq:cable_machine': 6.5 })).toBe(6.5);
    expect(resolveIncrement(ex, { 'eq:cable_machine': 6.5, 'ex:lat_pulldown_wide': 7 })).toBe(7);
  });
});

describe('FND-04 dates (BR-SES-03)', () => {
  it('AC3: started 23:50 on 23 Nov (UTC+3), ended 00:40 → localDate 2026-11-23', () => {
    const start = '2026-11-23T20:50:00Z'; // 23:50 +03:00
    const end = '2026-11-23T21:40:00Z'; // 00:40 +03:00 next day
    expect(sessionLocalDate(start, 'Etc/GMT-3')).toBe('2026-11-23');
    expect(sessionLocalDate(end, 'Etc/GMT-3')).toBe('2026-11-24');
  });
  it('date arithmetic', () => {
    expect(addDays('2026-11-28', 1)).toBe('2026-11-29');
    expect(weekdayOf('2026-11-21')).toBe('SAT');
    expect(weekdayOf('2026-11-29')).toBe('SUN');
    expect(weekStart('2026-12-01', 'SUN')).toBe('2026-11-29');
    expect(diffDays('2026-12-19', '2026-11-21')).toBe(28);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
  });
});

describe('ids, hashing, search, youtube', () => {
  it('uuid v7 format and time order', () => { const a = uuidv7(1000), b = uuidv7(2000); expect(isUuidV7(a)).toBe(true); expect(a < b).toBe(true); });
  it('canonical JSON sorts keys and matches Python output', async () => {
    expect(canonicalJson({ b: 1, a: [17.5, 'x', null], c: { z: true, y: 'وزن' } })).toBe('{"a":[17.5,"x",null],"b":1,"c":{"y":"وزن","z":true}}');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('LIB-05: search fallback URL', () => expect(youtubeSearchUrl('Cable Crunch')).toBe('https://www.youtube.com/results?search_query=Cable%20Crunch%20form'));
  it('LIB-05 AC2: accepts YouTube video URLs only', () => {
    expect(parseYoutubeUrl('https://youtu.be/dQw4w9WgXcQ?t=3')).toEqual({ ok: true, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ' });
    expect(parseYoutubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x').ok).toBe(true);
    expect(parseYoutubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ').ok).toBe(true);
    expect(parseYoutubeUrl('https://vimeo.com/123').ok).toBe(false);
    expect(parseYoutubeUrl('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ').ok).toBe(false);
    expect(parseYoutubeUrl('javascript:alert(1)').ok).toBe(false);
    expect(parseYoutubeUrl('https://www.youtube.com/results?search_query=x').ok).toBe(false);
  });
  it('Arabic-aware search normalisation', () => {
    expect(normalize('الأوزان')).toBe('الاوزان');
    expect(matches('pushdown', ['Cable Rope Triceps Pushdown'])).toBe(true);
    expect(matches('rope tri', ['Cable Rope Triceps Pushdown'])).toBe(true);
    expect(matches('ترايسبس', ['دفع الترايسبس للأسفل بالحبل'])).toBe(true);
    expect(matches('squat', ['Leg press'])).toBe(false);
  });
});

describe('PROG-03 / PROG-04 schedule', () => {
  const weeks: WeekPhase[] = [
    { week: 1, startDate: '2026-11-21', endDate: '2026-11-28', phase: 'Re-entry', rpe: '6-7' },
    { week: 2, startDate: '2026-11-29', endDate: '2026-12-05', phase: 'Build', rpe: '7-8' },
  ];
  const s: WorkoutSchedule = {
    id: 's', programId: 'p', createdAt: '', updatedAt: '', startDate: '2026-11-21', endDate: '2026-12-19',
    pattern: { SUN: 'ua', MON: 'la', TUE: 'co', WED: 'ub', THU: 'lb', FRI: null, SAT: null },
    exceptions: [{ date: '2026-11-21', templateId: 'ua', note: 'Week 1 started on Saturday' }, { date: '2026-11-22', templateId: null, note: 'Skipped; plan shifted' }],
    planned: [{ date: '2026-11-24', templateId: 'co', week: 1, targetRpe: 'Moderate' }],
  };
  it('AC1: weekday pattern', () => {
    expect(planForDate(s, '2026-12-02', weeks)).toMatchObject({ kind: 'planned', templateId: 'ub', source: 'pattern' });
    expect(planForDate(s, '2026-11-27', weeks)).toMatchObject({ kind: 'rest' });
  });
  it('AC2: exceptions win (Sat 21 Nov = Upper A, Sun 22 Nov skipped)', () => {
    expect(planForDate(s, '2026-11-21', weeks)).toMatchObject({ kind: 'planned', templateId: 'ua', source: 'exception' });
    expect(planForDate(s, '2026-11-22', weeks)).toMatchObject({ kind: 'rest', source: 'exception' });
  });
  it('planned dates carry week + RPE', () => expect(planForDate(s, '2026-11-24', weeks)).toMatchObject({ kind: 'planned', templateId: 'co', week: 1, targetRpe: 'Moderate' }));
  it('outside the program window → nothing scheduled', () => { expect(planForDate(s, '2026-11-20', weeks).kind).toBe('none'); expect(planForDate(s, '2026-12-20', weeks).kind).toBe('none'); });
  it('PROG-04 AC1: 1 Dec is Week 2 and uses week-2 set counts', () => { expect(weekOf(weeks, '2026-12-01')).toBe(2); expect(setsForWeek([3, 4, 4, 4], 2)).toBe(4); expect(setsForWeek([3, 4, 4, 4], null)).toBe(3); });
});
