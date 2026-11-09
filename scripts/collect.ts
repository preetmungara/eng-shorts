import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import Parser from 'rss-parser';
import type { Article } from '../src/types';

const WINDOW_DAYS = 60;
const TIMEOUT_MS = 20_000;
const EXCERPT_MAX = 280;
const EXCERPT_MIN = 60;
const MAX_PER_COMPANY = 12;
const UA = 'Mozilla/5.0 (compatible; EngShortsBot/1.0; +https://github.com/)';

type Feed = { company: string; url: string };
type Item = Parser.Item & { summary?: string; 'content:encoded'?: string; 'content:encodedSnippet'?: string };

const parser = new Parser<{}, Item>();
const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function toText(html = ''): string {
  return decode(html.replace(/<(script|style|figure|figcaption)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// Skip leading bylines, author lists, and section headings: start at the first paragraph that reads like prose.
function proseFrom(html: string): string {
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => toText(m[1]));
  const start = paras.findIndex((p) => p.length >= 80 && /[.?!]["')”’]?$/.test(p));
  return start === -1 ? toText(html) : paras.slice(start).join(' ');
}

function excerptOf(text: string): string {
  // Feeds often append boilerplate like "The post X appeared first on Y."
  text = text.replace(/\s*The post .* appeared first on .*$/i, '').replace(/\s*Continue reading.*$/i, '').trim();
  if (text.length < EXCERPT_MIN) return '';
  if (text.length <= EXCERPT_MAX) return text;
  const slice = text.slice(0, EXCERPT_MAX);
  const end = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
  if (end > 120) return slice.slice(0, end + 1);
  return slice.slice(0, slice.lastIndexOf(' ')).replace(/[,;:\s]+$/, '') + '…';
}

async function metaDescription(url: string): Promise<string> {
  try {
    const html = await get(url);
    const m =
      html.match(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]*content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:name|property)=["'](?:og:)?description["']/i);
    return m ? decode(m[1]).trim() : '';
  } catch {
    return '';
  }
}

function keep(feed: Feed, item: Item): boolean {
  if (feed.company !== 'OpenAI') return true;
  const tags = [...(item.categories ?? []), item.link ?? ''].join(' ');
  return /engineering|research|security|safety/i.test(tags);
}

// Anthropic's engineering page has no feed; post titles and dates are embedded as JSON in the Next.js payload.
async function collectAnthropic(feed: Feed): Promise<Article[]> {
  const html = (await get(feed.url)).replace(/\\"/g, '"');
  const paths = new Set([...html.matchAll(/href="(\/(?:research|engineering)\/(?!team\/)[a-z0-9-]+)"/gi)].map((m) => m[1]));
  const out: Article[] = [];
  for (const path of paths) {
    const at = html.indexOf(`"current":"${path.split('/').pop()}"},"title":"`);
    if (at < 0) continue;
    const date = [...html.slice(Math.max(0, at - 600), at).matchAll(/"publishedOn":"(\d{4}-\d{2}-\d{2})"/g)].pop()?.[1];
    const after = html.slice(at, at + 1500);
    const title = after.match(/"title":"((?:[^"\\]|\\.)*)"/)?.[1];
    const summary = after.match(/"summary":"((?:[^"\\]|\\.)*)"/)?.[1] ?? '';
    const time = Date.parse(date ?? '');
    if (!title || !time || time < cutoff) continue;
    const url = new URL(path, feed.url).href;
    out.push({ id: createHash('sha1').update(url).digest('hex').slice(0, 10), company: feed.company, title: decode(title).trim(), url, date: new Date(time).toISOString(), excerpt: excerptOf(decode(summary.replace(/\\n/g, ' '))) });
  }
  return out.slice(0, MAX_PER_COMPANY);
}

async function collect(feed: Feed): Promise<Article[]> {
  if (feed.company === 'Anthropic') return collectAnthropic(feed);
  const parsed = await parser.parseString(await get(feed.url));
  const out: Article[] = [];
  for (const item of parsed.items) {
    const time = Date.parse(item.isoDate ?? item.pubDate ?? '');
    if (!item.link || !item.title || !time || time < cutoff || !keep(feed, item)) continue;
    const full = toText(item['content:encoded'] ?? item.content ?? '');
    const words = full ? full.split(' ').length : 0;
    const summary = proseFrom(item.content ?? item.summary ?? item['content:encoded'] ?? '') || toText(item.contentSnippet ?? '') || full;
    out.push({
      id: createHash('sha1').update(item.link).digest('hex').slice(0, 10),
      company: feed.company,
      title: toText(item.title),
      url: item.link,
      date: new Date(time).toISOString(),
      excerpt: excerptOf(summary),
      ...(words > 300 && { readMins: Math.max(1, Math.round(words / 230)) }),
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_PER_COMPANY);
}

const feeds: Feed[] = JSON.parse(await readFile('feeds.json', 'utf8'));
const results = await Promise.allSettled(feeds.map(collect));

const seen = new Set<string>();
const articles: Article[] = [];
results.forEach((r, i) => {
  if (r.status === 'rejected') {
    console.warn(`skip  ${feeds[i].company.padEnd(16)} ${r.reason?.message ?? r.reason}`);
    return;
  }
  console.log(`ok    ${feeds[i].company.padEnd(16)} ${r.value.length} recent`);
  for (const a of r.value) {
    const key = a.url.replace(/[?#].*$/, '').replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    articles.push(a);
  }
});

const missing = articles.filter((a) => !a.excerpt);
for (let i = 0; i < missing.length; i += 8) {
  await Promise.all(missing.slice(i, i + 8).map(async (a) => (a.excerpt = excerptOf(await metaDescription(a.url)))));
}

// Site-wide meta descriptions repeat across posts and say nothing about the article.
const counts = new Map<string, number>();
for (const a of articles) counts.set(a.excerpt, (counts.get(a.excerpt) ?? 0) + 1);
for (const a of articles) if ((counts.get(a.excerpt) ?? 0) > 2) a.excerpt = '';

articles.sort((a, b) => b.date.localeCompare(a.date));
await mkdir('public', { recursive: true });
await writeFile('public/articles.json', JSON.stringify(articles));
console.log(`\nwrote ${articles.length} articles from the last ${WINDOW_DAYS} days to public/articles.json`);
