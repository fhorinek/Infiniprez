import { act, fireEvent, render, screen } from '@testing-library/react'
import { JSDOM } from 'jsdom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { CanvasViewport } from '../canvas'
import {
  createEmptyDocument,
  serializeDocument,
  type CanvasObject,
  type ShapeCircleObject,
  type ShapeRectObject,
  type Slide,
} from '../model'
import { buildPresentationExportHtml } from '../persistence'
import { useEditorStore } from '../store'

const AUTOSAVE_LATEST_KEY = 'infiniprez.autosave.latest'
const AUTOSAVE_BACKUPS_KEY = 'infiniprez.autosave.backups'

function createShapeRect(overrides: Partial<ShapeRectObject> = {}): ShapeRectObject {
  return {
    id: overrides.id ?? 'rect-1',
    type: 'shape_rect',
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    w: overrides.w ?? 120,
    h: overrides.h ?? 80,
    rotation: overrides.rotation ?? 0,
    scalePercent: overrides.scalePercent ?? 100,
    keepAspectRatio: overrides.keepAspectRatio ?? false,
    locked: overrides.locked ?? false,
    zIndex: overrides.zIndex ?? 1,
    parentGroupId: overrides.parentGroupId ?? null,
    shapeData: {
      kind: 'rect',
      adjustmentPercent: 50,
      borderColor: '#9db5de',
      borderType: 'solid',
      borderWidth: 2,
      fillMode: 'solid',
      fillColor: '#244a80',
      fillGradient: null,
      radius: 0,
      opacityPercent: 100,
      shadowColor: '#000000',
      shadowBlurPx: 0,
      shadowAngleDeg: 45,
      ...(overrides.shapeData ?? {}),
    },
  }
}

function createShapeCircle(overrides: Partial<ShapeCircleObject> = {}): ShapeCircleObject {
  const rectDefaults = createShapeRect({
    id: overrides.id,
    x: overrides.x,
    y: overrides.y,
    w: overrides.w,
    h: overrides.h,
    rotation: overrides.rotation,
    locked: overrides.locked,
    zIndex: overrides.zIndex,
    parentGroupId: overrides.parentGroupId,
    shapeData: overrides.shapeData,
  })
  return {
    ...rectDefaults,
    type: 'shape_circle',
  }
}

function resetStore() {
  const state = useEditorStore.getState()
  state.resetDocument()
  state.setMode('edit')
  state.clearSelection()
  state.selectSlide(null)
  state.exitGroup()
}

function createObject(object: CanvasObject) {
  useEditorStore.getState().createObject(object)
}

function createSlide(index = 0): Slide {
  return {
    id: `slide-${index + 1}`,
    name: `Slide ${index + 1}`,
    x: 0,
    y: 0,
    zoom: 1,
    rotation: 0,
    triggerMode: 'manual',
    triggerDelayMs: 0,
    transitionType: 'ease',
    transitionDurationMs: 2000,
    orderIndex: index,
  }
}

beforeEach(() => {
  resetStore()
  window.localStorage.clear()
})

describe('integration: group isolate mode', () => {
  it('marks outside objects inactive while group is active', () => {
    const state = useEditorStore.getState()
    createObject(createShapeRect({ id: 'a', x: 0, y: 0, zIndex: 1 }))
    createObject(createShapeRect({ id: 'b', x: 200, y: 0, zIndex: 2 }))
    createObject(createShapeCircle({ id: 'c', x: 400, y: 0, zIndex: 3 }))

    state.groupObjects(['a', 'b'])
    const groupId = useEditorStore.getState().ui.selectedObjectIds[0]
    expect(groupId).toBeTruthy()
    state.enterGroup(groupId!)

    const { container } = render(<CanvasViewport />)

    const canvasObjects = container.querySelectorAll('.canvas-object')
    const outside = canvasObjects[2]
    expect(outside?.className).toContain('inactive')
  })
})

