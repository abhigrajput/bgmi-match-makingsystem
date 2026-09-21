'use client';

import { useId, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

export type TabItem = {
  id: string;
  label: React.ReactNode;
  content: React.ReactNode;
};

/**
 * WAI-ARIA tabs: arrow keys move between tabs, Home/End jump, and only the
 * active tab is in the Tab order, so a keyboard user passes the whole tab list
 * in one keystroke instead of one per tab.
 *
 * Every panel stays mounted and inactive ones are `hidden`. Unmounting would
 * reset a panel's local state (an expanded row, a scroll position) each time
 * someone flicked between tabs to compare them.
 */
export function Tabs({
  items,
  defaultTab,
  className,
  label,
}: {
  items: TabItem[];
  defaultTab?: string;
  className?: string;
  label: string;
}) {
  const baseId = useId();
  const [active, setActive] = useState(defaultTab ?? items[0]?.id);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function focusTab(index: number) {
    const wrapped = (index + items.length) % items.length;
    const item = items[wrapped];
    if (!item) return;
    setActive(item.id);
    tabRefs.current[wrapped]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key === 'ArrowRight') focusTab(index + 1);
    else if (event.key === 'ArrowLeft') focusTab(index - 1);
    else if (event.key === 'Home') focusTab(0);
    else if (event.key === 'End') focusTab(items.length - 1);
    else return;
    event.preventDefault();
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {items.map((item, index) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              role="tab"
              type="button"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(item.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                '-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors duration-150',
                selected
                  ? 'border-accent text-fg'
                  : 'border-transparent text-muted hover:text-fg',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${baseId}-panel-${item.id}`}
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== active}
          tabIndex={0}
          className="pt-6 focus-visible:outline-none"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
