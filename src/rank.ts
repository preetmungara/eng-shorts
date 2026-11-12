import type { Article } from './types';

const DAY_MS = 86_400_000;
const W_HN = 0.8;
const W_FRESH = 1.0;
const FRESH_HALF_DAYS = 10;
const W_TASTE = 1.2;
const W_COMPANY = 0.5;
const W_NOISE = 0.35;
const TASTE_HALF_DAYS = 21;
const CLAMP = 3;
const PRUNE = 0.05;
const WINDOW = 10;
const MAX_PER_COMPANY = 2;
const MAX_PER_TOPIC = 4;
const EXPLORE_EVERY = 5;
const UNEXPLORED = 0.25;
const WHY_MIN = 0.3;
const TRANSIT_MS = 400;
const SKIP_MS = 1500;
const DWELL_MS = 5000;
const SKIP = -0.3;
const DWELL = 0.4;
export const OPEN = 1;

const TOPICS: [string, RegExp][] = [
  ['ai', /\b(ai|llms?|agents?|agentic|(?:language|frontier|foundation) models?|inference|model training|embeddings?|gpt|machine learning|neural|transformers?|rag|bedrock|gemini|claude|copilot)\b/i],
  ['infra', /\b(infrastructure|kubernetes|k8s|ecs|containers?|cloud|servers?|clusters?|supercluster|data ?cent(?:er|re)s?|gpus?|fleet|deploy\w*|serverless|filesystem|storage)\b/i],
  ['performance', /\b(performance|latency|throughput|faster|speed\w*|optimi[sz]\w*|benchmark\w*|p99|memory use|efficien\w*|cost savings)\b/i],
  ['search', /\b(search|index\w*|ranking|recommend\w*|retrieval|vector)\b/i],
  ['dataeng', /\b(pipelines?|etl|spark|kafka|streaming|data (?:platform|engineering|lake|warehouse)|lakehouse|batch|flink|iceberg|knowledge graph)\b/i],
  ['security', /\b(security|secur\w+|vulnerab\w*|threat\w*|encrypt\w*|post-quantum|cryptograph\w*|\bauth0\b|\bauthenticat\w*|\bauthoriz\w*|\boauth\b|privacy|exploit\w*|supply chain)\b/i],
  ['databases', /\b(databases?|postgres\w*|mysql|sqlite|sql|redis|dynamodb|time-series|schema|replication|sharding|query|queries)\b/i],
  ['reliability', /\b(reliab\w*|outages?|incidents?|postmortem|post-mortem|failover|resilien\w*|downtime|on-?call|sre)\b/i],
  ['distributed', /\b(distributed|consensus|raft|paxos|message bus|queues?|multi-region|replicat\w*|eventual\w*)\b/i],
  ['observability', /\b(observability|tracing|traces|logs?|logging|metrics|monitoring|telemetry|opentelemetry|profil\w*)\b/i],
  ['mobile', /\b(mobile|ios|android|react native|swift|kotlin)\b/i],
  ['devprod', /\b(developer (?:experience|productivity)|ci|build systems?|monorepo|code review|git|tooling|dev ?tools?)\b/i],
  ['languages', /\b(rust|golang|python|java|typescript|javascript|compilers?|ocaml|c\+\+|wasm|webassembly)\b/i],
  ['networking', /\b(network\w*|dns|tcp|quic|http\/?[23]?|tls|cdn|bgp|load balanc\w*)\b/i],
  ['frontend', /\b(frontend|front-end|css|browsers?|react|ui|web performance|rendering)\b/i],
];

export type Taste = { v: 1; id: string; at: number; w: Record<string, number> };
export type Ranked = { article: Article; why: string | null };

export function topicsOf(a: Pick<Article, 'title' | 'excerpt' | 'company'>): string[] {
  const text = `${a.title} ${a.excerpt} ${a.company}`;
  return TOPICS.filter(([, re]) => re.test(text)).map(([topic]) => topic);
}

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function clamp(v: number): number {
  return v > CLAMP ? CLAMP : v < -CLAMP ? -CLAMP : v;
}

function decay(t: Taste, now: number): Taste {
  const k = 0.5 ** (Math.max(0, now - t.at) / (TASTE_HALF_DAYS * DAY_MS));
  const w: Record<string, number> = {};
  for (const [f, v] of Object.entries(t.w)) if (Math.abs(v * k) >= PRUNE) w[f] = v * k;
  return { ...t, at: now, w };
}

function plain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseTaste(raw: string | null, now: number, newId: () => string): Taste {
  let data: unknown;
  try {
    data = raw == null ? null : JSON.parse(raw);
  } catch {
    data = null;
  }
  if (!plain(data)) return { v: 1, id: newId(), at: now, w: {} };
  const id = typeof data.id === 'string' && data.id.length > 0 ? data.id : newId();
  const at = typeof data.at === 'number' && Number.isFinite(data.at) ? data.at : now;
  if (data.v !== 1 || !plain(data.w)) return decay({ v: 1, id, at, w: {} }, now);
  const w: Record<string, number> = {};
  for (const [k, val] of Object.entries(data.w)) {
    if (typeof val !== 'number' || !Number.isFinite(val)) continue;
    w[k] = clamp(val);
  }
  return decay({ v: 1, id, at, w }, now);
}

