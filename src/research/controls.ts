const STRENGTHS = ["", "slightly", "strongly"]

/** How the next passage should read along one axis: toward a pole of a scale, or one option of a choice. Controls shape wording, never facts. */
export type Control = { name: string; toward: string; strength: string }

/**
 * Reads the steering form. A range input is a scale from its `data-low` pole (negative) to its `data-high` pole, and a select is a choice; a
 * range at its middle or a select on its empty option is left to the writer.
 */
export function controlsOf(form: HTMLFormElement): Control[] {
  return [...form.elements].flatMap((field): Control[] => {
    if (field instanceof HTMLSelectElement) return field.value ? [{ name: field.name, toward: field.value, strength: "" }] : []
    if (!(field instanceof HTMLInputElement) || field.type !== "range" || !field.valueAsNumber) return []
    const position = field.valueAsNumber
    return [{ name: field.name, toward: (position < 0 ? field.dataset.low : field.dataset.high)!, strength: STRENGTHS[Math.abs(position)] }]
  })
}

export function controlLine({ name, toward, strength }: Control) {
  return `${name}: ${toward}${strength && ` (${strength})`}`
}
