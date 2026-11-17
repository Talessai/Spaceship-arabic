export const STORY_MAX_WORDS = 400

export const STORY_SYSTEM_PROMPT = `Continue the story. The user message is its opening, which may stop mid-sentence.

- Output only the words that come next. Do not repeat the opening.
- Your first word directly follows the opening's last word.
- Write in Modern Standard Arabic, matching the opening's language and style.
- Plain text only. No title, markdown or commentary.
- At most ${STORY_MAX_WORDS} words. End on a complete sentence.

EXAMPLE
User: رنّ المنبّه، لكن
Assistant:
لم يكن منبّه هاتفها. بقيت مريم ساكنة وأصغت.`

export const STORY_REQUEST = {
  system: STORY_SYSTEM_PROMPT,
  temperature: 0.9,
  maxCompletionTokens: 2000,
}
