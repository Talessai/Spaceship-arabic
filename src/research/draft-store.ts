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

/** What the tool is asked to write about, set on the research page. */
export const storedTopic = () => localStorage.getItem(TOPIC_STORAGE) ?? ""
export const storeTopic = (topic: string) => localStorage.setItem(TOPIC_STORAGE, topic)

/** The text the tool last showed up to its knob, for the research page to take into the draft. */
export const storedToolText = () => localStorage.getItem(TOOL_TEXT_STORAGE) ?? ""
export const storeToolText = (text: string) => localStorage.setItem(TOOL_TEXT_STORAGE, text)
