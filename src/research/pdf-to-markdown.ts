/**
 * Converts a PDF to Markdown with a page marker before each page, for `sources.ts` to read as a source. Runs in the browser, when a PDF is added on
 * the research page, and in Node, from `scripts/sources/pdf-to-markdown.mjs`.
 *
 * Arabic PDFs from layout tools keep their text in drawing order: ligature letters come out reversed, kashida justification is stored as tatweel, and
 * runs on one line are stored out of order. Each line is rebuilt from where its glyphs sit on the page instead. A page whose glyphs have no Unicode
 * mapping cannot be repaired from the text layer: it is marked `needs-ocr`. A page with almost no text, such as a picture, is marked `no-text`.
 */
import type { Page } from "mupdf"

const MIN_LETTERS_PER_PAGE = 20
const HEADING_SCALE = 1.25
const MAX_HEADING_WORDS = 8
/** A block this long that stops without closing punctuation is a paragraph cut by the layout, so the next block continues it. */
const MIN_WORDS_TO_CONTINUE = 6
const TIE = 0.25
/** Text this much smaller than the body is a footnote; a glyph this much smaller than its line is a footnote's reference mark. */
const FOOTNOTE_SCALE = 0.8
const MARK_SCALE = 0.7
const FOOTNOTE_PREFIX = "[حاشية] "
/**
 * Some fonts map a two-letter ligature to a space carrying its second letter twice, so the first letter is lost. These are the ligatures seen
 * stored that way, by the letter that comes out doubled.
 */
