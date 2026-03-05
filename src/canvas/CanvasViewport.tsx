import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowsDownToLine,
  faArrowsUpToLine,
  faArrowDown,
  faArrowUp,
  faClone,
  faCompass,
  faCropSimple,
  faFileImport,
  faLayerGroup,
  faLock,
  faLockOpen,
  faMagnifyingGlass,
  faObjectUngroup,
  faPenToSquare,
  faSliders,
  faTrashCan,
} from '@fortawesome/free-solid-svg-icons'
import {
  canReorderLayer,
  type Asset,
  type CanvasObject,
  type FillGradient,
  type LayerOrderAction,
  type ShapeData,
  type TextRun,
} from '../model'
import { useEditorStore } from '../store'
import { type CameraState } from '../store/types'
import {
  cameraDragDeltaToWorld,
  clamp,
  getDynamicGridStep,
  getViewWorldBounds,
  rotatePoint,
  screenToWorld,
  type Point,
  type ViewportSize,
  worldToScreen,
} from './math'
import { RichTextboxEditor } from './RichTextboxEditor'
import { resolveTextboxRichHtml, richHtmlToPlainText } from '../textboxRichText'
import {
  SUPPORTED_IMAGE_ACCEPT,
  getImageDimensions,
  isSupportedImageFile,
  readFileAsDataUrl,
  toAssetBase64,
} from '../imageFile'
import { IMAGE_FILTER_OPTIONS, resolveImageFilterCss } from '../imageEffects'
import { resolveObjectDropShadowFilter, resolveObjectShadowCss } from '../objectShadow'

interface GridLine {
  id: string
  value: number
}

interface PanInteraction {
  pointerId: number
  originClient: Point
  cameraStart: CameraState
}

type TransformSnapshot = Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'rotation'>

interface ObjectInteraction {
  pointerId: number
  targets: Array<{
    id: string
    objectType: CanvasObject['type']
    start: TransformSnapshot
  }>
  mode: 'move' | 'resize' | 'rotate'
  originClient: Point
  cameraStart: CameraState
  centerStart: Point
  selectionBoundsStart: Rect
  selectionFrameStart: SelectionFrameState | null
  centerScreenStart: Point
  startPointerAngle: number
}

type CropHandle =
  | 'move'
  | 'left'
  | 'top'
  | 'right'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-right'
  | 'bottom-left'

interface ImageCropInteraction {
  pointerId: number
  objectId: string
  handle: CropHandle
  originClient: Point
  cameraStart: CameraState
  startLeftPercent: number
  startTopPercent: number
  startRightPercent: number
  startBottomPercent: number
  objectWidth: number
  objectHeight: number
  objectRotation: number
}

interface MarqueeInteraction {
  pointerId: number
  startScreen: Point
  currentScreen: Point
  baseSelection: string[]
  toggleObjectId: string | null
}

interface Rect {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface SelectionFrame {
  center: Point
  width: number
  height: number
  rotation: number
}

interface SelectionFrameState extends SelectionFrame {
  selectionKey: string
}

interface SnapCandidateEdges {
  x: number[]
  y: number[]
}

interface ClipboardState {
  objects: CanvasObject[]
  sourceSelectionKey: string
  selectedRootIds: string[]
  pasteCount: number
}

interface ContextMenuState {
  x: number
  y: number
  selectionIds: string[]
}

interface TextboxPointerState {
  objectId: string
  timestampMs: number
}

const DOUBLE_CLICK_MS = 500
const CAMERA_ROTATION_STEP_RAD = (10 * Math.PI) / 180
const TEXTBOX_CAMERA_ROTATION_TRANSITION_MS = 220
const DEFAULT_TEXTBOX_BACKGROUND = '#1f3151'
const DEFAULT_TEXTBOX_BORDER_COLOR = '#b2c6ee'
const DEFAULT_TEXTBOX_BORDER_WIDTH = 1
const TEXTBOX_LINE_HEIGHT = 1.35

function easeInOutCubic(value: number): number {
  if (value < 0.5) {
    return 4 * value * value * value
  }
  const mirrored = -2 * value + 2
  return 1 - (mirrored * mirrored * mirrored) / 2
}

function getShortestAngleDelta(from: number, to: number): number {
  let delta = to - from
  while (delta > Math.PI) {
    delta -= Math.PI * 2
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2
  }
  return delta
}

function normalizeRotationRadians(angle: number): number {
  let normalized = angle
  const fullTurn = Math.PI * 2
  while (normalized > Math.PI) {
    normalized -= fullTurn
  }
  while (normalized <= -Math.PI) {
    normalized += fullTurn
  }
  return normalized
}

function createDefaultTextRun(text = ''): TextRun {
  return {
    text,
    bold: false,
    italic: false,
    underline: false,
    color: '#f0f3fc',
    fontSize: 28,
  }
}

function haveSameRunStyle(a: TextRun, b: TextRun): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.color === b.color &&
    a.fontSize === b.fontSize
  )
}

function normalizeTextboxRuns(runs: TextRun[]): TextRun[] {
  const normalized = runs.length > 0 ? runs : [createDefaultTextRun('')]
  const merged: TextRun[] = []

  for (const run of normalized) {
    const safeRun = { ...createDefaultTextRun(''), ...run }
    const previous = merged[merged.length - 1]
    if (previous && haveSameRunStyle(previous, safeRun)) {
      previous.text += safeRun.text
    } else {
      merged.push({ ...safeRun })
    }
  }

  if (merged.length === 0) {
    return [createDefaultTextRun('')]
  }
  return merged
}

function useViewportSize(ref: RefObject<HTMLElement>) {
  const [size, setSize] = useState<ViewportSize>({ width: 1, height: 1 })

  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }

      const { width, height } = entry.contentRect
      setSize({
        width: Math.max(1, width),
        height: Math.max(1, height),
      })
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return size
}

function createGridLines(min: number, max: number, step: number): GridLine[] {
  const safeStep = Math.max(0.00001, step)
  const start = Math.floor(min / safeStep) * safeStep
  const lines: GridLine[] = []

  for (let value = start; value <= max + safeStep; value += safeStep) {
    lines.push({
      id: value.toFixed(3),
      value,
    })
  }

  return lines
}

function getShapeBackground(shapeData: ShapeData): string {
  if (shapeData.fillMode === 'linearGradient' && shapeData.fillGradient) {
    const gradient = shapeData.fillGradient
    const stops =
      Array.isArray(gradient.stops) && gradient.stops.length >= 2
        ? [...gradient.stops]
          .slice(0, 5)
          .sort((a, b) => a.positionPercent - b.positionPercent)
          .map((stop) => `${stop.color} ${Math.max(0, Math.min(100, stop.positionPercent))}%`)
        : [`${gradient.colorA} 0%`, `${gradient.colorB} 100%`]
    if (gradient.gradientType === 'circles') {
      const layers =
        Array.isArray(gradient.stops) && gradient.stops.length >= 2
          ? gradient.stops
            .slice(0, 5)
            .map((stop, index) => {
              const xPercent = Math.max(
                0,
                Math.min(100, Math.round(Number(stop.xPercent ?? (index === 0 ? 35 : 65))))
              )
              const yPercent = Math.max(0, Math.min(100, Math.round(Number(stop.yPercent ?? 50))))
              const radiusPercent = Math.max(8, Math.min(100, Math.round(Number(stop.positionPercent ?? 42))))
              return `radial-gradient(circle at ${xPercent}% ${yPercent}%, ${stop.color} 0%, transparent ${radiusPercent}%)`
            })
            .join(', ')
          : ''
      if (layers.length > 0) {
        return `${layers}, ${gradient.colorB}`
      }
    }
    if (gradient.gradientType === 'radial') {
      return `radial-gradient(circle, ${stops.join(', ')})`
    }
    return `linear-gradient(${gradient.angleDeg}deg, ${stops.join(', ')})`
  }
  return shapeData.fillColor
}

function getTextboxBackground(
  textboxData: Extract<CanvasObject, { type: 'textbox' }>['textboxData']
): string {
  if (textboxData.fillMode === 'linearGradient' && textboxData.fillGradient) {
    const gradient = textboxData.fillGradient
    const stops =
      Array.isArray(gradient.stops) && gradient.stops.length >= 2
        ? [...gradient.stops]
          .slice(0, 5)
          .sort((a, b) => a.positionPercent - b.positionPercent)
          .map((stop) => `${stop.color} ${Math.max(0, Math.min(100, stop.positionPercent))}%`)
        : [`${gradient.colorA} 0%`, `${gradient.colorB} 100%`]
    if (gradient.gradientType === 'circles') {
      const layers =
        Array.isArray(gradient.stops) && gradient.stops.length >= 2
          ? gradient.stops
            .slice(0, 5)
            .map((stop, index) => {
              const xPercent = Math.max(
                0,
                Math.min(100, Math.round(Number(stop.xPercent ?? (index === 0 ? 35 : 65))))
              )
              const yPercent = Math.max(0, Math.min(100, Math.round(Number(stop.yPercent ?? 50))))
              const radiusPercent = Math.max(8, Math.min(100, Math.round(Number(stop.positionPercent ?? 42))))
              return `radial-gradient(circle at ${xPercent}% ${yPercent}%, ${stop.color} 0%, transparent ${radiusPercent}%)`
            })
            .join(', ')
          : ''
      if (layers.length > 0) {
        return `${layers}, ${gradient.colorB}`
      }
    }
    if (gradient.gradientType === 'radial') {
      return `radial-gradient(circle, ${stops.join(', ')})`
    }
    return `linear-gradient(${gradient.angleDeg}deg, ${stops.join(', ')})`
  }
  return textboxData.backgroundColor ?? DEFAULT_TEXTBOX_BACKGROUND
}

function getObjectLabel(object: CanvasObject): string {
  if (object.type === 'textbox') {
    const content = richHtmlToPlainText(resolveTextboxRichHtml(object.textboxData))
    return content.length > 0 ? content : 'Textbox'
  }

  if (object.type === 'image') {
    return 'Image'
  }

  if (object.type === 'shape_rect') {
    return 'Rectangle'
  }

  if (object.type === 'shape_circle') {
    return 'Circle'
  }

  if (object.type === 'shape_arrow') {
    return 'Arrow'
  }

  return 'Group'
}

function toRect(start: Point, end: Point): Rect {
  return {
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x),
    maxY: Math.max(start.y, end.y),
  }
}

function isTextInputTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) {
    return false
  }

  const tagName = element.tagName.toLowerCase()
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true
  }

  return element.isContentEditable
}

function getObjectScreenAabb(
  object: CanvasObject,
  camera: CameraState,
  viewportSize: ViewportSize
): Rect {
  const halfW = object.w / 2
  const halfH = object.h / 2
  const localCorners = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ]

  const screenCorners = localCorners.map((corner) => {
    const rotated = rotatePoint(corner, object.rotation)
    return worldToScreen(
      {
        x: object.x + rotated.x,
        y: object.y + rotated.y,
      },
      camera,
      viewportSize
    )
  })

  return {
    minX: Math.min(...screenCorners.map((point) => point.x)),
    minY: Math.min(...screenCorners.map((point) => point.y)),
    maxX: Math.max(...screenCorners.map((point) => point.x)),
    maxY: Math.max(...screenCorners.map((point) => point.y)),
  }
}

function getObjectWorldAabb(object: CanvasObject): Rect {
  const halfW = object.w / 2
  const halfH = object.h / 2
  const localCorners = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ]

  const worldCorners = localCorners.map((corner) => {
    const rotated = rotatePoint(corner, object.rotation)
    return {
      x: object.x + rotated.x,
      y: object.y + rotated.y,
    }
  })

  return {
    minX: Math.min(...worldCorners.map((point) => point.x)),
    minY: Math.min(...worldCorners.map((point) => point.y)),
    maxX: Math.max(...worldCorners.map((point) => point.x)),
    maxY: Math.max(...worldCorners.map((point) => point.y)),
  }
}

function getObjectsWorldAabb(objects: CanvasObject[]): Rect | null {
  if (objects.length === 0) {
    return null
  }

  const bounds = getObjectWorldAabb(objects[0])
  for (const object of objects.slice(1)) {
    const objectBounds = getObjectWorldAabb(object)
    bounds.minX = Math.min(bounds.minX, objectBounds.minX)
    bounds.minY = Math.min(bounds.minY, objectBounds.minY)
    bounds.maxX = Math.max(bounds.maxX, objectBounds.maxX)
    bounds.maxY = Math.max(bounds.maxY, objectBounds.maxY)
  }

  return bounds
}

function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY &&
    inner.maxY <= outer.maxY
  )
}

function intersectsRect(a: Rect, b: Rect): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY)
}

function getSelectionKey(ids: string[]): string {
  return [...ids].sort().join('|')
}

function snapToGrid(value: number, gridSize: number): number {
  const safeGridSize = Math.max(0.00001, gridSize)
  return Math.round(value / safeGridSize) * safeGridSize
}

