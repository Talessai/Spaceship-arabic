import { searchTerms } from "./arabic.ts"
import type { Writer } from "./writer.ts"

const MAX_CLAIMS = 4
const MIN_SENTENCE_WORDS = 6
const STEP_MS = 250

/** Writes nothing of its own, so controls do not apply: it lifts the sentences of the pinned passages, then those that share the most words with the request, each quoting itself. */
export const simulatedWriter: Writer = async function* ({ draft, instruction, passages, pinned }, signal) {
  const wanted = new Set(searchTerms(instruction || draft))
  const sentences = passages
    .flatMap((passage, index) => (passage.text.match(/[^.!?؟]+[.!?؟]*/g) ?? []).map((sentence) => ({ sentence: sentence.trim(), index })))
    .filter(({ sentence }) => sentence.split(" ").length >= MIN_SENTENCE_WORDS)
    .map((candidate) => ({ ...candidate, overlap: new Set(searchTerms(candidate.sentence).filter((term) => wanted.has(term))).size }))
    .filter(({ overlap, index }) => overlap > 0 || index < pinned)
    .sort((a, b) => Number(b.index < pinned) - Number(a.index < pinned) || b.overlap - a.overlap)
    .slice(0, MAX_CLAIMS)

  if (!sentences.length) {
    yield { kind: "gap", missing: "لا تحتوي المقاطع المسترجعة على جملة تتصل بالطلب.", searchTerms: [...wanted].join(" ") }
    return
  }
  for (const { sentence, index } of sentences) {
    await new Promise((resolve) => setTimeout(resolve, STEP_MS))
    signal.throwIfAborted()
    yield { kind: "claim", sentence, citations: [{ passage: index, quote: sentence }] }
  }
}
