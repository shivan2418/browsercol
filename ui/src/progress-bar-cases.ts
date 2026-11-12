/** The values every progress bar is shown and tested with: inside the maximum, at it, past it, empty, negative, and no maximum. */
export const PROGRESS_CASES: { name: string; value: number; step: number; max: number }[] = [
  { name: 'in the middle', value: 50, step: 10, max: 200 },
  { name: 'empty', value: 0, step: 0, max: 200 },
  { name: 'exactly at the maximum', value: 200, step: 0, max: 200 },
  { name: 'at the maximum with a step', value: 200, step: 21, max: 200 },
  { name: 'value plus step past the maximum (188+21/200)', value: 188, step: 21, max: 200 },
  { name: 'value alone past the maximum', value: 250, step: 5, max: 200 },
  { name: 'step alone past the maximum', value: 0, step: 500, max: 200 },
  { name: 'a loss', value: 20, step: -5, max: 200 },
  { name: 'a loss bigger than the value', value: 3, step: -50, max: 200 },
  { name: 'a negative value', value: -20, step: 5, max: 200 },
  { name: 'a maximum of 0', value: 0, step: 3, max: 0 },
  { name: 'a value over a maximum of 0', value: 7, step: 3, max: 0 },
  { name: 'a negative value and a maximum of 0', value: -4, step: 3, max: 0 },
];
