import "@fontsource-variable/jetbrains-mono/wght.css"
import "@fontsource/ibm-plex-sans-arabic/400.css"
import "@fontsource/ibm-plex-sans-arabic/600.css"
import { $ } from "../dom.ts"
import { KEY_STORAGE } from "../llm/cerebras.ts"
import { liveWriter } from "./live-writer.ts"
import { createIndex } from "./retrieval.ts"
import { simulatedWriter } from "./simulated-writer.ts"
import { MAX_SOURCES, MIN_SOURCES, sourceOf, type Source } from "./sources.ts"
import { checked, type CheckedClaim, type Gap } from "./writer.ts"

const DRAFT_STORAGE = "research-draft"
const PASSAGES_PER_REQUEST = 10
/** With an empty instruction, the end of the draft is what the passages are searched by. */
const QUERY_TAIL_CHARS = 400

type Reference = { source: string; page: number; quote: string }

const isLive = new URLSearchParams(location.search).get("live") === "true"
const writer = isLive ? liveWriter : simulatedWriter

const draft = $<HTMLTextAreaElement>("#draft")
const sourceList = $<HTMLUListElement>("#source-list")
const sourceNote = $<HTMLOutputElement>("#source-note")
const claimList = $<HTMLOListElement>("#claims")
const referenceList = $<HTMLOListElement>("#references")
const status = $<HTMLOutputElement>("#status")
const stop = $<HTMLButtonElement>("#stop")
const accept = $<HTMLButtonElement>("#accept")

let sources: Source[] = []
let index = createIndex([])
let references: Reference[] = []
let offered: CheckedClaim[] = []
let controller: AbortController | undefined

restoreDraft()
showSources()
showMode()

$<HTMLInputElement>("#source-files").addEventListener("change", async ({ currentTarget }) => {
  const input = currentTarget as HTMLInputElement
  for (const file of [...(input.files ?? [])]) addSource(file.name.replace(/\.(md|txt)$/i, ""), await file.text())
  input.value = ""
})

$<HTMLFormElement>("#paste-source").addEventListener("submit", (event) => {
  event.preventDefault()
  const form = event.currentTarget as HTMLFormElement
  const data = new FormData(form)
  addSource(String(data.get("title")).trim(), String(data.get("text")))
  form.reset()
})

$<HTMLFormElement>("#key-form").addEventListener("submit", (event) => {
  event.preventDefault()
  localStorage.setItem(KEY_STORAGE, String(new FormData(event.currentTarget as HTMLFormElement).get("key")).trim())
  status.value = "حُفظ المفتاح في هذا المتصفح."
})

$<HTMLFormElement>("#request").addEventListener("submit", (event) => {
  event.preventDefault()
  write(String(new FormData(event.currentTarget as HTMLFormElement).get("instruction")).trim())
})

stop.addEventListener("click", () => controller?.abort())
draft.addEventListener("input", saveDraft)
claimList.addEventListener("change", () => (accept.disabled = !claimList.querySelector("input:checked")))
accept.addEventListener("click", acceptChecked)
$("#download").addEventListener("click", downloadDraft)
$("#clear").addEventListener("click", () => {
  draft.value = ""
  references = []
  saveDraft()
  showReferences()
})

function addSource(title: string, markdown: string) {
  if (sources.length >= MAX_SOURCES) return void (sourceNote.value = `الحد الأقصى ${MAX_SOURCES} مصدراً. احذف مصدراً لتضيف غيره.`)
  const source = sourceOf(title, markdown)
  sources = [...sources.filter((existing) => existing.title !== title), source]
  showSources()
}

function showSources() {
  index = createIndex(sources.flatMap(({ passages }) => passages))
  sourceList.replaceChildren(
    ...sources.map((source) => {
      const item = cloneOf("#source-item")
      const pages = new Set(source.passages.map(({ page }) => page)).size
      const unreadable = source.unreadablePages.length ? `، ${source.unreadablePages.length} صفحة غير مقروءة تحتاج قراءة بصرية` : ""
      item.querySelector("b")!.textContent = source.title
      item.querySelector("small")!.textContent = `${pages} صفحة، ${source.passages.length} مقطعاً${unreadable}`
      item.querySelector("button")!.addEventListener("click", () => {
        sources = sources.filter((existing) => existing !== source)
        showSources()
      })
      return item
    }),
  )
  sourceNote.value =
    sources.length < MIN_SOURCES
      ? `${sources.length} من ${MIN_SOURCES} مصادر على الأقل: بأقل من ذلك يكون الناتج تلخيصاً لا بحثاً.`
      : `عدد المصادر: ${sources.length}.`
}

