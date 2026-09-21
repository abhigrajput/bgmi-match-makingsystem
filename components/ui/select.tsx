import { forwardRef } from 'react';

import { cn } from '@/lib/cn';

import { fieldClass } from './input';

/**
 * A native <select>. A custom listbox would need its own keyboard model,
 * typeahead and mobile picker to match what the platform already gives this.
 */
export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(fieldClass, 'pr-8', className)} {...rest} />
  );
});
