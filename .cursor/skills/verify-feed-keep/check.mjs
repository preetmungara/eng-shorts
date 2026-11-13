import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SYNC = '2004e2b02d05f9f3378ef75b00258cc3b6b06735';
const SOURCE = '7a46cbfcc6434ee1';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const collectPath = path.join(repo, 'scripts', 'collect.ts');

const src = readFileSync(collectPath, 'utf8');
const start = src.indexOf('const MIXED = new Set([');
const end = src.indexOf('// Self-check:');
const signature = 'function keep(feed: Feed, item: Item, raw: string, words: number): boolean';
if (start < 0 || end < start || !src.slice(start, end).includes(signature)) {
  console.error('scripts/collect.ts no longer has MIXED and keep() before the self-check. This verifier does not describe the file. Exit 2 is a stale verifier, not a feed finding.');
  process.exit(2);
}
const chunk = src.slice(start, end).replace(signature, 'function keep(feed, item, raw, words)');
const sourceHash = createHash('sha256').update(chunk).digest('hex').slice(0, 16);
let loaded;
try {
  loaded = new Function(`${chunk}\nreturn { keep, MIXED, HARD_BLOCK, MARKETING, TECH, GENERIC };`)();
} catch (err) {
  console.error(`Could not load keep() from scripts/collect.ts (${err.message}). Exit 2 is a stale verifier, not a feed finding.`);
  process.exit(2);
}
const { keep, MIXED, HARD_BLOCK, MARKETING, TECH, GENERIC } = loaded;

let dirty = false;
try {
  dirty = execSync('git diff HEAD -- scripts/collect.ts', { cwd: repo, encoding: 'utf8' }).trim().length > 0;
} catch {}
if (sourceHash !== SOURCE) console.error(`keep() source ${sourceHash} is not the source ${SOURCE} confirmed at ${SYNC}. Re-read keep() before treating a pass as current.`);
if (dirty) console.error('scripts/collect.ts differs from HEAD. The check runs against the working tree.');

const findings = [];
function fail(lines) {
  findings.push(lines);
}

const howWe = (title) => /^how we\b/i.test(title);
function flagsOf(company, title, categories, link, raw, words) {
  const blob = `${title} ${categories.join(' ')}`;
  return {
    mixed: MIXED.has(company),
    hard: HARD_BLOCK.test(blob),
    generic: GENERIC.test(title),
    howWe: howWe(title),
    eng: /engineering|research|architecture|infrastructure|reliability|security/i.test(`${categories.join(' ')} ${link}`),
    product: /\b(product|announcements?|company|news|events?|customers?|press|partners?)\b/i.test(categories.join(' ')),
    tech: TECH.test(title),
    marketing: MARKETING.test(title),
    code: /<(pre|code)[\s>]/i.test(raw),
    words,
  };
}

function expectKeep(flags) {
  if (flags.hard) return false;
  if (flags.mixed && flags.generic && !flags.howWe) return false;
  let score = 0;
  if (flags.mixed && flags.eng) score += 3;
  if (flags.mixed && flags.product) score -= 4;
  if (flags.tech) score += 2;
  if (flags.code) score += 3;
  if (flags.marketing) score -= 4;
  if (flags.generic && !flags.howWe) score -= 3;
  if (flags.words >= 800) score += 1;
  else if (flags.words > 0 && flags.words < 250) score -= 1;
  if (flags.mixed) return flags.tech && score >= 3;
  return score >= -1;
}

function reason(flags) {
  if (flags.hard) return 'hard block';
  if (flags.mixed && flags.generic && !flags.howWe) return 'mixed feed, generic title';
  if (flags.mixed && !flags.tech) return 'mixed feed without a technical title';
  if (flags.mixed) return 'mixed feed technical score';
  return 'trusted feed score';
}

function check(label, company, title, categories, link, raw, words) {
  const flags = flagsOf(company, title, categories, link, raw, words);
  const item = { title, categories, link };
  const got = keep({ company, url: '' }, item, raw, words);
  const want = expectKeep(flags);
  if (got !== want) {
    fail([
      `FAIL ${label}`,
      `  company: ${company}`,
      `  title: ${title}`,
      `  categories: ${categories.join(', ') || '(none)'}`,
      `  link: ${link}`,
      `  code block: ${flags.code ? 'yes' : 'no'}`,
      `  words: ${words}`,
      `  keep() returned ${got}`,
      `  rule says ${want} (${reason(flags)})`,
    ].join('\n'));
  }
}

