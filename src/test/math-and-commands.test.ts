import { describe, expect, it } from 'vitest'
import {
  cameraDragDeltaToWorld,
  rotatePoint,
  screenToWorld,
  worldToScreen,
} from '../canvas/math'
import {
  createEmptyHistory,
  createObjectCommand,
  deleteObjectsCommand,
  executeCommand,
  moveObjectCommand,
  redoCommand,
  undoCommand,
} from '../commands'
import { createEmptyDocument, type CanvasObject } from '../model'

function createRectObject(): CanvasObject {
  return {
    id: 'rect-1',
    type: 'shape_rect',
    x: 100,
    y: 50,
    w: 120,
    h: 80,
    rotation: 0.3,
    locked: false,
    zIndex: 1,
    parentGroupId: null,
    shapeData: {
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
    },
  }
}

describe('geometry transforms', () => {
  it('converts world -> screen -> world round-trip', () => {
    const camera = { x: 120, y: -20, zoom: 1.7, rotation: 0.5 }
    const viewport = { width: 1200, height: 800 }
    const worldPoint = { x: -42, y: 380 }
    const screenPoint = worldToScreen(worldPoint, camera, viewport)
    const worldBack = screenToWorld(screenPoint, camera, viewport)

    expect(worldBack.x).toBeCloseTo(worldPoint.x, 6)
    expect(worldBack.y).toBeCloseTo(worldPoint.y, 6)
  })

  it('converts camera drag delta through camera rotation', () => {
    const camera = { x: 0, y: 0, zoom: 2, rotation: Math.PI / 2 }
    const worldDelta = cameraDragDeltaToWorld({ x: 20, y: 0 }, camera)

    expect(worldDelta.x).toBeCloseTo(0, 6)
    expect(worldDelta.y).toBeCloseTo(-10, 6)
  })

  it('rotates a point around origin', () => {
    const rotated = rotatePoint({ x: 10, y: 0 }, Math.PI / 2)
    expect(rotated.x).toBeCloseTo(0, 6)
    expect(rotated.y).toBeCloseTo(10, 6)
  })
})

describe('command reducers', () => {
  it('supports execute/undo/redo for object create and move', () => {
    const object = createRectObject()
    const history = createEmptyHistory<ReturnType<typeof createEmptyDocument>>()
    const initialState = createEmptyDocument()

    const created = executeCommand(initialState, history, createObjectCommand(object))
    expect(created.state.objects).toHaveLength(1)

    const moved = executeCommand(
      created.state,
      created.history,
      moveObjectCommand(
        object.id,
        { x: object.x, y: object.y, w: object.w, h: object.h, rotation: object.rotation },
        { x: object.x + 20, y: object.y + 40, w: object.w, h: object.h, rotation: object.rotation }
      )
    )
    expect(moved.state.objects[0]?.x).toBe(object.x + 20)
    expect(moved.state.objects[0]?.y).toBe(object.y + 40)

    const undone = undoCommand(moved.state, moved.history)
    expect(undone.state.objects[0]?.x).toBe(object.x)
    expect(undone.state.objects[0]?.y).toBe(object.y)

    const redone = redoCommand(undone.state, undone.history)
    expect(redone.state.objects[0]?.x).toBe(object.x + 20)
    expect(redone.state.objects[0]?.y).toBe(object.y + 40)
  })

  it('restores deleted objects on undo', () => {
    const object = createRectObject()
    const initialState = createObjectCommand(object).execute(createEmptyDocument())
    const deleted = deleteObjectsCommand([object.id], [{ object, index: 0 }]).execute(initialState)
    expect(deleted.objects).toHaveLength(0)

    const restored = deleteObjectsCommand([object.id], [{ object, index: 0 }]).undo(deleted)
    expect(restored.objects).toHaveLength(1)
    expect(restored.objects[0]?.id).toBe(object.id)
  })
})
