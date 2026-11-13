import type { Article } from './types';
import { LESS, OPEN, learn, parseTaste, rankFeed, signalOf, topicsOf } from './rank';
import type { Taste } from './rank';

const NOW = Date.parse('2026-11-12T05:00:00Z');
const DAY = '2026-11-12';
const DAY_MS = 86_400_000;

const WORD: Record<string, string> = {
  ai: 'llm',
  infra: 'kubernetes',
  performance: 'latency',
  search: 'retrieval',
  dataeng: 'kafka',
  security: 'encrypt',
  databases: 'postgres',
  reliability: 'outage',
  distributed: 'paxos',
  observability: 'opentelemetry',
  mobile: 'android',
  devprod: 'monorepo',
  languages: 'ocaml',
  networking: 'quic',
  frontend: 'css',
};

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function taste(id: string, w: Record<string, number> = {}): Taste {
  return { v: 1, id, at: NOW, w };
}

function art(id: string, company: string, date: string, topics: string[], hnPoints?: number): Article {
  const title = topics.length ? topics.map((topic) => WORD[topic]).join(' ') : `note ${id}`;
  const article: Article = {
    id,
    company,
    title,
    url: `https://example.com/${id}`,
    date,
    excerpt: '',
    ...(hnPoints !== undefined ? { hnPoints } : {}),
  };
  const got = topicsOf(article);
  if (got.join() !== topics.join()) throw new Error(`${id} topics ${got.join()} != ${topics.join()}`);
  return article;
}

function ids(ranked: { article: Article }[]): string {
  return ranked.map((c) => c.article.id).join();
}

const postgres = topicsOf({ title: 'How we migrated Postgres with zero downtime', excerpt: '', company: '' });
if (!postgres.includes('databases')) throw new Error('postgres is databases');

const digest = topicsOf({
  title: 'The Daily Diff — Sunday, November 8, 2026',
  excerpt: 'A curation of 22 high-signal engineering stories and architectural breakdowns for Sunday, November 8, 2026, curated by Arpit Bhayani. Built for software engineers who value depth over noise.',
  company: 'Daily Diff',
});
if (digest.length !== 0) throw new Error('digest has no topic');

const many = Array.from({ length: 40 }, (_, i) => {
  const names = ['ai', 'infra', 'performance', 'search', 'dataeng', 'security', 'databases', 'reliability', 'distributed', 'observability', 'mobile', 'devprod', 'languages', 'networking', 'frontend'];
  return art(`a${i}`, `C${i % 7}`, iso(NOW - (i % 11) * DAY_MS), [names[i % names.length]], i % 5 === 0 ? 80 : undefined);
});
const permTaste = taste('perm');
const perm = rankFeed(many, permTaste, new Set(), NOW, DAY);
if (perm.length !== 40) throw new Error('permutation length');
if (new Set(perm.map((c) => c.article.id)).size !== 40) throw new Error('permutation ids');
for (const a of many) if (!perm.some((c) => c.article.id === a.id)) throw new Error('missing ' + a.id);

const again = rankFeed(many, permTaste, new Set(), NOW, DAY);
if (ids(perm) !== ids(again)) throw new Error('same inputs differ');

const tied = Array.from({ length: 12 }, (_, i) => art(`t${i}`, `N${i}`, iso(NOW), []));
const dayA = ids(rankFeed(tied, taste('aaa'), new Set(), NOW, DAY));
const dayB = ids(rankFeed(tied, taste('aaa'), new Set(), NOW, '2026-11-13'));
if (dayA === dayB) throw new Error('day does not rotate');
const installB = ids(rankFeed(tied, taste('bbb'), new Set(), NOW, DAY));
if (dayA === installB) throw new Error('install does not rotate');

const fresh = Array.from({ length: 10 }, (_, i) => art(`f${i}`, `F${i}`, iso(NOW - ((i % 3) + 1) * DAY_MS), []));
const stale = art('stale', 'OldCo', iso(NOW - 63 * DAY_MS), [], 1275);
let wins = 0;
for (let n = 0; n < 100; n++) {
  const ranked = rankFeed([stale, ...fresh], taste('s' + n), new Set(), NOW, DAY);
  if (ranked[0]?.article.id === 'stale') wins++;
}
if (wins >= 50) throw new Error('stale fame owns card 1 for ' + wins);

