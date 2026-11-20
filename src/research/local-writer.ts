import { streamLocal } from "../llm/local.ts"
import { controlLine } from "./controls.ts"
import type { Ask } from "./live-writer.ts"
import type { Citation, Claim, Gap, Writer, WriteRequest } from "./writer.ts"

/** A local model's context is small, so only the end of the draft is sent. */
const DRAFT_CHARS = 3000

/**
 * A local model has no citation feature, so it is asked to copy the words it relies on after each sentence. `checked` then looks each copy up in
 * the passages, and a sentence whose copy is not found is unsupported, however confident it reads.
 */
const SYSTEM_PROMPT = `
You help a researcher write from their own sources. The user message holds numbered PASSAGES from those sources, then a REQUEST and the DRAFT so far.

Use the passages alone: no outside knowledge, and no fact, name, number, date or reference that a passage does not state. An unsupported sentence in a thesis is worse than a missing one.

Write the next paragraph of the draft, 3 to 6 sentences, in the language of the draft, or of the request when the draft is empty. Say things in your own words and connect them; do not copy a passage's sentences. Do not repeat what the draft already says. If the draft stops in the middle of a sentence, finish that sentence first.

Output each sentence as these lines and nothing else:

S: the sentence
Q: [passage number] an exact, unbroken copy of 5 to 25 consecutive words from that passage that state what the sentence says

Add a second Q line when a second passage backs the same sentence. Copy the quoted words exactly as they stand in the passage, in its language.

The user message may also hold POINT, the one thing this paragraph establishes, and OUTLINE, the whole plan it belongs to: write this point only. KEY PHRASES are phrases of the draft to develop. CONTROLS sets how the paragraph reads; controls change wording and emphasis only, never the facts.

When the passages do not support the request or the point, write the supported sentences, if any, then end with:

MISSING: what evidence is missing, described as the kind of source that would hold it, in the draft's language. Do not name a specific title or author.
SEARCH: 3 to 6 keywords for finding such a source

EXAMPLE
S: اعتمد سكان الساحل في معيشتهم على البحر، فكانوا يقضون نصف العام في الغوص على اللؤلؤ.
Q: [1] ويجوبون مياهه طيلة نصف العام بحثاً عن اللؤلؤ
`.trim()

export const localWriter: Writer = async function* (request, signal) {
  let sentence = ""
  let citations: Citation[] = []
  let missing = ""
  let searchTerms = ""

  for await (const line of linesOf(streamLocal({ system: SYSTEM_PROMPT, user: taskOf(request), signal }))) {
    const [, label, body] = line.match(/^[\s*_]*(S|Q|MISSING|SEARCH)[\s*_]*:[\s*_]*(.*)$/) ?? []
    if (!body) continue
    if (label === "S") {
      if (sentence) yield claimOf(sentence, citations)
      sentence = body.trim()
      citations = []
    }
    if (label === "Q") {
      const [, number, quote] = body.match(/^\[?(\d+)\]?\s*(.+)$/) ?? []
      if (quote) citations.push({ passage: Number(number) - 1, quote: quote.trim().replace(/^["«“]|["»”]$/g, "") })
    }
    if (label === "MISSING") missing = body.trim()
    if (label === "SEARCH") searchTerms = body.trim()
  }
  if (sentence) yield claimOf(sentence, citations)
  if (missing) yield { kind: "gap", missing, searchTerms } satisfies Gap
}

/** Sends one request and returns the whole reply, for planning and checking. */
export const localAsk: Ask = async (system, user, signal) => {
  let reply = ""
  for await (const delta of streamLocal({ system, user, signal })) reply += delta
  return reply
}

function claimOf(sentence: string, citations: Citation[]): Claim {
  return { kind: "claim", sentence, citations }
}

function taskOf({ draft, instruction, point, outline, passages, leads, controls }: WriteRequest) {
  const sections = [
    ["PASSAGES", passages.map(({ source, page, text }, i) => `[${i + 1}] (${source}، ص ${page}) ${text}`).join("\n\n")],
    ["OUTLINE", (outline ?? []).map((claim, i) => `${i + 1}. ${claim}`).join("\n")],
    ["POINT", point ?? ""],
    ["KEY PHRASES", leads.join("\n")],
    ["CONTROLS", controls.map(controlLine).join("\n")],
    ["REQUEST", instruction || "Continue the draft."],
    ["DRAFT", draft.slice(-DRAFT_CHARS) || "(empty)"],
  ]
  return sections
    .filter(([, body]) => body)
    .map(([header, body]) => `${header}\n${body}`)
    .join("\n\n")
}

async function* linesOf(deltas: AsyncIterable<string>) {
  let buffer = ""
  for await (const delta of deltas) {
    const lines = (buffer + delta).split("\n")
    buffer = lines.pop()!
    yield* lines
  }
  yield buffer
}
