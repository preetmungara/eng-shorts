import { useEffect, useRef, useState } from 'preact/hooks';
import type { Article } from './types';

const READ_KEY = 'read-ids';
const BATCH = 10;
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function ago(iso: string): string {
  const days = Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
  if (days > -1) return 'today';
  if (days > -14) return rtf.format(days, 'day');
  return rtf.format(Math.round(days / 7), 'week');
}

function loadRead(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

export function App() {
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [error, setError] = useState(false);
  const [read, setRead] = useState(loadRead);
  const [index, setIndex] = useState(0);
  const [limit, setLimit] = useState(BATCH);
  const feed = useRef<HTMLElement>(null);

  useEffect(() => {
    fetch('articles.json')
      .then((r) => r.json())
      .then(setArticles)
      .catch(() => setError(true));
  }, []);

  const markRead = (id: string) => {
    const next = new Set(read).add(id);
    setRead(next);
    localStorage.setItem(READ_KEY, JSON.stringify([...next]));
  };

  const go = (i: number) => {
    const cards = feed.current?.children;
    if (!cards || i < 0 || i >= cards.length) return;
    cards[i].scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'PageDown') {
        e.preventDefault();
        go(index + 1);
      } else if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'PageUp') {
        e.preventDefault();
        go(index - 1);
      } else if (e.key === 'Enter' && document.activeElement === document.body) {
        feed.current?.children[index]?.querySelector('a')?.click();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [index]);

  const onScroll = (e: Event) => {
    const el = e.currentTarget as HTMLElement;
    const i = Math.round(el.scrollTop / el.clientHeight);
    setIndex(i);
    if (i + 3 >= limit) setLimit(limit + BATCH);
  };

  if (error) return <p class="status">Couldn't load articles. Try refreshing.</p>;
  if (!articles) return <p class="status">Loading…</p>;

  return (
    <>
      <header class="bar">
        <span class="brand">eng shorts</span>
        <span class="count" aria-live="polite">
          {Math.min(index + 1, articles.length)} / {articles.length}
        </span>
      </header>
      <main class="feed" ref={feed} onScroll={onScroll}>
        {articles.slice(0, limit).map((a) => (
          <article class={read.has(a.id) ? 'card is-read' : 'card'} key={a.id}>
            <div class="inner">
              <p class="meta">
                <span class="company">{a.company}</span>
                <span>{ago(a.date)}</span>
                {a.readMins && <span>{a.readMins} min read</span>}
                {read.has(a.id) && <span class="tag">read</span>}
              </p>
              <h2 class="title">
                <a href={a.url} target="_blank" rel="noopener" onClick={() => markRead(a.id)}>
                  {a.title}
                </a>
              </h2>
              {a.excerpt && <p class="excerpt">{a.excerpt}</p>}
              <span class="cta" aria-hidden="true">Read the full article →</span>
            </div>
          </article>
        ))}
        {limit >= articles.length && <section class="card end">
          <div class="inner">
            <h2 class="title">You're caught up.</h2>
            <p class="excerpt">
              That's every post from the last 60 days. You opened {articles.filter((a) => read.has(a.id)).length}. Go finish one of them instead of
              scrolling more.
            </p>
            <button class="cta" onClick={() => go(0)}>
              Back to top
            </button>
          </div>
        </section>}
      </main>
      <p class="hint" aria-hidden="true">
        ↑ ↓ to move · Enter to open
      </p>
    </>
  );
}