for (let n = 0; n < 20; n++) {
  const train = art('train' + n, 'Trainer', iso(NOW), ['ai']);
  let t = taste('lift' + n);
  for (let k = 0; k < 4; k++) t = learn(t, train, OPEN, NOW);
  const ai = art('fresh' + n, 'FreshCo', iso(NOW), ['ai']);
  const mobile = art('mob' + n, 'PhoneCo', iso(NOW), ['mobile']);
  const ranked = rankFeed([mobile, ai], t, new Set(), NOW, DAY);
  if (ranked.findIndex((c) => c.article.id === ai.id) >= ranked.findIndex((c) => c.article.id === mobile.id)) {
    throw new Error('taste does not lift ai over mobile');
  }
}

for (let n = 0; n < 20; n++) {
  const t = learn(taste('less' + n), art('meh' + n, 'Meh', iso(NOW), ['ai']), LESS, NOW);
  const ranked = rankFeed([art('ai' + n, 'Meh', iso(NOW), ['ai']), art('mob' + n, 'PhoneCo', iso(NOW - 3 * DAY_MS), ['mobile'])], t, new Set(), NOW, DAY);
  if (ranked[0]?.article.id !== 'mob' + n) throw new Error('less like this does not sink ai from Meh');
}

const readItems = [
  art('r0', 'R0', iso(NOW - 2 * DAY_MS), []),
  art('r1', 'R1', iso(NOW), [], 1000),
  art('r2', 'R2', iso(NOW - 5 * DAY_MS), []),
  art('r3', 'R3', iso(NOW - DAY_MS), [], 1000),
];
const read = new Set(['r1', 'r3']);
const demoted = rankFeed(readItems, taste('read'), read, NOW, DAY);
const demotedIds = demoted.map((c) => c.article.id);
if (demotedIds.slice(0, 2).some((id) => read.has(id))) throw new Error('read posts stay ahead of unread');
if (demotedIds.slice(2).join() !== 'r1,r3') throw new Error('read tail dropped input order');
if (demoted.slice(2).some((c) => c.why !== null)) throw new Error('read tail is labelled');

const acme = Array.from({ length: 20 }, (_, i) => art(`ac${i}`, 'Acme', iso(NOW), [], 1000));
const others = Array.from({ length: 20 }, (_, i) => art(`ot${i}`, `O${i}`, iso(NOW - 20 * DAY_MS), []));
const capped = rankFeed([...acme, ...others], taste('cap'), new Set(), NOW, DAY);
for (let end = 9; end < 30; end++) {
  const n = capped.slice(end - 9, end + 1).filter((c) => c.article.company === 'Acme').length;
  const othersUsed = capped.slice(0, end).filter((c) => c.article.company !== 'Acme').length;
  if (n > 2 && othersUsed < others.length) throw new Error(`company cap at ${end - 9}: ${n}`);
}

const otherTopics = ['infra', 'performance', 'search', 'dataeng', 'security', 'databases', 'reliability', 'distributed', 'observability', 'mobile'];
const aiPosts = Array.from({ length: 30 }, (_, i) => art(`ai${i}`, `A${i}`, iso(NOW), ['ai'], 1000));
const otherPosts = otherTopics.map((topic, i) => art(`nx${i}`, `B${i}`, iso(NOW - 10 * DAY_MS), [topic]));
const topicCapped = rankFeed([...aiPosts, ...otherPosts], taste('topic'), new Set(), NOW, DAY);
const aiInFirst = topicCapped.slice(0, 10).filter((c) => topicsOf(c.article).includes('ai')).length;
if (aiInFirst > 4) throw new Error('topic cap ' + aiInFirst);

