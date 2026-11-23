import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LESS, OPEN, TOPIC_NAMES, learn, parsePrefs, parseTaste, rankFeed, signalOf, topicsOf, type Prefs, type Ranked } from './rank';
import type { Article } from './types';

const READ_KEY = 'read-ids';
const SAVED_KEY = 'saved-ids';
const TASTE_KEY = 'taste';
const PREFS_KEY = 'prefs';
const MAX_RESULTS = 50;
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

function cardIndex(el: HTMLElement): number {
  const y = el.scrollTop + 1;
  let i = 0;
  for (let n = 0; n < el.children.length; n++) {
    if ((el.children[n] as HTMLElement).offsetTop <= y) i = n;
  }
  return i;
}

function closeOnBackdrop(e: MouseEvent) {
  if (e.target === e.currentTarget) (e.currentTarget as HTMLDialogElement).close();
}

function stringIds(v: unknown): string[] {
  if (!Array.isArray(v) || v.some((id) => typeof id !== 'string')) throw new Error('bad ids');
  return v;
}

export function App() {
  const [list, setList] = useState<Article[]>([]);
  const [cards, setCards] = useState<Ranked[] | null>(null);
  const [error, setError] = useState(false);
  const [read, setRead] = useState(() => loadIds(READ_KEY));
  const [saved, setSaved] = useState(() => loadIds(SAVED_KEY));
  const [prefs, setPrefs] = useState(() => parsePrefs(localStorage.getItem(PREFS_KEY)));
  const [index, setIndex] = useState(0);
  const [limit, setLimit] = useState(BATCH);
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('');
  const [prefQuery, setPrefQuery] = useState('');
  const feed = useRef<HTMLElement>(null);
  const nav = useRef<HTMLInputElement>(null);
  const savedDialog = useRef<HTMLDialogElement>(null);
  const searchDialog = useRef<HTMLDialogElement>(null);
  const youDialog = useRef<HTMLDialogElement>(null);
  const shown = useRef({ i: 0, ms: 0, since: performance.now() });

  useEffect(() => {
    const inline = () => JSON.parse(document.getElementById('articles-data')?.textContent || '') as Article[];
    const load = location.protocol === 'file:' ? Promise.resolve().then(inline) : fetch('articles.json').then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<Article[]>; });
    load
      .then((list: Article[]) => {
        setList(list);
        setCards(rankFeed(list, taste, loadIds(READ_KEY), Date.now(), dayKey(Date.now()), prefs));
        shown.current.since = performance.now();
      })
      .catch(() => setError(true));
  }, []);

  const companies = useMemo(() => [...new Set(list.map((a) => a.company))].sort((a, b) => a.localeCompare(b)), [list]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q && !topic) return [];
    return list
      .filter((a) => (!q || `${a.title} ${a.excerpt} ${a.company}`.toLowerCase().includes(q)) && (!topic || topicsOf(a).includes(topic)))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [list, query, topic]);

  const reorder = (p: Prefs) => {
    setCards(rankFeed(list, taste, read, Date.now(), dayKey(Date.now()), p));
    setLimit(BATCH);
    shown.current = { i: 0, ms: 0, since: performance.now() };
    setIndex(0);
  };

  useEffect(() => feed.current?.scrollTo(0, 0), [cards]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const input = nav.current;
      if (!input?.checked || input.closest('.tools')?.contains(e.target as Node)) return;
      input.checked = false;
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, []);

  const closeNav = () => {
    if (nav.current) nav.current.checked = false;
  };

  const togglePref = (key: string, kind: keyof Prefs) => {
    const other = kind === 'follow' ? 'mute' : 'follow';
    const on = prefs[kind].includes(key);
    const next = { [kind]: on ? prefs[kind].filter((k) => k !== key) : [...prefs[kind], key], [other]: prefs[other].filter((k) => k !== key) } as Prefs;
    setPrefs(next);
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    reorder(next);
  };

  const resetTaste = () => {
    if (!confirm('Forget everything the feed has learned from your reading? Follows and mutes stay.')) return;
    taste = { ...taste, at: Date.now(), w: {} };
    settled.clear();
    localStorage.setItem(TASTE_KEY, JSON.stringify(taste));
    reorder(prefs);
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ read: [...read], saved: [...saved], taste, prefs })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `eng-shorts-${dayKey(Date.now())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importData = async (e: Event) => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const nextRead = stringIds(data.read);
      const nextSaved = stringIds(data.saved);
      const nextTaste = parseTaste(JSON.stringify(data.taste ?? null), Date.now(), newId);
      const nextPrefs = parsePrefs(JSON.stringify(data.prefs ?? null));
      localStorage.setItem(READ_KEY, JSON.stringify(nextRead));
      localStorage.setItem(SAVED_KEY, JSON.stringify(nextSaved));
      localStorage.setItem(TASTE_KEY, JSON.stringify(nextTaste));
      localStorage.setItem(PREFS_KEY, JSON.stringify(nextPrefs));
      location.reload();
    } catch {
      alert("That file isn't an Eng Shorts export.");
    }
  };

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

  const show = (a: Article) => {
    const i = cards?.findIndex((c) => c.article.id === a.id) ?? -1;
    if (i < 0) return;
    setLimit((n) => Math.max(n, i + 1));
    setIndex(i);
    searchDialog.current?.close();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      feed.current?.children[i]?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || document.querySelector('dialog[open]')) return;
      const el = feed.current;
      if (!el || el.clientHeight === 0) return;
      const current = cardIndex(el);
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
    const i = cardIndex(el);
    setIndex(i);
    setLimit((n) => (i + 3 >= n ? n + BATCH : n));
  };

  if (error) return <p class="status">Couldn't load articles. Try refreshing.</p>;
  if (!cards) return <p class="status">Loading…</p>;

  const needle = prefQuery.trim().toLowerCase();
  const match = (name: string) => name.toLowerCase().includes(needle);
  const groups: [string, [string, string][]][] = [
    ['Topics', TOPIC_NAMES.filter(match).map((t) => ['t:' + t, t])],
    ['Companies', companies.filter(match).map((c) => ['c:' + c, c])],
  ];
  const prefGroups = groups.filter(([, rows]) => rows.length > 0);

  return (
    <>
      <header class="bar">
        <span class="brand">eng shorts</span>
        <div class="tools">
          <label class="pill menu-toggle" for="feed-nav">menu</label>
          <input id="feed-nav" class="nav-check" type="checkbox" ref={nav} />
          <div class="links">
            <a class="pill" href="feed.xml" title="Subscribe in a feed reader">rss</a>
            <button class="pill" onClick={() => { closeNav(); searchDialog.current?.showModal(); }}>search</button>
            <button class="pill" onClick={() => { closeNav(); youDialog.current?.showModal(); }}>you</button>
            <button class="pill" onClick={() => { closeNav(); savedDialog.current?.showModal(); }}>saved{saved.size ? ` ${saved.size}` : ''}</button>
          </div>
        </div>
        {/* ponytail: hidden position is for the verify harness; the reader does not show a count */}
        <span class="count" hidden>{Math.min(index + 1, cards.length)} / {cards.length}</span>
      </header>
      <main class="feed" ref={feed} onScroll={onScroll}>
        {cards.slice(0, limit).map(({ article: a, why }, i) => (
          <article class={read.has(a.id) ? 'card is-read' : 'card'} key={a.id} style={{ '--hue': hueOf(a.company) }}>
            <div class="inner">
              <p class="meta">
                <span class="company">{a.company}</span>
                <span>{ago(a.date)}</span>
                {a.readMins ? <span>{a.readMins} min</span> : null}
                {a.hnPoints !== undefined ? <span>{a.hnPoints.toLocaleString('en-US')} pts</span> : null}
                {read.has(a.id) && <span class="tag">read</span>}
                {why && <span class="tag">{why}</span>}
              </p>
              <h2 class="title">
                <a href={a.url} target="_blank" rel="noopener" onClick={() => markRead(a)}>
                  {a.title}
                </a>
              </h2>
              {a.short ? (
                <div class="short">
                  <p class="idea">{a.short.idea}</p>
                  <ul class="tldr">
                    {a.short.tldr.map((line, i) => <li key={i}>{line}</li>)}
                  </ul>
                </div>
              ) : a.excerpt && <p class="excerpt">{a.excerpt}</p>}
              <a class="cta" href={a.url} target="_blank" rel="noopener" onClick={() => markRead(a)}>{readOn(a.url)}</a>
              <div class="actions">
                <button class="pill" aria-pressed={saved.has(a.id)} onClick={() => toggleSave(a)}>
                  {saved.has(a.id) ? '★ Saved' : '☆ Save'}
                </button>
                <button class="pill" disabled={settled.get(a.id) === LESS} onClick={() => less(a, i)}>
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
      <dialog class="saved" ref={searchDialog} onClick={closeOnBackdrop}>
        <h2>Search</h2>
        <div class="search">
          <input type="search" placeholder="Title, company, or word" value={query} onInput={(e) => setQuery(e.currentTarget.value)} aria-label="Search posts" />
          <select value={topic} onChange={(e) => setTopic(e.currentTarget.value)} aria-label="Topic">
            <option value="">All topics</option>
            {TOPIC_NAMES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {(query.trim() || topic) && <p class="excerpt">{results.length} posts{results.length > MAX_RESULTS && `, newest ${MAX_RESULTS} shown`}</p>}
        <ul>
          {results.slice(0, MAX_RESULTS).map((a) => (
            <li key={a.id} style={{ '--hue': hueOf(a.company) }}>
              <a href={a.url} onClick={(e) => { e.preventDefault(); show(a); }}>{a.title}</a>
              <span class="company">{a.company}</span>
              <button class="pill" aria-pressed={saved.has(a.id)} onClick={() => toggleSave(a)}>{saved.has(a.id) ? '★ Saved' : '☆ Save'}</button>
            </li>
          ))}
        </ul>
        <form method="dialog">
          <button class="pill">Close</button>
        </form>
      </dialog>
      <dialog class="saved you" ref={youDialog} onClick={closeOnBackdrop} onClose={() => setPrefQuery('')}>
        <h2>You</h2>
        <p class="excerpt">Follow puts a topic or company at full taste. Mute hides it from the feed.</p>
        <div class="search">
          <input type="search" placeholder="Filter topics and companies" value={prefQuery} onInput={(e) => setPrefQuery(e.currentTarget.value)} aria-label="Filter topics and companies" autocomplete="off" />
        </div>
        <div class="scroll">
          {prefGroups.length === 0 && <p class="excerpt">Nothing matches.</p>}
          {prefGroups.map(([heading, rows]) => (
            <section key={heading}>
              <h3>{heading}</h3>
              <ul class="prefs">
                {rows.map(([key, name]) => (
                  <li key={key}>
                    <span>{name}</span>
                    <button class="pill" aria-pressed={prefs.follow.includes(key)} onClick={() => togglePref(key, 'follow')}>Follow</button>
                    <button class="pill" aria-pressed={prefs.mute.includes(key)} onClick={() => togglePref(key, 'mute')}>Mute</button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <h3>Your data</h3>
        <p class="excerpt">Everything lives in this browser. Export it to move to another device.</p>
        <div class="row">
          <button class="pill" onClick={exportData}>Export</button>
          <label class="pill">
            Import
            <input type="file" accept="application/json,.json" hidden onChange={importData} />
          </label>
          <button class="pill" onClick={resetTaste}>Reset learned taste</button>
          <form method="dialog">
            <button class="pill" autofocus>Close</button>
          </form>
        </div>
      </dialog>
      <dialog class="saved" ref={savedDialog} onClick={closeOnBackdrop}>
        <h2>Saved</h2>
        {saved.size === 0 && <p class="excerpt">Nothing saved yet. Press Save on a card to keep it here.</p>}
        <ul>
          {[...saved].reverse().flatMap((id) => list.find((a) => a.id === id) ?? []).map((a) => (
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