async function write(instruction: string) {
  controller?.abort()
  controller = new AbortController()
  const { signal } = controller
  const passages = index.search(instruction || draft.value.slice(-QUERY_TAIL_CHARS), PASSAGES_PER_REQUEST).map(({ passage }) => passage)
  offered = []
  claimList.replaceChildren()
  accept.disabled = true

  if (!passages.length) {
    showGap({ kind: "gap", missing: "لا توجد بيانات كافية: لا يوجد في مصادرك مقطع يتصل بهذا الطلب.", searchTerms: instruction })
    return void (status.value = "")
  }

  stop.disabled = false
  status.value = `يكتب من ${passages.length} مقاطع…`
  try {
    for await (const result of writer({ draft: draft.value, instruction, passages }, signal)) {
      if (result.kind === "gap") showGap(result)
      else showClaim(checked(result, passages))
    }
    const unverified = offered.filter(({ cited }) => !cited).length
    status.value = offered.length ? `${offered.length} جملة، ${unverified} منها بلا سند.` : "لم تُكتب أي جملة."
  } catch (error) {
    status.value = signal.aborted ? "أُوقف." : `خطأ: ${error instanceof Error ? error.message : error}`
  } finally {
    if (controller.signal === signal) stop.disabled = true
  }
}

function showClaim(claim: CheckedClaim) {
  offered.push(claim)
  const item = cloneOf("#claim-item")
  const checkbox = item.querySelector("input")!
  checkbox.value = String(offered.length - 1)
  checkbox.disabled = !claim.cited
  item.querySelector("span")!.textContent = claim.sentence
  item.querySelector("blockquote")!.textContent = claim.quote
  item.querySelector("cite")!.textContent = claim.cited ? `${claim.cited.source}، ص ${claim.cited.page}` : "هذا الاقتباس غير موجود حرفياً في المصادر."
  item.toggleAttribute("data-unverified", !claim.cited)
  claimList.append(item)
}

function showGap({ missing, searchTerms }: Gap) {
  const note = Object.assign(document.createElement("li"), { className: "gap" })
  note.textContent = searchTerms ? `${missing}\nكلمات للبحث عن مصدر: ${searchTerms}` : missing
  note.style.whiteSpace = "pre-line"
  claimList.append(note)
}

function acceptChecked() {
  const accepted = [...claimList.querySelectorAll<HTMLInputElement>("input:checked")].map(({ value }) => offered[Number(value)])
  const sentences = accepted.map(
    (claim) => `${claim.sentence} [${referenceNumberOf({ source: claim.cited!.source, page: claim.cited!.page, quote: claim.quote })}]`,
  )
  draft.value = [draft.value.trimEnd(), sentences.join(" ")].filter(Boolean).join(draft.value.endsWith("\n") ? "\n" : " ")
  for (const checkbox of claimList.querySelectorAll<HTMLInputElement>("input:checked")) checkbox.closest("li")!.remove()
  accept.disabled = true
  saveDraft()
  showReferences()
}

function referenceNumberOf(reference: Reference) {
  const existing = references.findIndex(({ source, page, quote }) => source === reference.source && page === reference.page && quote === reference.quote)
  if (existing !== -1) return existing + 1
  references.push(reference)
  return references.length
}

function showReferences() {
  referenceList.replaceChildren(
    ...references.map(({ source, page, quote }, i) => {
      const item = cloneOf("#reference-item")
      item.querySelector("span")!.textContent = `[${i + 1}] ${source}، ص ${page}`
      item.querySelector("blockquote")!.textContent = quote
      return item
    }),
  )
}

function downloadDraft() {
  const list = references.map(({ source, page, quote }, i) => `[${i + 1}] ${source}، ص ${page}: «${quote}»`).join("\n\n")
  const link = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([`${draft.value}\n\n## المراجع\n\n${list}\n`], { type: "text/markdown" })),
    download: "draft.md",
  })
  link.click()
  URL.revokeObjectURL(link.href)
}

function saveDraft() {
  localStorage.setItem(DRAFT_STORAGE, JSON.stringify({ text: draft.value, references }))
}

function restoreDraft() {
  const saved = JSON.parse(localStorage.getItem(DRAFT_STORAGE) ?? "null") as { text: string; references: Reference[] } | null
  draft.value = saved?.text ?? ""
  references = saved?.references ?? []
  showReferences()
}

function showMode() {
  const mode = $<HTMLAnchorElement>("#mode")
  mode.textContent = isLive ? "النموذج يعمل ← العودة إلى المحاكاة" : "محاكاة ← تشغيل النموذج"
  mode.href = isLive ? "?" : "?live=true"
  $("#key").hidden = !isLive
}

function cloneOf(template: string) {
  return ($<HTMLTemplateElement>(template).content.cloneNode(true) as DocumentFragment).firstElementChild as HTMLElement
}
