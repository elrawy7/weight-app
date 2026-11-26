/** Sanity of the synthetic performance data set (size, span, validity) – the data the benchmarks run on. */
import { describe, it, expect } from 'vitest';
import { generateSynthetic } from './synthetic';
import { validateRows, checkIntegrity } from '../../src/features/backup/backup';

describe('synthetic data set (Phase 3.1 E)', () => {
  const d = generateSynthetic({ libraryExerciseIds: [] });
  it('has the specified size and span', () => {
    expect(d.sessions).toHaveLength(1000);
    expect(d.exercises).toHaveLength(200);
    expect(Math.abs(d.sets.length - 50000)).toBeLessThan(1000);
    const dates = d.sessions.map((s) => s.localDate as string).sort();
    const years = (Date.parse(dates.at(-1)!) - Date.parse(dates[0])) / (365.25 * 86400000);
    expect(years).toBeGreaterThan(4.9);
    expect(dates.at(-1)! <= '2026-11-27').toBe(true);
  });
  it('is deterministic and valid backup content', () => {
    expect(generateSynthetic({ libraryExerciseIds: [] }).sets[1234]).toEqual(d.sets[1234]);
    const stores = d as unknown as Record<string, unknown[]>;
    expect(() => validateRows(stores)).not.toThrow();
    expect(() => checkIntegrity(stores)).not.toThrow();
  });
});
