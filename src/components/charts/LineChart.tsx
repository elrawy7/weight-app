/**
 * Single-series line chart (AN-02). Follows the dataviz rules: 2px line, ≥8px markers with a 2px surface ring,
 * hairline recessive grid, clean ticks, crosshair snapping to the nearest point, tooltip (value first), a table view,
 * and tapping a point opens its session. PR points are amber and say "PR" in the tooltip (not colour alone).
 */
import { useMemo, useRef, useState } from 'react';
import { Box, Button, Table, Text } from '@mantine/core';
import { t } from '../../i18n';

export interface ChartPoint { x: string; value: number; id: string; pr?: boolean }

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) { const d = Math.abs(min) * 0.1 || 1; min -= d; max += d; }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}
const fmtTick = (v: number) => (Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}K` : v.toLocaleString('en-GB', { maximumFractionDigits: 1 }));

export function LineChart({ points, format, xLabel, onSelect, label, height = 200, testId = 'line-chart' }: {
  points: ChartPoint[]; format: (v: number) => string; xLabel: (x: string) => string; onSelect?: (id: string) => void; label: string; height?: number; testId?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 360, H = height, padL = 44, padR = 14, padT = 14, padB = 26;
  const geo = useMemo(() => {
    const vals = points.map((p) => p.value);
    const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];
    // x by date order (equal spacing would hide gaps; use real day distances)
    const days = points.map((p) => Date.parse(`${p.x}T00:00:00Z`) / 864e5);
    const d0 = Math.min(...days), d1 = Math.max(...days);
    const x = (i: number) => (d1 === d0 ? padL + (W - padL - padR) / 2 : padL + ((days[i] - d0) / (d1 - d0)) * (W - padL - padR));
    const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - padT - padB);
    return { ticks, x, y };
  }, [points, H]);
  if (points.length === 0) return null;
  const { ticks, x, y } = geo;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const nearest = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    let best = 0;
    points.forEach((_, i) => { if (Math.abs(x(i) - sx) < Math.abs(x(best) - sx)) best = i; });
    return best;
  };
  const hp = hover != null ? points[hover] : null;
  return (
    <Box data-testid={testId}>
      <div style={{ position: 'relative' }}>
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} style={{ display: 'block', touchAction: 'pan-y', cursor: onSelect ? 'pointer' : undefined }}
          onPointerMove={(e) => setHover(nearest(e.clientX))} onPointerLeave={() => setHover(null)}
          onClick={(e) => { const i = nearest(e.clientX); setHover(i); onSelect?.(points[i].id); }}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--mantine-color-default-border)" strokeWidth={1} />
              <text x={padL - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--mantine-color-dimmed)" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTick(v)}</text>
            </g>
          ))}
          <text x={padL} y={H - 6} fontSize={11} fill="var(--mantine-color-dimmed)">{xLabel(points[0].x)}</text>
          {points.length > 1 && <text x={W - padR} y={H - 6} textAnchor="end" fontSize={11} fill="var(--mantine-color-dimmed)">{xLabel(points[points.length - 1].x)}</text>}
          {hp && <line x1={x(hover!)} x2={x(hover!)} y1={padT} y2={H - padB} stroke="var(--mantine-color-dimmed)" strokeWidth={1} />}
          <path d={path} fill="none" stroke="var(--mantine-color-mint-5)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => (
            <circle key={p.id + i} cx={x(i)} cy={y(p.value)} r={hover === i ? 6 : 4.5} fill={p.pr ? 'var(--w-pr)' : 'var(--mantine-color-mint-5)'}
              stroke="var(--mantine-color-body)" strokeWidth={2} data-testid="chart-point" data-pr={p.pr ? '1' : '0'} />
          ))}
          {/* end label: the latest value */}
          <text x={Math.min(x(points.length - 1), W - padR)} y={Math.max(11, y(points[points.length - 1].value) - 10)} textAnchor="end" fontSize={12} fontWeight={700} fill="var(--mantine-color-text)">{format(points[points.length - 1].value)}</text>
        </svg>
        {hp && (
          <div role="status" data-testid="chart-tooltip" style={{
            position: 'absolute', top: 0, left: `${(x(hover!) / W) * 100}%`, transform: `translateX(${x(hover!) > W * 0.6 ? '-105%' : '5%'})`, pointerEvents: 'none',
            background: 'var(--mantine-color-body)', border: '1px solid var(--mantine-color-default-border)', borderRadius: 8, padding: '4px 8px', whiteSpace: 'nowrap',
          }}>
            <Text fw={800} fz="sm">{format(hp.value)}{hp.pr ? ` · ${t('wo.pr')}` : ''}</Text>
            <Text fz="xs" c="dimmed">{xLabel(hp.x)}</Text>
          </div>
        )}
      </div>
      <Button variant="subtle" size="xs" onClick={() => setTable((v) => !v)} data-testid={`${testId}-table-toggle`}>{table ? t('chart.hideTable') : t('chart.showTable')}</Button>
      {table && (
        <Table fz="sm" verticalSpacing={2} data-testid={`${testId}-table`}>
          <Table.Tbody>
            {[...points].reverse().map((p, i) => (
              <Table.Tr key={p.id + i} onClick={() => onSelect?.(p.id)} style={{ cursor: onSelect ? 'pointer' : undefined }}>
                <Table.Td>{xLabel(p.x)}</Table.Td><Table.Td ta="right" style={{ fontVariantNumeric: 'tabular-nums' }}>{format(p.value)}{p.pr ? ` · ${t('wo.pr')}` : ''}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Box>
  );
}

/** Horizontal bars (one hue), value at the tip, optional threshold hairline. Used for muscle sets (MG-01). */
export function BarList({ rows, max, threshold, format, testId = 'bar-list' }: {
  rows: { key: string; label: string; value: number; flag?: string; sub?: string; onClick?: () => void }[]; max?: number; threshold?: number; format: (v: number) => string; testId?: string;
}) {
  const top = Math.max(max ?? 0, threshold ?? 0, ...rows.map((r) => r.value), 1);
  return (
    <div data-testid={testId} style={{ display: 'grid', gap: 10 }}>
      {rows.map((r) => (
        <div key={r.key} data-testid="bar-row" data-key={r.key} onClick={r.onClick} style={{ cursor: r.onClick ? 'pointer' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <Text fz="sm" fw={600}>{r.label}{r.flag ? <Text span fz="xs" c="amber.5" fw={700}> · ⚠ {r.flag}</Text> : null}</Text>
            <Text fz="sm" fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>{format(r.value)}</Text>
          </div>
          <div style={{ position: 'relative', height: 12, marginTop: 4 }}>
            <div style={{ position: 'absolute', inset: '2px 0', background: 'var(--mantine-color-default-hover)', borderRadius: 4 }} />
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${(r.value / top) * 100}%`, background: r.flag ? 'var(--w-pr)' : 'var(--mantine-color-mint-5)', borderRadius: '0 4px 4px 0', minWidth: r.value > 0 ? 3 : 0 }} />
            {threshold != null && <div aria-hidden style={{ position: 'absolute', top: -3, bottom: -3, left: `${(threshold / top) * 100}%`, width: 1, background: 'var(--mantine-color-text)' }} />}
          </div>
          {r.sub && <Text fz="xs" c="dimmed" mt={2}>{r.sub}</Text>}
        </div>
      ))}
    </div>
  );
}
