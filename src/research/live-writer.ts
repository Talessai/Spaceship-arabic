import Anthropic from "@anthropic-ai/sdk"
import { claudeClient, storedClaudeKey } from "../llm/claude.ts"
import type { Claim, Gap, Writer, WriteRequest } from "./writer.ts"

const MODEL = "claude-opus-5-5"
const DRAFT_TAIL_CHARS = 1500
/** Uncited text this short between two cited sentences is a connective, not a claim of its own. */
const MAX_CONNECTIVE_WORDS = 4

const SYSTEM_PROMPT = `
You help a researcher write from their own sources. The user message holds the sources as documents, then a REQUEST and the end of the DRAFT so far.

The researcher will only keep sentences that cite a document, because an unsupported sentence in a thesis is worse than a missing one. So use the documents alone: no outside knowledge, and no fact, name, number, date or reference that a document does not state.

Write the next 2 to 5 sentences of the draft that answer the request, as plain prose without headings, lists or markdown. Write in the language of the draft, or of the request when the draft is empty; a document may be in another language. Every sentence must cite the document that supports it.

When the documents do not support the request, or support only part of it, leave the gap open: write the supported sentences, if any, then end with these two lines.

MISSING: what evidence is missing, described as the kind of source that would hold it (for example a field study of X after year Y), in the draft's language. Do not name a specific title or author, since you cannot check that it exists.
SEARCH: 3 to 6 keywords for finding such a source
`.trim()

type Block = Anthropic.Beta.BetaContentBlock

/** Each passage goes in as its own document with citations on, so every cited sentence comes back with the passage's exact words and its number. */
export const liveWriter: Writer = async function* (request, signal) {
  const apiKey = storedClaudeKey()
  if (!apiKey) throw new Error("احفظ مفتاح Claude أولاً")

  const message = await claudeClient(apiKey)
    .beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: [...documentsOf(request), { type: "text", text: taskOf(request) }] }],
      },
      { signal },
    )
    .finalMessage()

  if (message.stop_reason === "refusal") throw new Error("رفض النموذج هذا الطلب.")
  yield* resultsOf(message.content)
}

function documentsOf({ passages }: WriteRequest): Anthropic.Beta.BetaRequestDocumentBlock[] {
  return passages.map(({ source, page, text }) => ({
    type: "document",
    source: { type: "text", media_type: "text/plain", data: text },
    title: `${source}، ص ${page}`,
    citations: { enabled: true },
  }))
}

function taskOf({ draft, instruction }: WriteRequest) {
  return `REQUEST\n${instruction || "Continue the draft."}\n\nDRAFT\n${draft.slice(-DRAFT_TAIL_CHARS)}`
}

/** A cited block is a claim; uncited prose is a claim with no quote, which the check then rejects, unless it only joins two cited blocks. */
function* resultsOf(content: Block[]): Generator<Claim | Gap> {
  let claim: Claim | undefined
  let uncited = ""
  for (const block of content) {
    if (block.type !== "text") continue
    const citation = block.citations?.find((citation) => citation.type === "char_location")
    if (!citation) {
      uncited += block.text
      continue
    }
    const { prose } = partsOf(uncited)
    const isConnective = wordCount(prose) <= MAX_CONNECTIVE_WORDS
    if (claim && !isConnective) {
      yield claim
      yield { kind: "claim", sentence: prose.trim(), passage: -1, quote: "" }
      claim = undefined
    }
    const lead = isConnective ? prose : ""
    if (claim && endsSentence(claim.sentence + lead)) {
      yield { ...claim, sentence: (claim.sentence + lead).trim() }
      claim = undefined
    }
    const sentence = claim ? claim.sentence + lead + block.text : (lead + block.text).trimStart()
    claim = { kind: "claim", sentence, passage: claim?.passage ?? citation.document_index, quote: claim?.quote ?? citation.cited_text.trim() }
    uncited = ""
  }

  const { prose, gap } = partsOf(uncited)
  if (claim) yield { ...claim, sentence: (claim.sentence + (wordCount(prose) <= MAX_CONNECTIVE_WORDS ? prose : "")).trim() }
  if (wordCount(prose) > MAX_CONNECTIVE_WORDS) yield { kind: "claim", sentence: prose.trim(), passage: -1, quote: "" }
  if (gap) yield gap
}

/** Splits uncited text into its prose and the MISSING and SEARCH lines, if any. */
function partsOf(text: string): { prose: string; gap?: Gap } {
  const missing = text.match(/^\s*MISSING:\s*(.+)$/m)?.[1]
  const searchTerms = text.match(/^\s*SEARCH:\s*(.+)$/m)?.[1] ?? ""
  const prose = text.replace(/^\s*(MISSING|SEARCH):.*$/gm, "").replace(/\s+/g, " ")
  return { prose: prose.trim() ? prose : "", gap: missing ? { kind: "gap", missing: missing.trim(), searchTerms: searchTerms.trim() } : undefined }
}

function endsSentence(text: string) {
  return /[.!?؟]["»”)]?\s*$/.test(text)
}

function wordCount(text: string) {
  return text.match(/\S+/g)?.length ?? 0
}