describe('integration: group deletion', () => {
  it('deletes all descendants when deleting a group', () => {
    const state = useEditorStore.getState()

    createObject(createShapeRect({ id: 'standalone', x: -200, y: 0, zIndex: 1 }))
    createObject(createShapeRect({ id: 'root-child', x: 0, y: 0, zIndex: 2, parentGroupId: 'root-group' }))
    createObject(
      createShapeRect({ id: 'nested-child', x: 200, y: 0, zIndex: 3, parentGroupId: 'nested-group' })
    )
    createObject({
      id: 'nested-group',
      type: 'group',
      x: 180,
      y: 0,
      w: 220,
      h: 160,
      rotation: 0,
      scalePercent: 100,
      keepAspectRatio: false,
      locked: false,
      zIndex: 4,
      parentGroupId: 'root-group',
      groupData: {
        childIds: ['nested-child'],
      },
    })
    createObject({
      id: 'root-group',
      type: 'group',
      x: 100,
      y: 0,
      w: 500,
      h: 220,
      rotation: 0,
      scalePercent: 100,
      keepAspectRatio: false,
      locked: false,
      zIndex: 5,
      parentGroupId: null,
      groupData: {
        childIds: ['root-child', 'nested-group'],
      },
    })

    state.deleteObjects(['root-group'])

    const remainingIds = new Set(useEditorStore.getState().document.objects.map((entry) => entry.id))
    expect(remainingIds).toEqual(new Set(['standalone']))
  })
})

describe('integration: copy/paste', () => {
  it('copies and pastes groups with child remapping', async () => {
    const state = useEditorStore.getState()
    createObject(createShapeRect({ id: 'a', x: 0, y: 0, zIndex: 1 }))
    createObject(createShapeRect({ id: 'b', x: 140, y: 0, zIndex: 2 }))
    state.groupObjects(['a', 'b'])
    const groupId = useEditorStore.getState().ui.selectedObjectIds[0]
    expect(groupId).toBeTruthy()
    state.selectObjects([groupId!])
    await act(async () => {})

    render(<CanvasViewport />)
    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true })

    const objects = useEditorStore.getState().document.objects
    expect(objects.filter((entry) => entry.type === 'group')).toHaveLength(2)
    expect(objects).toHaveLength(6)
  })

  it('resets paste offset after copying a different source selection', async () => {
    const state = useEditorStore.getState()
    createObject(createShapeRect({ id: 'rect-a', x: 0, y: 0, zIndex: 1 }))
    createObject(createShapeCircle({ id: 'circle-b', x: 200, y: 0, zIndex: 2 }))

    render(<CanvasViewport />)

    state.selectObjects(['rect-a'])
    await act(async () => {})
    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true })

    state.selectObjects(['circle-b'])
    await act(async () => {})
    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true })

    const circles = useEditorStore
      .getState()
      .document.objects.filter((entry) => entry.type === 'shape_circle')
    expect(circles).toHaveLength(2)
    const pastedCircle = circles.find((entry) => entry.id !== 'circle-b')
    expect(pastedCircle?.x).toBe(220)
  })
})

describe('integration: autosave restore', () => {
  it('restores latest autosave on app startup', () => {
    const snapshot = serializeDocument({
      ...createEmptyDocument(),
      objects: [createShapeRect({ id: 'autosave-object', zIndex: 1 })],
    })
    window.localStorage.setItem(
      AUTOSAVE_LATEST_KEY,
      JSON.stringify({ snapshot, savedAt: new Date().toISOString() })
    )

    render(<App />)

    expect(useEditorStore.getState().document.objects.some((entry) => entry.id === 'autosave-object')).toBe(
      true
    )
  })
})

