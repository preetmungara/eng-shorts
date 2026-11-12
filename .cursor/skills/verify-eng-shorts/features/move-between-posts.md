# Move between posts

The reader shows one post at a time. Arrow keys, Page Up and Page Down, and `j` / `k` move to the next or previous post and the count follows.

## Sub-features

- `move-next` advances one post and updates the count.
- `move-prev` returns to the previous post.
- `move-stay` leaves the count at `1 / N` when moving up from the first post.

## How to get to it (user POV)

- Press `ArrowDown`, `j`, or `PageDown` to move forward.
- Press `ArrowUp`, `k`, or `PageUp` to move back.
- The hint `↑ ↓ to move · Enter to open` describes the same keys. It is not a control.

## Driving it with harness.mjs

Preconditions:

- Doctor passed and `check-start` still shows `1 / N`.
- The catalog has at least two articles, so a second card exists inside the first batch of ten.

- **Next, arrow.** Press Down. Run `node .cursor/skills/verify-eng-shorts/harness.mjs browser press --key ArrowDown`. The printed count is `2 / N` and the printed title is a different title from `/articles.json` than the one on the first card.
- **Previous, arrow.** Press Up. Run `node .cursor/skills/verify-eng-shorts/harness.mjs browser press --key ArrowUp`. The count returns to `1 / N` and the title is the first article again.
- **Next, j.** Press `j`. Run `node .cursor/skills/verify-eng-shorts/harness.mjs browser press --key j`. The count is `2 / N`.
- **Previous, k.** Press `k`. Run `node .cursor/skills/verify-eng-shorts/harness.mjs browser press --key k`. The count is `1 / N`.
- **Stay at the top.** Press Up on the first card. Run `node .cursor/skills/verify-eng-shorts/harness.mjs browser press --key ArrowUp`. The count stays `1 / N`.
- **Page keys.** From the first card, run `node .cursor/skills/verify-eng-shorts/harness.mjs browser press --key PageDown` and expect `2 / N`, then `node .cursor/skills/verify-eng-shorts/harness.mjs browser press --key PageUp` and expect `1 / N`.
- **Proof.** After a forward move, run `node .cursor/skills/verify-eng-shorts/harness.mjs browser snapshot --path .cursor/skills/verify-eng-shorts/artifacts/move/second.txt` and `node .cursor/skills/verify-eng-shorts/harness.mjs browser screenshot --path .cursor/skills/verify-eng-shorts/artifacts/move/second.png`. The count line is `2 / N` and the title is a title from `/articles.json` other than the first card's.

## Gotchas

- Keys are ignored while Alt, Ctrl, or Meta is held. The harness sends the key alone.
- `Enter` opens the article only when focus is on the document body. After clicking a link, focus may sit on that link, so `Enter` is not a substitute for the arrow keys.
- The reader mounts ten cards, then ten more when the visible index is within three of that window. The second card is in the first window. A card past the window is not in the DOM until a move extends it.
- The harness enables reduced motion before load so each key snaps. The app samples that setting once. A browser that smooth-scrolls can apply a second key before the first snap finishes and land on the wrong post. Wait until the printed count changes before the next forward key.
- Moving up from the first post does not wrap.
