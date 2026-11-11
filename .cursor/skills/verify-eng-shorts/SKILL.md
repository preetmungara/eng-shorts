---
name: verify-eng-shorts
description: Drive Eng Shorts, the scrollable engineering-blog reader, in a real Edge window and prove the feed, keyboard moves, read marks, and the caught-up card. Use when changing the reader UI, scroll behavior, articles.json rendering, or localStorage read marks.
---

# Verify Eng Shorts

Eng Shorts is a web reader. `npm run dev` serves it. `npm run collect` rebuilds `public/articles.json` from the network and is not part of driving the reader. There is no login and no database. Read marks live in `localStorage` key `read-ids` for the page origin.

The feature map in `features/` is the source for what to drive. A proof that uses one entry point does not cover an entry point the map lists separately.

## Launch

From the repo root, with Node on PATH (the repo expects Node 26):

```
node .cursor/skills/verify-eng-shorts/harness.mjs launch
```

This starts Vite at `http://127.0.0.1:4173` (`VERIFY_PORT` overrides) and a headless Edge. The run directory defaults to `%TEMP%\\eng-shorts-verify` (`VERIFY_HOME` overrides it) and holds `state.json`, `server.log`, and `edge-profile`. It stays outside the repo: Vite watches the repo, and Edge locks files in its profile. The profile starts empty, so read marks from the user's browser are not involved. The catalog is the repo's `public/articles.json`, served as `/articles.json`. That file is gitignored. There is nothing to migrate. Launch returns when the first card is on screen: the brand is `eng shorts` and the first article title is visible. `Loading…` is not ready.

`articles.json` must already be a non-empty array. An empty or missing catalog fails launch. Do not invent articles, and do not run `npm run collect`, to make it pass.

One default instance. If that run directory's `state.json` records a live pid, launch refuses. A second instance needs both `VERIFY_PORT` and `VERIFY_HOME`, and `VERIFY_HOME` must stay outside the repo. Do not drive a Vite the harness did not start. The harness serves Vite with `vite.harness.ts`, which ignores `.cursor`, so writing a proof file does not reload the page.

The harness turns on `prefers-reduced-motion` before the app loads. The reader reads that query once at startup and then snaps instantly. That is a real browser setting, not a test hook.

## Doctor

```
node .cursor/skills/verify-eng-shorts/harness.mjs doctor
```

Read-only. It checks that the recorded pid is alive, that the port serves `<title>Eng Shorts</title>`, that `/articles.json` is a non-empty array, and that the open page shows brand `eng shorts`, count `1 / N`, and the first served title. There is no auth to check. Run this first whenever the page looks wrong. Do not drive an instance that fails doctor.

## Drive

Commands below assume the working directory is the repo root. Selectors are from the reader, not from a sample app.

```
node .cursor/skills/verify-eng-shorts/harness.mjs browser check-start
node .cursor/skills/verify-eng-shorts/harness.mjs browser text --selector ".brand"
node .cursor/skills/verify-eng-shorts/harness.mjs browser text --selector ".count"
node .cursor/skills/verify-eng-shorts/harness.mjs browser press --key ArrowDown
node .cursor/skills/verify-eng-shorts/harness.mjs browser press --key j
node .cursor/skills/verify-eng-shorts/harness.mjs browser press --key ArrowUp
node .cursor/skills/verify-eng-shorts/harness.mjs browser press --key k
node .cursor/skills/verify-eng-shorts/harness.mjs browser click --selector "article.card:not(.end) h2 a"
node .cursor/skills/verify-eng-shorts/harness.mjs browser click --selector ".card.end button"
node .cursor/skills/verify-eng-shorts/harness.mjs browser eval --expression "localStorage.getItem('read-ids')"
node .cursor/skills/verify-eng-shorts/harness.mjs browser snapshot --path .cursor/skills/verify-eng-shorts/artifacts/browse-feed/feed.txt
node .cursor/skills/verify-eng-shorts/harness.mjs browser screenshot --path .cursor/skills/verify-eng-shorts/artifacts/browse-feed/feed.png
```

`check-start` exits non-zero when the open card disagrees with the served `articles.json`. `press` accepts `ArrowDown`, `ArrowUp`, `PageDown`, `PageUp`, `j`, `k`, and `Enter`. Trimmed `.count` text is what the reader is showing. The raw DOM text has surrounding whitespace.

Follow `features/` for the full journeys. Keyboard keys and the title link are the user controls. Do not set React state or write `localStorage` except by those controls.

## Evidence

Write proof under `.cursor/skills/verify-eng-shorts/artifacts/<feature>/`. Cleanup does not delete that directory.

A proof of the feed shows the check-start stdout (brand, count, title, company) plus `feed.txt` and `feed.png` taken while that card is on screen. The screenshot is the Edge rendering of the reader. The snapshot records brand, count, company, title, and read state. Compare the title and company to `/articles.json`, not to a remembered string.

Mark-read proof needs both the `read` tag on the card and the `read-ids` value containing that article's id. The title link opens the publisher in a new tab. Do not treat that third-party page as evidence, and do not need it to load.

Caught-up proof needs the heading `You're caught up.` and, after Back to top, count `1 / N` again.

Do not run `npm run collect` to refresh the catalog during a proof. It writes `public/articles.json` from the network. The dev server does not skip that file.

## Cleanup

```
node .cursor/skills/verify-eng-shorts/harness.mjs cleanup
```

This stops the serve pid, the Vite pid, and the Edge pid recorded in the run directory's `state.json`, then deletes that run directory (profile, log, state). It does not kill by process name and it does not remove `artifacts/`. After cleanup, confirm the proof files are still in `artifacts/`.

## Helpers

`node .cursor/skills/verify-eng-shorts/harness.mjs` is the harness. Subcommands: `launch`, `doctor`, `browser`, `cleanup`. `serve` is what `launch` detaches. The feature files name the exact commands.

When the map and the app disagree, use `/maintain-verification-skill`.
