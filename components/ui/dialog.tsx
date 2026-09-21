'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Modal dialog on the native <dialog> element.
 *
 * showModal() gives the three things a hand-rolled modal usually gets wrong:
 * the rest of the page becomes inert (focus cannot Tab out behind it), Escape
 * closes it, and focus returns to the opener on close. Re-implementing those
 * with a div and a focus-trap library is strictly more code for a worse result.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // A click whose target is the <dialog> itself landed on the backdrop,
      // since every visible pixel of the box is covered by the inner div.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className="w-[min(28rem,calc(100vw-2rem))] rounded-card border border-border bg-surface p-0 text-fg backdrop:bg-black/60"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted hover:text-fg"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        {description ? (
          <p id={descriptionId} className="mt-2 text-sm text-muted">
            {description}
          </p>
        ) : null}
        <div className="mt-5">{children}</div>
      </div>
    </dialog>
  );
}
