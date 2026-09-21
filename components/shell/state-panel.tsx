import { AlertTriangle } from 'lucide-react';

/**
 * Full-width explanation for a page that could not render its content -- a
 * query error, or a missing profile row. Stated plainly rather than rendered as
 * an empty page, because an empty page looks like a styling bug and sends
 * someone looking in entirely the wrong place.
 */
export function StatePanel({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div role="alert" className="rounded-card border border-danger/40 bg-danger/5 p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
        <div>
          <h1 className="text-base font-semibold text-fg">{title}</h1>
          <p className="mt-1 break-words text-sm text-muted">{body}</p>
          {action ? <div className="mt-4">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}
