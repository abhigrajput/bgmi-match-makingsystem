/**
 * scripts/check-ui.ts -- what a browser sees, at every width that matters.
 *
 *   npx tsx scripts/check-ui.ts --target local --base http://127.0.0.1:3000
 *   npx tsx scripts/check-ui.ts --target prod --base https://<preview> --browser webkit
 *
 * For each route and width: HTTP status, console errors, failed requests,
 * horizontal overflow, and every link, button or field under 44 px. Then the
 * mobile menu's focus trap, and the SEO surface: unique titles and descriptions,
 * canonical, Open Graph, Twitter, noindex, robots.txt, sitemap, icons and the
 * social image.
 *
 * Signs in as a throwaway user for the signed-in routes and deletes it after.
 * --browser is chromium (the default, system Chrome), firefox or webkit; the
 * last two need `npx playwright-core install firefox webkit`. VERCEL_BYPASS is
 * sent for protected previews. Prints PASS/FAIL and no secret; exits 1 on a FAIL.
 */

import { chromium, firefox, webkit, type Browser, type Page } from 'playwright-core';

import { parseTarget, serviceClient, vercelBypass } from './lib/env';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIN_TARGET = 44;
const WIDTHS = [320, 375, 414, 768, 1024, 1440];
const PUBLIC_ROUTES = ['/', '/contact', '/login', '/signup', '/forgot-password', '/reset-password'];
const INDEXED_ROUTES = ['/', '/contact'];
const APP_ROUTES = ['/dashboard', '/tournaments', '/players', '/leaderboard', '/matches', '/analytics', '/profile', '/profile/availability'];

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

let failures = 0;
const report = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

type Measured = { scrollWidth: number; clientWidth: number; pastEdge: string[]; small: string[] };

// tsx wraps named functions in __name(), which does not exist in the page.
const measure = async (page: Page) => {
  await page.evaluate('globalThis.__name = (f) => f');
  return page.evaluate((min): Measured => {
    const doc = document.documentElement;
    const visible = (el: Element) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      // sr-only skip links are 1x1 until focused, and then they are tall enough.
      return box.width > 1 && box.height > 1 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const describe = (el: Element) => {
      const box = el.getBoundingClientRect();
      const label = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('href') || '')
        .trim().replace(/\s+/g, ' ').slice(0, 30);
      return `${el.tagName.toLowerCase()} "${label}" ${Math.round(box.width)}x${Math.round(box.height)}`;
    };
    const small = [...document.querySelectorAll('a[href], button, [role="button"], [role="tab"], summary, select, textarea, input:not([type="hidden"])')]
      .filter((el) => el.getAttribute('tabindex') !== '-1' && visible(el))
      .filter((el) => {
        // A checkbox's target includes its label, which toggles it too.
        const input = el as HTMLInputElement;
        const label = ['checkbox', 'radio'].includes(input.type) ? input.labels?.[0] : null;
        const box = (label ?? el).getBoundingClientRect();
        return box.width < min || box.height < min;
      })
      .map(describe);
    const pastEdge = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1 && getComputedStyle(el).position !== 'fixed' && visible(el))
      .slice(0, 3)
      .map(describe);
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, pastEdge, small };
  }, MIN_TARGET);
};

