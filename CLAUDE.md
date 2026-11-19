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

## Phones

Below 720px the story page drops the rail, keeps a narrow left margin and a wider right gutter (`--gutter`) for future knobs and their wrapped labels, and enlarges the knobs. The phone rules sit at the end of the stylesheet so they override the rules above them. Touch drives the page through pointer events. Double presses go through `src/text/double-press.ts`, which reads a finger's double tap from pointer events because not every phone browser sends `dblclick` for touch; `hold.ts` gives touch wider tolerances than a mouse. To test that path, drop native `dblclick` events in an init script. The column lets a finger scroll the page (`touch-action: pan-y`) except on an attention box, and dragging the main knob near the top or bottom of the window scrolls the page (`edge-scroll.ts`), on every device. While no text is shown, `#hint` says how to start (on phones, and in research mode at any width), and the tray drops the speed readings, sound and extras so the way back and the copy button fit. Check with Playwright's `iPhone 13` device and CDP `Input.dispatchTouchEvent`: drag `#pointer`, double tap it, and double tap and hold for the fan.

## Status

- Phase 1, direction: done and checked with Playwright screenshots in sim mode.
- Phase 2, model quality in Arabic: not started. The remaining prompts (`live-attention`, `live-influence`, `live-realization`, `live-relevance`, and most of `live-completion`) are still English and untested on Arabic text. Cerebras models may be weak in Arabic.

## Checking direction changes

Run `npm run dev -- --port 5280`, then drive the page in sim mode with Playwright (`playwright-core` is a dev dependency): drag `#pointer` left and down, double-click it for attention boxes, and double-click and hold for the fan. Take screenshots and look at them. Type checks alone do not catch RTL layout bugs.

## Research page (`research/`)

A page for writing research from the user's own sources only. It is also where sources, the Claude key and the topic are set for the tool's research mode. The model writes whenever a key is saved, however the page was reached; `?sim=true` asks for the simulated writer. The key section is always shown, and its summary says whether a key is saved.

### Research mode of the tool (`?research=true`)

`src/research/tool-source.ts` gives the story page three sources in place of the simulated or live ones: text written from the stored sources, one planned paragraph at a time (`planOutline` reads the 40 passages nearest the topic, at most two a page, and lays out the points; `liveWriter` then writes each point from its own passages with the outline and the whole draft in view), each sentence ending in its reference numbers, or in `[؟]` when no passage backs it; attention boxes on the recent words the sources mention least; and research axes for the fan. Influence, realization and relevance are still the simulated ones, so a knob's "realized" percentage is not real in this mode. Every top-up is a paid request: the buffer past the knob is 60 words instead of 300, and a request that added nothing is not sent again until the text, steering or topic changes. `#notice` above the tray carries what the text cannot: what is missing, or why nothing was written. The tray's copy button puts the shown text and the references its numbers point to on the clipboard. `draft-store.ts` shares the references, topic and the tool's shown text with the research page through localStorage.

- `scripts/sources/pdf-to-markdown.mjs`: PDF to Markdown with `<!-- page N -->` markers, written to `sources/` (git-ignored). Arabic lines are rebuilt from glyph positions, which repairs reversed ligatures, tatweel and run order. A ligature stored as a space carrying its second letter twice is put back from a small table (`LOST_LIGATURES`). Text much smaller than the body is a footnote: its paragraphs open with `[حاشية] ` and its raised reference marks are blanked; `sources.ts` keeps each footnote as its own passage with the source labelled `(حاشية)`. Pages with unmapped glyphs are marked `needs-ocr`; there is no OCR step yet. Tables and multi-box layouts come out in poor order.
- `src/research/sources.ts`: Markdown to passages that keep their page. `retrieval.ts`: BM25 over normalized words, so no cross-language search yet.
- `src/research/writer.ts`: the `Writer` seam (simulated and live) and `checked`, which looks each quote up in the passages. A sentence whose quote is not found cannot be added to the draft. The code checks that the quote exists, not that the sentence follows from it.
- `controls.ts`: the steering form (research axes as sliders and a select) read into `Control`s for the writer. Passages pinned from a result go first in the next request. These stand in for the story page's future knobs and attention lock, as plain touch controls.
- `live-writer.ts` calls Claude through `@anthropic-ai/sdk` from the browser (`src/llm/claude.ts`), with each passage sent as a document with citations on. It streams, yielding each sentence as its block completes. It has only been run against a stand-in for the API (a Playwright route answering with server-sent events), never the real one. The SDK's types pull in Node's, so timers assigned to a `number` in the story page use `window.setTimeout`. Sources are kept in IndexedDB (`source-store.ts`); the draft, references and key are in localStorage.

`scripts/research/output-metrics.mjs` measures a text copied from the tool against its sources: sentences without a reference, repeats, cut sentences, and the share lifted word for word. The first real output, written before the outline, was 84% lifted with 3 repeats in 29 sentences; keep real outputs out of the repository, since they quote the user's books.

Check it at `/research/` with Playwright. Pass files to `setInputFiles` as `{ name, mimeType, buffer }`: paths with Arabic names do not fire the change event here.
