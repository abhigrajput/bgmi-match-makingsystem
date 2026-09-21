'use client';

import { useState } from 'react';

import { cn } from '@/lib/cn';

/**
 * A native range input with its value printed beside it.
 *
 * Native because it already has the full slider keyboard model (arrows, Page
 * Up/Down, Home/End) and announces its value; the printed number is for sighted
 * users, since a thumb position alone does not say "72". The value posts with
 * the form under `name`, so it needs no hidden input.
 */
export function Slider({
  id,
  name,
  min = 0,
  max = 100,
  step = 1,
  defaultValue = 50,
  className,
  suffix = '',
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'defaultValue'> & {
  defaultValue?: number;
  suffix?: string;
}) {
  const [value, setValue] = useState(defaultValue);

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <input
        id={id}
        name={name}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => setValue(Number(event.target.value))}
        className="h-2 w-full cursor-pointer accent-[rgb(var(--accent))]"
        {...rest}
      />
      <output
        htmlFor={id}
        className="w-12 text-right font-mono text-sm tabular text-fg"
      >
        {value}
        {suffix}
      </output>
    </div>
  );
}
