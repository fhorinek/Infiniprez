import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { CanvasViewport } from '../canvas'
import type { CanvasObject, ShapeCircleObject, ShapeRectObject } from '../model'
import { useEditorStore } from '../store'

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
