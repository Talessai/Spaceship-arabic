import type { AttentionSource } from "../text/attention.ts"
import { strengthLevelOf, valueOf, type Dimension, type DimensionSource } from "../text/dimension.ts"
import { wordSpans } from "../text/segments.ts"
import type { TextSource } from "../text/text-stream.ts"
import { searchTerms } from "./arabic.ts"
import { referenceMarks, storedTopic } from "./draft-store.ts"
import { liveWriter, planOutline, type Point } from "./live-writer.ts"
import { createIndex } from "./retrieval.ts"
import { storedSources } from "./source-store.ts"
import { checked } from "./writer.ts"

/**
 * The outline is planned from every passage while the library is this small, since a search by the topic's words misses what the sources say in
 * other words ("الأب" does not find "والده"). A larger library is cut to the passages nearest the topic, a few a page.
 */
const PLAN_PASSAGES = 300
const PASSAGES_PER_PAGE = 3
/** Ends a sentence that no passage backs, in place of reference numbers. */
const UNSUPPORTED_MARK = "[؟]"
/** As `sources.ts` labels a footnote's source. */
const FOOTNOTE_LABEL = " (حاشية)"
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

/** What the tool says once the plan is written out: what the sources did not cover, and which of them nothing was taken from. */
function closingNoticeOf({ points, missing, unused }: { points: Point[]; missing: string; unused: string[] }) {
  return [
    `اكتمل المخطط: ${points.length} فقرات.`,
    missing && `لم تغطِّ المصادر: ${missing}`,
    unused.length && `لم يُؤخذ شيء من: ${unused.join("، ")} (لا يتصل بالموضوع).`,
  ]
    .filter(Boolean)
    .join(" ")
}

/**
 * The tool's sources when it writes research: text written from the researcher's stored sources alone, one planned paragraph at a time, each
 * sentence ending in its reference numbers; boxes on the words the sources know best; and research axes for the fan. `onNotice` is told what the
 * reader should know and the text cannot say: which paragraph is being written, what is missing, or why nothing was written.
 */
export function createResearchSources(onNotice: (notice: string) => void) {
  const sources = storedSources()
  const index = sources.then((stored) => createIndex(stored.flatMap(({ passages }) => passages)))
  /** The request that last added nothing. Asking it again would cost a call and add nothing again, so it is not sent until something changes. */
  let spent = ""
  /** The outline for the topic, and the paragraph written for each of its points so far, in order. */
  let plan: { topic: string; points: Point[]; missing: string; unused: string[]; written: string[] } | undefined

  const text: TextSource = {
    async *complete(prefix, steering, signal) {
      const topic = storedTopic()
      const request = JSON.stringify([prefix, steering, topic])
      if (request === spent) return
      if (!topic) {
        spent = request
        return onNotice("لا يوجد موضوع بعد. اضغط «صفحة البحث» في الأسفل، اكتب الموضوع، ثم اضغط «اكتب هذا الموضوع في الأداة».")
      }

      try {
        if (plan?.topic !== topic) {
          onNotice("يُحضَّر مخطط البحث من مصادرك…")
          plan = await planFor(topic, signal)
        }
        if (!plan.points.length) {
          spent = request
          return onNotice(`لا توجد بيانات كافية: لا يوجد في مصادرك ما يُبنى عليه هذا الموضوع. ${plan.missing}`.trim())
        }

        /** A drag back cut the text, so the first paragraph no longer whole in it is the one to write. */
        const cut = plan.written.findIndex((paragraph) => !prefix.includes(paragraph))
        if (cut !== -1) plan.written.length = cut
        const position = plan.written.length
        const point = plan.points[position]
        if (!point) {
          spent = request
          return onNotice(closingNoticeOf(plan))
        }

        const progress = `الفقرة ${position + 1} من ${plan.points.length}: ${point.claim}`
        onNotice(progress)
        const leads = steering.leads.map(({ before, keyword, after }) => `${before}${keyword}${after}`.trim())
        const controls = steering.controls.map((control) => ({
          name: control.dimension.name,
          toward: valueOf(control),
          strength: strengthLevelOf(control.strength),
        }))
        const outline = plan.points.map(({ claim }) => claim)
        let paragraph = ""
        let unsupported = 0
        let gap = ""
        for await (const result of liveWriter(
          { draft: prefix, instruction: topic, passages: point.passages, pinned: 0, leads, controls, point: point.claim, outline },
          signal,
        )) {
          if (result.kind === "gap") {
            gap = ` ينقص المصادر: ${result.missing}${result.searchTerms && ` كلمات للبحث: ${result.searchTerms}`}`
            continue
          }
          const { sentence, support } = checked(result, point.passages)
          if (!support.length) unsupported++
          const chunk = `${prefix || paragraph ? " " : ""}${sentence} ${support.length ? referenceMarks(support) : UNSUPPORTED_MARK}`
          paragraph += chunk
          yield chunk
        }
        if (!paragraph) spent = request
        plan.written[position] = paragraph.trim()
        onNotice(`${progress}${unsupported ? ` · ${unsupported} جملة بلا سند، موسومة ${UNSUPPORTED_MARK}` : ""}${gap}`)
      } catch (error) {
        if (signal.aborted) throw error
        spent = request
        onNotice(`تعذّرت الكتابة: ${error instanceof Error ? error.message : error}`)
      }
    },
  }

  /** Plans from the whole library when it is small, else from the passages nearest the topic, and notes the sources no point rests on. */
  async function planFor(topic: string, signal: AbortSignal) {
    const all = (await sources).flatMap(({ passages }) => passages)
    const perPage = new Map<string, number>()
    const nearest = (await index)
      .search(topic, all.length)
      .map(({ passage }) => passage)
      .filter(({ source, page }) => {
        const count = (perPage.get(`${source}\n${page}`) ?? 0) + 1
        perPage.set(`${source}\n${page}`, count)
        return count <= PASSAGES_PER_PAGE
      })
      .slice(0, PLAN_PASSAGES)
    const passages = all.length <= PLAN_PASSAGES ? all : nearest
    const { points, missing } = passages.length ? await planOutline(topic, passages, signal) : { points: [], missing: "" }
    const used = new Set(points.flatMap(({ passages }) => passages.map(({ source }) => source.replace(FOOTNOTE_LABEL, ""))))
    const unused = (await sources).map(({ title }) => title).filter((title) => !used.has(title))
    return { topic, points, missing, unused, written: [] as string[] }
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