const LOST_LIGATURES: Record<string, string> = { ن: "ين", ا: "لا" }
const UNMAPPED_GLYPH = "\uFFFD"
const ENDS_CLOSED = /[.!?؟:،؛»”")\]]$/
const PAGE_NUMBER = /^[0-9٠-٩\s]+$/

/** What a PDF came out as: its Markdown, and the pages that could not be read or hold no text, by number. */
export type Conversion = { markdown: string; pageCount: number; needsOcr: number[]; noText: number[] }

type Glyph = { char: string; size: number; left: number; right: number; index: number }
type Line = { text: string; size: number }
type Block = { lines: Line[] }

/** Converts a PDF. The PDF library is large, so it is loaded here, the first time a PDF is converted. */
export async function markdownOf(pdf: Uint8Array): Promise<Conversion> {
  const mupdf = await import("mupdf")
  const doc = mupdf.Document.openDocument(pdf, "application/pdf")
  const pageCount = doc.countPages()
  const pages = Array.from({ length: pageCount }, (_, i) => blocksOf(doc.loadPage(i)))
  const bodySize = median(pages.flatMap((blocks) => blocks.flatMap(({ lines }) => lines.map(({ size }) => size))))
  const needsOcr: number[] = []
  const noText: number[] = []

  const sections = pages.map((blocks, i) => {
    const text = joined(blocks.map((block) => paragraphOf(block, bodySize)).filter(Boolean))
      .flatMap((paragraph) => (paragraph.startsWith(FOOTNOTE_PREFIX) ? footnotesOf(paragraph) : [paragraph]))
      .join("\n\n")
    const flag = text.includes(UNMAPPED_GLYPH) ? "needs-ocr" : (text.match(/\p{L}/gu)?.length ?? 0) < MIN_LETTERS_PER_PAGE ? "no-text" : ""
    if (flag) (flag === "needs-ocr" ? needsOcr : noText).push(i + 1)
    return `<!-- page ${i + 1}${flag && ` ${flag}`} -->\n\n${text}`
  })

  return { markdown: `${sections.join("\n\n")}\n`, pageCount, needsOcr, noText }
}

/** Joins each paragraph the layout cut into several blocks. */
function joined(paragraphs: string[]) {
  return paragraphs.reduce((all, paragraph) => {
    const last = all.at(-1)
    const isSameKind = last?.startsWith(FOOTNOTE_PREFIX) === paragraph.startsWith(FOOTNOTE_PREFIX)
    const continues = last && isSameKind && !last.startsWith("## ") && !ENDS_CLOSED.test(last) && last.split(" ").length >= MIN_WORDS_TO_CONTINUE
    return continues ? [...all.slice(0, -1), `${last} ${paragraph.replace(/^## /, "").replace(FOOTNOTE_PREFIX, "")}`] : [...all, paragraph]
  }, [] as string[])
}

function blocksOf(page: Page): Block[] {
  const blocks: Block[] = []
  let line: { glyphs: Glyph[]; size: number } = { glyphs: [], size: 0 }
  page.toStructuredText("preserve-whitespace").walk({
    beginTextBlock: () => void blocks.push({ lines: [] }),
    beginLine: () => void (line = { glyphs: [], size: 0 }),
    onChar(char, _origin, _font, size, quad) {
      const xs = [quad[0], quad[2], quad[4], quad[6]]
      line.glyphs.push({ char, size, left: Math.min(...xs), right: Math.max(...xs), index: line.glyphs.length })
      line.size = Math.max(line.size, size)
    },
    endLine: () => void blocks.at(-1)!.lines.push({ text: lineText(withoutMarks(line)), size: line.size }),
  })
  return blocks
}

/** Blanks the small raised glyphs of a footnote reference, whose digits often have no usable Unicode mapping. */
function withoutMarks({ glyphs, size }: { glyphs: Glyph[]; size: number }) {
  return glyphs.map((glyph) => (glyph.size >= size * MARK_SCALE ? glyph : { ...glyph, char: " " }))
}

/** A block of footnotes holds several, each opened by its reference mark, which comes out as brackets around a digit or nothing. */
function footnotesOf(paragraph: string) {
  return paragraph
    .slice(FOOTNOTE_PREFIX.length)
    .split(/\(\s*[\d٠-٩]*\s*\(+/)
    .map((note) => note.trim())
    .filter(Boolean)
    .map((note) => `${FOOTNOTE_PREFIX}${note}`)
}

function paragraphOf({ lines }: Block, bodySize: number) {
  const text = clean(lines.map(({ text }) => text).join(" "))
  if (!text || PAGE_NUMBER.test(text)) return ""
  const size = Math.max(...lines.map(({ size }) => size))
  if (size <= bodySize * FOOTNOTE_SCALE) return `${FOOTNOTE_PREFIX}${text.replace(/^[(\s\d٠-٩)]+/, "")}`
  const isHeading = size >= bodySize * HEADING_SCALE && text.split(" ").length <= MAX_HEADING_WORDS && /\p{L}/u.test(text) && !ENDS_CLOSED.test(text)
  return isHeading ? `## ${text}` : text
}

/** A line with Arabic in it is read off the page from right to left; any other line keeps its stored order. */
function lineText(glyphs: Glyph[]) {
  if (!glyphs.some(({ char }) => isArabic(char))) return glyphs.map(({ char }) => char).join("")
  const visual = withLostLigatures(glyphs)
    .filter(({ char }) => char !== "ـ")
    .sort(byReadingOrder)
  return withLtrRunsRestored(visual.map(({ char }) => char).join(""))
}

/** Puts back each ligature stored as a wide space followed by its second letter twice at no width. */
function withLostLigatures(glyphs: Glyph[]) {
  return glyphs.flatMap((glyph, i) => {
    const [next, after] = [glyphs[i + 1], glyphs[i + 2]]
    const isDoubled = (a?: Glyph, b?: Glyph) => a !== undefined && b !== undefined && a.char === b.char && a.char in LOST_LIGATURES && isThin(a) && isThin(b)
    if (glyph.char === " " && !isThin(glyph) && isDoubled(next, after)) return [{ ...glyph, char: LOST_LIGATURES[next.char] }]
    if (isThin(glyph) && (isDoubled(glyph, next) || isDoubled(glyphs[i - 1], glyph)) && glyphs[i - (isDoubled(glyph, next) ? 1 : 2)]?.char === " ") return []
    return [glyph]
  })
}

function isThin({ left, right }: Glyph) {
  return right - left <= TIE
}

/**
 * Rightmost glyph first. A ligature is stored as its wide glyph preceded by zero-width letters at its right edge, in reverse: they follow it, last
 * stored first. A mark sits at the left edge of its base and follows it too, ahead of the next glyph that starts there.
 */
function byReadingOrder(a: Glyph, b: Glyph) {
  if (Math.abs(a.right - b.right) > TIE) return b.right - a.right
  const rank = (glyph: Glyph) => (isMark(glyph.char) ? 0 : glyph.right - glyph.left > TIE ? 1 : 2)
  if (rank(a) !== rank(b)) return rank(a) - rank(b)
  return rank(a) === 2 ? b.index - a.index : a.index - b.index
}

/** Numbers and Latin words read left to right inside the line, so reading them off right to left reversed them. */
function withLtrRunsRestored(text: string) {
  return text
    .replace(/[0-9٠-٩]+(?:[.,:/٫٬][0-9٠-٩]+)*/g, reversed)
    .replace(/[A-Za-z][A-Za-z0-9 .,:;'"&@/()-]*[A-Za-z0-9]|[A-Za-z]/g, (run) => reversed(run).replace(/[0-9]+/g, reversed))
}

function clean(text: string) {
  return text
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .replace(/[ﭐ-﷿ﹰ-﻿]/g, (form) => form.normalize("NFKC"))
    .replace(/\s+/g, " ")
    .replace(/ ([،؛.!؟:])/g, "$1")
    .trim()
}

function reversed(text: string) {
  return [...text].reverse().join("")
}

function isArabic(char: string) {
  return /[؀-ۿﭐ-﷿ﹰ-﻿]/.test(char)
}

function isMark(char: string) {
  return /\p{M}/u.test(char)
}

function median(values: number[]) {
  return values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0
}
