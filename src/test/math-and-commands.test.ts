import { describe, expect, it } from 'vitest'
import {
  getAlignmentBounds,
  getAlignmentDeltas,
  type AlignmentUnit,
} from '../canvas/alignment'
import {
  cameraDragDeltaToWorld,
  rotatePoint,
  screenToWorld,
  worldToScreen,
} from '../canvas/math'
import {
  createAssetCommand,
  createEmptyHistory,
  createObjectCommand,
  deleteObjectsCommand,
  executeCommand,
  moveObjectCommand,
  redoCommand,
  setCanvasSettingsCommand,
  undoCommand,
} from '../commands'
import { findMatchingLibraryAsset } from '../assetFile'
import { createEmptyDocument, deserializeDocument, type CanvasObject } from '../model'
import { createDefaultImageData, createDefaultVideoData, getDefaultPlacedMediaSize } from '../objectDefaults'
import { resolveTextboxBaseTextStyle } from '../textboxRichText'

function createRectObject(): CanvasObject {
  return {
    id: 'rect-1',
    type: 'shape_rect',
    x: 100,
    y: 50,
    w: 120,
    h: 80,
    rotation: 0.3,
    scalePercent: 100,
    keepAspectRatio: false,
    locked: false,
    zIndex: 1,
    parentGroupId: null,
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

describe('alignment helpers', () => {
  const units: AlignmentUnit[] = [
    {
      id: 'a',
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    },
    {
      id: 'b',
      bounds: { minX: 35, minY: 15, maxX: 65, maxY: 30 },
    },
    {
      id: 'c',
      bounds: { minX: 90, minY: 35, maxX: 110, maxY: 50 },
    },
  ]

  it('computes shared bounds for a selection', () => {
    expect(getAlignmentBounds(units)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 110,
      maxY: 50,
    })
  })

  it('aligns all units to the left edge', () => {
    expect(getAlignmentDeltas(units, 'left')).toEqual([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: -35, y: 0 },
      { id: 'c', x: -90, y: 0 },
    ])
  })

  it('aligns units to shared horizontal and vertical centers independently', () => {
    expect(getAlignmentDeltas(units, 'center-horizontal')).toEqual([
      { id: 'a', x: 45, y: 0 },
      { id: 'b', x: 5, y: 0 },
      { id: 'c', x: -45, y: 0 },
    ])
    expect(getAlignmentDeltas(units, 'center-vertical')).toEqual([
      { id: 'a', x: 0, y: 20 },
      { id: 'b', x: 0, y: 2.5 },
      { id: 'c', x: 0, y: -17.5 },
    ])
  })

  it('distributes units horizontally across the current span', () => {
    expect(getAlignmentDeltas(units, 'distribute-horizontal')).toEqual([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 5, y: 0 },
      { id: 'c', x: 0, y: 0 },
    ])
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
        {
          x: object.x,
          y: object.y,
          w: object.w,
          h: object.h,
          rotation: object.rotation,
          scalePercent: object.scalePercent,
        },
        {
          x: object.x + 20,
          y: object.y + 40,
          w: object.w,
          h: object.h,
          rotation: object.rotation,
          scalePercent: object.scalePercent,
        }
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

  it('updates canvas settings with undo support', () => {
    const initialState = createEmptyDocument()
    const nextCanvas = {
      ...initialState.canvas,
      baseGridSize: 160,
      gridVisible: false,
      snapToGrid: false,
      snapToObjectEdges: false,
    }

    const updated = setCanvasSettingsCommand(initialState.canvas, nextCanvas).execute(initialState)
    expect(updated.canvas.baseGridSize).toBe(160)
    expect(updated.canvas.gridVisible).toBe(false)
    expect(updated.canvas.snapToGrid).toBe(false)
    expect(updated.canvas.snapToObjectEdges).toBe(false)

    const restored = setCanvasSettingsCommand(initialState.canvas, nextCanvas).undo(updated)
    expect(restored.canvas).toEqual(initialState.canvas)
  })
})

describe('document deserialization', () => {
  it('rejects legacy arrow objects', () => {
    const baseRect = createRectObject() as Extract<CanvasObject, { type: 'shape_rect' }>
    const legacyArrowDocument = {
      ...createEmptyDocument(),
      objects: [
        {
          ...baseRect,
          id: 'arrow-1',
          type: 'shape_arrow',
          w: 320,
          h: 60,
          shapeData: {
            ...baseRect.shapeData,
            kind: 'rect',
            fillColor: 'transparent',
          },
        },
      ],
    }

    expect(() => deserializeDocument(JSON.stringify(legacyArrowDocument))).toThrow()
  })

  it('accepts textbox payloads without legacy content scale fields', () => {
    const document = deserializeDocument(JSON.stringify({
      ...createEmptyDocument(),
      objects: [
        {
          id: 'textbox-1',
          type: 'textbox',
          x: 0,
          y: 0,
          w: 320,
          h: 120,
          rotation: 0,
          keepAspectRatio: false,
          locked: false,
          zIndex: 1,
          parentGroupId: null,
          textboxData: {
            runs: [],
            richTextHtml: '<p>Text</p>',
            fontFamily: 'Space Grotesk',
            alignment: 'left',
            listType: 'none',
            autoHeight: true,
            fillMode: 'solid',
            backgroundColor: 'transparent',
            fillGradient: null,
            borderColor: '#000000',
            borderType: 'solid',
            borderWidth: 0,
            radius: 0,
            opacityPercent: 100,
            shadowColor: '#000000',
            shadowBlurPx: 0,
            shadowAngleDeg: 45,
          },
        },
      ],
    }))

    expect(document.objects[0]?.type).toBe('textbox')
  })

})

describe('object defaults', () => {
  it('locks aspect ratio by default for created images and videos', () => {
    expect(createDefaultImageData('asset-1', 1200, 800).intrinsicWidth).toBe(1200)
    expect(createDefaultVideoData('asset-2', 1280, 720).intrinsicHeight).toBe(720)
  })

  it('uses the same inverse-zoom media sizing for dropped assets', () => {
    const soundFrame = getDefaultPlacedMediaSize('sound', 1, 1, 10)
    expect(soundFrame.w).toBeCloseTo(22)
    expect(soundFrame.h).toBeCloseTo(5.6)

    const imageFrame = getDefaultPlacedMediaSize('image', 1200, 800, 10)
    expect(imageFrame.w).toBeCloseTo(26)
    expect(imageFrame.h).toBeCloseTo(17.3333333333)

    const videoFrame = getDefaultPlacedMediaSize('video', 1280, 720, 0.5)
    expect(videoFrame.w).toBeCloseTo(640)
    expect(videoFrame.h).toBeCloseTo(360)
  })
})

describe('asset dedupe', () => {
  it('finds an existing asset with the same payload', () => {
    const existing = {
      id: 'asset-1',
      name: 'logo.png',
      mimeType: 'image/png',
      dataBase64: 'SAME_DATA',
      intrinsicWidth: 200,
      intrinsicHeight: 100,
      durationSec: null,
    }

    expect(findMatchingLibraryAsset([existing], { dataBase64: 'SAME_DATA' })).toEqual(existing)
    expect(findMatchingLibraryAsset([existing], { dataBase64: 'OTHER_DATA' })).toBeNull()
  })

  it('does not add duplicate assets with the same payload', () => {
    const initial = {
      ...createEmptyDocument(),
      assets: [
        {
          id: 'asset-1',
          name: 'logo.png',
          mimeType: 'image/png',
          dataBase64: 'SAME_DATA',
          intrinsicWidth: 200,
          intrinsicHeight: 100,
          durationSec: null,
        },
      ],
    }

    const command = createAssetCommand({
      id: 'asset-2',
      name: 'logo-copy.png',
      mimeType: 'image/png',
      dataBase64: 'SAME_DATA',
      intrinsicWidth: 200,
      intrinsicHeight: 100,
      durationSec: null,
    })

    expect(command.execute(initial).assets).toHaveLength(1)
  })
})

describe('textbox rich text helpers', () => {
  it('infers list marker base style from rich html', () => {
    const style = resolveTextboxBaseTextStyle({
      runs: [
        {
          text: 'Item 1',
          bold: false,
          italic: false,
          underline: false,
          color: '#111111',
          fontSize: 18,
        },
      ],
      richTextHtml:
        '<ul><li><span style="font-family: Georgia; font-size: 32px; color: rgb(12, 34, 56);">Item 1</span></li></ul>',
      fontFamily: 'Space Grotesk',
      alignment: 'left',
      listType: 'bullet',
      autoHeight: true,
      fillMode: 'solid',
      backgroundColor: 'transparent',
      fillGradient: null,
      borderColor: '#000000',
      borderType: 'solid',
      borderWidth: 0,
      radius: 0,
      opacityPercent: 100,
      shadowColor: '#000000',
      shadowBlurPx: 0,
      shadowAngleDeg: 45,
    })

    expect(style.fontFamily).toBe('Georgia')
    expect(style.fontSizePx).toBe(32)
    expect(style.textColor).toBe('rgb(12, 34, 56)')
  })
})
