import Anthropic from "@anthropic-ai/sdk"
import { claudeClient, storedClaudeKey } from "../llm/claude.ts"
import { controlLine } from "./controls.ts"
import type { Passage } from "./sources.ts"
import type { Citation, Claim, Gap, Writer, WriteRequest } from "./writer.ts"

const MODEL = "claude-opus-5-5"
/** The draft is sent whole up to this length, so the writer sees what is already said and does not say it again. */
const DRAFT_CHARS = 12000

const SYSTEM_PROMPT = `
You help a researcher write from their own sources. The user message holds the sources as documents, then a REQUEST and the DRAFT so far.

The researcher keeps only what the documents back, because an unsupported sentence in a thesis is worse than a missing one. So use the documents alone: no outside knowledge, and no fact, name, number, date or reference that a document does not state.

Write the next paragraph of the draft, 3 to 6 sentences of plain prose without headings, lists or markdown, in the language of the draft, or of the request when the draft is empty. A document may be in another language.

This is new writing, not a collage. Say things in your own words and connect them: what led to what, what agrees, what differs. Do not copy a document's sentences. A direct quotation is rare, short, exact, and inside quotation marks. Every sentence cites the document or documents behind it, and where several documents say the same thing, say it once and cite them all. Where two documents disagree, give both accounts, each with its citation, and do not choose between them. Keep what a document reports as fact apart from what its author judges or praises: attribute the judgement to the author. A document titled as a footnote (حاشية) is the source's own note, often naming an older work: cite it as a note, and name the older work when you rely on it.

Each sentence must stand complete: it names its subject, and it does not open with a pronoun or relative word whose referent is in a sentence you did not write. The paragraph adds to the draft: do not restate what the draft already says.

The user message may also hold optional sections. POINT is the one thing this paragraph establishes, taken from OUTLINE, which lists the whole plan so you know what the other paragraphs cover: write this point only. PINNED names the documents the researcher fixed in place: build on those first. KEY PHRASES are phrases of the draft the researcher marked: develop them. CONTROLS sets how the paragraph reads, one axis per line with the direction to move in and sometimes how far in parentheses. Controls change wording, order and emphasis only: a more assertive tone still states only what a document states.

When the documents do not support the request or the point, support only part of it, or hold nothing the draft has not already said, leave the gap open: write the supported sentences, if any, then end with these two lines.

MISSING: what evidence is missing, described as the kind of source that would hold it (for example a field study of X after year Y), in the draft's language. Do not name a specific title or author, since you cannot check that it exists.
SEARCH: 3 to 6 keywords for finding such a source
`.trim()

const PLAN_PROMPT = `
You plan a piece of research writing for a researcher who writes only from their own sources. The user message holds numbered PASSAGES from those sources and the TOPIC.

Lay out the paragraphs that the passages can support on this topic, 3 to 8 of them. Order them the way the material calls for: by time for a life or a history, by theme for an analysis. Each paragraph establishes one distinct thing; do not plan two paragraphs that would say the same. Build on passages that carry evidence, such as dates, numbers, documents, named witnesses and quoted originals, before passages that only praise or sum up. Leave out passages that are not about the topic, even if they share its words.

Output one line per paragraph, in order, and nothing else:

POINT: what the paragraph establishes, in the topic's language, in one sentence | the numbers of the passages it rests on, separated by commas

Then, if the topic has a side the passages do not cover, end with:

MISSING: what is not covered, described as the kind of source that would hold it, in the topic's language. Do not name a specific title or author.
`.trim()

/** One planned paragraph: what it establishes and the passages it rests on. */
export type Point = { claim: string; passages: Passage[] }

/** A finished text block of the response: its text, and the document words it cites, if any. */
type Block = { text: string; citation?: Citation }

/** Each passage goes in as its own document with citations on, so every cited sentence comes back with the passage's exact words and its number. */
export const liveWriter: Writer = async function* (request, signal) {
  const stream = clientOrThrow().beta.messages.stream(
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

  yield* resultsOf(blocksOf(stream))
  if ((await stream.finalMessage()).stop_reason === "refusal") throw new Error("رفض النموذج هذا الطلب.")
}

/** Reads the passages once and lays out the paragraphs they can support on the topic, with what the topic asks that they do not cover. */
export async function planOutline(topic: string, passages: Passage[], signal: AbortSignal): Promise<{ points: Point[]; missing: string }> {
  const numbered = passages.map(({ source, page, text }, i) => `[${i + 1}] (${source}، ص ${page}) ${text}`).join("\n\n")
  const message = await clientOrThrow()
    .beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: PLAN_PROMPT,
        messages: [{ role: "user", content: `PASSAGES\n${numbered}\n\nTOPIC\n${topic}` }],
      },
      { signal },
    )
    .finalMessage()
  if (message.stop_reason === "refusal") throw new Error("رفض النموذج هذا الطلب.")

  const lines = message.content.flatMap((block) => (block.type === "text" ? block.text.split("\n") : []))
  const points = lines.flatMap((line): Point[] => {
    const [, claim, numbers] = line.match(/^\s*POINT:\s*(.+?)\s*\|\s*([\d\s,،]+)$/) ?? []
    const rests = (numbers?.match(/\d+/g) ?? []).map((number) => passages[Number(number) - 1]).filter(Boolean)
    return claim && rests.length ? [{ claim, passages: [...new Set(rests)] }] : []
  })
  return { points, missing: lines.map((line) => line.match(/^\s*MISSING:\s*(.+)$/)?.[1]).find(Boolean) ?? "" }
}

