import { storedClaudeKey } from "../llm/claude.ts"
import { storedLocalModel } from "../llm/local.ts"
import { claudeAsk, liveWriter, type Ask } from "./live-writer.ts"
import { localAsk, localWriter } from "./local-writer.ts"
import type { Writer } from "./writer.ts"

const PROVIDER_STORAGE = "research-provider"

export type Provider = "claude" | "local"

/**
 * What writes, plans and checks. `planPassages` is how many passages the outline may be planned from: Claude reads a small library whole, while a
 * local model's context holds only the passages nearest the topic.
 */
export type ResearchModel = { provider: Provider; write: Writer; plan: Ask; check: Ask; planPassages: number }

/** The researcher's choice, or else whichever of the two is set up. */
export function storedProvider(): Provider | undefined {
  const chosen = localStorage.getItem(PROVIDER_STORAGE)
  if (chosen === "claude" || chosen === "local") return chosen
  return storedClaudeKey() ? "claude" : storedLocalModel()?.model ? "local" : undefined
}

export const storeProvider = (provider: Provider) => localStorage.setItem(PROVIDER_STORAGE, provider)

export function activeModel(): ResearchModel {
  return storedProvider() === "local"
    ? { provider: "local", write: localWriter, plan: localAsk, check: localAsk, planPassages: 24 }
    : { provider: "claude", write: liveWriter, plan: claudeAsk("low"), check: claudeAsk("medium"), planPassages: 300 }
}
