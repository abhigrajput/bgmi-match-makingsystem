#!/usr/bin/env node
/**
 * scripts/check-design.mjs -- the hard bans in Design.md, as a failing check.
 *
 *   node scripts/check-design.mjs
 *
 * Scans app/, components/, lib/ and the Tailwind config, with comments removed
 * and tests skipped, so it judges what can reach a visitor. Prints
 * file:line, rule and the matched text; exits 1 on any violation.
 *
 * A text search cannot judge meaning, so "fake metrics" here means the shapes
 * they take: "10,000+ players", counter libraries, and a public page reading
 * public_stats(), which counts the seeded demo rows.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOTS = ['app', 'components', 'lib', 'tailwind.config.ts'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.mjs']);

const RULES = [
  {
    name: 'rounded-full on a button or input',
    pattern:
      /<(?:button|input|select|textarea|a|Link|Button|ButtonLink|Input|Select|Textarea)\b[^>]*\brounded-full\b/g,
    multiline: true,
  },
  {
    name: 'purple or violet gradient',
    pattern:
      /\b(?:from|via|to)-(?:purple|violet|fuchsia)-\d+|(?:linear|radial|conic)-gradient\([^)]*(?:purple|violet|#8b5cf6|#a78bfa|#7c3aed)/gi,
  },
  { name: 'emoji as an icon', pattern: /(?![©®™])\p{Extended_Pictographic}/gu },
  { name: 'em dash in user-facing text', pattern: /—|&mdash;/g },
  {
    name: 'banned phrase',
    pattern: /\b(?:revolutioni[sz]e\w*|seamless(?:ly)?|leverag\w*|cutting-edge|game-?changer\w*|unleash\w*|supercharge\w*)\b/gi,
  },
  {
    name: 'placeholder text',
    pattern: /lorem ipsum|coming soon|placeholder text|your (?:company|business|name) here|\bTBD\b|\bexample\.(?:com|org)\b/gi,
  },
  { name: '"Made with" tag', pattern: /\bmade with\b/gi },
  {
    name: 'fake metric or counter',
    pattern:
      /\b\d[\d,.]*\s*[kKmM]?\+\s*(?:players|users|gamers|squads|teams|matches|tournaments|downloads)\b|\b(?:count-?up|odometer|animated-?(?:number|counter))\b/gi,
  },
  { name: 'testimonial', pattern: /testimonial|what (?:our )?(?:players|users|customers) say|\btrusted by\b/gi },
  { name: 'cursor animation', pattern: /custom-?cursor|cursor-?(?:trail|follow\w*)|onMouseMove|['"]mousemove['"]/g },
  { name: 'parallax', pattern: /parallax|rellax|\buseScroll\b/gi },
  // public_stats() counts seed rows, so showing it to visitors overstates usage.
  { name: 'fake metric: public page shows seeded counts', pattern: /\bloadPublicStats\(/g, only: /[\\/]page\.tsx$/ },
];

function walk(target, out = []) {
  if (!fs.existsSync(target)) return out;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (EXTENSIONS.has(path.extname(target))) out.push(target);
    return out;
  }
  for (const entry of fs.readdirSync(target)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    walk(path.join(target, entry), out);
  }
  return out;
}

/** Blanks comments, keeping every newline so line numbers stay true. */
export function stripComments(source) {
  const blank = (match) => match.replace(/[^\n]/g, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[\s;{}(,])\/\/[^\n]*/g, (match, lead) => lead + blank(match.slice(lead.length)));
}

export function findViolations(file, source) {
  const text = stripComments(source);
  const found = [];
  for (const rule of RULES) {
    if (rule.only && !rule.only.test(file)) continue;
    for (const match of text.matchAll(rule.pattern)) {
      const line = text.slice(0, match.index).split('\n').length;
      found.push({ file, line, rule: rule.name, text: match[0].replace(/\s+/g, ' ').slice(0, 70) });
    }
  }
  return found;
}

function main() {
  const files = ROOTS.flatMap((root) => walk(root));
  const violations = files.flatMap((file) => findViolations(file, fs.readFileSync(file, 'utf8')));

  for (const v of violations) {
    console.log(`${v.file.replaceAll('\\', '/')}:${v.line}  ${v.rule}  [${v.text}]`);
  }

  const byRule = new Map();
  for (const v of violations) byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1);
  console.log(`\nScanned ${files.length} files. ${violations.length} violation(s).`);
  for (const [rule, count] of byRule) console.log(`  ${count}  ${rule}`);
  process.exitCode = violations.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
