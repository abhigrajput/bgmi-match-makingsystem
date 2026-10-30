/**
 * scripts/e2e-auth.ts -- the auth flows, end to end, through the real forms.
 *
 *   npx tsx scripts/e2e-auth.ts --target local --base http://127.0.0.1:3000
 *   npx tsx scripts/e2e-auth.ts --target prod  --base https://bgmi-match-makingsystem.vercel.app
 *
 * Drives headless Chrome against `--base` exactly as a person would: signed-out
 * access to a protected page, signup, the profile row the trigger must create,
 * sign out, wrong password, sign in, hard refresh, an expired access token,
 * password reset, duplicate email, duplicate IGN. `--target` picks the database
 * for the service-role steps (checking the profile row, generating the recovery
 * link, cleanup).
 *
 * On `--target local` it also exercises the two flows that send email, reading
 * the real message from the local mail catcher: the forgot-password form and
 * resend-confirmation. They are skipped elsewhere because they would send mail
 * to a fake address and spend the hosted project's 2-per-hour email limit.
 * Locally that limit also applies, so repeated runs within the hour can fail
 * those steps with the rate-limit message.
 *
 * Every account it creates uses the address prefix `e2e-auth-<run id>` and is
 * deleted at the end, pass or fail. Prints PASS/FAIL per check; exits non-zero
 * on any FAIL. No secret is printed.
 *
 * CHROME_PATH overrides the browser location (default: Chrome on Windows).
 * VERCEL_BYPASS, from the environment or .env.production.local, is sent as
 * `x-vercel-protection-bypass` so protected preview deployments can be tested.
 */

import { chromium, type BrowserContext, type Page } from 'playwright-core';

import { parseTarget, serviceClient, vercelBypass } from './lib/env';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MAILPIT = 'http://127.0.0.1:54324';
const SESSION_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;
const COOKIE_CHUNK = 3180; // @supabase/ssr's own chunk size.
const SIGNUP_REGION = 'India-North';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

type Check = { name: string; ok: boolean; detail: string };
type StoredSession = { access_token: string; refresh_token: string; expires_at: number };

