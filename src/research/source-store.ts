import type { Source } from "./sources.ts"

const DATABASE = "research"
const STORE = "sources"

/** Keeps the sources in this browser's IndexedDB, keyed by title, since a few books outgrow localStorage. */
export async function storedSources() {
  return requested<Source[]>((await store("readonly")).getAll())
}

export async function storeSource(source: Source) {
  await requested((await store("readwrite")).put(source))
}

export async function removeStoredSource(title: string) {
  await requested((await store("readwrite")).delete(title))
}

async function store(mode: IDBTransactionMode) {
  const opening = indexedDB.open(DATABASE, 1)
  opening.onupgradeneeded = () => opening.result.createObjectStore(STORE, { keyPath: "title" })
  return (await requested(opening)).transaction(STORE, mode).objectStore(STORE)
}

function requested<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
