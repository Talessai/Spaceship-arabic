import { distance } from "./links.ts"

const DOUBLE_PRESS_MS = 500
/** How far apart a finger's two taps, and its release, may land and still count as one spot. */
const TOUCH_REACH_PX = 32

type Press = { at: number; x: number; y: number }

/**
 * Calls `onDouble` on a double press whose two presses both started on `element`. A mouse double press is the browser's `dblclick`. A finger's is
 * read from its pointer events, since not every phone browser sends `dblclick` for touch: the second tap must start soon after the first, near it,
 * and lift near where it landed, so a drag is not one.
 */
export function onDoublePress(element: HTMLElement, onDouble: (event: MouseEvent) => void) {
  let presses: Press[] = []
  let isMouse = true

  element.addEventListener("pointerdown", (event) => {
    isMouse = event.pointerType === "mouse"
    presses = [...presses.slice(-1), pressOf(event)]
  })
  element.addEventListener("dblclick", (event) => {
    if (isMouse && isSecondPressOf(event)) onDouble(event)
  })
  element.addEventListener("pointerup", (event) => {
    if (isMouse || !isSecondPressOf(event)) return
    const [first, second] = presses
    if (distance(first, second) > TOUCH_REACH_PX || distance(second, pressOf(event)) > TOUCH_REACH_PX) return
    presses = []
    onDouble(event)
  })

  function isSecondPressOf({ timeStamp }: MouseEvent) {
    const [first, second] = presses
    return presses.length === 2 && second.at - first.at <= DOUBLE_PRESS_MS && timeStamp - second.at <= DOUBLE_PRESS_MS
  }
}

function pressOf({ timeStamp, pageX, pageY }: MouseEvent): Press {
  return { at: timeStamp, x: pageX, y: pageY }
}
