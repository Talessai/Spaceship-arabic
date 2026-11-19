import "@fontsource-variable/jetbrains-mono/wght.css"
import "@fontsource/ibm-plex-sans-arabic/400.css"
import "@fontsource/ibm-plex-sans-arabic/600.css"
import { $ } from "../dom.ts"
import { KEY_STORAGE } from "../llm/claude.ts"
import { controlsOf } from "./controls.ts"
import { referenceMarks, storedDraft, storedToolText, storeDraft, storeTopic } from "./draft-store.ts"
import { liveWriter } from "./live-writer.ts"
import { createIndex } from "./retrieval.ts"
import { simulatedWriter } from "./simulated-writer.ts"
import { removeStoredSource, storedSources, storeSource } from "./source-store.ts"
import { MAX_SOURCES, MIN_SOURCES, sourceOf, type Passage, type Source } from "./sources.ts"
import { checked, type CheckedClaim, type Gap } from "./writer.ts"

const PASSAGES_PER_REQUEST = 10
/** With an empty instruction, the end of the draft is what the passages are searched by. */
const QUERY_TAIL_CHARS = 400

/** The model writes whenever a key is saved, however the page was reached; `?sim=true` asks for the simulator, and `?live=true` for the model before a key is saved. */
const query = new URLSearchParams(location.search)
const isLive = query.get("sim") !== "true" && (query.get("live") === "true" || Boolean(localStorage.getItem(KEY_STORAGE)))
const writer = isLive ? liveWriter : simulatedWriter

const draft = $<HTMLTextAreaElement>("#draft")
const sourceList = $<HTMLUListElement>("#source-list")
const sourceNote = $<HTMLOutputElement>("#source-note")
const claimList = $<HTMLOListElement>("#claims")
const referenceList = $<HTMLOListElement>("#references")
const status = $<HTMLOutputElement>("#status")
const stop = $<HTMLButtonElement>("#stop")
const accept = $<HTMLButtonElement>("#accept")
const keyStatus = $<HTMLOutputElement>("#key-status")
const forgetKey = $<HTMLButtonElement>("#forget-key")
const controls = $<HTMLFormElement>("#controls")
const pinnedList = $<HTMLUListElement>("#pinned")

let sources: Source[] = []
let index = createIndex([])
let offered: CheckedClaim[] = []
let pinned: Passage[] = []
let controller: AbortController | undefined

restoreDraft()
showSources()
showMode()
showKey()
storedSources().then((stored) => {
  sources = [...stored, ...sources.filter(({ title }) => !stored.some((source) => source.title === title))]
  showSources()
}, reportStorageError)

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
  const form = event.currentTarget as HTMLFormElement
  const key = String(new FormData(form).get("key")).trim()
  if (!key) return
  localStorage.setItem(KEY_STORAGE, key)
  form.reset()
  showKey()
  if (!isLive && query.get("sim") !== "true") location.reload()
})

forgetKey.addEventListener("click", () => {
  localStorage.removeItem(KEY_STORAGE)
  showKey()
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
  storeDraft({ text: "", references: [] })
  showReferences()
})
$("#take-tool-text").addEventListener("click", () => {
  draft.value = [draft.value.trimEnd(), storedToolText()].filter(Boolean).join("\n\n")
  showReferences()
  saveDraft()
})
$("#open-tool").addEventListener("click", () => {
  storeTopic($<HTMLInputElement>("[name=instruction]").value.trim())
  location.assign("../?research=true")
})

function addSource(title: string, markdown: string) {
  if (sources.length >= MAX_SOURCES) return void (sourceNote.value = `الحد الأقصى ${MAX_SOURCES} مصدراً. احذف مصدراً لتضيف غيره.`)
  const source = sourceOf(title, markdown)
  sources = [...sources.filter((existing) => existing.title !== title), source]
  showSources()
  storeSource(source).catch(reportStorageError)
}

/** The page still works for this visit when the browser refuses storage, as in a private window. */
function reportStorageError() {
  sourceNote.value = `${sourceNote.value} تعذّر حفظ المصادر في هذا المتصفح، فستبقى لهذه الزيارة فقط.`
}

function showKey() {
  const isStored = Boolean(localStorage.getItem(KEY_STORAGE))
  keyStatus.value = isStored ? "المفتاح محفوظ في هذا المتصفح." : "لا يوجد مفتاح محفوظ."
  $("#key summary").textContent = isStored ? "مفتاح النموذج: محفوظ" : "مفتاح النموذج: غير محفوظ"
  forgetKey.hidden = !isStored
}

