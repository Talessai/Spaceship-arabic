/** Whether the story column reads right to left. Values on a future knob's fan then run from right to left too, as on a mirrored slider. */
export const isRtl = getComputedStyle(document.querySelector("#text")!).direction === "rtl"

/** Turns a fan swing in value terms (negative toward the low pole or first option) into the on-screen swing, and back: the same flip both ways. */
export const screenSwing = (swing: number) => (isRtl ? -swing : swing)
