import { describe, expect, it } from 'vitest'
import type { Slide } from '../model'
import {
  isBackwardPresentationKey,
  isForwardPresentationKey,
  PRESENTATION_BACKWARD_KEYS,
  PRESENTATION_FORWARD_KEYS,
  resolveTransitionDurationMs,
  resolveTransitionProgress,
  shouldAutoAdvanceSlide,
} from '../presentation'

function createSlide(overrides: Partial<Slide> = {}): Slide {
  return {
    id: 'slide-1',
    name: 'Slide 1',
    x: 0,
    y: 0,
    zoom: 1,
    rotation: 0,
    triggerMode: 'manual',
    triggerDelayMs: 0,
    transitionType: 'ease',
    transitionDurationMs: 2000,
    orderIndex: 0,
    ...overrides,
  }
}

describe('slide timing and transition selection', () => {
  it('resolves transition easing by type', () => {
    expect(resolveTransitionProgress('linear', 0.5)).toBeCloseTo(0.5, 6)
    expect(resolveTransitionProgress('instant', 0.5)).toBe(0)
    expect(resolveTransitionProgress('instant', 1)).toBe(1)
    expect(resolveTransitionProgress('ease', 0.5)).toBeCloseTo(0.5, 6)
  })

  it('clamps transition duration based on transition type', () => {
    expect(resolveTransitionDurationMs('linear', 200)).toBe(1000)
    expect(resolveTransitionDurationMs('ease', 99_999)).toBe(10_000)
    expect(resolveTransitionDurationMs('instant', -100)).toBe(0)
    expect(resolveTransitionDurationMs('instant', 12_000)).toBe(10_000)
  })

  it('decides auto-advance only for timed non-last slides', () => {
    expect(shouldAutoAdvanceSlide(createSlide({ triggerMode: 'manual' }), 0, 3)).toBe(false)
    expect(shouldAutoAdvanceSlide(createSlide({ triggerMode: 'timed' }), 0, 3)).toBe(true)
    expect(shouldAutoAdvanceSlide(createSlide({ triggerMode: 'timed' }), 2, 3)).toBe(false)
    expect(shouldAutoAdvanceSlide(null, 0, 3)).toBe(false)
  })

  it('shares presentation keyboard bindings', () => {
    expect(PRESENTATION_FORWARD_KEYS).toContain('ArrowRight')
    expect(PRESENTATION_FORWARD_KEYS).toContain(' ')
    expect(PRESENTATION_BACKWARD_KEYS).toContain('ArrowLeft')
    expect(isForwardPresentationKey('PageDown')).toBe(true)
    expect(isBackwardPresentationKey('PageUp')).toBe(true)
    expect(isForwardPresentationKey('Escape')).toBe(false)
  })
})
