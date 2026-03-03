import {
  useEffect,
  useMemo,
  useRef,
  useState,
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
  faLayerGroup,
  faLock,
  faLockOpen,
  faMagnifyingGlass,
  faObjectUngroup,
  faTrashCan,
} from '@fortawesome/free-solid-svg-icons'
import {
  canReorderLayer,
  type Asset,
  type CanvasObject,
  type LayerOrderAction,
  type ShapeData,
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

interface MarqueeInteraction {
  pointerId: number
  startScreen: Point
  currentScreen: Point
  baseSelection: string[]
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

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpg',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
])

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
    return `linear-gradient(${gradient.angleDeg}deg, ${gradient.colorA}, ${gradient.colorB})`
  }
  return shapeData.fillColor
}

function getObjectLabel(object: CanvasObject): string {
  if (object.type === 'textbox') {
    const content = object.textboxData.runs.map((run) => run.text).join('')
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

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Failed to read file'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('Failed to load image dimensions'))
    image.src = dataUrl
  })
}

function toAssetBase64(dataUrl: string): string {
  const [, base64] = dataUrl.split(',', 2)
  return base64 ?? ''
}

export function CanvasViewport() {
  const viewportRef = useRef<HTMLDivElement>(null)
  const panRef = useRef<PanInteraction | null>(null)
  const objectInteractionRef = useRef<ObjectInteraction | null>(null)
  const marqueeRef = useRef<MarqueeInteraction | null>(null)
  const clipboardRef = useRef<ClipboardState | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [multiSelectionFrame, setMultiSelectionFrame] = useState<SelectionFrameState | null>(null)

  const camera = useEditorStore((state) => state.camera)
  const setCamera = useEditorStore((state) => state.setCamera)
  const canvasSettings = useEditorStore((state) => state.document.canvas)
  const objects = useEditorStore((state) => state.document.objects)
  const selectedObjectIds = useEditorStore((state) => state.ui.selectedObjectIds)
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
  const beginCommandBatch = useEditorStore((state) => state.beginCommandBatch)
  const commitCommandBatch = useEditorStore((state) => state.commitCommandBatch)

  const viewportSize = useViewportSize(viewportRef)
  const orderedObjects = useMemo(() => [...objects].sort((a, b) => a.zIndex - b.zIndex), [objects])
  const editableObjects = useMemo(() => {
    if (!activeGroupId) {
      return orderedObjects
    }
    return orderedObjects.filter((object) => object.parentGroupId === activeGroupId)
  }, [activeGroupId, orderedObjects])
  const selectedObject =
    selectedObjectIds.length === 1
      ? (orderedObjects.find((entry) => entry.id === selectedObjectIds[0]) ?? null)
      : null
  const selectedObjects = useMemo(() => {
    const selectedSet = new Set(selectedObjectIds)
    return editableObjects.filter((object) => selectedSet.has(object.id))
  }, [editableObjects, selectedObjectIds])
  const selectedGroup =
    selectedObjects.length === 1 && selectedObjects[0]?.type === 'group' ? selectedObjects[0] : null
  const selectedUnlockedObjects = useMemo(
    () => selectedObjects.filter((object) => !object.locked),
    [selectedObjects]
  )
  const selectedUnlockedIds = useMemo(
    () => selectedUnlockedObjects.map((object) => object.id),
    [selectedUnlockedObjects]
  )
  const selectedUnlockedIdsKey = useMemo(
    () => getSelectionKey(selectedUnlockedIds),
    [selectedUnlockedIds]
  )

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

      if (event.altKey) {
        const rotationDelta = event.deltaY * 0.002
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
      const nextZoom = clamp(camera.zoom * zoomFactor, 0.1, 10)
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
  }, [camera, setCamera, viewportSize])

  const contextSelectionIds = contextMenu?.selectionIds ?? selectedObjectIds
  const contextSelectionObjects = useMemo(() => {
    const selectedSet = new Set(contextSelectionIds)
    return editableObjects.filter((object) => selectedSet.has(object.id))
  }, [contextSelectionIds, editableObjects])
  const contextUnlockedIds = useMemo(
    () => contextSelectionObjects.filter((object) => !object.locked).map((object) => object.id),
    [contextSelectionObjects]
  )

  const canBringToFront = canReorderLayer(objects, contextSelectionIds, 'top')
  const canBringForward = canReorderLayer(objects, contextSelectionIds, 'up')
  const canSendBackward = canReorderLayer(objects, contextSelectionIds, 'down')
  const canSendToBack = canReorderLayer(objects, contextSelectionIds, 'bottom')
  const canGroup =
    contextSelectionObjects.length > 1 &&
    contextSelectionObjects.every(
      (object) => object.parentGroupId === null && object.type !== 'group'
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

    const files = Array.from(event.dataTransfer.files ?? []).filter((file) =>
      SUPPORTED_IMAGE_TYPES.has(file.type)
    )
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
            keepAspectRatio: true,
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
    const unlockedTargets = targets.filter((target) => !target.locked)
    if (unlockedTargets.length === 0) {
      return
    }

    const interactionSelectionKey = getSelectionKey(unlockedTargets.map((target) => target.id))
    const frameStart =
      unlockedTargets.length > 1 && multiSelectionFrame?.selectionKey === interactionSelectionKey
        ? multiSelectionFrame
        : null

    const selectionBoundsStart = frameStart
      ? {
          minX: frameStart.center.x - frameStart.width / 2,
          minY: frameStart.center.y - frameStart.height / 2,
          maxX: frameStart.center.x + frameStart.width / 2,
          maxY: frameStart.center.y + frameStart.height / 2,
        }
      : getObjectsWorldAabb(unlockedTargets)
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

    beginCommandBatch(unlockedTargets.length > 1 ? 'Objects transform' : 'Object transform')
    objectInteractionRef.current = {
      pointerId: event.pointerId,
      targets: unlockedTargets.map((target) => ({
        id: target.id,
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
    const snapGridSize = canvasSettings.baseGridSize
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
      if (interaction.targets.length === 1) {
        const target = interaction.targets[0]
        const localDelta = rotatePoint(deltaWorld, -target.start.rotation)
        let nextWidth = Math.max(20, target.start.w + localDelta.x)
        let nextHeight = Math.max(20, target.start.h + localDelta.y)
        if (shouldSnapToGrid) {
          nextWidth = Math.max(20, snapToGrid(nextWidth, snapGridSize))
          nextHeight = Math.max(20, snapToGrid(nextHeight, snapGridSize))
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
      const scaleX = nextWidth / selectionWidth
      const scaleY = nextHeight / selectionHeight
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
        moveObject(target.id, {
          x: anchorX + (target.start.x - anchorX) * scaleX + selectionOffset.x,
          y: anchorY + (target.start.y - anchorY) * scaleY + selectionOffset.y,
          w: Math.max(20, target.start.w * scaleX),
          h: Math.max(20, target.start.h * scaleY),
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
    const rotationDelta = currentAngle - interaction.startPointerAngle
    if (interaction.selectionFrameStart) {
      setMultiSelectionFrame({
        ...interaction.selectionFrameStart,
        rotation: interaction.selectionFrameStart.rotation + rotationDelta,
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
        rotation: target.start.rotation + rotationDelta,
      })
    })
  }

  function finalizeMarqueeSelection(interaction: MarqueeInteraction) {
    const rect = toRect(interaction.startScreen, interaction.currentScreen)
    const width = rect.maxX - rect.minX
    const height = rect.maxY - rect.minY
    if (width < 2 && height < 2) {
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

    if (event.button === 0 && event.shiftKey) {
      event.preventDefault()
      const start = getViewportRelativePoint(event.clientX, event.clientY)
      marqueeRef.current = {
        pointerId: event.pointerId,
        startScreen: start,
        currentScreen: start,
        baseSelection: selectedObjectIds,
      }
      setMarqueeRect(toRect(start, start))
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    if (event.button !== 0 && event.button !== 1) {
      return
    }

    event.preventDefault()
    if (event.button === 0) {
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
        {editableObjects.map((object) => {
          const center = worldToScreen({ x: object.x, y: object.y }, camera, viewportSize)
          const widthPx = object.w * camera.zoom
          const heightPx = object.h * camera.zoom
          const isSelected = selectedObjectIds.includes(object.id)

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
                  borderRadius: object.type === 'shape_circle' ? '9999px' : undefined,
                }
              : {}

          return (
            <div
              key={object.id}
              className={objectClasses}
              style={{ ...baseStyle, ...shapeStyle }}
              onPointerDown={(event) => {
                if (event.button !== 0) {
                  return
                }
                event.preventDefault()
                event.stopPropagation()
                closeContextMenu()

                if (event.shiftKey) {
                  const nextSelection = new Set(selectedObjectIds)
                  if (nextSelection.has(object.id)) {
                    nextSelection.delete(object.id)
                  } else {
                    nextSelection.add(object.id)
                  }
                  selectObjects([...nextSelection])
                  return
                }

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
              ) : (
                <span>{getObjectLabel(object)}</span>
              )}
            </div>
          )
        })}
      </div>

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
          {!selectedObject.locked && (
            <>
              <button
                type="button"
                className="resize-handle"
                aria-label="Resize"
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
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  beginObjectInteraction(event, [selectedObject], 'rotate')
                }}
              />
            </>
          )}

          <button
            type="button"
            className="lock-handle"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              toggleObjectLock(selectedObject.id)
            }}
            aria-label={selectedObject.locked ? 'Unlock object' : 'Lock object'}
            title={selectedObject.locked ? 'Unlock object' : 'Lock object'}
          >
            <FontAwesomeIcon icon={selectedObject.locked ? faLockOpen : faLock} />
          </button>
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
            aria-label="Resize selection"
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
