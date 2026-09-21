import { forwardRef } from 'react';

import { cn } from '@/lib/cn';

/** Shared by Input, Select and Textarea so the three read as one family. */
export const fieldClass =
  'w-full rounded-input border border-border bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-muted/70 transition-colors duration-150 hover:border-border-strong focus-visible:border-accent aria-[invalid=true]:border-danger disabled:opacity-50';

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(fieldClass, className)} {...rest} />;
});
