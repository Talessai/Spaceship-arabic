import type { Point } from "../point.ts"

/** `x` is measured along the reading direction from the line's start: from the left edge in left-to-right text, from the right edge in right-to-left text. */
export type Caret = { line: number; x: number }

/** Page position of the text's first line box, its left edge, width and top, its line height, and whether lines start at the right edge. */
export type TextMetrics = { left: number; width: number; top: number; lineHeight: number; isRtl: boolean }

export function caretAt({ x, y }: Point, { left, width, top, lineHeight, isRtl }: TextMetrics): Caret {
  return { line: Math.floor((y - top) / lineHeight), x: isRtl ? left + width - x : x - left }
}

/** The page point of `caret`, at its line's middle. */
export function pointAt({ line, x }: Caret, { left, width, top, lineHeight, isRtl }: TextMetrics): Point {
  return { x: isRtl ? left + width - x : left + x, y: top + (line + 0.5) * lineHeight }
}

export function isAhead(next: Caret, previous: Caret) {
  return next.line > previous.line || (next.line === previous.line && next.x > previous.x)
}
