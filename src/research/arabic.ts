const PREFIXES = ["وال", "بال", "كال", "فال", "لل", "ال", "و"]
const MIN_STEM_LENGTH = 3

const STOP_WORDS = new Set(
  "في من على الى عن مع هذا هذه ذلك تلك التي الذي الذين ان كان كانت كما لا ما لم لن قد او ثم بين حتى اذا هو هي هم كل بعد قبل عند غير the a an of and or to in on for is are was were be by with as at that this it from".split(
    " ",
  ),
)

/**
 * Folds the spellings that differ between a source and a copy of it: case, diacritics, tatweel, the hamza and alef forms, final yeh and teh marbuta.
 * Punctuation becomes a space, so two texts that read the same compare equal.
 */
export function normalized(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{M}ـ]/gu, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

/** The words of `text` to search by: normalized, without stop words, and without the article or a conjunction attached to an Arabic word. */
export function searchTerms(text: string) {
  return normalized(text)
    .split(" ")
    .filter((word) => word && !STOP_WORDS.has(word))
    .map(stemOf)
}

function stemOf(word: string) {
  const prefix = PREFIXES.find((prefix) => word.startsWith(prefix) && word.length - prefix.length >= MIN_STEM_LENGTH)
  return prefix ? word.slice(prefix.length) : word
}
