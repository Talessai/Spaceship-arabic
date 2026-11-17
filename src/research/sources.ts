export const MAX_SOURCES = 30
/** Below this a draft only restates its sources. */
export const MIN_SOURCES = 3

const MAX_PASSAGE_WORDS = 120
const PAGE_MARKER = /<!-- page (\d+)([^>]*) -->/g

export type Source = { title: string; passages: Passage[]; unreadablePages: number[] }

/** A stretch of one page of a source, short enough to quote from and to cite by page. */
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
    passages: pages.filter(({ flag }) => flag !== "needs-ocr").flatMap(({ page, text }) => passagesOf(text).map((text) => ({ source: title, page, text }))),
    unreadablePages: pages.filter(({ flag }) => flag === "needs-ocr").map(({ page }) => page),
  }
}

/** Packs the page's paragraphs into passages of at most `MAX_PASSAGE_WORDS`; a longer paragraph is split at its sentences. */
function passagesOf(pageText: string) {
  const pieces = pageText
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .replace(/^#+\s*/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .flatMap((paragraph) => (wordCount(paragraph) > MAX_PASSAGE_WORDS ? (paragraph.match(/[^.!?؟]+[.!?؟]*\s*/g) ?? [paragraph]) : [paragraph]))

  return pieces.reduce<string[]>((passages, piece) => {
    const last = passages.at(-1)
    const fits = last !== undefined && wordCount(last) + wordCount(piece) <= MAX_PASSAGE_WORDS
    return fits ? [...passages.slice(0, -1), `${last} ${piece.trim()}`] : [...passages, piece.trim()]
  }, [])
}

function wordCount(text: string) {
  return text.match(/\S+/g)?.length ?? 0
}
