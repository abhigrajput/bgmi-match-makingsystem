'use client';

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { Comparison } from '@/lib/scoring/evaluate';

/**
 * Optimizer vs rank-only, as small multiples: one tiny bar chart per metric.
 *
 * Not one grouped chart. The four metrics live on different scales (a 0-1
 * score, a percentage, a count, rating points), and putting them on one y-axis
 * would either flatten three of them or need a second axis -- which is the
 * chart mistake that lets a reader compare bars that are not comparable. Each
 * panel gets its own axis and its own title that says which way is better.
 *
 * Colours are --chart-1 / --chart-2, validated for CVD separation and surface
 * contrast in both themes. Identity never rests on colour alone: there is a
 * legend, every bar carries a direct value label, and the table under the
 * charts has the same numbers.
 */

type Metric = {
  key: keyof Comparison['optimizer'];
  title: string;
  better: 'higher' | 'lower';
  format: (v: number) => string;
  scale?: (v: number) => number;
};

const METRICS: Metric[] = [
  { key: 'meanSquadScore', title: 'Mean squad score', better: 'higher', format: (v) => (v * 100).toFixed(1), scale: (v) => v * 100 },
  { key: 'vetoedPairs', title: 'Vetoed pairs seated together', better: 'lower', format: (v) => String(Math.round(v)) },
  { key: 'roleCoverage', title: 'Role coverage', better: 'higher', format: (v) => `${(v * 100).toFixed(0)}%`, scale: (v) => v * 100 },
  { key: 'meanRatingSpread', title: 'Mean rating spread', better: 'lower', format: (v) => v.toFixed(1) },
];

const SERIES = [
  { key: 'optimizer', label: 'Optimizer', color: 'var(--chart-1)' },
  { key: 'baseline', label: 'Rank-only', color: 'var(--chart-2)' },
] as const;

function Panel({ metric, comparison }: { metric: Metric; comparison: Comparison }) {
  const scale = metric.scale ?? ((v: number) => v);
  const data = SERIES.map((s) => ({
    name: s.label,
    value: scale(comparison[s.key][metric.key]),
    raw: comparison[s.key][metric.key],
    color: s.color,
  }));

  return (
    <figure className="rounded-card border border-border bg-surface p-4">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-fg">{metric.title}</span>
        <span className="text-xs text-muted">{metric.better} is better</span>
      </figcaption>
      <div className="mt-3 h-40" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 8 }} barCategoryGap="28%">
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={{ stroke: 'var(--chart-grid)' }}
              tick={{ fill: 'var(--chart-axis)', fontSize: 12 }}
            />
            <YAxis hide domain={[0, 'auto']} />
            <Tooltip
              cursor={{ fill: 'rgb(var(--surface-2))' }}
              content={({ active, payload }) => {
                const item = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !item) return null;
                return (
                  <div className="rounded-input border border-border bg-surface-2 px-3 py-2 text-xs shadow-lg">
                    <p className="text-muted">{metric.title}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-fg">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: item.color }} />
                      {item.name}: <span className="font-mono tabular">{metric.format(item.raw)}</span>
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
              <LabelList
                dataKey="raw"
                position="top"
                formatter={(v: number) => metric.format(v)}
                style={{ fill: 'rgb(var(--fg))', fontSize: 12, fontFamily: 'var(--font-mono)' }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export function ComparisonCharts({ comparison }: { comparison: Comparison }) {
  return (
    <div>
      <ul className="mb-3 flex gap-4 text-xs text-muted" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {METRICS.map((metric) => (
          <Panel key={metric.key} metric={metric} comparison={comparison} />
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-card border border-border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Optimizer compared with rank-only grouping</caption>
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Metric</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Optimizer</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Rank-only</th>
            </tr>
          </thead>
          <tbody className="bg-surface">
            <tr className="border-t border-border">
              <th scope="row" className="px-4 py-2 font-normal text-muted">Squads formed</th>
              <td className="px-4 py-2 text-right font-mono tabular">{comparison.optimizer.squads}</td>
              <td className="px-4 py-2 text-right font-mono tabular">{comparison.baseline.squads}</td>
            </tr>
            {METRICS.map((m) => (
              <tr key={m.key} className="border-t border-border">
                <th scope="row" className="px-4 py-2 font-normal text-muted">
                  {m.title} <span className="text-xs">({m.better} is better)</span>
                </th>
                <td className="px-4 py-2 text-right font-mono tabular">{m.format(comparison.optimizer[m.key])}</td>
                <td className="px-4 py-2 text-right font-mono tabular">{m.format(comparison.baseline[m.key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