export function learn(t: Taste, a: Article, signal: number, now: number): Taste {
  const d = decay(t, now);
  const w = { ...d.w };
  const topics = topicsOf(a);
  const share = topics.length ? signal / topics.length : 0;
  for (const topic of topics) {
    const key = 't:' + topic;
    const next = clamp((w[key] ?? 0) + share);
    if (Math.abs(next) < PRUNE) delete w[key];
    else w[key] = next;
  }
  const company = 'c:' + a.company;
  const next = clamp((w[company] ?? 0) + signal);
  if (Math.abs(next) < PRUNE) delete w[company];
  else w[company] = next;
  return { ...d, w };
}

export function signalOf(ms: number, forward: boolean): number | null {
  if (ms < TRANSIT_MS) return null;
  if (ms < SKIP_MS) return forward ? SKIP : 0;
  if (ms < DWELL_MS) return 0;
  return DWELL;
}

function affinity(topics: string[], company: string, w: Record<string, number>): number {
  const topicMean = topics.length ? topics.reduce((sum, topic) => sum + (w['t:' + topic] ?? 0), 0) / topics.length : 0;
  return topicMean + W_COMPANY * (w['c:' + company] ?? 0);
}

type Scored = { a: Article; topics: string[]; base: number; taste: number; total: number };

function score(a: Article, t: Taste, now: number, day: string): Scored {
  const topics = topicsOf(a);
  const q = W_HN * Math.min(1, Math.log10(1 + (a.hnPoints ?? 0)) / 3);
  const rawAge = (now - Date.parse(a.date)) / DAY_MS;
  const ageDays = Number.isFinite(rawAge) ? Math.max(0, rawAge) : 0;
  const f = W_FRESH * 0.5 ** (ageDays / FRESH_HALF_DAYS);
  const x = W_NOISE * (2 * hash01(`${t.id}|${day}|${a.id}`) - 1);
  const taste = W_TASTE * Math.tanh(affinity(topics, a.company, t.w));
  return { a, topics, base: q + f + x, taste, total: q + f + x + taste };
}

function by(key: 'total' | 'base'): (a: Scored, b: Scored) => number {
  return (a, b) => b[key] - a[key] || (a.a.id < b.a.id ? -1 : a.a.id > b.a.id ? 1 : 0);
}

function fits(c: Scored, out: Scored[]): boolean {
  const window = out.slice(-(WINDOW - 1));
  if (window.filter((s) => s.a.company === c.a.company).length >= MAX_PER_COMPANY) return false;
  for (const topic of c.topics) {
    if (window.filter((s) => s.topics.includes(topic)).length >= MAX_PER_TOPIC) return false;
  }
  return true;
}

function whyOf(s: Scored, w: Record<string, number>): string | null {
  if (s.taste <= WHY_MIN) return null;
  let name = s.a.company;
  let best = 0;
  for (const topic of s.topics) {
    const v = w['t:' + topic] ?? 0;
    if (v > best) {
      best = v;
      name = topic;
    }
  }
  return `for you: ${name}`;
}

function diversify(scored: Scored[], t: Taste): Ranked[] {
  // ponytail: one linear scan per slot, so O(n^2) over the catalog. Fine at a few hundred posts;
  // index by company and topic if the feed ever reaches thousands.
  const byTotal = [...scored].sort(by('total'));
  const byBase = [...scored].sort(by('base'));
  const warm = Object.values(t.w).some((v) => v > 0);
  const used = new Set<string>();
  const usedExplorePrimary = new Set<string>();
  const placed: Scored[] = [];
  const out: Ranked[] = [];
  const unexplored = (s: Scored) => s.topics.length > 0 && s.topics.every((topic) => Math.abs(t.w['t:' + topic] ?? 0) < UNEXPLORED);

  for (let slot = 0; slot < scored.length; slot++) {
    const explore = warm && slot % EXPLORE_EVERY === EXPLORE_EVERY - 1;
    let pick: Scored | undefined;
    let fromExplore = false;
    if (explore) {
      const open = (s: Scored) => !used.has(s.a.id) && fits(s, placed);
      pick = byBase.find((s) => open(s) && unexplored(s) && !usedExplorePrimary.has(s.topics[0]))
        ?? byBase.find((s) => open(s) && unexplored(s))
        ?? byBase.find((s) => open(s) && s.topics.length > 0 && s.topics.every((topic) => (t.w['t:' + topic] ?? 0) < UNEXPLORED));
      fromExplore = pick !== undefined;
    }
    if (!pick) pick = byTotal.find((s) => !used.has(s.a.id) && fits(s, placed));
    if (!pick) pick = byTotal.find((s) => !used.has(s.a.id));
    if (!pick) break;
    used.add(pick.a.id);
    placed.push(pick);
    if (fromExplore && pick.topics[0]) usedExplorePrimary.add(pick.topics[0]);
    out.push({ article: pick.a, why: fromExplore ? 'new to you' : whyOf(pick, t.w) });
  }
  return out;
}

export function rankFeed(articles: Article[], taste: Taste, read: ReadonlySet<string>, now: number, day: string): Ranked[] {
  const unread = articles.filter((a) => !read.has(a.id)).map((a) => score(a, taste, now, day));
  const readTail = articles.filter((a) => read.has(a.id)).map((a) => ({ article: a, why: null as string | null }));
  return [...diversify(unread, taste), ...readTail];
}
