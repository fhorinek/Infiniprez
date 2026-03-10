import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faAlignCenter,
  faAlignLeft,
  faAlignRight,
  faArrowsDownToLine,
  faArrowsUpToLine,
  faArrowDown,
  faArrowUp,
  faClone,
  faCompass,
  faCropSimple,
  faFileImport,
  faGripLines,
  faLayerGroup,
  faListUl,
  faLock,
  faLockOpen,
  faMagnifyingGlass,
  faMobileScreenButton,
  faEye,
  faEyeSlash,
  faImage,
  faObjectUngroup,
  faPenToSquare,
  faPlay,
  faPause,
  faRotateLeft,
  faRotateRight,
  faSliders,
  faTrashCan,
  faGripLinesVertical,
  faUpDownLeftRight,
  faVideo,
} from '@fortawesome/free-solid-svg-icons'
import {
  canReorderLayer,
  type Asset,
  type CanvasObject,
  type FillGradient,
  type LayerOrderAction,
  type ShapeKind,
  type ShapeData,
  type TextRun,
} from '../model'
import type { StylePreset } from '../stylePresets'
import { useEditorStore } from '../store'
import { type CameraState } from '../store/types'
import { zoomFromDiagonal } from '../slideDiagonal'
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
import { getAlignmentDeltas, type AlignmentAction } from './alignment'
import { RichTextboxEditor } from './RichTextboxEditor'
import {
  resolveTextboxBaseTextStyle,
  resolveTextboxRichHtml,
  richHtmlToPlainText,
  textboxUsesFontFamily,
} from '../textboxRichText'
import {
  buildLibraryAsset,
  findMatchingLibraryAsset,
  isSupportedLibraryAssetFile,
  resolveLibraryAssetKind,
} from '../assetFile'
import {
  SUPPORTED_IMAGE_ACCEPT,
  getImageDimensions,
  isSupportedImageFile,
  readFileAsDataUrl,
  toAssetBase64,
} from '../imageFile'
import { IMAGE_FILTER_OPTIONS, resolveImageFilterCss } from '../imageEffects'
import {
  createDefaultImageData,
  createDefaultSoundData,
  createDefaultVideoData,
  getDefaultPlacedMediaSize,
  getZoomAdjustedObjectScalePercent,
  isObjectAspectRatioLocked,
  resolveObjectBorderScale,
} from '../objectDefaults'
import { resolveObjectDropShadowFilter, resolveObjectShadowCss } from '../objectShadow'
import {
  getShapeAdjustmentHandle,
  getShapeBorderRadius,
  getShapeClipPath,
  normalizeShapeKind,
  resolveShapeAdjustmentFromLocalPoint,
} from '../shapeStyle'
import { ShapeSvg } from '../ShapeSvg'
import { ASSET_LIBRARY_DRAG_MIME, type AssetLibraryDragPayload } from '../assetDrag'
import { collectAvailableTextboxFonts, resolveAssetFontFamily } from '../fontAssets'

interface GridLine {
  id: string
  value: number
}

type TargetDisplayPreset =
  | 'ratio-16-9'
  | 'ratio-16-10'
  | 'ratio-20-9'
  | 'ratio-4-3'
type TargetDisplayOrientation = 'landscape' | 'portrait'

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
    keepAspectRatio: boolean
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

interface ShapeAdjustInteraction {
  pointerId: number
  objectId: string
  objectType: 'shape_rect' | 'shape_circle'
  cameraStart: CameraState
  objectStart: TransformSnapshot
  shapeDataStart: ShapeData
}

interface MarqueeInteraction {
  pointerId: number
  startScreen: Point
  currentScreen: Point
  baseSelection: string[]
  toggleObjectId: string | null
}

interface CreationToolConfig {
  type: 'textbox' | 'shape_rect' | 'shape_circle' | 'image'
  shapeKind?: ShapeKind
  image?: {
    intrinsicWidth: number
    intrinsicHeight: number
  }
}

interface CreationInteraction {
  pointerId: number
  tool: CreationToolConfig['type']
  startScreen: Point
  currentScreen: Point
  cameraStart: CameraState
  image?: CreationToolConfig['image']
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

interface SnapEdgeCandidate {
  value: number
  minCross: number
  maxCross: number
}

interface SnapCandidateEdges {
  x: SnapEdgeCandidate[]
  y: SnapEdgeCandidate[]
}

interface SmartGuideLine {
  orientation: 'vertical' | 'horizontal'
  position: number
  start: number
  end: number
  kind: 'align' | 'spacing'
}

interface SnapResult {
  offset: Point
  guides: SmartGuideLine[]
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

interface AlignmentSelectionUnit {
  id: string
  bounds: Rect
  targets: CanvasObject[]
}

type TemplatePlaceholderChoice = 'text' | 'list' | 'image' | 'video'

const DOUBLE_CLICK_MS = 500
const TEXTBOX_CAMERA_ROTATION_TRANSITION_MS = 220
const CAMERA_RESET_TRANSITION_MS = 260
const DEFAULT_TEXTBOX_BACKGROUND = '#1f3151'
const DEFAULT_TEXTBOX_BORDER_COLOR = '#b2c6ee'
const DEFAULT_TEXTBOX_BORDER_WIDTH = 1
const TEXTBOX_LINE_HEIGHT = 1.35
const TARGET_DISPLAY_MIN_BORDER_SEPARATION_PX = 32
const SUPPORTED_VIDEO_ACCEPT = 'video/mp4,video/webm,video/ogg,video/quicktime,.mp4,.webm,.ogg,.ogv,.mov'
const TARGET_DISPLAY_PRESETS: Array<{
  value: TargetDisplayPreset
  label: string
  width: number | null
  height: number | null
}> = [
    { value: 'ratio-16-9', label: '16:9', width: 1600, height: 900 },
    { value: 'ratio-16-10', label: '16:10', width: 1600, height: 1000 },
    { value: 'ratio-20-9', label: '20:9', width: 2000, height: 900 },
    { value: 'ratio-4-3', label: '4:3', width: 1600, height: 1200 },
  ]
const UNIVERSAL_TEMPLATE_CHOICES: Array<{
  choice: TemplatePlaceholderChoice
  label: string
  icon: typeof faPenToSquare
  cornerClassName: string
}> = [
    { choice: 'text', label: 'Text', icon: faPenToSquare, cornerClassName: 'corner-top-left' },
    { choice: 'list', label: 'Bullets', icon: faListUl, cornerClassName: 'corner-top-right' },
    { choice: 'image', label: 'Image', icon: faImage, cornerClassName: 'corner-bottom-left' },
    { choice: 'video', label: 'Video', icon: faVideo, cornerClassName: 'corner-bottom-right' },
  ]

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

function getTemplatePlaceholderBadge(
  kind: Extract<CanvasObject, { type: 'template_placeholder' }>['templatePlaceholderData']['kind']
) {
  if (kind === 'universal') {
    return 'ANY'
  }
  if (kind === 'image') {
    return 'IMG'
  }
  if (kind === 'list') {
    return 'LIST'
  }
  return 'TEXT'
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

function CanvasVideoPreview({
  src,
  muted,
  loop,
  widthPx,
  heightPx,
  onVideoElement,
}: {
  src: string
  muted: boolean
  loop: boolean
  widthPx: number
  heightPx: number
  onVideoElement?: (element: HTMLVideoElement | null) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }
    video.pause()
    setIsPlaying(false)
    try {
      video.currentTime = 0
    } catch {
      // Ignore currentTime assignment failures before metadata is ready.
    }
  }, [src])

  return (
    <div
      className={`canvas-video-preview ${isHovered ? 'hovered' : ''}`}
      style={{
        width: `${widthPx}px`,
        height: `${heightPx}px`,
      }}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
    >
      <video
        ref={(node) => {
          videoRef.current = node
          onVideoElement?.(node)
        }}
        src={src}
        muted={muted}
        loop={loop}
        playsInline
        preload="metadata"
        onLoadedMetadata={() => {
          const video = videoRef.current
          if (!video) {
            return
          }
          video.pause()
          setIsPlaying(false)
          video.currentTime = 0
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        style={{
          width: `${widthPx}px`,
          height: `${heightPx}px`,
          objectFit: 'fill',
        }}
      />
      <div className="canvas-video-controls">
        <button
          type="button"
          className="canvas-video-control-btn"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            const video = videoRef.current
            if (!video) {
              return
            }
            if (video.paused) {
              void video.play().catch(() => undefined)
            } else {
              video.pause()
            }
          }}
          aria-label={isPlaying ? 'Pause video' : 'Play video'}
          title={isPlaying ? 'Pause video' : 'Play video'}
        >
          <FontAwesomeIcon icon={isPlaying ? faPause : faPlay} />
        </button>
        <button
          type="button"
          className="canvas-video-control-btn"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            const video = videoRef.current
            if (!video) {
              return
            }
            video.currentTime = 0
            if (!video.paused) {
              void video.play().catch(() => undefined)
            }
          }}
          aria-label="Restart video"
          title="Restart video"
        >
          <FontAwesomeIcon icon={faRotateLeft} />
        </button>
      </div>
    </div>
  )
}

function CanvasSoundPreview({
  src,
  label,
  loop,
  contentScale,
  onAudioElement,
}: {
  src: string
  label: string
  loop: boolean
  contentScale: number
  onAudioElement?: (element: HTMLAudioElement | null) => void
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const safeContentScale = Math.max(0.01, contentScale)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) {
      return
    }
    audio.pause()
    setIsPlaying(false)
    try {
      audio.currentTime = 0
    } catch {
      // Ignore currentTime assignment failures before metadata is ready.
    }
  }, [src])

  return (
    <div
      className="canvas-sound-preview"
      style={
        {
          '--canvas-sound-scale': String(safeContentScale),
        } as CSSProperties
      }
    >
      <audio
        ref={(node) => {
          audioRef.current = node
          onAudioElement?.(node)
        }}
        src={src}
        preload="metadata"
        loop={loop}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onLoadedMetadata={() => {
          const audio = audioRef.current
          if (!audio) {
            return
          }
          audio.pause()
          setIsPlaying(false)
          audio.currentTime = 0
        }}
      />
      <span className="canvas-sound-icon" aria-hidden="true">
        <FontAwesomeIcon icon={isPlaying ? faPause : faPlay} />
      </span>
      <strong className="canvas-sound-label">{label}</strong>
    </div>
  )
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

  if (object.type === 'template_placeholder') {
    return object.templatePlaceholderData.prompt
  }

  if (object.type === 'image') {
    return 'Image'
  }

  if (object.type === 'video') {
    return 'Video'
  }

  if (object.type === 'sound') {
    return 'Sound'
  }

  return 'Group'
}

function resolveTextboxObjectScale(
  _textboxData: Extract<CanvasObject, { type: 'textbox' }>['textboxData'],
  scalePercent: number
) {
  return Math.max(1, Math.min(10000, scalePercent)) / 100
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
  const element = target instanceof HTMLElement ? target : null
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

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y !== 0) {
    const next = x % y
    x = y
    y = next
  }
  return Math.max(1, x)
}

