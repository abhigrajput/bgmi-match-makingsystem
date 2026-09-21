import { redirect } from 'next/navigation';

import { MobileTabBar, MobileTopBar, Sidebar } from '@/components/shell/nav';
import { createClient } from '@/lib/supabase/server';

/**
 * Shell for every signed-in page.
 *
 * `(app)` is a route group, so it adds nothing to URLs: /dashboard,
 * /tournaments, /profile and the rest keep their paths. It exists so one
 * layout owns the sidebar and one place decides "no session, go to /login".
 *
 * The session check here duplicates the middleware on purpose. Middleware runs
 * on an editable matcher and is a routing convenience; this layout renders for
 * every page in the group regardless of what the matcher says. Neither is the
 * security boundary -- RLS is -- but a page rendering with a null user is a
 * crash, and this makes that impossible.
 *
 * The profile read feeds only the name in the sidebar. A missing profile row
 * (the state handle_new_user() exists to prevent) is not fatal here; the
 * dashboard explains it in full.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, bgmi_ign, avatar_url')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  const displayName = profile?.display_name ?? user.email ?? 'Player';

  return (
    <div className="min-h-screen bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-input focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-accent-fg"
      >
        Skip to content
      </a>
      <Sidebar
        displayName={displayName}
        ign={profile?.bgmi_ign ?? ''}
        avatarUrl={profile?.avatar_url ?? null}
      />
      <MobileTopBar displayName={displayName} />
      <main
        id="main"
        className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 md:pb-12 md:pl-[17rem] md:pr-8 md:pt-8"
      >
        {children}
      </main>
      <MobileTabBar />
    </div>
  );
}
