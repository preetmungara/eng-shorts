# Eng Shorts verification map

This directory is the maintained source for verifying the user-facing behavior of Eng Shorts. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `node .cursor/skills/verify-eng-shorts/harness.mjs launch` from the repo root.
- The reader is at `http://127.0.0.1:4173` unless `VERIFY_PORT` is set.
- `public/articles.json` is a non-empty array, served unchanged as `/articles.json`.
- The Edge profile in the run directory (`%TEMP%\\eng-shorts-verify`, or `VERIFY_HOME`) starts with no `read-ids` entry. The run directory is outside the repo.
- Run `node .cursor/skills/verify-eng-shorts/harness.mjs doctor` and require a live pid, that URL, and a count of `1 / N`.
- Never drive a Vite process this run did not start. A second run needs `VERIFY_PORT` and `VERIFY_HOME`.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer the selectors in the feature files. They match the reader's class names and the visible button label.
- Treat every command as literal. Keep quoted selectors and flags unchanged.
- Run browser actions through `node .cursor/skills/verify-eng-shorts/harness.mjs browser ...`.
- Compare titles and the article count to the served `/articles.json` for this run.
- Cleanup removes the run directory only. Leave files under `.cursor/skills/verify-eng-shorts/artifacts/`.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes the command stdout, a snapshot text file, and a screenshot of the Edge window.
- Read-mark proof includes the on-screen `read` tag and the `read-ids` value.
- Record the feature id and the entry point with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with harness.mjs` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Browse the feed](./browse-feed.md) covers the first card, the position count, and a failed catalog load.
- [Move between posts](./move-between-posts.md) covers the next and previous keys and the top boundary.
- [Mark a post read](./mark-read.md) covers the title link, the read tag, and `read-ids`.
- [Caught up](./caught-up.md) covers the end card and Back to top.