const exploreAi = Array.from({ length: 4 }, (_, i) => art(`eA${i}`, `EA${i}`, iso(NOW), ['ai'], 1000));
const exploreDb = art('eDb', 'EDb', iso(NOW), ['databases'], 1000);
const exploreSec = art('eSec', 'ESec', iso(NOW), ['security']);
const exploreList = [...exploreAi, exploreDb, exploreSec];
const explored = rankFeed(exploreList, taste('warm', { 't:ai': 3 }), new Set(), NOW, DAY);
if (explored[4]?.article.id !== 'eDb' || explored[4].why !== 'new to you') {
  throw new Error(`explore slot ${explored[4]?.article.id} ${explored[4]?.why}`);
}
const suppressed = rankFeed(exploreList, taste('warm', { 't:ai': 3, 't:databases': -0.45 }), new Set(), NOW, DAY);
for (let i = 4; i < suppressed.length; i += 5) {
  if (topicsOf(suppressed[i].article).includes('databases')) throw new Error('skipped topic in explore slot ' + i);
}

const graftAi = Array.from({ length: 4 }, (_, i) => art(`gA${i}`, `GA${i}`, iso(NOW), ['ai'], 1000));
const graftSec = Array.from({ length: 4 }, (_, i) => art(`gS${i}`, `GS${i}`, iso(NOW), ['security']));
const graftDb = [art('gD1', 'GD1', iso(NOW - 8 * DAY_MS), ['databases'], 1000), art('gD2', 'GD2', iso(NOW - 8 * DAY_MS), ['databases'], 1000)];
const graftMob = art('gM', 'GM', iso(NOW - 8 * DAY_MS), ['mobile']);
const grafted = rankFeed([...graftAi, ...graftSec, ...graftDb, graftMob], taste('graft', { 't:ai': 3, 't:security': 2 }), new Set(), NOW, DAY);
if (grafted[4]?.why !== 'new to you' || topicsOf(grafted[4].article)[0] !== 'databases') {
  throw new Error(`graft slot 4 ${grafted[4]?.article.id} ${grafted[4]?.why} ${topicsOf(grafted[4]?.article ?? graftMob).join()}`);
}
if (grafted[9]?.why !== 'new to you' || topicsOf(grafted[9].article)[0] === 'databases') {
  throw new Error(`graft slot 9 ${grafted[9]?.article.id} ${grafted[9]?.why} ${topicsOf(grafted[9]?.article ?? graftMob).join()}`);
}
if (topicsOf(grafted[4].article)[0] === topicsOf(grafted[9].article)[0]) throw new Error('explore primary repeated');

const untagged = Array.from({ length: 8 }, (_, i) => art(`u${i}`, `U${i}`, iso(NOW), []));
const untaggedExplore = rankFeed([...Array.from({ length: 6 }, (_, i) => art(`fA${i}`, `FA${i}`, iso(NOW), ['ai'], 1000)), ...untagged], taste('warm', { 't:ai': 3 }), new Set(), NOW, DAY);
for (const card of untaggedExplore.filter((c) => c.why === 'new to you')) {
  if (topicsOf(card.article).length === 0) throw new Error('untagged card labelled new to you');
}

const coldCards = rankFeed(fresh, taste('cold'), new Set(), NOW, DAY);
if (coldCards.some((c) => c.why !== null)) throw new Error('cold start is labelled');
const labelled = rankFeed([art('loved', 'Other', iso(NOW), ['ai'])], (() => {
  let t = taste('label');
  for (let k = 0; k < 4; k++) t = learn(t, art('teacher', 'Trainer', iso(NOW), ['ai']), OPEN, NOW);
  return t;
})(), new Set(), NOW, DAY);
if (labelled[0]?.why !== 'for you: ai') throw new Error('warm label ' + labelled[0]?.why);

const three = [
  art('c0', 'Z0', iso(NOW - 10 * DAY_MS), []),
  art('c1', 'Z1', iso(NOW), [], 1000),
  art('c2', 'Z2', iso(NOW - DAY_MS), [], 100),
];
const allRead = rankFeed(three, taste('small'), new Set(three.map((a) => a.id)), NOW, DAY);
if (ids(allRead) !== 'c0,c1,c2') throw new Error('all-read keeps input order');
if (rankFeed([], taste('small'), new Set(), NOW, DAY).length !== 0) throw new Error('empty catalog');

