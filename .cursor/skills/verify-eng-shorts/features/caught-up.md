# Caught up

After the last post, the reader shows a caught-up card with how many posts were opened, and Back to top returns to the first post.

## Sub-features

- `end-card` shows `You're caught up.` once every served article has been reachable.
- `back-to-top` returns to the first post and shows `1 / N` again.

## How to get to it (user POV)

- Move forward with `ArrowDown`, `j`, or `PageDown` until the end card is the screen on view.
- Choose the `Back to top` button on that card.

## Driving it with harness.mjs

Preconditions:

- Doctor passed and the count starts at `1 / N`.
- N is the length of `/articles.json`. The end card is absent until the reader has extended its window to cover all N articles.

- **Reach the end.** Press Down once per step and wait until the printed count changes before the next press. Repeat `node .cursor/skills/verify-eng-shorts/harness.mjs browser press --key ArrowDown` until stdout's count is `N / N`. One more press shows the end card. Run `node .cursor/skills/verify-eng-shorts/harness.mjs browser text --selector ".card.end h2"`. The printed line is `You're caught up.`
- **Opened count.** The end card's excerpt mentions how many titles were opened, which is the number of ids in `read-ids`, not how many cards were scrolled past. Run `node .cursor/skills/verify-eng-shorts/harness.mjs browser text --selector ".card.end .excerpt"`. On a fresh profile the sentence includes `You opened 0.`
- **Back to top.** Choose the button. Run `node .cursor/skills/verify-eng-shorts/harness.mjs browser click --selector ".card.end button"`. The printed count is `1 / N` and the title is the first article again.
- **Proof.** On the end card, before Back to top, run `node .cursor/skills/verify-eng-shorts/harness.mjs browser snapshot --path .cursor/skills/verify-eng-shorts/artifacts/caught-up/end.txt` and `node .cursor/skills/verify-eng-shorts/harness.mjs browser screenshot --path .cursor/skills/verify-eng-shorts/artifacts/caught-up/end.png`. `endTitle` is `You're caught up.`

## Gotchas

- The end card is not in the DOM at launch. The reader starts with ten cards and adds ten when the visible index is within three of that window. `text --selector ".card.end h2"` fails until the window covers the catalog. That failure means the journey has not reached the end, not that the card was removed.
- Do not jump the scroll position from the console. The user path is the forward key, once per post, after the count updates.
- With a catalog of about two hundred posts this journey is a long key sequence. Wait for each count change. Sending the next key early lands on the wrong card when scrolling is animated. The harness turns reduced motion on, which makes each step snap, and the wait is still required so the count has updated.
- Back to top is a `<button>` whose visible name is `Back to top`. The card's other call to action is not a button.
- The opened count stays 0 until a title has been chosen in this profile. Scrolling does not mark posts read.
