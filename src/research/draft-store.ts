const DRAFT_STORAGE = "research-draft"
const TOPIC_STORAGE = "research-topic"
const TOOL_TEXT_STORAGE = "research-tool-text"

export type Reference = { source: string; page: number; quote: string }

type Draft = { text: string; references: Reference[] }

/** The draft and its numbered references live in this browser's localStorage, shared by the research page and the tool's research mode. */
export function storedDraft(): Draft {
  return JSON.parse(localStorage.getItem(DRAFT_STORAGE) ?? "null") ?? { text: "", references: [] }
}

export function storeDraft(draft: Draft) {
  localStorage.setItem(DRAFT_STORAGE, JSON.stringify(draft))
}

/** The number of `reference` in the stored list, added at its end when new. */
export function storedReferenceNumber(reference: Reference) {
  const draft = storedDraft()
  const existing = draft.references.findIndex(({ source, page, quote }) => source === reference.source && page === reference.page && quote === reference.quote)
  if (existing !== -1) return existing + 1
  storeDraft({ ...draft, references: [...draft.references, reference] })
  return draft.references.length + 1
}

/** The bracketed reference numbers for what backs a sentence, each stored once, as in "[2][5]". */
export function referenceMarks(support: { passage: { source: string; page: number }; quote: string }[]) {
  const numbers = support.map(({ passage, quote }) => storedReferenceNumber({ source: passage.source, page: passage.page, quote }))
  return [...new Set(numbers)].map((number) => `[${number}]`).join("")
}

/**
 * `text` followed by the references its bracketed numbers point to, each with its source, page and the quoted words. The stored numbers grow
 * across sessions and rewrites, so the copy is renumbered from 1 in the order the text first cites them.
 */
export function citedText(text: string) {
  const { references } = storedDraft()
  const stored = [...new Set([...text.matchAll(/\[(\d+)\]/g)].map(([, number]) => Number(number)))].filter((number) => references[number - 1])
  const prose = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\[(\d+)\]/g, (mark, number) => (stored.includes(Number(number)) ? `[${stored.indexOf(Number(number)) + 1}]` : mark))
  const list = stored.map((number, i) => {
    const { source, page, quote } = references[number - 1]
    return `[${i + 1}] ${source}، ص ${page}: «${quote}»`
  })
  return list.length ? `${prose}\n\nالمراجع\n${list.join("\n")}` : prose
}

/** Everything of the researcher's own work kept in this browser, as one value to save to a file and bring back, here or on another device. */
export function backup() {
  return { kind: "research-backup", draft: storedDraft(), topic: storedTopic(), toolText: storedToolText() }
}

/** Puts a backup back in place of what is stored. Returns false, changing nothing, for a file that is not one. */
export function restore(saved: unknown) {
  const { kind, draft, topic, toolText } = (saved ?? {}) as Partial<ReturnType<typeof backup>>
  if (kind !== "research-backup" || typeof draft?.text !== "string" || !Array.isArray(draft.references)) return false
  storeDraft(draft)
  storeTopic(topic ?? "")
  storeToolText(toolText ?? "")
  return true
}

/** What the tool is asked to write about, set on the research page. */
export const storedTopic = () => localStorage.getItem(TOPIC_STORAGE) ?? ""
export const storeTopic = (topic: string) => localStorage.setItem(TOPIC_STORAGE, topic)

/** The text the tool last showed up to its knob, for the research page to take into the draft. */
export const storedToolText = () => localStorage.getItem(TOOL_TEXT_STORAGE) ?? ""
export const storeToolText = (text: string) => localStorage.setItem(TOOL_TEXT_STORAGE, text.replace(/\s+/g, " ").trim())
