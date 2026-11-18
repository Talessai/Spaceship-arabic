import { searchTerms } from "./arabic.ts"
import type { Passage } from "./sources.ts"

const K1 = 1.2
const B = 0.75

export type Hit = { passage: Passage; score: number }

/** Ranks passages against a query by BM25 over their search terms. Matches words only: a query in one language does not find a passage in another. */
export function createIndex(passages: Passage[]) {
  const documents = passages.map((passage) => counted(searchTerms(passage.text)))
  const lengths = documents.map((terms) => [...terms.values()].reduce((sum, count) => sum + count, 0))
  const averageLength = lengths.reduce((sum, length) => sum + length, 0) / (lengths.length || 1)
  const documentFrequency = new Map<string, number>()
  for (const terms of documents) for (const term of terms.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)

  return { search, rarity }

  /** How telling a search term is: higher the fewer passages hold it, and 0 when none does. */
  function rarity(term: string) {
    const matches = documentFrequency.get(term)
    return matches ? Math.log(1 + (documents.length - matches + 0.5) / (matches + 0.5)) : 0
  }

  function search(query: string, limit: number): Hit[] {
    const terms = [...new Set(searchTerms(query))]
    return documents
      .map((document, i) => ({ passage: passages[i], score: terms.reduce((sum, term) => sum + termScore(term, document, lengths[i]), 0) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  function termScore(term: string, document: Map<string, number>, length: number) {
    const frequency = document.get(term)
    if (!frequency) return 0
    return (rarity(term) * frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * length) / averageLength))
  }
}

function counted(terms: string[]) {
  const counts = new Map<string, number>()
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1)
  return counts
}