function getTransformAabb(transform: TransformSnapshot): Rect {
  const halfW = transform.w / 2
  const halfH = transform.h / 2
  const localCorners = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ]

  const worldCorners = localCorners.map((corner) => {
    const rotated = rotatePoint(corner, transform.rotation)
    return {
      x: transform.x + rotated.x,
      y: transform.y + rotated.y,
    }
  })

  return {
    minX: Math.min(...worldCorners.map((point) => point.x)),
    minY: Math.min(...worldCorners.map((point) => point.y)),
    maxX: Math.max(...worldCorners.map((point) => point.x)),
    maxY: Math.max(...worldCorners.map((point) => point.y)),
  }
}

function offsetRect(rect: Rect, delta: Point): Rect {
  return {
    minX: rect.minX + delta.x,
    minY: rect.minY + delta.y,
    maxX: rect.maxX + delta.x,
    maxY: rect.maxY + delta.y,
  }
}

function collectSnapCandidateEdges(objects: CanvasObject[]): SnapCandidateEdges {
  const x: number[] = []
  const y: number[] = []

  for (const object of objects) {
    const bounds = getObjectWorldAabb(object)
    x.push(bounds.minX, bounds.maxX, (bounds.minX + bounds.maxX) / 2)
    y.push(bounds.minY, bounds.maxY, (bounds.minY + bounds.maxY) / 2)
  }

  return { x, y }
}

function getBestSnapDelta(values: number[], candidates: number[], tolerance: number): number {
  let bestDelta = 0
  let bestAbsDelta = tolerance + 1

  for (const value of values) {
    for (const candidate of candidates) {
      const delta = candidate - value
      const absDelta = Math.abs(delta)
      if (absDelta <= tolerance && absDelta < bestAbsDelta) {
        bestDelta = delta
        bestAbsDelta = absDelta
      }
    }
  }

  return bestAbsDelta <= tolerance ? bestDelta : 0
}

function getObjectEdgeSnapOffset(
  bounds: Rect,
  candidates: SnapCandidateEdges,
  tolerance: number
): Point {
  if (tolerance <= 0) {
    return { x: 0, y: 0 }
  }

  return {
    x: getBestSnapDelta(
      [bounds.minX, bounds.maxX, (bounds.minX + bounds.maxX) / 2],
      candidates.x,
      tolerance
    ),
    y: getBestSnapDelta(
      [bounds.minY, bounds.maxY, (bounds.minY + bounds.maxY) / 2],
      candidates.y,
      tolerance
    ),
  }
}

function isPointInsideObjectRect(pointWorld: Point, object: Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'rotation'>): boolean {
  const local = rotatePoint(
    {
      x: pointWorld.x - object.x,
      y: pointWorld.y - object.y,
    },
    -object.rotation
  )

  return Math.abs(local.x) <= object.w / 2 && Math.abs(local.y) <= object.h / 2
}

function collectGroupTransformTargets(
  rootGroup: Extract<CanvasObject, { type: 'group' }>,
  objectById: Map<string, CanvasObject>
): CanvasObject[] {
  const resolvedIds = new Set<string>([rootGroup.id])
  const stack = [...rootGroup.groupData.childIds]

  while (stack.length > 0) {
    const nextId = stack.pop()
    if (!nextId || resolvedIds.has(nextId)) {
      continue
    }
    resolvedIds.add(nextId)
    const nextObject = objectById.get(nextId)
    if (nextObject?.type === 'group') {
      stack.push(...nextObject.groupData.childIds)
    }
  }

  return [...resolvedIds]
    .map((id) => objectById.get(id))
    .filter((entry): entry is CanvasObject => Boolean(entry))
}

function hasLockedAncestor(object: CanvasObject, objectById: Map<string, CanvasObject>): boolean {
  let parentId = object.parentGroupId
  while (parentId) {
    const parent = objectById.get(parentId)
    if (!parent || parent.type !== 'group') {
      return false
    }
    if (parent.locked) {
      return true
    }
    parentId = parent.parentGroupId
  }
  return false
}