async function sweep(browser: Browser, base: string, routes: string[], storageState?: Parameters<Browser['newContext']>[0]) {
  const bypass = vercelBypass();
  const totals = { console: 0, failed: 0, overflow: 0, small: 0 };
  const allSmall = new Set<string>();

  for (const width of WIDTHS) {
    const context = await browser.newContext({
      ...storageState,
      viewport: { width, height: 800 },
      extraHTTPHeaders: bypass ? { 'x-vercel-protection-bypass': bypass } : {},
    });
    for (const route of routes) {
      const page = await context.newPage();
      const errors: string[] = [];
      const failed: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)); });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 150)}`));
      page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });

      const response = await page.goto(base + route, { waitUntil: 'load', timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
      const m = await measure(page);
      const overflow = m.scrollWidth > m.clientWidth;

      totals.console += errors.length;
      totals.failed += failed.length;
      totals.overflow += overflow ? 1 : 0;
      totals.small += m.small.length;
      // One example per kind of element: a list of 200 rows is one finding.
      m.small.forEach((s) => {
        const kind = `${route}: ${s.split(' ')[0]} ${s.split(' ').pop()?.split('x')[1]}h`;
        if (![...allSmall].some((seen) => seen.startsWith(kind))) allSmall.add(`${kind} e.g. ${s}`);
      });

      if (!response?.ok()) report(`${route} at ${width} px`, false, `HTTP ${response?.status()}`);
      if (overflow) report(`no overflow on ${route} at ${width} px`, false, `${m.scrollWidth}/${m.clientWidth}: ${m.pastEdge.join('; ')}`);
      for (const e of errors) console.log(`      console ${route} ${width}: ${e}`);
      for (const f of failed) console.log(`      failed ${route} ${width}: ${f}`);
      await page.close();
    }
    await context.close();
  }
  return { totals, allSmall };
}

async function checkMenu(browser: Browser, base: string) {
  const bypass = vercelBypass();
  const context = await browser.newContext({
    viewport: { width: 375, height: 800 },
    extraHTTPHeaders: bypass ? { 'x-vercel-protection-bypass': bypass } : {},
  });
  const page = await context.newPage();
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

  const button = page.getByRole('button', { name: 'Open menu' });
  await button.click();
  const dialog = page.locator('dialog[open]');
  report('mobile menu opens', (await dialog.count()) === 1);

  let escaped = false;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const outside = await page.evaluate(() => {
      const active = document.activeElement;
      const open = document.querySelector('dialog[open]');
      return !!active && active !== document.body && !!open && !open.contains(active);
    });
    if (outside) escaped = true;
  }
  report('mobile menu traps focus through 12 tabs', !escaped);

  await page.keyboard.press('Escape');
  report('Escape closes the mobile menu', (await dialog.count()) === 0);
  report('focus returns to the menu button', await button.evaluate((el) => el === document.activeElement));

  await button.click();
  await page.getByRole('dialog').getByRole('link', { name: 'Contact' }).click();
  await page.waitForURL(/\/contact$/, { timeout: 10_000 }).catch(() => {});
  report('a menu link navigates and closes the menu', page.url().endsWith('/contact') && (await page.locator('dialog[open]').count()) === 0);
  await context.close();
}

async function checkSeo(browser: Browser, base: string, headers: Record<string, string>) {
  const context = await browser.newContext({ extraHTTPHeaders: headers });
  const page = await context.newPage();
  const titles = new Map<string, string>();
  const descriptions = new Map<string, string>();
  const content = (selector: string) => page.locator(selector).first().getAttribute('content').catch(() => null);

  for (const route of PUBLIC_ROUTES) {
    await page.goto(base + route, { waitUntil: 'load' });
    const title = await page.title();
    const description = (await content('meta[name="description"]')) ?? '';
    const canonical = await page.locator('link[rel="canonical"]').first().getAttribute('href').catch(() => null);
    const robots = (await content('meta[name="robots"]')) ?? '';
    const ogImage = (await content('meta[property="og:image"]')) ?? '';
    const shouldIndex = INDEXED_ROUTES.includes(route);

    report(`${route}: unique title`, !!title && ![...titles.values()].includes(title), title);
    report(`${route}: unique description`, !!description && ![...descriptions.values()].includes(description));
    titles.set(route, title);
    descriptions.set(route, description);
    report(`${route}: absolute canonical for this path`, !!canonical && /^https?:\/\//.test(canonical) && new URL(canonical).pathname === route, canonical ?? 'none');
    report(`${route}: Open Graph and Twitter tags`, !!(await content('meta[property="og:title"]')) && /^https?:\/\//.test(ogImage) && (await content('meta[name="twitter:card"]')) === 'summary_large_image');
    report(`${route}: ${shouldIndex ? 'indexable' : 'noindex'}`, shouldIndex ? !robots.includes('noindex') : robots.includes('noindex'), robots || 'no robots tag');
  }
  await context.close();

  const get = (path: string) => fetch(base + path, { headers, redirect: 'manual' });

  const robotsTxt = await get('/robots.txt');
  const robotsBody = await robotsTxt.text();
  report('/robots.txt lists the sitemap and bars /api/', robotsTxt.ok && robotsBody.includes('/sitemap.xml') && robotsBody.includes('/api/'));

  const sitemap = await get('/sitemap.xml');
  const sitemapBody = await sitemap.text();
  report('/sitemap.xml lists the public pages', sitemap.ok && sitemapBody.includes('/contact') && !sitemapBody.includes('/login'));

  for (const path of ['/favicon.ico', '/icon.png', '/apple-icon.png', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest']) {
    const response = await get(path);
    report(`${path} is served`, response.ok, `HTTP ${response.status}`);
  }

  const og = await get('/og-image.png');
  const png = Buffer.from(await og.arrayBuffer());
  const size = png.length > 24 ? `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}` : 'unreadable';
  report('/og-image.png is a 1200x630 PNG', og.ok && size === '1200x630', size);

  const api = await get('/api/health');
  report('/api/* says noindex in a header', (api.headers.get('x-robots-tag') ?? '').includes('noindex'));

  const missing = await get('/this-page-does-not-exist');
  const missingBody = await missing.text();
  report('an unknown path is a 404 with our page, no stack trace', missing.status === 404 && missingBody.includes('Page not found') && !/\bat .+\.js:\d+/.test(missingBody), `HTTP ${missing.status}`);
}

async function main() {
  const target = parseTarget();
  const base = (argValue('--base') ?? '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('Pass --base <app url>.');
  const browserName = argValue('--browser') ?? 'chromium';

  const browser =
    browserName === 'firefox'
      ? await firefox.launch({ headless: true })
      : browserName === 'webkit'
        ? await webkit.launch({ headless: true })
        : await chromium.launch({ executablePath: CHROME, headless: true });

  const bypass = vercelBypass();
  const headers: Record<string, string> = bypass ? { 'x-vercel-protection-bypass': bypass } : {};
  const db = serviceClient(target);
  const runId = Date.now().toString(36);
  const email = `check-ui-${runId}@squadsync-e2e.test`;
  const password = `CheckUi-${runId}-${Math.random().toString(36).slice(2, 10)}`;
  let userId: string | undefined;

  console.log(`Browser: ${browserName} ${browser.version()}. Base: ${base}\n`);

  try {
    const pub = await sweep(browser, base, PUBLIC_ROUTES);
    report(`public: 0 console errors across ${PUBLIC_ROUTES.length * WIDTHS.length} loads`, pub.totals.console === 0, String(pub.totals.console));
    report('public: 0 failed requests', pub.totals.failed === 0, String(pub.totals.failed));
    report('public: 0 pages with horizontal overflow', pub.totals.overflow === 0, String(pub.totals.overflow));
    report('public: 0 targets under 44 px', pub.totals.small === 0, String(pub.totals.small));
    [...pub.allSmall].slice(0, 30).forEach((s) => console.log(`      small ${s}`));

    await checkMenu(browser, base);
    await checkSeo(browser, base, headers);

    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: 'Check UI', bgmi_ign: `cu_${runId}`.slice(0, 20), region: 'India-South' },
    });
    if (error || !data.user) throw new Error(`could not create the test user: ${error?.code}`);
    userId = data.user.id;

    const signIn = await browser.newContext({ extraHTTPHeaders: headers });
    const page = await signIn.newPage();
    await page.goto(`${base}/login`, { waitUntil: 'load' });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('form button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    const storageState = await signIn.storageState();
    await signIn.close();

    const app = await sweep(browser, base, APP_ROUTES, { storageState });
    report(`signed in: 0 console errors across ${APP_ROUTES.length * WIDTHS.length} loads`, app.totals.console === 0, String(app.totals.console));
    report('signed in: 0 failed requests', app.totals.failed === 0, String(app.totals.failed));
    report('signed in: 0 pages with horizontal overflow', app.totals.overflow === 0, String(app.totals.overflow));
    report('signed in: 0 targets under 44 px', app.totals.small === 0, String(app.totals.small));
    [...app.allSmall].slice(0, 40).forEach((s) => console.log(`      small ${s}`));
  } finally {
    await browser.close();
    if (userId) {
      const { error } = await db.auth.admin.deleteUser(userId);
      report('cleanup: test user deleted', !error, error?.code ?? '');
    }
  }

  console.log(failures === 0 ? '\nUI checks pass.' : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
