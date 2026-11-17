import { storedApiKey, streamCompletion } from "../llm/cerebras.ts"
import type { Claim, Gap, Writer, WriteRequest } from "./writer.ts"

const DRAFT_TAIL_CHARS = 1500

const SYSTEM_PROMPT = `
You help write a research text using ONLY the numbered PASSAGES in the user message. You know nothing else: never use outside knowledge, never invent a fact, name, number, date or reference.

Write the next 2 to 5 sentences of the DRAFT that answer the REQUEST. Write in the language of the draft, or of the request when the draft is empty. Each sentence must be fully supported by one passage. For every sentence output exactly two lines:

S: the sentence
Q: [passage number] an exact, unbroken copy of 5 to 25 consecutive words from that passage that support the sentence, in the passage's own language, unchanged

A passage may be in another language than the draft: write the sentence in the draft's language and copy the quote in the passage's language.

If the passages do not support an answer, or support only part of it, do not fill the gap. Output these two lines instead of, or after, the supported sentences:

MISSING: what evidence is missing, as the kind of source that would hold it (for example a field study of X after year Y), in the draft's language. Never name a specific title or author.
SEARCH: 3 to 6 search keywords for finding such a source

Output only these lines. No markdown, no commentary.

EXAMPLE
User:
PASSAGES
[1] يعيش سكان قطر أساساً في البحر، ويجوبون مياهه طيلة نصف العام بحثاً عن اللؤلؤ، والنصف الآخر في التجارة.
[2] The town had two mosques and a small square fort.

REQUEST
اكتب عن مصادر دخل السكان وعدد سكان المدينة.

DRAFT
Assistant:
S: اعتمد سكان قطر في معيشتهم على البحر، فكانوا يقضون نصف العام في الغوص على اللؤلؤ.
Q: [1] ويجوبون مياهه طيلة نصف العام بحثاً عن اللؤلؤ
S: أما النصف الآخر من العام فكانوا يقضونه في التجارة.
Q: [1] والنصف الآخر في التجارة
MISSING: لا تذكر المقاطع عدد سكان المدينة؛ يلزم مصدر إحصائي أو تقرير رحالة يقدّر عدد السكان في تلك الفترة.
SEARCH: عدد سكان الدوحة القرن التاسع عشر تقديرات
`.trim()

export const liveWriter: Writer = async function* (request, signal) {
  const apiKey = storedApiKey()
  if (!apiKey) throw new Error("احفظ مفتاح النموذج أولاً")

  const deltas = streamCompletion({ apiKey, system: SYSTEM_PROMPT, user: userMessageOf(request), temperature: 0.2, maxCompletionTokens: 3000, signal })
  let sentence = ""
  let missing = ""
  for await (const line of linesOf(deltas)) {
    const [, label, body] = line.match(/^\s*(S|Q|MISSING|SEARCH):\s*(.*)$/) ?? []
    if (!body) continue
    if (label === "S") sentence = body
    if (label === "MISSING") missing = body
    if (label === "Q" && sentence) {
      const claim = claimOf(sentence, body)
      if (claim) yield claim
      sentence = ""
    }
    if (label === "SEARCH" && missing) {
      yield { kind: "gap", missing, searchTerms: body } satisfies Gap
      missing = ""
    }
  }
  if (missing) yield { kind: "gap", missing, searchTerms: "" }
}

function claimOf(sentence: string, citation: string): Claim | undefined {
  const [, number, quote] = citation.match(/^\[(\d+)\]\s*(.+)$/) ?? []
  if (quote) return { kind: "claim", sentence, passage: Number(number) - 1, quote: quote.replace(/^["«“]|["»”]$/g, "") }
}

function userMessageOf({ draft, instruction, passages }: WriteRequest) {
  const numbered = passages.map(({ text }, i) => `[${i + 1}] ${text}`).join("\n")
  return `PASSAGES\n${numbered}\n\nREQUEST\n${instruction || "Continue the draft."}\n\nDRAFT\n${draft.slice(-DRAFT_TAIL_CHARS)}`
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
