import { cn } from '@/lib/cn';

/**
 * Data table. The wrapper owns horizontal scroll, so a wide table scrolls
 * inside its card on a phone instead of widening the whole page. The header is
 * sticky within that wrapper when a max height is set.
 */
export function Table({
  className,
  wrapperClassName,
  ...rest
}: React.TableHTMLAttributes<HTMLTableElement> & {
  wrapperClassName?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-auto rounded-card border border-border',
        wrapperClassName,
      )}
    >
      <table
        className={cn('w-full border-collapse text-left text-sm', className)}
        {...rest}
      />
    </div>
  );
}

export function THead({
  className,
  ...rest
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        'sticky top-0 z-10 bg-surface-2 text-xs uppercase tracking-wide text-muted',
        className,
      )}
      {...rest}
    />
  );
}

export function TBody({
  className,
  ...rest
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn(
        'bg-surface [&>tr:nth-child(even)]:bg-surface-2/40',
        className,
      )}
      {...rest}
    />
  );
}

export function TR({
  className,
  ...rest
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-t border-border transition-colors duration-150 hover:bg-surface-2/70',
        className,
      )}
      {...rest}
    />
  );
}

export function TH({
  className,
  ...rest
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('whitespace-nowrap px-4 py-2.5 font-medium', className)}
      {...rest}
    />
  );
}

export function TD({
  className,
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-2.5 align-middle', className)} {...rest} />;
}
