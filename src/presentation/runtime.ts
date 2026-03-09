import type { Slide } from '../model'

export interface CameraLike {
  x: number
  y: number
  zoom: number
  rotation: number
}

export const PRESENTATION_FORWARD_KEYS = ['Right', 'ArrowRight', 'ArrowDown', 'PageDown', ' '] as const
export const PRESENTATION_BACKWARD_KEYS = ['Left', 'ArrowLeft', 'ArrowUp', 'PageUp'] as const

export function easeInOutCubic(t: number) {
  if (t < 0.5) {
    return 4 * t * t * t
  }
  return 1 - (-2 * t + 2) ** 3 / 2
}

export function resolveTransitionProgress(
  transitionType: Slide['transitionType'],
  progress: number
): number {
  const clamped = Math.max(0, Math.min(1, progress))
  if (transitionType === 'linear') {
    return clamped
  }
  if (transitionType === 'instant') {
    return clamped >= 1 ? 1 : 0
  }
  if (clamped < 0.5) {
    return 4 * clamped * clamped * clamped
  }
  return 1 - (-2 * clamped + 2) ** 3 / 2
}

export function resolveTransitionDurationMs(
  transitionType: Slide['transitionType'],
  durationMs: number
): number {
  const rounded = Math.round(durationMs)
  if (transitionType === 'instant') {
    return Math.max(0, Math.min(10_000, rounded))
  }
  return Math.max(1_000, Math.min(10_000, rounded))
}

export function shouldAutoAdvanceSlide(
  slide: Slide | null,
  slideIndex: number,
  totalSlides: number
): boolean {
  if (!slide) {
    return false
  }
  if (slide.triggerMode !== 'timed') {
    return false
  }
  return slideIndex >= 0 && slideIndex < totalSlides - 1
}

export function interpolateCamera<T extends CameraLike>(start: T, end: T, t: number): T {
  return {
    ...start,
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    zoom: start.zoom + (end.zoom - start.zoom) * t,
    rotation: start.rotation + (end.rotation - start.rotation) * t,
  }
}

export function isForwardPresentationKey(key: string): boolean {
  return PRESENTATION_FORWARD_KEYS.includes(key as (typeof PRESENTATION_FORWARD_KEYS)[number])
}

export function isBackwardPresentationKey(key: string): boolean {
  return PRESENTATION_BACKWARD_KEYS.includes(key as (typeof PRESENTATION_BACKWARD_KEYS)[number])
}
