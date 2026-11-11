import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import Parser from 'rss-parser';
import type { Article } from '../src/types';

const TIMEOUT_MS = 20_000;
const EXCERPT_MAX = 280;
const EXCERPT_MIN = 60;
const MAX_PER_COMPANY = 12;
const UA = 'Mozilla/5.0 (compatible; EngShortsBot/1.0; +https://github.com/)';

type Feed = { company: string; url: string };
type Item = Parser.Item & { summary?: string; 'content:encoded'?: string; 'content:encodedSnippet'?: string };

const parser = new Parser<{}, Item>();

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

// Layer 1: tier the sources. Dedicated engineering feeds are trusted; general company
// blogs (product launches, marketing, company news in the same feed) are mixed and must
// earn their way in via the scorer below. Precision over recall: a dropped good post
// costs nothing, a leaked marketing post costs trust.
const MIXED = new Set(['OpenAI', 'Stripe', 'Cloudflare', 'Discord', 'Figma', 'Google', 'Hugging Face', 'Nvidia', 'Twilio', 'Docker', 'HashiCorp', 'Tailscale', 'PlanetScale', 'Supabase', 'Sentry', 'Duolingo', 'AWS News', 'Auth0', 'Cloudera', 'Confluent', 'Databricks', 'Elastic', 'Grafana Labs', 'Heroku', 'HubSpot', 'Okta', 'Postman', 'Red Hat', 'Salesforce', 'Stack Overflow', 'Timescale', 'Zapier', 'Zoom', 'eBay']);

// Layer 2: deterministic scorer. Hard-block obvious non-posts for every feed, then score
// title/categories/url/code/depth. Mixed feeds need a clear technical score; trusted
// feeds only fall if they are marketing-heavy with no technical signal at all.
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
  // Category/url bonus only counts for mixed feeds: on a trusted feed every post shares the same category, so it proves nothing.
  if (MIXED.has(feed.company) && /engineering|research|architecture|infrastructure|reliability|security/i.test(`${cats} ${item.link ?? ''}`)) score += 3;
  if (MIXED.has(feed.company) && /\b(product|announcements?|company|news|events?|customers?|press|partners?)\b/i.test(cats)) score -= 4;
  if (TECH.test(title)) score += 2;
  if (/<(pre|code)[\s>]/i.test(raw)) score += 3;
  if (MARKETING.test(title)) score -= 4;
  if (GENERIC.test(title) && !/^how we\b/i.test(title)) score -= 3;
  if (words >= 800) score += 1;
  else if (words > 0 && words < 250) score -= 1;
  // Mixed feeds additionally need a technical title: categories/code alone let product guides through.
  if (MIXED.has(feed.company)) return TECH.test(title) && score >= 3;
  return score >= -1;
}

// Self-check: marketing from a mixed feed drops, a production deep-dive passes, fluff from a trusted feed drops.
console.assert(!keep({ company: 'Stripe', url: '' }, { title: 'Announcing new pricing plans for our customers', categories: ['Product'] } as Item, '', 100));
console.assert(keep({ company: 'Stripe', url: '' }, { title: 'How we migrated Postgres with zero downtime', categories: ['Engineering'] } as Item, '<pre>code</pre>', 1500));
console.assert(!keep({ company: 'Netflix', url: '' }, { title: 'Announcing our annual customer summit event', categories: [] } as Item, '', 100));

const FAME_MIN = 20;
const HN_SEARCH = 'https://hn.algolia.com/api/v1/search';

function urlKey(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '')).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function sitesOf(articles: Article[]): string[] {
  const companiesByHost = new Map<string, Set<string>>();
  const rows: { host: string; segment: string }[] = [];
  for (const a of articles) {
    let host = '';
    let segment = '';
    try {
      const u = new URL(a.url);
      host = u.hostname.replace(/^www\./, '');
      segment = (u.pathname.split('/').filter(Boolean)[0] ?? '').toLowerCase();
    } catch {
      continue;
    }
    const companies = companiesByHost.get(host) ?? new Set<string>();
    companies.add(a.company);
    companiesByHost.set(host, companies);
    rows.push({ host, segment });
  }
  const sites = new Set<string>();
  for (const { host, segment } of rows) {
    const shared = (companiesByHost.get(host)?.size ?? 0) > 1;
    sites.add(shared && segment ? `${host} ${segment}` : host);
  }
  return [...sites].sort();
}

