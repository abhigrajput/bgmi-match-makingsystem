/**
 * scripts/e2e-auth.ts -- the auth flows, end to end, through the real forms.
 *
 *   npx tsx scripts/e2e-auth.ts --target local --base http://localhost:3000
 *   npx tsx scripts/e2e-auth.ts --target prod  --base https://bgmi-match-makingsystem.vercel.app
 *
 * Drives headless Chrome against `--base` exactly as a person would: signed-out
 * access to a protected page, signup, the profile row the trigger must create,
 * sign out, wrong password, sign in, duplicate email, duplicate IGN. `--target`
 * picks the database for the service-role steps (checking the profile row,
 * confirming the email when confirmation is on, and cleanup).
 *
 * Every account it creates uses the address prefix `e2e-auth-<run id>` and is
 * deleted at the end, pass or fail. Prints PASS/FAIL per check; exits non-zero
 * on any FAIL. No secret is printed.
 *
 * CHROME_PATH overrides the browser location (default: Chrome on Windows).
 * VERCEL_BYPASS, when set, is sent as `x-vercel-protection-bypass` so protected
 * preview deployments can be tested.
 */

import { chromium, type Page } from 'playwright-core';

import { parseTarget, serviceClient } from './lib/env';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

type Check = { name: string; ok: boolean; detail: string };

async function main() {
  const target = parseTarget();
  const base = (argValue('--base') ?? '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('Pass --base <app url>.');

  const db = serviceClient(target);
  const runId = Date.now().toString(36);
  const prefix = `e2e-auth-${runId}`;
  const email = `${prefix}@squadsync-e2e.test`;
  const password = `E2e-${runId}-${Math.random().toString(36).slice(2, 10)}`;
  const ign = `e2e_${runId}`.slice(0, 20);
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail = '') => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({
    extraHTTPHeaders: process.env.VERCEL_BYPASS
      ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS }
      : {},
  });
  const page = await context.newPage();

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
    const response = p.waitForResponse((r) => r.request().method() === 'POST', { timeout: 30000 });
    await p.click('form button[type="submit"]');
    await response.catch(() => {});
    // A successful action redirects; reading mid-navigation throws, so retry
    // once the new page has settled.
    for (let attempt = 0; attempt < 5; attempt++) {
      await p.waitForLoadState('networkidle').catch(() => {});
      try {
        return await formMessages(p);
      } catch {
        await p.waitForLoadState('load').catch(() => {});
      }
    }
    return '';
  }

  async function fillSignup(p: Page, values: { email: string; ign: string }) {
    await p.goto(`${base}/signup`, { waitUntil: 'networkidle' });
    await p.fill('#display_name', 'E2E Test');
    await p.fill('#bgmi_ign', values.ign);
    await p.fill('#email', values.email);
    await p.fill('#password', password);
    // Fields added after the first version of this form. Filled when present
    // so the script works on deployments from before and after.
    for (const id of ['region', 'primary_role']) {
      const select = p.locator(`select#${id}`);
      if ((await select.count()) > 0) {
        const value = await select.locator('option:not([value=""])').first().getAttribute('value');
        if (value) await select.selectOption(value);
      }
    }
    const consent = p.locator('input#consent');
    if ((await consent.count()) > 0) await consent.check();
  }

  async function signOut(p: Page) {
    await p.locator('form[action="/auth/signout"] button:visible').first().click();
    await p.waitForURL((url) => !url.pathname.startsWith('/dashboard'), { timeout: 20000 });
  }

  try {
    // 1. Signed-out access to a protected page.
    await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
    check('signed-out /dashboard redirects to /login', new URL(page.url()).pathname === '/login', page.url().replace(base, ''));

    // 2. Signup.
    await fillSignup(page, { email, ign });
    let message = await submitAndRead(page);
    let path = new URL(page.url()).pathname;
    if (path !== '/dashboard' && /confirm/i.test(message)) {
      // Email confirmation is on: confirm through the admin API, then sign in.
      const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
      const user = data?.users.find((u) => u.email === email);
      if (user) await db.auth.admin.updateUserById(user.id, { email_confirm: true });
      check('signup asks to confirm email', true, 'confirmed via admin API');
      await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
      await page.fill('#email', email);
      await page.fill('#password', password);
      message = await submitAndRead(page);
      path = new URL(page.url()).pathname;
    }
    check('signup reaches /dashboard', path === '/dashboard', path === '/dashboard' ? '' : message || path);

    // 3. The trigger built the profile.
    {
      const { data, error } = await db.from('profiles').select('bgmi_ign, auth_user_id').eq('bgmi_ign', ign);
      check('handle_new_user created the profile row', !error && data?.length === 1 && !!data[0]!.auth_user_id, error?.message ?? `${data?.length ?? 0} row(s)`);
    }

    // 4. Sign out.
    await signOut(page);
    const afterSignOut = new URL(page.url()).pathname;
    check('sign out leaves the app', afterSignOut === '/' || afterSignOut === '/login', afterSignOut);
    await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
    check('after sign out, /dashboard redirects to /login', new URL(page.url()).pathname === '/login');

    // 5. Wrong password.
    await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
    await page.fill('#email', email);
    await page.fill('#password', `${password}-wrong`);
    message = await submitAndRead(page);
    check('wrong password: generic message', /incorrect email or password/i.test(message), message);

    // 6. Correct password.
    await page.fill('#password', password);
    message = await submitAndRead(page);
    path = new URL(page.url()).pathname;
    check('sign in reaches /dashboard', path === '/dashboard', path === '/dashboard' ? '' : message || path);

    // 7. Hard refresh keeps the session.
    await page.reload({ waitUntil: 'domcontentloaded' });
    check('hard refresh keeps the session', new URL(page.url()).pathname === '/dashboard');
    await signOut(page);

    // 8. Duplicate email.
    await fillSignup(page, { email, ign: `${ign.slice(0, 17)}_d` });
    message = await submitAndRead(page);
    check('duplicate email: says the account exists', /already exists/i.test(message), message);

    // 9. Duplicate IGN, new email.
    await fillSignup(page, { email: `${prefix}-dup@squadsync-e2e.test`, ign });
    message = await submitAndRead(page);
    check('duplicate IGN: says the name is taken', /in-game name is already taken/i.test(message), message);
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
    const { count } = await db.from('profiles').select('id', { count: 'exact', head: true }).eq('bgmi_ign', ign);
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
