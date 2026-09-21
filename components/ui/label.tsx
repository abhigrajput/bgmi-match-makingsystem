import { cn } from '@/lib/cn';

export function Label({
  className,
  optional = false,
  children,
  ...rest
}: React.LabelHTMLAttributes<HTMLLabelElement> & { optional?: boolean }) {
  return (
    <label
      className={cn('mb-1.5 block text-sm font-medium text-fg', className)}
      {...rest}
    >
      {children}
      {optional ? (
        <span className="ml-1 font-normal text-muted">(optional)</span>
      ) : null}
    </label>
  );
}

/** Helper text under a field. Give it an id and point aria-describedby at it. */
export function Hint({
  className,
  ...rest
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-1.5 text-xs text-muted', className)} {...rest} />;
}