describe('integration: replace document cleanup', () => {
  it('removes empty groups without mutating metadata timestamps', () => {
    const state = useEditorStore.getState()
    const document = createEmptyDocument()
    document.meta.createdAt = '2026-01-01T00:00:00.000Z'
    document.meta.updatedAt = '2026-01-02T00:00:00.000Z'
    document.objects = [
      {
        id: 'empty-group',
        type: 'group',
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        rotation: 0,
        scalePercent: 100,
        keepAspectRatio: false,
        locked: false,
        zIndex: 1,
        parentGroupId: null,
        groupData: {
          childIds: [],
        },
      },
    ]

    state.replaceDocument(document)

    expect(useEditorStore.getState().document.objects).toHaveLength(0)
    expect(useEditorStore.getState().document.meta.updatedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(useEditorStore.getState().history.past).toHaveLength(0)
  })
})

describe('integration: template creation', () => {
  it('creates template content inside a group and uses template placeholders', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /Title \+ Points/i }))

    const objects = useEditorStore.getState().document.objects
    const group = objects.find((entry) => entry.type === 'group')
    expect(group?.type).toBe('group')
    expect(group?.groupData.childIds.length).toBeGreaterThan(0)
    expect(objects.some((entry) => entry.type === 'template_placeholder')).toBe(true)
    if (group?.type === 'group') {
      const children = objects.filter((entry) => entry.parentGroupId === group.id)
      expect(children.length).toBe(group.groupData.childIds.length)
      expect(children.some((entry) => entry.type === 'template_placeholder')).toBe(true)
    }
  })
})

describe('integration: new document reset', () => {
  it('resets store state and clears autosave keys', () => {
    render(<App />)
    createObject(createShapeRect({ id: 'to-reset', zIndex: 1 }))
    expect(useEditorStore.getState().document.objects).toHaveLength(1)

    window.localStorage.setItem(AUTOSAVE_LATEST_KEY, '{"snapshot":"x","savedAt":"y"}')
    window.localStorage.setItem(AUTOSAVE_BACKUPS_KEY, '[{"snapshot":"x","savedAt":"y"}]')

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'New Document' }))

    expect(confirmSpy).toHaveBeenCalled()
    expect(useEditorStore.getState().document.objects).toHaveLength(0)
    expect(useEditorStore.getState().history.past).toHaveLength(0)
    expect(window.localStorage.getItem(AUTOSAVE_LATEST_KEY)).toBeNull()
    expect(window.localStorage.getItem(AUTOSAVE_BACKUPS_KEY)).toBeNull()
  })
})

describe('integration: scale slider', () => {
  it('scales relative to the selected object baseline instead of the zoom-neutral default', async () => {
    render(<App />)

    const object = createShapeRect({ id: 'scaled-rect', scalePercent: 200, zIndex: 1 })
    createObject(object)
    useEditorStore.getState().selectObjects([object.id])
    await act(async () => {})

    fireEvent.change(screen.getByRole('slider', { name: /^Scale\b/ }), {
      target: { value: '300' },
    })

    const updatedObject = useEditorStore
      .getState()
      .document.objects.find((entry) => entry.id === object.id)

    expect(updatedObject?.scalePercent).toBe(300)
    expect(updatedObject?.w).toBe(180)
    expect(updatedObject?.h).toBe(120)
  })

  it('keeps the linked slider value in sync when using the mouse wheel', async () => {
    render(<App />)

    const object = createShapeRect({ id: 'wheel-scale-rect', scalePercent: 200, zIndex: 1 })
    createObject(object)
    useEditorStore.getState().selectObjects([object.id])
    await act(async () => {})

    const scaleSlider = screen.getByRole('slider', { name: /^Scale\b/ })
    fireEvent.wheel(scaleSlider, { deltaY: -100 })

    const updatedObject = useEditorStore
      .getState()
      .document.objects.find((entry) => entry.id === object.id)

    expect(updatedObject?.scalePercent).toBe(201)
    expect(screen.getByText('201%')).toBeTruthy()
  })
})

describe('integration: object aspect ratio lock', () => {
  it('keeps height in sync when width changes from object parameters', async () => {
    render(<App />)

    const object = createShapeRect({ id: 'ratio-rect', w: 120, h: 80, zIndex: 1 })
    createObject(object)
    useEditorStore.getState().selectObjects([object.id])
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: 'Lock aspect ratio' }))

    const spinbuttons = screen.getAllByRole('spinbutton')
    fireEvent.change(spinbuttons[2]!, { target: { value: '240' } })

    const updatedObject = useEditorStore
      .getState()
      .document.objects.find((entry) => entry.id === object.id)

    expect(updatedObject?.w).toBe(240)
    expect(updatedObject?.h).toBe(160)
  })
})

