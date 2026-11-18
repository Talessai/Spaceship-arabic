import type { AttentionSource } from "../text/attention.ts"
import { strengthLevelOf, valueOf, type Dimension, type DimensionSource } from "../text/dimension.ts"
import { wordSpans } from "../text/segments.ts"
import type { TextSource } from "../text/text-stream.ts"
import { searchTerms } from "./arabic.ts"
import { storedReferenceNumber, storedTopic } from "./draft-store.ts"
import { liveWriter } from "./live-writer.ts"
import { createIndex } from "./retrieval.ts"
import { storedSources } from "./source-store.ts"
import { checked } from "./writer.ts"

const PASSAGES_PER_REQUEST = 10
const QUERY_TAIL_CHARS = 400
const MAX_BOXES = 3
const BOX_CONTEXT_WORDS = 2
/** Boxes are picked among the latest words, which the next sentences follow from. */
const RECENT_WORDS = 60

/** The ways a research passage can read, in place of a story's. They shape wording, never facts. */
const AXES: Dimension[] = [
  { name: "الرسمية", kind: "scale", low: "مبسّط", high: "أكاديمي رسمي" },
  { name: "الادعاء", kind: "scale", low: "جازم", high: "متحفظ" },
  { name: "التفصيل", kind: "scale", low: "موجز", high: "مفصّل" },
  { name: "نوع الفقرة", kind: "choice", options: ["وصف", "تحليل", "مقارنة", "نقد"] },
  { name: "الصياغة", kind: "scale", low: "حرة", high: "قريبة من المصدر" },
]

/**
 * The tool's sources when it writes research: text continued from the researcher's stored sources alone, each sentence ending in its reference
 * number; boxes on the words the sources know best; and research axes for the fan. `onNotice` is told what the reader should know and the text
 * cannot say: that the sources ran out, what is missing, or why nothing was written.
 */
export function createResearchSources(onNotice: (notice: string) => void) {
  const index = storedSources().then((sources) => createIndex(sources.flatMap(({ passages }) => passages)))
  /** The request that last added nothing. Asking it again would cost a call and add nothing again, so it is not sent until something changes. */
  let spent = ""

  const text: TextSource = {
    async *complete(prefix, steering, signal) {
      const topic = storedTopic()
      const leads = steering.leads.map(({ before, keyword, after }) => `${before}${keyword}${after}`.trim())
      const request = JSON.stringify([prefix, steering, topic])
      if (request === spent) return

      const passages = (await index).search([topic, ...leads, prefix.slice(-QUERY_TAIL_CHARS)].join(" "), PASSAGES_PER_REQUEST).map(({ passage }) => passage)
      if (!passages.length) {
        spent = request
        return onNotice("لا توجد بيانات كافية: لا يوجد في مصادرك مقطع يتصل بهذا الموضوع. أضف مصادر من صفحة البحث.")
      }

      const controls = steering.controls.map((control) => ({
        name: control.dimension.name,
        toward: valueOf(control),
        strength: strengthLevelOf(control.strength),
      }))
      let written = 0
      let unsupported = 0
      let gap = ""
      onNotice("")
      try {
        for await (const result of liveWriter({ draft: prefix, instruction: topic, passages, pinned: 0, leads, controls }, signal)) {
          if (result.kind === "gap") {
            gap = `ينقص المصادر: ${result.missing}${result.searchTerms && ` كلمات للبحث: ${result.searchTerms}`}`
            continue
          }
          const { cited, sentence, quote } = checked(result, passages)
          if (!cited) {
            unsupported++
            continue
          }
          const number = storedReferenceNumber({ source: cited.source, page: cited.page, quote })
          yield `${prefix || written ? " " : ""}${sentence} [${number}]`
          written++
        }
      } catch (error) {
        if (signal.aborted) throw error
        spent = request
        return onNotice(`تعذّرت الكتابة: ${error instanceof Error ? error.message : error}`)
      }
      if (!written) spent = request
      onNotice([gap, unsupported ? `حُذفت ${unsupported} جملة بلا سند.` : ""].filter(Boolean).join(" "))
    },
  }

  /** Marks the recent words the sources mention least often: the specific terms of the passage, which the next sentences can be led by. */
  const attention: AttentionSource = async function* (shown) {
    const { rarity } = await index
    const words = wordSpans(shown).map(({ start, end }, position) => ({ position, term: searchTerms(shown.slice(start, end))[0] }))
    const picked = new Set<string>()
    const ranked = words
      .slice(-RECENT_WORDS)
      .map((word) => ({ ...word, rarity: word.term ? rarity(word.term) : 0 }))
      .filter(({ rarity }) => rarity > 0)
      .sort((a, b) => b.rarity - a.rarity)
    for (const { position, term } of ranked) {
      if (picked.has(term!)) continue
      picked.add(term!)
      yield { keyword: position, before: BOX_CONTEXT_WORDS, after: BOX_CONTEXT_WORDS }
      if (picked.size === MAX_BOXES) return
    }
  }

  const dimension: DimensionSource = async function* ({ taken }) {
    yield* AXES.filter(({ name }) => !taken.some((dimension) => dimension.name === name))
  }

  return { text, attention, dimension }
}
