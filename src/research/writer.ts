import { normalized } from "./arabic.ts"
import type { Control } from "./controls.ts"
import type { Passage } from "./sources.ts"

const MIN_QUOTE_WORDS = 3

/**
 * `passages` starts with the `pinned` ones the researcher fixed in place, which the next sentences build on first; `leads` are phrases of the draft
 * to develop. With a plan, `point` is the one thing the paragraph establishes and `outline` the whole plan it belongs to.
 */
export type WriteRequest = {
  draft: string
  instruction: string
  passages: Passage[]
  pinned: number
  leads: string[]
  controls: Control[]
  point?: string
  outline?: string[]
}

/** The words of passage number `passage` that a sentence rests on. */
export type Citation = { passage: number; quote: string }

/** A sentence for the draft with the passage words it rests on, or what the passages lack to write one. A sentence with no citation is unsupported. */
export type Claim = { kind: "claim"; sentence: string; citations: Citation[] }
export type Gap = { kind: "gap"; missing: string; searchTerms: string }

/** Streams the next sentences of the draft from the passages alone. Must stop (by throwing or returning) once `signal` aborts. */
export type Writer = (request: WriteRequest, signal: AbortSignal) => AsyncIterable<Claim | Gap>

/** A claim with the citations whose quote was found in a passage; none means nothing in the passages backs the sentence as cited. */
export type CheckedClaim = Claim & { support: { passage: Passage; quote: string }[] }

/**
 * Looks each quote up in the passages, ignoring spelling variants: first in the passage the writer named, then in the others, since a writer
 * sometimes copies the right words under the wrong number. A citation whose quote no passage holds is left out of `support`.
 */
export function checked(claim: Claim, passages: Passage[]): CheckedClaim {
  const support = claim.citations.flatMap(({ passage, quote }) => {
    const wanted = normalized(quote)
    if (wanted.split(" ").length < MIN_QUOTE_WORDS) return []
    const holdsQuote = (candidate: Passage | undefined) => candidate !== undefined && normalized(candidate.text).includes(wanted)
    const found = holdsQuote(passages[passage]) ? passages[passage] : passages.find(holdsQuote)
    return found ? [{ passage: found, quote }] : []
  })
  return { ...claim, support }
}
