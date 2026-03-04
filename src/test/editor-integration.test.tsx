import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { CanvasViewport } from '../canvas'
import {
  createEmptyDocument,
  serializeDocument,
  type CanvasObject,
  type ShapeCircleObject,
  type ShapeRectObject,
} from '../model'
import { useEditorStore } from '../store'

const AUTOSAVE_LATEST_KEY = 'infiniprez.autosave.latest'

function createShapeRect(overrides: Partial<ShapeRectObject> = {}): ShapeRectObject {
  return {
    id: overrides.id ?? 'rect-1',
    type: 'shape_rect',
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    w: overrides.w ?? 120,
    h: overrides.h ?? 80,
    rotation: overrides.rotation ?? 0,
    locked: overrides.locked ?? false,
    zIndex: overrides.zIndex ?? 1,
    parentGroupId: overrides.parentGroupId ?? null,
    shapeData: {
      borderColor: '#9db5de',
      borderType: 'solid',
      borderWidth: 2,
      fillMode: 'solid',
      fillColor: '#244a80',
      fillGradient: null,
      opacityPercent: 100,
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

    render(<CanvasViewport />)

    const outside = screen.getByText('Circle').closest('.canvas-object')
    expect(outside?.className).toContain('inactive')
  })
})

describe('integration: copy/paste', () => {
  it('copies and pastes groups with child remapping', () => {
    const state = useEditorStore.getState()
    createObject(createShapeRect({ id: 'a', x: 0, y: 0, zIndex: 1 }))
    createObject(createShapeRect({ id: 'b', x: 140, y: 0, zIndex: 2 }))
    state.groupObjects(['a', 'b'])
    const groupId = useEditorStore.getState().ui.selectedObjectIds[0]
    expect(groupId).toBeTruthy()
    state.selectObjects([groupId!])

    render(<CanvasViewport />)
    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true })

    const objects = useEditorStore.getState().document.objects
    expect(objects.filter((entry) => entry.type === 'group')).toHaveLength(2)
    expect(objects).toHaveLength(6)
  })

  it('resets paste offset after copying a different source selection', () => {
    const state = useEditorStore.getState()
    createObject(createShapeRect({ id: 'rect-a', x: 0, y: 0, zIndex: 1 }))
    createObject(createShapeCircle({ id: 'circle-b', x: 200, y: 0, zIndex: 2 }))

    render(<CanvasViewport />)

    state.selectObjects(['rect-a'])
    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true })

    state.selectObjects(['circle-b'])
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
