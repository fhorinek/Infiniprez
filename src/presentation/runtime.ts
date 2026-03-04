import type { Slide } from '../model'

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
  return easeInOutCubic(clamped)
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
