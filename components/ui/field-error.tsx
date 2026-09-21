/**
 * Renders the zod messages for one field, or nothing.
 *
 * `role="alert"` so a screen reader announces the message when it appears
 * after a failed submit; the element is omitted entirely rather than rendered
 * empty, because an empty live region can announce a blank string.
 */
export function FieldError({
  id,
  messages,
}: {
  id: string;
  messages?: string[];
}) {
  if (!messages || messages.length === 0) return null;

  return (
    <p id={id} role="alert" className="mt-1.5 text-sm text-danger">
      {messages.join(' ')}
    </p>
  );
}