describe('integration: keyboard undo', () => {
  it('undoes the last edit with ctrl+z', async () => {
    render(<App />)

    const object = createShapeRect({ id: 'undo-rect', zIndex: 1 })
    createObject(object)
    await act(async () => {})

    expect(useEditorStore.getState().document.objects.some((entry) => entry.id === object.id)).toBe(true)

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })

    expect(useEditorStore.getState().document.objects.some((entry) => entry.id === object.id)).toBe(false)
  })

  it('deletes selected objects with backspace', async () => {
    render(<App />)

    const object = createShapeRect({ id: 'backspace-delete-rect', zIndex: 1 })
    createObject(object)
    useEditorStore.getState().selectObjects([object.id])
    await act(async () => {})

    fireEvent.keyDown(window, { key: 'Backspace' })

    expect(
      useEditorStore.getState().document.objects.some((entry) => entry.id === object.id)
    ).toBe(false)
  })
})

describe('integration: export runtime boot', () => {
  it('boots exported runtime markup', () => {
    const html = buildPresentationExportHtml({
      ...createEmptyDocument(),
      slides: [createSlide(0)],
      objects: [createShapeRect({ id: 'render-me', zIndex: 1 })],
    })

    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'file:///tmp/presentation.html' })
    const stage = dom.window.document.getElementById('stage')
    const count = dom.window.document.getElementById('slide-count')

    expect(stage).not.toBeNull()
    expect(count?.textContent).toContain('1 / 1')
    expect(dom.window.document.querySelectorAll('.export-object')).toHaveLength(1)
  })

  it('allows embedded font and media assets in export csp', () => {
    const html = buildPresentationExportHtml({
      ...createEmptyDocument(),
      slides: [createSlide(0)],
    })

    expect(html).toContain("font-src data:")
    expect(html).toContain("media-src data: blob:")
  })

  it('excludes unused assets from exported html', () => {
    const html = buildPresentationExportHtml({
      ...createEmptyDocument(),
      slides: [createSlide(0)],
      objects: [
        {
          id: 'used-image',
          type: 'image',
          x: 0,
          y: 0,
          w: 320,
          h: 180,
          rotation: 0,
          scalePercent: 100,
          keepAspectRatio: true,
          locked: false,
          zIndex: 1,
          parentGroupId: null,
          imageData: {
            assetId: 'asset-used',
            intrinsicWidth: 320,
            intrinsicHeight: 180,
            borderColor: '#ffffff',
            borderType: 'solid',
            borderWidth: 0,
            radius: 0,
            opacityPercent: 100,
            cropEnabled: false,
            cropLeftPercent: 0,
            cropTopPercent: 0,
            cropRightPercent: 0,
            cropBottomPercent: 0,
            effectsEnabled: false,
            filterPreset: 'none',
            shadowColor: '#000000',
            shadowBlurPx: 0,
            shadowAngleDeg: 45,
          },
        },
      ],
      assets: [
        {
          id: 'asset-used',
          name: 'used-image.png',
          mimeType: 'image/png',
          dataBase64: 'USED_DATA',
          intrinsicWidth: 320,
          intrinsicHeight: 180,
        },
        {
          id: 'asset-unused',
          name: 'unused-video.mp4',
          mimeType: 'video/mp4',
          dataBase64: 'UNUSED_DATA',
          durationSec: 42,
        },
      ],
    })

    expect(html).toContain('used-image.png')
    expect(html).toContain('USED_DATA')
    expect(html).not.toContain('unused-video.mp4')
    expect(html).not.toContain('UNUSED_DATA')
  })
})

describe('integration: smoke flow', () => {
  it('creates content, creates slide, enters present mode, and exports runtime html', () => {
    render(<App />)

    createObject(createShapeRect({ id: 'smoke-rect', x: 40, y: 40, zIndex: 1 }))
    fireEvent.click(screen.getByRole('button', { name: 'Create slide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Present' }))

    expect(useEditorStore.getState().ui.mode).toBe('present')
    expect(document.querySelectorAll('.present-object')).toHaveLength(1)

    const exportedHtml = buildPresentationExportHtml(useEditorStore.getState().document)
    expect(exportedHtml).toContain('__INFINIPREZ_EXPORT__')
    expect(exportedHtml).toContain('<div id=\"stage\"></div>')
  })
})
