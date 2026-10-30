/**
 * scripts/e2e-contact.ts -- the /contact form, through the real page.
 *
 *   npx tsx scripts/e2e-contact.ts --target local --base http://127.0.0.1:3000
 *   npx tsx scripts/e2e-contact.ts --target prod --base https://<preview>
 *
 * Validation messages, a stored message, the honeypot storing nothing, the
 * per-IP limit refusing the sixth send, and mailto and tel staying hidden unless
 * configured. Removes the messages it created and the contact rate-limit
 * counters, which only ever cost a stranger a fresh hour's allowance.
 * VERCEL_BYPASS is sent for protected previews. Prints PASS/FAIL, no secret.
 */

import { chromium, type Page } from 'playwright-core';

import { RATE_LIMITS } from '@/lib/rate-limit';

import { parseTarget, serviceClient, vercelBypass } from './lib/env';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const target = parseTarget();
  const base = (argValue('--base') ?? '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('Pass --base <app url>.');

  const db = serviceClient(target);
  const email = `e2e-contact-${Date.now().toString(36)}@squadsync-e2e.test`;
  const message = 'An automated contact form check. Safe to delete.';
  let failures = 0;
  const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };

  const stored = async () => {
    const { count } = await db.from('contact_messages').select('id', { count: 'exact', head: true }).eq('email', email);
    return count ?? 0;
  };

  const bypass = vercelBypass();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({
    extraHTTPHeaders: bypass ? { 'x-vercel-protection-bypass': bypass } : {},
  });
  const page = await context.newPage();

  const open = async () => {
    await page.goto(`${base}/contact`, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  };
  const fill = async (p: Page, values: { name: string; email: string; message: string }) => {
    await p.fill('input[name="name"]', values.name);
    await p.fill('input[name="email"]', values.email);
    await p.fill('textarea[name="message"]', values.message);
  };
  const submit = async (p: Page) => {
    await p.click('form button[type="submit"]');
    await p.locator('[role="alert"]:not(#__next-route-announcer__), [role="status"]').first().waitFor({ timeout: 15_000 }).catch(() => {});
    await p.waitForTimeout(300);
    return (await p.locator('main [role="alert"], main [role="status"]').allInnerTexts()).join(' | ').trim();
  };

  try {
    await open();
    const directLinks = await page.locator('main a[href^="mailto:"], main a[href^="tel:"]').count();
    const configured = !!process.env.CONTACT_EMAIL || !!process.env.CONTACT_PHONE;
    if (!configured && target === 'local') check('mailto and tel hidden when not configured', directLinks === 0, String(directLinks));

    await fill(page, { name: 'A', email: 'not-an-email', message: 'short' });
    const invalid = await submit(page);
    check('invalid form shows field errors', invalid.includes('Enter your name.') && invalid.includes('Write at least 10'), invalid.slice(0, 90));
    check('invalid form stores nothing', (await stored()) === 0);

    await open();
    await fill(page, { name: 'E2E Contact', email, message });
    await page.evaluate(() => {
      (document.querySelector('input[name="website"]') as HTMLInputElement).value = 'http://spam.invalid';
    });
    const honeypot = await submit(page);
    check('honeypot gets the normal success message', honeypot.includes('has been sent'), honeypot.slice(0, 60));
    check('honeypot stores nothing', (await stored()) === 0);

    await open();
    await fill(page, { name: 'E2E Contact', email, message });
    const sent = await submit(page);
    check('valid form shows success', sent.includes('has been sent'), sent.slice(0, 60));
    check('valid form stores one message', (await stored()) === 1, String(await stored()));

    let last = '';
    for (let i = 1; i <= RATE_LIMITS.contact.max; i++) {
      await open();
      await fill(page, { name: 'E2E Contact', email, message });
      last = await submit(page);
    }
    check('over the limit: says so', last.includes('Too many messages'), last.slice(0, 70));
    check(`over the limit: stores ${RATE_LIMITS.contact.max} in all`, (await stored()) === RATE_LIMITS.contact.max, String(await stored()));
  } finally {
    await browser.close();
    await db.from('contact_messages').delete().eq('email', email);
    await db.from('rate_limits').delete().like('key', 'contact:%');
    check('cleanup: test messages removed', (await stored()) === 0);
  }

  console.log(failures === 0 ? '\nContact form passes.' : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
