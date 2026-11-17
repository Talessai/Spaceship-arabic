import { normalized } from "./arabic.ts"
import type { Passage } from "./sources.ts"

const MIN_QUOTE_WORDS = 3

export type WriteRequest = { draft: string; instruction: string; passages: Passage[] }

/** A sentence for the draft with the words of a passage it rests on, or what the passages lack to write one. */
export type Claim = { kind: "claim"; sentence: string; passage: number; quote: string }
export type Gap = { kind: "gap"; missing: string; searchTerms: string }

/** Streams the next sentences of the draft from the passages alone. Must stop (by throwing or returning) once `signal` aborts. */
export type Writer = (request: WriteRequest, signal: AbortSignal) => AsyncIterable<Claim | Gap>

export type CheckedClaim = Claim & { cited?: Passage }

/**
 * Looks the quote up in the passages, ignoring spelling variants: first in the passage the writer named, then in the others, since a writer
 * sometimes copies the right words under the wrong number. `cited` stays empty when no passage holds the quote.
 */
export function checked(claim: Claim, passages: Passage[]): CheckedClaim {
  const quote = normalized(claim.quote)
  if (quote.split(" ").length < MIN_QUOTE_WORDS) return claim
  const holdsQuote = (passage: Passage | undefined) => passage !== undefined && normalized(passage.text).includes(quote)
  const cited = holdsQuote(passages[claim.passage]) ? passages[claim.passage] : passages.find(holdsQuote)
  return { ...claim, cited }
}
