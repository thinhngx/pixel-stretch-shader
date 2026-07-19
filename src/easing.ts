// Easing curves for the v3 pick animator (pick(t) = lerp(start, end, ease(t))).
// Deliberately unused in v2 — wired up when animated exports land in v3.
// Pure functions t -> t', defined on [0, 1] with f(0) = 0 and f(1) = 1.

export type EasingName = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'ease-out-in'
export type Easing = (t: number) => number

export const EASINGS: Record<EasingName, Easing> = {
  linear: (t) => t,
  'ease-in': (t) => t ** 3,
  'ease-out': (t) => 1 - (1 - t) ** 3,
  'ease-in-out': (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2),
  // Mirror of ease-in-out: fast -> slow at the midpoint -> fast.
  'ease-out-in': (t) => (t < 0.5 ? (1 - (1 - 2 * t) ** 3) / 2 : 0.5 + (2 * t - 1) ** 3 / 2),
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
