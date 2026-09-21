/**
 * CSS-only tooltip. Shows on hover AND on keyboard focus inside the trigger
 * (group-focus-within), and the text is also the trigger's accessible
 * description, so it is never mouse-only information.
 */
export function Tooltip({
  content,
  children,
  id,
}: {
  content: string;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <span className="group relative inline-flex">
      <span aria-describedby={id} className="inline-flex">
        {children}
      </span>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-xs -translate-x-1/2 rounded-input border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-fg opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
      >
        {content}
      </span>
    </span>
  );
}