function formatAspectRatio(width: number, height: number) {
  const divisor = gcd(width, height)
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`
}

function collectSnapCandidateEdges(objects: CanvasObject[]): SnapCandidateEdges {
  const x: SnapEdgeCandidate[] = []
  const y: SnapEdgeCandidate[] = []

  for (const object of objects) {
    const bounds = getObjectWorldAabb(object)
    x.push(
      { value: bounds.minX, minCross: bounds.minY, maxCross: bounds.maxY },
      { value: bounds.maxX, minCross: bounds.minY, maxCross: bounds.maxY },
      {
        value: (bounds.minX + bounds.maxX) / 2,
        minCross: bounds.minY,
        maxCross: bounds.maxY,
      }
    )
    y.push(
      { value: bounds.minY, minCross: bounds.minX, maxCross: bounds.maxX },
      { value: bounds.maxY, minCross: bounds.minX, maxCross: bounds.maxX },
      {
        value: (bounds.minY + bounds.maxY) / 2,
        minCross: bounds.minX,
        maxCross: bounds.maxX,
      }
    )
  }

  return { x, y }
}

function getBestSnapMatch(values: number[], candidates: SnapEdgeCandidate[], tolerance: number) {
  let bestDelta = 0
  let bestAbsDelta = tolerance + 1
  let bestCandidate: SnapEdgeCandidate | null = null

  for (const value of values) {
    for (const candidate of candidates) {
      const delta = candidate.value - value
      const absDelta = Math.abs(delta)
      if (absDelta <= tolerance && absDelta < bestAbsDelta) {
        bestDelta = delta
        bestAbsDelta = absDelta
        bestCandidate = candidate
      }
    }
  }

  return bestAbsDelta <= tolerance
    ? {
      delta: bestDelta,
      candidate: bestCandidate,
    }
    : {
      delta: 0,
      candidate: null,
    }
}

function getObjectEdgeSnapResult(
  bounds: Rect,
  candidates: SnapCandidateEdges,
  tolerance: number
): SnapResult {
  if (tolerance <= 0) {
    return { offset: { x: 0, y: 0 }, guides: [] }
  }

  const xMatch = getBestSnapMatch(
    [bounds.minX, bounds.maxX, (bounds.minX + bounds.maxX) / 2],
    candidates.x,
    tolerance
  )
  const yMatch = getBestSnapMatch(
    [bounds.minY, bounds.maxY, (bounds.minY + bounds.maxY) / 2],
    candidates.y,
    tolerance
  )
  const guides: SmartGuideLine[] = []

  if (xMatch.candidate) {
    guides.push({
      orientation: 'vertical',
      position: xMatch.candidate.value,
      start: Math.min(bounds.minY + yMatch.delta, xMatch.candidate.minCross),
      end: Math.max(bounds.maxY + yMatch.delta, xMatch.candidate.maxCross),
      kind: 'align',
    })
  }

  if (yMatch.candidate) {
    guides.push({
      orientation: 'horizontal',
      position: yMatch.candidate.value,
      start: Math.min(bounds.minX + xMatch.delta, yMatch.candidate.minCross),
      end: Math.max(bounds.maxX + xMatch.delta, yMatch.candidate.maxCross),
      kind: 'align',
    })
  }

  return {
    offset: {
      x: xMatch.delta,
      y: yMatch.delta,
    },
    guides,
  }
}

function rangesOverlap(aMin: number, aMax: number, bMin: number, bMax: number) {
  return Math.min(aMax, bMax) >= Math.max(aMin, bMin)
}

function getHorizontalSpacingSnap(
  bounds: Rect,
  candidates: CanvasObject[],
  tolerance: number
): SnapResult {
  if (tolerance <= 0) {
    return { offset: { x: 0, y: 0 }, guides: [] }
  }

  const candidateBounds = candidates
    .map((object) => getObjectWorldAabb(object))
    .filter((entry) => rangesOverlap(entry.minY, entry.maxY, bounds.minY, bounds.maxY))
    .sort((a, b) => a.minX - b.minX)

  const width = Math.max(1, bounds.maxX - bounds.minX)
  let bestDelta = 0
  let bestAbsDelta = tolerance + 1
  let bestGuides: SmartGuideLine[] = []

  for (let leftIndex = 0; leftIndex < candidateBounds.length - 1; leftIndex += 1) {
    const left = candidateBounds[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < candidateBounds.length; rightIndex += 1) {
      const right = candidateBounds[rightIndex]
      const available = right.minX - left.maxX
      if (available < width) {
        continue
      }
      const targetMinX = left.maxX + (available - width) / 2
      const delta = targetMinX - bounds.minX
      const absDelta = Math.abs(delta)
      if (absDelta > tolerance || absDelta >= bestAbsDelta) {
        continue
      }
      const snapped = offsetRect(bounds, { x: delta, y: 0 })
      const overlapMinY = Math.max(left.minY, right.minY, snapped.minY)
      const overlapMaxY = Math.min(left.maxY, right.maxY, snapped.maxY)
      const guideY =
        overlapMaxY >= overlapMinY
          ? (overlapMinY + overlapMaxY) / 2
          : (snapped.minY + snapped.maxY) / 2
      bestDelta = delta
      bestAbsDelta = absDelta
      bestGuides = [
        {
          orientation: 'horizontal',
          position: guideY,
          start: left.maxX,
          end: snapped.minX,
          kind: 'spacing',
        },
        {
          orientation: 'horizontal',
          position: guideY,
          start: snapped.maxX,
          end: right.minX,
          kind: 'spacing',
        },
      ]
    }
  }

  return {
    offset: { x: bestDelta, y: 0 },
    guides: bestGuides,
  }
}

function getVerticalSpacingSnap(
  bounds: Rect,
  candidates: CanvasObject[],
  tolerance: number
): SnapResult {
  if (tolerance <= 0) {
    return { offset: { x: 0, y: 0 }, guides: [] }
  }

  const candidateBounds = candidates
    .map((object) => getObjectWorldAabb(object))
    .filter((entry) => rangesOverlap(entry.minX, entry.maxX, bounds.minX, bounds.maxX))
    .sort((a, b) => a.minY - b.minY)

  const height = Math.max(1, bounds.maxY - bounds.minY)
  let bestDelta = 0
  let bestAbsDelta = tolerance + 1
  let bestGuides: SmartGuideLine[] = []

  for (let topIndex = 0; topIndex < candidateBounds.length - 1; topIndex += 1) {
    const top = candidateBounds[topIndex]
    for (let bottomIndex = topIndex + 1; bottomIndex < candidateBounds.length; bottomIndex += 1) {
      const bottom = candidateBounds[bottomIndex]
      const available = bottom.minY - top.maxY
      if (available < height) {
        continue
      }
      const targetMinY = top.maxY + (available - height) / 2
      const delta = targetMinY - bounds.minY
      const absDelta = Math.abs(delta)
      if (absDelta > tolerance || absDelta >= bestAbsDelta) {
        continue
      }
      const snapped = offsetRect(bounds, { x: 0, y: delta })
      const overlapMinX = Math.max(top.minX, bottom.minX, snapped.minX)
      const overlapMaxX = Math.min(top.maxX, bottom.maxX, snapped.maxX)
      const guideX =
        overlapMaxX >= overlapMinX
          ? (overlapMinX + overlapMaxX) / 2
          : (snapped.minX + snapped.maxX) / 2
      bestDelta = delta
      bestAbsDelta = absDelta
      bestGuides = [
        {
          orientation: 'vertical',
          position: guideX,
          start: top.maxY,
          end: snapped.minY,
          kind: 'spacing',
        },
        {
          orientation: 'vertical',
          position: guideX,
          start: snapped.maxY,
          end: bottom.minY,
          kind: 'spacing',
        },
      ]
    }
  }

  return {
    offset: { x: 0, y: bestDelta },
    guides: bestGuides,
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
  hoveredAssetId?: string | null
  stylePreset?: StylePreset | null
  creationTool?: CreationToolConfig | null
  targetDisplayPortalNode?: HTMLDivElement | null
  onTargetDisplayFrameChange?: (frame: {
    width: number
    height: number
    fittedWidth: number
    fittedHeight: number
  }) => void
  onCreateObjectFromTool?: (
    tool: CreationToolConfig['type'],
    frame: Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'rotation'>
  ) => void
}

export function CanvasViewport({
  hoveredSlideId = null,
  hoveredAssetId = null,
  stylePreset = null,
  creationTool = null,
  targetDisplayPortalNode = null,
  onTargetDisplayFrameChange,
  onCreateObjectFromTool,
}: CanvasViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageReloadInputRef = useRef<HTMLInputElement>(null)
  const templatePlaceholderVideoInputRef = useRef<HTMLInputElement>(null)
  const pendingImageReloadObjectIdRef = useRef<string | null>(null)
  const pendingTemplatePlaceholderImageIdRef = useRef<string | null>(null)
  const pendingTemplatePlaceholderVideoIdRef = useRef<string | null>(null)
  const pendingTemplatePlaceholderActivationIdRef = useRef<string | null>(null)
  const pendingTemplatePlaceholderChoiceRef = useRef<{
    placeholderId: string
    choice: TemplatePlaceholderChoice
  } | null>(null)
  const pendingTextboxEditIdRef = useRef<string | null>(null)
  const panRef = useRef<PanInteraction | null>(null)
  const objectInteractionRef = useRef<ObjectInteraction | null>(null)
  const imageCropInteractionRef = useRef<ImageCropInteraction | null>(null)
  const shapeAdjustInteractionRef = useRef<ShapeAdjustInteraction | null>(null)
  const marqueeRef = useRef<MarqueeInteraction | null>(null)
  const creationInteractionRef = useRef<CreationInteraction | null>(null)
  const clipboardRef = useRef<ClipboardState | null>(null)
  const cameraRef = useRef<CameraState | null>(null)
  const lastReportedTargetDisplayFrameRef = useRef<{
    width: number
    height: number
    fittedWidth: number
    fittedHeight: number
  } | null>(null)
  const videoElementMapRef = useRef<Map<string, HTMLVideoElement>>(new Map())
  const soundElementMapRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const cameraRotationAnimationFrameRef = useRef<number | null>(null)
  const cameraResetAnimationFrameRef = useRef<number | null>(null)
  const textboxEditingCameraRotationRef = useRef<number | null>(null)
  const editingTextboxMeasuredHeightPxRef = useRef<number | null>(null)
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
  const [smartGuides, setSmartGuides] = useState<SmartGuideLine[]>([])
  const [creationPreviewRect, setCreationPreviewRect] = useState<Rect | null>(null)
  const [targetDisplayPreset, setTargetDisplayPreset] = useState<TargetDisplayPreset>('ratio-16-9')
  const [targetDisplayOrientation, setTargetDisplayOrientation] =
    useState<TargetDisplayOrientation>('landscape')
  const [isTargetDisplayOverlayEnabled, setIsTargetDisplayOverlayEnabled] = useState(true)

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
  const selectSlide = useEditorStore((state) => state.selectSlide)
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
  const setVideoData = useEditorStore((state) => state.setVideoData)
  const setSoundData = useEditorStore((state) => state.setSoundData)
  const setTextboxData = useEditorStore((state) => state.setTextboxData)
  const beginCommandBatch = useEditorStore((state) => state.beginCommandBatch)
  const commitCommandBatch = useEditorStore((state) => state.commitCommandBatch)

  function ensureLibraryAsset(asset: Asset): Asset {
    const existing = findMatchingLibraryAsset(useEditorStore.getState().document.assets, asset)
    if (existing) {
      return existing
    }
    createAsset(asset)
    return asset
  }

  useEffect(() => {
    cameraRef.current = camera
  }, [camera])

  useEffect(() => {
    return () => {
      if (cameraRotationAnimationFrameRef.current !== null) {
        cancelAnimationFrame(cameraRotationAnimationFrameRef.current)
        cameraRotationAnimationFrameRef.current = null
      }
      if (cameraResetAnimationFrameRef.current !== null) {
        cancelAnimationFrame(cameraResetAnimationFrameRef.current)
        cameraResetAnimationFrameRef.current = null
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
  const hoveredAsset = hoveredAssetId ? assetById.get(hoveredAssetId) ?? null : null
  const availableTextboxFonts = useMemo(() => collectAvailableTextboxFonts(assets), [assets])
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
  const selectedShapeAdjustmentHandle =
    selectedObject && (selectedObject.type === 'shape_rect' || selectedObject.type === 'shape_circle')
      ? getShapeAdjustmentHandle(
        selectedObject.type,
        selectedObject.shapeData,
        selectedObject.w,
        selectedObject.h
      )
      : null
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
      source.type === 'shape_rect' || source.type === 'shape_circle'
        ? source.shapeData
        : null
    const sourceTextbox = source.type === 'textbox' ? source.textboxData : null
    const sourceImage = source.type === 'image' ? source.imageData : null
    const sourceVideo = source.type === 'video' ? source.videoData : null
    const sourceSound = source.type === 'sound' ? source.soundData : null

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
          radius: sourceTextbox.radius,
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
          : sourceVideo
            ? {
              borderColor: sourceVideo.borderColor,
              borderType: sourceVideo.borderType,
              borderWidth: sourceVideo.borderWidth,
              opacityPercent: sourceVideo.opacityPercent,
              radius: sourceVideo.radius,
              shadowColor: sourceVideo.shadowColor,
              shadowBlurPx: sourceVideo.shadowBlurPx,
              shadowAngleDeg: sourceVideo.shadowAngleDeg,
            }
            : sourceSound
              ? {
                borderColor: sourceSound.borderColor,
                borderType: sourceSound.borderType,
                borderWidth: sourceSound.borderWidth,
                opacityPercent: sourceSound.opacityPercent,
                radius: sourceSound.radius,
                shadowColor: sourceSound.shadowColor,
                shadowBlurPx: sourceSound.shadowBlurPx,
                shadowAngleDeg: sourceSound.shadowAngleDeg,
              }
              : null

    if (!common) {
      return
    }

    if (target.type === 'shape_rect' || target.type === 'shape_circle') {
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
        radius: common.radius,
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
      return
    }

    if (target.type === 'video') {
      setVideoData(target.id, {
        ...target.videoData,
        borderColor: common.borderColor,
        borderType: common.borderType,
        borderWidth: common.borderWidth,
        opacityPercent: common.opacityPercent,
        radius: common.radius,
        shadowColor: common.shadowColor,
        shadowBlurPx: common.shadowBlurPx,
        shadowAngleDeg: common.shadowAngleDeg,
      })
      return
    }

    if (target.type === 'sound') {
      setSoundData(target.id, {
        ...target.soundData,
        borderColor: common.borderColor,
        borderType: common.borderType,
        borderWidth: common.borderWidth,
        opacityPercent: common.opacityPercent,
        radius: common.radius,
        shadowColor: common.shadowColor,
        shadowBlurPx: common.shadowBlurPx,
        shadowAngleDeg: common.shadowAngleDeg,
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
  const selectedAlignmentUnits = useMemo<AlignmentSelectionUnit[]>(
    () =>
      selectedUnlockedObjects.map((object) => ({
        id: object.id,
        bounds: getObjectWorldAabb(object),
        targets:
          activeGroupId === null && object.type === 'group'
            ? collectGroupTransformTargets(object, objectById)
            : [object],
      })),
    [activeGroupId, objectById, selectedUnlockedObjects]
  )
  const selectedUnlockedIds = useMemo(
    () => selectedUnlockedObjects.map((object) => object.id),
    [selectedUnlockedObjects]
  )
  const selectedUnlockedIdsKey = useMemo(
    () => getSelectionKey(selectedUnlockedIds),
    [selectedUnlockedIds]
  )
  const canAlignSelectedObjects = selectedAlignmentUnits.length > 1
  const canDistributeSelectedObjects = selectedAlignmentUnits.length > 2
  const activeCropObjectId =
    selectedObject?.type === 'image' && selectedObject.imageData.cropEnabled ? selectedObject.id : null

  function disableActiveCropMode() {
    if (!activeCropObjectId) {
      return false
    }
    const cropObject = objectById.get(activeCropObjectId)
    if (!cropObject || cropObject.type !== 'image' || !cropObject.imageData.cropEnabled) {
      return false
    }
    setImageData(cropObject.id, {
      ...cropObject.imageData,
      cropEnabled: false,
    })
    return true
  }

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
      editingTextboxMeasuredHeightPxRef.current = null
      setEditingTextboxId(null)
      setEditingTextboxHtml('')
      setEditingTextboxPlainText('')
    }
  }, [animateCameraRotationTo, editingTextboxId, editingTextboxObject])

  useEffect(() => {
    if (creationTool) {
      return
    }
    creationInteractionRef.current = null
    setCreationPreviewRect(null)
  }, [creationTool])

  const gridStep = useMemo(
    () => getDynamicGridStep(canvasSettings.baseGridSize, camera.zoom),
    [canvasSettings.baseGridSize, camera.zoom]
  )
  const minorGridStep = gridStep / 10
  const worldBounds = useMemo(
    () => getViewWorldBounds(camera, viewportSize),
    [camera, viewportSize]
  )
  const targetDisplayLogicalFrame = useMemo(() => {
    const preset = TARGET_DISPLAY_PRESETS.find((entry) => entry.value === targetDisplayPreset)
    const baseWidth = preset?.width ?? viewportSize.width
    const baseHeight = preset?.height ?? viewportSize.height
    const ratioWidth = targetDisplayOrientation === 'landscape' ? Math.max(baseWidth, baseHeight) : Math.min(baseWidth, baseHeight)
    const ratioHeight = targetDisplayOrientation === 'landscape' ? Math.min(baseWidth, baseHeight) : Math.max(baseWidth, baseHeight)

    return {
      width: Math.max(1, ratioWidth),
      height: Math.max(1, ratioHeight),
      aspectRatioLabel: formatAspectRatio(ratioWidth, ratioHeight),
    }
  }, [targetDisplayOrientation, targetDisplayPreset, viewportSize.height, viewportSize.width])

  const targetDisplayFrame = useMemo(() => {
    const availableWidth = Math.max(
      1,
      viewportSize.width - TARGET_DISPLAY_MIN_BORDER_SEPARATION_PX * 2
    )
    const availableHeight = Math.max(
      1,
      viewportSize.height - TARGET_DISPLAY_MIN_BORDER_SEPARATION_PX * 2
    )
    const scale = Math.min(
      availableWidth / targetDisplayLogicalFrame.width,
      availableHeight / targetDisplayLogicalFrame.height
    )
    const width = Math.max(1, targetDisplayLogicalFrame.width * scale)
    const height = Math.max(1, targetDisplayLogicalFrame.height * scale)

    return {
      left: (viewportSize.width - width) / 2,
      top: (viewportSize.height - height) / 2,
      width,
      height,
      aspectRatioLabel: targetDisplayLogicalFrame.aspectRatioLabel,
      isConstrained: true,
    }
  }, [targetDisplayLogicalFrame, viewportSize.height, viewportSize.width])

  const targetDisplayOriginMarker = useMemo(() => {
    const frameViewport = {
      width: targetDisplayFrame.width,
      height: targetDisplayFrame.height,
    }
    const withinFrame = worldToScreen({ x: 0, y: 0 }, camera, frameViewport)
    const markerRadiusPx = 4
    const clampedX = clamp(withinFrame.x, markerRadiusPx, targetDisplayFrame.width - markerRadiusPx)
    const clampedY = clamp(withinFrame.y, markerRadiusPx, targetDisplayFrame.height - markerRadiusPx)
    const isClamped = clampedX !== withinFrame.x || clampedY !== withinFrame.y
    return {
      x: targetDisplayFrame.left + clampedX,
      y: targetDisplayFrame.top + clampedY,
      isClamped,
    }
  }, [camera, targetDisplayFrame])

  useEffect(() => {
    const nextFrame = {
      width: targetDisplayLogicalFrame.width,
      height: targetDisplayLogicalFrame.height,
      fittedWidth: targetDisplayFrame.width,
      fittedHeight: targetDisplayFrame.height,
    }
    const previousFrame = lastReportedTargetDisplayFrameRef.current
    if (
      previousFrame &&
      previousFrame.width === nextFrame.width &&
      previousFrame.height === nextFrame.height &&
      previousFrame.fittedWidth === nextFrame.fittedWidth &&
      previousFrame.fittedHeight === nextFrame.fittedHeight
    ) {
      return
    }
    lastReportedTargetDisplayFrameRef.current = nextFrame
    onTargetDisplayFrameChange?.(nextFrame)
  }, [
    onTargetDisplayFrameChange,
    targetDisplayFrame.height,
    targetDisplayFrame.width,
    targetDisplayLogicalFrame.height,
    targetDisplayLogicalFrame.width,
  ])

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
    const frameViewport = {
      width: targetDisplayFrame.width,
      height: targetDisplayFrame.height,
    }
    const frameOffset = {
      x: targetDisplayFrame.left,
      y: targetDisplayFrame.top,
    }

    const worldToTargetFrameScreen = (world: Point) => {
      const withinFrame = worldToScreen(world, camera, frameViewport)
      return {
        x: frameOffset.x + withinFrame.x,
        y: frameOffset.y + withinFrame.y,
      }
    }

    return orderedSlides.map((slide) => {
      const safeSlideZoom = Math.max(
        0.0001,
        zoomFromDiagonal(
          Math.max(0.0001, slide.diagonal),
          targetDisplayLogicalFrame.width,
          targetDisplayLogicalFrame.height
        )
      )
      const frameWorldWidth = targetDisplayLogicalFrame.width / safeSlideZoom
      const frameWorldHeight = targetDisplayLogicalFrame.height / safeSlideZoom
      const centerScreen = worldToTargetFrameScreen({ x: slide.x, y: slide.y })
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
      const topLeftScreen = worldToTargetFrameScreen(topLeftWorld)

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
  }, [camera, hoveredSlideId, orderedSlides, selectedSlideId, targetDisplayFrame, targetDisplayLogicalFrame])

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

      if ((event.ctrlKey || event.metaKey) && selectedUnlockedObjects.length > 0) {
        const scaleSensitivity = event.altKey ? 0.00015 : 0.0015
        const scaleFactor = Math.exp(-event.deltaY * scaleSensitivity)
        if (!Number.isFinite(scaleFactor) || Math.abs(scaleFactor - 1) < 0.000001) {
          return
        }

        const selectedGroup =
          activeGroupId === null &&
            selectedUnlockedObjects.length === 1 &&
            selectedUnlockedObjects[0]?.type === 'group'
            ? selectedUnlockedObjects[0]
            : null

        if (selectedGroup) {
          const transformTargets = collectGroupTransformTargets(selectedGroup, objectById)
          beginCommandBatch('Scale group')
          transformTargets.forEach((target) => {
            moveObject(target.id, {
              x: selectedGroup.x + (target.x - selectedGroup.x) * scaleFactor,
              y: selectedGroup.y + (target.y - selectedGroup.y) * scaleFactor,
              w: Math.max(1, target.w * scaleFactor),
              h: Math.max(1, target.h * scaleFactor),
              rotation: target.rotation,
              scalePercent: Math.max(1, Math.min(10000, Math.round(target.scalePercent * scaleFactor))),
            })
          })
          commitCommandBatch()
          return
        }

        const selectionBounds = getObjectsWorldAabb(selectedUnlockedObjects)
        const selectionCenter = selectionBounds
          ? {
            x: (selectionBounds.minX + selectionBounds.maxX) / 2,
            y: (selectionBounds.minY + selectionBounds.maxY) / 2,
          }
          : {
            x: selectedUnlockedObjects[0]!.x,
            y: selectedUnlockedObjects[0]!.y,
          }

        beginCommandBatch(
          selectedUnlockedObjects.length > 1 ? 'Scale selected objects' : 'Scale selected object'
        )
        selectedUnlockedObjects.forEach((target) => {
          moveObject(target.id, {
            x: selectionCenter.x + (target.x - selectionCenter.x) * scaleFactor,
            y: selectionCenter.y + (target.y - selectionCenter.y) * scaleFactor,
            w: Math.max(1, target.w * scaleFactor),
            h: Math.max(1, target.h * scaleFactor),
            rotation: target.rotation,
            scalePercent: Math.max(1, Math.min(10000, Math.round(target.scalePercent * scaleFactor))),
          })
        })
        commitCommandBatch()
        return
      }

      if (event.shiftKey && selectedUnlockedObjects.length > 0) {
        const wheelDirection = event.deltaY > 0 ? 1 : event.deltaY < 0 ? -1 : 0
        const rotationStepDeg = event.altKey ? 1 : 10
        const rotationDelta = wheelDirection * ((rotationStepDeg * Math.PI) / 180)
        if (Math.abs(rotationDelta) < 0.000001) {
          return
        }

        const selectedGroup =
          activeGroupId === null &&
            selectedUnlockedObjects.length === 1 &&
            selectedUnlockedObjects[0]?.type === 'group'
            ? selectedUnlockedObjects[0]
            : null

        if (selectedGroup) {
          const transformTargets = collectGroupTransformTargets(selectedGroup, objectById)
          beginCommandBatch('Rotate group')
          transformTargets.forEach((target) => {
            const rotatedOffset = rotatePoint(
              {
                x: target.x - selectedGroup.x,
                y: target.y - selectedGroup.y,
              },
              rotationDelta
            )
            moveObject(target.id, {
              x: selectedGroup.x + rotatedOffset.x,
              y: selectedGroup.y + rotatedOffset.y,
              w: target.w,
              h: target.h,
              rotation: normalizeRotationRadians(target.rotation + rotationDelta),
            })
          })
          commitCommandBatch()
          return
        }

        const selectionBounds = getObjectsWorldAabb(selectedUnlockedObjects)
        const selectionCenter = selectionBounds
          ? {
            x: (selectionBounds.minX + selectionBounds.maxX) / 2,
            y: (selectionBounds.minY + selectionBounds.maxY) / 2,
          }
          : {
            x: selectedUnlockedObjects[0]!.x,
            y: selectedUnlockedObjects[0]!.y,
          }

        beginCommandBatch(
          selectedUnlockedObjects.length > 1 ? 'Rotate selected objects' : 'Rotate selected object'
        )
        selectedUnlockedObjects.forEach((target) => {
          const rotatedOffset = rotatePoint(
            {
              x: target.x - selectionCenter.x,
              y: target.y - selectionCenter.y,
            },
            rotationDelta
          )
          moveObject(target.id, {
            x: selectionCenter.x + rotatedOffset.x,
            y: selectionCenter.y + rotatedOffset.y,
            w: target.w,
            h: target.h,
            rotation: normalizeRotationRadians(target.rotation + rotationDelta),
          })
        })
        commitCommandBatch()
        return
      }

      if (event.altKey) {
        const wheelDirection = event.deltaY > 0 ? 1 : event.deltaY < 0 ? -1 : 0
        const rotationDelta = wheelDirection * ((10 * Math.PI) / 180)
        if (Math.abs(rotationDelta) < 0.000001) {
          return
        }
        const rotatedCamera = {
          ...camera,
          rotation: normalizeRotationRadians(camera.rotation + rotationDelta),
        }
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
  }, [
    activeGroupId,
    beginCommandBatch,
    camera,
    commitCommandBatch,
    moveObject,
    objectById,
    selectedUnlockedObjects,
    setCamera,
    viewportSize,
  ])

  const contextSelectionIds = contextMenu?.selectionIds ?? selectedObjectIds
  const contextSelectionObjects = useMemo(() => {
    const selectedSet = new Set(contextSelectionIds)
    return editableObjects.filter((object) => selectedSet.has(object.id))
  }, [contextSelectionIds, editableObjects])
  const contextUnlockedObjects = useMemo(
    () => contextSelectionObjects.filter((object) => !isObjectEffectivelyLocked(object, objectById)),
    [contextSelectionObjects, objectById]
  )
  const contextUnlockedIds = useMemo(
    () => contextUnlockedObjects.map((object) => object.id),
    [contextUnlockedObjects]
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

  function getAlignmentActionLabel(action: AlignmentAction) {
    switch (action) {
      case 'left':
        return 'Align left'
      case 'right':
        return 'Align right'
      case 'top':
        return 'Align top'
      case 'bottom':
        return 'Align bottom'
      case 'center-horizontal':
        return 'Align horizontal centers'
      case 'center-vertical':
        return 'Align vertical centers'
      case 'center':
        return 'Align center'
      case 'distribute-horizontal':
        return 'Distribute horizontally'
      case 'distribute-vertical':
        return 'Distribute vertically'
    }
  }

  function applyAlignment(action: AlignmentAction) {
    if (selectedAlignmentUnits.length < 2) {
      return
    }

    const deltas = getAlignmentDeltas(
      selectedAlignmentUnits.map((unit) => ({
        id: unit.id,
        bounds: unit.bounds,
      })),
      action
    ).filter((delta) => Math.abs(delta.x) > 0.0001 || Math.abs(delta.y) > 0.0001)

    if (deltas.length === 0) {
      return
    }

    const deltaById = new Map(deltas.map((delta) => [delta.id, delta]))
    beginCommandBatch(getAlignmentActionLabel(action))
    selectedAlignmentUnits.forEach((unit) => {
      const delta = deltaById.get(unit.id)
      if (!delta) {
        return
      }
      unit.targets.forEach((target) => {
        moveObject(target.id, {
          x: target.x + delta.x,
          y: target.y + delta.y,
          w: target.w,
          h: target.h,
          rotation: target.rotation,
        })
      })
    })
    commitCommandBatch()
    setMultiSelectionFrame(null)
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

  function animateCameraResetTo(nextTarget: Partial<CameraState>) {
    const startCamera = cameraRef.current ?? camera
    const targetCamera: CameraState = {
      x: nextTarget.x ?? startCamera.x,
      y: nextTarget.y ?? startCamera.y,
      zoom: nextTarget.zoom ?? startCamera.zoom,
      rotation: nextTarget.rotation ?? startCamera.rotation,
    }
    const rotationDelta = getShortestAngleDelta(startCamera.rotation, targetCamera.rotation)

    if (
      Math.abs(targetCamera.x - startCamera.x) < 0.0001 &&
      Math.abs(targetCamera.y - startCamera.y) < 0.0001 &&
      Math.abs(targetCamera.zoom - startCamera.zoom) < 0.0001 &&
      Math.abs(rotationDelta) < 0.0001
    ) {
      return
    }

    if (cameraResetAnimationFrameRef.current !== null) {
      cancelAnimationFrame(cameraResetAnimationFrameRef.current)
      cameraResetAnimationFrameRef.current = null
    }

    const startedAtMs = performance.now()
    const tick = (nowMs: number) => {
      const elapsed = nowMs - startedAtMs
      const progress = Math.min(1, Math.max(0, elapsed / CAMERA_RESET_TRANSITION_MS))
      const eased = easeInOutCubic(progress)
      setCamera({
        x: startCamera.x + (targetCamera.x - startCamera.x) * eased,
        y: startCamera.y + (targetCamera.y - startCamera.y) * eased,
        zoom: startCamera.zoom + (targetCamera.zoom - startCamera.zoom) * eased,
        rotation: startCamera.rotation + rotationDelta * eased,
      })
      if (progress < 1) {
        cameraResetAnimationFrameRef.current = requestAnimationFrame(tick)
        return
      }
      cameraResetAnimationFrameRef.current = null
      setCamera(targetCamera)
    }

    cameraResetAnimationFrameRef.current = requestAnimationFrame(tick)
  }

  function startTextboxEditing(target: Extract<CanvasObject, { type: 'textbox' }>) {
    if (textboxEditingCameraRotationRef.current === null) {
      textboxEditingCameraRotationRef.current = camera.rotation
    }

    editingTextboxMeasuredHeightPxRef.current = null
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

    const contentScale = resolveTextboxObjectScale(target.textboxData, target.scalePercent)
    let desiredHeightWorld: number
    if (Number.isFinite(measuredHeightPx) && measuredHeightPx && measuredHeightPx > 0) {
      desiredHeightWorld = Math.max(1, measuredHeightPx * contentScale)
    } else {
      const firstRun = target.textboxData.runs[0] ?? createDefaultTextRun('')
      const lines = Math.max(1, nextText.split('\n').length)
      const lineHeightPx = Math.max(12, firstRun.fontSize * TEXTBOX_LINE_HEIGHT * contentScale)
      const verticalPaddingPx = 14
      desiredHeightWorld = Math.max(1, lines * lineHeightPx + verticalPaddingPx)
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
      editingTextboxMeasuredHeightPxRef.current = null
      return
    }

    if (commit) {
      const baseRun = normalizeTextboxRuns(editingTextboxObject.textboxData.runs)[0] ?? createDefaultTextRun('')
      const nextTextboxData = {
        ...editingTextboxObject.textboxData,
        richTextHtml: editingTextboxHtml,
        runs: [{ ...baseRun, text: editingTextboxPlainText }],
      }
      applyTextboxAutoHeight(
        editingTextboxObject,
        editingTextboxPlainText,
        editingTextboxMeasuredHeightPxRef.current ?? undefined
      )
      setTextboxData(editingTextboxObject.id, nextTextboxData)
    }

    if (textboxEditingCameraRotationRef.current !== null) {
      animateCameraRotationTo(textboxEditingCameraRotationRef.current)
      textboxEditingCameraRotationRef.current = null
    }

    setEditingTextboxId(null)
    setEditingTextboxHtml('')
    setEditingTextboxPlainText('')
    editingTextboxMeasuredHeightPxRef.current = null
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

  function createTextboxFromTemplatePlaceholder(
    placeholder: Extract<CanvasObject, { type: 'template_placeholder' }>,
    listType: 'none' | 'bullet'
  ): Extract<CanvasObject, { type: 'textbox' }>['textboxData'] {
    const textStyleRole = stylePreset?.textStyles.find((entry) => entry.id === 'text') ?? null
    const textColor = textStyleRole?.color ?? stylePreset?.textColor ?? '#f0f3fc'
    const fontFamily = textStyleRole?.fontFamily ?? stylePreset?.fontFamily ?? 'Arial'
    const fontSize = textStyleRole?.fontSize ?? 28
    const isBulletList = listType === 'bullet'
    const text = isBulletList ? 'List item' : placeholder.templatePlaceholderData.prompt
    const richTextHtml = isBulletList
      ? `<ul><li><span style="color: ${textColor}; font-size: ${fontSize}px; font-family: ${fontFamily};">List item</span></li></ul>`
      : `<p><span style="color: ${textColor}; font-size: ${fontSize}px; font-family: ${fontFamily};">${placeholder.templatePlaceholderData.prompt}</span></p>`

    return {
      runs: [
        {
          ...createDefaultTextRun(text),
          color: textColor,
          fontSize,
        },
      ],
      richTextHtml,
      fontFamily,
      alignment: isBulletList ? 'left' : 'center',
      verticalAlignment: 'top',
      listType,
      autoHeight: true,
      fillMode: 'solid',
      backgroundColor: stylePreset?.textboxBackground ?? DEFAULT_TEXTBOX_BACKGROUND,
      fillGradient: null,
      borderColor: stylePreset?.textboxBorder ?? DEFAULT_TEXTBOX_BORDER_COLOR,
      borderType: 'solid',
      borderWidth: DEFAULT_TEXTBOX_BORDER_WIDTH,
      radius: 0,
      opacityPercent: 100,
      shadowColor: '#000000',
      shadowBlurPx: 0,
      shadowAngleDeg: 45,
    }
  }

  function replaceTemplatePlaceholderWithTextbox(
    placeholder: Extract<CanvasObject, { type: 'template_placeholder' }>,
    listType: 'none' | 'bullet'
  ) {
    beginCommandBatch(listType === 'bullet' ? 'Create list from placeholder' : 'Create text from placeholder')
    deleteObjects([placeholder.id])
    createObject({
      id: placeholder.id,
      type: 'textbox',
      x: placeholder.x,
      y: placeholder.y,
      w: placeholder.w,
      h: placeholder.h,
      rotation: placeholder.rotation,
      scalePercent: placeholder.scalePercent,
      keepAspectRatio: placeholder.keepAspectRatio,
      locked: placeholder.locked,
      zIndex: placeholder.zIndex,
      parentGroupId: placeholder.parentGroupId,
      textboxData: createTextboxFromTemplatePlaceholder(placeholder, listType),
    })
    commitCommandBatch()
    selectObjects([placeholder.id])
    pendingTextboxEditIdRef.current = placeholder.id
  }

  function activateTemplatePlaceholder(placeholderId: string, forcedChoice?: TemplatePlaceholderChoice) {
    const placeholder = objectById.get(placeholderId)
    if (!placeholder || placeholder.type !== 'template_placeholder') {
      return
    }
    if (isObjectEffectivelyLocked(placeholder, objectById)) {
      selectObjects([placeholder.id])
      return
    }

    const choice: TemplatePlaceholderChoice | null =
      forcedChoice ??
      (placeholder.templatePlaceholderData.kind === 'list'
        ? 'list'
        : placeholder.templatePlaceholderData.kind === 'image'
          ? 'image'
          : placeholder.templatePlaceholderData.kind === 'universal'
            ? null
            : 'text')

    if (choice === null) {
      selectObjects([placeholder.id])
      return
    }

    if (choice === 'image') {
      pendingTemplatePlaceholderImageIdRef.current = placeholder.id
      imageReloadInputRef.current?.click()
      return
    }
    if (choice === 'video') {
      pendingTemplatePlaceholderVideoIdRef.current = placeholder.id
      templatePlaceholderVideoInputRef.current?.click()
      return
    }
    replaceTemplatePlaceholderWithTextbox(placeholder, choice === 'list' ? 'bullet' : 'none')
  }

  function handleTemplatePlaceholderChoice(
    placeholder: Extract<CanvasObject, { type: 'template_placeholder' }>,
    choice: TemplatePlaceholderChoice
  ) {
    if (isObjectEffectivelyLocked(placeholder, objectById)) {
      selectObjects([placeholder.id])
      return
    }
    if (!editableObjectIds.has(placeholder.id)) {
      if (activeGroupId === null && placeholder.parentGroupId) {
        pendingTemplatePlaceholderActivationIdRef.current = null
        pendingTemplatePlaceholderChoiceRef.current = {
          placeholderId: placeholder.id,
          choice,
        }
        enterGroup(placeholder.parentGroupId)
      }
      return
    }
    activateTemplatePlaceholder(placeholder.id, choice)
  }

  function fitMediaToPlaceholderFrame(
    placeholder: Pick<CanvasObject, 'w' | 'h'>,
    intrinsicWidth: number,
    intrinsicHeight: number
  ) {
    const placeholderWidth = Math.max(1, placeholder.w)
    const placeholderHeight = Math.max(1, placeholder.h)
    const mediaWidth = Math.max(1, intrinsicWidth)
    const mediaHeight = Math.max(1, intrinsicHeight)
    const placeholderAspect = placeholderWidth / placeholderHeight
    const mediaAspect = mediaWidth / mediaHeight

    if (mediaAspect > placeholderAspect) {
      return {
        w: placeholderWidth,
        h: Math.max(1, placeholderWidth / mediaAspect),
      }
    }

    return {
      w: Math.max(1, placeholderHeight * mediaAspect),
      h: placeholderHeight,
    }
  }

  function replaceTemplatePlaceholderWithMedia(
    placeholder: Extract<CanvasObject, { type: 'template_placeholder' }>,
    options: {
      kind: 'image' | 'video'
      assetId: string
      intrinsicWidth: number
      intrinsicHeight: number
    }
  ) {
    const fitted = fitMediaToPlaceholderFrame(
      placeholder,
      options.intrinsicWidth,
      options.intrinsicHeight
    )

    beginCommandBatch(options.kind === 'image' ? 'Fill image placeholder' : 'Fill video placeholder')
    deleteObjects([placeholder.id])
    if (options.kind === 'image') {
      createObject({
        id: placeholder.id,
        type: 'image',
        x: placeholder.x,
        y: placeholder.y,
        w: fitted.w,
        h: fitted.h,
        rotation: placeholder.rotation,
        scalePercent: placeholder.scalePercent,
        keepAspectRatio: true,
        locked: placeholder.locked,
        zIndex: placeholder.zIndex,
        parentGroupId: placeholder.parentGroupId,
        imageData: {
          ...createDefaultImageData(
            options.assetId,
            Math.max(1, options.intrinsicWidth),
            Math.max(1, options.intrinsicHeight),
            stylePreset?.assetStyle.imageBorder ?? stylePreset?.imageBorder
          ),
        },
      })
    } else {
      createObject({
        id: placeholder.id,
        type: 'video',
        x: placeholder.x,
        y: placeholder.y,
        w: fitted.w,
        h: fitted.h,
        rotation: placeholder.rotation,
        scalePercent: placeholder.scalePercent,
        keepAspectRatio: true,
        locked: placeholder.locked,
        zIndex: placeholder.zIndex,
        parentGroupId: placeholder.parentGroupId,
        videoData: createDefaultVideoData(
          options.assetId,
          Math.max(1, options.intrinsicWidth),
          Math.max(1, options.intrinsicHeight),
          stylePreset?.assetStyle.videoBorder ?? stylePreset?.imageBorder
        ),
      })
    }
    commitCommandBatch()
    selectObjects([placeholder.id])
  }

  function createDroppedMediaFromAsset(
    kind: 'image' | 'video' | 'sound',
    assetId: string,
    intrinsicWidth: number,
    intrinsicHeight: number,
    world: Point
  ) {
    const objectId = createId()
    const frame = getDefaultPlacedMediaSize(kind, intrinsicWidth, intrinsicHeight, camera.zoom)
    if (kind === 'sound') {
      createObject({
        id: objectId,
        type: 'sound',
        x: world.x,
        y: world.y,
        w: frame.w,
        h: frame.h,
        rotation: -camera.rotation,
        scalePercent: getZoomAdjustedObjectScalePercent(camera.zoom),
        keepAspectRatio: false,
        locked: false,
        zIndex: objects.reduce((max, object) => Math.max(max, object.zIndex), 0) + 1,
        parentGroupId: activeGroupId,
        soundData: createDefaultSoundData(
          assetId,
          stylePreset?.assetStyle.audioBorder ?? stylePreset?.imageBorder,
          frame.h / 2
        ),
      })
    } else if (kind === 'video') {
      createObject({
        id: objectId,
        type: 'video',
        x: world.x,
        y: world.y,
        w: frame.w,
        h: frame.h,
        rotation: -camera.rotation,
        scalePercent: getZoomAdjustedObjectScalePercent(camera.zoom),
        keepAspectRatio: true,
        locked: false,
        zIndex: objects.reduce((max, object) => Math.max(max, object.zIndex), 0) + 1,
        parentGroupId: activeGroupId,
        videoData: createDefaultVideoData(
          assetId,
          intrinsicWidth,
          intrinsicHeight,
          stylePreset?.assetStyle.videoBorder ?? stylePreset?.imageBorder
        ),
      })
    } else {
      createObject({
        id: objectId,
        type: 'image',
        x: world.x,
        y: world.y,
        w: frame.w,
        h: frame.h,
        rotation: -camera.rotation,
        scalePercent: getZoomAdjustedObjectScalePercent(camera.zoom),
        keepAspectRatio: true,
        locked: false,
        zIndex: objects.reduce((max, object) => Math.max(max, object.zIndex), 0) + 1,
        parentGroupId: activeGroupId,
        imageData: {
          ...createDefaultImageData(
            assetId,
            intrinsicWidth,
            intrinsicHeight,
            stylePreset?.assetStyle.imageBorder ?? stylePreset?.imageBorder
          ),
        },
      })
    }
    selectObjects([objectId])
  }

  function getDropTargetImageObject(target: EventTarget | null) {
    const element = target instanceof Element ? target : null
    const objectElement = element?.closest<HTMLElement>('.canvas-object[data-object-id]')
    const objectId = objectElement?.dataset.objectId
    if (!objectId) {
      return null
    }
    const object = objectById.get(objectId)
    if (!object || object.type !== 'image') {
      return null
    }
    if (isObjectEffectivelyLocked(object, objectById)) {
      return null
    }
    return object
  }

  function getDropTargetTemplatePlaceholderObject(target: EventTarget | null) {
    const element = target instanceof Element ? target : null
    const objectElement = element?.closest<HTMLElement>('.canvas-object[data-object-id]')
    const objectId = objectElement?.dataset.objectId
    if (!objectId) {
      return null
    }
    const object = objectById.get(objectId)
    if (!object || object.type !== 'template_placeholder') {
      return null
    }
    if (isObjectEffectivelyLocked(object, objectById)) {
      return null
    }
    return object
  }

  async function handleViewportDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    closeContextMenu()

    const assetPayloadRaw = event.dataTransfer.getData(ASSET_LIBRARY_DRAG_MIME)
    if (assetPayloadRaw) {
      try {
        const assetPayload = JSON.parse(assetPayloadRaw) as AssetLibraryDragPayload
        const asset = assetById.get(assetPayload.assetId)
        if (asset) {
          const dropTargetPlaceholder =
            (assetPayload.kind === 'image' ||
              assetPayload.kind === 'video') &&
            getDropTargetTemplatePlaceholderObject(event.target)
          if (dropTargetPlaceholder) {
            const mediaKind = assetPayload.kind === 'video' ? 'video' : 'image'
            const intrinsicWidth = Math.max(
              1,
              assetPayload.intrinsicWidth,
              asset.intrinsicWidth ?? (mediaKind === 'video' ? 1280 : 1200)
            )
            const intrinsicHeight = Math.max(
              1,
              assetPayload.intrinsicHeight,
              asset.intrinsicHeight ?? (mediaKind === 'video' ? 720 : 800)
            )
            replaceTemplatePlaceholderWithMedia(dropTargetPlaceholder, {
              kind: mediaKind,
              assetId: asset.id,
              intrinsicWidth,
              intrinsicHeight,
            })
            return
          }
          const dropTargetImage =
            assetPayload.kind === 'image' &&
            getDropTargetImageObject(event.target)
          if (dropTargetImage) {
            setImageData(dropTargetImage.id, {
              ...dropTargetImage.imageData,
              assetId: asset.id,
              intrinsicWidth: Math.max(1, assetPayload.intrinsicWidth),
              intrinsicHeight: Math.max(1, assetPayload.intrinsicHeight),
            })
            selectObjects([dropTargetImage.id])
            return
          }
          const pointer = getViewportRelativePoint(event.clientX, event.clientY)
          const world = screenToWorld(pointer, camera, viewportSize)
          createDroppedMediaFromAsset(
            assetPayload.kind === 'video'
              ? 'video'
              : assetPayload.kind === 'audio'
                ? 'sound'
                : 'image',
            asset.id,
            assetPayload.intrinsicWidth,
            assetPayload.intrinsicHeight,
            world
          )
          return
        }
      } catch {
        // Ignore malformed drag data and continue with file import fallback.
      }
    }

    const files = Array.from(event.dataTransfer.files ?? []).filter(isSupportedLibraryAssetFile)
    if (files.length === 0) {
      return
    }

    const dropTargetPlaceholder = getDropTargetTemplatePlaceholderObject(event.target)
    if (dropTargetPlaceholder) {
      const mediaFile = files.find((file) => {
        const kind = resolveLibraryAssetKind({ mimeType: file.type, name: file.name })
        return kind === 'image' || kind === 'video'
      })
      if (mediaFile) {
        try {
          const asset = ensureLibraryAsset(await buildLibraryAsset(mediaFile, createId()))
          const mediaKind =
            resolveLibraryAssetKind({ mimeType: mediaFile.type, name: mediaFile.name }) === 'video'
              ? 'video'
              : 'image'
          replaceTemplatePlaceholderWithMedia(dropTargetPlaceholder, {
            kind: mediaKind,
            assetId: asset.id,
            intrinsicWidth: Math.max(1, asset.intrinsicWidth ?? (mediaKind === 'video' ? 1280 : 1200)),
            intrinsicHeight: Math.max(1, asset.intrinsicHeight ?? (mediaKind === 'video' ? 720 : 800)),
          })
          return
        } catch {
          window.alert('Failed to import dropped media file.')
          return
        }
      }
    }

    const pointer = getViewportRelativePoint(event.clientX, event.clientY)
    const world = screenToWorld(pointer, camera, viewportSize)
    const zIndexStart = objects.reduce((max, object) => Math.max(max, object.zIndex), 0) + 1
    const createdIds: string[] = []

    beginCommandBatch(files.length === 1 ? 'Import asset' : 'Import assets')
    try {
      for (const [index, file] of files.entries()) {
        const assetKind = resolveLibraryAssetKind({ mimeType: file.type, name: file.name })
        if (assetKind !== 'image' && assetKind !== 'video' && assetKind !== 'audio') {
          continue
        }
        const asset = ensureLibraryAsset(await buildLibraryAsset(file, createId()))
        const objectId = createId()
        if (assetKind === 'audio') {
          const frame = getDefaultPlacedMediaSize('sound', 1, 1, camera.zoom)
          createObject({
            id: objectId,
            type: 'sound',
            x: world.x + index * 20,
            y: world.y + index * 20,
            w: frame.w,
            h: frame.h,
            rotation: -camera.rotation,
            scalePercent: getZoomAdjustedObjectScalePercent(camera.zoom),
            keepAspectRatio: false,
            locked: false,
            zIndex: zIndexStart + index,
            parentGroupId: activeGroupId,
            soundData: createDefaultSoundData(
              asset.id,
              stylePreset?.assetStyle.audioBorder ?? stylePreset?.imageBorder,
              frame.h / 2
            ),
          })
        } else if (assetKind === 'video') {
          const intrinsicWidth = Math.max(1, asset.intrinsicWidth ?? 1280)
          const intrinsicHeight = Math.max(1, asset.intrinsicHeight ?? 720)
          const frame = getDefaultPlacedMediaSize('video', intrinsicWidth, intrinsicHeight, camera.zoom)
          createObject({
            id: objectId,
            type: 'video',
            x: world.x + index * 20,
            y: world.y + index * 20,
            w: frame.w,
            h: frame.h,
            rotation: -camera.rotation,
            scalePercent: getZoomAdjustedObjectScalePercent(camera.zoom),
            keepAspectRatio: true,
            locked: false,
            zIndex: zIndexStart + index,
            parentGroupId: activeGroupId,
            videoData: createDefaultVideoData(
              asset.id,
              intrinsicWidth,
              intrinsicHeight,
              stylePreset?.assetStyle.videoBorder ?? stylePreset?.imageBorder
            ),
          })
        } else {
          const intrinsicWidth = Math.max(1, asset.intrinsicWidth ?? 1200)
          const intrinsicHeight = Math.max(1, asset.intrinsicHeight ?? 800)
          const frame = getDefaultPlacedMediaSize('image', intrinsicWidth, intrinsicHeight, camera.zoom)
          createObject({
            id: objectId,
            type: 'image',
            x: world.x + index * 20,
            y: world.y + index * 20,
            w: frame.w,
            h: frame.h,
            rotation: -camera.rotation,
            scalePercent: getZoomAdjustedObjectScalePercent(camera.zoom),
            keepAspectRatio: true,
            locked: false,
            zIndex: zIndexStart + index,
            parentGroupId: activeGroupId,
            imageData: createDefaultImageData(
              asset.id,
              intrinsicWidth,
              intrinsicHeight,
              stylePreset?.assetStyle.imageBorder ?? stylePreset?.imageBorder
            ),
          })
        }
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
    const targetTemplatePlaceholderId = pendingTemplatePlaceholderImageIdRef.current
    const targetObjectId = pendingImageReloadObjectIdRef.current
    pendingTemplatePlaceholderImageIdRef.current = null
    pendingImageReloadObjectIdRef.current = null
    event.target.value = ''

    if (!file || !isSupportedImageFile(file)) {
      return
    }

    if (targetTemplatePlaceholderId) {
      const targetPlaceholder = objects.find(
        (entry): entry is Extract<CanvasObject, { type: 'template_placeholder' }> =>
          entry.id === targetTemplatePlaceholderId &&
          entry.type === 'template_placeholder'
      )
      if (!targetPlaceholder) {
        return
      }

      try {
        const dataUrl = await readFileAsDataUrl(file)
        const dimensions = await getImageDimensions(dataUrl).catch(() => ({
          width: 1200,
          height: 800,
        }))
        const asset = ensureLibraryAsset({
          id: createId(),
          name: file.name || 'image',
          mimeType: file.type,
          dataBase64: toAssetBase64(dataUrl),
          intrinsicWidth: dimensions.width,
          intrinsicHeight: dimensions.height,
          durationSec: null,
        })
        replaceTemplatePlaceholderWithMedia(targetPlaceholder, {
          kind: 'image',
          assetId: asset.id,
          intrinsicWidth: dimensions.width,
          intrinsicHeight: dimensions.height,
        })
      } catch {
        window.alert('Failed to load image file.')
      }
      return
    }

    if (!targetObjectId) {
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
      beginCommandBatch('Reload image')
      const asset = ensureLibraryAsset({
        id: createId(),
        name: file.name || 'image',
        mimeType: file.type,
        dataBase64: toAssetBase64(dataUrl),
        intrinsicWidth: dimensions.width,
        intrinsicHeight: dimensions.height,
        durationSec: null,
      })
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

  async function handleTemplatePlaceholderVideoFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    const targetTemplatePlaceholderId = pendingTemplatePlaceholderVideoIdRef.current
    pendingTemplatePlaceholderVideoIdRef.current = null
    event.target.value = ''

    if (!file || !targetTemplatePlaceholderId) {
      return
    }
    if (resolveLibraryAssetKind({ mimeType: file.type, name: file.name }) !== 'video') {
      return
    }

    const targetPlaceholder = objects.find(
      (entry): entry is Extract<CanvasObject, { type: 'template_placeholder' }> =>
        entry.id === targetTemplatePlaceholderId &&
        entry.type === 'template_placeholder'
    )
    if (!targetPlaceholder) {
      return
    }

    try {
      const asset = ensureLibraryAsset(await buildLibraryAsset(file, createId()))
      const intrinsicWidth = Math.max(1, asset.intrinsicWidth ?? 1280)
      const intrinsicHeight = Math.max(1, asset.intrinsicHeight ?? 720)
      replaceTemplatePlaceholderWithMedia(targetPlaceholder, {
        kind: 'video',
        assetId: asset.id,
        intrinsicWidth,
        intrinsicHeight,
      })
    } catch {
      window.alert('Failed to load video file.')
    }
  }

  useEffect(() => {
    const pendingChoice = pendingTemplatePlaceholderChoiceRef.current
    if (pendingChoice) {
      const candidate = objectById.get(pendingChoice.placeholderId)
      if (
        candidate &&
        candidate.type === 'template_placeholder' &&
        editableObjectIds.has(candidate.id)
      ) {
        pendingTemplatePlaceholderChoiceRef.current = null
        activateTemplatePlaceholder(candidate.id, pendingChoice.choice)
        return
      }
    }

    const pendingActivationId = pendingTemplatePlaceholderActivationIdRef.current
    if (!pendingActivationId) {
      return
    }
    const candidate = objectById.get(pendingActivationId)
    if (
      candidate &&
      candidate.type === 'template_placeholder' &&
      editableObjectIds.has(candidate.id)
    ) {
      pendingTemplatePlaceholderActivationIdRef.current = null
      activateTemplatePlaceholder(candidate.id)
    }
  }, [editableObjectIds, objectById])

  useEffect(() => {
    const pendingTextboxId = pendingTextboxEditIdRef.current
    if (!pendingTextboxId) {
      return
    }
    const candidate = objectById.get(pendingTextboxId)
    if (candidate?.type === 'textbox') {
      pendingTextboxEditIdRef.current = null
      startTextboxEditing(candidate)
    }
  }, [objectById])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextInputTarget(event.target)) {
        return
      }

      if (
        (event.key === 'ArrowLeft' ||
          event.key === 'ArrowRight' ||
          event.key === 'ArrowUp' ||
          event.key === 'ArrowDown') &&
        selectedUnlockedObjects.length > 0
      ) {
        event.preventDefault()
        const baseStep = Math.max(0.0001, canvasSettings.baseGridSize)
        const step = event.altKey ? baseStep / 10 : baseStep
        let deltaX = 0
        let deltaY = 0
        if (event.key === 'ArrowLeft') {
          deltaX = -step
        } else if (event.key === 'ArrowRight') {
          deltaX = step
        } else if (event.key === 'ArrowUp') {
          deltaY = -step
        } else if (event.key === 'ArrowDown') {
          deltaY = step
        }

        beginCommandBatch(selectedUnlockedObjects.length > 1 ? 'Nudge objects' : 'Nudge object')
        selectedUnlockedObjects.forEach((object) => {
          moveObject(object.id, {
            x: object.x + deltaX,
            y: object.y + deltaY,
            w: object.w,
            h: object.h,
            rotation: object.rotation,
          })
        })
        commitCommandBatch()
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
        if (selectedObjectIds.length > 0) {
          event.preventDefault()
          copySelection(selectedObjectIds)
        }
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        if (editableObjects.length > 0) {
          event.preventDefault()
          selectObjects(editableObjects.map((object) => object.id))
        }
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        pasteClipboard()
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedUnlockedIds.length > 0) {
          event.preventDefault()
          deleteObjects(selectedUnlockedIds)
          setContextMenu(null)
          return
        }
        if (event.key === 'Backspace' && selectedObjectIds.length > 0) {
          event.preventDefault()
        }
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
    canvasSettings.baseGridSize,
    editableObjects,
    beginCommandBatch,
    commitCommandBatch,
    createObject,
    deleteObjects,
    enterGroup,
    exitGroup,
    selectObjects,
    objects,
    selectedGroup,
    selectedObjectIds,
    selectedUnlockedObjects,
    selectedUnlockedIds,
    moveObject,
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
    setSmartGuides([])
    objectInteractionRef.current = {
      pointerId: event.pointerId,
      targets: interactionTargets.map((target) => ({
        id: target.id,
        objectType: target.type,
        keepAspectRatio: isObjectAspectRatioLocked(target),
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

  function beginShapeAdjustInteraction(
    event: PointerEvent<HTMLElement>,
    target: Extract<CanvasObject, { type: 'shape_rect' | 'shape_circle' }>
  ) {
    beginCommandBatch('Adjust shape')
    shapeAdjustInteractionRef.current = {
      pointerId: event.pointerId,
      objectId: target.id,
      objectType: target.type,
      cameraStart: camera,
      objectStart: {
        x: target.x,
        y: target.y,
        w: target.w,
        h: target.h,
        rotation: target.rotation,
      },
      shapeDataStart: {
        ...target.shapeData,
      },
    }
    viewportRef.current?.setPointerCapture(event.pointerId)
  }

  function applyShapeAdjustInteraction(
    event: PointerEvent<HTMLDivElement>,
    interaction: ShapeAdjustInteraction
  ) {
    const target = objectById.get(interaction.objectId)
    if (!target || (target.type !== 'shape_rect' && target.type !== 'shape_circle')) {
      return
    }

    const pointerScreen = getViewportRelativePoint(event.clientX, event.clientY)
    const pointerWorld = screenToWorld(pointerScreen, interaction.cameraStart, viewportSize)
    const localWorld = rotatePoint(
      {
        x: pointerWorld.x - interaction.objectStart.x,
        y: pointerWorld.y - interaction.objectStart.y,
      },
      -interaction.objectStart.rotation
    )
    const localX = localWorld.x + interaction.objectStart.w / 2
    const localY = localWorld.y + interaction.objectStart.h / 2
    const patch = resolveShapeAdjustmentFromLocalPoint(
      interaction.objectType,
      interaction.shapeDataStart,
      interaction.objectStart.w,
      interaction.objectStart.h,
      localX,
      localY
    )
    if (!patch) {
      return
    }

    setShapeData(
      target.id,
      {
        ...target.shapeData,
        ...patch,
      }
    )
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
    const snapCandidateObjects = canSnapToObjectEdges
      ? editableObjects.filter((object) => !interactionIds.has(object.id))
      : []
    const edgeCandidates = canSnapToObjectEdges
      ? collectSnapCandidateEdges(snapCandidateObjects)
      : { x: [], y: [] }

    if (interaction.mode === 'move') {
      let appliedDelta = deltaWorld
      let nextGuides: SmartGuideLine[] = []
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
        const edgeSnap = getObjectEdgeSnapResult(movedBounds, edgeCandidates, snapToleranceWorld)
        const horizontalSpacingSnap = getHorizontalSpacingSnap(
          movedBounds,
          snapCandidateObjects,
          snapToleranceWorld
        )
        const verticalSpacingSnap = getVerticalSpacingSnap(
          movedBounds,
          snapCandidateObjects,
          snapToleranceWorld
        )
        const edgeXAbs = edgeSnap.guides.some((guide) => guide.orientation === 'vertical')
          ? Math.abs(edgeSnap.offset.x)
          : Number.POSITIVE_INFINITY
        const edgeYAbs = edgeSnap.guides.some((guide) => guide.orientation === 'horizontal')
          ? Math.abs(edgeSnap.offset.y)
          : Number.POSITIVE_INFINITY
        const resolvedX =
          Math.abs(horizontalSpacingSnap.offset.x) > 0 &&
            Math.abs(horizontalSpacingSnap.offset.x) <= edgeXAbs
            ? { delta: horizontalSpacingSnap.offset.x, guides: horizontalSpacingSnap.guides }
            : { delta: edgeSnap.offset.x, guides: edgeSnap.guides.filter((guide) => guide.orientation === 'vertical') }
        const resolvedY =
          Math.abs(verticalSpacingSnap.offset.y) > 0 &&
            Math.abs(verticalSpacingSnap.offset.y) <= edgeYAbs
            ? { delta: verticalSpacingSnap.offset.y, guides: verticalSpacingSnap.guides }
            : { delta: edgeSnap.offset.y, guides: edgeSnap.guides.filter((guide) => guide.orientation === 'horizontal') }
        appliedDelta = {
          x: appliedDelta.x + resolvedX.delta,
          y: appliedDelta.y + resolvedY.delta,
        }
        nextGuides = [...resolvedX.guides, ...resolvedY.guides]
      }
      setSmartGuides(nextGuides)

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
      let nextGuides: SmartGuideLine[] = []
      const keepAspectRatio =
        (interaction.targets.length === 1
          ? interaction.targets[0]?.keepAspectRatio
          : interaction.targets.every((target) => target.keepAspectRatio)) ||
        event.ctrlKey ||
        event.metaKey
      if (interaction.targets.length === 1) {
        const target = interaction.targets[0]
        const localDelta = rotatePoint(deltaWorld, -target.start.rotation)
        let nextWidth: number
        let nextHeight: number

        if (keepAspectRatio) {
          const widthFromDelta = Math.max(1, target.start.w + localDelta.x)
          const heightFromDelta = Math.max(1, target.start.h + localDelta.y)
          const widthScale = widthFromDelta / Math.max(1, target.start.w)
          const heightScale = heightFromDelta / Math.max(1, target.start.h)
          const widthDominant =
            Math.abs(localDelta.x / Math.max(1, target.start.w)) >=
            Math.abs(localDelta.y / Math.max(1, target.start.h))

          let uniformScale = widthDominant ? widthScale : heightScale
          uniformScale = Math.max(
            uniformScale,
            1 / Math.max(1, target.start.w),
            1 / Math.max(1, target.start.h)
          )

          if (shouldSnapToGrid) {
            if (widthDominant) {
              const snappedWidth = Math.max(1, snapToGrid(target.start.w * uniformScale, snapGridSize))
              uniformScale = snappedWidth / Math.max(1, target.start.w)
            } else {
              const snappedHeight = Math.max(1, snapToGrid(target.start.h * uniformScale, snapGridSize))
              uniformScale = snappedHeight / Math.max(1, target.start.h)
            }
          }

          uniformScale = Math.max(
            uniformScale,
            1 / Math.max(1, target.start.w),
            1 / Math.max(1, target.start.h)
          )
          nextWidth = Math.max(1, target.start.w * uniformScale)
          nextHeight = Math.max(1, target.start.h * uniformScale)
        } else {
          nextWidth = Math.max(1, target.start.w + localDelta.x)
          nextHeight = Math.max(1, target.start.h + localDelta.y)
          if (shouldSnapToGrid) {
            nextWidth = Math.max(1, snapToGrid(nextWidth, snapGridSize))
            nextHeight = Math.max(1, snapToGrid(nextHeight, snapGridSize))
          }
        }
        if (target.objectType === 'shape_circle') {
          const widthDominant = Math.abs(localDelta.x) >= Math.abs(localDelta.y)
          let nextCircleSize = widthDominant ? nextWidth : nextHeight
          nextCircleSize = Math.max(1, nextCircleSize)
          if (shouldSnapToGrid) {
            nextCircleSize = Math.max(1, snapToGrid(nextCircleSize, snapGridSize))
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
          const resizedBounds = getTransformAabb(nextTransform)
          const edgeSnap = getObjectEdgeSnapResult(resizedBounds, edgeCandidates, snapToleranceWorld)
          const horizontalSpacingSnap = getHorizontalSpacingSnap(
            resizedBounds,
            snapCandidateObjects,
            snapToleranceWorld
          )
          const verticalSpacingSnap = getVerticalSpacingSnap(
            resizedBounds,
            snapCandidateObjects,
            snapToleranceWorld
          )
          const edgeXAbs = edgeSnap.guides.some((guide) => guide.orientation === 'vertical')
            ? Math.abs(edgeSnap.offset.x)
            : Number.POSITIVE_INFINITY
          const edgeYAbs = edgeSnap.guides.some((guide) => guide.orientation === 'horizontal')
            ? Math.abs(edgeSnap.offset.y)
            : Number.POSITIVE_INFINITY
          const resolvedX =
            Math.abs(horizontalSpacingSnap.offset.x) > 0 &&
              Math.abs(horizontalSpacingSnap.offset.x) <= edgeXAbs
              ? { delta: horizontalSpacingSnap.offset.x, guides: horizontalSpacingSnap.guides }
              : { delta: edgeSnap.offset.x, guides: edgeSnap.guides.filter((guide) => guide.orientation === 'vertical') }
          const resolvedY =
            Math.abs(verticalSpacingSnap.offset.y) > 0 &&
              Math.abs(verticalSpacingSnap.offset.y) <= edgeYAbs
              ? { delta: verticalSpacingSnap.offset.y, guides: verticalSpacingSnap.guides }
              : { delta: edgeSnap.offset.y, guides: edgeSnap.guides.filter((guide) => guide.orientation === 'horizontal') }
          centerShiftWorld.x += resolvedX.delta
          centerShiftWorld.y += resolvedY.delta
          nextGuides = [...resolvedX.guides, ...resolvedY.guides]
        }
        setSmartGuides(nextGuides)

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
      let nextWidth = Math.max(1, selectionWidth + deltaWorld.x)
      let nextHeight = Math.max(1, selectionHeight + deltaWorld.y)
      if (shouldSnapToGrid) {
        nextWidth = Math.max(1, snapToGrid(nextWidth, snapGridSize))
        nextHeight = Math.max(1, snapToGrid(nextHeight, snapGridSize))
      }
      let scaleX = nextWidth / selectionWidth
      let scaleY = nextHeight / selectionHeight
      if (keepAspectRatio) {
        const widthDominant =
          Math.abs(deltaWorld.x / selectionWidth) >= Math.abs(deltaWorld.y / selectionHeight)
        let uniformScale = widthDominant ? scaleX : scaleY
        uniformScale = Math.max(
          uniformScale,
          1 / selectionWidth,
          1 / selectionHeight
        )

        if (shouldSnapToGrid) {
          if (widthDominant) {
            const snappedWidth = Math.max(1, snapToGrid(selectionWidth * uniformScale, snapGridSize))
            uniformScale = snappedWidth / selectionWidth
          } else {
            const snappedHeight = Math.max(1, snapToGrid(selectionHeight * uniformScale, snapGridSize))
            uniformScale = snappedHeight / selectionHeight
          }
        }

        uniformScale = Math.max(
          uniformScale,
          1 / selectionWidth,
          1 / selectionHeight
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
        const edgeSnap = getObjectEdgeSnapResult(resizedBounds, edgeCandidates, snapToleranceWorld)
        const horizontalSpacingSnap = getHorizontalSpacingSnap(
          resizedBounds,
          snapCandidateObjects,
          snapToleranceWorld
        )
        const verticalSpacingSnap = getVerticalSpacingSnap(
          resizedBounds,
          snapCandidateObjects,
          snapToleranceWorld
        )
        const edgeXAbs = edgeSnap.guides.some((guide) => guide.orientation === 'vertical')
          ? Math.abs(edgeSnap.offset.x)
          : Number.POSITIVE_INFINITY
        const edgeYAbs = edgeSnap.guides.some((guide) => guide.orientation === 'horizontal')
          ? Math.abs(edgeSnap.offset.y)
          : Number.POSITIVE_INFINITY
        const resolvedX =
          Math.abs(horizontalSpacingSnap.offset.x) > 0 &&
            Math.abs(horizontalSpacingSnap.offset.x) <= edgeXAbs
            ? { delta: horizontalSpacingSnap.offset.x, guides: horizontalSpacingSnap.guides }
            : { delta: edgeSnap.offset.x, guides: edgeSnap.guides.filter((guide) => guide.orientation === 'vertical') }
        const resolvedY =
          Math.abs(verticalSpacingSnap.offset.y) > 0 &&
            Math.abs(verticalSpacingSnap.offset.y) <= edgeYAbs
            ? { delta: verticalSpacingSnap.offset.y, guides: verticalSpacingSnap.guides }
            : { delta: edgeSnap.offset.y, guides: edgeSnap.guides.filter((guide) => guide.orientation === 'horizontal') }
        selectionOffset = {
          x: resolvedX.delta,
          y: resolvedY.delta,
        }
        nextGuides = [...resolvedX.guides, ...resolvedY.guides]
      }
      setSmartGuides(nextGuides)

      interaction.targets.forEach((target) => {
        let targetWidth = Math.max(1, target.start.w * scaleX)
        let targetHeight = Math.max(1, target.start.h * scaleY)
        if (target.objectType === 'shape_circle') {
          const widthDominant =
            Math.abs(deltaWorld.x / selectionWidth) >= Math.abs(deltaWorld.y / selectionHeight)
          const dominantScale = widthDominant ? scaleX : scaleY
          const circleStartSize = Math.min(target.start.w, target.start.h)
          let circleSize = Math.max(1, circleStartSize * dominantScale)
          if (shouldSnapToGrid) {
            circleSize = Math.max(1, snapToGrid(circleSize, snapGridSize))
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

    setSmartGuides([])

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
      } else {
        clearSelection()
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

  function beginCreationInteraction(
    event: PointerEvent<HTMLDivElement>,
    tool: CreationToolConfig
  ) {
    const start = getViewportRelativePoint(event.clientX, event.clientY)
    creationInteractionRef.current = {
      pointerId: event.pointerId,
      tool: tool.type,
      startScreen: start,
      currentScreen: start,
      cameraStart: camera,
      image: tool.image,
    }
    setCreationPreviewRect(toRect(start, start))
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function finalizeCreationInteraction(interaction: CreationInteraction) {
    if (!onCreateObjectFromTool) {
      return
    }

    const deltaScreen = {
      x: interaction.currentScreen.x - interaction.startScreen.x,
      y: interaction.currentScreen.y - interaction.startScreen.y,
    }
    const safeZoom = Math.max(interaction.cameraStart.zoom, 0.001)
    const dragDistance = Math.hypot(deltaScreen.x, deltaScreen.y)
    const defaultWidth = 260 / safeZoom
    const defaultHeight = 160 / safeZoom

    let width = Math.abs(deltaScreen.x) / safeZoom
    let height = Math.abs(deltaScreen.y) / safeZoom
    let centerScreen = {
      x: (interaction.startScreen.x + interaction.currentScreen.x) / 2,
      y: (interaction.startScreen.y + interaction.currentScreen.y) / 2,
    }

    if (dragDistance < 4) {
      centerScreen = interaction.startScreen
      width = defaultWidth
      height =
        interaction.tool === 'image' && interaction.image
          ? Math.max(
            40 / safeZoom,
            defaultWidth /
            Math.max(0.0001, interaction.image.intrinsicWidth / Math.max(1, interaction.image.intrinsicHeight))
          )
          : defaultHeight
    }

    if (interaction.tool === 'shape_circle') {
      const size = Math.max(1 / safeZoom, Math.max(width, height))
      width = size
      height = size
    } else {
      width = Math.max(1 / safeZoom, width)
      height = Math.max(1 / safeZoom, height)
    }

    const centerWorld = screenToWorld(centerScreen, interaction.cameraStart, viewportSize)
    onCreateObjectFromTool(interaction.tool, {
      x: centerWorld.x,
      y: centerWorld.y,
      w: width,
      h: height,
      rotation: -interaction.cameraStart.rotation,
    })
  }

  function handleViewportPointerDown(event: PointerEvent<HTMLDivElement>) {
    setSmartGuides([])
    closeContextMenu()
    if (styleCopySourceObjectId && event.button === 0) {
      event.preventDefault()
      setStyleCopySourceObjectId(null)
      return
    }
    if (activeImageEffectsObjectId) {
      closeActiveImageEffects(true)
    }

    if (editingTextboxId && event.button === 0) {
      event.preventDefault()
      finishTextboxEditing(true)
      clearSelection()
      return
    }

    if (event.button === 0 && activeCropObjectId) {
      event.preventDefault()
      disableActiveCropMode()
      clearSelection()
      return
    }

    if (event.button === 0 && activeGroupObject) {
      const pointerScreen = getViewportRelativePoint(event.clientX, event.clientY)
      const pointerWorld = screenToWorld(pointerScreen, camera, viewportSize)
      if (!isPointInsideObjectRect(pointerWorld, activeGroupObject)) {
        event.preventDefault()
        exitGroup()
        clearSelection()
        return
      }
    }

    if (event.button === 0) {
      if (creationTool) {
        event.preventDefault()
        if (creationTool.type === 'image') {
          if (onCreateObjectFromTool) {
            const start = getViewportRelativePoint(event.clientX, event.clientY)
            const centerWorld = screenToWorld(start, camera, viewportSize)
            const safeZoom = Math.max(camera.zoom, 0.001)
            const width = 260 / safeZoom
            const height = creationTool.image
              ? Math.max(
                40 / safeZoom,
                width /
                Math.max(
                  0.0001,
                  creationTool.image.intrinsicWidth / Math.max(1, creationTool.image.intrinsicHeight)
                )
              )
              : 160 / safeZoom
            onCreateObjectFromTool('image', {
              x: centerWorld.x,
              y: centerWorld.y,
              w: width,
              h: height,
              rotation: -camera.rotation,
            })
          }
          return
        }
        beginCreationInteraction(event, creationTool)
        return
      }
      event.preventDefault()
      if (selectedSlideId !== null) {
        selectSlide(null)
      }
      const start = getViewportRelativePoint(event.clientX, event.clientY)
      beginMarqueeSelection(event.pointerId, start, selectedObjectIds)
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    if (event.button !== 1) {
      return
    }

    if (event.shiftKey && selectedUnlockedObjects.length > 0) {
      event.preventDefault()
      const targetRotation = normalizeRotationRadians(-camera.rotation)
      beginCommandBatch(
        selectedUnlockedObjects.length > 1
          ? 'Align objects to screen'
          : 'Align object to screen'
      )
      selectedUnlockedObjects.forEach((object) => {
        moveObject(object.id, {
          x: object.x,
          y: object.y,
          w: object.w,
          h: object.h,
          rotation: targetRotation,
        })
      })
      commitCommandBatch()
      return
    }

    event.preventDefault()
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

    const shapeAdjustInteraction = shapeAdjustInteractionRef.current
    if (shapeAdjustInteraction && shapeAdjustInteraction.pointerId === event.pointerId) {
      applyShapeAdjustInteraction(event, shapeAdjustInteraction)
      return
    }

    const interaction = objectInteractionRef.current
    if (interaction && interaction.pointerId === event.pointerId) {
      applyObjectInteraction(event, interaction)
      return
    }

    const creationInteraction = creationInteractionRef.current
    if (creationInteraction && creationInteraction.pointerId === event.pointerId) {
      const current = getViewportRelativePoint(event.clientX, event.clientY)
      creationInteraction.currentScreen = current
      setCreationPreviewRect(toRect(creationInteraction.startScreen, current))
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

    const shapeAdjustInteraction = shapeAdjustInteractionRef.current
    if (shapeAdjustInteraction && shapeAdjustInteraction.pointerId === event.pointerId) {
      shapeAdjustInteractionRef.current = null
      commitCommandBatch()
    }

    const interaction = objectInteractionRef.current
    if (interaction && interaction.pointerId === event.pointerId) {
      objectInteractionRef.current = null
      setSmartGuides([])
      const deltaClient = {
        x: event.clientX - interaction.originClient.x,
        y: event.clientY - interaction.originClient.y,
      }
      commitCommandBatch()
      const wasClick = Math.hypot(deltaClient.x, deltaClient.y) < 4
      if (
        wasClick &&
        interaction.mode === 'move' &&
        interaction.targets.length === 1 &&
        (interaction.targets[0]?.objectType === 'video' ||
          interaction.targets[0]?.objectType === 'sound')
      ) {
        if (interaction.targets[0]?.objectType === 'video') {
          const video = videoElementMapRef.current.get(interaction.targets[0].id)
          if (video) {
            if (video.paused) {
              void video.play().catch(() => undefined)
            } else {
              video.pause()
            }
          }
        } else {
          const audio = soundElementMapRef.current.get(interaction.targets[0].id)
          if (audio) {
            if (audio.paused) {
              void audio.play().catch(() => undefined)
            } else {
              audio.pause()
            }
          }
        }
      }
    }

    const creationInteraction = creationInteractionRef.current
    if (creationInteraction && creationInteraction.pointerId === event.pointerId) {
      creationInteractionRef.current = null
      setCreationPreviewRect(null)
      finalizeCreationInteraction(creationInteraction)
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
        const dragTypes = Array.from(event.dataTransfer.types)
        if (dragTypes.includes('Files') || dragTypes.includes(ASSET_LIBRARY_DRAG_MIME)) {
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

      {smartGuides.length > 0 && (
        <div className="smart-guides-layer" aria-hidden="true">
          {smartGuides.map((guide, index) => {
            if (guide.orientation === 'vertical') {
              const start = worldToScreen({ x: guide.position, y: guide.start }, camera, viewportSize)
              const end = worldToScreen({ x: guide.position, y: guide.end }, camera, viewportSize)
              return (
                <div
                  key={`smart-guide-${guide.orientation}-${index}`}
                  className={`smart-guide-line ${guide.kind}`}
                  style={{
                    left: start.x,
                    top: Math.min(start.y, end.y),
                    width: 1,
                    height: Math.abs(end.y - start.y),
                  }}
                />
              )
            }

            const start = worldToScreen({ x: guide.start, y: guide.position }, camera, viewportSize)
            const end = worldToScreen({ x: guide.end, y: guide.position }, camera, viewportSize)
            return (
              <div
                key={`smart-guide-${guide.orientation}-${index}`}
                className={`smart-guide-line ${guide.kind}`}
                style={{
                  left: Math.min(start.x, end.x),
                  top: start.y,
                  width: Math.abs(end.x - start.x),
                  height: 1,
                }}
              />
            )
          })}
        </div>
      )}

      <div className="objects-layer">
        {orderedObjects.map((object) => {
          const center = worldToScreen({ x: object.x, y: object.y }, camera, viewportSize)
          const widthPx = object.w * camera.zoom
          const heightPx = object.h * camera.zoom
          const isSelected = selectedObjectIds.includes(object.id)
          const usesHoveredAsset =
            hoveredAsset !== null &&
            (
              (object.type === 'image' && object.imageData.assetId === hoveredAsset.id) ||
              (object.type === 'video' && object.videoData.assetId === hoveredAsset.id) ||
              (object.type === 'sound' && object.soundData.assetId === hoveredAsset.id) ||
              (
                object.type === 'textbox' &&
                resolveLibraryAssetKind(hoveredAsset) === 'font' &&
                textboxUsesFontFamily(object.textboxData, resolveAssetFontFamily(hoveredAsset))
              )
            )
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
          const templatePlaceholderScale =
            object.type === 'template_placeholder'
              ? Math.max(0.01, camera.zoom * resolveObjectBorderScale(object.scalePercent))
              : 1
          const templatePlaceholderStyle =
            object.type === 'template_placeholder'
              ? ({
                '--canvas-template-scale': String(templatePlaceholderScale),
              } as CSSProperties)
              : {}

          const objectClasses = [
            'canvas-object',
            object.type,
            isSelected ? 'selected' : '',
            editingTextboxId === object.id ? 'editing' : '',
            usesHoveredAsset ? 'asset-highlighted' : '',
            object.locked ? 'locked' : '',
            isEditable ? '' : 'inactive',
            canEnterViaChildDoubleClick ? 'enterable-child' : '',
            isActiveGroupShell ? 'active-group-shell' : '',
          ]
            .filter(Boolean)
            .join(' ')

          const shapeStyle =
            object.type === 'shape_rect' ||
              object.type === 'shape_circle'
              ? {
                background: 'transparent',
                opacity: object.shapeData.opacityPercent / 100,
                filter: resolveObjectDropShadowFilter(object.shapeData, camera.zoom),
              }
              : {}
          const textboxStyle =
            object.type === 'textbox'
              ? {
                borderColor: object.textboxData.borderColor ?? DEFAULT_TEXTBOX_BORDER_COLOR,
                borderStyle: object.textboxData.borderType ?? 'solid',
                borderWidth:
                  (object.textboxData.borderWidth ?? DEFAULT_TEXTBOX_BORDER_WIDTH) *
                  camera.zoom *
                  resolveObjectBorderScale(object.scalePercent),
                borderRadius: Math.max(0, object.textboxData.radius) * camera.zoom,
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
          const videoStyle =
            object.type === 'video'
              ? {
                opacity: object.videoData.opacityPercent / 100,
                filter: resolveObjectDropShadowFilter(object.videoData, camera.zoom),
                background: 'transparent',
              }
              : {}
          const soundStyle =
            object.type === 'sound'
              ? {
                opacity: object.soundData.opacityPercent / 100,
                filter: resolveObjectDropShadowFilter(object.soundData, camera.zoom),
                background:
                  'linear-gradient(135deg, rgba(32, 52, 92, 0.92), rgba(19, 28, 48, 0.96))',
                borderColor: object.soundData.borderColor,
                borderStyle: object.soundData.borderType,
                borderWidth:
                  object.soundData.borderWidth *
                  camera.zoom *
                  resolveObjectBorderScale(object.scalePercent),
                borderRadius: Math.max(0, object.soundData.radius) * camera.zoom,
              }
              : {}
          const mediaAsset =
            object.type === 'image'
              ? assetById.get(object.imageData.assetId)
              : object.type === 'video'
                ? assetById.get(object.videoData.assetId)
                : object.type === 'sound'
                  ? assetById.get(object.soundData.assetId)
                  : null
          const mediaSrc = mediaAsset
            ? `data:${mediaAsset.mimeType};base64,${mediaAsset.dataBase64}`
            : null
          const textboxHtml = object.type === 'textbox' ? resolveTextboxRichHtml(object.textboxData) : ''

          return (
            <div
              key={object.id}
              className={objectClasses}
              data-object-id={object.id}
              data-object-type={object.type}
              style={{
                ...baseStyle,
                ...templatePlaceholderStyle,
                ...shapeStyle,
                ...textboxStyle,
                ...imageStyle,
                ...videoStyle,
                ...soundStyle,
              }}
              onPointerDown={(event) => {
                if (event.button === 0 && activeGroupId !== null && !isEditable) {
                  event.preventDefault()
                  event.stopPropagation()
                  closeContextMenu()
                  exitGroup()
                  clearSelection()
                  return
                }

                if (event.button === 0 && event.shiftKey) {
                  event.preventDefault()
                  event.stopPropagation()
                  closeContextMenu()
                  if (selectedSlideId !== null) {
                    selectSlide(null)
                  }
                  const start = getViewportRelativePoint(event.clientX, event.clientY)
                  beginMarqueeSelection(event.pointerId, start, selectedObjectIds, object.id)
                  event.currentTarget.setPointerCapture(event.pointerId)
                  return
                }

                if (
                  object.type === 'template_placeholder' &&
                  !isEditable
                ) {
                  event.preventDefault()
                  event.stopPropagation()
                  closeContextMenu()

                  if (activeGroupId === null && object.parentGroupId) {
                    pendingTemplatePlaceholderActivationIdRef.current = object.id
                    enterGroup(object.parentGroupId)
                  }
                  return
                }

                if (
                  object.type === 'template_placeholder' &&
                  object.templatePlaceholderData.kind !== 'universal'
                ) {
                  event.preventDefault()
                  event.stopPropagation()
                  closeContextMenu()

                  activateTemplatePlaceholder(object.id)
                  return
                }

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
                  finishTextboxEditing(true)
                  clearSelection()
                  return
                }
                if (activeCropObjectId && object.id !== activeCropObjectId) {
                  event.preventDefault()
                  event.stopPropagation()
                  disableActiveCropMode()
                  clearSelection()
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
                if (
                  object.type === 'image' &&
                  object.imageData.cropEnabled &&
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
                  if (!selectedObjectIds.includes(object.id)) {
                    selectObjects([object.id])
                  }
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
              {object.type === 'image' ? (
                <div
                  className="canvas-image-clip"
                  style={{
                    borderColor: object.imageData.borderColor,
                    borderStyle: object.imageData.borderType,
                    borderWidth: `${Math.max(
                      0,
                      object.imageData.borderWidth *
                      camera.zoom *
                      resolveObjectBorderScale(object.scalePercent)
                    )}px`,
                    clipPath: `inset(${object.imageData.cropTopPercent}% ${object.imageData.cropRightPercent}% ${object.imageData.cropBottomPercent}% ${object.imageData.cropLeftPercent}% round ${Math.max(0, object.imageData.radius) * camera.zoom}px)`,
                  }}
                >
                  {mediaSrc ? (
                    <img
                      src={mediaSrc}
                      alt=""
                      draggable={false}
                      style={{
                        width: `${widthPx}px`,
                        height: `${heightPx}px`,
                        objectFit: 'fill',
                        filter: resolveImageFilterCss(object.imageData),
                      }}
                    />
                  ) : (
                    <span>Image</span>
                  )}
                </div>
              ) : object.type === 'video' ? (
                <div
                  className="canvas-image-clip"
                  style={{
                    borderColor: object.videoData.borderColor,
                    borderStyle: object.videoData.borderType,
                    borderWidth: `${Math.max(
                      0,
                      object.videoData.borderWidth *
                      camera.zoom *
                      resolveObjectBorderScale(object.scalePercent)
                    )}px`,
                    clipPath: `inset(0% 0% 0% 0% round ${Math.max(0, object.videoData.radius) * camera.zoom}px)`,
                  }}
                >
                  {mediaSrc ? (
                    <CanvasVideoPreview
                      src={mediaSrc}
                      muted={object.videoData.muted}
                      loop={object.videoData.loop}
                      widthPx={widthPx}
                      heightPx={heightPx}
                      onVideoElement={(element) => {
                        if (element) {
                          videoElementMapRef.current.set(object.id, element)
                        } else {
                          videoElementMapRef.current.delete(object.id)
                        }
                      }}
                    />
                  ) : (
                    <span>Video</span>
                  )}
                </div>
              ) : object.type === 'sound' ? (
                mediaSrc ? (
                  <CanvasSoundPreview
                    src={mediaSrc}
                    label={mediaAsset?.name ?? 'Sound'}
                    loop={object.soundData.loop}
                    contentScale={camera.zoom * resolveObjectBorderScale(object.scalePercent)}
                    onAudioElement={(element) => {
                      if (element) {
                        soundElementMapRef.current.set(object.id, element)
                      } else {
                        soundElementMapRef.current.delete(object.id)
                      }
                    }}
                  />
                ) : (
                  <span>Sound</span>
                )
              ) : object.type === 'textbox' ? (
                (() => {
                  const textboxBaseTextStyle = resolveTextboxBaseTextStyle(object.textboxData)
                  const textboxVerticalAlignment = object.textboxData.verticalAlignment ?? 'top'
                  const renderContentScale = Math.max(
                    0.01,
                    camera.zoom * resolveTextboxObjectScale(object.textboxData, object.scalePercent)
                  )
                  return editingTextboxId === object.id ? (
                    <RichTextboxEditor
                      editorKey={object.id}
                      html={editingTextboxHtml}
                      fontFamily={textboxBaseTextStyle.fontFamily}
                      availableFontFamilies={availableTextboxFonts}
                      textStyleOptions={stylePreset?.textStyles}
                      defaultFontSizePx={textboxBaseTextStyle.fontSizePx}
                      defaultTextColor={textboxBaseTextStyle.textColor}
                      verticalAlignment={textboxVerticalAlignment}
                      onVerticalAlignmentChange={(nextVerticalAlignment) => {
                        if ((object.textboxData.verticalAlignment ?? 'top') === nextVerticalAlignment) {
                          return
                        }
                        setTextboxData(object.id, {
                          ...object.textboxData,
                          verticalAlignment: nextVerticalAlignment,
                        })
                      }}
                      contentScale={renderContentScale}
                      onContentChange={({ html, plainText, contentHeight }) => {
                        setEditingTextboxHtml(html)
                        setEditingTextboxPlainText(plainText)
                        editingTextboxMeasuredHeightPxRef.current = contentHeight
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
                        className={`textbox-rich-content textbox-content-inner textbox-v-align-${textboxVerticalAlignment}`}
                        style={{
                          fontFamily: textboxBaseTextStyle.fontFamily,
                          fontSize: `${textboxBaseTextStyle.fontSizePx}px`,
                          color: textboxBaseTextStyle.textColor,
                          transform: `scale(${renderContentScale})`,
                          transformOrigin: 'top left',
                          width: `${100 / renderContentScale}%`,
                          height: `${100 / renderContentScale}%`,
                        }}
                        dangerouslySetInnerHTML={{
                          __html: textboxHtml,
                        }}
                      />
                    </div>
                  )
                })()
              ) : object.type === 'template_placeholder' ? (
                <div
                  className={`canvas-template-placeholder kind-${object.templatePlaceholderData.kind} ${object.templatePlaceholderData.kind === 'universal' ? 'universal' : ''}`}
                >
                  {object.templatePlaceholderData.kind === 'universal' ? (
                    <div className="canvas-template-placeholder-choice-grid">
                      {UNIVERSAL_TEMPLATE_CHOICES.map((entry) => (
                        <button
                          key={entry.choice}
                          type="button"
                          className={`canvas-template-placeholder-choice ${entry.cornerClassName}`}
                          onPointerDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                          }}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            closeContextMenu()
                            handleTemplatePlaceholderChoice(object, entry.choice)
                          }}
                          title={entry.label}
                          aria-label={entry.label}
                        >
                          <FontAwesomeIcon icon={entry.icon} />
                          <span>{entry.label}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span>{getTemplatePlaceholderBadge(object.templatePlaceholderData.kind)}</span>
                  )}
                  <strong>{object.templatePlaceholderData.prompt}</strong>
                </div>
              ) : object.type === 'shape_rect' || object.type === 'shape_circle' ? (
                <ShapeSvg
                  shapeType={object.type}
                  shapeData={object.shapeData}
                  width={object.w}
                  height={object.h}
                  borderScale={resolveObjectBorderScale(object.scalePercent)}
                  fillBackground={getShapeBackground(object.shapeData)}
                  className="canvas-shape-svg"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    overflow: 'visible',
                    pointerEvents: 'none',
                  }}
                />
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

      {targetDisplayFrame.isConstrained && isTargetDisplayOverlayEnabled && (
        <div className="target-display-overlay" aria-hidden="true">
          <div
            className="target-display-mask top"
            style={{
              left: 0,
              top: 0,
              width: viewportSize.width,
              height: targetDisplayFrame.top,
            }}
          />
          <div
            className="target-display-mask bottom"
            style={{
              left: 0,
              top: targetDisplayFrame.top + targetDisplayFrame.height,
              width: viewportSize.width,
              height: Math.max(0, viewportSize.height - (targetDisplayFrame.top + targetDisplayFrame.height)),
            }}
          />
          <div
            className="target-display-mask left"
            style={{
              left: 0,
              top: targetDisplayFrame.top,
              width: targetDisplayFrame.left,
              height: targetDisplayFrame.height,
            }}
          />
          <div
            className="target-display-mask right"
            style={{
              left: targetDisplayFrame.left + targetDisplayFrame.width,
              top: targetDisplayFrame.top,
              width: Math.max(0, viewportSize.width - (targetDisplayFrame.left + targetDisplayFrame.width)),
              height: targetDisplayFrame.height,
            }}
          />
          <div
            className="target-display-frame"
            style={{
              left: targetDisplayFrame.left,
              top: targetDisplayFrame.top,
              width: targetDisplayFrame.width,
              height: targetDisplayFrame.height,
            }}
          />
          <div
            className={`target-display-origin-dot ${targetDisplayOriginMarker.isClamped ? 'clamped' : ''}`}
            style={{
              left: targetDisplayOriginMarker.x,
              top: targetDisplayOriginMarker.y,
            }}
            title={targetDisplayOriginMarker.isClamped ? 'Origin (0,0) is outside frame' : 'Origin (0,0)'}
          />
        </div>
      )}

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

      {creationPreviewRect && (
        <div
          className={`creation-preview ${creationTool?.type === 'shape_circle' ? 'circle' : ''}`}
          style={{
            left: creationPreviewRect.minX,
            top: creationPreviewRect.minY,
            width: creationPreviewRect.maxX - creationPreviewRect.minX,
            height: creationPreviewRect.maxY - creationPreviewRect.minY,
            clipPath:
              creationTool?.type === 'shape_rect'
                ? getShapeClipPath(normalizeShapeKind(creationTool.shapeKind)) ?? undefined
                : undefined,
            borderRadius:
              creationTool?.type === 'shape_rect'
                ? getShapeBorderRadius(normalizeShapeKind(creationTool.shapeKind), 14)
                : undefined,
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
                {selectedShapeAdjustmentHandle &&
                  (selectedObject.type === 'shape_rect' || selectedObject.type === 'shape_circle') && (
                    <button
                      type="button"
                      className="shape-adjust-handle"
                      aria-label={selectedShapeAdjustmentHandle.title}
                      title={selectedShapeAdjustmentHandle.title}
                      style={{
                        left: `${selectedShapeAdjustmentHandle.xPercent}%`,
                        top: `${selectedShapeAdjustmentHandle.yPercent}%`,
                      }}
                      onPointerDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        beginShapeAdjustInteraction(event, selectedObject)
                      }}
                    />
                  )}
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
          <div className="selection-top-controls">
            <button
              type="button"
              className="alignment-handle"
              aria-label="Distribute horizontally"
              title="Distribute horizontally"
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                applyAlignment('distribute-horizontal')
              }}
              disabled={!canDistributeSelectedObjects}
            >
              <FontAwesomeIcon icon={faGripLinesVertical} />
            </button>
            <button
              type="button"
              className="alignment-handle"
              aria-label="Align left"
              title="Align left"
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                applyAlignment('left')
              }}
              disabled={!canAlignSelectedObjects}
            >
              <FontAwesomeIcon icon={faAlignLeft} />
            </button>
            <button
              type="button"
              className="alignment-handle"
              aria-label="Align horizontal centers"
              title="Align horizontal centers"
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                applyAlignment('center-horizontal')
              }}
              disabled={!canAlignSelectedObjects}
            >
              <FontAwesomeIcon icon={faAlignCenter} />
            </button>
            <button
              type="button"
              className="alignment-handle"
              aria-label="Align right"
              title="Align right"
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                applyAlignment('right')
              }}
              disabled={!canAlignSelectedObjects}
            >
              <FontAwesomeIcon icon={faAlignRight} />
            </button>
            <span className="selection-top-controls-separator" aria-hidden="true" />
            <button
              type="button"
              className="alignment-handle"
              aria-label="Align center"
              title="Align center"
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                applyAlignment('center')
              }}
              disabled={!canAlignSelectedObjects}
            >
              <FontAwesomeIcon icon={faUpDownLeftRight} />
            </button>
            <span className="selection-top-controls-separator" aria-hidden="true" />
            <button
              type="button"
              className="alignment-handle"
              aria-label="Align top"
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                applyAlignment('top')
              }}
              disabled={!canAlignSelectedObjects}
            >
              <FontAwesomeIcon icon={faArrowsUpToLine} />
            </button>
            <button
              type="button"
              className="alignment-handle"
              aria-label="Align vertical centers"
              title="Align vertical centers"
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                applyAlignment('center-vertical')
              }}
              disabled={!canAlignSelectedObjects}
            >
              <FontAwesomeIcon icon={faAlignCenter} className="alignment-icon-vertical" />
            </button>
            <button
              type="button"
              className="alignment-handle"
              aria-label="Align bottom"
              title="Align bottom"
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                applyAlignment('bottom')
              }}
              disabled={!canAlignSelectedObjects}
            >
              <FontAwesomeIcon icon={faArrowsDownToLine} />
            </button>
            <button
              type="button"
              className="alignment-handle"
              aria-label="Distribute vertically"
              title="Distribute vertically"
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                applyAlignment('distribute-vertical')
              }}
              disabled={!canDistributeSelectedObjects}
            >
              <FontAwesomeIcon icon={faGripLines} />
            </button>
          </div>
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
      <input
        ref={templatePlaceholderVideoInputRef}
        type="file"
        accept={SUPPORTED_VIDEO_ACCEPT}
        onChange={handleTemplatePlaceholderVideoFile}
        style={{ display: 'none' }}
      />

      <div className="camera-card" aria-label="Camera position">
        <span
          className="camera-pos-item camera-pos-item-action"
          title="Click to reset coordinates"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.stopPropagation()
            animateCameraResetTo({ x: 0, y: 0 })
          }}
        >
          X {camera.x.toFixed(1)}
        </span>
        <span
          className="camera-pos-item camera-pos-item-action"
          title="Click to reset coordinates"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.stopPropagation()
            animateCameraResetTo({ x: 0, y: 0 })
          }}
        >
          Y {camera.y.toFixed(1)}
        </span>
        <span
          className="camera-pos-item camera-pos-item-action"
          title="Click to reset zoom"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.stopPropagation()
            animateCameraResetTo({ zoom: 1 })
          }}
        >
          <FontAwesomeIcon icon={faMagnifyingGlass} />
          {camera.zoom.toFixed(2)}
        </span>
        <span
          className="camera-pos-item camera-pos-item-action"
          title="Click to reset angle"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.stopPropagation()
            animateCameraResetTo({ rotation: 0 })
          }}
        >
          <FontAwesomeIcon icon={faCompass} />
          {((camera.rotation * 180) / Math.PI).toFixed(1)}°
        </span>
      </div>

      {targetDisplayPortalNode
        ? createPortal(
          <div
            className="target-display-card target-display-card-panel"
            aria-label="Target display ratio"
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onContextMenu={(event) => {
              event.stopPropagation()
            }}
            onWheel={(event) => {
              event.stopPropagation()
            }}
          >
            <div className="target-display-card-controls">
              <span className="target-display-card-label">Target frame</span>
              <select
                className="target-display-select"
                value={targetDisplayPreset}
                onChange={(event) => {
                  setTargetDisplayPreset(event.target.value as TargetDisplayPreset)
                }}
                aria-label="Target frame"
                title="Target frame"
              >
                {TARGET_DISPLAY_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={`target-display-toggle ${isTargetDisplayOverlayEnabled ? 'active' : ''}`}
                onClick={() => {
                  setIsTargetDisplayOverlayEnabled((current) => !current)
                }}
                aria-label={isTargetDisplayOverlayEnabled ? 'Hide target frame' : 'Show target frame'}
                title={isTargetDisplayOverlayEnabled ? 'Hide target frame' : 'Show target frame'}
              >
                <FontAwesomeIcon icon={isTargetDisplayOverlayEnabled ? faEye : faEyeSlash} />
              </button>
              <button
                type="button"
                className={`camera-control-btn ${targetDisplayOrientation === 'portrait' ? 'active' : ''}`}
                onClick={() => {
                  setTargetDisplayOrientation((current) =>
                    current === 'landscape' ? 'portrait' : 'landscape'
                  )
                }}
                aria-label={`Switch target display to ${targetDisplayOrientation === 'landscape' ? 'portrait' : 'landscape'}`}
                title={`Switch to ${targetDisplayOrientation === 'landscape' ? 'portrait' : 'landscape'}`}
              >
                <FontAwesomeIcon
                  icon={faMobileScreenButton}
                  style={{ transform: targetDisplayOrientation === 'landscape' ? 'rotate(90deg)' : 'rotate(0deg)' }}
                />
              </button>
            </div>
          </div>,
          targetDisplayPortalNode
        )
        : null}
    </div>
  )
}
