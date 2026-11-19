/**
 * Measures a text copied from the tool against the sources it was written from, to compare versions of the writer on the same topic.
 *
 *   node scripts/research/output-metrics.mjs <output.txt> <source.md>...
 *
 * Reports sentences without a reference, sentences that repeat an earlier one, sentences that open on a relative word (a cut sentence), the
 * share of the text lifted from the sources word for word, and leftovers of a damaged extraction.
 */
import { readFileSync } from "node:fs"

const SHINGLE_WORDS = 6
const REPEAT_SHARE = 0.6
const [outputPath, ...sourcePaths] = process.argv.slice(2)
if (!outputPath) {
  console.error("usage: node scripts/research/output-metrics.mjs <output.txt> <source.md>...")
  process.exit(1)
}

const body = readFileSync(outputPath, "utf8").split(/\n\s*المراجع\s*\n/)[0]
const sentences =
  body
    .match(/[^.!?؟]+[.!?؟]*(?:\s*\[[\d؟]+\])*/g)
    ?.map((sentence) => sentence.trim())
    .filter((sentence) => wordsOf(sentence).length >= 4) ?? []
const sourceShingles = new Set(sourcePaths.flatMap((path) => shinglesOf(readFileSync(path, "utf8"))))

const seen = []
let repeated = 0
let lifted = 0
let shingles = 0
for (const sentence of sentences) {
  const own = shinglesOf(sentence)
  if (own.length && seen.some((earlier) => own.filter((shingle) => earlier.has(shingle)).length / own.length >= REPEAT_SHARE)) repeated++
  seen.push(new Set(own))
  shingles += own.length
  lifted += own.filter((shingle) => sourceShingles.has(shingle)).length
}

console.table({
  sentences: sentences.length,
  "without a reference": sentences.filter((sentence) => !/\[\d+\]/.test(sentence)).length,
  "marked unsupported [؟]": sentences.filter((sentence) => sentence.includes("[؟]")).length,
  "repeating an earlier one": repeated,
  "opening on a relative word": (body.match(/(?:^|[.!?؟\]]\s*)(?:التي|الذي|الذين|اللذين|اللتين|اللواتي)\s/g) ?? []).length,
  "lifted word for word (%)": sourcePaths.length && shingles ? Math.round((100 * lifted) / shingles) : "no sources given",
  "extraction leftovers": (body.match(/ (نن|اا)(?=\S| )|\(\s*[\d٠-٩]*\s*\(+/g) ?? []).length,
})

function shinglesOf(text) {
  const words = wordsOf(text)
  return words.slice(0, Math.max(0, words.length - SHINGLE_WORDS + 1)).map((_, i) => words.slice(i, i + SHINGLE_WORDS).join(" "))
}

/** Words as they compare across a source and a copy of it: no reference marks, diacritics, tatweel, punctuation or hamza variants. */
function wordsOf(text) {
  return text
    .replace(/\[[\d؟]+\]/g, " ")
    .normalize("NFKC")
    .replace(/[\p{M}ـ]/gu, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
}
