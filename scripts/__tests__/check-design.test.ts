import { describe, expect, it } from 'vitest';

// @ts-expect-error -- plain .mjs script, no type declarations.
import { findViolations, stripComments } from '../check-design.mjs';

type Violation = { rule: string; line: number };
const rulesFor = (source: string, file = 'components/x.tsx') =>
  (findViolations(file, source) as Violation[]).map((v) => v.rule);

describe('check-design', () => {
  it.each([
    ['<button className="rounded-full px-3" />', 'rounded-full on a button or input'],
    ['<Link href="/" className="rounded-full" />', 'rounded-full on a button or input'],
    ['<div className="from-purple-500 to-blue-500" />', 'purple or violet gradient'],
    ['<span>\u{1F680} Go</span>', 'emoji as an icon'],
    ['<p>one — two</p>', 'em dash in user-facing text'],
    ['<p>We revolutionize squads</p>', 'banned phrase'],
    ['<p>Play seamlessly</p>', 'banned phrase'],
    ['<p>Lorem ipsum</p>', 'placeholder text'],
    ['<p>Made with love</p>', '"Made with" tag'],
    ['<p>10,000+ players</p>', 'fake metric or counter'],
    ['<section id="testimonials" />', 'testimonial'],
    ["window.addEventListener('mousemove', f)", 'cursor animation'],
    ['<div className="parallax" />', 'parallax'],
  ])('fails %s', (source, rule) => {
    expect(rulesFor(source)).toContain(rule);
  });

  it('fails a public page that shows the seeded counts, but not a route handler', () => {
    const source = 'await loadPublicStats()';
    expect(rulesFor(source, 'app/page.tsx')).toContain('fake metric: public page shows seeded counts');
    expect(rulesFor(source, 'app/api/public-stats/route.ts')).toEqual([]);
  });

  it('allows what the bans do not cover', () => {
    expect(rulesFor('<span className="rounded-full bg-accent" />')).toEqual([]);
    expect(rulesFor('<p>© 2026 SquadSync</p>')).toEqual([]);
    expect(rulesFor("const url = 'https://a.b/c'; // one — two")).toEqual([]);
    expect(rulesFor('/* — */ <p>fine</p>')).toEqual([]);
  });

  it('keeps line numbers true after removing comments', () => {
    const source = '/* one\n two */\n<p>a — b</p>';
    expect(stripComments(source).split('\n')).toHaveLength(3);
    expect((findViolations('x.tsx', source) as Violation[])[0]!.line).toBe(3);
  });
});
