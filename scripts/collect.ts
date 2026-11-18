import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import Parser from 'rss-parser';
import type { Article } from '../src/types';
import { TOPIC_NAMES } from '../src/rank';

const TIMEOUT_MS = 20_000;
const EXCERPT_MAX = 280;
const EXCERPT_MIN = 60;
const MIN_TIME = Date.parse('2005-01-01');
const FEED_SIZE = 50;
const UA = 'Mozilla/5.0 (compatible; EngShortsBot/1.0; +https://github.com/)';

type Feed = { company: string; url: string };
type Item = Parser.Item & { summary?: string; 'content:encoded'?: string; 'content:encodedSnippet'?: string };

const parser = new Parser<{}, Item>();
const fullByUrl = new Map<string, string>();
const PROMPT_V = 1;
const MODEL = 'gemini-3.1-flash-lite';
const SHORT_CHARS = 16_000;
const SHORT_CONCURRENCY = 8;

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

function proseFrom(html: string): string {
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => toText(m[1]));
  const start = paras.findIndex((p) => p.length >= 80 && /[.?!]["')”’]?$/.test(p));
  return start === -1 ? toText(html) : paras.slice(start).join(' ');
}

function excerptOf(text: string): string {
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

// Some feeds (Google Developers) ship items without dates; the post page usually has one.
async function pageDate(url: string): Promise<number> {
  try {
    const html = await get(url);
    const m = html.match(/"datePublished"\s*:\s*"([^"]+)"/) ?? html.match(/<meta[^>]+property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i);
    return m ? Date.parse(m[1]) : NaN;
  } catch {
    return NaN;
  }
}

const MIXED = new Set(['OpenAI', 'Stripe', 'Cloudflare', 'Discord', 'Figma', 'Hugging Face', 'Nvidia', 'Twilio', 'Docker', 'HashiCorp', 'PlanetScale', 'Supabase', 'Sentry', 'Duolingo', 'AWS News', 'Auth0', 'Cloudera', 'Confluent', 'Databricks', 'Elastic', 'Grafana Labs', 'Heroku', 'HubSpot', 'Okta', 'Postman', 'Red Hat', 'Salesforce', 'Stack Overflow', 'Timescale', 'Zoom', 'eBay']);

const HARD_BLOCK = /\b(webinar|white ?paper|e-?book|customer stor\w*|case stud\w*|press release|we'?re hiring|now hiring|join us at|acqui(?:res?|sition)|funding round|named (?:a |the )?leader|magic quadrant|book a demo|register now|remarks|keynote|fireside chat)\b/i;
const MARKETING = /\b(announc\w*|introduc\w*|launch\w*|now available|generally available|new features?|product updates?|pricing|partners?\w*|integrat\w+ with|market\w*|industry|trends?|survey|customers?|business|growth|event|conference|summit|meetup|podcast|celebrat\w*|award\w*|roadmap)\b/i;
const TECH = /\b(how we|we (?:built|migrated|scaled|reduced|cut|designed|rewrote|shipped)|scaling|scaled|latency|throughput|p99|architecture|distributed|infrastructure|database|postgres|mysql|kafka|kubernetes|performance|optimi[sz]\w*|benchmark\w*|postmortem|outage|reliability|observability|debugging|memory|compiler|runtime|kernel|network\w*|sharding|replication|caching|migration|migrat\w*|internals|inference|training|open source|security|encryption|zero downtime|tracing|profiling|storage|failover|switchover|post-quantum|cryptography|dns|tls|quic|spark|redis|grpc|oauth|load shedding|cascading|embedding|retrieval|tokenization)\b/i;
const GENERIC = /^(how to|getting started|introduction to|a (?:beginner'?s )?guide to|top \d+|best \w+|what is|\d+ (?:things|ways|tips|reasons|steps)\b|five (?:things|ways|tips|reasons|steps)\b)|\b(tutorial|quick guide|beginner'?s guide|faq)\b/i;

function keep(feed: Feed, item: Item, raw: string, words: number): boolean {
  const title = item.title ?? '';
  const cats = (item.categories ?? []).join(' ');
  if (HARD_BLOCK.test(`${title} ${cats}`)) return false;
  if (MIXED.has(feed.company) && GENERIC.test(title) && !/^how we\b/i.test(title)) return false;
  let score = 0;
  if (MIXED.has(feed.company) && /engineering|research|architecture|infrastructure|reliability|security/i.test(`${cats} ${item.link ?? ''}`)) score += 3;
  if (MIXED.has(feed.company) && /\b(product|announcements?|company|news|events?|customers?|press|partners?)\b/i.test(cats)) score -= 4;
  if (TECH.test(title)) score += 2;
  if (/<(pre|code)[\s>]/i.test(raw)) score += 3;
  if (MARKETING.test(title)) score -= 4;
  if (GENERIC.test(title) && !/^how we\b/i.test(title)) score -= 3;
  if (words >= 800) score += 1;
  else if (words > 0 && words < 250) score -= 1;
  if (MIXED.has(feed.company)) return TECH.test(title) && score >= 3;
  return score >= -1;
}

console.assert(!keep({ company: 'Stripe', url: '' }, { title: 'Announcing new pricing plans for our customers', categories: ['Product'] } as Item, '', 100));
console.assert(keep({ company: 'Stripe', url: '' }, { title: 'How we migrated Postgres with zero downtime', categories: ['Engineering'] } as Item, '<pre>code</pre>', 1500));
console.assert(!keep({ company: 'Netflix', url: '' }, { title: 'Announcing our annual customer summit event', categories: [] } as Item, '', 100));

const FAME_MIN = 20;
const HN_SEARCH = 'https://hn.algolia.com/api/v1/search';

function urlKey(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^(?:www|old)\./, '') + u.pathname.replace(/\/+$/, '')).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function sitesOf(articles: Article[]): string[] {
  const companiesByHost = new Map<string, Set<string>>();
  const segmentsByHost = new Map<string, Set<string>>();
  const rows: { host: string; segment: string }[] = [];
  for (const a of articles) {
    let host = '';
    let segment = '';
    try {
      const u = new URL(a.url);
      host = u.hostname.replace(/^www\./, '');
      const parts = u.pathname.split('/').filter(Boolean);
      // Reddit paths are /r/<subreddit>/…; the subreddit is what names the blog.
      segment = ((parts[0] === 'r' ? parts[1] : parts[0]) ?? '').toLowerCase();
    } catch {
      continue;
    }
    const companies = companiesByHost.get(host) ?? new Set<string>();
    companies.add(a.company);
    companiesByHost.set(host, companies);
    const segments = segmentsByHost.get(host) ?? new Set<string>();
    segments.add(segment);
    segmentsByHost.set(host, segments);
    rows.push({ host, segment });
  }
  const sites = new Set<string>();
  for (const { host, segment } of rows) {
    const shared = (companiesByHost.get(host)?.size ?? 0) > 1;
    const uniform = segmentsByHost.get(host)?.size === 1;
    sites.add((shared || uniform) && segment ? `${host} ${segment}` : host);
  }
  return [...sites].sort();
}

async function hnHits(site: string, sinceUnix: number): Promise<Map<string, number>> {
  const q = new URLSearchParams({
    tags: 'story',
    restrictSearchableAttributes: 'url',
    query: site,
    numericFilters: `created_at_i>${sinceUnix},points>=${FAME_MIN}`,
    hitsPerPage: '1000',
  });
  const body = JSON.parse(await get(`${HN_SEARCH}?${q}`)) as { nbHits?: number; hits?: { url?: string; points?: number }[] };
  const hits = Array.isArray(body.hits) ? body.hits : [];
  const nbHits = typeof body.nbHits === 'number' ? body.nbHits : hits.length;
  if (nbHits > hits.length) console.log(`partial ${site} ${hits.length} of ${nbHits}`);
  const points = new Map<string, number>();
  for (const hit of hits) {
    if (!hit.url) continue;
    const n = typeof hit.points === 'number' ? hit.points : 0;
    const key = urlKey(hit.url);
    points.set(key, Math.max(points.get(key) ?? 0, n));
  }
  return points;
}

async function fame(articles: Article[]): Promise<Map<string, number>> {
  const since = Math.floor(Math.min(...articles.map((a) => Date.parse(a.date)), Date.now()) / 1000);
  const settled = await Promise.allSettled(sitesOf(articles).map(async (site) => {
    try {
      return await hnHits(site, since);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`${site} ${message}`);
    }
  }));
  const points = new Map<string, number>();
  for (const r of settled) {
    if (r.status === 'rejected') {
      const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.warn(`skip  fame ${message}`);
      continue;
    }
    for (const [key, n] of r.value) points.set(key, Math.max(points.get(key) ?? 0, n));
  }
  for (const [key, n] of points) if (n < FAME_MIN) points.delete(key);
  return points;
}

// Feeds only carry their latest items, so the catalog keeps every post it has ever seen.
function merge(prev: Article[], fresh: Article[], now: number): Article[] {
  const byKey = new Map(prev.map((a) => [urlKey(a.url), a]));
  for (const a of fresh) {
    const old = byKey.get(urlKey(a.url));
    byKey.set(urlKey(a.url), { ...old, ...a, excerpt: a.excerpt || old?.excerpt || '', short: a.short ?? old?.short });
  }
  return [...byKey.values()].filter((a) => {
    const t = Date.parse(a.date);
    return t >= MIN_TIME && t <= now + 86_400_000;
  });
}

async function previous(): Promise<Article[]> {
  let raw: string;
  try {
    raw = await readFile('public/articles.json', 'utf8');
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return [];
    console.error(`previous catalog: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error('not an array');
    return list;
  } catch (err) {
    console.error(`previous catalog: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

function dropMessage(prevCount: number, nextCount: number): string | null {
  if (prevCount > 0 && nextCount < prevCount * 0.9) return `refuse publish: ${nextCount} posts is more than 10% below ${prevCount}`;
  return null;
}

function rankCatalog(articles: Article[], points: Map<string, number>): Article[] {
  const ranked = articles.map((a) => {
    const n = Math.max(points.get(urlKey(a.url)) ?? 0, a.hnPoints ?? 0) || undefined;
    return {
      id: a.id,
      company: a.company,
      title: a.title,
      url: a.url,
      date: a.date,
      excerpt: a.excerpt,
      ...(a.readMins !== undefined && { readMins: a.readMins }),
      ...(n !== undefined && n >= FAME_MIN && { hnPoints: n }),
      ...(a.short && { short: a.short }),
    };
  });
  ranked.sort((a, b) => {
    const pa = a.hnPoints ?? 0;
    const pb = b.hnPoints ?? 0;
    if (pa !== pb) return pa > pb ? -1 : 1;
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  });
  return ranked;
}

function xml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function atom(articles: Article[]): string {
  const newest = [...articles].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, FEED_SIZE);
  const entries = newest.map((a) => `<entry><title>${xml(a.title)}</title><link href="${xml(a.url)}"/><id>${xml(a.url)}</id><updated>${a.date}</updated><author><name>${xml(a.company)}</name></author>${a.excerpt ? `<summary>${xml(a.excerpt)}</summary>` : ''}</entry>`);
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Eng Shorts</title>
<subtitle>Engineering blog posts from top companies, without the marketing.</subtitle>
<id>urn:eng-shorts</id>
<link rel="self" href="feed.xml"/>
<updated>${newest[0]?.date ?? new Date(0).toISOString()}</updated>
${entries.join('\n')}
</feed>
`;
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
    if (!title || !time || HARD_BLOCK.test(title)) continue;
    const url = new URL(path, feed.url).href;
    out.push({ id: createHash('sha1').update(url).digest('hex').slice(0, 10), company: feed.company, title: decode(title).trim(), url, date: new Date(time).toISOString(), excerpt: excerptOf(decode(summary.replace(/\\n/g, ' '))) });
  }
  return out;
}

async function collect(feed: Feed): Promise<Article[]> {
  if (feed.company === 'Anthropic') return collectAnthropic(feed);
  const parsed = await parser.parseString(await get(feed.url));
  const out: Article[] = [];
  let dropped = 0;
  for (const item of parsed.items) {
    if (!item.link || !item.title) continue;
    const raw = item['content:encoded'] ?? item.content ?? '';
    const full = toText(raw);
    const words = full ? full.split(' ').length : 0;
    if (!keep(feed, item, raw, words)) { dropped++; continue; }
    const time = Date.parse(item.isoDate ?? item.pubDate ?? '') || await pageDate(item.link);
    if (!time) continue;
    const summary = proseFrom(item.content ?? item.summary ?? item['content:encoded'] ?? '') || toText(item.contentSnippet ?? '') || full;
    fullByUrl.set(urlKey(item.link), full);
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
  if (dropped) console.log(`drop  ${feed.company.padEnd(16)} ${dropped} non-technical`);
  return out;
}

function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

function needsShort(a: Article): boolean {
  if (a.company === 'The Daily Diff') return false;
  if (a.short?.thin && (a.short.tries ?? 0) >= 3) return false;
  return !a.short || a.short.v < PROMPT_V || !!a.short.thin;
}

function numbersIn(text: string): Set<string> {
  return new Set([...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, '')));
}

function parseShort(out: unknown, source: string): { tldr: string[]; idea: string; tags: string[] } | null {
  if (typeof out !== 'object' || out === null) return null;
  const o = out as { tldr?: unknown; idea?: unknown; tags?: unknown };
  if (!Array.isArray(o.tldr) || o.tldr.length !== 5 || o.tldr.some((b) => typeof b !== 'string')) return null;
  const tldr = o.tldr.map((b) => b.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim());
  if (tldr.some((b) => wordCount(b) > 25)) return null;
  if (typeof o.idea !== 'string') return null;
  if (!Array.isArray(o.tags) || o.tags.some((t) => typeof t !== 'string' || !TOPIC_NAMES.includes(t))) return null;
  const have = numbersIn(source);
  for (const n of numbersIn(`${tldr.join(' ')} ${o.idea} ${o.tags.join(' ')}`)) if (!have.has(n)) return null;
  return { tldr, idea: o.idea.trim(), tags: o.tags };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const shortStarts: number[] = [];
let shortGate: Promise<void> = Promise.resolve();

function takeShortSlot(): Promise<void> {
  const run = shortGate.then(async () => {
    for (;;) {
      const now = Date.now();
      while (shortStarts.length && now - shortStarts[0] >= 60_000) shortStarts.shift();
      if (shortStarts.length < 10) {
        shortStarts.push(Date.now());
        return;
      }
      await sleep(60_000 - (now - shortStarts[0]) + 25);
    }
  });
  shortGate = run.then(() => {}, () => {});
  return run;
}

async function coolShorts(ms: number) {
  const run = shortGate.then(() => sleep(ms));
  shortGate = run.then(() => {}, () => {});
  await run;
}

function retryDelay(res: Response, attempt: number): number {
  const secs = Number(res.headers.get('retry-after'));
  if (Number.isFinite(secs) && secs >= 0) return Math.min(120_000, secs * 1000);
  return Math.min(60_000, 5_000 * 2 ** attempt);
}

async function gemini(prompt: string): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('no key');
  for (let attempt = 0; attempt < 4; attempt++) {
    await takeShortSlot();
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              tldr: { type: 'ARRAY', minItems: 5, maxItems: 5, items: { type: 'STRING' } },
              idea: { type: 'STRING' },
              tags: { type: 'ARRAY', items: { type: 'STRING', enum: TOPIC_NAMES } },
            },
            required: ['tldr', 'idea', 'tags'],
          },
          thinkingConfig: { thinkingLevel: 'MINIMAL', includeThoughts: false },
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.status === 429) {
      await coolShorts(retryDelay(res, attempt));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 180)}`);
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
    const text = (body.candidates?.[0]?.content?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
    if (!text) throw new Error('empty response');
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*|```$/g, ''));
  }
  throw new Error('HTTP 429');
}

function shortPrompt(a: Article, text: string): string {
  return `Summarize this engineering blog post for a working engineer. Return exactly 5 bullets, each ≤25 words, concrete and specific (what they built, why, the result). \`idea\` is the single key insight in one sentence. \`tags\` must come only from this list: ${TOPIC_NAMES.join(', ')}. Only use numbers and names that appear in the text. No marketing language.\n\n${a.title}\n\n${text}`;
}

async function shortSource(a: Article): Promise<{ text: string; thin: boolean }> {
  const fed = fullByUrl.get(urlKey(a.url)) ?? '';
  let text = wordCount(fed) > 300 ? fed : '';
  if (!text) {
    try {
      text = proseFrom(await get(a.url));
    } catch (err) {
      console.warn(`short fetch ${a.id} ${err instanceof Error ? err.message : err}`);
      text = '';
    }
  }
  if (wordCount(text) < 150) return { text: `${a.title}\n\n${a.excerpt}`, thin: true };
  return { text: text.slice(0, SHORT_CHARS), thin: false };
}

async function writeShort(a: Article) {
  try {
    const { text, thin } = await shortSource(a);
    const parsed = parseShort(await gemini(shortPrompt(a, text)), `${a.title}\n\n${text}`);
    if (!parsed) {
      console.warn(`short invalid ${a.id}`);
      return;
    }
    a.short = { tldr: parsed.tldr, idea: parsed.idea, tags: parsed.tags, model: MODEL, v: PROMPT_V, ...(thin && { thin: true, tries: (a.short?.tries ?? 0) + 1 }) };
    console.log(`short ok ${a.company} — ${a.title}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`short fail ${a.id} ${message.replace(/AIza[\w-]+|AQ\.[\w-]+/g, '***')}`);
  }
}

async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function addShorts(articles: Article[]) {
  if (!process.env.GEMINI_API_KEY) {
    console.log('no GEMINI_API_KEY, skip shorts');
    return;
  }
  const raw = Number(process.env.MAX_SHORTS ?? 400);
  const cap = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 400;
  const todo = articles.filter(needsShort).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1)).slice(0, cap);
  console.log(`shorts ${todo.length}`);
  try {
    await eachLimited(todo, SHORT_CONCURRENCY, writeShort);
  } catch (err) {
    console.warn(`shorts stopped ${err instanceof Error ? err.message : err}`);
  }
}

function sameShorts(prev: Article[], next: Article[]): boolean {
  if (prev.length !== next.length) return false;
  const byId = new Map(prev.map((a) => [a.id, JSON.stringify(a.short ?? null)]));
  if (byId.size !== prev.length) return false;
  return next.every((a) => byId.get(a.id) === JSON.stringify(a.short ?? null));
}

async function setChanged(changed: boolean) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) await appendFile(file, `changed=${changed}\n`);
}

if (process.argv.includes('--check')) {
  const draft = (id: string, company: string, url: string, date: string): Article => ({ id, company, title: id, url, date, excerpt: '' });
  const famous = draft('b', 'Acme', 'https://example.com/famous', '2026-01-01T00:00:00.000Z');
  const low = draft('c', 'Acme', 'https://example.com/low', '2026-06-01T00:00:00.000Z');
  const miss = draft('a', 'Acme', 'https://example.com/miss', '2026-03-01T00:00:00.000Z');
  const points = new Map<string, number>([
    [urlKey(famous.url), 1275],
    [urlKey(low.url), 10],
  ]);
  const batch = [low, miss, famous];
  const ranked = rankCatalog(batch, points);
  if (ranked[0]?.id !== 'b' || ranked[0].hnPoints !== 1275) throw new Error('1275 points leads');
  if (!ranked.some((a) => a.id === 'a' && a.hnPoints === undefined)) throw new Error('miss stays without hnPoints');
  const lowAt = ranked.findIndex((a) => a.id === 'c');
  if (lowAt <= 0 || ranked[lowAt]?.hnPoints !== undefined) throw new Error('10 points stays under the floor');

  const sites = sitesOf([
    draft('r1', 'Reddit', 'https://www.reddit.com/r/RedditEng/comments/1/a/', '2026-01-01T00:00:00.000Z'),
    draft('r2', 'Reddit', 'https://www.reddit.com/r/RedditEng/comments/2/b/', '2026-01-01T00:00:00.000Z'),
    draft('c1', 'Wide', 'https://wide.example/one', '2026-01-01T00:00:00.000Z'),
    draft('c2', 'Wide', 'https://wide.example/two', '2026-01-01T00:00:00.000Z'),
  ]);
  if (sites.join() !== 'reddit.com redditeng,wide.example') throw new Error('sites ' + sites.join());
  if (urlKey('https://old.reddit.com/r/RedditEng/comments/1/a/') !== urlKey('https://www.reddit.com/r/RedditEng/comments/1/a')) throw new Error('old.reddit matches www.reddit');

  const feedXml = atom([
    { ...draft('x1', 'A&B', 'https://e.example/a?x=1&y=2', '2026-01-01T00:00:00.000Z'), title: '<Fast> & "safe"' },
    draft('x2', 'Newer', 'https://e.example/b', '2026-02-01T00:00:00.000Z'),
  ]);
  if (!feedXml.includes('<title>&#60;Fast&#62; &#38; &#34;safe&#34;</title>') || !feedXml.includes('href="https://e.example/a?x=1&#38;y=2"') || !feedXml.includes('<name>A&#38;B</name>')) throw new Error('atom escapes text and urls');
  if (feedXml.indexOf('e.example/b') > feedXml.indexOf('e.example/a') || !feedXml.includes('<updated>2026-02-01T00:00:00.000Z</updated>\n<entry>')) throw new Error('atom is newest first');

  const now = Date.parse('2026-07-01T00:00:00.000Z');
  const gone = { ...draft('gone', 'Wide', 'https://wide.example/gone', '2026-01-01T00:00:00.000Z'), excerpt: 'kept', hnPoints: 300 };
  const placeholder = draft('ph', 'Wide', 'https://wide.example/ph', '2001-01-01T00:00:00.000Z');
  const future = draft('fut', 'Wide', 'https://wide.example/fut', '2027-01-01T00:00:00.000Z');
  const updated = { ...draft('gone', 'Wide', 'https://www.wide.example/gone/', '2026-01-01T00:00:00.000Z'), title: 'new title' };
  const many = Array.from({ length: 20 }, (_, i) => draft(`w${i}`, 'Wide', `https://wide.example/w${i}`, '2026-03-01T00:00:00.000Z'));
  const merged = rankCatalog(merge([gone, placeholder], [future, ...many], now), new Map());
  if (!merged.some((a) => a.id === 'gone' && a.hnPoints === 300)) throw new Error('a post that left the feed stays with its points');
  if (merged.some((a) => a.id === 'ph' || a.id === 'fut')) throw new Error('placeholder and future dates drop');
  if (merged.length !== 21) throw new Error('no per-company cap');
  const refreshed = merge([gone], [updated], now);
  if (refreshed.length !== 1 || refreshed[0].title !== 'new title' || refreshed[0].excerpt !== 'kept') throw new Error('fresh fields win, old excerpt fills a blank');
  const kept = { tldr: ['a', 'b', 'c', 'd', 'e'], idea: 'i', tags: ['ai'], model: 'm', v: 1 };
  const carried = merge([{ ...gone, short: kept }], [updated], now);
  if (carried[0]?.short?.idea !== 'i') throw new Error('merge dropped short');
  const rankedShort = rankCatalog([{ ...famous, short: kept }], points);
  if (rankedShort[0]?.short?.v !== 1) throw new Error('rank dropped short');

  const again = rankCatalog(batch, points);
  if (ranked.map((a) => a.id).join() !== again.map((a) => a.id).join()) throw new Error('same ids on a second call');

  const sameDay = '2026-04-01T00:00:00.000Z';
  const tieM = draft('m', 'Tie', 'https://tie.example/m', sameDay);
  const tieD = draft('d', 'Tie', 'https://tie.example/d', sameDay);
  const tied = rankCatalog([tieM, tieD], new Map([[urlKey(tieM.url), 40], [urlKey(tieD.url), 40]]));
  if (tied[0]?.id !== 'd' || tied[1]?.id !== 'm') throw new Error('equal points and dates order by id');

  if (dropMessage(1500, 750) !== 'refuse publish: 750 posts is more than 10% below 1500') throw new Error('50% drop was allowed');
  if (dropMessage(1000, 900) !== null) throw new Error('exactly 10% below was refused');
  if (dropMessage(1000, 899) === null) throw new Error('more than 10% below was allowed');

  const source = 'The fleet grew to 40 nodes and cut p99 from 120 ms to 30 ms.';
  const good = {
    tldr: ['Grew the fleet to 40 nodes.', 'Cut p99 from 120 ms to 30 ms.', 'Kept the change behind one flag.', 'Shipped it in one region first.', 'Measured the drop before the rollout.'],
    idea: 'A smaller fleet change cut p99 to 30 ms.',
    tags: ['infra', 'performance'],
  };
  if (!parseShort(good, source)) throw new Error('valid short rejected');
  if (parseShort({ ...good, tags: ['nope'] }, source)) throw new Error('bad tag accepted');
  if (parseShort({ ...good, tldr: ['only one'] }, source)) throw new Error('wrong bullet count accepted');
  if (parseShort({ ...good, idea: 'It handled 999 requests.' }, source)) throw new Error('invented number accepted');
  const tooLong = Array.from({ length: 26 }, () => 'word').join(' ');
  if (parseShort({ ...good, tldr: [tooLong, 'b', 'c', 'd', 'e'] }, source)) throw new Error('26-word bullet accepted');
  const edge = Array.from({ length: 25 }, () => 'word').join(' ');
  if (!parseShort({ ...good, tldr: [edge, 'b', 'c', 'd', 'e'] }, source)) throw new Error('25-word bullet rejected');

  const post = draft('n', 'Acme', 'https://e.example/n', '2026-01-01T00:00:00.000Z');
  if (!needsShort(post)) throw new Error('missing short skipped');
  if (needsShort({ ...post, company: 'The Daily Diff' })) throw new Error('daily diff included');
  if (needsShort({ ...post, short: { ...kept, thin: true, tries: 3 } })) throw new Error('thin cap ignored');
  if (!needsShort({ ...post, short: { ...kept, thin: true, tries: 2 } })) throw new Error('thin short not retried');
  if (needsShort({ ...post, short: kept })) throw new Error('current short regenerated');
  if (!sameShorts([post], [{ ...post }])) throw new Error('unchanged catalog looks changed');
  if (sameShorts([post], [{ ...post, short: kept }])) throw new Error('new short looks unchanged');

  process.exit(0);
}

const prev = await previous();
const feeds: Feed[] = JSON.parse(await readFile('feeds.json', 'utf8'));
const results = await Promise.allSettled(feeds.map(collect));

const seen = new Set<string>();
const fresh: Article[] = [];
results.forEach((r, i) => {
  if (r.status === 'rejected') {
    console.log(`::warning::skip  ${feeds[i].company} ${r.reason?.message ?? r.reason}`);
    return;
  }
  if (r.value.length === 0) console.log(`::warning::empty ${feeds[i].company} kept 0 posts`);
  else console.log(`ok    ${feeds[i].company.padEnd(16)} ${r.value.length}`);
  for (const a of r.value) {
    const key = urlKey(a.url);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(a);
  }
});

const points = await fame(fresh);
const articles = rankCatalog(merge(prev, fresh, Date.now()), points);

const missing = articles.filter((a) => !a.excerpt && seen.has(urlKey(a.url)));
for (let i = 0; i < missing.length; i += 8) {
  await Promise.all(missing.slice(i, i + 8).map(async (a) => (a.excerpt = excerptOf(await metaDescription(a.url)))));
}

const counts = new Map<string, number>();
for (const a of articles) counts.set(a.excerpt, (counts.get(a.excerpt) ?? 0) + 1);
for (const a of articles) if ((counts.get(a.excerpt) ?? 0) > 2) a.excerpt = '';

const drop = dropMessage(prev.length, articles.length);
if (drop) {
  console.error(drop);
  process.exit(1);
}

await addShorts(articles);

if (prev.length > 0 && sameShorts(prev, articles)) {
  await setChanged(false);
  console.log(`\nunchanged ${articles.length} articles, skip publish`);
} else {
  await mkdir('public', { recursive: true });
  await writeFile('public/articles.json', JSON.stringify(articles));
  await writeFile('public/feed.xml', atom(articles));
  await setChanged(true);
  console.log(`\nwrote ${articles.length} articles to public/articles.json (${prev.length} before, ${fresh.length} from feeds)`);
}
