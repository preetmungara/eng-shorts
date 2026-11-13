import { useEffect, useRef, useState } from 'preact/hooks';
import { LESS, OPEN, learn, parseTaste, rankFeed, signalOf, type Ranked } from './rank';
import type { Article } from './types';

const READ_KEY = 'read-ids';
const SAVED_KEY = 'saved-ids';
const TASTE_KEY = 'taste';
const BATCH = 10;
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const settled = new Map<string, number>();

function dayKey(now: number): string {
  const d = new Date(now);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${date}`;
}

function newId(): string {
  const bytes = new Uint8Array(4);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let taste = parseTaste(localStorage.getItem(TASTE_KEY), Date.now(), newId);

function credit(a: Article, signal: number) {
  const prev = settled.get(a.id);
  if (prev === LESS || (prev !== undefined && signal !== LESS && signal <= prev)) return;
  settled.set(a.id, signal);
  taste = learn(taste, a, signal - (prev ?? 0), Date.now());
  try { localStorage.setItem(TASTE_KEY, JSON.stringify(taste)); } catch {}
}

function ago(iso: string): string {
  const days = Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
  if (days > -1) return 'today';
  if (days > -14) return rtf.format(days, 'day');
  return rtf.format(Math.round(days / 7), 'week');
}

function loadIds(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? '[]'));
  } catch {
    return new Set();
  }
}

function hueOf(company: string): number {
  let h = 2166136261;
  for (let i = 0; i < company.length; i++) h = Math.imul(h ^ company.charCodeAt(i), 16777619);
  return (h >>> 0) % 360;
}

function readOn(url: string): string {
  try {
    return `Read on ${new URL(url).hostname.replace(/^www\./, '')} →`;
  } catch {
    return 'Read the full article →';
  }
}

export function App() {
  const [cards, setCards] = useState<Ranked[] | null>(null);
  const [error, setError] = useState(false);
  const [read, setRead] = useState(() => loadIds(READ_KEY));
  const [saved, setSaved] = useState(() => loadIds(SAVED_KEY));
  const [index, setIndex] = useState(0);
  const [limit, setLimit] = useState(BATCH);
  const feed = useRef<HTMLElement>(null);
  const savedDialog = useRef<HTMLDialogElement>(null);
  const shown = useRef({ i: 0, ms: 0, since: performance.now() });

  useEffect(() => {
    fetch('articles.json')
      .then((r) => r.json())
      .then((list: Article[]) => {
        setCards(rankFeed(list, taste, loadIds(READ_KEY), Date.now(), dayKey(Date.now())));
        shown.current.since = performance.now();
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    const s = shown.current;
    if (index === s.i) return;
    const ms = s.ms + (Number.isNaN(s.since) ? 0 : performance.now() - s.since);
    const a = cards?.[s.i]?.article;
    const signal = signalOf(ms);
    if (a && signal !== null) credit(a, signal);
    shown.current = { i: index, ms: 0, since: document.hidden ? NaN : performance.now() };
  }, [index]);

  useEffect(() => {
    const onVis = () => {
      const s = shown.current;
      if (document.hidden && !Number.isNaN(s.since)) { s.ms += performance.now() - s.since; s.since = NaN; }
      else if (!document.hidden) s.since = performance.now();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const markRead = (a: Article) => {
    const next = new Set(read).add(a.id);
    setRead(next);
    localStorage.setItem(READ_KEY, JSON.stringify([...next]));
    credit(a, OPEN);
  };

  const toggleSave = (a: Article) => {
    const next = new Set(saved);
    if (!next.delete(a.id)) {
      next.add(a.id);
      credit(a, OPEN);
    }
    setSaved(next);
    localStorage.setItem(SAVED_KEY, JSON.stringify([...next]));
  };

  const less = (a: Article, i: number) => {
    credit(a, LESS);
    go(i + 1);
  };

  const go = (i: number) => {
    if (i < 0) return;
    setLimit((n) => (i + 3 >= n ? n + BATCH : n));
    const cards = feed.current?.children;
    if (!cards || i >= cards.length) return;
    setIndex(i);
    cards[i].scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || savedDialog.current?.open) return;
      const el = feed.current;
      if (!el || el.clientHeight === 0) return;
      const current = Math.round(el.scrollTop / el.clientHeight);
      if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'PageDown') {
        e.preventDefault();
        go(current + 1);
      } else if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'PageUp') {
        e.preventDefault();
        go(current - 1);
      } else if (e.key === 'Enter' && document.activeElement === document.body) {
        el.children[current]?.querySelector('a')?.click();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const onScroll = (e: Event) => {
    const el = e.currentTarget as HTMLElement;
    const i = Math.round(el.scrollTop / el.clientHeight);
    setIndex(i);
    setLimit((n) => (i + 3 >= n ? n + BATCH : n));
  };

  if (error) return <p class="status">Couldn't load articles. Try refreshing.</p>;
  if (!cards) return <p class="status">Loading…</p>;

  return (
    <>
      <header class="bar">
        <span class="brand">eng shorts</span>
        <span class="right">
          <button class="pill" onClick={() => savedDialog.current?.showModal()}>saved {saved.size}</button>
          <span class="count" aria-live="polite">
            {Math.min(index + 1, cards.length)} / {cards.length}
          </span>
        </span>
      </header>
      <main class="feed" ref={feed} onScroll={onScroll}>
        {cards.slice(0, limit).map(({ article: a, why }, i) => (
          <article class={read.has(a.id) ? 'card is-read' : 'card'} key={a.id} style={{ '--hue': hueOf(a.company) }}>
            <div class="inner">
              <p class="meta">
                <span class="company">{a.company}</span>
                {a.hnPoints !== undefined && <span class="hn">▲ {a.hnPoints.toLocaleString('en-US')} on Hacker News</span>}
                <span>{ago(a.date)}</span>
                {a.readMins && <span>{a.readMins} min read</span>}
                {read.has(a.id) && <span class="tag">read</span>}
                {why && <span class="tag">{why}</span>}
              </p>
              <h2 class="title">
                <a href={a.url} target="_blank" rel="noopener" onClick={() => markRead(a)}>
                  {a.title}
                </a>
              </h2>
              {a.excerpt && <p class="excerpt">{a.excerpt}</p>}
              <span class="cta" aria-hidden="true">{readOn(a.url)}</span>
              <div class="actions">
                <button class="pill save" aria-pressed={saved.has(a.id)} onClick={() => toggleSave(a)}>
                  {saved.has(a.id) ? '★ Saved' : '☆ Save'}
                </button>
                <button class="pill less" disabled={settled.get(a.id) === LESS} onClick={() => less(a, i)}>
                  {settled.get(a.id) === LESS ? 'Showing less' : 'Less like this'}
                </button>
              </div>
            </div>
          </article>
        ))}
        {limit >= cards.length && <section class="card end">
          <div class="inner">
            <h2 class="title">You're caught up.</h2>
            <p class="excerpt">
              That's every post in the catalog. You opened {cards.filter((c) => read.has(c.article.id)).length}. Go finish one of them instead of
              scrolling more.
            </p>
            <button class="cta" onClick={() => go(0)}>
              Back to top
            </button>
          </div>
        </section>}
      </main>
      <dialog class="saved" ref={savedDialog} onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}>
        <h2>Saved</h2>
        {saved.size === 0 && <p class="excerpt">Nothing saved yet. Press Save on a card to keep it here.</p>}
        <ul>
          {[...saved].reverse().flatMap((id) => cards.find((c) => c.article.id === id)?.article ?? []).map((a) => (
            <li key={a.id} style={{ '--hue': hueOf(a.company) }}>
              <a href={a.url} target="_blank" rel="noopener" onClick={() => markRead(a)}>{a.title}</a>
              <span class="company">{a.company}</span>
              <button class="pill" onClick={() => toggleSave(a)}>Remove</button>
            </li>
          ))}
        </ul>
        <form method="dialog">
          <button class="pill">Close</button>
        </form>
      </dialog>
      <p class="hint" aria-hidden="true">
        ↑ ↓ to move · Enter to open
      </p>
    </>
  );
}