function clientOrThrow() {
  const apiKey = storedClaudeKey()
  if (!apiKey) throw new Error("احفظ مفتاح Claude أولاً من صفحة البحث.")
  return claudeClient(apiKey)
}

function documentsOf({ passages }: WriteRequest): Anthropic.Beta.BetaRequestDocumentBlock[] {
  return passages.map(({ source, page, text }) => ({
    type: "document",
    source: { type: "text", media_type: "text/plain", data: text },
    title: `${source}، ص ${page}`,
    citations: { enabled: true },
  }))
}

/** Empty sections are left out, header included. */
function taskOf({ draft, instruction, point, outline, pinned, leads, controls }: WriteRequest) {
  const sections = [
    ["OUTLINE", (outline ?? []).map((claim, i) => `${i + 1}. ${claim}`).join("\n")],
    ["POINT", point ?? ""],
    ["PINNED", pinned ? `documents 1 to ${pinned}` : ""],
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

/** Yields each text block as it completes, so a sentence is shown while the next is still being written. */
async function* blocksOf(events: AsyncIterable<Anthropic.Beta.BetaRawMessageStreamEvent>): AsyncGenerator<Block> {
  let block: Block | undefined
  for await (const event of events) {
    if (event.type === "content_block_start") block = event.content_block.type === "text" ? { text: event.content_block.text } : undefined
    if (event.type === "content_block_delta" && block) {
      if (event.delta.type === "text_delta") block.text += event.delta.text
      if (event.delta.type === "citations_delta" && event.delta.citation.type === "char_location")
        block.citation ??= { passage: event.delta.citation.document_index, quote: event.delta.citation.cited_text.trim() }
    }
    if (event.type === "content_block_stop" && block) {
      yield block
      block = undefined
    }
  }
}

/**
 * Joins the blocks back into whole sentences. A response cites by block, and a sentence is often an uncited lead-in, a cited block and an uncited
 * close: the sentence keeps all of it and carries every citation that fell inside it. Only a sentence with no cited block is unsupported.
 */
async function* resultsOf(blocks: AsyncIterable<Block>): AsyncGenerator<Claim | Gap> {
  let pending = ""
  let citations: Citation[] = []
  let closing = ""

  for await (const { text, citation } of blocks) {
    /** A sentence that closed at the end of the last block is done before this block's citation can attach to it. */
    if (/[.!?؟]+["»”)]*\s*$/.test(pending)) {
      yield { kind: "claim", sentence: pending.trim(), citations }
      pending = ""
      citations = []
    }
    if (closing || /^\s*(MISSING|SEARCH):/m.test(text)) {
      const at = closing ? 0 : text.search(/^\s*(MISSING|SEARCH):/m)
      pending += text.slice(0, at)
      closing += text.slice(at)
    } else pending += text
    if (citation) citations.push(citation)

    for (let end = sentenceEnd(pending); end !== -1; end = sentenceEnd(pending)) {
      yield { kind: "claim", sentence: pending.slice(0, end).trim(), citations }
      pending = pending.slice(end)
      citations = pending.trim() && citation ? [citation] : []
    }
  }

  if (pending.trim()) yield { kind: "claim", sentence: pending.trim(), citations }
  const missing = closing.match(/^\s*MISSING:\s*(.+)$/m)?.[1]
  if (missing) yield { kind: "gap", missing: missing.trim(), searchTerms: closing.match(/^\s*SEARCH:\s*(.+)$/m)?.[1]?.trim() ?? "" }
}

/** Where the first complete sentence of `text` ends: after its closing mark and any closing quote, once more text follows. -1 if none has ended. */
function sentenceEnd(text: string) {
  const match = text.match(/[.!?؟]+["»”)]*(?=\s+\S)/)
  return match ? match.index! + match[0].length : -1
}