function isObjectEffectivelyLocked(
  object: CanvasObject,
  objectById: Map<string, CanvasObject>
): boolean {
  return object.locked || hasLockedAncestor(object, objectById)
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

interface CanvasViewportProps {
  hoveredSlideId?: string | null
}

export function CanvasViewport({
  hoveredSlideId = null,
}: CanvasViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageReloadInputRef = useRef<HTMLInputElement>(null)
  const pendingImageReloadObjectIdRef = useRef<string | null>(null)
  const panRef = useRef<PanInteraction | null>(null)
  const objectInteractionRef = useRef<ObjectInteraction | null>(null)
  const imageCropInteractionRef = useRef<ImageCropInteraction | null>(null)
  const marqueeRef = useRef<MarqueeInteraction | null>(null)
  const clipboardRef = useRef<ClipboardState | null>(null)
  const cameraRef = useRef<CameraState | null>(null)
  const cameraRotationAnimationFrameRef = useRef<number | null>(null)
  const textboxEditingCameraRotationRef = useRef<number | null>(null)
  const lastPointerDownRef = useRef<{ enterGroupId: string | null; timestampMs: number } | null>(null)
  const lastTextboxPointerRef = useRef<TextboxPointerState | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [multiSelectionFrame, setMultiSelectionFrame] = useState<SelectionFrameState | null>(null)
  const [editingTextboxId, setEditingTextboxId] = useState<string | null>(null)
  const [editingTextboxHtml, setEditingTextboxHtml] = useState('')
  const [editingTextboxPlainText, setEditingTextboxPlainText] = useState('')
  const [activeImageEffectsObjectId, setActiveImageEffectsObjectId] = useState<string | null>(null)
  const [styleCopySourceObjectId, setStyleCopySourceObjectId] = useState<string | null>(null)

  const camera = useEditorStore((state) => state.camera)
  const setCamera = useEditorStore((state) => state.setCamera)
  const canvasSettings = useEditorStore((state) => state.document.canvas)
  const objects = useEditorStore((state) => state.document.objects)
  const assets = useEditorStore((state) => state.document.assets)
  const slides = useEditorStore((state) => state.document.slides)
  const selectedObjectIds = useEditorStore((state) => state.ui.selectedObjectIds)
  const selectedSlideId = useEditorStore((state) => state.ui.selectedSlideId)
  const activeGroupId = useEditorStore((state) => state.ui.activeGroupId)
  const selectObjects = useEditorStore((state) => state.selectObjects)
  const clearSelection = useEditorStore((state) => state.clearSelection)
  const createAsset = useEditorStore((state) => state.createAsset)
  const createObject = useEditorStore((state) => state.createObject)
  const enterGroup = useEditorStore((state) => state.enterGroup)
  const exitGroup = useEditorStore((state) => state.exitGroup)
  const moveObject = useEditorStore((state) => state.moveObject)
  const deleteObjects = useEditorStore((state) => state.deleteObjects)
  const reorderObjectsLayer = useEditorStore((state) => state.reorderObjectsLayer)
  const groupObjects = useEditorStore((state) => state.groupObjects)
  const ungroupObjects = useEditorStore((state) => state.ungroupObjects)
  const toggleObjectLock = useEditorStore((state) => state.toggleObjectLock)
  const setShapeData = useEditorStore((state) => state.setShapeData)
  const setImageData = useEditorStore((state) => state.setImageData)
  const setTextboxData = useEditorStore((state) => state.setTextboxData)
  const beginCommandBatch = useEditorStore((state) => state.beginCommandBatch)
  const commitCommandBatch = useEditorStore((state) => state.commitCommandBatch)

  useEffect(() => {
    cameraRef.current = camera
  }, [camera])

  useEffect(() => {
    return () => {
      if (cameraRotationAnimationFrameRef.current !== null) {
        cancelAnimationFrame(cameraRotationAnimationFrameRef.current)
        cameraRotationAnimationFrameRef.current = null
      }
    }
  }, [])

  const viewportSize = useViewportSize(viewportRef)
  const orderedSlides = useMemo(
    () => [...slides].sort((a, b) => a.orderIndex - b.orderIndex),
    [slides]
  )
  const orderedObjects = useMemo(() => [...objects].sort((a, b) => a.zIndex - b.zIndex), [objects])
  const objectById = useMemo(() => new Map(objects.map((object) => [object.id, object])), [objects])
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets])
  const editableObjects = useMemo(() => {
    if (activeGroupId === null) {
      return orderedObjects.filter((object) => object.parentGroupId === null)
    }
    if (!objectById.has(activeGroupId)) {
      return orderedObjects
    }
    return orderedObjects.filter((object) => object.parentGroupId === activeGroupId)
  }, [activeGroupId, objectById, orderedObjects])
  const selectedObject =
    selectedObjectIds.length === 1
      ? (editableObjects.find((entry) => entry.id === selectedObjectIds[0]) ?? null)
      : null
  const activeGroupObject =
    activeGroupId && objectById.get(activeGroupId)?.type === 'group'
      ? (objectById.get(activeGroupId) ?? null)
      : null
  const selectedObjectLockedByAncestor = selectedObject
    ? hasLockedAncestor(selectedObject, objectById)
    : false
  const editingTextboxObject = useMemo(() => {
    if (!editingTextboxId) {
      return null
    }
    const candidate = objectById.get(editingTextboxId)
    return candidate?.type === 'textbox' ? candidate : null
  }, [editingTextboxId, objectById])
  const canToggleGroupFromSelection = Boolean(
    selectedObject?.type === 'group' && activeGroupId === null
  )
  const isSelectedImageEffectsToolbarOpen = Boolean(
    selectedObject?.type === 'image' && activeImageEffectsObjectId === selectedObject.id
  )
  const selectedObjects = useMemo(() => {
    const selectedSet = new Set(selectedObjectIds)
    return editableObjects.filter((object) => selectedSet.has(object.id))
  }, [editableObjects, selectedObjectIds])
  const styleCopySourceObject =
    styleCopySourceObjectId !== null ? (objectById.get(styleCopySourceObjectId) ?? null) : null

  function closeActiveImageEffects(disableEffects: boolean) {
    if (!activeImageEffectsObjectId) {
      return
    }

    if (disableEffects) {
      const activeEffectObject = objectById.get(activeImageEffectsObjectId)
      if (activeEffectObject?.type === 'image' && activeEffectObject.imageData.effectsEnabled) {
        setImageData(activeEffectObject.id, {
          ...activeEffectObject.imageData,
          effectsEnabled: false,
        })
      }
    }

    setActiveImageEffectsObjectId(null)
  }

  useEffect(() => {
    if (
      !selectedObject ||
      selectedObject.type !== 'image' ||
      activeImageEffectsObjectId !== selectedObject.id
    ) {
      closeActiveImageEffects(true)
    }
  }, [activeImageEffectsObjectId, selectedObject])

  useEffect(() => {
    if (styleCopySourceObjectId && !styleCopySourceObject) {
      setStyleCopySourceObjectId(null)
    }
  }, [styleCopySourceObject, styleCopySourceObjectId])

  function cloneGradient(gradient: FillGradient | null): FillGradient | null {
    if (!gradient) {
      return null
    }
    return {
      ...gradient,
      stops: gradient.stops.map((stop) => ({ ...stop })),
    }
  }

  function applyCopiedStyle(source: CanvasObject, target: CanvasObject) {
    if (target.type === 'group') {
      return
    }
    if (isObjectEffectivelyLocked(target, objectById)) {
      return
    }

    const sourceShape =
      source.type === 'shape_rect' || source.type === 'shape_circle' || source.type === 'shape_arrow'
        ? source.shapeData
        : null
    const sourceTextbox = source.type === 'textbox' ? source.textboxData : null
    const sourceImage = source.type === 'image' ? source.imageData : null

    const common = sourceShape
      ? {
        borderColor: sourceShape.borderColor,
        borderType: sourceShape.borderType,
        borderWidth: sourceShape.borderWidth,
        opacityPercent: sourceShape.opacityPercent,
        radius: sourceShape.radius,
        shadowColor: sourceShape.shadowColor,
        shadowBlurPx: sourceShape.shadowBlurPx,
        shadowAngleDeg: sourceShape.shadowAngleDeg,
      }
      : sourceTextbox
        ? {
          borderColor: sourceTextbox.borderColor,
          borderType: sourceTextbox.borderType,
          borderWidth: sourceTextbox.borderWidth,
          opacityPercent: sourceTextbox.opacityPercent,
          radius: 0,
          shadowColor: sourceTextbox.shadowColor,
          shadowBlurPx: sourceTextbox.shadowBlurPx,
          shadowAngleDeg: sourceTextbox.shadowAngleDeg,
        }
        : sourceImage
          ? {
            borderColor: sourceImage.borderColor,
            borderType: sourceImage.borderType,
            borderWidth: sourceImage.borderWidth,
            opacityPercent: sourceImage.opacityPercent,
            radius: sourceImage.radius,
            shadowColor: sourceImage.shadowColor,
            shadowBlurPx: sourceImage.shadowBlurPx,
            shadowAngleDeg: sourceImage.shadowAngleDeg,
          }
          : null

    if (!common) {
      return
    }

    if (target.type === 'shape_rect' || target.type === 'shape_circle' || target.type === 'shape_arrow') {
      const nextShapeData: ShapeData = {
        ...target.shapeData,
        borderColor: common.borderColor,
        borderType: common.borderType,
        borderWidth: common.borderWidth,
        opacityPercent: common.opacityPercent,
        radius: common.radius,
        shadowColor: common.shadowColor,
        shadowBlurPx: common.shadowBlurPx,
        shadowAngleDeg: common.shadowAngleDeg,
      }
      if (sourceShape) {
        nextShapeData.fillMode = sourceShape.fillMode
        nextShapeData.fillColor = sourceShape.fillColor
        nextShapeData.fillGradient = cloneGradient(sourceShape.fillGradient)
      } else if (sourceTextbox) {
        nextShapeData.fillMode = sourceTextbox.fillMode
        nextShapeData.fillColor = sourceTextbox.backgroundColor
        nextShapeData.fillGradient = cloneGradient(sourceTextbox.fillGradient)
      }
      setShapeData(target.id, nextShapeData)
      return
    }

    if (target.type === 'textbox') {
      const nextTextboxData = {
        ...target.textboxData,
        borderColor: common.borderColor,
        borderType: common.borderType,
        borderWidth: common.borderWidth,
        opacityPercent: common.opacityPercent,
        shadowColor: common.shadowColor,
        shadowBlurPx: common.shadowBlurPx,
        shadowAngleDeg: common.shadowAngleDeg,
      }
      if (sourceShape) {
        nextTextboxData.fillMode = sourceShape.fillMode
        nextTextboxData.backgroundColor = sourceShape.fillColor
        nextTextboxData.fillGradient = cloneGradient(sourceShape.fillGradient)
      } else if (sourceTextbox) {
        nextTextboxData.fillMode = sourceTextbox.fillMode
        nextTextboxData.backgroundColor = sourceTextbox.backgroundColor
        nextTextboxData.fillGradient = cloneGradient(sourceTextbox.fillGradient)
      }
      setTextboxData(target.id, nextTextboxData)
      return
    }

    if (target.type === 'image') {
      setImageData(target.id, {
        ...target.imageData,
        borderColor: common.borderColor,
        borderType: common.borderType,
        borderWidth: common.borderWidth,
        opacityPercent: common.opacityPercent,
        radius: common.radius,
        shadowColor: common.shadowColor,
        shadowBlurPx: common.shadowBlurPx,
        shadowAngleDeg: common.shadowAngleDeg,
        ...(sourceImage
          ? {
            effectsEnabled: sourceImage.effectsEnabled,
            filterPreset: sourceImage.filterPreset,
          }
          : {}),
      })
    }
  }

  const editableObjectIds = useMemo(
    () => new Set(editableObjects.map((object) => object.id)),
    [editableObjects]
  )
  const selectedGroup =
    selectedObjects.length === 1 && selectedObjects[0]?.type === 'group' ? selectedObjects[0] : null
  const selectedUnlockedObjects = useMemo(
    () => selectedObjects.filter((object) => !isObjectEffectivelyLocked(object, objectById)),
    [objectById, selectedObjects]
  )
  const selectedUnlockedIds = useMemo(
    () => selectedUnlockedObjects.map((object) => object.id),
    [selectedUnlockedObjects]
  )
  const selectedUnlockedIdsKey = useMemo(
    () => getSelectionKey(selectedUnlockedIds),
    [selectedUnlockedIds]
  )
  const activeCropObjectId =
    selectedObject?.type === 'image' && selectedObject.imageData.cropEnabled ? selectedObject.id : null

  useEffect(() => {
    if (selectedObject || selectedUnlockedObjects.length < 2) {
      setMultiSelectionFrame(null)
      return
    }

    const bounds = getObjectsWorldAabb(selectedUnlockedObjects)
    if (!bounds) {
      setMultiSelectionFrame(null)
      return
    }

    setMultiSelectionFrame((current) => {
      if (
        current &&
        current.selectionKey === selectedUnlockedIdsKey
      ) {
        return current
      }

      return {
        center: {
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2,
        },
        width: Math.max(1, bounds.maxX - bounds.minX),
        height: Math.max(1, bounds.maxY - bounds.minY),
        rotation: 0,
        selectionKey: selectedUnlockedIdsKey,
      }
    })
  }, [
    selectedObject,
    selectedUnlockedIdsKey,
    selectedUnlockedObjects,
  ])

  useEffect(() => {
    if (editingTextboxId && !editingTextboxObject) {
      if (textboxEditingCameraRotationRef.current !== null) {
        animateCameraRotationTo(textboxEditingCameraRotationRef.current)
        textboxEditingCameraRotationRef.current = null
      }
      setEditingTextboxId(null)
      setEditingTextboxHtml('')
      setEditingTextboxPlainText('')
    }
  }, [animateCameraRotationTo, editingTextboxId, editingTextboxObject])

  const gridStep = useMemo(
    () => getDynamicGridStep(canvasSettings.baseGridSize, camera.zoom),
    [canvasSettings.baseGridSize, camera.zoom]
  )
  const minorGridStep = gridStep / 10
  const worldBounds = useMemo(
    () => getViewWorldBounds(camera, viewportSize),
    [camera, viewportSize]
  )

  const majorGridLines = useMemo(() => {
    if (!canvasSettings.gridVisible) {
      return { x: [], y: [] } as { x: GridLine[]; y: GridLine[] }
    }
    return {
      x: createGridLines(worldBounds.minX, worldBounds.maxX, gridStep),
      y: createGridLines(worldBounds.minY, worldBounds.maxY, gridStep),
    }
  }, [
    canvasSettings.gridVisible,
    gridStep,
    worldBounds.maxX,
    worldBounds.maxY,
    worldBounds.minX,
    worldBounds.minY,
  ])

  const minorGridLines = useMemo(() => {
    if (!canvasSettings.gridVisible) {
      return { x: [], y: [] } as { x: GridLine[]; y: GridLine[] }
    }
    return {
      x: createGridLines(worldBounds.minX, worldBounds.maxX, minorGridStep),
      y: createGridLines(worldBounds.minY, worldBounds.maxY, minorGridStep),
    }
  }, [
    canvasSettings.gridVisible,
    minorGridStep,
    worldBounds.maxX,
    worldBounds.maxY,
    worldBounds.minX,
    worldBounds.minY,
  ])

  const slideGuides = useMemo(() => {
    return orderedSlides.map((slide) => {
      const safeSlideZoom = Math.max(0.0001, slide.zoom)
      const frameWorldWidth = viewportSize.width / safeSlideZoom
      const frameWorldHeight = viewportSize.height / safeSlideZoom
      const centerScreen = worldToScreen({ x: slide.x, y: slide.y }, camera, viewportSize)
      const frameWidthPx = frameWorldWidth * camera.zoom
      const frameHeightPx = frameWorldHeight * camera.zoom
      const frameWorldRotation = -slide.rotation
      const frameRotation = frameWorldRotation + camera.rotation
      const topLeftLocal = rotatePoint(
        { x: -frameWorldWidth / 2, y: -frameWorldHeight / 2 },
        frameWorldRotation
      )
      const topLeftWorld = {
        x: slide.x + topLeftLocal.x,
        y: slide.y + topLeftLocal.y,
      }
      const topLeftScreen = worldToScreen(topLeftWorld, camera, viewportSize)

      return {
        id: slide.id,
        name: slide.name || `Slide ${slide.orderIndex + 1}`,
        left: centerScreen.x - frameWidthPx / 2,
        top: centerScreen.y - frameHeightPx / 2,
        width: frameWidthPx,
        height: frameHeightPx,
        rotation: frameRotation,
        labelX: topLeftScreen.x,
        labelY: topLeftScreen.y,
        isActive: slide.id === selectedSlideId,
        isHovered: slide.id === hoveredSlideId,
      }
    })
  }, [camera, hoveredSlideId, orderedSlides, selectedSlideId, viewportSize])

  function getViewportRelativePoint(clientX: number, clientY: number): Point {
    const element = viewportRef.current
    if (!element) {
      return { x: 0, y: 0 }
    }
    const bounds = element.getBoundingClientRect()
    return {
      x: clientX - bounds.left,
      y: clientY - bounds.top,
    }
  }

  useEffect(() => {
    const element = viewportRef.current
    if (!element) {
      return
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const pointerScreen = getViewportRelativePoint(event.clientX, event.clientY)
      const worldBefore = screenToWorld(pointerScreen, camera, viewportSize)

      if (
        event.shiftKey &&
        selectedObject &&
        !isObjectEffectivelyLocked(selectedObject, objectById)
      ) {
        const rotationDelta = event.deltaY * 0.002
        moveObject(selectedObject.id, {
          x: selectedObject.x,
          y: selectedObject.y,
          w: selectedObject.w,
          h: selectedObject.h,
          rotation: normalizeRotationRadians(selectedObject.rotation + rotationDelta),
        })
        return
      }

      if (event.altKey) {
        const rotationDirection = event.deltaY > 0 ? 1 : event.deltaY < 0 ? -1 : 0
        if (rotationDirection === 0) {
          return
        }
        const rotationDelta = rotationDirection * CAMERA_ROTATION_STEP_RAD
        const nextRotation = camera.rotation + rotationDelta
        const rotatedCamera = { ...camera, rotation: nextRotation }
        const worldAfter = screenToWorld(pointerScreen, rotatedCamera, viewportSize)

        setCamera({
          ...rotatedCamera,
          x: rotatedCamera.x + (worldBefore.x - worldAfter.x),
          y: rotatedCamera.y + (worldBefore.y - worldAfter.y),
        })
        return
      }

      const zoomFactor = Math.exp(-event.deltaY * 0.0015)
      const nextZoom = clamp(camera.zoom * zoomFactor, 0.01, 100)
      const zoomedCamera = { ...camera, zoom: nextZoom }
      const worldAfter = screenToWorld(pointerScreen, zoomedCamera, viewportSize)

      setCamera({
        ...zoomedCamera,
        x: zoomedCamera.x + (worldBefore.x - worldAfter.x),
        y: zoomedCamera.y + (worldBefore.y - worldAfter.y),
      })
    }

    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [camera, moveObject, objectById, selectedObject, setCamera, viewportSize])

  const contextSelectionIds = contextMenu?.selectionIds ?? selectedObjectIds
  const contextSelectionObjects = useMemo(() => {
    const selectedSet = new Set(contextSelectionIds)
    return editableObjects.filter((object) => selectedSet.has(object.id))
  }, [contextSelectionIds, editableObjects])
  const contextUnlockedIds = useMemo(
    () =>
      contextSelectionObjects
        .filter((object) => !isObjectEffectivelyLocked(object, objectById))
        .map((object) => object.id),
    [contextSelectionObjects, objectById]
  )

  const canBringToFront = canReorderLayer(objects, contextSelectionIds, 'top')
  const canBringForward = canReorderLayer(objects, contextSelectionIds, 'up')
  const canSendBackward = canReorderLayer(objects, contextSelectionIds, 'down')
  const canSendToBack = canReorderLayer(objects, contextSelectionIds, 'bottom')
  const canGroup =
    contextSelectionObjects.length > 1 &&
    contextSelectionObjects.every(
      (object) =>
        object.parentGroupId === null &&
        object.type !== 'group' &&
        !isObjectEffectivelyLocked(object, objectById)
    )
  const canUngroup =
    contextSelectionObjects.length === 1 && contextSelectionObjects[0]?.type === 'group'

  function closeContextMenu() {
    setContextMenu(null)
  }

  function applyDeleteSelection(ids: string[]) {
    if (ids.length === 0) {
      return
    }
    deleteObjects(ids)
  }

  function applyLayerAction(action: LayerOrderAction) {
    if (contextSelectionIds.length === 0) {
      return
    }
    reorderObjectsLayer(contextSelectionIds, action)
  }

  function animateCameraRotationTo(targetRotation: number) {
    const startCamera = cameraRef.current ?? camera
    if (cameraRotationAnimationFrameRef.current !== null) {
      cancelAnimationFrame(cameraRotationAnimationFrameRef.current)
      cameraRotationAnimationFrameRef.current = null
    }

    const startRotation = startCamera.rotation
    const rotationDelta = getShortestAngleDelta(startRotation, targetRotation)
    if (Math.abs(rotationDelta) < 0.0001) {
      setCamera({
        ...startCamera,
        rotation: targetRotation,
      })
      return
    }

    const startedAtMs = performance.now()
    const tick = (nowMs: number) => {
      const elapsed = nowMs - startedAtMs
      const progress = Math.min(1, Math.max(0, elapsed / TEXTBOX_CAMERA_ROTATION_TRANSITION_MS))
      const eased = easeInOutCubic(progress)
      const liveCamera = cameraRef.current ?? startCamera
      setCamera({
        ...liveCamera,
        rotation: startRotation + rotationDelta * eased,
      })
      if (progress < 1) {
        cameraRotationAnimationFrameRef.current = requestAnimationFrame(tick)
        return
      }
      cameraRotationAnimationFrameRef.current = null
      const completedCamera = cameraRef.current ?? liveCamera
      setCamera({
        ...completedCamera,
        rotation: targetRotation,
      })
    }

    cameraRotationAnimationFrameRef.current = requestAnimationFrame(tick)
  }

  function startTextboxEditing(target: Extract<CanvasObject, { type: 'textbox' }>) {
    if (textboxEditingCameraRotationRef.current === null) {
      textboxEditingCameraRotationRef.current = camera.rotation
    }

    animateCameraRotationTo(-target.rotation)

    setEditingTextboxId(target.id)
    const initialHtml = resolveTextboxRichHtml(target.textboxData)
    setEditingTextboxHtml(initialHtml)
    setEditingTextboxPlainText(richHtmlToPlainText(initialHtml))
    selectObjects([target.id])
  }

  function applyTextboxAutoHeight(
    target: Extract<CanvasObject, { type: 'textbox' }>,
    nextText: string,
    measuredHeightPx?: number
  ) {
    if (!target.textboxData.autoHeight) {
      return
    }

    let desiredHeightWorld: number
    if (Number.isFinite(measuredHeightPx) && measuredHeightPx && measuredHeightPx > 0) {
      desiredHeightWorld = Math.max(24, measuredHeightPx)
    } else {
      const firstRun = target.textboxData.runs[0] ?? createDefaultTextRun('')
      const lines = Math.max(1, nextText.split('\n').length)
      const lineHeightPx = Math.max(12, firstRun.fontSize * TEXTBOX_LINE_HEIGHT)
      const verticalPaddingPx = 14
      desiredHeightWorld = Math.max(24, lines * lineHeightPx + verticalPaddingPx)
    }

    // Auto-height should only expand the textbox while editing, never shrink it.
    if (desiredHeightWorld <= target.h + 0.5) {
      return
    }

    moveObject(target.id, {
      x: target.x,
      y: target.y,
      w: target.w,
      h: desiredHeightWorld,
      rotation: target.rotation,
    })
  }

  function finishTextboxEditing(commit: boolean) {
    if (!editingTextboxObject) {
      if (textboxEditingCameraRotationRef.current !== null) {
        animateCameraRotationTo(textboxEditingCameraRotationRef.current)
        textboxEditingCameraRotationRef.current = null
      }
      setEditingTextboxId(null)
      setEditingTextboxHtml('')
      setEditingTextboxPlainText('')
      return
    }

    if (commit) {
      const baseRun = normalizeTextboxRuns(editingTextboxObject.textboxData.runs)[0] ?? createDefaultTextRun('')
      const nextTextboxData = {
        ...editingTextboxObject.textboxData,
        richTextHtml: editingTextboxHtml,
        runs: [{ ...baseRun, text: editingTextboxPlainText }],
      }
      applyTextboxAutoHeight(editingTextboxObject, editingTextboxPlainText)
      setTextboxData(editingTextboxObject.id, nextTextboxData)
    }

    if (textboxEditingCameraRotationRef.current !== null) {
      animateCameraRotationTo(textboxEditingCameraRotationRef.current)
      textboxEditingCameraRotationRef.current = null
    }

    setEditingTextboxId(null)
    setEditingTextboxHtml('')
    setEditingTextboxPlainText('')
  }

  function copySelection(ids: string[]) {
    if (ids.length === 0) {
      return
    }
    const selectedSet = new Set(ids)
    let changed = true
    while (changed) {
      changed = false
      for (const object of objects) {
        if (object.type === 'group' && selectedSet.has(object.id)) {
          for (const childId of object.groupData.childIds) {
            if (!selectedSet.has(childId)) {
              selectedSet.add(childId)
              changed = true
            }
          }
        }
      }
    }

    const copied = objects
      .filter((object) => selectedSet.has(object.id))
      .map((object) => JSON.parse(JSON.stringify(object)) as CanvasObject)
    if (copied.length === 0) {
      clipboardRef.current = null
      return
    }

    const sourceSelectionKey = getSelectionKey(ids)
    const current = clipboardRef.current
    clipboardRef.current = {
      objects: copied,
      sourceSelectionKey,
      selectedRootIds: ids,
      pasteCount:
        current && current.sourceSelectionKey === sourceSelectionKey ? current.pasteCount : 0,
    }
  }

  function pasteClipboard() {
    const clipboard = clipboardRef.current
    if (!clipboard || clipboard.objects.length === 0) {
      return
    }

    const zIndexStart = objects.reduce((max, object) => Math.max(max, object.zIndex), 0) + 1
    const pasteOffset = (clipboard.pasteCount + 1) * 20
    const idMap = new Map<string, string>()
    clipboard.objects.forEach((object) => {
      idMap.set(object.id, createId())
    })

    const clones = clipboard.objects.map((object, index) => {
      const next = JSON.parse(JSON.stringify(object)) as CanvasObject
      next.id = idMap.get(object.id) ?? createId()
      if (object.parentGroupId && idMap.has(object.parentGroupId)) {
        next.parentGroupId = idMap.get(object.parentGroupId) ?? null
      } else {
        next.parentGroupId = null
      }
      if (next.type === 'group') {
        next.groupData.childIds = next.groupData.childIds
          .map((childId) => idMap.get(childId))
          .filter((childId): childId is string => Boolean(childId))
      }
      next.zIndex = zIndexStart + index
      next.x += pasteOffset
      next.y += pasteOffset
      return next
    })

    beginCommandBatch('Paste objects')
    clones.forEach((entry) => createObject(entry))
    commitCommandBatch()
    const selectedPastedRoots = clipboard.selectedRootIds
      .map((rootId) => idMap.get(rootId))
      .filter((id): id is string => Boolean(id))
    selectObjects(selectedPastedRoots)
    clipboardRef.current = {
      ...clipboard,
      pasteCount: clipboard.pasteCount + 1,
    }
  }

  async function handleViewportDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    closeContextMenu()

    const files = Array.from(event.dataTransfer.files ?? []).filter(isSupportedImageFile)
    if (files.length === 0) {
      return
    }

    const pointer = getViewportRelativePoint(event.clientX, event.clientY)
    const world = screenToWorld(pointer, camera, viewportSize)
    const zIndexStart = objects.reduce((max, object) => Math.max(max, object.zIndex), 0) + 1
    const createdIds: string[] = []

    beginCommandBatch('Import images')
    try {
      for (const [index, file] of files.entries()) {
        const dataUrl = await readFileAsDataUrl(file)
        const dimensions = await getImageDimensions(dataUrl).catch(() => ({
          width: 1200,
          height: 800,
        }))
        const asset: Asset = {
          id: createId(),
          name: file.name || `image-${index + 1}`,
          mimeType: file.type,
          dataBase64: toAssetBase64(dataUrl),
        }
        createAsset(asset)

        const aspectRatio = Math.max(0.0001, dimensions.width / Math.max(1, dimensions.height))
        const width = 260
        const height = Math.max(40, width / aspectRatio)
        const objectId = createId()
        createObject({
          id: objectId,
          type: 'image',
          x: world.x + index * 20,
          y: world.y + index * 20,
          w: width,
          h: height,
          rotation: -camera.rotation,
          locked: false,
          zIndex: zIndexStart + index,
          parentGroupId: activeGroupId,
          imageData: {
            assetId: asset.id,
            intrinsicWidth: dimensions.width,
            intrinsicHeight: dimensions.height,
            keepAspectRatio: false,
            borderColor: '#b2c6ee',
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
        })
        createdIds.push(objectId)
      }
      commitCommandBatch()
      if (createdIds.length > 0) {
        selectObjects(createdIds)
      }
    } catch {
      commitCommandBatch()
    }
  }

  function openImageReloadDialog(objectId: string) {
    pendingImageReloadObjectIdRef.current = objectId
    imageReloadInputRef.current?.click()
  }

  async function handleImageReloadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    const targetObjectId = pendingImageReloadObjectIdRef.current
    pendingImageReloadObjectIdRef.current = null
    event.target.value = ''

    if (!file || !targetObjectId || !isSupportedImageFile(file)) {
      return
    }

    const targetObject = objects.find(
      (entry): entry is Extract<CanvasObject, { type: 'image' }> =>
        entry.id === targetObjectId && entry.type === 'image'
    )
    if (!targetObject) {
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      const dimensions = await getImageDimensions(dataUrl).catch(() => ({
        width: targetObject.imageData.intrinsicWidth,
        height: targetObject.imageData.intrinsicHeight,
      }))
      const asset: Asset = {
        id: createId(),
        name: file.name || 'image',
        mimeType: file.type,
        dataBase64: toAssetBase64(dataUrl),
      }

      beginCommandBatch('Reload image')
      createAsset(asset)
      setImageData(targetObject.id, {
        ...targetObject.imageData,
        assetId: asset.id,
        intrinsicWidth: dimensions.width,
        intrinsicHeight: dimensions.height,
      })
    } catch {
      window.alert('Failed to load image file.')
    } finally {
      commitCommandBatch()
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextInputTarget(event.target)) {
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
        if (selectedObjectIds.length > 0) {
          event.preventDefault()
          copySelection(selectedObjectIds)
        }
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        pasteClipboard()
        return
      }

      if (event.key === 'Delete') {
        if (selectedUnlockedIds.length > 0) {
          event.preventDefault()
          deleteObjects(selectedUnlockedIds)
          setContextMenu(null)
        }
        return
      }

      if (event.key === 'Backspace' && selectedObjectIds.length > 0) {
        event.preventDefault()
        return
      }

      if (event.key === 'Enter' && selectedGroup) {
        event.preventDefault()
        enterGroup(selectedGroup.id)
        return
      }

      if (event.key === 'Escape' && activeGroupId) {
        event.preventDefault()
        exitGroup()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    activeGroupId,
    beginCommandBatch,
    commitCommandBatch,
    createObject,
    deleteObjects,
    enterGroup,
    exitGroup,
    objects,
    selectedGroup,
    selectedObjectIds,
    selectedUnlockedIds,
  ])

  function beginObjectInteraction(
    event: PointerEvent<HTMLElement>,
    targets: CanvasObject[],
    mode: ObjectInteraction['mode']
  ) {
    const rootGroup =
      activeGroupId === null && targets.length === 1 && targets[0]?.type === 'group'
        ? targets[0]
        : null
    const resolvedTargets = rootGroup
      ? collectGroupTransformTargets(rootGroup, objectById)
      : targets
    const interactionTargets = rootGroup
      ? rootGroup.locked
        ? []
        : resolvedTargets
      : resolvedTargets.filter((target) => !isObjectEffectivelyLocked(target, objectById))
    if (interactionTargets.length === 0) {
      return
    }

    const interactionSelectionKey = getSelectionKey(interactionTargets.map((target) => target.id))
    const frameStart =
      interactionTargets.length > 1 && multiSelectionFrame?.selectionKey === interactionSelectionKey
        ? multiSelectionFrame
        : null

    const selectionBoundsStart = frameStart
      ? {
        minX: frameStart.center.x - frameStart.width / 2,
        minY: frameStart.center.y - frameStart.height / 2,
        maxX: frameStart.center.x + frameStart.width / 2,
        maxY: frameStart.center.y + frameStart.height / 2,
      }
      : getObjectsWorldAabb(interactionTargets)
    if (!selectionBoundsStart) {
      return
    }

    const centerStart = frameStart?.center ?? {
      x: (selectionBoundsStart.minX + selectionBoundsStart.maxX) / 2,
      y: (selectionBoundsStart.minY + selectionBoundsStart.maxY) / 2,
    }
    const centerScreenStart = worldToScreen(centerStart, camera, viewportSize)
    const pointerScreen = getViewportRelativePoint(event.clientX, event.clientY)
    const startPointerAngle = Math.atan2(
      pointerScreen.y - centerScreenStart.y,
      pointerScreen.x - centerScreenStart.x
    )

    beginCommandBatch(interactionTargets.length > 1 ? 'Objects transform' : 'Object transform')
    objectInteractionRef.current = {
      pointerId: event.pointerId,
      targets: interactionTargets.map((target) => ({
        id: target.id,
        objectType: target.type,
        start: {
          x: target.x,
          y: target.y,
          w: target.w,
          h: target.h,
          rotation: target.rotation,
        },
      })),
      mode,
      originClient: { x: event.clientX, y: event.clientY },
      cameraStart: camera,
      centerStart,
      selectionBoundsStart,
      selectionFrameStart: frameStart,
      centerScreenStart,
      startPointerAngle,
    }

    viewportRef.current?.setPointerCapture(event.pointerId)
  }

  function beginImageCropInteraction(
    event: PointerEvent<HTMLElement>,
    target: Extract<CanvasObject, { type: 'image' }>,
    handle: CropHandle
  ) {
    beginCommandBatch('Crop image')
    imageCropInteractionRef.current = {
      pointerId: event.pointerId,
      objectId: target.id,
      handle,
      originClient: { x: event.clientX, y: event.clientY },
      cameraStart: camera,
      startLeftPercent: clamp(target.imageData.cropLeftPercent, 0, 100),
      startTopPercent: clamp(target.imageData.cropTopPercent, 0, 100),
      startRightPercent: clamp(target.imageData.cropRightPercent, 0, 100),
      startBottomPercent: clamp(target.imageData.cropBottomPercent, 0, 100),
      objectWidth: Math.max(1, target.w),
      objectHeight: Math.max(1, target.h),
      objectRotation: target.rotation,
    }
    viewportRef.current?.setPointerCapture(event.pointerId)
  }

  function applyImageCropInteraction(
    event: PointerEvent<HTMLDivElement>,
    interaction: ImageCropInteraction
  ) {
    const target = objectById.get(interaction.objectId)
    if (!target || target.type !== 'image') {
      return
    }

    const deltaClient = {
      x: event.clientX - interaction.originClient.x,
      y: event.clientY - interaction.originClient.y,
    }
    const deltaWorld = cameraDragDeltaToWorld(deltaClient, interaction.cameraStart)
    const localDelta = rotatePoint(deltaWorld, -interaction.objectRotation)
    const deltaXPercent = (localDelta.x / interaction.objectWidth) * 100
    const deltaYPercent = (localDelta.y / interaction.objectHeight) * 100
    let left = interaction.startLeftPercent
    let top = interaction.startTopPercent
    let right = interaction.startRightPercent
    let bottom = interaction.startBottomPercent
    const minVisiblePercent = 1

    if (interaction.handle === 'move') {
      const selectionWidthPercent = Math.max(
        minVisiblePercent,
        100 - interaction.startLeftPercent - interaction.startRightPercent
      )
      const selectionHeightPercent = Math.max(
        minVisiblePercent,
        100 - interaction.startTopPercent - interaction.startBottomPercent
      )
      left = clamp(interaction.startLeftPercent + deltaXPercent, 0, 100 - selectionWidthPercent)
      top = clamp(interaction.startTopPercent + deltaYPercent, 0, 100 - selectionHeightPercent)
      right = Math.max(0, 100 - selectionWidthPercent - left)
      bottom = Math.max(0, 100 - selectionHeightPercent - top)
    } else {
      if (
        interaction.handle === 'left' ||
        interaction.handle === 'top-left' ||
        interaction.handle === 'bottom-left'
      ) {
        left = interaction.startLeftPercent + deltaXPercent
      }
      if (
        interaction.handle === 'right' ||
        interaction.handle === 'top-right' ||
        interaction.handle === 'bottom-right'
      ) {
        right = interaction.startRightPercent - deltaXPercent
      }
      if (interaction.handle === 'top' || interaction.handle === 'top-left' || interaction.handle === 'top-right') {
        top = interaction.startTopPercent + deltaYPercent
      }
      if (
        interaction.handle === 'bottom' ||
        interaction.handle === 'bottom-left' ||
        interaction.handle === 'bottom-right'
      ) {
        bottom = interaction.startBottomPercent - deltaYPercent
      }

      left = clamp(left, 0, 100 - minVisiblePercent - right)
      right = clamp(right, 0, 100 - minVisiblePercent - left)
      top = clamp(top, 0, 100 - minVisiblePercent - bottom)
      bottom = clamp(bottom, 0, 100 - minVisiblePercent - top)
    }

    setImageData(target.id, {
      ...target.imageData,
      cropLeftPercent: left,
      cropTopPercent: top,
      cropRightPercent: right,
      cropBottomPercent: bottom,
    })
  }

  function applyObjectInteraction(
    event: PointerEvent<HTMLDivElement>,
    interaction: ObjectInteraction
  ) {
    if (interaction.targets.length === 0) {
      return
    }

    const deltaClient = {
      x: event.clientX - interaction.originClient.x,
      y: event.clientY - interaction.originClient.y,
    }
    const deltaWorld = cameraDragDeltaToWorld(deltaClient, interaction.cameraStart)
    const shouldSnapToGrid = canvasSettings.snapToGrid && !event.altKey
    const snapGridSize = minorGridStep
    const canSnapToObjectEdges = canvasSettings.snapToObjectEdges && !event.altKey
    const snapToleranceWorld = canvasSettings.snapTolerancePx / Math.max(0.00001, camera.zoom)
    const interactionIds = new Set(interaction.targets.map((target) => target.id))
    const edgeCandidates = canSnapToObjectEdges
      ? collectSnapCandidateEdges(editableObjects.filter((object) => !interactionIds.has(object.id)))
      : { x: [], y: [] }

    if (interaction.mode === 'move') {
      let appliedDelta = deltaWorld
      if (shouldSnapToGrid) {
        const snappedCenter = {
          x: snapToGrid(interaction.centerStart.x + deltaWorld.x, snapGridSize),
          y: snapToGrid(interaction.centerStart.y + deltaWorld.y, snapGridSize),
        }
        appliedDelta = {
          x: snappedCenter.x - interaction.centerStart.x,
          y: snappedCenter.y - interaction.centerStart.y,
        }
      }
      if (canSnapToObjectEdges && edgeCandidates.x.length > 0) {
        const startBounds = interaction.targets
          .map((target) => getTransformAabb(target.start))
          .reduce(
            (acc, bounds) => ({
              minX: Math.min(acc.minX, bounds.minX),
              minY: Math.min(acc.minY, bounds.minY),
              maxX: Math.max(acc.maxX, bounds.maxX),
              maxY: Math.max(acc.maxY, bounds.maxY),
            }),
            {
              minX: Number.POSITIVE_INFINITY,
              minY: Number.POSITIVE_INFINITY,
              maxX: Number.NEGATIVE_INFINITY,
              maxY: Number.NEGATIVE_INFINITY,
            } satisfies Rect
          )
        const movedBounds = offsetRect(startBounds, appliedDelta)
        const snapOffset = getObjectEdgeSnapOffset(movedBounds, edgeCandidates, snapToleranceWorld)
        appliedDelta = {
          x: appliedDelta.x + snapOffset.x,
          y: appliedDelta.y + snapOffset.y,
        }
      }

      interaction.targets.forEach((target) => {
        moveObject(target.id, {
          x: target.start.x + appliedDelta.x,
          y: target.start.y + appliedDelta.y,
          w: target.start.w,
          h: target.start.h,
          rotation: target.start.rotation,
        })
      })
      if (interaction.selectionFrameStart) {
        setMultiSelectionFrame({
          ...interaction.selectionFrameStart,
          center: {
            x: interaction.selectionFrameStart.center.x + appliedDelta.x,
            y: interaction.selectionFrameStart.center.y + appliedDelta.y,
          },
        })
      }
      return
    }

    if (interaction.mode === 'resize') {
      const hasImageTarget = interaction.targets.some((target) => target.objectType === 'image')
      const keepAspectRatio = (event.ctrlKey || event.metaKey) && !hasImageTarget
      if (interaction.targets.length === 1) {
        const target = interaction.targets[0]
        const localDelta = rotatePoint(deltaWorld, -target.start.rotation)
        let nextWidth: number
        let nextHeight: number

        if (keepAspectRatio) {
          const widthFromDelta = Math.max(20, target.start.w + localDelta.x)
          const heightFromDelta = Math.max(20, target.start.h + localDelta.y)
          const widthScale = widthFromDelta / Math.max(1, target.start.w)
          const heightScale = heightFromDelta / Math.max(1, target.start.h)
          const widthDominant =
            Math.abs(localDelta.x / Math.max(1, target.start.w)) >=
            Math.abs(localDelta.y / Math.max(1, target.start.h))

          let uniformScale = widthDominant ? widthScale : heightScale
          uniformScale = Math.max(
            uniformScale,
            20 / Math.max(1, target.start.w),
            20 / Math.max(1, target.start.h)
          )

          if (shouldSnapToGrid) {
            if (widthDominant) {
              const snappedWidth = Math.max(20, snapToGrid(target.start.w * uniformScale, snapGridSize))
              uniformScale = snappedWidth / Math.max(1, target.start.w)
            } else {
              const snappedHeight = Math.max(20, snapToGrid(target.start.h * uniformScale, snapGridSize))
              uniformScale = snappedHeight / Math.max(1, target.start.h)
            }
          }

          uniformScale = Math.max(
            uniformScale,
            20 / Math.max(1, target.start.w),
            20 / Math.max(1, target.start.h)
          )
          nextWidth = Math.max(20, target.start.w * uniformScale)
          nextHeight = Math.max(20, target.start.h * uniformScale)
        } else {
          nextWidth = Math.max(20, target.start.w + localDelta.x)
          nextHeight = Math.max(20, target.start.h + localDelta.y)
          if (shouldSnapToGrid) {
            nextWidth = Math.max(20, snapToGrid(nextWidth, snapGridSize))
            nextHeight = Math.max(20, snapToGrid(nextHeight, snapGridSize))
          }
        }
        if (target.objectType === 'shape_circle') {
          const widthDominant = Math.abs(localDelta.x) >= Math.abs(localDelta.y)
          let nextCircleSize = widthDominant ? nextWidth : nextHeight
          nextCircleSize = Math.max(20, nextCircleSize)
          if (shouldSnapToGrid) {
            nextCircleSize = Math.max(20, snapToGrid(nextCircleSize, snapGridSize))
          }
          nextWidth = nextCircleSize
          nextHeight = nextCircleSize
        }
        const appliedWidthDelta = nextWidth - target.start.w
        const appliedHeightDelta = nextHeight - target.start.h
        const centerShiftLocal = {
          x: appliedWidthDelta / 2,
          y: appliedHeightDelta / 2,
        }
        const centerShiftWorld = rotatePoint(centerShiftLocal, target.start.rotation)
        if (canSnapToObjectEdges && edgeCandidates.x.length > 0) {
          const nextTransform = {
            x: target.start.x + centerShiftWorld.x,
            y: target.start.y + centerShiftWorld.y,
            w: nextWidth,
            h: nextHeight,
            rotation: target.start.rotation,
          } satisfies TransformSnapshot
          const snapOffset = getObjectEdgeSnapOffset(
            getTransformAabb(nextTransform),
            edgeCandidates,
            snapToleranceWorld
          )
          centerShiftWorld.x += snapOffset.x
          centerShiftWorld.y += snapOffset.y
        }

        moveObject(target.id, {
          x: target.start.x + centerShiftWorld.x,
          y: target.start.y + centerShiftWorld.y,
          w: nextWidth,
          h: nextHeight,
          rotation: target.start.rotation,
        })
        return
      }

      // Multi-resize scales each unlocked selected object from the
      // selection bounds top-left anchor in world space.
      const selectionWidth = Math.max(
        1,
        interaction.selectionBoundsStart.maxX - interaction.selectionBoundsStart.minX
      )
      const selectionHeight = Math.max(
        1,
        interaction.selectionBoundsStart.maxY - interaction.selectionBoundsStart.minY
      )
      let nextWidth = Math.max(20, selectionWidth + deltaWorld.x)
      let nextHeight = Math.max(20, selectionHeight + deltaWorld.y)
      if (shouldSnapToGrid) {
        nextWidth = Math.max(20, snapToGrid(nextWidth, snapGridSize))
        nextHeight = Math.max(20, snapToGrid(nextHeight, snapGridSize))
      }
      let scaleX = nextWidth / selectionWidth
      let scaleY = nextHeight / selectionHeight
      if (keepAspectRatio) {
        const widthDominant =
          Math.abs(deltaWorld.x / selectionWidth) >= Math.abs(deltaWorld.y / selectionHeight)
        let uniformScale = widthDominant ? scaleX : scaleY
        uniformScale = Math.max(
          uniformScale,
          20 / selectionWidth,
          20 / selectionHeight
        )

        if (shouldSnapToGrid) {
          if (widthDominant) {
            const snappedWidth = Math.max(20, snapToGrid(selectionWidth * uniformScale, snapGridSize))
            uniformScale = snappedWidth / selectionWidth
          } else {
            const snappedHeight = Math.max(20, snapToGrid(selectionHeight * uniformScale, snapGridSize))
            uniformScale = snappedHeight / selectionHeight
          }
        }

        uniformScale = Math.max(
          uniformScale,
          20 / selectionWidth,
          20 / selectionHeight
        )
        scaleX = uniformScale
        scaleY = uniformScale
        nextWidth = selectionWidth * uniformScale
        nextHeight = selectionHeight * uniformScale
      }
      const anchorX = interaction.selectionBoundsStart.minX
      const anchorY = interaction.selectionBoundsStart.minY
      let selectionOffset = { x: 0, y: 0 }
      if (canSnapToObjectEdges && edgeCandidates.x.length > 0) {
        const resizedBounds = {
          minX: anchorX,
          minY: anchorY,
          maxX: anchorX + nextWidth,
          maxY: anchorY + nextHeight,
        }
        selectionOffset = getObjectEdgeSnapOffset(resizedBounds, edgeCandidates, snapToleranceWorld)
      }

      interaction.targets.forEach((target) => {
        let targetWidth = Math.max(20, target.start.w * scaleX)
        let targetHeight = Math.max(20, target.start.h * scaleY)
        if (target.objectType === 'shape_circle') {
          const widthDominant =
            Math.abs(deltaWorld.x / selectionWidth) >= Math.abs(deltaWorld.y / selectionHeight)
          const dominantScale = widthDominant ? scaleX : scaleY
          const circleStartSize = Math.min(target.start.w, target.start.h)
          let circleSize = Math.max(20, circleStartSize * dominantScale)
          if (shouldSnapToGrid) {
            circleSize = Math.max(20, snapToGrid(circleSize, snapGridSize))
          }
          targetWidth = circleSize
          targetHeight = circleSize
        }
        moveObject(target.id, {
          x: anchorX + (target.start.x - anchorX) * scaleX + selectionOffset.x,
          y: anchorY + (target.start.y - anchorY) * scaleY + selectionOffset.y,
          w: targetWidth,
          h: targetHeight,
          rotation: target.start.rotation,
        })
      })
      if (interaction.selectionFrameStart) {
        setMultiSelectionFrame({
          center: {
            x: anchorX + nextWidth / 2 + selectionOffset.x,
            y: anchorY + nextHeight / 2 + selectionOffset.y,
          },
          width: nextWidth,
          height: nextHeight,
          rotation: interaction.selectionFrameStart.rotation,
          selectionKey: interaction.selectionFrameStart.selectionKey,
        })
      }
      return
    }

    const pointerScreen = getViewportRelativePoint(event.clientX, event.clientY)
    const currentAngle = Math.atan2(
      pointerScreen.y - interaction.centerScreenStart.y,
      pointerScreen.x - interaction.centerScreenStart.x
    )
    const rawRotationDelta = currentAngle - interaction.startPointerAngle
    const snapStep = (10 * Math.PI) / 180
    const rotationDelta = event.altKey
      ? rawRotationDelta
      : Math.round(rawRotationDelta / snapStep) * snapStep
    if (interaction.selectionFrameStart) {
      setMultiSelectionFrame({
        ...interaction.selectionFrameStart,
        rotation: normalizeRotationRadians(interaction.selectionFrameStart.rotation + rotationDelta),
      })
    }

    interaction.targets.forEach((target) => {
      const startOffset = {
        x: target.start.x - interaction.centerStart.x,
        y: target.start.y - interaction.centerStart.y,
      }
      const rotatedOffset = rotatePoint(startOffset, rotationDelta)

      moveObject(target.id, {
        x: interaction.centerStart.x + rotatedOffset.x,
        y: interaction.centerStart.y + rotatedOffset.y,
        w: target.start.w,
        h: target.start.h,
        rotation: normalizeRotationRadians(target.start.rotation + rotationDelta),
      })
    })
  }

  function beginMarqueeSelection(
    pointerId: number,
    start: Point,
    baseSelection: string[],
    toggleObjectId: string | null = null
  ) {
    marqueeRef.current = {
      pointerId,
      startScreen: start,
      currentScreen: start,
      baseSelection,
      toggleObjectId,
    }
    setMarqueeRect(toRect(start, start))
  }

  function finalizeMarqueeSelection(interaction: MarqueeInteraction) {
    const rect = toRect(interaction.startScreen, interaction.currentScreen)
    const width = rect.maxX - rect.minX
    const height = rect.maxY - rect.minY
    if (width < 2 && height < 2) {
      if (interaction.toggleObjectId) {
        const nextSelection = new Set(interaction.baseSelection)
        if (nextSelection.has(interaction.toggleObjectId)) {
          nextSelection.delete(interaction.toggleObjectId)
        } else {
          nextSelection.add(interaction.toggleObjectId)
        }
        selectObjects([...nextSelection])
      }
      return
    }

    const usesContainMode = interaction.currentScreen.x >= interaction.startScreen.x
    const hits = editableObjects
      .filter((object) => {
        const bounds = getObjectScreenAabb(object, camera, viewportSize)
        return usesContainMode ? containsRect(rect, bounds) : intersectsRect(rect, bounds)
      })
      .map((object) => object.id)

    const nextSelection = new Set(interaction.baseSelection)
    hits.forEach((id) => nextSelection.add(id))
    selectObjects([...nextSelection])
  }

  function handleViewportPointerDown(event: PointerEvent<HTMLDivElement>) {
    closeContextMenu()
    if (styleCopySourceObjectId && event.button === 0) {
      event.preventDefault()
      setStyleCopySourceObjectId(null)
      return
    }
    if (activeImageEffectsObjectId) {
      closeActiveImageEffects(true)
    }

    if (editingTextboxId) {
      if (event.button === 0) {
        event.preventDefault()
      }
      return
    }

    if (
      event.button === 1 &&
      event.shiftKey &&
      selectedObject &&
      !isObjectEffectivelyLocked(selectedObject, objectById)
    ) {
      event.preventDefault()
      moveObject(selectedObject.id, {
        x: selectedObject.x,
        y: selectedObject.y,
        w: selectedObject.w,
        h: selectedObject.h,
        rotation: -camera.rotation,
      })
      return
    }

    if (event.button === 0 && event.shiftKey) {
      if (activeCropObjectId) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      const start = getViewportRelativePoint(event.clientX, event.clientY)
      beginMarqueeSelection(event.pointerId, start, selectedObjectIds)
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    if (event.button !== 0 && event.button !== 1) {
      return
    }

    event.preventDefault()
    if (event.button === 0) {
      if (activeCropObjectId) {
        return
      }
      clearSelection()
    }
    panRef.current = {
      pointerId: event.pointerId,
      originClient: { x: event.clientX, y: event.clientY },
      cameraStart: camera,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleViewportPointerMove(event: PointerEvent<HTMLDivElement>) {
    const imageCropInteraction = imageCropInteractionRef.current
    if (imageCropInteraction && imageCropInteraction.pointerId === event.pointerId) {
      applyImageCropInteraction(event, imageCropInteraction)
      return
    }

    const interaction = objectInteractionRef.current
    if (interaction && interaction.pointerId === event.pointerId) {
      applyObjectInteraction(event, interaction)
      return
    }

    const marquee = marqueeRef.current
    if (marquee && marquee.pointerId === event.pointerId) {
      const current = getViewportRelativePoint(event.clientX, event.clientY)
      marquee.currentScreen = current
      setMarqueeRect(toRect(marquee.startScreen, current))
      return
    }

    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) {
      return
    }

    const deltaScreen = {
      x: event.clientX - pan.originClient.x,
      y: event.clientY - pan.originClient.y,
    }

    const worldDelta = cameraDragDeltaToWorld(deltaScreen, pan.cameraStart)
    setCamera({
      ...pan.cameraStart,
      x: pan.cameraStart.x - worldDelta.x,
      y: pan.cameraStart.y - worldDelta.y,
    })
  }

  function handleViewportPointerUp(event: PointerEvent<HTMLDivElement>) {
    const imageCropInteraction = imageCropInteractionRef.current
    if (imageCropInteraction && imageCropInteraction.pointerId === event.pointerId) {
      imageCropInteractionRef.current = null
      commitCommandBatch()
    }

    const interaction = objectInteractionRef.current
    if (interaction && interaction.pointerId === event.pointerId) {
      objectInteractionRef.current = null
      commitCommandBatch()
    }

    const marquee = marqueeRef.current
    if (marquee && marquee.pointerId === event.pointerId) {
      finalizeMarqueeSelection(marquee)
      marqueeRef.current = null
      setMarqueeRect(null)
    }

    const pan = panRef.current
    if (pan && pan.pointerId === event.pointerId) {
      panRef.current = null
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const marqueeMode =
    marqueeRef.current && marqueeRef.current.currentScreen.x >= marqueeRef.current.startScreen.x
      ? 'contain'
      : 'intersect'

  return (
    <div
      ref={viewportRef}
      className="canvas-stage"
      style={{ background: canvasSettings.background }}
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes('Files')) {
          event.preventDefault()
        }
      }}
      onDrop={handleViewportDrop}
      onPointerDown={handleViewportPointerDown}
      onPointerMove={handleViewportPointerMove}
      onPointerUp={handleViewportPointerUp}
      onPointerCancel={handleViewportPointerUp}
      onDoubleClick={(event) => {
        if (!activeGroupObject) {
          return
        }

        const pointerScreen = getViewportRelativePoint(event.clientX, event.clientY)
        const pointerWorld = screenToWorld(pointerScreen, camera, viewportSize)
        if (!isPointInsideObjectRect(pointerWorld, activeGroupObject)) {
          event.preventDefault()
          exitGroup()
        }
      }}
      onContextMenu={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault()
          closeContextMenu()
        }
      }}
    >
      <svg
        width={viewportSize.width}
        height={viewportSize.height}
        className="grid-svg"
        aria-hidden="true"
      >
        <g className="minor-grid">
          {minorGridLines.x.map((line) => {
            const start = worldToScreen(
              { x: line.value, y: worldBounds.minY },
              camera,
              viewportSize
            )
            const end = worldToScreen({ x: line.value, y: worldBounds.maxY }, camera, viewportSize)
            return <line key={`x-${line.id}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
          })}
          {minorGridLines.y.map((line) => {
            const start = worldToScreen(
              { x: worldBounds.minX, y: line.value },
              camera,
              viewportSize
            )
            const end = worldToScreen({ x: worldBounds.maxX, y: line.value }, camera, viewportSize)
            return <line key={`y-${line.id}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
          })}
        </g>

        <g className="major-grid">
          {majorGridLines.x.map((line) => {
            const start = worldToScreen(
              { x: line.value, y: worldBounds.minY },
              camera,
              viewportSize
            )
            const end = worldToScreen({ x: line.value, y: worldBounds.maxY }, camera, viewportSize)
            return <line key={`mx-${line.id}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
          })}
          {majorGridLines.y.map((line) => {
            const start = worldToScreen(
              { x: worldBounds.minX, y: line.value },
              camera,
              viewportSize
            )
            const end = worldToScreen({ x: worldBounds.maxX, y: line.value }, camera, viewportSize)
            return <line key={`my-${line.id}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
          })}
        </g>
      </svg>

      <div className="objects-layer">
        {orderedObjects.map((object) => {
          const center = worldToScreen({ x: object.x, y: object.y }, camera, viewportSize)
          const widthPx = object.w * camera.zoom
          const heightPx = object.h * camera.zoom
          const isSelected = selectedObjectIds.includes(object.id)
          const isEditable = editableObjectIds.has(object.id)
          const isEffectivelyLocked = isObjectEffectivelyLocked(object, objectById)
          const isActiveGroupShell = activeGroupId !== null && object.id === activeGroupId
          const canEnterViaChildDoubleClick =
            activeGroupId === null && !isEditable && object.parentGroupId !== null

          const baseStyle = {
            left: center.x - widthPx / 2,
            top: center.y - heightPx / 2,
            width: widthPx,
            height: heightPx,
            transform: `rotate(${object.rotation + camera.rotation}rad)`,
          }

          const objectClasses = [
            'canvas-object',
            object.type,
            isSelected ? 'selected' : '',
            object.locked ? 'locked' : '',
            isEditable ? '' : 'inactive',
            canEnterViaChildDoubleClick ? 'enterable-child' : '',
            isActiveGroupShell ? 'active-group-shell' : '',
          ]
            .filter(Boolean)
            .join(' ')

          const shapeStyle =
            object.type === 'shape_rect' ||
              object.type === 'shape_circle' ||
              object.type === 'shape_arrow'
              ? {
                borderColor: object.shapeData.borderColor,
                borderStyle: object.shapeData.borderType,
                borderWidth: object.shapeData.borderWidth * camera.zoom,
                background: getShapeBackground(object.shapeData),
                opacity: object.shapeData.opacityPercent / 100,
                boxShadow: resolveObjectShadowCss(object.shapeData, camera.zoom),
                borderRadius:
                  object.type === 'shape_circle'
                    ? '9999px'
                    : `${Math.max(0, object.shapeData.radius) * camera.zoom}px`,
              }
              : {}
          const textboxStyle =
            object.type === 'textbox'
              ? {
                borderColor: object.textboxData.borderColor ?? DEFAULT_TEXTBOX_BORDER_COLOR,
                borderStyle: object.textboxData.borderType ?? 'solid',
                borderWidth:
                  (object.textboxData.borderWidth ?? DEFAULT_TEXTBOX_BORDER_WIDTH) * camera.zoom,
                background: getTextboxBackground(object.textboxData),
                opacity: (object.textboxData.opacityPercent ?? 100) / 100,
                boxShadow: resolveObjectShadowCss(object.textboxData, camera.zoom),
              }
              : {}
          const imageStyle =
            object.type === 'image'
              ? {
                opacity: object.imageData.opacityPercent / 100,
                filter: resolveObjectDropShadowFilter(object.imageData, camera.zoom),
                background: 'transparent',
              }
              : {}
          const imageAsset = object.type === 'image' ? assetById.get(object.imageData.assetId) : null
          const imageSrc = imageAsset
            ? `data:${imageAsset.mimeType};base64,${imageAsset.dataBase64}`
            : null
          const textboxHtml = object.type === 'textbox' ? resolveTextboxRichHtml(object.textboxData) : ''

          return (
            <div
              key={object.id}
              className={objectClasses}
              style={{ ...baseStyle, ...shapeStyle, ...textboxStyle, ...imageStyle }}
              onPointerDown={(event) => {
                if (styleCopySourceObject && event.button === 0) {
                  event.preventDefault()
                  event.stopPropagation()
                  closeContextMenu()
                  if (
                    object.id !== styleCopySourceObject.id &&
                    isEditable &&
                    !isObjectEffectivelyLocked(object, objectById) &&
                    object.type !== 'group'
                  ) {
                    applyCopiedStyle(styleCopySourceObject, object)
                    selectObjects([object.id])
                  }
                  setStyleCopySourceObjectId(null)
                  return
                }
                if (activeImageEffectsObjectId && activeImageEffectsObjectId !== object.id) {
                  closeActiveImageEffects(true)
                }
                if (editingTextboxId && editingTextboxId !== object.id) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }
                if (activeCropObjectId && object.id !== activeCropObjectId) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }
                const nowMs = performance.now()
                const isTextbox = object.type === 'textbox'
                const isRapidTextboxRepeat =
                  isTextbox &&
                  lastTextboxPointerRef.current?.objectId === object.id &&
                  nowMs - lastTextboxPointerRef.current.timestampMs <= DOUBLE_CLICK_MS
                if (isTextbox) {
                  lastTextboxPointerRef.current = {
                    objectId: object.id,
                    timestampMs: nowMs,
                  }
                }
                const enterGroupId =
                  activeGroupId === null
                    ? object.type === 'group'
                      ? object.id
                      : object.parentGroupId
                    : null
                const isRapidRepeatForGroupEntry =
                  enterGroupId !== null &&
                  lastPointerDownRef.current?.enterGroupId === enterGroupId &&
                  nowMs - lastPointerDownRef.current.timestampMs <= DOUBLE_CLICK_MS
                lastPointerDownRef.current = {
                  enterGroupId,
                  timestampMs: nowMs,
                }

                if (isRapidRepeatForGroupEntry && enterGroupId) {
                  event.preventDefault()
                  event.stopPropagation()
                  selectObjects([enterGroupId])
                  enterGroup(enterGroupId)
                  return
                }

                if (
                  isRapidTextboxRepeat &&
                  object.type === 'textbox' &&
                  isEditable &&
                  !isEffectivelyLocked
                ) {
                  event.preventDefault()
                  event.stopPropagation()
                  startTextboxEditing(object)
                  return
                }

                if (!isEditable) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }
                if (event.button !== 0) {
                  return
                }
                if (editingTextboxId === object.id) {
                  return
                }
                if (event.shiftKey) {
                  if (activeCropObjectId) {
                    event.preventDefault()
                    event.stopPropagation()
                    return
                  }
                  event.preventDefault()
                  event.stopPropagation()
                  closeContextMenu()
                  const start = getViewportRelativePoint(event.clientX, event.clientY)
                  beginMarqueeSelection(event.pointerId, start, selectedObjectIds, object.id)
                  viewportRef.current?.setPointerCapture(event.pointerId)
                  return
                }
                if (
                  object.type === 'image' &&
                  object.imageData.cropEnabled &&
                  !event.shiftKey &&
                  !isEffectivelyLocked
                ) {
                  event.preventDefault()
                  event.stopPropagation()
                  closeContextMenu()
                  if (!selectedObjectIds.includes(object.id)) {
                    selectObjects([object.id])
                  }
                  return
                }
                if (isEffectivelyLocked) {
                  event.preventDefault()
                  event.stopPropagation()
                  closeContextMenu()
                  if (!selectedObjectIds.includes(object.id) && !event.shiftKey) {
                    selectObjects([object.id])
                  }
                  panRef.current = {
                    pointerId: event.pointerId,
                    originClient: { x: event.clientX, y: event.clientY },
                    cameraStart: camera,
                  }
                  viewportRef.current?.setPointerCapture(event.pointerId)
                  return
                }
                event.preventDefault()
                event.stopPropagation()
                closeContextMenu()

                const isSelected = selectedObjectIds.includes(object.id)
                if (isSelected && selectedUnlockedObjects.length > 1) {
                  if (object.locked) {
                    return
                  }
                  beginObjectInteraction(event, selectedUnlockedObjects, 'move')
                  return
                }

                selectObjects([object.id])
                beginObjectInteraction(event, [object], 'move')
              }}
              onContextMenu={(event) => {
                if (editingTextboxId && editingTextboxId !== object.id) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }
                if (activeCropObjectId && object.id !== activeCropObjectId) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }
                if (!isEditable) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }
                event.preventDefault()
                event.stopPropagation()
                const pointer = getViewportRelativePoint(event.clientX, event.clientY)
                const selectionIds = selectedObjectIds.includes(object.id)
                  ? selectedObjectIds
                  : [object.id]
                if (!selectedObjectIds.includes(object.id)) {
                  selectObjects([object.id])
                }
                setContextMenu({
                  x: pointer.x,
                  y: pointer.y,
                  selectionIds,
                })
              }}
              onDoubleClick={(event) => {
                if (editingTextboxId && editingTextboxId !== object.id) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }
                if (activeCropObjectId && object.id !== activeCropObjectId) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }
                if (!isEditable) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }
                if (editingTextboxId === object.id) {
                  event.stopPropagation()
                  return
                }
                if (
                  object.type === 'textbox' &&
                  !isObjectEffectivelyLocked(object, objectById)
                ) {
                  event.preventDefault()
                  event.stopPropagation()
                  startTextboxEditing(object)
                  return
                }
                if (
                  object.type === 'image' &&
                  !isObjectEffectivelyLocked(object, objectById)
                ) {
                  event.preventDefault()
                  event.stopPropagation()
                  openImageReloadDialog(object.id)
                  return
                }
                if (object.type !== 'group') {
                  return
                }
                event.preventDefault()
                event.stopPropagation()
                selectObjects([object.id])
                enterGroup(object.id)
              }}
            >
              {object.type === 'shape_arrow' ? (
                <svg
                  viewBox="0 0 100 20"
                  preserveAspectRatio="none"
                  className="arrow-svg"
                  aria-hidden="true"
                >
                  <line x1="0" y1="10" x2="88" y2="10" />
                  <polygon points="88,3 100,10 88,17" />
                </svg>
              ) : object.type === 'image' ? (
                <div
                  className="canvas-image-clip"
                  style={{
                    borderColor: object.imageData.borderColor,
                    borderStyle: object.imageData.borderType,
                    borderWidth: `${Math.max(0, object.imageData.borderWidth * camera.zoom)}px`,
                    clipPath: `inset(${object.imageData.cropTopPercent}% ${object.imageData.cropRightPercent}% ${object.imageData.cropBottomPercent}% ${object.imageData.cropLeftPercent}% round ${Math.max(0, object.imageData.radius) * camera.zoom}px)`,
                  }}
                >
                  {imageSrc ? (
                    <img
                      src={imageSrc}
                      alt=""
                      draggable={false}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'fill',
                        filter: resolveImageFilterCss(object.imageData),
                      }}
                    />
                  ) : (
                    <span>Image</span>
                  )}
                </div>
              ) : object.type === 'textbox' ? (
                editingTextboxId === object.id ? (
                  <RichTextboxEditor
                    editorKey={object.id}
                    html={editingTextboxHtml}
                    fontFamily={object.textboxData.fontFamily}
                    contentScale={Math.max(0.01, camera.zoom)}
                    onContentChange={({ html, plainText, contentHeight }) => {
                      setEditingTextboxHtml(html)
                      setEditingTextboxPlainText(plainText)
                      applyTextboxAutoHeight(object, plainText, contentHeight)
                    }}
                    onEditorBlur={() => {
                      finishTextboxEditing(true)
                    }}
                    onEscape={() => {
                      finishTextboxEditing(false)
                    }}
                    onCommit={() => {
                      finishTextboxEditing(true)
                    }}
                  />
                ) : (
                  <div className="textbox-content">
                    <div
                      className="textbox-rich-content textbox-content-inner"
                      style={{
                        fontFamily: object.textboxData.fontFamily,
                        transform: `scale(${Math.max(0.01, camera.zoom)})`,
                        transformOrigin: 'top left',
                        width: `${100 / Math.max(0.01, camera.zoom)}%`,
                        height: `${100 / Math.max(0.01, camera.zoom)}%`,
                      }}
                      dangerouslySetInnerHTML={{
                        __html: textboxHtml,
                      }}
                    />
                  </div>
                )
              ) : object.type === 'group' ? null : (
                <span>{getObjectLabel(object)}</span>
              )}
            </div>
          )
        })}
      </div>

      <div className="slide-guides-layer" aria-hidden="true">
        {slideGuides.map((guide) => (
          <div key={guide.id}>
            <div
              className={`slide-guide-frame ${guide.isActive ? 'active' : ''} ${guide.isHovered ? 'hovered' : ''}`}
              style={{
                left: guide.left,
                top: guide.top,
                width: guide.width,
                height: guide.height,
                transform: `rotate(${guide.rotation}rad)`,
              }}
            />
            <div
              className={`slide-guide-name ${guide.isActive ? 'active' : ''}`}
              style={{
                left: guide.labelX,
                top: guide.labelY,
                transform: `translate(4px, -100%) rotate(${guide.rotation}rad)`,
                transformOrigin: '0% 100%',
              }}
            >
              {guide.name}
            </div>
          </div>
        ))}
      </div>

      {activeGroupObject && (
        <div
          className="active-group-exit-anchor"
          style={{
            left:
              worldToScreen({ x: activeGroupObject.x, y: activeGroupObject.y }, camera, viewportSize).x -
              (activeGroupObject.w * camera.zoom) / 2,
            top:
              worldToScreen({ x: activeGroupObject.x, y: activeGroupObject.y }, camera, viewportSize).y -
              (activeGroupObject.h * camera.zoom) / 2,
            width: activeGroupObject.w * camera.zoom,
            height: activeGroupObject.h * camera.zoom,
            transform: `rotate(${activeGroupObject.rotation + camera.rotation}rad)`,
          }}
        >
          <button
            type="button"
            className="active-group-exit-handle"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              exitGroup()
            }}
            aria-label="Exit group"
            title="Exit group"
          >
            <FontAwesomeIcon icon={faObjectUngroup} />
          </button>
        </div>
      )}

      {marqueeRect && (
        <div
          className={`marquee-select ${marqueeMode}`}
          style={{
            left: marqueeRect.minX,
            top: marqueeRect.minY,
            width: marqueeRect.maxX - marqueeRect.minX,
            height: marqueeRect.maxY - marqueeRect.minY,
          }}
        />
      )}

      {selectedObject && (
        <div
          className={`selection-overlay ${selectedObject.locked ? 'locked' : ''}`}
          style={{
            left:
              worldToScreen({ x: selectedObject.x, y: selectedObject.y }, camera, viewportSize).x -
              (selectedObject.w * camera.zoom) / 2,
            top:
              worldToScreen({ x: selectedObject.x, y: selectedObject.y }, camera, viewportSize).y -
              (selectedObject.h * camera.zoom) / 2,
            width: selectedObject.w * camera.zoom,
            height: selectedObject.h * camera.zoom,
            transform: `rotate(${selectedObject.rotation + camera.rotation}rad)`,
          }}
        >
          {selectedObject.type === 'image' && isSelectedImageEffectsToolbarOpen && (
            <div className="image-effects-toolbar" role="toolbar" aria-label="Image effects">
              {(() => {
                const selectedImageAsset = assetById.get(selectedObject.imageData.assetId)
                const selectedImageSrc = selectedImageAsset
                  ? `data:${selectedImageAsset.mimeType};base64,${selectedImageAsset.dataBase64}`
                  : null

                return IMAGE_FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.preset}
                    type="button"
                    className={`image-effects-option ${selectedObject.imageData.filterPreset === option.preset ? 'active' : ''
                      }`}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (selectedObject.locked || selectedObjectLockedByAncestor) {
                        return
                      }
                      setImageData(selectedObject.id, {
                        ...selectedObject.imageData,
                        effectsEnabled: true,
                        filterPreset: option.preset,
                      })
                    }}
                    aria-label={`Apply ${option.label} filter`}
                    title={`${option.label} filter`}
                    disabled={selectedObject.locked || selectedObjectLockedByAncestor}
                  >
                    {selectedImageSrc ? (
                      <img
                        src={selectedImageSrc}
                        alt=""
                        draggable={false}
                        className="image-effects-option-preview"
                        style={{
                          filter: resolveImageFilterCss({
                            effectsEnabled: true,
                            filterPreset: option.preset,
                          }),
                        }}
                      />
                    ) : (
                      <span className="image-effects-option-fallback">{option.label}</span>
                    )}
                  </button>
                ))
              })()}
            </div>
          )}

          {!selectedObject.locked &&
            !(selectedObject.type === 'image' && selectedObject.imageData.cropEnabled) && (
              <>
                <button
                  type="button"
                  className="resize-handle"
                  aria-label="Scale"
                  title="Scale"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    beginObjectInteraction(event, [selectedObject], 'resize')
                  }}
                />
                <button
                  type="button"
                  className="rotate-handle"
                  aria-label="Rotate"
                  title="Rotate"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    beginObjectInteraction(event, [selectedObject], 'rotate')
                  }}
                />
              </>
            )}

          {selectedObject.type === 'image' &&
            selectedObject.imageData.cropEnabled &&
            !selectedObject.locked && (
              <div
                className="image-crop-frame"
                style={{
                  left: `${selectedObject.imageData.cropLeftPercent}%`,
                  top: `${selectedObject.imageData.cropTopPercent}%`,
                  width: `${Math.max(1, 100 - selectedObject.imageData.cropLeftPercent - selectedObject.imageData.cropRightPercent)}%`,
                  height: `${Math.max(1, 100 - selectedObject.imageData.cropTopPercent - selectedObject.imageData.cropBottomPercent)}%`,
                }}
              >
                <button
                  type="button"
                  className="image-crop-frame-move"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    beginImageCropInteraction(event, selectedObject, 'move')
                  }}
                  aria-label="Move crop selection"
                  title="Move crop selection"
                />
                <button
                  type="button"
                  className="image-crop-frame-handle top-left"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    beginImageCropInteraction(event, selectedObject, 'top-left')
                  }}
                  aria-label="Crop top left"
                  title="Crop top left"
                />
                <button
                  type="button"
                  className="image-crop-frame-handle top"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    beginImageCropInteraction(event, selectedObject, 'top')
                  }}
                  aria-label="Crop top"
                  title="Crop top"
                />
                <button
                  type="button"
                  className="image-crop-frame-handle top-right"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    beginImageCropInteraction(event, selectedObject, 'top-right')
                  }}
                  aria-label="Crop top right"
                  title="Crop top right"
                />
                <button
                  type="button"
                  className="image-crop-frame-handle right"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    beginImageCropInteraction(event, selectedObject, 'right')
                  }}
                  aria-label="Crop right"
                  title="Crop right"
                />
                <button
                  type="button"
                  className="image-crop-frame-handle bottom-right"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    beginImageCropInteraction(event, selectedObject, 'bottom-right')
                  }}
                  aria-label="Crop bottom right"
                  title="Crop bottom right"
                />
                <button
                  type="button"
                  className="image-crop-frame-handle bottom"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    beginImageCropInteraction(event, selectedObject, 'bottom')
                  }}
                  aria-label="Crop bottom"
                  title="Crop bottom"
                />
                <button
                  type="button"
                  className="image-crop-frame-handle bottom-left"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    beginImageCropInteraction(event, selectedObject, 'bottom-left')
                  }}
                  aria-label="Crop bottom left"
                  title="Crop bottom left"
                />
                <button
                  type="button"
                  className="image-crop-frame-handle left"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    beginImageCropInteraction(event, selectedObject, 'left')
                  }}
                  aria-label="Crop left"
                  title="Crop left"
                />
              </div>
            )}

          <div className="selection-bottom-controls">
            <button
              type="button"
              className="lock-handle"
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                if (selectedObjectLockedByAncestor) {
                  return
                }
                toggleObjectLock(selectedObject.id)
              }}
              aria-label={
                selectedObjectLockedByAncestor
                  ? 'Object inherits lock from parent group'
                  : selectedObject.locked
                    ? 'Unlock object'
                    : 'Lock object'
              }
              title={
                selectedObjectLockedByAncestor
                  ? 'Unlock parent group to modify this object'
                  : selectedObject.locked
                    ? 'Unlock object'
                    : 'Lock object'
              }
              disabled={selectedObjectLockedByAncestor}
            >
              <FontAwesomeIcon icon={selectedObject.locked ? faLock : faLockOpen} />
            </button>
            {selectedObject.type !== 'group' && (
              <button
                type="button"
                className={`style-copy-handle ${styleCopySourceObjectId === selectedObject.id ? 'active' : ''}`}
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  if (styleCopySourceObjectId === selectedObject.id) {
                    setStyleCopySourceObjectId(null)
                    return
                  }
                  setStyleCopySourceObjectId(selectedObject.id)
                }}
                aria-label={
                  styleCopySourceObjectId === selectedObject.id ? 'Cancel style copy mode' : 'Copy style'
                }
                title={styleCopySourceObjectId === selectedObject.id ? 'Cancel style copy mode' : 'Copy style'}
              >
                <FontAwesomeIcon icon={faClone} />
              </button>
            )}
            {canToggleGroupFromSelection && (
              <button
                type="button"
                className="group-handle"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  if (selectedObject.type === 'group') {
                    enterGroup(selectedObject.id)
                  }
                }}
                aria-label="Enter group"
                title="Enter group"
              >
                <FontAwesomeIcon icon={faLayerGroup} />
              </button>
            )}
            {selectedObject.type === 'image' && (
              <>
                <button
                  type="button"
                  className="image-reload-handle"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (selectedObject.locked || selectedObjectLockedByAncestor) {
                      return
                    }
                    openImageReloadDialog(selectedObject.id)
                  }}
                  aria-label="Reload image from disk"
                  title={
                    selectedObjectLockedByAncestor
                      ? 'Unlock parent group to reload image'
                      : selectedObject.locked
                        ? 'Unlock object to reload image'
                        : 'Reload image from disk'
                  }
                  disabled={selectedObject.locked || selectedObjectLockedByAncestor}
                >
                  <FontAwesomeIcon icon={faFileImport} />
                </button>
                <button
                  type="button"
                  className={`image-effects-handle ${selectedObject.imageData.effectsEnabled ? 'active' : ''}`}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (selectedObject.locked || selectedObjectLockedByAncestor) {
                      return
                    }
                    if (!selectedObject.imageData.effectsEnabled) {
                      setImageData(selectedObject.id, {
                        ...selectedObject.imageData,
                        effectsEnabled: true,
                      })
                      setActiveImageEffectsObjectId(selectedObject.id)
                      return
                    }
                    if (isSelectedImageEffectsToolbarOpen) {
                      setImageData(selectedObject.id, {
                        ...selectedObject.imageData,
                        effectsEnabled: false,
                      })
                      setActiveImageEffectsObjectId(null)
                      return
                    }
                    setActiveImageEffectsObjectId(selectedObject.id)
                  }}
                  aria-label={
                    !selectedObject.imageData.effectsEnabled
                      ? 'Enable image effects'
                      : isSelectedImageEffectsToolbarOpen
                        ? 'Disable image effects'
                        : 'Edit image effects'
                  }
                  title={
                    selectedObjectLockedByAncestor
                      ? 'Unlock parent group to edit image effects'
                      : selectedObject.locked
                        ? 'Unlock object to edit image effects'
                        : !selectedObject.imageData.effectsEnabled
                          ? 'Enable image effects'
                          : isSelectedImageEffectsToolbarOpen
                            ? 'Disable image effects'
                            : 'Edit image effects'
                  }
                  disabled={selectedObject.locked || selectedObjectLockedByAncestor}
                >
                  <FontAwesomeIcon icon={faSliders} />
                </button>
                <button
                  type="button"
                  className={`image-crop-handle ${selectedObject.imageData.cropEnabled ? 'active' : ''}`}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (selectedObject.locked || selectedObjectLockedByAncestor) {
                      return
                    }
                    setImageData(selectedObject.id, {
                      ...selectedObject.imageData,
                      cropEnabled: !selectedObject.imageData.cropEnabled,
                    })
                  }}
                  aria-label={selectedObject.imageData.cropEnabled ? 'Disable crop mode' : 'Enable crop mode'}
                  title={
                    selectedObjectLockedByAncestor
                      ? 'Unlock parent group to crop image'
                      : selectedObject.locked
                        ? 'Unlock object to crop image'
                        : selectedObject.imageData.cropEnabled
                          ? 'Disable crop mode'
                          : 'Enable crop mode'
                  }
                  disabled={selectedObject.locked || selectedObjectLockedByAncestor}
                >
                  <FontAwesomeIcon icon={faCropSimple} />
                </button>
              </>
            )}
            {selectedObject.type === 'textbox' && (
              <button
                type="button"
                className="textbox-handle"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  if (editingTextboxId === selectedObject.id) {
                    finishTextboxEditing(true)
                    return
                  }
                  if (selectedObject.locked || selectedObjectLockedByAncestor) {
                    return
                  }
                  startTextboxEditing(selectedObject)
                }}
                aria-label={
                  editingTextboxId === selectedObject.id
                    ? 'Leave textbox editing'
                    : 'Enter textbox editing'
                }
                title={
                  editingTextboxId === selectedObject.id
                    ? 'Leave textbox editing'
                    : selectedObjectLockedByAncestor
                      ? 'Unlock parent group to edit text'
                      : selectedObject.locked
                        ? 'Unlock object to edit text'
                        : 'Enter textbox editing'
                }
                disabled={
                  editingTextboxId !== selectedObject.id &&
                  (selectedObject.locked || selectedObjectLockedByAncestor)
                }
              >
                <FontAwesomeIcon icon={faPenToSquare} />
              </button>
            )}
          </div>
        </div>
      )}

      {!selectedObject && multiSelectionFrame && (
        <div
          className="selection-overlay"
          style={{
            left:
              worldToScreen(
                {
                  x: multiSelectionFrame.center.x,
                  y: multiSelectionFrame.center.y,
                },
                camera,
                viewportSize
              ).x -
              (multiSelectionFrame.width * camera.zoom) / 2,
            top:
              worldToScreen(
                {
                  x: multiSelectionFrame.center.x,
                  y: multiSelectionFrame.center.y,
                },
                camera,
                viewportSize
              ).y -
              (multiSelectionFrame.height * camera.zoom) / 2,
            width: multiSelectionFrame.width * camera.zoom,
            height: multiSelectionFrame.height * camera.zoom,
            transform: `rotate(${camera.rotation + multiSelectionFrame.rotation}rad)`,
          }}
        >
          <button
            type="button"
            className="resize-handle"
            aria-label="Scale selection"
            title="Scale selection"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              beginObjectInteraction(event, selectedUnlockedObjects, 'resize')
            }}
          />
          <button
            type="button"
            className="rotate-handle"
            aria-label="Rotate selection"
            title="Rotate selection"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              beginObjectInteraction(event, selectedUnlockedObjects, 'rotate')
            }}
          />
        </div>
      )}

      {contextMenu && (
        <div
          className="object-context-menu"
          style={{
            left: clamp(contextMenu.x, 8, viewportSize.width - 188),
            top: clamp(contextMenu.y, 8, viewportSize.height - 244),
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            disabled={contextSelectionIds.length === 0}
            onClick={() => {
              copySelection(contextSelectionIds)
              pasteClipboard()
              closeContextMenu()
            }}
            title={contextSelectionIds.length === 0 ? 'No objects selected' : 'Duplicate'}
          >
            <FontAwesomeIcon icon={faClone} />
            Duplicate
          </button>
          <button
            type="button"
            disabled={contextSelectionIds.length === 0}
            onClick={() => {
              copySelection(contextSelectionIds)
              closeContextMenu()
            }}
            title={contextSelectionIds.length === 0 ? 'No objects selected' : 'Copy'}
          >
            <FontAwesomeIcon icon={faClone} />
            Copy
          </button>
          <button
            type="button"
            disabled={!clipboardRef.current}
            onClick={() => {
              pasteClipboard()
              closeContextMenu()
            }}
            title={clipboardRef.current ? 'Paste' : 'Clipboard empty'}
          >
            <FontAwesomeIcon icon={faClone} />
            Paste
          </button>
          <button
            type="button"
            disabled={contextUnlockedIds.length === 0}
            onClick={() => {
              applyDeleteSelection(contextUnlockedIds)
              closeContextMenu()
            }}
            title={contextUnlockedIds.length === 0 ? 'No unlocked objects selected' : 'Remove'}
          >
            <FontAwesomeIcon icon={faTrashCan} />
            Remove
          </button>
          <hr />
          <button
            type="button"
            disabled={!canGroup}
            title={canGroup ? 'Group' : 'Select multiple ungrouped objects'}
            onClick={() => {
              groupObjects(contextSelectionIds)
              closeContextMenu()
            }}
          >
            <FontAwesomeIcon icon={faLayerGroup} />
            Group
          </button>
          <button
            type="button"
            disabled={!canUngroup}
            title={canUngroup ? 'Ungroup' : 'Select one group object'}
            onClick={() => {
              ungroupObjects(contextSelectionIds)
              closeContextMenu()
            }}
          >
            <FontAwesomeIcon icon={faObjectUngroup} />
            Ungroup
          </button>
          <hr />
          <button
            type="button"
            disabled={!canBringToFront}
            onClick={() => {
              applyLayerAction('top')
              closeContextMenu()
            }}
          >
            <FontAwesomeIcon icon={faArrowsUpToLine} />
            Bring to front
          </button>
          <button
            type="button"
            disabled={!canBringForward}
            onClick={() => {
              applyLayerAction('up')
              closeContextMenu()
            }}
          >
            <FontAwesomeIcon icon={faArrowUp} />
            Bring forward
          </button>
          <button
            type="button"
            disabled={!canSendBackward}
            onClick={() => {
              applyLayerAction('down')
              closeContextMenu()
            }}
          >
            <FontAwesomeIcon icon={faArrowDown} />
            Send backward
          </button>
          <button
            type="button"
            disabled={!canSendToBack}
            onClick={() => {
              applyLayerAction('bottom')
              closeContextMenu()
            }}
          >
            <FontAwesomeIcon icon={faArrowsDownToLine} />
            Send to back
          </button>
        </div>
      )}

      <input
        ref={imageReloadInputRef}
        type="file"
        accept={SUPPORTED_IMAGE_ACCEPT}
        onChange={handleImageReloadFile}
        style={{ display: 'none' }}
      />

      <div className="camera-card" aria-label="Camera position">
        <span className="camera-pos-item">X {camera.x.toFixed(1)}</span>
        <span className="camera-pos-item">Y {camera.y.toFixed(1)}</span>
        <span className="camera-pos-item">
          <FontAwesomeIcon icon={faMagnifyingGlass} />
          {camera.zoom.toFixed(2)}
        </span>
        <span className="camera-pos-item">
          <FontAwesomeIcon icon={faCompass} />
          {((camera.rotation * 180) / Math.PI).toFixed(1)}°
        </span>
      </div>
    </div>
  )
}
