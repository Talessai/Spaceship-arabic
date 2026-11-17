import Anthropic from "@anthropic-ai/sdk"

export const KEY_STORAGE = "anthropic-api-key"

export const storedClaudeKey = () => localStorage.getItem(KEY_STORAGE)?.trim()

/** The page calls the API straight from the browser with the user's own key, kept in this browser's localStorage. */
export const claudeClient = (apiKey: string) => new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
