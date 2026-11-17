import { delay } from "./completion.ts"
import type { Dimension, DimensionSource } from "./dimension.ts"

const MENU_SIZE = 5
const LATENCY_MS = 150

const DIMENSIONS: Dimension[] = [
  { name: "التوتر", kind: "scale", low: "هادئ", high: "متوتر" },
  { name: "المنعطف", kind: "choice", options: ["حل", "تعليق", "مفاجأة"] },
  { name: "الإيقاع", kind: "scale", low: "متمهل", high: "سريع" },
  { name: "الصوت", kind: "choice", options: ["حدث", "حوار", "تأمل"] },
  { name: "المزاج", kind: "scale", low: "قاتم", high: "مشرق" },
  { name: "المسافة", kind: "scale", low: "حميمة", high: "محايدة" },
]

export const simulatedDimension: DimensionSource = async function* ({ taken }, signal) {
  await delay(LATENCY_MS, signal)
  const takenNames = new Set(taken.map(({ name }) => name))
  const free = DIMENSIONS.filter(({ name }) => !takenNames.has(name))
  yield* (free.length ? free : DIMENSIONS).slice(0, MENU_SIZE)
}
