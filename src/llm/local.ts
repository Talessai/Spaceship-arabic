const STORAGE = "local-model"

/** A model served on the researcher's own machine through an OpenAI-compatible endpoint, as Ollama and LM Studio offer. */
export type LocalModel = { baseUrl: string; model: string; apiKey: string }

export const DEFAULT_LOCAL_URL = "http://localhost:11434/v1"

export function storedLocalModel(): LocalModel | undefined {
  return JSON.parse(localStorage.getItem(STORAGE) ?? "null") ?? undefined
}

export function storeLocalModel(model: LocalModel | undefined) {
  if (model) localStorage.setItem(STORAGE, JSON.stringify(model))
  else localStorage.removeItem(STORAGE)
}

/** Streams the reply's text. A failure to connect is reported as what it most often is: the model is not running, or it refuses this page's origin. */
export async function* streamLocal({ system, user, signal }: { system: string; user: string; signal: AbortSignal }) {
  const local = storedLocalModel()
  if (!local?.model) throw new Error("احفظ اسم النموذج المحلي أولاً من صفحة البحث.")
  const url = `${local.baseUrl.replace(/\/+$/, "")}/chat/completions`

  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", ...(local.apiKey && { Authorization: `Bearer ${local.apiKey}` }) },
    body: JSON.stringify({
      model: local.model,
      stream: true,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  }).catch((error) => {
    if (signal.aborted) throw error
    throw new Error(`تعذّر الوصول إلى النموذج المحلي على ${local.baseUrl}. تأكد أنه يعمل وأنه يسمح بالاتصال من هذه الصفحة.`)
  })
  if (!response.ok) throw new Error(`النموذج المحلي ردّ بخطأ ${response.status}: ${(await response.text()).slice(0, 200)}`)
  if (!response.body) throw new Error("النموذج المحلي لم يرسل رداً.")

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += value
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : ""
      if (!data || data === "[DONE]") continue
      const content = JSON.parse(data).choices?.[0]?.delta?.content
      if (content) yield content as string
    }
  }
}
