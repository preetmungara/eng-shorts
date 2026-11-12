# Browse the feed

Opening Eng Shorts shows one engineering post per screen, with the company, title, excerpt, and a count of which post is on screen.

## Sub-features

- `feed-load` shows an article from the served catalog after the loading line is gone.
- `feed-position` shows `1 / N` for a catalog of N articles.
- `feed-error` shows a refresh message when the catalog cannot be read.

## How to get to it (user POV)

- Open the site root in a browser. The dev server is `http://127.0.0.1:4173`.
- There is no second route. The reader is the whole page.

## Driving it with harness.mjs

Preconditions:

- `node .cursor/skills/verify-eng-shorts/harness.mjs doctor` printed `doctor ok` and a count of `1 / N`.
- `/articles.json` is a non-empty array.

- **First card.** Read the open card against the catalog. Run `node .cursor/skills/verify-eng-shorts/harness.mjs browser check-start`. Exit code 0. Stdout contains `brand eng shorts`, `count 1 / N`, and the company and title of an article that is in `articles.json`. The reader orders its own feed, so the open card is not required to be `articles.json[0]`.
- **Position text.** Read the live count. Run `node .cursor/skills/verify-eng-shorts/harness.mjs browser text --selector ".count"`. The printed line is `1 / N`, the same N as `articles.json`.
- **Proof.** Capture the open card. Run `node .cursor/skills/verify-eng-shorts/harness.mjs browser snapshot --path .cursor/skills/verify-eng-shorts/artifacts/browse-feed/feed.txt` and `node .cursor/skills/verify-eng-shorts/harness.mjs browser screenshot --path .cursor/skills/verify-eng-shorts/artifacts/browse-feed/feed.png`. The text file records `eng shorts`, `1 / N`, and the open title. The screenshot shows that title.
- **Failed catalog.** This path is not driven by the default launch. Launch serves a readable `articles.json`. If that file is missing or empty, launch exits before ready and the page would show `Couldn't load articles. Try refreshing.` Do not replace the file with a stand-in catalog and call this verified.

## Gotchas

- The first paint is `Loading…`. `check-start` waits until a card title is visible. Asserting earlier fails.
- `.count` has surrounding whitespace in the DOM. The harness prints the trimmed text. Compare that, not the raw `textContent`.
- Article titles change when someone runs `npm run collect`. Compare to the served `/articles.json` for this run.
- Do not run `npm run collect` during verification. It rewrites `public/articles.json` from the network.
- A status of `Couldn't load articles. Try refreshing.` means the catalog request failed. That is not an empty successful feed.