/** The session as @supabase/ssr stores it: one cookie, or chunks .0, .1, ... */
async function readSession(context: BrowserContext) {
  const parts = (await context.cookies())
    .filter((c) => SESSION_COOKIE.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const raw = parts.map((c) => c.value).join('');
  const json = raw.startsWith('base64-') ? Buffer.from(raw.slice(7), 'base64url').toString() : raw;
  return { parts, session: json ? (JSON.parse(json) as StoredSession) : null };
}

/**
 * Makes the stored access token look expired, which is what an hour of idling
 * does: the client sees expires_at in the past and must spend the refresh
 * token. The refresh token itself stays genuine, so the rotation is real.
 */
async function expireSession(context: BrowserContext) {
  const { parts, session } = await readSession(context);
  if (!session || parts.length === 0) throw new Error('no session cookie to expire');
  const value = `base64-${Buffer.from(
    JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) - 60 }),
  ).toString('base64url')}`;

  const first = parts[0]!;
  const baseName = first.name.replace(/\.\d+$/, '');
  for (const part of parts) await context.clearCookies({ name: part.name });

  const chunks = value.match(new RegExp(`.{1,${COOKIE_CHUNK}}`, 'g')) ?? [];
  await context.addCookies(
    chunks.map((chunk, index) => ({
      name: chunks.length === 1 ? baseName : `${baseName}.${index}`,
      value: chunk,
      domain: first.domain,
      path: first.path,
      expires: first.expires,
      httpOnly: first.httpOnly,
      secure: first.secure,
      sameSite: first.sameSite,
    })),
  );
  return session;
}

/** Newest local message to `to`, as text. Polls briefly: delivery is async. */
async function waitForMail(to: string, notBefore: number): Promise<string | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages = [] } = (await search.json()) as { messages?: { ID: string; Created: string }[] };
    const fresh = messages.find((m) => new Date(m.Created).getTime() >= notBefore);
    if (fresh) {
      const message = await fetch(`${MAILPIT}/api/v1/message/${fresh.ID}`);
      const { Text, HTML } = (await message.json()) as { Text?: string; HTML?: string };
      return `${Text ?? ''}\n${HTML ?? ''}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

function verifyLink(mail: string): string | null {
  const match = mail.match(/https?:\/\/[^\s"'<>)]+\/auth\/v1\/verify[^\s"'<>)]*/);
  return match ? match[0].replace(/&amp;/g, '&') : null;
}

async function main() {
  const target = parseTarget();
  const base = (argValue('--base') ?? '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('Pass --base <app url>.');

  const db = serviceClient(target);
  const runId = Date.now().toString(36);
  const prefix = `e2e-auth-${runId}`;
  const email = `${prefix}@squadsync-e2e.test`;
  let password = `E2e-${runId}-${Math.random().toString(36).slice(2, 10)}`;
  const ign = `e2e_${runId}`.slice(0, 20);
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail = '') => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const bypass = vercelBypass();
  const context = await browser.newContext({
    extraHTTPHeaders: bypass ? { 'x-vercel-protection-bypass': bypass } : {},
  });
  const page = await context.newPage();
  const pathOf = (p: Page) => new URL(p.url()).pathname;

  /** Form-level and field-level messages, not Next's empty route announcer. */
  const formMessages = async (p: Page) =>
    (await p.locator('form [role="alert"], [role="status"]').allInnerTexts())
      .map((t) => t.trim())
      .filter(Boolean)
      .join(' | ');

  /**
   * Waits for the server action's own POST response, not for a message to
   * appear: after a failed attempt the previous message is still on screen,
   * and reading it would report the old result.
   */
  async function submitAndRead(p: Page) {
    return clickAndRead(p, async () => p.click('form button[type="submit"]'));
  }

  async function clickAndRead(p: Page, click: () => Promise<void>) {
    const response = p.waitForResponse((r) => r.request().method() === 'POST', { timeout: 30000 });
    await click();
    // Bounded: Playwright's finished() never resolves for the 303 a redirecting
    // server action returns, though the browser has already moved on (checked
    // directly: POST 303 in 606 ms, page on /dashboard, finished() still pending
    // at 15 s). settle() below is what decides the page is done.
    const answered = await response.catch(() => null);
    await Promise.race([
      answered?.finished().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    await settle(p);
    return formMessages(p).catch(() => '');
  }

  /**
   * Waits until nothing on screen has changed for a second and no submit button
   * is pending. networkidle cannot do this: it is reached once per document and
   * then returns at once, while the action's result and any client-side redirect
   * render afterwards.
   */
  async function settle(p: Page) {
    const deadline = Date.now() + 25000;
    let last = '';
    let stableSince = Date.now();
    while (Date.now() < deadline) {
      let snapshot: string;
      let pending = true;
      try {
        pending = (await p.getByText('Working…').count()) > 0;
        snapshot = `${p.url()}|${await formMessages(p)}`;
      } catch {
        snapshot = `navigating ${Date.now()}`; // Mid-navigation reads throw.
      }
      if (snapshot !== last) {
        last = snapshot;
        stableSince = Date.now();
      } else if (!pending && Date.now() - stableSince >= 1000) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async function fillSignup(p: Page, values: { email: string; ign: string }) {
    await p.goto(`${base}/signup`, { waitUntil: 'networkidle' });
    await p.fill('#display_name', 'E2E Test');
    await p.fill('#bgmi_ign', values.ign);
    await p.fill('#email', values.email);
    await p.fill('#password', password);
    await p.selectOption('#region', SIGNUP_REGION);
    await p.selectOption('#primary_role', 'sniper');
    const consent = p.locator('input#consent');
    if ((await consent.count()) > 0) await consent.check();
  }

  async function signIn(p: Page, pass: string) {
    await p.goto(`${base}/login`, { waitUntil: 'networkidle' });
    await p.fill('#email', email);
    await p.fill('#password', pass);
    return submitAndRead(p);
  }

  async function signOut(p: Page) {
    await p.locator('form[action="/auth/signout"] button:visible').first().click();
    await p.waitForURL((url) => url.pathname === '/', { timeout: 20000 });
  }

  try {
    // Signed-out access to a protected page.
    await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
    check('signed-out /dashboard redirects to /login', pathOf(page) === '/login', page.url().replace(base, ''));

    // Validation on the server action, with the browser's own checks off.
    await fillSignup(page, { email, ign });
    await page.fill('#password', 'too-short');
    let message = await submitAndRead(page);
    check('signup: 9-character password is refused', /at least 10 characters/i.test(message), message);

    // Signup.
    await fillSignup(page, { email, ign });
    message = await submitAndRead(page);
    if (pathOf(page) !== '/dashboard' && /confirm/i.test(message)) {
      // Email confirmation is on: confirm through the admin API, then sign in.
      const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
      const user = data?.users.find((u) => u.email === email);
      if (user) await db.auth.admin.updateUserById(user.id, { email_confirm: true });
      check('signup asks to confirm email', true, 'confirmed via admin API');
      message = await signIn(page, password);
    }
    check('signup reaches /dashboard', pathOf(page) === '/dashboard', pathOf(page) === '/dashboard' ? '' : message || pathOf(page));

    // The trigger built the profile, and 0007 saved the region.
    {
      const { data, error } = await db.from('profiles').select('region, auth_user_id').eq('bgmi_ign', ign);
      check('handle_new_user created the profile row', !error && data?.length === 1 && !!data[0]!.auth_user_id, error?.message ?? `${data?.length ?? 0} row(s)`);
      check('signup region saved to the profile (0007)', data?.[0]?.region === SIGNUP_REGION, String(data?.[0]?.region));
    }

    // The role picked at signup pre-fills preferences, without creating a row.
    await page.goto(`${base}/profile`, { waitUntil: 'networkidle' });
    check('signup role pre-fills the preferences form', (await page.inputValue('#primary_role')) === 'sniper');

    // Sign out.
    await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle' });
    await signOut(page);
    check('sign out lands on /', pathOf(page) === '/');
    check('sign out clears the session cookie', (await readSession(context)).parts.length === 0);
    await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
    check('after sign out, /dashboard redirects to /login', pathOf(page) === '/login');

    // Wrong password.
    message = await signIn(page, `${password}-wrong`);
    check('wrong password: generic message', /incorrect email or password/i.test(message), message);

    // Correct password.
    message = await signIn(page, password);
    check('sign in reaches /dashboard', pathOf(page) === '/dashboard', pathOf(page) === '/dashboard' ? '' : message || pathOf(page));

    // Hard refresh keeps the session.
    await page.reload({ waitUntil: 'domcontentloaded' });
    check('hard refresh keeps the session', pathOf(page) === '/dashboard');

    // An expired access token on a protected page: middleware must refresh it
    // and write the rotated tokens back to the browser.
    {
      const before = await expireSession(context);
      await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle' });
      const { session: after } = await readSession(context);
      check('expired token on /dashboard: stays signed in', pathOf(page) === '/dashboard', pathOf(page));
      check('expired token on /dashboard: tokens rotated and saved',
        !!after && after.refresh_token !== before.refresh_token && after.expires_at > Date.now() / 1000);

      await page.reload({ waitUntil: 'networkidle' });
      check('after refresh: hard refresh still signed in', pathOf(page) === '/dashboard');
      await page.goto(`${base}/profile`, { waitUntil: 'networkidle' });
      check('after refresh: navigation still signed in', pathOf(page) === '/profile');
    }

    // The same on a public page. Skipping middleware for signed-in visitors to
    // public pages would lose the rotated token here (Task.md, decisions): the
    // page refreshes but cannot save, and the next page finds a spent token.
    {
      const before = await expireSession(context);
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      const { session: after } = await readSession(context);
      check('expired token on /: tokens rotated and saved',
        !!after && after.refresh_token !== before.refresh_token && after.expires_at > Date.now() / 1000);
      await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle' });
      check('expired token on /: next protected page still signed in', pathOf(page) === '/dashboard', pathOf(page));
    }
    await signOut(page);

    // Password reset, from the recovery link onward. generateLink sends no mail,
    // so this is safe on any target. The fragment is opened on --base directly,
    // because a preview hostname is not on Supabase's redirect allow-list.
    {
      const { data, error } = await db.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: `${base}/reset-password` },
      });
      if (error || !data.properties?.action_link) throw new Error(`generateLink: ${error?.message ?? 'no link'}`);
      const verified = await fetch(data.properties.action_link, { redirect: 'manual' });
      const fragment = new URL(verified.headers.get('location') ?? `${base}/`).hash;
      check('recovery link returns a session fragment', fragment.includes('access_token'));

      await page.goto(`${base}/reset-password${fragment}`, { waitUntil: 'networkidle' });
      check('reset page removes the tokens from the address bar', !page.url().includes('access_token'));

      const save = page.locator('form button[type="submit"]');
      await page.fill('#new-password', 'too-short');
      await page.fill('#confirm-password', 'too-short');
      await save.click();
      check('reset: 9-character password is refused', /at least 10 characters/i.test(await formMessages(page)));

      const oldPassword = password;
      password = `${password}-new`;
      await page.fill('#new-password', password);
      await page.fill('#confirm-password', password);
      await save.click();
      await page.waitForURL((url) => url.pathname === '/dashboard', { timeout: 20000 });
      check('reset: new password saved, reaches /dashboard', pathOf(page) === '/dashboard');
      await signOut(page);

      message = await signIn(page, oldPassword);
      check('reset: old password no longer works', /incorrect email or password/i.test(message), message);
      await signIn(page, password);
      check('reset: new password signs in', pathOf(page) === '/dashboard', pathOf(page));
      await signOut(page);
    }

    // Duplicate email.
    await fillSignup(page, { email, ign: `${ign.slice(0, 17)}_d` });
    message = await submitAndRead(page);
    check('duplicate email: says the account exists', /already exists/i.test(message), message);

    // Duplicate IGN, new email.
    await fillSignup(page, { email: `${prefix}-dup@squadsync-e2e.test`, ign });
    message = await submitAndRead(page);
    check('duplicate IGN: says the name is taken', /in-game name is already taken/i.test(message), message);

    if (target === 'local') {
      // The real forgot-password form and the email it sends.
      const started = Date.now() - 1000;
      await page.goto(`${base}/forgot-password`, { waitUntil: 'networkidle' });
      await page.fill('#email', email);
      message = await submitAndRead(page);
      check('forgot password: neutral notice', /if that email has an account/i.test(message), message);
      const mail = await waitForMail(email, started);
      const link = mail ? verifyLink(mail) : null;
      check('forgot password: email arrives with a link', !!link);
      check('forgot password: link targets /reset-password', !!mail && mail.includes('reset-password'));
      if (link) {
        await page.goto(link, { waitUntil: 'networkidle' });
        check('forgot password: link opens the new-password form', (await page.locator('#new-password').count()) === 1, page.url().split('#')[0]!.replace(base, ''));
        await context.clearCookies();
      }

      // An unknown address gets the same answer.
      await page.goto(`${base}/forgot-password`, { waitUntil: 'networkidle' });
      await page.fill('#email', `${prefix}-nobody@squadsync-e2e.test`);
      message = await submitAndRead(page);
      check('forgot password: unknown email gets the same notice', /if that email has an account/i.test(message), message);

      // Resend confirmation, from an unconfirmed account.
      const pending = `${prefix}-pending@squadsync-e2e.test`;
      const created = await db.auth.admin.createUser({
        email: pending,
        password,
        email_confirm: false,
        user_metadata: { display_name: 'E2E Pending', bgmi_ign: `${ign.slice(0, 17)}_p` },
      });
      if (created.error) throw new Error(`createUser: ${created.error.message}`);
      await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
      await page.fill('#email', pending);
      await page.fill('#password', password);
      message = await submitAndRead(page);
      check('unconfirmed login: says to confirm', /confirm your email/i.test(message), message);

      const resendAt = Date.now() - 1000;
      const resend = page.getByRole('button', { name: /send the confirmation email again/i });
      message = await clickAndRead(page, () => resend.click());
      check('resend: confirms it sent', /new link is on its way/i.test(message), message);
      check('resend: button replaced by a countdown', (await resend.count()) === 0 && (await page.getByText(/you can ask again in \d+ seconds/i).count()) === 1);

      const resent = await waitForMail(pending, resendAt);
      const confirmLink = resent ? verifyLink(resent) : null;
      check('resend: email arrives with a link', !!confirmLink);
      if (confirmLink) {
        await page.goto(confirmLink, { waitUntil: 'networkidle' });
        await page.waitForURL((url) => url.pathname === '/dashboard', { timeout: 20000 }).catch(() => {});
        check('resend: link confirms and signs in', pathOf(page) === '/dashboard', pathOf(page));
      }
    }
  } catch (error) {
    check('script ran to completion', false, error instanceof Error ? error.message.split('\n')[0]! : String(error));
  } finally {
    await browser.close();

    // Cleanup: every account this run created, then prove the profiles went too.
    const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
    const mine = (data?.users ?? []).filter((u) => u.email?.startsWith(prefix));
    let deleted = 0;
    for (const user of mine) {
      const { error } = await db.auth.admin.deleteUser(user.id);
      if (!error) deleted++;
    }
    const { count } = await db.from('profiles').select('id', { count: 'exact', head: true }).like('bgmi_ign', `${ign.slice(0, 17)}%`);
    check('cleanup: test users and profiles deleted', deleted === mine.length && count === 0, `${deleted}/${mine.length} users, ${count ?? '?'} profile rows left`);
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
