/**
 * Converts PDFs to Markdown with a page marker before each page, for the research page to load as sources.
 *
 *   node scripts/sources/pdf-to-markdown.mjs <file.pdf>... [--out sources]
 *
 * Arabic PDFs from layout tools keep their text in drawing order: ligature letters come out reversed, kashida justification is stored as tatweel, and
 * runs on one line are stored out of order. Each line is rebuilt from where its glyphs sit on the page instead. A page whose glyphs have no Unicode
 * mapping cannot be repaired from the text layer: it is marked `needs-ocr`. A page with almost no text, such as a picture, is marked `no-text`.
 */
import * as mupdf from "mupdf"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"

const MIN_LETTERS_PER_PAGE = 20
const HEADING_SCALE = 1.25
const MAX_HEADING_WORDS = 8
/** A block this long that stops without closing punctuation is a paragraph cut by the layout, so the next block continues it. */
const MIN_WORDS_TO_CONTINUE = 6
const TIE = 0.25
const UNMAPPED_GLYPH = "\uFFFD"
const ENDS_CLOSED = /[.!?؟:،؛»”")\]]$/
const PAGE_NUMBER = /^[0-9٠-٩\s]+$/

const args = process.argv.slice(2)
const outFlag = args.indexOf("--out")
const outDir = outFlag === -1 ? "sources" : args[outFlag + 1]
const files = args.filter((arg, i) => arg.endsWith(".pdf") && i !== outFlag + 1)

if (!files.length) {
  console.error("usage: node scripts/sources/pdf-to-markdown.mjs <file.pdf>... [--out sources]")
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
for (const file of files) {
  const { markdown, pageCount, needsOcr, noText } = convert(readFileSync(file))
  const target = join(outDir, `${basename(file, ".pdf")}.md`)
  writeFileSync(target, markdown)
  console.log(`${target}: ${pageCount} pages, ${listed(needsOcr)} need OCR, ${listed(noText)} without text`)
}

function convert(buffer) {
  const doc = mupdf.Document.openDocument(buffer, "application/pdf")
  const pageCount = doc.countPages()
  const pages = Array.from({ length: pageCount }, (_, i) => blocksOf(doc.loadPage(i)))
  const bodySize = median(pages.flatMap((blocks) => blocks.flatMap(({ lines }) => lines.map(({ size }) => size))))
  const needsOcr = []
  const noText = []

  const sections = pages.map((blocks, i) => {
    const text = joined(blocks.map((block) => paragraphOf(block, bodySize)).filter(Boolean)).join("\n\n")
    const flag = text.includes(UNMAPPED_GLYPH) ? "needs-ocr" : (text.match(/\p{L}/gu)?.length ?? 0) < MIN_LETTERS_PER_PAGE ? "no-text" : ""
    if (flag) (flag === "needs-ocr" ? needsOcr : noText).push(i + 1)
    return `<!-- page ${i + 1}${flag && ` ${flag}`} -->\n\n${text}`
  })

  return { markdown: `${sections.join("\n\n")}\n`, pageCount, needsOcr, noText }
}

function listed(pages) {
  return pages.length ? `${pages.length} (${pages.join(", ")})` : "0"
}

/** Joins each paragraph the layout cut into several blocks. */
function joined(paragraphs) {
  return paragraphs.reduce((all, paragraph) => {
    const last = all.at(-1)
    const continues = last && !last.startsWith("## ") && !ENDS_CLOSED.test(last) && last.split(" ").length >= MIN_WORDS_TO_CONTINUE
    return continues ? [...all.slice(0, -1), `${last} ${paragraph.replace(/^## /, "")}`] : [...all, paragraph]
  }, [])
}

function blocksOf(page) {
  const blocks = []
  let line
  page.toStructuredText("preserve-whitespace").walk({
    beginTextBlock: () => blocks.push({ lines: [] }),
    beginLine: () => (line = { glyphs: [], size: 0 }),
    onChar(char, _origin, _font, size, quad) {
      const xs = [quad[0], quad[2], quad[4], quad[6]]
      line.glyphs.push({ char, left: Math.min(...xs), right: Math.max(...xs), index: line.glyphs.length })
      line.size = Math.max(line.size, size)
    },
    endLine: () => blocks.at(-1).lines.push({ text: lineText(line.glyphs), size: line.size }),
  })
  return blocks
}

function paragraphOf({ lines }, bodySize) {
  const text = clean(lines.map(({ text }) => text).join(" "))
  if (!text || PAGE_NUMBER.test(text)) return ""
  const size = Math.max(...lines.map(({ size }) => size))
  const isHeading = size >= bodySize * HEADING_SCALE && text.split(" ").length <= MAX_HEADING_WORDS && /\p{L}/u.test(text) && !ENDS_CLOSED.test(text)
  return isHeading ? `## ${text}` : text
}

/** A line with Arabic in it is read off the page from right to left; any other line keeps its stored order. */
function lineText(glyphs) {
  if (!glyphs.some(({ char }) => isArabic(char))) return glyphs.map(({ char }) => char).join("")
  const visual = glyphs.filter(({ char }) => char !== "ـ").sort(byReadingOrder)
  return withLtrRunsRestored(visual.map(({ char }) => char).join(""))
}

/**
 * Rightmost glyph first. A ligature is stored as its wide glyph preceded by zero-width letters at its right edge, in reverse: they follow it, last
 * stored first. A mark sits at the left edge of its base and follows it too, ahead of the next glyph that starts there.
 */
function byReadingOrder(a, b) {
  if (Math.abs(a.right - b.right) > TIE) return b.right - a.right
  const rank = (glyph) => (isMark(glyph.char) ? 0 : glyph.right - glyph.left > TIE ? 1 : 2)
  if (rank(a) !== rank(b)) return rank(a) - rank(b)
  return rank(a) === 2 ? b.index - a.index : a.index - b.index
}

/** Numbers and Latin words read left to right inside the line, so reading them off right to left reversed them. */
function withLtrRunsRestored(text) {
  return text
    .replace(/[0-9٠-٩]+(?:[.,:/٫٬][0-9٠-٩]+)*/g, reversed)
    .replace(/[A-Za-z][A-Za-z0-9 .,:;'"&@/()-]*[A-Za-z0-9]|[A-Za-z]/g, (run) => reversed(run).replace(/[0-9]+/g, reversed))
}

function clean(text) {
  return text
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .replace(/[ﭐ-﷿ﹰ-﻿]/g, (form) => form.normalize("NFKC"))
    .replace(/\s+/g, " ")
    .replace(/ ([،؛.!؟:])/g, "$1")
    .trim()
}

function reversed(text) {
  return [...text].reverse().join("")
}

function isArabic(char) {
  return /[؀-ۿﭐ-﷿ﹰ-﻿]/.test(char)
}

function isMark(char) {
  return /\p{M}/u.test(char)
}

function median(values) {
  return values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0
}
