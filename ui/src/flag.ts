/**
 * A flag attribute for React: present (`data-x=""`) when `on` is truthy, left out otherwise. React writes a boolean
 * data attribute as the text "true" or "false", and a `[data-x]` selector matches both, so a false flag must be left
 * out, never passed as `false`. An attribute with more than two states names its state instead (`data-sign="loss"`).
 */
export function flag(on: unknown): '' | undefined {
  return on ? '' : undefined;
}
