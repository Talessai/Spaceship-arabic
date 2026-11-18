import type { Point } from "../point.ts"

/** How near the window's top or bottom a drag starts to scroll the page, and the most it scrolls per frame, reached at the very edge. */
const EDGE_PX = 96
const MAX_STEP_PX = 8

/**
 * Scrolls the page while a drag holds near the top or bottom of the window, so a drag can go on past the screen. The page moves under a still
 * finger without a pointer event, so `onScroll` is told the page point the pointer is over after each step. `bottomInset` is how much of the
 * window's bottom is covered by fixed bars.
 */
export function createEdgeScroll(onScroll: (point: Point) => void, bottomInset: () => number) {
  let held: Point | undefined
  let frame: number | undefined

  return {
    /** Takes the drag's latest page point. */
    follow(point: Point) {
      held = { x: point.x - scrollX, y: point.y - scrollY }
      frame ??= requestAnimationFrame(step)
    },
    stop() {
      held = undefined
    },
  }

  function step() {
    frame = undefined
    if (!held) return
    const bottom = innerHeight - bottomInset() - EDGE_PX
    const depth = held.y > bottom ? held.y - bottom : held.y < EDGE_PX ? held.y - EDGE_PX : 0
    if (!depth) return
    const before = scrollY
    scrollBy(0, Math.max(-1, Math.min(1, depth / EDGE_PX)) * MAX_STEP_PX)
    if (scrollY !== before) onScroll({ x: held.x + scrollX, y: held.y + scrollY })
    frame = requestAnimationFrame(step)
  }
}
