/**
 * Shell for the login and signup pages.
 *
 * `(auth)` is a route group: the parentheses keep it out of the URL, so these
 * pages are /login and /signup, not /auth/login. The group exists to give both
 * forms this layout without imposing it on the rest of the app, and to keep the
 * two Server Actions they share in one place alongside them.
 *
 * Note the distinction from the sibling `app/auth/` directory, which is not a
 * group and does appear in URLs: /auth/callback and /auth/signout are machine
 * endpoints, not pages, and they deliberately do not inherit this layout.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6 py-12">
      {children}
    </main>
  );
}