let minted = 0;
const newId = () => `id${minted++}`;
for (const raw of [null, '{', 'null', '[]', '{"v":2}', '{"v":1,"id":5,"at":0,"w":{}}']) {
  const before = minted;
  const parsed = parseTaste(raw, NOW, newId);
  if (parsed.id !== `id${before}` || JSON.stringify(parsed.w) !== '{}') throw new Error('fresh taste for ' + raw);
}
const dirty = `{"v":1,"id":"keep-me","at":${NOW},"w":{"t:ai":"x","t:databases":1,"t:mobile":1e999,"t:security":4,"c:Acme":-4}}`;
const cleaned = parseTaste(dirty, NOW, () => 'nope');
if (cleaned.id !== 'keep-me') throw new Error('dropped weights replaced id');
if ('t:ai' in cleaned.w || 't:mobile' in cleaned.w) throw new Error('non-finite weight kept');
if (cleaned.w['t:databases'] !== 1 || cleaned.w['t:security'] !== 3 || cleaned.w['c:Acme'] !== -3) throw new Error('weights not clamped');
const droppedW = parseTaste(`{"v":1,"id":"keep-me","at":${NOW},"w":null}`, NOW, () => 'nope');
if (droppedW.id !== 'keep-me' || JSON.stringify(droppedW.w) !== '{}') throw new Error('bad w replaced id');
const oldVersion = parseTaste(`{"v":2,"id":"keep-me","at":${NOW},"w":{"t:ai":2}}`, NOW, () => 'nope');
if (oldVersion.id !== 'keep-me' || JSON.stringify(oldVersion.w) !== '{}') throw new Error('version mismatch replaced id');

const decayed = parseTaste(JSON.stringify({ v: 1, id: 'half', at: NOW - 21 * DAY_MS, w: { 't:ai': 2 } }), NOW, () => 'nope');
if (Math.abs((decayed.w['t:ai'] ?? 0) - 1) > 1e-9) throw new Error('half-life ' + decayed.w['t:ai']);
if (decayed.at !== NOW) throw new Error('decay did not move at');
const future = parseTaste(JSON.stringify({ v: 1, id: 'future', at: NOW + 5 * DAY_MS, w: { 't:ai': 2 } }), NOW, () => 'nope');
if (future.w['t:ai'] !== 2 || future.at !== NOW) throw new Error('future at inflated the weight');

const multi = art('multi', 'Poly', iso(NOW), ['ai', 'infra', 'devprod']);
let learned = taste('learn');
learned = learn(learned, multi, OPEN, NOW);
if (Math.abs((learned.w['t:ai'] ?? 0) - 1 / 3) > 1e-9) throw new Error('ai share ' + learned.w['t:ai']);
if (Math.abs((learned.w['t:infra'] ?? 0) - 1 / 3) > 1e-9) throw new Error('infra share');
if (Math.abs((learned.w['t:devprod'] ?? 0) - 1 / 3) > 1e-9) throw new Error('devprod share');
if (learned.w['c:Poly'] !== 1) throw new Error('company signal ' + learned.w['c:Poly']);
for (let k = 0; k < 11; k++) learned = learn(learned, multi, OPEN, NOW);
if (learned.w['t:ai'] !== 3 || learned.w['t:infra'] !== 3 || learned.w['t:devprod'] !== 3 || learned.w['c:Poly'] !== 3) {
  throw new Error('clamp ' + JSON.stringify(learned.w));
}

const signals: [number, number | null][] = [
  [200, null],
  [1000, 0],
  [3000, 0],
  [8000, 0.4],
  [600000, 0.4],
];
for (const [ms, want] of signals) {
  const got = signalOf(ms);
  if (got !== want) throw new Error(`signalOf(${ms}) is ${String(got)}`);
}