function showSources() {
  index = createIndex(sources.flatMap(({ passages }) => passages))
  showPinned()
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
        removeStoredSource(source.title).catch(reportStorageError)
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
  const found = index.search(instruction || draft.value.slice(-QUERY_TAIL_CHARS), PASSAGES_PER_REQUEST).map(({ passage }) => passage)
  const passages = [...pinned, ...found.filter((passage) => !pinned.includes(passage))].slice(0, PASSAGES_PER_REQUEST)
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
    for await (const result of writer(
      { draft: draft.value, instruction, passages, pinned: pinned.length, leads: [], controls: controlsOf(controls) },
      signal,
    )) {
      if (result.kind === "gap") showGap(result)
      else showClaim(checked(result, passages))
    }
    const unverified = offered.filter(({ support }) => !support.length).length
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
  const [first] = claim.support
  checkbox.disabled = !first
  item.querySelector("span")!.textContent = claim.sentence
  item.querySelector("blockquote")!.textContent = claim.support.map(({ quote }) => quote).join("\n") || claim.citations[0]?.quote || ""
  item.querySelector("cite")!.textContent = first
    ? claim.support.map(({ passage }) => `${passage.source}، ص ${passage.page}`).join("؛ ")
    : "لا يوجد لهذه الجملة اقتباس حرفي في المصادر."
  item.toggleAttribute("data-unverified", !first)
  const pin = item.querySelector("button")!
  pin.hidden = !first
  pin.addEventListener("click", () => {
    if (!pinned.includes(first.passage)) pinned = [...pinned, first.passage]
    showPinned()
  })
  claimList.append(item)
}

function showPinned() {
  pinned = pinned.filter((passage) => sources.some(({ passages }) => passages.includes(passage)))
  $("#pinned-section").hidden = !pinned.length
  pinnedList.replaceChildren(
    ...pinned.map((passage) => {
      const item = cloneOf("#pinned-item")
      item.querySelector("cite")!.textContent = `${passage.source}، ص ${passage.page}`
      item.querySelector("blockquote")!.textContent = passage.text
      item.querySelector("button")!.addEventListener("click", () => {
        pinned = pinned.filter((existing) => existing !== passage)
        showPinned()
      })
      return item
    }),
  )
}

function showGap({ missing, searchTerms }: Gap) {
  const note = Object.assign(document.createElement("li"), { className: "gap" })
  note.textContent = searchTerms ? `${missing}\nكلمات للبحث عن مصدر: ${searchTerms}` : missing
  note.style.whiteSpace = "pre-line"
  claimList.append(note)
}

function acceptChecked() {
  const accepted = [...claimList.querySelectorAll<HTMLInputElement>("input:checked")].map(({ value }) => offered[Number(value)])
  const sentences = accepted.map((claim) => `${claim.sentence} ${referenceMarks(claim.support)}`)
  draft.value = [draft.value.trimEnd(), sentences.join(" ")].filter(Boolean).join(draft.value.endsWith("\n") ? "\n" : " ")
  for (const checkbox of claimList.querySelectorAll<HTMLInputElement>("input:checked")) checkbox.closest("li")!.remove()
  accept.disabled = true
  saveDraft()
  showReferences()
}

function showReferences() {
  referenceList.replaceChildren(
    ...storedDraft().references.map(({ source, page, quote }, i) => {
      const item = cloneOf("#reference-item")
      item.querySelector("span")!.textContent = `[${i + 1}] ${source}، ص ${page}`
      item.querySelector("blockquote")!.textContent = quote
      return item
    }),
  )
}

function downloadDraft() {
  const list = storedDraft()
    .references.map(({ source, page, quote }, i) => `[${i + 1}] ${source}، ص ${page}: «${quote}»`)
    .join("\n\n")
  const link = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([`${draft.value}\n\n## المراجع\n\n${list}\n`], { type: "text/markdown" })),
    download: "draft.md",
  })
  link.click()
  URL.revokeObjectURL(link.href)
}

function saveDraft() {
  storeDraft({ ...storedDraft(), text: draft.value })
}

function restoreDraft() {
  draft.value = storedDraft().text
  showReferences()
}

function showMode() {
  const mode = $<HTMLAnchorElement>("#mode")
  mode.textContent = isLive ? "النموذج يعمل ← العودة إلى المحاكاة" : "محاكاة ← تشغيل النموذج"
  mode.href = isLive ? "?sim=true" : "?live=true"
  $<HTMLDetailsElement>("#key").open = !localStorage.getItem(KEY_STORAGE)
  $("#controls-note").textContent = isLive ? "" : "في وضع المحاكاة تُنسخ الجمل من المصادر كما هي، فالتوجيه لا يغيّرها. شغّل النموذج لترى أثره."
}

function cloneOf(template: string) {
  return ($<HTMLTemplateElement>(template).content.cloneNode(true) as DocumentFragment).firstElementChild as HTMLElement
}
