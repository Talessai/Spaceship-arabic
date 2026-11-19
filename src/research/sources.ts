export const MAX_SOURCES = 30
/** Below this a draft only restates its sources. */
export const MIN_SOURCES = 3

const MAX_PASSAGE_WORDS = 120
/** How `scripts/sources/pdf-to-markdown.mjs` opens a footnote paragraph. */
const FOOTNOTE_PREFIX = "[حاشية] "
const FOOTNOTE_LABEL = " (حاشية)"
const PAGE_MARKER = /<!-- page (\d+)([^>]*) -->/g

export type Source = { title: string; passages: Passage[]; unreadablePages: number[] }

/** A stretch of one page of a source, short enough to quote from and to cite by page. A footnote is its own passage, with its source labelled as one, so its words are never cited as the body's. */
export type Passage = { source: string; page: number; text: string }

/**
 * Reads Markdown as a source. Text after a `<!-- page N -->` marker belongs to that page; text without markers is page 1. Pages marked `needs-ocr`
 * are left out and reported, since their text is not what the page says.
 */
export function sourceOf(title: string, markdown: string): Source {
  const marks = [...markdown.matchAll(PAGE_MARKER)]
  const pages = marks.length
    ? marks.map((mark, i) => ({ page: Number(mark[1]), flag: mark[2].trim(), text: markdown.slice(mark.index + mark[0].length, marks[i + 1]?.index) }))
    : [{ page: 1, flag: "", text: markdown }]

  return {
    title,
    passages: pages
      .filter(({ flag }) => flag !== "needs-ocr")
      .flatMap(({ page, text }) => [
        ...passagesOf(paragraphsOf(text).filter((paragraph) => !paragraph.startsWith(FOOTNOTE_PREFIX))).map((text) => ({ source: title, page, text })),
        ...paragraphsOf(text)
          .filter((paragraph) => paragraph.startsWith(FOOTNOTE_PREFIX))
          .map((paragraph) => ({ source: `${title}${FOOTNOTE_LABEL}`, page, text: paragraph.slice(FOOTNOTE_PREFIX.length) })),
      ]),
    unreadablePages: pages.filter(({ flag }) => flag === "needs-ocr").map(({ page }) => page),
  }
}

function paragraphsOf(pageText: string) {
  return pageText
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .replace(/^#+\s*/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
}

/** Packs paragraphs into passages of at most `MAX_PASSAGE_WORDS`; a longer paragraph is split at its sentences. */
function passagesOf(paragraphs: string[]) {
  const pieces = paragraphs.flatMap((paragraph) =>
    wordCount(paragraph) > MAX_PASSAGE_WORDS ? (paragraph.match(/[^.!?؟]+[.!?؟]*\s*/g) ?? [paragraph]) : [paragraph],
  )

  return pieces.reduce<string[]>((passages, piece) => {
    const last = passages.at(-1)
    const fits = last !== undefined && wordCount(last) + wordCount(piece) <= MAX_PASSAGE_WORDS
    return fits ? [...passages.slice(0, -1), `${last} ${piece.trim()}`] : [...passages, piece.trim()]
  }, [])
}

function wordCount(text: string) {
  return text.match(/\S+/g)?.length ?? 0
}
