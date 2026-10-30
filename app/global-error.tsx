'use client';

/**
 * The root layout itself failed, so this replaces the whole document and
 * globals.css is gone with it: hence its own <html> and inline styles. Shows
 * the digest, the handle to the server log line, and never the error's text.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          boxSizing: 'border-box',
          background: '#0B0D12',
          color: '#E7E9EE',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <main role="alert" style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: '#8A91A0', fontSize: 14 }}>
            This is usually temporary. Try again, and if it keeps happening, reload the page.
          </p>
          {error.digest ? (
            <p style={{ color: '#8A91A0', fontFamily: 'monospace', fontSize: 12 }}>Reference: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 44,
              padding: '0 16px',
              border: 0,
              borderRadius: 8,
              background: '#F5A524',
              color: '#0B0D12',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
