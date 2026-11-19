/**
 * Converts PDFs to Markdown with a page marker before each page, for the research page to load as sources. The page converts a PDF itself when one
 * is added; this does the same from the command line, for many files or for looking at the Markdown.
 *
 *   node scripts/sources/pdf-to-markdown.mjs <file.pdf>... [--out sources]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { markdownOf } from "../../src/research/pdf-to-markdown.ts"

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
  const { markdown, pageCount, needsOcr, noText } = await markdownOf(readFileSync(file))
  const target = join(outDir, `${basename(file, ".pdf")}.md`)
  writeFileSync(target, markdown)
  console.log(`${target}: ${pageCount} pages, ${listed(needsOcr)} need OCR, ${listed(noText)} without text`)
}

function listed(pages) {
  return pages.length ? `${pages.length} (${pages.join(", ")})` : "0"
}
