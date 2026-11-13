---
name: verify-feed-keep
description: Exhaustively check keep() in scripts/collect.ts, the filter that decides which posts reach Eng Shorts. Use when changing keep(), MIXED, or the HARD_BLOCK, MARKETING, TECH, or GENERIC patterns.
---

# Verify the feed filter

`keep()` in `scripts/collect.ts` drops a post that is hard-blocked, drops a generic title from a mixed company feed, keeps a mixed-company post only when its title is technical and its score is at least 3, and keeps any other company's post when its score is at least -1.

A post that should have been dropped shows up in the reader. A marketing or blocked post from a mixed feed costs the feed's trust.

## Coverage

- File: `scripts/collect.ts`
- Function: `keep`
- Constants the check loads with it: `MIXED`, `HARD_BLOCK`, `MARKETING`, `TECH`, `GENERIC`
- Last confirmed the check describes that code: commit `2004e2b02d05f9f3378ef75b00258cc3b6b06735`, extracted-source hash `7a46cbfcc6434ee1`
- Representatives locked by the check: Stripe is mixed, Netflix is trusted

Move the sync commit and the hash forward (`SYNC` and `SOURCE` in `check.mjs`, and the line above) only after you re-read `keep()` at the new commit and the check still describes it. A pass on a stale reading is not a pass on the new code.

## Run

From the repo root:

```
node .cursor/skills/verify-feed-keep/check.mjs
```

Exit 0 prints `keep: pass <n> inputs, source <hash>`. The run is local and does not fetch feeds. Expect it to finish in about a second.

## Reading a result

Exit 1 is a finding. Each `FAIL` block names the company, title, categories, link, whether the body had a code block, and the word count. `keep() returned` is what the code did. `rule says` is what the sentence above requires. Report that counterexample in those words. Do not edit the rule or the fixtures to make a failing `keep()` pass, and do not change `scripts/collect.ts` unless the user asks.

Exit 2 means this skill no longer describes the file: the `MIXED` / `keep()` slice moved, the function failed to load, or a constructed title no longer matches the shape name in `check.mjs`. That is a verifier bug. Fix the verifier, or stop and say the check is stale. Do not call it a feed finding.

The check also warns on stderr when the extracted `MIXED` / `keep()` source no longer hashes to the confirmed hash, or when `scripts/collect.ts` differs from `HEAD`. Commits that leave that slice alone do not warn. It still checks the working tree. Re-read `keep()` before trusting that pass, then move the sync commit only if the check still describes the code.

## Bounds

The check calls the real `keep()` loaded from `scripts/collect.ts`. It does not reimplement the function and compare a copy to itself. The decision formula in `check.mjs` is the rule in the sentence above.

It covers every combination of ten title shapes, a hard-blocked and an open title, Stripe and Netflix, four category classes (none, Engineering, Product, both), a plain body and a `<pre>` body, and word counts 0, 249, 250, 799, and 800, plus five named cases: an engineering URL bonus, a category-only webinar block, and the three examples in the self-check above `keep()`.

No verifier is installed that can prove this TypeScript for every string. The bound is those signals, which are the inputs `keep()` actually branches on. Outside that bound, and not checked here: feed HTTP, the Anthropic page scraper, `excerptOf`, duplicate-URL removal, and `readMins`.

The duplicate-URL removal sits in the same `collect()` loop and is the next property worth a check. It is not covered by this one.

## After the code changes

If the change is supposed to keep the same rule, run the command. A failure is a bug in the change. If the change is supposed to change the rule, update the opening sentence, `expectKeep` in `check.mjs`, and any sentinel that names the old rule, run until exit 0, then move the sync commit and the source hash in this skill.

For a check that has drifted from the code without being re-run, use `/maintain-formal-verification-skill`.
