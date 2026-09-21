'use client';

import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { ROLE_CHART_COLOR, ROLE_LABELS } from '@/lib/roles';
import type { PlayerRole } from '@/types/database';

/**
 * Single-series distribution bars and the role donut for /analytics.
 *
 * One series per bar chart, so no legend box: the card title names it. Bars
 * are --chart-1 with 4px rounded data-ends and direct count labels, which are
 * also the table view. The donut uses the validated --chart-role-* steps
 * (light mode needs visible labels for two of them, so the legend beside it
 * lists every role with its count and share).
 */

type Datum = { label: string; count: number };

function ChartTooltip({ active, payload, unit }: { active?: boolean; payload?: { payload: Datum }[]; unit: string }) {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;
  return (
    <div className="rounded-input border border-border bg-surface-2 px-3 py-2 text-xs shadow-lg">
      <p className="text-muted">{item.label}</p>
      <p className="mt-0.5 font-mono tabular text-fg">
        {item.count.toLocaleString('en-IN')} {unit}
      </p>
    </div>
  );
}

export function DistributionBars({ data, unit, xLabel }: { data: Datum[]; unit: string; xLabel: string }) {
  return (
    <figure>
      <div className="h-56" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 20, right: 4, bottom: 4, left: 4 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="0" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: 'var(--chart-grid)' }}
              tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}
              interval={0}
            />
            <YAxis hide />
            <Tooltip cursor={{ fill: 'rgb(var(--surface-2))' }} content={<ChartTooltip unit={unit} />} />
            <Bar dataKey="count" fill="var(--chart-1)" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              <LabelList
                dataKey="count"
                position="top"
                style={{ fill: 'rgb(var(--muted))', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 text-center text-xs text-muted">{xLabel}</figcaption>
      <table className="sr-only">
        <caption>{xLabel}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function RoleDonut({ data }: { data: { role: PlayerRole; count: number }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div className="h-48 w-48 shrink-0" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="role"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={1.5}
              stroke="rgb(var(--surface))"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell key={d.role} fill={ROLE_CHART_COLOR[d.role]} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                const item = payload?.[0]?.payload as { role: PlayerRole; count: number } | undefined;
                if (!active || !item) return null;
                return (
                  <div className="rounded-input border border-border bg-surface-2 px-3 py-2 text-xs shadow-lg">
                    <p className="text-muted">{ROLE_LABELS[item.role]}</p>
                    <p className="mt-0.5 font-mono tabular text-fg">
                      {item.count} players · {((item.count / total) * 100).toFixed(0)}%
                    </p>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-2 text-sm" aria-label="Primary role distribution">
        {data.map((d) => (
          <li key={d.role} className="flex items-center gap-2.5">
            <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: ROLE_CHART_COLOR[d.role] }} />
            <span className="flex-1 text-fg">{ROLE_LABELS[d.role]}</span>
            <span className="font-mono tabular text-fg">{d.count}</span>
            <span className="w-10 text-right font-mono tabular text-muted">
              {total > 0 ? `${((d.count / total) * 100).toFixed(0)}%` : '–'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
