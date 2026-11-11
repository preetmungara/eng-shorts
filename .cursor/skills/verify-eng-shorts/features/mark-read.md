# Mark a post read

Choosing a post's title marks it read, shows a read tag on the card, and remembers that id in the browser.

## Sub-features

- `mark-click` marks the open post when its title link is chosen.
- `mark-persist` stores that article id in `read-ids` for this origin.

## How to get to it (user POV)

- Choose the post title. The link covers the card, so a click on the card hits the title.
- Press `Enter` while focus is on the document body. That activates the same link for the post on screen.

## Driving it with harness.mjs

Preconditions:

- Doctor passed on a fresh profile, so `read-ids` is empty and the first card is not read.
- `check-start` shows the first article. Note its id from `/articles.json`.

- **Click the title.** Choose the open post's title. Run `node .cursor/skills/verify-eng-shorts/harness.mjs browser click --selector "article.card:not(.end) h2 a"`. The printed line includes `read true`, `readTag read`, and a `read-ids` JSON array containing the open article's id.
- **Stored id.** Read the store back. Run `node .cursor/skills/verify-eng-shorts/harness.mjs browser eval --expression "localStorage.getItem('read-ids')"`. The printed JSON array contains that same id and no others on a fresh profile.
- **Proof.** Capture the marked card. Run `node .cursor/skills/verify-eng-shorts/harness.mjs browser snapshot --path .cursor/skills/verify-eng-shorts/artifacts/mark-read/marked.txt` and `node .cursor/skills/verify-eng-shorts/harness.mjs browser screenshot --path .cursor/skills/verify-eng-shorts/artifacts/mark-read/marked.png`. The snapshot has `read: true` and `readTag: read`.

## Gotchas

- The title link uses `target="_blank"`. The publisher page is not part of the proof. The proof is the tag and `read-ids` on the reader. The publisher does not have to load.
- `read-ids` is per origin. The harness profile is `http://127.0.0.1:<port>` and starts empty. The user's everyday browser is a different profile. Do not drive that one.
- A value in `read-ids` that is not JSON is ignored and the reader shows nothing as read. The fresh profile does not hit this.
- Clicking the title moves focus onto the link. A later `Enter` is not the body-focus shortcut until focus returns to the body.
- Cleanup deletes the harness profile. It does not delete the snapshot or screenshot.
