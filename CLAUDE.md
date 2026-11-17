# Spaceship IDE — Arabic (RTL) fork

Read `AGENTS.md` first: its code style and workflow rules apply here unchanged.

## What this fork changes

Arabic version of [chuanqisun/spaceship](https://github.com/chuanqisun/spaceship) (MIT). The story column reads right to left.

- `src/text/reading-direction.ts`: `isRtl` comes from the `#text` element's computed `direction`. `screenSwing` flips a future knob's fan, so values run from right (low or first option) to left.
- `src/text/caret.ts`: `Caret.x` is measured from the line's start along the reading direction, so it starts at the right edge in RTL. Everything in caret space (`isAhead`, `layoutLines`, `caretAfterWords`) is direction-free. Convert to page coordinates only through `caretAt` and `pointAt`.
- `src/text/future-hud.ts`: the arc sweep flags mirror with `isRtl`, so the rim stays below the knob.
- `index.html`: `#text` and the keys dialog carry `dir="rtl"`. The page itself stays LTR, so absolutely positioned layers keep their left/top origin. Mixed Arabic and number labels use `unicode-bidi: plaintext`.
- The font stack is JetBrains Mono for Latin and digits, then IBM Plex Sans Arabic. `main.ts` loads the Arabic face by sample text before pretext measures.
- The rail stays left of the column, at the line ends. Pinned future knobs stay in the right gutter, beside each sentence's start.
- The simulator, story openings, dimensions, tray and dialog are in Arabic. Story prompts ask for Modern Standard Arabic, and the live dimension catalog is in Arabic.

## Status

- Phase 1, direction: done and checked with Playwright screenshots in sim mode.
- Phase 2, model quality in Arabic: not started. The remaining prompts (`live-attention`, `live-influence`, `live-realization`, `live-relevance`, and most of `live-completion`) are still English and untested on Arabic text. Cerebras models may be weak in Arabic.

## Checking direction changes

Run `npm run dev -- --port 5280`, then drive the page in sim mode with Playwright (`playwright-core` is a dev dependency): drag `#pointer` left and down, double-click it for attention boxes, and double-click and hold for the fan. Take screenshots and look at them. Type checks alone do not catch RTL layout bugs.
