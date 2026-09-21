import { cn } from '@/lib/cn';

type DivProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * The base surface. A 1px border and no shadow: on a near-black background a
 * shadow is invisible, so elevation is carried by the border and the surface
 * step instead.
 */
export function Card({
  className,
  interactive = false,
  ...rest
}: DivProps & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-card border border-border bg-surface',
        interactive &&
          'transition-colors duration-150 hover:border-border-strong',
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({ className, ...rest }: DivProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-border px-5 py-4',
        className,
      )}
      {...rest}
    />
  );
}

export function CardTitle({
  className,
  as: Tag = 'h2',
  ...rest
}: React.HTMLAttributes<HTMLHeadingElement> & { as?: 'h2' | 'h3' }) {
  return (
    <Tag className={cn('text-sm font-semibold text-fg', className)} {...rest} />
  );
}

export function CardBody({ className, ...rest }: DivProps) {
  return <div className={cn('px-5 py-4', className)} {...rest} />;
}
