import { forwardRef } from 'react';

import { cn } from '@/lib/cn';

import { fieldClass } from './input';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(fieldClass, className)} {...rest} />;
});
