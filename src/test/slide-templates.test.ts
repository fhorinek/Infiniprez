import { describe, expect, it } from 'vitest'
import { STYLE_PRESETS } from '../stylePresets'
import {
  SLIDE_TEMPLATES,
  buildDefaultSlideStarterObjects,
  buildSlideTemplateInstance,
  getSlideTemplatesForStyle,
  getSlideTemplateFrameSize,
  resolveSlideTemplateTheme,
} from '../slideTemplates'
import { DEFAULT_TARGET_FRAME_HEIGHT, DEFAULT_TARGET_FRAME_WIDTH, zoomFromDiagonal } from '../slideDiagonal'

describe('slide templates', () => {
  it('defines a reusable set of slide layout templates', () => {
    expect(SLIDE_TEMPLATES).toHaveLength(20)
    expect(SLIDE_TEMPLATES.map((template) => template.id)).toEqual([
      'title-points',
      'title-description',
      'title-image',
      'section-break',
      'two-column',
      'comparison',
      'timeline',
      'metrics',
      'gallery',
      'closing-cta',
      'atlas-blueprint',
      'slate-curve',
      'ocean-current',
      'ember-candy',
      'forest-path',
      'mono-grid',
      'studio-focus',
      'tech-growth',
      'royal-glow',
      'sand-honey',
    ])
    expect(SLIDE_TEMPLATES.every((template) => template.section === 'generic')).toBe(true)
  })

  it('returns one generic template set regardless of active style preset', () => {
    const stylePresetId = STYLE_PRESETS[0]?.id
    expect(stylePresetId).toBeTruthy()
    const withStylePreset = getSlideTemplatesForStyle(stylePresetId)
    const withoutStylePreset = getSlideTemplatesForStyle(null)
    expect(withStylePreset.generic).toEqual(withoutStylePreset.generic)
    expect(withStylePreset.all).toEqual(withStylePreset.generic)
    expect(withStylePreset.generic.every((template) => template.section === 'generic')).toBe(true)
  })

  it('builds layout slides using the active style palette and font', () => {
    const template = SLIDE_TEMPLATES.find((entry) => entry.id === 'title-points')
    expect(template).toBeTruthy()
    if (!template) {
      return
    }
    const stylePreset = STYLE_PRESETS[0]
    const { slide, objects } = buildSlideTemplateInstance(template, {
      slideId: 'slide-template-1',
      orderIndex: 2,
      centerX: 500,
      centerY: -240,
      zoom: 2,
      rotation: Math.PI / 8,
      createId: (() => {
        let count = 0
        return () => `obj-${++count}`
      })(),
      zIndexStart: 10,
      stylePreset,
    })

    expect(slide.name).toBe('Title + Points 3')
    expect(objects.length).toBeGreaterThan(0)
    expect(objects.every((object) => object.parentGroupId === null)).toBe(true)
    expect(objects.every((object) => object.rotation === slide.rotation)).toBe(true)
    expect(objects[0]?.w).toBeCloseTo(800, 6)
    expect(objects[0]?.h).toBeCloseTo(450, 6)
    const placeholder = objects.find((object) => object.type === 'template_placeholder')
    expect(placeholder?.type).toBe('template_placeholder')
    if (placeholder?.type === 'template_placeholder') {
      expect(placeholder.templatePlaceholderData.prompt).toBeTruthy()
    }
    const themedShape = objects.find(
      (object) => object.type === 'shape_rect' && object.shapeData.borderColor === stylePreset.textboxBorder
    )
    expect(themedShape).toBeTruthy()
  })

  it('keeps rounded corners visually consistent across template zoom levels', () => {
    const template = SLIDE_TEMPLATES.find((entry) => entry.id === 'title-points')
    expect(template).toBeTruthy()
    if (!template) {
      return
    }
    const createId = (() => {
      let count = 0
      return () => `obj-${++count}`
    })()
    const zoom1Objects = buildSlideTemplateInstance(template, {
      slideId: 'slide-template-zoom-1',
      orderIndex: 0,
      centerX: 0,
      centerY: 0,
      zoom: 1,
      rotation: 0,
      createId,
      zIndexStart: 1,
      stylePreset: STYLE_PRESETS[0],
    }).objects
    const zoom2Slide = buildSlideTemplateInstance(template, {
      slideId: 'slide-template-zoom-2',
      orderIndex: 1,
      centerX: 0,
      centerY: 0,
      zoom: 2,
      rotation: 0,
      createId,
      zIndexStart: 1,
      stylePreset: STYLE_PRESETS[0],
    })
    const zoom1ScreenRadii = zoom1Objects
      .filter((object): object is Extract<(typeof zoom1Objects)[number], { type: 'shape_rect' }> => object.type === 'shape_rect')
      .map((object) => object.shapeData.radius)
      .filter((radius) => radius > 0)
    const zoom2ScreenRadii = zoom2Slide.objects
      .filter((object): object is Extract<(typeof zoom2Slide.objects)[number], { type: 'shape_rect' }> => object.type === 'shape_rect')
      .map(
        (object) =>
          object.shapeData.radius *
          zoomFromDiagonal(
            zoom2Slide.slide.diagonal,
            DEFAULT_TARGET_FRAME_WIDTH,
            DEFAULT_TARGET_FRAME_HEIGHT
          )
      )
      .filter((radius) => radius > 0)

    expect(zoom2ScreenRadii).toEqual(zoom1ScreenRadii)
  })

  it('returns a zoom-scaled template frame size', () => {
    expect(getSlideTemplateFrameSize(1)).toEqual({
      width: 1600,
      height: 900,
      gap: 180,
    })
    expect(getSlideTemplateFrameSize(2)).toEqual({
      width: 800,
      height: 450,
      gap: 90,
    })
  })

  it('derives a layout theme from the active document style preset', () => {
    const theme = resolveSlideTemplateTheme(STYLE_PRESETS[0])
    expect(theme.fontFamily).toBe(STYLE_PRESETS[0].fontFamily)
    expect(theme.accent).toBe(STYLE_PRESETS[0].objectStyles.find((entry) => entry.id === 'accent-item')?.fillColor)
    expect(theme.surface).toBe(STYLE_PRESETS[0].textboxBackground)
    expect(theme.text).toBe(STYLE_PRESETS[0].textColor)
  })

  it('builds starter title and bullet textboxes for plain slides', () => {
    const objects = buildDefaultSlideStarterObjects({
      centerX: 0,
      centerY: 0,
      zoom: 1,
      rotation: 0,
      createId: (() => {
        let count = 0
        return () => `starter-${++count}`
      })(),
      zIndexStart: 4,
      stylePreset: STYLE_PRESETS[0],
    })

    expect(objects).toHaveLength(2)
    expect(objects.every((object) => object.type === 'textbox')).toBe(true)
    const title = objects[0]
    const bullets = objects[1]
    expect(title?.type).toBe('textbox')
    expect(bullets?.type).toBe('textbox')
    if (title?.type === 'textbox' && bullets?.type === 'textbox') {
      expect(title.textboxData.runs[0]?.text).toBe('Slide title')
      expect(bullets.textboxData.listType).toBe('bullet')
      expect(bullets.textboxData.richTextHtml).toContain('Point one')
    }
  })
})