async function hnHits(site: string, sinceUnix: number): Promise<Map<string, number>> {
  const q = new URLSearchParams({
    tags: 'story',
    restrictSearchableAttributes: 'url',
    query: site,
    numericFilters: `created_at_i>${sinceUnix}`,
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

function rankCatalog(articles: Article[], points: Map<string, number>): Article[] {
  const ranked = articles.map((a) => {
    const n = points.get(urlKey(a.url));
    return {
      id: a.id,
      company: a.company,
      title: a.title,
      url: a.url,
      date: a.date,
      excerpt: a.excerpt,
      ...(a.readMins !== undefined && { readMins: a.readMins }),
      ...(n !== undefined && n >= FAME_MIN && { hnPoints: n }),
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
  const kept: Article[] = [];
  const perCompany = new Map<string, number>();
  for (const a of ranked) {
    const n = perCompany.get(a.company) ?? 0;
    if (n >= MAX_PER_COMPANY) continue;
    perCompany.set(a.company, n + 1);
    kept.push(a);
  }
  return kept;
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
    const time = Date.parse(item.isoDate ?? item.pubDate ?? '');
    if (!item.link || !item.title || !time) continue;
    const raw = item['content:encoded'] ?? item.content ?? '';
    const full = toText(raw);
    const words = full ? full.split(' ').length : 0;
    if (!keep(feed, item, raw, words)) { dropped++; continue; }
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
  if (dropped) console.log(`drop  ${feed.company.padEnd(16)} ${dropped} non-technical`);
  return out;
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

  const old = draft('old', 'Wide', 'https://wide.example/old', '2020-01-01T00:00:00.000Z');
  const newer = Array.from({ length: 12 }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    return draft(`n${day}`, 'Wide', `https://wide.example/n${day}`, `2026-03-${day}T00:00:00.000Z`);
  });
  const capped = rankCatalog([old, ...newer], new Map([[urlKey(old.url), 500]]));
  if (capped.length !== 12 || !capped.some((a) => a.id === 'old')) throw new Error('cap keeps the 500-point post');

  const again = rankCatalog(batch, points);
  if (ranked.map((a) => a.id).join() !== again.map((a) => a.id).join()) throw new Error('same ids on a second call');

  const sameDay = '2026-04-01T00:00:00.000Z';
  const tieM = draft('m', 'Tie', 'https://tie.example/m', sameDay);
  const tieD = draft('d', 'Tie', 'https://tie.example/d', sameDay);
  const tied = rankCatalog([tieM, tieD], new Map([[urlKey(tieM.url), 40], [urlKey(tieD.url), 40]]));
  if (tied[0]?.id !== 'd' || tied[1]?.id !== 'm') throw new Error('equal points and dates order by id');

  process.exit(0);
}

const feeds: Feed[] = JSON.parse(await readFile('feeds.json', 'utf8'));
const results = await Promise.allSettled(feeds.map(collect));

const seen = new Set<string>();
let articles: Article[] = [];
results.forEach((r, i) => {
  if (r.status === 'rejected') {
    console.warn(`skip  ${feeds[i].company.padEnd(16)} ${r.reason?.message ?? r.reason}`);
    return;
  }
  console.log(`ok    ${feeds[i].company.padEnd(16)} ${r.value.length}`);
  for (const a of r.value) {
    const key = urlKey(a.url);
    if (seen.has(key)) continue;
    seen.add(key);
    articles.push(a);
  }
});

const points = await fame(articles);
articles = rankCatalog(articles, points);

const missing = articles.filter((a) => !a.excerpt);
for (let i = 0; i < missing.length; i += 8) {
  await Promise.all(missing.slice(i, i + 8).map(async (a) => (a.excerpt = excerptOf(await metaDescription(a.url)))));
}

// Site-wide meta descriptions repeat across posts and say nothing about the article.
const counts = new Map<string, number>();
for (const a of articles) counts.set(a.excerpt, (counts.get(a.excerpt) ?? 0) + 1);
for (const a of articles) if ((counts.get(a.excerpt) ?? 0) > 2) a.excerpt = '';

await mkdir('public', { recursive: true });
await writeFile('public/articles.json', JSON.stringify(articles));
console.log(`\nwrote ${articles.length} articles to public/articles.json`);