if (!MIXED.has('Stripe')) fail('FAIL Stripe is not in MIXED, so Stripe posts would skip the strict mixed-feed rule.');
if (MIXED.has('Netflix')) fail('FAIL Netflix is in MIXED, so Netflix posts would be held to the strict mixed-feed rule.');
const sentinels = [
  ['HARD_BLOCK matches webinar', () => HARD_BLOCK.test('webinar')],
  ['TECH matches the documented deep-dive title', () => TECH.test('How we migrated Postgres with zero downtime')],
  ['MARKETING matches Announcing', () => MARKETING.test('Announcing new pricing plans for our customers')],
  ['GENERIC matches a title that starts with How to', () => GENERIC.test('How to scale a database')],
];
for (const [label, pred] of sentinels) if (!pred()) fail(`FAIL ${label}`);

const shapes = [
  ['neutral', 'Cluster notes on filing.', { generic: false, howWe: false, tech: false, marketing: false }],
  ['tech', 'Cluster notes on latency.', { generic: false, howWe: false, tech: true, marketing: false }],
  ['marketing', 'Announcing cluster filing notes.', { generic: false, howWe: false, tech: false, marketing: true }],
  ['marketingTech', 'Announcing a latency cut.', { generic: false, howWe: false, tech: true, marketing: true }],
  ['generic', 'How to file cluster notes.', { generic: true, howWe: false, tech: false, marketing: false }],
  ['genericTech', 'How to cut latency.', { generic: true, howWe: false, tech: true, marketing: false }],
  ['genericMarketing', 'How to launch cluster filing.', { generic: true, howWe: false, tech: false, marketing: true }],
  ['genericMarketingTech', 'How to launch with lower latency.', { generic: true, howWe: false, tech: true, marketing: true }],
  ['howWe', 'How we gathered the notes.', { generic: false, howWe: true, tech: true, marketing: false }],
  ['howWeMarketing', 'How we are announcing the picnic.', { generic: false, howWe: true, tech: true, marketing: true }],
];
for (const [name, title, want] of shapes) {
  const got = {
    generic: GENERIC.test(title),
    howWe: howWe(title),
    tech: TECH.test(title),
    marketing: MARKETING.test(title),
  };
  const mismatch = Object.keys(want).filter((k) => got[k] !== want[k]);
  if (mismatch.length) {
    console.error(`fixture ${name} (${title}) classified wrong: ${mismatch.map((k) => `${k}=${got[k]}`).join(', ')}. Exit 2 is a verifier bug, not a feed finding.`);
    process.exit(2);
  }
}

const companies = [['Stripe', true], ['Netflix', false]];
const cats = [
  ['none', []],
  ['engineering', ['Engineering']],
  ['product', ['Product']],
  ['both', ['Engineering', 'Product']],
];
const words = [0, 249, 250, 799, 800];
const raws = [['plain', '<p>hello</p>'], ['code', '<pre>x</pre>']];
const link = 'https://example.com/post';
let checked = 0;
for (const [shape, title] of shapes) {
  for (const hard of [false, true]) {
    for (const [company] of companies) {
      for (const [catName, categories] of cats) {
        for (const [rawName, raw] of raws) {
          for (const n of words) {
            const shown = hard ? `${title} webinar` : title;
            check(`${shape}/${hard ? 'blocked' : 'open'}/${company}/${catName}/${rawName}/${n}`, company, shown, categories, link, raw, n);
            checked++;
          }
        }
      }
    }
  }
}

check('named/link-bonus', 'Stripe', 'Cluster notes on latency.', [], 'https://example.com/engineering/post', '<p>hello</p>', 400);
check('named/category-block', 'Netflix', 'Cluster notes on filing.', ['Webinar'], link, '<p>hello</p>', 400);
check('named/assert-pricing', 'Stripe', 'Announcing new pricing plans for our customers', ['Product'], link, '', 100);
check('named/assert-postgres', 'Stripe', 'How we migrated Postgres with zero downtime', ['Engineering'], link, '<pre>code</pre>', 1500);
check('named/assert-summit', 'Netflix', 'Announcing our annual customer summit event', [], link, '', 100);
checked += 5;

if (findings.length) {
  console.error(findings.join('\n\n'));
  console.error(`\nkeep: ${findings.length} finding(s) in ${checked} inputs, source ${sourceHash}`);
  process.exit(1);
}
console.log(`keep: pass ${checked} inputs, source ${sourceHash}`);
