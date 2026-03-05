import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowsUpDownLeftRight,
  faCircle,
  faDice,
  faFileArrowDown,
  faFileCirclePlus,
  faFileExport,
  faFileImport,
  faForwardStep,
  faGripVertical,
  faImage,
  faLayerGroup,
  faLock,
  faLockOpen,
  faObjectUngroup,
  faPenToSquare,
  faPlay,
  faPlus,
  faRotateLeft,
  faSquare,
  faTrashCan,
  faUndo,
} from '@fortawesome/free-solid-svg-icons'
import { CanvasViewport } from './canvas'
import {
  deserializeDocument,
  serializeDocument,
  type CanvasObject,
  type DocumentModel,
  type FillMode,
  type FillGradient,
  type FillGradientStop,
  type ImageData,
  type ShapeData,
  type Slide,
  type TextboxData,
} from './model'
import {
  buildPresentationExportHtml,
} from './persistence'
import { resolveTransitionDurationMs, resolveTransitionProgress } from './presentation'
import { useEditorStore } from './store'
import type { CameraState } from './store/types'
import { resolveTextboxRichHtml } from './textboxRichText'
import {
  SUPPORTED_IMAGE_ACCEPT,
  getImageDimensions,
  isSupportedImageFile,
  readFileAsDataUrl,
  toAssetBase64,
} from './imageFile'
import './App.css'

function SortableSlideItem({
  slide,
  isActive,
  onClick,
  onHoverChange,
  onUpdate,
  onDelete,
}: {
  slide: Slide
  isActive: boolean
  onClick: () => void
  onHoverChange: (isHovered: boolean) => void
  onUpdate: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slide.id,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`slide-item ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''}`}
      {...attributes}
      {...listeners}
      title="Drag to reorder"
      onClick={onClick}
      onPointerEnter={() => onHoverChange(true)}
      onPointerLeave={() => onHoverChange(false)}
    >
      <span className="slide-item-name">{slide.name || `Slide ${slide.orderIndex + 1}`}</span>
      {isActive && (
        <span className="slide-item-actions">
          <button
            type="button"
            className="icon-btn slide-item-action-btn"
            aria-label="Update slide"
            title="Update selected slide from current camera"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onUpdate()
            }}
          >
            <FontAwesomeIcon icon={faRotateLeft} />
          </button>
          <button
            type="button"
            className="icon-btn slide-item-action-btn danger"
            aria-label="Delete slide"
            title="Delete selected slide"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onDelete()
            }}
          >
            <FontAwesomeIcon icon={faTrashCan} />
          </button>
        </span>
      )}
    </li>
  )
}

function rotatePoint(point: { x: number; y: number }, radians: number) {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }
}

function worldToScreenPresent(
  world: { x: number; y: number },
  camera: CameraState,
  viewport: { width: number; height: number }
) {
  const translated = {
    x: (world.x - camera.x) * camera.zoom,
    y: (world.y - camera.y) * camera.zoom,
  }
  const rotated = rotatePoint(translated, camera.rotation)
  return {
    x: rotated.x + viewport.width / 2,
    y: rotated.y + viewport.height / 2,
  }
}

function toFiniteNumber(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

function asHexColor(value: string, fallback = '#0f1523') {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

function hexToRgb(color: string): { r: number; g: number; b: number } | null {
  const normalized = asHexColor(color, '')
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return null
  }
  const hex = normalized.slice(1)
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  }
}

function rgbToHue(r: number, g: number, b: number): number {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  if (delta === 0) {
    return 0
  }
  let hue = 0
  if (max === rn) {
    hue = ((gn - bn) / delta) % 6
  } else if (max === gn) {
    hue = (bn - rn) / delta + 2
  } else {
    hue = (rn - gn) / delta + 4
  }
  const degrees = hue * 60
  return (degrees + 360) % 360
}

function getHueFromHexColor(color: string): number | null {
  const rgb = hexToRgb(color)
  if (!rgb) {
    return null
  }
  return rgbToHue(rgb.r, rgb.g, rgb.b)
}

function hslToHex(hueDeg: number, saturationPercent: number, lightnessPercent: number): string {
  const h = ((hueDeg % 360) + 360) % 360
  const s = Math.max(0, Math.min(1, saturationPercent / 100))
  const l = Math.max(0, Math.min(1, lightnessPercent / 100))
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - chroma / 2
  let rPrime = 0
  let gPrime = 0
  let bPrime = 0

  if (h < 60) {
    rPrime = chroma
    gPrime = x
  } else if (h < 120) {
    rPrime = x
    gPrime = chroma
  } else if (h < 180) {
    gPrime = chroma
    bPrime = x
  } else if (h < 240) {
    gPrime = x
    bPrime = chroma
  } else if (h < 300) {
    rPrime = x
    bPrime = chroma
  } else {
    rPrime = chroma
    bPrime = x
  }

  const toHex = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0')

  return `#${toHex(rPrime)}${toHex(gPrime)}${toHex(bPrime)}`
}

function getCircularHueDistanceDeg(a: number, b: number): number {
  const delta = Math.abs(a - b) % 360
  return Math.min(delta, 360 - delta)
}

function pickGradientStopHue(existingHues: number[], minSeparationDeg: number): number {
  if (existingHues.length === 0) {
    return Math.random() * 360
  }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = Math.random() * 360
    const isFarEnough = existingHues.every(
      (existingHue) => getCircularHueDistanceDeg(candidate, existingHue) >= minSeparationDeg
    )
    if (isFarEnough) {
      return candidate
    }
  }

  // Fallback: maximize minimum distance if strict threshold is not possible.
  let bestHue = 0
  let bestDistance = -1
  for (let candidate = 0; candidate < 360; candidate += 1) {
    const minDistanceToExisting = existingHues.reduce(
      (minDistance, existingHue) =>
        Math.min(minDistance, getCircularHueDistanceDeg(candidate, existingHue)),
      Number.POSITIVE_INFINITY
    )
    if (minDistanceToExisting > bestDistance) {
      bestDistance = minDistanceToExisting
      bestHue = candidate
    }
  }
  return bestHue
}

function getRandomGradientStopColor(existingColors: string[]): string {
  const existingHues = existingColors
    .map((color) => getHueFromHexColor(color))
    .filter((hue): hue is number => hue !== null)
  const hue = pickGradientStopHue(existingHues, MIN_GRADIENT_HUE_SEPARATION_DEG)
  return hslToHex(hue, 74, 56)
}

function normalizeGradientStops(
  stops: FillGradientStop[] | undefined,
  fallbackStartColor: string,
  fallbackEndColor: string
): FillGradientStop[] {
  const clampPercent = (value: number, fallback: number) =>
    Math.max(0, Math.min(100, Math.round(toFiniteNumber(value, fallback))))
  const getDefaultXPercent = (index: number, count: number) => {
    if (count <= 1) {
      return 50
    }
    return clampPercent((index / (count - 1)) * 100, 50)
  }
  const getDefaultYPercent = (index: number, count: number) => {
    if (count <= 1) {
      return 50
    }
    const phase = (index / count) * Math.PI * 2
    return clampPercent(50 + Math.sin(phase) * 22, 50)
  }

  const source =
    Array.isArray(stops) && stops.length >= 2
      ? stops
      : [
          { color: fallbackStartColor, positionPercent: 0 },
          { color: fallbackEndColor, positionPercent: 100 },
        ]
  const normalized = source
    .map((stop, index) => ({
      color: asHexColor(stop.color, index === 0 ? fallbackStartColor : fallbackEndColor),
      positionPercent: clampPercent(stop.positionPercent, index * 100),
      xPercent:
        stop.xPercent === undefined
          ? getDefaultXPercent(index, source.length)
          : clampPercent(stop.xPercent, getDefaultXPercent(index, source.length)),
      yPercent:
        stop.yPercent === undefined
          ? getDefaultYPercent(index, source.length)
          : clampPercent(stop.yPercent, getDefaultYPercent(index, source.length)),
    }))
    .sort((a, b) => a.positionPercent - b.positionPercent)
  return normalized.slice(0, 5)
}

function buildGradientCss(
  gradient: FillGradient,
  fallbackStartColor: string,
  fallbackEndColor: string
): string {
  const stops = normalizeGradientStops(
    gradient.stops,
    gradient.colorA || fallbackStartColor,
    gradient.colorB || fallbackEndColor
  )
  const stopList = stops.map((stop) => `${stop.color} ${stop.positionPercent}%`).join(', ')
  const gradientType =
    gradient.gradientType === 'radial' || gradient.gradientType === 'circles'
      ? gradient.gradientType
      : 'linear'
  if (gradientType === 'radial') {
    return `radial-gradient(circle, ${stopList})`
  }
  if (gradientType === 'circles') {
    const circles = stops
      .map((stop) => {
        const xPercent = Math.max(0, Math.min(100, Math.round(toFiniteNumber(stop.xPercent ?? 50, 50))))
        const yPercent = Math.max(0, Math.min(100, Math.round(toFiniteNumber(stop.yPercent ?? 50, 50))))
        const radiusPercent = Math.max(8, Math.min(100, Math.round(toFiniteNumber(stop.positionPercent, 42))))
        return `radial-gradient(circle at ${xPercent}% ${yPercent}%, ${stop.color} 0%, transparent ${radiusPercent}%)`
      })
      .join(', ')
    const baseColor = asHexColor(gradient.colorB || fallbackEndColor, fallbackEndColor)
    return `${circles}, ${baseColor}`
  }
  const angleDeg = Math.max(-180, Math.min(180, Math.round(toFiniteNumber(gradient.angleDeg, 45))))
  return `linear-gradient(${angleDeg}deg, ${stopList})`
}

function buildGradientTrackCss(
  gradient: FillGradient,
  fallbackStartColor: string,
  fallbackEndColor: string
): string {
  const stops = normalizeGradientStops(
    gradient.stops,
    gradient.colorA || fallbackStartColor,
    gradient.colorB || fallbackEndColor
  )
  const stopList = stops.map((stop) => `${stop.color} ${stop.positionPercent}%`).join(', ')
  // Editing track should stay horizontal and linear for consistent stop placement.
  return `linear-gradient(90deg, ${stopList})`
}

function normalizeFillGradient(
  gradient: FillGradient | null | undefined,
  fallbackStartColor: string,
  fallbackEndColor: string
): FillGradient {
  const start = asHexColor(fallbackStartColor, '#244a80')
  const end = asHexColor(fallbackEndColor, '#ffffff')
  const rawStops = normalizeGradientStops(gradient?.stops, gradient?.colorA ?? start, gradient?.colorB ?? end)
  const firstStop = rawStops[0] ?? { color: start, positionPercent: 0 }
  const lastStop = rawStops[rawStops.length - 1] ?? { color: end, positionPercent: 100 }
  return {
    colorA: firstStop.color,
    colorB: lastStop.color,
    angleDeg: Math.max(-180, Math.min(180, Math.round(toFiniteNumber(gradient?.angleDeg ?? 45, 45)))),
    gradientType:
      gradient?.gradientType === 'radial' || gradient?.gradientType === 'circles' ? gradient.gradientType : 'linear',
    stops: rawStops,
  }
}

function getShapeBackground(shapeData: ShapeData): string {
  if (shapeData.fillMode === 'linearGradient' && shapeData.fillGradient) {
    const gradient = normalizeFillGradient(shapeData.fillGradient, shapeData.fillColor, '#ffffff')
    return buildGradientCss(gradient, shapeData.fillColor, '#ffffff')
  }
  return shapeData.fillColor
}

function getTextboxBackground(textboxData: TextboxData): string {
  if (textboxData.fillMode === 'linearGradient' && textboxData.fillGradient) {
    const gradient = normalizeFillGradient(
      textboxData.fillGradient,
      textboxData.backgroundColor || DEFAULT_TEXTBOX_BACKGROUND,
      '#ffffff'
    )
    return buildGradientCss(gradient, textboxData.backgroundColor || DEFAULT_TEXTBOX_BACKGROUND, '#ffffff')
  }
  return textboxData.backgroundColor || DEFAULT_TEXTBOX_BACKGROUND
}

function parseGradientStopsFromCss(rawStops: string): FillGradientStop[] | null {
  const tokens = rawStops
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  if (tokens.length < 2) {
    return null
  }

  const parsed = tokens.map((token, index) => {
    const match = token.match(/^(#[0-9a-fA-F]{6})(?:\s+(-?\d+(?:\.\d+)?)%)?$/)
    if (!match) {
      return null
    }
    const color = asHexColor(match[1], index === 0 ? '#1f365a' : '#0f1523')
    const parsedPosition = match[2] === undefined ? null : Number.parseFloat(match[2])
    return {
      color,
      positionPercent: Number.isFinite(parsedPosition) ? parsedPosition : null,
    }
  })
  if (parsed.some((entry) => entry === null)) {
    return null
  }

  const safeParsed = parsed as Array<{ color: string; positionPercent: number | null }>
  const fallbackDenominator = Math.max(1, safeParsed.length - 1)
  return safeParsed.map((entry, index) => ({
    color: entry.color,
    positionPercent:
      entry.positionPercent === null ? Math.round((index * 100) / fallbackDenominator) : entry.positionPercent,
  }))
}

function parseCanvasBackgroundGradient(background: string): FillGradient | null {
  const trimmed = background.trim()
  if (trimmed.length === 0) {
    return null
  }

  const circleLayerRegex =
    /radial-gradient\(circle at\s*([0-9]+(?:\.[0-9]+)?)%\s+([0-9]+(?:\.[0-9]+)?)%,\s*(#[0-9a-fA-F]{6})\s+0%,\s*transparent\s+([0-9]+(?:\.[0-9]+)?)%\)/g
  const circlesMatches = [...trimmed.matchAll(circleLayerRegex)]
  if (circlesMatches.length >= 2) {
    const circlesPrefix = circlesMatches.map((match) => match[0]).join(', ')
    if (trimmed === circlesPrefix || trimmed.startsWith(`${circlesPrefix}, `)) {
      const trailing = trimmed.slice(circlesPrefix.length).replace(/^,\s*/, '').trim()
      const baseColor = asHexColor(trailing, '#0f1523')
      const circlesStops = circlesMatches.map((match) => ({
        color: asHexColor(match[3], '#1f365a'),
        positionPercent: Math.max(0, Math.min(100, Number.parseFloat(match[4]))),
        xPercent: Math.max(0, Math.min(100, Number.parseFloat(match[1]))),
        yPercent: Math.max(0, Math.min(100, Number.parseFloat(match[2]))),
      }))
      const first = circlesStops[0]
      const last = circlesStops[circlesStops.length - 1]
      return normalizeFillGradient(
        {
          colorA: first?.color ?? '#1f365a',
          colorB: asHexColor(last?.color ?? baseColor, baseColor),
          angleDeg: 45,
          gradientType: 'circles',
          stops: circlesStops,
        },
        first?.color ?? '#1f365a',
        baseColor
      )
    }
  }

  const linearMatch = trimmed.match(/^linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg\s*,\s*(.+)\)$/i)
  if (linearMatch) {
    const parsedStops = parseGradientStopsFromCss(linearMatch[2])
    if (!parsedStops || parsedStops.length < 2) {
      return null
    }
    const first = parsedStops[0]
    const last = parsedStops[parsedStops.length - 1]
    return normalizeFillGradient(
      {
        colorA: first?.color ?? '#1f365a',
        colorB: last?.color ?? '#0f1523',
        angleDeg: Number.parseFloat(linearMatch[1]),
        gradientType: 'linear',
        stops: parsedStops,
      },
      first?.color ?? '#1f365a',
      last?.color ?? '#0f1523'
    )
  }

  const radialMatch = trimmed.match(/^radial-gradient\(\s*(?:circle(?:\s+at\s+[^,]+)?\s*,\s*)?(.+)\)$/i)
  if (radialMatch) {
    const parsedStops = parseGradientStopsFromCss(radialMatch[1])
    if (!parsedStops || parsedStops.length < 2) {
      return null
    }
    const first = parsedStops[0]
    const last = parsedStops[parsedStops.length - 1]
    return normalizeFillGradient(
      {
        colorA: first?.color ?? '#1f365a',
        colorB: last?.color ?? '#0f1523',
        angleDeg: 45,
        gradientType: 'radial',
        stops: parsedStops,
      },
      first?.color ?? '#1f365a',
      last?.color ?? '#0f1523'
    )
  }

  return null
}

function radiusPxToPercent(radiusPx: number, width: number, height: number): number {
  const halfMinSide = Math.max(0.0001, Math.min(width, height) / 2)
  return Math.max(0, Math.min(MAX_RADIUS_PERCENT, (Math.max(0, radiusPx) / halfMinSide) * 100))
}

function radiusPercentToPx(radiusPercent: number, width: number, height: number): number {
  const halfMinSide = Math.max(0.0001, Math.min(width, height) / 2)
  const clampedPercent = Math.max(0, Math.min(MAX_RADIUS_PERCENT, radiusPercent))
  return (clampedPercent / 100) * halfMinSide
}

const DEFAULT_TEXTBOX_BACKGROUND = '#1f3151'
const DEFAULT_TEXTBOX_BORDER_COLOR = '#b2c6ee'
const DEFAULT_TEXTBOX_BORDER_WIDTH = 1
const MAX_SHAPE_RADIUS = 1000
const MAX_RADIUS_PERCENT = 100
const MAX_GRADIENT_STOPS = 5
const MIN_GRADIENT_HUE_SEPARATION_DEG = 108
const GRADIENT_ANGLE_PRESETS = [
  { label: '↑', angleDeg: 0 },
  { label: '↗', angleDeg: 45 },
  { label: '→', angleDeg: 90 },
  { label: '↘', angleDeg: 135 },
  { label: '↓', angleDeg: 180 },
  { label: '↙', angleDeg: -135 },
  { label: '←', angleDeg: -90 },
  { label: '↖', angleDeg: -45 },
]

function PresentStage({ model, slide }: { model: DocumentModel; slide: Slide | null }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const objectsLayerRef = useRef<HTMLDivElement>(null)
  const animationFrameRef = useRef<number | null>(null)
  const [viewport, setViewport] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  })

  useEffect(() => {
    const element = stageRef.current
    if (!element) {
      return
    }

    const updateViewport = () => {
      setViewport({
        width: element.clientWidth,
        height: element.clientHeight,
      })
    }

    updateViewport()
    const resizeObserver = new ResizeObserver(updateViewport)
    resizeObserver.observe(element)
    window.addEventListener('resize', updateViewport)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateViewport)
    }
  }, [])

  const targetCamera = slide
    ? {
        x: toFiniteNumber(slide.x, 0),
        y: toFiniteNumber(slide.y, 0),
        zoom: Math.min(100, Math.max(0.01, toFiniteNumber(slide.zoom, 1))),
        rotation: toFiniteNumber(slide.rotation, 0),
      }
    : { x: 0, y: 0, zoom: 1, rotation: 0 }
  const currentCameraRef = useRef<CameraState>(targetCamera)
  const [renderCamera, setRenderCamera] = useState<CameraState>(targetCamera)
  const safeViewport =
    viewport.width > 0 && viewport.height > 0
      ? viewport
      : {
          width: typeof window === 'undefined' ? 1 : window.innerWidth,
          height: typeof window === 'undefined' ? 1 : window.innerHeight,
        }

  useEffect(() => {
    currentCameraRef.current = renderCamera
  }, [renderCamera])

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    const transitionType = slide?.transitionType ?? 'instant'
    const durationMs = slide
      ? resolveTransitionDurationMs(slide.transitionType, slide.transitionDurationMs)
      : 0
    const startCamera = currentCameraRef.current
    const endCamera = targetCamera
    const hasCameraChange =
      startCamera.x !== endCamera.x ||
      startCamera.y !== endCamera.y ||
      startCamera.zoom !== endCamera.zoom ||
      startCamera.rotation !== endCamera.rotation

    if (!hasCameraChange || transitionType === 'instant' || durationMs <= 0) {
      currentCameraRef.current = endCamera
      setRenderCamera(endCamera)
      return
    }

    const startedAtMs = performance.now()
    const tick = (nowMs: number) => {
      const rawProgress = (nowMs - startedAtMs) / durationMs
      const progress = Math.max(0, Math.min(1, rawProgress))
      const eased = resolveTransitionProgress(transitionType, progress)
      const nextCamera = interpolateCamera(startCamera, endCamera, eased)
      currentCameraRef.current = nextCamera
      setRenderCamera(nextCamera)
      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(tick)
      } else {
        animationFrameRef.current = null
      }
    }

    animationFrameRef.current = requestAnimationFrame(tick)
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [
    slide?.transitionDurationMs,
    slide?.transitionType,
    targetCamera.rotation,
    targetCamera.x,
    targetCamera.y,
    targetCamera.zoom,
  ])

  useEffect(() => {
    const objectsLayer = objectsLayerRef.current
    if (!objectsLayer) {
      return
    }

    objectsLayer.innerHTML = ''
    const dom = objectsLayer.ownerDocument
    const assetById = new Map(model.assets.map((asset) => [asset.id, asset]))
    const orderedObjects = [...model.objects]
      .sort((a, b) => a.zIndex - b.zIndex)
      .filter((object) => object.type !== 'group')

    for (const object of orderedObjects) {
      const objectX = toFiniteNumber(object.x, 0)
      const objectY = toFiniteNumber(object.y, 0)
      const objectW = Math.max(1, toFiniteNumber(object.w, 1))
      const objectH = Math.max(1, toFiniteNumber(object.h, 1))
      const objectRotation = toFiniteNumber(object.rotation, 0)

      const center = worldToScreenPresent({ x: objectX, y: objectY }, renderCamera, safeViewport)
      const width = Math.max(1, objectW * renderCamera.zoom)
      const height = Math.max(1, objectH * renderCamera.zoom)

      if (
        !Number.isFinite(center.x) ||
        !Number.isFinite(center.y) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height)
      ) {
        continue
      }

      const element = dom.createElement('div')
      element.className = `present-object ${object.type}`
      element.style.left = `${center.x - width / 2}px`
      element.style.top = `${center.y - height / 2}px`
      element.style.width = `${width}px`
      element.style.height = `${height}px`
      element.style.transform = `rotate(${objectRotation + renderCamera.rotation}rad)`

      if (object.type === 'shape_rect' || object.type === 'shape_circle' || object.type === 'shape_arrow') {
        const borderWidth = Math.max(0, toFiniteNumber(object.shapeData.borderWidth, 1))
        const radiusPx =
          Math.max(0, Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(object.shapeData.radius, 0))) * renderCamera.zoom
        element.style.borderWidth = `${borderWidth * renderCamera.zoom}px`
        element.style.borderStyle = object.shapeData.borderType
        element.style.borderColor = object.shapeData.borderColor
        element.style.background = getShapeBackground(object.shapeData)
        element.style.opacity = `${Math.max(0, Math.min(100, object.shapeData.opacityPercent)) / 100}`
        element.style.borderRadius = object.type === 'shape_circle' ? '999px' : `${radiusPx}px`
        if (object.type === 'shape_arrow') {
          element.textContent = '→'
          element.style.fontSize = `${Math.max(14, 24 * renderCamera.zoom)}px`
          element.style.display = 'grid'
          element.style.placeItems = 'center'
        }
      } else if (object.type === 'image') {
        const imageBorderWidth = Math.max(0, toFiniteNumber(object.imageData.borderWidth, 0))
        const imageOpacity = Math.max(0, Math.min(100, toFiniteNumber(object.imageData.opacityPercent, 100))) / 100
        const imageRadiusPx =
          Math.max(0, Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(object.imageData.radius, 0))) * renderCamera.zoom
        element.style.borderWidth = `${imageBorderWidth * renderCamera.zoom}px`
        element.style.borderStyle = object.imageData.borderType
        element.style.borderColor = object.imageData.borderColor
        element.style.borderRadius = `${imageRadiusPx}px`
        element.style.opacity = `${imageOpacity}`
        element.style.background = 'transparent'
        const asset = assetById.get(object.imageData.assetId)
        if (asset) {
          const image = dom.createElement('img')
          image.src = `data:${asset.mimeType};base64,${asset.dataBase64}`
          image.alt = ''
          image.style.width = `${Math.max(1, width)}px`
          image.style.height = `${Math.max(1, height)}px`
          image.style.objectFit = 'fill'
          const cropIsApplied =
            object.imageData.cropLeftPercent > 0.01 ||
            object.imageData.cropTopPercent > 0.01 ||
            object.imageData.cropRightPercent > 0.01 ||
            object.imageData.cropBottomPercent > 0.01
          image.style.clipPath = cropIsApplied
            ? `inset(${object.imageData.cropTopPercent}% ${object.imageData.cropRightPercent}% ${object.imageData.cropBottomPercent}% ${object.imageData.cropLeftPercent}%)`
            : 'none'
          image.draggable = false
          element.appendChild(image)
        }
      } else if (object.type === 'textbox') {
        const borderWidth = Math.max(
          0,
          toFiniteNumber(object.textboxData.borderWidth, DEFAULT_TEXTBOX_BORDER_WIDTH)
        )
        element.style.borderWidth = `${borderWidth * renderCamera.zoom}px`
        element.style.borderStyle = object.textboxData.borderType
        element.style.borderColor = object.textboxData.borderColor
        element.style.background = getTextboxBackground(object.textboxData)
        element.style.opacity = `${
          Math.max(0, Math.min(100, toFiniteNumber(object.textboxData.opacityPercent, 100))) / 100
        }`
        const richContent = dom.createElement('div')
        richContent.className = 'present-textbox-content textbox-rich-content'
        richContent.style.transform = `scale(${Math.max(0.01, renderCamera.zoom)})`
        richContent.style.transformOrigin = 'top left'
        richContent.style.width = `${100 / Math.max(0.01, renderCamera.zoom)}%`
        richContent.style.height = `${100 / Math.max(0.01, renderCamera.zoom)}%`
        richContent.style.fontFamily = object.textboxData.fontFamily
        richContent.innerHTML = resolveTextboxRichHtml(object.textboxData)
        element.appendChild(richContent)
      }

      objectsLayer.appendChild(element)
    }
  }, [model.assets, model.objects, renderCamera, safeViewport])
  const safeZoom = Math.max(0.01, toFiniteNumber(renderCamera.zoom, 1))
  const backgroundLayerWidth = Math.max(1, safeViewport.width) * 3
  const backgroundLayerHeight = Math.max(1, safeViewport.height) * 3
  const backgroundLayerStyle: CSSProperties = {
    background: model.canvas.background,
    width: `${backgroundLayerWidth}px`,
    height: `${backgroundLayerHeight}px`,
    backgroundPosition: `${-renderCamera.x * safeZoom}px ${-renderCamera.y * safeZoom}px`,
    transform: `translate(-50%, -50%) rotate(${renderCamera.rotation}rad)`,
  }

  return (
    <div ref={stageRef} className="present-stage">
      <div className="present-stage-background" style={backgroundLayerStyle} />
      <div ref={objectsLayerRef} className="present-stage-objects" />
    </div>
  )
}

function parseCameraState(value: unknown): CameraState | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const entry = value as Partial<CameraState>
  if (
    typeof entry.x !== 'number' ||
    typeof entry.y !== 'number' ||
    typeof entry.zoom !== 'number' ||
    typeof entry.rotation !== 'number'
  ) {
    return null
  }

  if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y) || !Number.isFinite(entry.rotation)) {
    return null
  }
  if (!Number.isFinite(entry.zoom) || entry.zoom <= 0) {
    return null
  }

  return {
    x: entry.x,
    y: entry.y,
    zoom: entry.zoom,
    rotation: entry.rotation,
  }
}

function parseStoredFile(payload: string): { document: DocumentModel; camera: CameraState | null } {
  const parsed = JSON.parse(payload) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid file payload')
  }

  const entry = parsed as Record<string, unknown>
  if ('document' in entry) {
    return {
      document: deserializeDocument(JSON.stringify(entry.document)),
      camera: parseCameraState(entry.camera),
    }
  }

  return {
    document: deserializeDocument(payload),
    camera: null,
  }
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

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

const AUTOSAVE_LATEST_KEY = 'infiniprez.autosave.latest'
const AUTOSAVE_BACKUPS_KEY = 'infiniprez.autosave.backups'
const AUTOSAVE_BACKUP_LIMIT = 200
const BORDER_WIDTH_OPTIONS = [0, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20] as const
const BORDER_STYLE_OPTIONS: Array<{
  value: ShapeData['borderType']
  label: string
}> = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
]

interface AutosavePayload {
  snapshot: string
  savedAt: string
}

function readLatestAutosavePayload(): AutosavePayload | null {
  try {
    const raw = window.localStorage.getItem(AUTOSAVE_LATEST_KEY)
    if (!raw) {
      return null
    }
    const payload = JSON.parse(raw) as Partial<AutosavePayload>
    if (!payload || typeof payload.snapshot !== 'string' || typeof payload.savedAt !== 'string') {
      return null
    }
    return {
      snapshot: payload.snapshot,
      savedAt: payload.savedAt,
    }
  } catch {
    return null
  }
}

function interpolateCamera(start: CameraState, end: CameraState, t: number): CameraState {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    zoom: start.zoom + (end.zoom - start.zoom) * t,
    rotation: start.rotation + (end.rotation - start.rotation) * t,
  }
}

function getBorderWidthLabel(width: number): string {
  if (width <= 0) {
    return 'None'
  }
  return `${width}px`
}

function ColorPickerChip({
  value,
  fallback,
  disabled,
  onChange,
  className = 'object-param-color-chip',
  ariaLabel,
  title,
  style,
}: {
  value: string
  fallback: string
  disabled: boolean
  onChange: (nextValue: string) => void
  className?: string
  ariaLabel: string
  title?: string
  style?: CSSProperties
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const safeValue = asHexColor(value, fallback)

  return (
    <>
      <button
        type="button"
        className={className}
        style={{ background: safeValue, ...style }}
        disabled={disabled}
        onClick={() => {
          inputRef.current?.click()
        }}
        aria-label={ariaLabel}
        title={title}
      />
      <input
        ref={inputRef}
        type="color"
        className="object-param-color-input-hidden"
        value={safeValue}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => onChange(event.target.value)}
      />
    </>
  )
}

function SortableGradientStopItem({
  sortableId,
  stop,
  index,
  minPosition,
  maxPosition,
  canRemove,
  disabled,
  onWheel,
  onChangeColor,
  onChangePosition,
  onRemove,
}: {
  sortableId: string
  stop: FillGradientStop
  index: number
  minPosition: number
  maxPosition: number
  canRemove: boolean
  disabled: boolean
  onWheel: (event: WheelEvent<HTMLInputElement>) => void
  onChangeColor: (index: number, color: string) => void
  onChangePosition: (index: number, positionPercent: number) => void
  onRemove: (index: number) => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    disabled,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  const clampedMaxPosition = Math.max(minPosition, maxPosition)

  return (
    <div ref={setNodeRef} style={style} className={`object-gradient-stop-item ${isDragging ? 'dragging' : ''}`}>
      <div className="object-gradient-stop-item-controls">
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="icon-btn object-gradient-stop-drag-handle"
          disabled={disabled}
          aria-label={`Drag color ${index + 1}`}
          title="Drag to reorder color stop"
          {...attributes}
          {...listeners}
        >
          <FontAwesomeIcon icon={faGripVertical} />
        </button>
        <ColorPickerChip
          value={stop.color}
          fallback="#244a80"
          disabled={disabled}
          onChange={(nextColor) => onChangeColor(index, nextColor)}
          ariaLabel={`Gradient color ${index + 1}`}
          title={`Gradient color ${index + 1}`}
        />
        <input
          type="range"
          min={minPosition}
          max={clampedMaxPosition}
          step={1}
          value={stop.positionPercent}
          disabled={disabled}
          onWheel={onWheel}
          onChange={(event) => {
            const parsed = Number.parseFloat(event.target.value)
            if (Number.isFinite(parsed)) {
              onChangePosition(index, parsed)
            }
          }}
        />
        <input
          type="number"
          className="object-gradient-stop-position-input"
          min={minPosition}
          max={clampedMaxPosition}
          step={1}
          value={stop.positionPercent}
          disabled={disabled}
          onChange={(event) => {
            const parsed = Number.parseFloat(event.target.value)
            if (Number.isFinite(parsed)) {
              onChangePosition(index, parsed)
            }
          }}
          aria-label={`Color ${index + 1} position`}
          title={`Color ${index + 1} position`}
        />
        {canRemove && (
          <button
            type="button"
            className="object-param-secondary-btn object-gradient-stop-remove-btn"
            disabled={disabled}
            onClick={() => onRemove(index)}
            title="Remove color stop"
            aria-label="Remove color stop"
          >
            <FontAwesomeIcon icon={faTrashCan} />
          </button>
        )}
      </div>
    </div>
  )
}

function BorderWidthDropdown({
  value,
  borderColor,
  disabled,
  onChange,
}: {
  value: number
  borderColor: string
  disabled: boolean
  onChange: (nextValue: number) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && rootRef.current?.contains(target)) {
        return
      }
      setIsOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [isOpen])

  useEffect(() => {
    if (disabled && isOpen) {
      setIsOpen(false)
    }
  }, [disabled, isOpen])

  return (
    <div ref={rootRef} className={`custom-dropdown ${isOpen ? 'open' : ''}`}>
      <button
        type="button"
        className="custom-dropdown-trigger"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="custom-dropdown-preview">
          <span
            className={`custom-border-line width-preview ${value <= 0 ? 'none' : ''}`}
            style={{
              borderTopColor: borderColor,
              borderTopStyle: 'solid',
              borderTopWidth: `${Math.max(1, value)}px`,
            }}
          />
          <span>{getBorderWidthLabel(value)}</span>
        </span>
        <span className="custom-dropdown-arrow">▼</span>
      </button>
      {isOpen && (
        <div className="custom-dropdown-menu" role="listbox" aria-label="Border width">
          {BORDER_WIDTH_OPTIONS.map((entry) => (
            <button
              key={entry}
              type="button"
              className={`custom-dropdown-option ${entry === value ? 'active' : ''}`}
              onClick={() => {
                onChange(entry)
                setIsOpen(false)
              }}
            >
              <span className="custom-dropdown-preview">
                <span
                  className={`custom-border-line width-preview ${entry <= 0 ? 'none' : ''}`}
                  style={{
                    borderTopColor: borderColor,
                    borderTopStyle: 'solid',
                    borderTopWidth: `${Math.max(1, entry)}px`,
                  }}
                />
                <span>{getBorderWidthLabel(entry)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function BorderStyleDropdown({
  value,
  borderColor,
  borderWidth,
  disabled,
  onChange,
}: {
  value: ShapeData['borderType']
  borderColor: string
  borderWidth: number
  disabled: boolean
  onChange: (nextValue: ShapeData['borderType']) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedLabel = BORDER_STYLE_OPTIONS.find((entry) => entry.value === value)?.label ?? 'Solid'

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && rootRef.current?.contains(target)) {
        return
      }
      setIsOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [isOpen])

  useEffect(() => {
    if (disabled && isOpen) {
      setIsOpen(false)
    }
  }, [disabled, isOpen])

  return (
    <div ref={rootRef} className={`custom-dropdown ${isOpen ? 'open' : ''}`}>
      <button
        type="button"
        className="custom-dropdown-trigger"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="custom-dropdown-preview">
          <span
            className={`custom-border-line ${borderWidth <= 0 ? 'none' : ''}`}
            style={{
              borderTopColor: borderColor,
              borderTopStyle: value,
              borderTopWidth: `${Math.max(1, borderWidth)}px`,
            }}
          />
          <span>{selectedLabel}</span>
        </span>
        <span className="custom-dropdown-arrow">▼</span>
      </button>
      {isOpen && (
        <div className="custom-dropdown-menu" role="listbox" aria-label="Border style">
          {BORDER_STYLE_OPTIONS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              className={`custom-dropdown-option ${entry.value === value ? 'active' : ''}`}
              onClick={() => {
                onChange(entry.value)
                setIsOpen(false)
              }}
            >
              <span className="custom-dropdown-preview">
                <span
                  className={`custom-border-line ${borderWidth <= 0 ? 'none' : ''}`}
                  style={{
                    borderTopColor: borderColor,
                    borderTopStyle: entry.value,
                    borderTopWidth: `${Math.max(1, borderWidth)}px`,
                  }}
                />
                <span>{entry.label}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function App() {
  const loadInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const pendingImagePlacementCameraRef = useRef<CameraState | null>(null)
  const didAttemptAutosaveRestoreRef = useRef(false)
  const latestDocumentSnapshotRef = useRef<string>('')
  const latestAutosavedSnapshotRef = useRef<string>('')

  const document = useEditorStore((state) => state.document)
  const camera = useEditorStore((state) => state.camera)
  const setCamera = useEditorStore((state) => state.setCamera)
  const undo = useEditorStore((state) => state.undo)
  const canUndo = useEditorStore((state) => state.history.past.length > 0)
  const replaceDocument = useEditorStore((state) => state.replaceDocument)
  const resetDocument = useEditorStore((state) => state.resetDocument)
  const mode = useEditorStore((state) => state.ui.mode)
  const setMode = useEditorStore((state) => state.setMode)
  const selectedObjectIds = useEditorStore((state) => state.ui.selectedObjectIds)
  const activeGroupId = useEditorStore((state) => state.ui.activeGroupId)
  const selectObjects = useEditorStore((state) => state.selectObjects)
  const createObject = useEditorStore((state) => state.createObject)
  const createAsset = useEditorStore((state) => state.createAsset)
  const beginCommandBatch = useEditorStore((state) => state.beginCommandBatch)
  const commitCommandBatch = useEditorStore((state) => state.commitCommandBatch)
  const moveObject = useEditorStore((state) => state.moveObject)
  const toggleObjectLock = useEditorStore((state) => state.toggleObjectLock)
  const setCanvasBackground = useEditorStore((state) => state.setCanvasBackground)
  const setTextboxData = useEditorStore((state) => state.setTextboxData)
  const setShapeOpacity = useEditorStore((state) => state.setShapeOpacity)
  const setShapeData = useEditorStore((state) => state.setShapeData)
  const setImageData = useEditorStore((state) => state.setImageData)
  const enterGroup = useEditorStore((state) => state.enterGroup)
  const reorderSlides = useEditorStore((state) => state.reorderSlides)
  const createSlide = useEditorStore((state) => state.createSlide)
  const updateSlide = useEditorStore((state) => state.updateSlide)
  const deleteSlide = useEditorStore((state) => state.deleteSlide)
  const selectSlide = useEditorStore((state) => state.selectSlide)
  const selectedSlideId = useEditorStore((state) => state.ui.selectedSlideId)
  const transitionFrameRef = useRef<number | null>(null)
  const timedAdvanceTimeoutRef = useRef<number | null>(null)
  const gradientTrackRef = useRef<HTMLDivElement | null>(null)
  const gradientPreviewRef = useRef<HTMLDivElement | null>(null)
  const gradientDraggingStopIndexRef = useRef<number | null>(null)
  const gradientPreviewDraggingStopIndexRef = useRef<number | null>(null)
  const [hoveredSlideId, setHoveredSlideId] = useState<string | null>(null)
  const [isFillEditorOpen, setIsFillEditorOpen] = useState(false)
  const [fillEditorTarget, setFillEditorTarget] = useState<'object' | 'canvas' | null>(null)

  const selectedObject =
    selectedObjectIds.length === 1
      ? (document.objects.find((entry) => entry.id === selectedObjectIds[0]) ?? null)
      : null
  const objectById = new Map(document.objects.map((object) => [object.id, object]))
  const selectedShapeObject =
    selectedObject &&
      (selectedObject.type === 'shape_rect' ||
        selectedObject.type === 'shape_circle' ||
        selectedObject.type === 'shape_arrow')
      ? selectedObject
      : null
  const selectedTextboxObject =
    selectedObject && selectedObject.type === 'textbox' ? selectedObject : null
  const selectedImageObject =
    selectedObject && selectedObject.type === 'image' ? selectedObject : null
  const selectedGroupObject =
    selectedObject && selectedObject.type === 'group' ? selectedObject : null
  const selectedObjectLockedByAncestor = selectedObject
    ? hasLockedAncestor(selectedObject, objectById)
    : false
  const canToggleGroupFromSelection = Boolean(selectedGroupObject && activeGroupId === null)
  const orderedSlides = useMemo(
    () => [...document.slides].sort((a, b) => a.orderIndex - b.orderIndex),
    [document.slides]
  )
  const selectedSlide =
    selectedSlideId !== null
      ? (orderedSlides.find((slide) => slide.id === selectedSlideId) ?? null)
      : null
  const activeSlide = selectedSlide ?? orderedSlides[0] ?? null
  const activeSlideId = activeSlide?.id ?? null
  const activeSlideRotationDeg = activeSlide ? (activeSlide.rotation * 180) / Math.PI : 0
  const selectedObjectRotationDeg = selectedObject ? (selectedObject.rotation * 180) / Math.PI : 0
  const selectedObjectTransformLocked = Boolean(
    selectedObject && (selectedObject.locked || selectedObjectLockedByAncestor)
  )
  const isObjectGradientEditorVisible = Boolean(
    isFillEditorOpen &&
      fillEditorTarget === 'object' &&
      ((selectedShapeObject &&
        selectedShapeObject.shapeData.fillMode === 'linearGradient') ||
        (selectedTextboxObject &&
          (selectedTextboxObject.textboxData.fillMode ?? 'solid') === 'linearGradient'))
  )
  const canvasBackgroundGradient = useMemo(
    () => parseCanvasBackgroundGradient(document.canvas.background),
    [document.canvas.background]
  )
  const canvasBackgroundControl = useMemo(() => {
    if (canvasBackgroundGradient) {
      return {
        fillMode: 'linearGradient' as FillMode,
        solidColor: canvasBackgroundGradient.colorA,
        gradient: canvasBackgroundGradient,
      }
    }
    const solidColor = asHexColor(document.canvas.background, '#1f365a')
    return {
      fillMode: 'solid' as FillMode,
      solidColor,
      gradient: normalizeFillGradient(null, solidColor, '#0f1523'),
    }
  }, [canvasBackgroundGradient, document.canvas.background])
  const isCanvasGradientEditorVisible = Boolean(
    isFillEditorOpen &&
      fillEditorTarget === 'canvas' &&
      selectedObjectIds.length === 0 &&
      canvasBackgroundControl.fillMode === 'linearGradient'
  )
  const isGradientEditorVisible = isObjectGradientEditorVisible || isCanvasGradientEditorVisible
  const gradientEditorLocked = isCanvasGradientEditorVisible ? false : selectedObjectTransformLocked
  const selectedTextboxFillMode = selectedTextboxObject?.textboxData.fillMode ?? 'solid'
  const selectedGradientBaseColor =
    isCanvasGradientEditorVisible
      ? canvasBackgroundControl.gradient.colorA
      : selectedShapeObject && selectedShapeObject.shapeData.fillColor !== 'transparent'
        ? selectedShapeObject.shapeData.fillColor
        : selectedTextboxObject && selectedTextboxObject.textboxData.backgroundColor !== 'transparent'
          ? selectedTextboxObject.textboxData.backgroundColor
          : '#244a80'
  const selectedGradient = normalizeFillGradient(
    isCanvasGradientEditorVisible
      ? canvasBackgroundControl.gradient
      : selectedShapeObject?.shapeData.fillGradient ?? selectedTextboxObject?.textboxData.fillGradient ?? null,
    selectedGradientBaseColor,
    '#ffffff'
  )
  const gradientStopUiStateRef = useRef<
    Array<{ uiId: string; color: string; positionPercent: number; xPercent: number; yPercent: number }>
  >([])
  const selectedGradientStopsWithUiIds = useMemo(() => {
    const previous = gradientStopUiStateRef.current
    const usedPreviousIndices = new Set<number>()

    const nextState = selectedGradient.stops.map((stop) => {
      let matchedPreviousIndex = previous.findIndex(
        (entry, index) =>
          !usedPreviousIndices.has(index) &&
          entry.color === stop.color &&
          entry.positionPercent === stop.positionPercent &&
          entry.xPercent === Math.round(toFiniteNumber(stop.xPercent ?? 50, 50)) &&
          entry.yPercent === Math.round(toFiniteNumber(stop.yPercent ?? 50, 50))
      )

      if (matchedPreviousIndex < 0) {
        let closestIndex = -1
        let closestScore = Number.POSITIVE_INFINITY
        for (let index = 0; index < previous.length; index += 1) {
          if (usedPreviousIndices.has(index)) {
            continue
          }
          const entry = previous[index]
          const positionDistance = Math.abs(entry.positionPercent - stop.positionPercent)
          const xDistance = Math.abs(entry.xPercent - toFiniteNumber(stop.xPercent ?? 50, 50))
          const yDistance = Math.abs(entry.yPercent - toFiniteNumber(stop.yPercent ?? 50, 50))
          const colorPenalty = entry.color === stop.color ? 0 : 1_000
          const score = colorPenalty + positionDistance + xDistance + yDistance
          if (score < closestScore) {
            closestScore = score
            closestIndex = index
          }
        }
        matchedPreviousIndex = closestIndex
      }

      if (matchedPreviousIndex >= 0) {
        usedPreviousIndices.add(matchedPreviousIndex)
        const matched = previous[matchedPreviousIndex]
        return {
          uiId: matched.uiId,
          color: stop.color,
          positionPercent: stop.positionPercent,
          xPercent: Math.round(toFiniteNumber(stop.xPercent ?? 50, 50)),
          yPercent: Math.round(toFiniteNumber(stop.yPercent ?? 50, 50)),
        }
      }

      return {
        uiId: createId(),
        color: stop.color,
        positionPercent: stop.positionPercent,
        xPercent: Math.round(toFiniteNumber(stop.xPercent ?? 50, 50)),
        yPercent: Math.round(toFiniteNumber(stop.yPercent ?? 50, 50)),
      }
    })

    gradientStopUiStateRef.current = nextState
    return nextState.map((entry, index) => ({
      uiId: entry.uiId,
      stop: selectedGradient.stops[index],
    }))
  }, [selectedGradient.stops])
  const selectedGradientCss = buildGradientCss(selectedGradient, selectedGradientBaseColor, '#ffffff')
  const selectedGradientTrackCss = buildGradientTrackCss(selectedGradient, selectedGradientBaseColor, '#ffffff')
  const selectedObjectOpacityPercent = selectedShapeObject
    ? selectedShapeObject.shapeData.opacityPercent
    : selectedTextboxObject
      ? Math.max(0, Math.min(100, toFiniteNumber(selectedTextboxObject.textboxData.opacityPercent, 100)))
      : selectedImageObject
        ? Math.max(0, Math.min(100, toFiniteNumber(selectedImageObject.imageData.opacityPercent, 100)))
      : 100
  const selectedObjectRadiusPercent = selectedShapeObject
    ? radiusPxToPercent(
        Math.max(0, Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(selectedShapeObject.shapeData.radius, 0))),
        selectedShapeObject.w,
        selectedShapeObject.h
      )
    : selectedImageObject
      ? radiusPxToPercent(
          Math.max(0, Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(selectedImageObject.imageData.radius, 0))),
          selectedImageObject.w,
          selectedImageObject.h
        )
    : 0
  const backgroundColorValue = canvasBackgroundControl.solidColor
  const canvasGradientCss = buildGradientCss(
    canvasBackgroundControl.gradient,
    canvasBackgroundControl.gradient.colorA,
    canvasBackgroundControl.gradient.colorB
  )
  const activeSlideIndex = activeSlide ? orderedSlides.findIndex((slide) => slide.id === activeSlide.id) : -1
  const slideDnDSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    })
  )
  const gradientStopDnDSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    })
  )

  function stopSlideTransition() {
    if (transitionFrameRef.current !== null) {
      cancelAnimationFrame(transitionFrameRef.current)
      transitionFrameRef.current = null
    }
  }

  function transitionCameraToSlide(slide: Slide, forceInstant = false) {
    stopSlideTransition()
    const targetCamera: CameraState = {
      x: slide.x,
      y: slide.y,
      zoom: slide.zoom,
      rotation: slide.rotation,
    }

    const transitionType = forceInstant ? 'instant' : slide.transitionType
    const durationMs =
      transitionType === 'instant'
        ? 0
        : Math.min(10_000, Math.max(1_000, slide.transitionDurationMs))
    if (durationMs <= 0) {
      setCamera(targetCamera)
      return
    }

    const easing = transitionType === 'linear' ? (t: number) => t : easeInOutCubic
    const startCamera = camera
    const startedAtMs = performance.now()

    const tick = (nowMs: number) => {
      const elapsed = nowMs - startedAtMs
      const progress = Math.min(1, Math.max(0, elapsed / durationMs))
      const eased = easing(progress)
      setCamera(interpolateCamera(startCamera, targetCamera, eased))
      if (progress < 1) {
        transitionFrameRef.current = requestAnimationFrame(tick)
      } else {
        transitionFrameRef.current = null
      }
    }

    transitionFrameRef.current = requestAnimationFrame(tick)
  }

  const objectTools = [
    { label: 'Textbox', icon: faPenToSquare },
    { label: 'Image', icon: faImage },
    { label: 'Rectangle', icon: faSquare },
    { label: 'Circle', icon: faCircle },
    { label: 'Arrow', icon: faArrowsUpDownLeftRight },
    { label: 'Group', icon: faLayerGroup },
    { label: 'Ungroup', icon: faObjectUngroup },
  ]

  function createId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    return `id-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  }

  function getNextZIndex() {
    const maxZ = document.objects.reduce((max, entry) => Math.max(max, entry.zIndex), 0)
    return maxZ + 1
  }

  function getDefaultShapeData(): ShapeData {
    return {
      borderColor: '#9db5de',
      borderType: 'solid',
      borderWidth: 2,
      fillMode: 'solid',
      fillColor: '#244a80',
      fillGradient: null,
      radius: 0,
      opacityPercent: 100,
    }
  }

  function handleObjectTool(label: string) {
    const safeZoom = Math.max(camera.zoom, 0.001)
    const creationScale = 1 / safeZoom

    const base = {
      id: createId(),
      x: camera.x,
      y: camera.y,
      w: 260 * creationScale,
      h: 160 * creationScale,
      rotation: -camera.rotation,
      locked: false,
      zIndex: getNextZIndex(),
      parentGroupId: null,
    } satisfies Pick<
      CanvasObject,
      'id' | 'x' | 'y' | 'w' | 'h' | 'rotation' | 'locked' | 'zIndex' | 'parentGroupId'
    >

    switch (label) {
      case 'Textbox':
        createObject({
          ...base,
          type: 'textbox',
          textboxData: {
            runs: [
              {
                text: 'New text',
                bold: false,
                italic: false,
                underline: false,
                color: '#f0f3fc',
                fontSize: 28,
              },
            ],
            richTextHtml: '<p><span style="color: #f0f3fc; font-size: 28px;">New text</span></p>',
            fontFamily: 'Space Grotesk',
            alignment: 'left',
            listType: 'none',
            autoHeight: true,
            fillMode: 'solid',
            backgroundColor: DEFAULT_TEXTBOX_BACKGROUND,
            fillGradient: null,
            borderColor: DEFAULT_TEXTBOX_BORDER_COLOR,
            borderType: 'solid',
            borderWidth: DEFAULT_TEXTBOX_BORDER_WIDTH,
            opacityPercent: 100,
          },
        })
        break
      case 'Image':
        pendingImagePlacementCameraRef.current = camera
        imageInputRef.current?.click()
        break
      case 'Rectangle':
        createObject({
          ...base,
          type: 'shape_rect',
          shapeData: getDefaultShapeData(),
        })
        break
      case 'Circle':
        createObject({
          ...base,
          type: 'shape_circle',
          shapeData: getDefaultShapeData(),
        })
        break
      case 'Arrow':
        createObject({
          ...base,
          w: 320 * creationScale,
          h: 60 * creationScale,
          type: 'shape_arrow',
          shapeData: {
            ...getDefaultShapeData(),
            fillColor: 'transparent',
          },
        })
        break
      default:
        break
    }
  }

  async function handleImageFile(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter(isSupportedImageFile)
    const placementCamera = pendingImagePlacementCameraRef.current ?? camera
    pendingImagePlacementCameraRef.current = null
    event.target.value = ''

    if (files.length === 0) {
      return
    }

    const safeZoom = Math.max(placementCamera.zoom, 0.001)
    const creationScale = 1 / safeZoom
    const zIndexStart = document.objects.reduce((max, entry) => Math.max(max, entry.zIndex), 0) + 1
    const createdIds: string[] = []

    beginCommandBatch('Import images')
    try {
      for (const [index, file] of files.entries()) {
        const dataUrl = await readFileAsDataUrl(file)
        const dimensions = await getImageDimensions(dataUrl).catch(() => ({
          width: 1200,
          height: 800,
        }))
        const assetId = createId()
        createAsset({
          id: assetId,
          name: file.name || `image-${index + 1}`,
          mimeType: file.type,
          dataBase64: toAssetBase64(dataUrl),
        })

        const aspectRatio = Math.max(0.0001, dimensions.width / Math.max(1, dimensions.height))
        const width = 260 * creationScale
        const height = Math.max(40 * creationScale, width / aspectRatio)
        const objectId = createId()
        createObject({
          id: objectId,
          type: 'image',
          x: placementCamera.x + index * 20 * creationScale,
          y: placementCamera.y + index * 20 * creationScale,
          w: width,
          h: height,
          rotation: -placementCamera.rotation,
          locked: false,
          zIndex: zIndexStart + index,
          parentGroupId: activeGroupId,
          imageData: {
            assetId,
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
      window.alert('Failed to load image file.')
    }
  }

  function handleNewDocument() {
    const shouldReset = window.confirm(
      'Reset to a new empty document? Unsaved changes will be lost.'
    )
    if (!shouldReset) {
      return
    }
    resetDocument()
    latestDocumentSnapshotRef.current = ''
    latestAutosavedSnapshotRef.current = ''
    try {
      window.localStorage.removeItem(AUTOSAVE_LATEST_KEY)
      window.localStorage.removeItem(AUTOSAVE_BACKUPS_KEY)
    } catch {
      // Ignore storage failures in restricted browser modes.
    }
  }

  function handleShapeOpacityChange(objectId: string, value: string) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      return
    }
    setShapeOpacity(objectId, parsed)
  }

  function updateSelectedTextboxData(patch: Partial<TextboxData>) {
    if (
      !selectedTextboxObject ||
      selectedTextboxObject.locked ||
      selectedObjectLockedByAncestor
    ) {
      return
    }

    let nextTextboxData: TextboxData = {
      ...selectedTextboxObject.textboxData,
      ...patch,
      fillMode: (patch.fillMode ?? selectedTextboxObject.textboxData.fillMode ?? 'solid') as TextboxData['fillMode'],
      backgroundColor: patch.backgroundColor ?? selectedTextboxObject.textboxData.backgroundColor ?? DEFAULT_TEXTBOX_BACKGROUND,
      borderWidth: Math.max(
        0,
        Math.min(
          20,
          Math.round(
            toFiniteNumber(
              patch.borderWidth ?? selectedTextboxObject.textboxData.borderWidth,
              DEFAULT_TEXTBOX_BORDER_WIDTH
            )
          )
        )
      ),
      opacityPercent: Math.max(
        0,
        Math.min(
          100,
          Math.round(
            toFiniteNumber(
              patch.opacityPercent ?? selectedTextboxObject.textboxData.opacityPercent,
              100
            )
          )
        )
      ),
    }

    if (nextTextboxData.fillMode === 'solid') {
      nextTextboxData = {
        ...nextTextboxData,
        fillGradient: null,
      }
    } else if (nextTextboxData.fillGradient === null) {
      nextTextboxData = {
        ...nextTextboxData,
        fillGradient: normalizeFillGradient(
          null,
          selectedTextboxObject.textboxData.backgroundColor,
          '#ffffff'
        ),
      }
    }

    setTextboxData(selectedTextboxObject.id, nextTextboxData)
  }

  function updateSelectedObjectTransform(
    patch: Partial<Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'rotation'>>
  ) {
    if (!selectedObject || selectedObject.locked || selectedObjectLockedByAncestor) {
      return
    }

    moveObject(selectedObject.id, {
      x: patch.x ?? selectedObject.x,
      y: patch.y ?? selectedObject.y,
      w: Math.max(1, patch.w ?? selectedObject.w),
      h: Math.max(1, patch.h ?? selectedObject.h),
      rotation: patch.rotation ?? selectedObject.rotation,
    })
  }

  function updateSelectedShapeData(patch: Partial<ShapeData>) {
    if (
      !selectedShapeObject ||
      selectedShapeObject.locked ||
      selectedObjectLockedByAncestor
    ) {
      return
    }

    let nextShapeData: ShapeData = {
      ...selectedShapeObject.shapeData,
      ...patch,
      radius: Math.max(
        0,
        Math.min(
          MAX_SHAPE_RADIUS,
          toFiniteNumber(patch.radius ?? selectedShapeObject.shapeData.radius, 0)
        )
      ),
    }

    if (nextShapeData.fillMode === 'solid') {
      nextShapeData = {
        ...nextShapeData,
        fillGradient: null,
      }
    } else if (nextShapeData.fillGradient === null) {
      nextShapeData = {
        ...nextShapeData,
        fillGradient: normalizeFillGradient(null, selectedShapeObject.shapeData.fillColor, '#ffffff'),
      }
    }

    setShapeData(selectedShapeObject.id, nextShapeData)
  }

  function updateSelectedImageData(patch: Partial<ImageData>) {
    if (
      !selectedImageObject ||
      selectedImageObject.locked ||
      selectedObjectLockedByAncestor
    ) {
      return
    }

    const nextImageData: ImageData = {
      ...selectedImageObject.imageData,
      ...patch,
      borderWidth: Math.max(
        0,
        Math.min(
          20,
          Math.round(toFiniteNumber(patch.borderWidth ?? selectedImageObject.imageData.borderWidth, 0))
        )
      ),
      radius: Math.max(
        0,
        Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(patch.radius ?? selectedImageObject.imageData.radius, 0))
      ),
      opacityPercent: Math.max(
        0,
        Math.min(
          100,
          Math.round(toFiniteNumber(patch.opacityPercent ?? selectedImageObject.imageData.opacityPercent, 100))
        )
      ),
    }

    setImageData(selectedImageObject.id, nextImageData)
  }

  function updateSelectedGradient(
    patch: Partial<{ angleDeg: number; gradientType: FillGradient['gradientType']; stops: FillGradientStop[] }>
  ) {
    const baseGradient = normalizeFillGradient(
      selectedGradient,
      selectedGradientBaseColor,
      '#ffffff'
    )
    const nextGradient = normalizeFillGradient(
      {
        ...baseGradient,
        ...patch,
      },
      selectedGradientBaseColor,
      '#ffffff'
    )

    if (selectedShapeObject) {
      updateSelectedShapeData({ fillGradient: nextGradient })
      return
    }
    if (selectedTextboxObject) {
      updateSelectedTextboxData({ fillGradient: nextGradient })
      return
    }
    if (fillEditorTarget === 'canvas') {
      setCanvasBackground(buildGradientCss(nextGradient, nextGradient.colorA, nextGradient.colorB))
    }
  }

  function randomizeSelectedGradient() {
    if (gradientEditorLocked) {
      return
    }

    const stopCount = Math.max(2, Math.min(MAX_GRADIENT_STOPS, selectedGradient.stops.length || 2))
    const usedColors: string[] = []
    const nextStops: FillGradientStop[] = []

    if (selectedGradient.gradientType === 'circles') {
      for (let index = 0; index < stopCount; index += 1) {
        const nextColor = getRandomGradientStopColor(usedColors)
        usedColors.push(nextColor)
        nextStops.push({
          color: nextColor,
          positionPercent: Math.round(22 + Math.random() * 54),
          xPercent: Math.round(8 + Math.random() * 84),
          yPercent: Math.round(8 + Math.random() * 84),
        })
      }
      updateSelectedGradient({ stops: nextStops })
      return
    }

    const positions = [0, 100]
    while (positions.length < stopCount) {
      const next = Math.round(6 + Math.random() * 88)
      if (!positions.includes(next)) {
        positions.push(next)
      }
    }
    positions.sort((a, b) => a - b)

    for (let index = 0; index < stopCount; index += 1) {
      const nextColor = getRandomGradientStopColor(usedColors)
      usedColors.push(nextColor)
      nextStops.push({
        color: nextColor,
        positionPercent: positions[index] ?? 100,
      })
    }

    updateSelectedGradient({
      stops: nextStops,
      ...(selectedGradient.gradientType === 'linear'
        ? { angleDeg: Math.round(-180 + Math.random() * 360) }
        : {}),
    })
  }

  function updateSelectedGradientStop(index: number, patch: Partial<FillGradientStop>) {
    if (!Number.isInteger(index) || index < 0 || index >= selectedGradient.stops.length) {
      return
    }
    const previousStop = selectedGradient.stops[index - 1]
    const nextStop = selectedGradient.stops[index + 1]
    const minPosition = previousStop ? previousStop.positionPercent + 1 : 0
    const maxPosition = nextStop ? nextStop.positionPercent - 1 : 100
    const fallbackPosition = selectedGradient.stops[index]?.positionPercent ?? 0
    const boundedMin = Math.max(0, Math.min(100, minPosition))
    const boundedMax = Math.max(boundedMin, Math.min(100, maxPosition))
    const nextStops = selectedGradient.stops.map((stop, stopIndex) =>
      stopIndex === index
        ? {
            color: asHexColor(patch.color ?? stop.color, stop.color),
            positionPercent: Math.max(
              boundedMin,
              Math.min(
                boundedMax,
                Math.round(
                  toFiniteNumber(
                    patch.positionPercent ?? stop.positionPercent,
                    fallbackPosition
                  )
                )
              )
            ),
            xPercent: Math.max(
              0,
              Math.min(
                100,
                Math.round(toFiniteNumber(patch.xPercent ?? stop.xPercent ?? 50, stop.xPercent ?? 50))
              )
            ),
            yPercent: Math.max(
              0,
              Math.min(
                100,
                Math.round(toFiniteNumber(patch.yPercent ?? stop.yPercent ?? 50, stop.yPercent ?? 50))
              )
            ),
          }
        : stop
    )
    updateSelectedGradient({ stops: nextStops })
  }

  function addSelectedGradientStop(
    positionPercent?: number,
    point?: { xPercent: number; yPercent: number } | null
  ) {
    if (selectedGradient.stops.length >= MAX_GRADIENT_STOPS) {
      return
    }
    const sorted = [...selectedGradient.stops].sort((a, b) => a.positionPercent - b.positionPercent)
    const wantedPosition = Number.isFinite(positionPercent)
      ? Math.max(0, Math.min(100, Math.round(positionPercent ?? 0)))
      : null
    let insertionIndex = sorted.length
    if (wantedPosition !== null) {
      insertionIndex = sorted.findIndex((stop) => stop.positionPercent > wantedPosition)
      if (insertionIndex < 0) {
        insertionIndex = sorted.length
      }
    } else {
      insertionIndex = sorted.length - 1
      let largestGap = -1
      for (let index = 0; index < sorted.length - 1; index += 1) {
        const gap = sorted[index + 1].positionPercent - sorted[index].positionPercent
        if (gap > largestGap) {
          largestGap = gap
          insertionIndex = index + 1
        }
      }
    }

    const left = sorted[Math.max(0, insertionIndex - 1)] ?? sorted[0]
    const right = sorted[Math.min(sorted.length - 1, insertionIndex)] ?? sorted[sorted.length - 1]
    const minPosition = insertionIndex <= 0 ? 0 : (left?.positionPercent ?? 0) + 1
    const maxPosition = insertionIndex >= sorted.length ? 100 : (right?.positionPercent ?? 100) - 1
    if (minPosition > maxPosition) {
      return
    }
    const nextStopColor = getRandomGradientStopColor(sorted.map((stop) => stop.color))
    const nextStop: FillGradientStop = {
      color: nextStopColor,
      positionPercent: Math.max(
        minPosition,
        Math.min(
          maxPosition,
          wantedPosition ?? Math.round(((left?.positionPercent ?? 0) + (right?.positionPercent ?? 100)) / 2)
        )
      ),
      xPercent: Math.max(0, Math.min(100, Math.round(toFiniteNumber(point?.xPercent ?? 50, 50)))),
      yPercent: Math.max(0, Math.min(100, Math.round(toFiniteNumber(point?.yPercent ?? 50, 50)))),
    }
    const nextStops = [...sorted]
    nextStops.splice(insertionIndex, 0, nextStop)
    updateSelectedGradient({ stops: nextStops })
  }

  function removeSelectedGradientStop(index: number) {
    if (selectedGradient.stops.length <= 2) {
      return
    }
    const nextStops = selectedGradient.stops.filter((_, stopIndex) => stopIndex !== index)
    updateSelectedGradient({ stops: nextStops })
  }

  function readGradientTrackPositionPercent(clientX: number): number | null {
    const track = gradientTrackRef.current
    if (!track) {
      return null
    }
    const bounds = track.getBoundingClientRect()
    if (bounds.width <= 0) {
      return null
    }
    const normalized = ((clientX - bounds.left) / bounds.width) * 100
    return Math.max(0, Math.min(100, normalized))
  }

  function readGradientPreviewPoint(clientX: number, clientY: number): { xPercent: number; yPercent: number } | null {
    const preview = gradientPreviewRef.current
    if (!preview) {
      return null
    }
    const bounds = preview.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) {
      return null
    }
    const xPercent = ((clientX - bounds.left) / bounds.width) * 100
    const yPercent = ((clientY - bounds.top) / bounds.height) * 100
    return {
      xPercent: Math.max(0, Math.min(100, xPercent)),
      yPercent: Math.max(0, Math.min(100, yPercent)),
    }
  }

  function handleGradientStopPointerDown(
    event: ReactPointerEvent<HTMLSpanElement>,
    stopIndex: number
  ) {
    if (gradientEditorLocked) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    gradientDraggingStopIndexRef.current = stopIndex
    try {
      gradientTrackRef.current?.setPointerCapture(event.pointerId)
    } catch {
      // Ignore capture failures and continue with normal pointer events.
    }
  }

  function handleGradientTrackPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const draggingIndex = gradientDraggingStopIndexRef.current
    if (draggingIndex === null) {
      return
    }
    event.preventDefault()
    const positionPercent = readGradientTrackPositionPercent(event.clientX)
    if (positionPercent === null) {
      return
    }
    updateSelectedGradientStop(draggingIndex, { positionPercent })
  }

  function handleGradientTrackPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    gradientDraggingStopIndexRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function handleGradientTrackDoubleClick(event: ReactPointerEvent<HTMLDivElement>) {
    if (gradientEditorLocked) {
      return
    }
    event.preventDefault()
    const target = event.target as HTMLElement
    const stopNode = target.closest<HTMLElement>('[data-gradient-stop-index]')
    if (stopNode) {
      const stopIndex = Number(stopNode.dataset.gradientStopIndex)
      if (Number.isInteger(stopIndex)) {
        removeSelectedGradientStop(stopIndex)
      }
      return
    }
    const positionPercent = readGradientTrackPositionPercent(event.clientX)
    if (positionPercent === null) {
      return
    }
    addSelectedGradientStop(positionPercent)
  }

  function handleGradientPreviewPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    stopIndex: number
  ) {
    if (gradientEditorLocked) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    gradientPreviewDraggingStopIndexRef.current = stopIndex
    try {
      gradientPreviewRef.current?.setPointerCapture(event.pointerId)
    } catch {
      // Ignore capture failures and continue with normal pointer events.
    }
  }

  function handleGradientPreviewPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const draggingIndex = gradientPreviewDraggingStopIndexRef.current
    if (draggingIndex === null) {
      return
    }
    event.preventDefault()
    const point = readGradientPreviewPoint(event.clientX, event.clientY)
    if (!point) {
      return
    }
    updateSelectedGradientStop(draggingIndex, point)
  }

  function handleGradientPreviewPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    gradientPreviewDraggingStopIndexRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function handleGradientPreviewDoubleClick(event: ReactPointerEvent<HTMLDivElement>) {
    if (gradientEditorLocked || selectedGradient.gradientType !== 'circles') {
      return
    }
    const target = event.target as HTMLElement
    if (target.closest('.object-gradient-circle-point')) {
      return
    }
    event.preventDefault()
    const point = readGradientPreviewPoint(event.clientX, event.clientY)
    if (!point) {
      return
    }
    addSelectedGradientStop(undefined, point)
  }

  function handleGradientStopDragEnd(event: DragEndEvent) {
    if (gradientEditorLocked) {
      return
    }
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : null
    if (!overId || activeId === overId) {
      return
    }
    const stopIds = selectedGradientStopsWithUiIds.map((entry) => entry.uiId)
    const activeIndex = stopIds.findIndex((id) => id === activeId)
    const overIndex = stopIds.findIndex((id) => id === overId)
    if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
      return
    }
    if (
      activeIndex < 0 ||
      overIndex < 0 ||
      activeIndex >= selectedGradient.stops.length ||
      overIndex >= selectedGradient.stops.length
    ) {
      return
    }
    const reorderedStops = arrayMove(selectedGradient.stops, activeIndex, overIndex)
    const orderedPositions = [...selectedGradient.stops]
      .map((stop) => stop.positionPercent)
      .sort((a, b) => a - b)
    const nextStops = reorderedStops.map((stop, index) => ({
      ...stop,
      positionPercent: orderedPositions[index] ?? stop.positionPercent,
    }))
    updateSelectedGradient({ stops: nextStops })
  }

  function setSelectedObjectProtected(nextProtected: boolean) {
    if (!selectedObject || selectedObjectLockedByAncestor) {
      return
    }
    if (selectedObject.locked === nextProtected) {
      return
    }
    toggleObjectLock(selectedObject.id)
  }

  function closeFillEditor() {
    setIsFillEditorOpen(false)
    setFillEditorTarget(null)
  }

  function openObjectFillEditor() {
    setFillEditorTarget('object')
    setIsFillEditorOpen(true)
  }

  function openCanvasFillEditor() {
    setFillEditorTarget('canvas')
    setIsFillEditorOpen(true)
  }

  function handleSlideDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : null
    if (!overId || activeId === overId) {
      return
    }

    const oldIndex = orderedSlides.findIndex((slide) => slide.id === activeId)
    const newIndex = orderedSlides.findIndex((slide) => slide.id === overId)
    if (oldIndex < 0 || newIndex < 0) {
      return
    }

    const reordered = arrayMove(orderedSlides, oldIndex, newIndex)
    reorderSlides(reordered.map((slide) => slide.id))
  }

  function goToSlideByIndex(index: number) {
    const target = orderedSlides[index]
    if (!target) {
      return
    }
    selectSlide(target.id)
    if (mode !== 'present') {
      transitionCameraToSlide(target)
    }
  }

  function focusCameraOnSlide(slide: Slide) {
    transitionCameraToSlide({
      ...slide,
      transitionType: 'ease',
      transitionDurationMs: 700,
    })
  }

  function handleSlideSelection(slideId: string) {
    const target = orderedSlides.find((slide) => slide.id === slideId)
    if (!target) {
      return
    }
    selectSlide(slideId)
    if (mode !== 'present') {
      focusCameraOnSlide(target)
    }
  }

  function goToNextSlide() {
    if (activeSlideIndex < 0) {
      return
    }
    goToSlideByIndex(activeSlideIndex + 1)
  }

  function goToPreviousSlide() {
    if (activeSlideIndex < 0) {
      return
    }
    goToSlideByIndex(activeSlideIndex - 1)
  }

  function enterPresentMode(fromCurrent: boolean) {
    if (orderedSlides.length === 0) {
      setMode('present')
      selectSlide(null)
    } else {
      const startSlide =
        fromCurrent && activeSlide
          ? activeSlide
          : orderedSlides[0]
      selectSlide(startSlide.id)
      setMode('present')
    }

    if (typeof window.document.documentElement.requestFullscreen === 'function') {
      void window.document.documentElement.requestFullscreen().catch(() => undefined)
    }
  }

  function exitPresentMode() {
    setMode('edit')
    stopSlideTransition()
    if (timedAdvanceTimeoutRef.current !== null) {
      window.clearTimeout(timedAdvanceTimeoutRef.current)
      timedAdvanceTimeoutRef.current = null
    }

    if (
      window.document.fullscreenElement &&
      typeof window.document.exitFullscreen === 'function'
    ) {
      void window.document.exitFullscreen().catch(() => undefined)
    }
  }

  function handleCreateSlide() {
    const slide: Slide = {
      id: createId(),
      name: `Slide ${orderedSlides.length + 1}`,
      x: camera.x,
      y: camera.y,
      zoom: camera.zoom,
      rotation: camera.rotation,
      triggerMode: 'manual',
      triggerDelayMs: 0,
      transitionType: 'ease',
      transitionDurationMs: 2000,
      orderIndex: orderedSlides.length,
    }
    createSlide(slide)
    selectSlide(slide.id)
  }

  function handleUpdateSlideFromCamera() {
    if (!activeSlide) {
      return
    }
    updateSlide(activeSlide.id, {
      ...activeSlide,
      x: camera.x,
      y: camera.y,
      zoom: camera.zoom,
      rotation: camera.rotation,
    })
  }

  function handleDeleteActiveSlide() {
    if (!activeSlide) {
      return
    }
    deleteSlide(activeSlide.id)
  }

  function updateActiveSlide(patch: Partial<Slide>) {
    if (!activeSlide) {
      return
    }
    const nextSlide = {
      ...activeSlide,
      ...patch,
    }
    updateSlide(activeSlide.id, nextSlide)

    const cameraFieldsChanged =
      patch.x !== undefined ||
      patch.y !== undefined ||
      patch.zoom !== undefined ||
      patch.rotation !== undefined
    if (cameraFieldsChanged && mode !== 'present') {
      setCamera({
        x: nextSlide.x,
        y: nextSlide.y,
        zoom: nextSlide.zoom,
        rotation: nextSlide.rotation,
      })
    }
  }

  function parseNumberInput(value: string): number | null {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      return null
    }
    return parsed
  }

  function handleRangeWheel(event: WheelEvent<HTMLInputElement>) {
    const input = event.currentTarget
    if (input.disabled) {
      return
    }

    event.preventDefault()
    const rawCurrent = Number(input.value)
    const rawMin = Number(input.min)
    const rawMax = Number(input.max)
    const rawStep = Number(input.step)
    const min = Number.isFinite(rawMin) ? rawMin : Number.NEGATIVE_INFINITY
    const max = Number.isFinite(rawMax) ? rawMax : Number.POSITIVE_INFINITY
    const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : 1
    const direction = event.deltaY < 0 ? 1 : -1
    const multiplier = event.shiftKey ? 10 : 1
    const current = Number.isFinite(rawCurrent) ? rawCurrent : Number.isFinite(min) ? min : 0
    const next = Math.min(max, Math.max(min, current + direction * step * multiplier))
    const precision = String(step).includes('.') ? String(step).split('.')[1]?.length ?? 0 : 0
    input.value = next.toFixed(precision)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  useEffect(() => {
    if (
      (fillEditorTarget === 'object' && !selectedShapeObject && !selectedTextboxObject) ||
      (fillEditorTarget === 'canvas' && selectedObjectIds.length > 0)
    ) {
      closeFillEditor()
    }
  }, [fillEditorTarget, selectedObjectIds.length, selectedShapeObject, selectedTextboxObject])

  useEffect(() => {
    if (selectedSlideId !== null && !selectedSlide) {
      selectSlide(orderedSlides[0]?.id ?? null)
    }
  }, [orderedSlides, selectSlide, selectedSlide, selectedSlideId])

  useEffect(() => {
    if (didAttemptAutosaveRestoreRef.current) {
      return
    }
    didAttemptAutosaveRestoreRef.current = true

    const payload = readLatestAutosavePayload()
    if (!payload) {
      return
    }
    try {
      const loaded = parseStoredFile(payload.snapshot)
      replaceDocument(loaded.document)
      if (loaded.camera) {
        setCamera(loaded.camera)
      }
      latestDocumentSnapshotRef.current = payload.snapshot
      latestAutosavedSnapshotRef.current = payload.snapshot
    } catch {
      // Ignore invalid autosave payloads.
    }
  }, [replaceDocument, setCamera])

  useEffect(() => {
    latestDocumentSnapshotRef.current = serializeDocument(document)
  }, [document])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const snapshot = latestDocumentSnapshotRef.current
      if (!snapshot || snapshot === latestAutosavedSnapshotRef.current) {
        return
      }

      const payload = {
        snapshot,
        savedAt: new Date().toISOString(),
      }
      try {
        window.localStorage.setItem(AUTOSAVE_LATEST_KEY, JSON.stringify(payload))

        const rawBackups = window.localStorage.getItem(AUTOSAVE_BACKUPS_KEY)
        const parsedBackups = rawBackups ? (JSON.parse(rawBackups) as unknown) : []
        const backups = Array.isArray(parsedBackups) ? (parsedBackups as AutosavePayload[]) : []
        backups.push(payload)
        const cappedBackups = backups.slice(-AUTOSAVE_BACKUP_LIMIT)
        window.localStorage.setItem(AUTOSAVE_BACKUPS_KEY, JSON.stringify(cappedBackups))
      } catch {
        // Ignore storage failures in restricted browser modes.
      }
      latestAutosavedSnapshotRef.current = snapshot
    }, 20_000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (mode !== 'present') {
      if (timedAdvanceTimeoutRef.current !== null) {
        window.clearTimeout(timedAdvanceTimeoutRef.current)
        timedAdvanceTimeoutRef.current = null
      }
      return
    }
    if (!activeSlide || activeSlide.triggerMode !== 'timed') {
      return
    }
    if (activeSlideIndex < 0 || activeSlideIndex >= orderedSlides.length - 1) {
      return
    }

    timedAdvanceTimeoutRef.current = window.setTimeout(() => {
      goToNextSlide()
    }, activeSlide.triggerDelayMs)

    return () => {
      if (timedAdvanceTimeoutRef.current !== null) {
        window.clearTimeout(timedAdvanceTimeoutRef.current)
        timedAdvanceTimeoutRef.current = null
      }
    }
  }, [
    activeSlide,
    activeSlideIndex,
    mode,
    orderedSlides.length,
    selectedSlideId,
    activeSlide?.triggerDelayMs,
    activeSlide?.triggerMode,
  ])

  useEffect(() => {
    if (mode !== 'present') {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Right' ||
        event.key === 'ArrowRight' ||
        event.key === 'ArrowDown' ||
        event.key === 'PageDown' ||
        event.key === ' '
      ) {
        event.preventDefault()
        goToNextSlide()
        return
      }

      if (
        event.key === 'Left' ||
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowUp' ||
        event.key === 'PageUp'
      ) {
        event.preventDefault()
        goToPreviousSlide()
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        exitPresentMode()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, selectedSlideId, activeSlideIndex, orderedSlides.length])

  useEffect(() => {
    return () => {
      stopSlideTransition()
      if (timedAdvanceTimeoutRef.current !== null) {
        window.clearTimeout(timedAdvanceTimeoutRef.current)
        timedAdvanceTimeoutRef.current = null
      }
    }
  }, [])

  function handleSaveDocument() {
    const serialized = JSON.stringify(
      {
        document: JSON.parse(serializeDocument(document)),
        camera,
      },
      null,
      2
    )
    const blob = new Blob([serialized], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const downloadLink = window.document.createElement('a')
    downloadLink.href = url
    downloadLink.download = 'infiniprez-document.json'
    downloadLink.click()
    URL.revokeObjectURL(url)
  }

  function handleExportHtml() {
    const html = buildPresentationExportHtml(document)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const downloadLink = window.document.createElement('a')
    downloadLink.href = url
    downloadLink.download = 'infiniprez-presentation.html'
    downloadLink.click()
    URL.revokeObjectURL(url)
  }

  function handleLoadClick() {
    loadInputRef.current?.click()
  }

  async function handleLoadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const payload = await file.text()
      const loaded = parseStoredFile(payload)
      replaceDocument(loaded.document)
      if (loaded.camera) {
        setCamera(loaded.camera)
      }
    } catch {
      window.alert('Failed to load file. Use a valid Infiniprez JSON document.')
    } finally {
      event.target.value = ''
    }
  }

  const projectActions = [
    { label: 'New Document', icon: faFileCirclePlus, onClick: handleNewDocument, disabled: false },
    { label: 'Load', icon: faFileImport, onClick: handleLoadClick, disabled: false },
    { label: 'Save', icon: faFileArrowDown, onClick: handleSaveDocument, disabled: false },
    {
      label: 'Export HTML',
      icon: faFileExport,
      onClick: handleExportHtml,
      disabled: false,
    },
    { label: 'Undo', icon: faUndo, onClick: undo, disabled: !canUndo },
    {
      label: 'Present',
      icon: faPlay,
      onClick: () => enterPresentMode(false),
      disabled: false,
      rightAnchor: true,
    },
    {
      label: 'Present Current',
      icon: faForwardStep,
      onClick: () => enterPresentMode(true),
      disabled: false,
    },
  ]

  return (
    <div className={`app-shell ${mode === 'present' ? 'present-mode' : ''}`}>
      <aside className="sidebar">
        <section className="panel">
          <h2>Project Name</h2>
          <div className="action-grid project-action-grid">
            {projectActions.map((action) => (
              <button
                key={action.label}
                type="button"
                className={`tool-btn icon-btn ${action.rightAnchor ? 'project-action-right-anchor' : ''}`}
                aria-label={action.label}
                title={
                  action.disabled
                    ? `${action.label}: Unavailable`
                    : action.label
                }
                onClick={action.onClick}
                disabled={action.disabled}
              >
                <FontAwesomeIcon icon={action.icon} />
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title-row">
            <h2>Slides</h2>
            <button
              type="button"
              className="icon-btn panel-icon-btn"
              aria-label="Create slide"
              title="Create slide from current camera"
              onClick={handleCreateSlide}
            >
              <FontAwesomeIcon icon={faFileCirclePlus} />
            </button>
          </div>
          {orderedSlides.length > 0 ? (
            <DndContext
              sensors={slideDnDSensors}
              collisionDetection={closestCenter}
              onDragEnd={handleSlideDragEnd}
            >
              <SortableContext
                items={orderedSlides.map((slide) => slide.id)}
                strategy={verticalListSortingStrategy}
              >
                <ol className="slide-list">
                  {orderedSlides.map((slide) => (
                    <SortableSlideItem
                      key={slide.id}
                      slide={slide}
                      isActive={slide.id === activeSlideId}
                      onClick={() => handleSlideSelection(slide.id)}
                      onHoverChange={(isHovered) => {
                        setHoveredSlideId(isHovered ? slide.id : null)
                      }}
                      onUpdate={handleUpdateSlideFromCamera}
                      onDelete={handleDeleteActiveSlide}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          ) : (
            <p className="panel-empty">No slides yet.</p>
          )}
        </section>

        <section className="panel">
          <h2>Slide Parameters</h2>
          {activeSlide ? (
            <div className="slide-params-panel" aria-label="Slide parameters">
              <label className="slide-param-field">
                <span>Name</span>
                <input
                  type="text"
                  value={activeSlide.name}
                  onChange={(event) => updateActiveSlide({ name: event.target.value })}
                />
              </label>

              <div className="slide-param-field slide-param-coord-row">
                <span>X, Y</span>
                <div className="slide-param-coord-inputs">
                  <input
                    type="number"
                    step={0.1}
                    aria-label="Slide X"
                    value={activeSlide.x.toFixed(1)}
                    onChange={(event) => {
                      const parsed = parseNumberInput(event.target.value)
                      if (parsed !== null) {
                        updateActiveSlide({ x: parsed })
                      }
                    }}
                  />
                  <input
                    type="number"
                    step={0.1}
                    aria-label="Slide Y"
                    value={activeSlide.y.toFixed(1)}
                    onChange={(event) => {
                      const parsed = parseNumberInput(event.target.value)
                      if (parsed !== null) {
                        updateActiveSlide({ y: parsed })
                      }
                    }}
                  />
                </div>
              </div>

              <div className="slide-param-switch-row">
                <span>Trigger</span>
                <div className="slide-param-switch" role="group" aria-label="Trigger mode">
                  <button
                    type="button"
                    className={activeSlide.triggerMode === 'manual' ? 'active' : ''}
                    onClick={() => updateActiveSlide({ triggerMode: 'manual' })}
                  >
                    Manual
                  </button>
                  <button
                    type="button"
                    className={activeSlide.triggerMode === 'timed' ? 'active' : ''}
                    onClick={() => updateActiveSlide({ triggerMode: 'timed' })}
                  >
                    Timed
                  </button>
                </div>
              </div>

              <div className="slide-param-switch-row">
                <span>Transition</span>
                <div className="slide-param-switch switch-3" role="group" aria-label="Transition type">
                  <button
                    type="button"
                    className={activeSlide.transitionType === 'ease' ? 'active' : ''}
                    onClick={() => updateActiveSlide({ transitionType: 'ease' })}
                  >
                    Ease
                  </button>
                  <button
                    type="button"
                    className={activeSlide.transitionType === 'linear' ? 'active' : ''}
                    onClick={() => updateActiveSlide({ transitionType: 'linear' })}
                  >
                    Linear
                  </button>
                  <button
                    type="button"
                    className={activeSlide.transitionType === 'instant' ? 'active' : ''}
                    onClick={() => updateActiveSlide({ transitionType: 'instant' })}
                  >
                    Instant
                  </button>
                </div>
              </div>

              <label className="slide-param-slider">
                <span>Zoom</span>
                <div className="slide-param-slider-control">
                  <input
                    type="range"
                    min={0.01}
                    max={100}
                    step={0.01}
                    value={activeSlide.zoom}
                    onWheel={handleRangeWheel}
                    onChange={(event) => {
                      const parsed = parseNumberInput(event.target.value)
                      if (parsed !== null) {
                        updateActiveSlide({ zoom: Math.min(100, Math.max(0.01, parsed)) })
                      }
                    }}
                  />
                  <strong>{activeSlide.zoom.toFixed(2)}x</strong>
                </div>
              </label>

              <label className="slide-param-slider">
                <span>Rotation</span>
                <div className="slide-param-slider-control">
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={10}
                    value={activeSlideRotationDeg}
                    onWheel={handleRangeWheel}
                    onChange={(event) => {
                      const parsed = parseNumberInput(event.target.value)
                      if (parsed !== null) {
                        const snappedDeg = Math.max(-180, Math.min(180, Math.round(parsed / 10) * 10))
                        updateActiveSlide({ rotation: (snappedDeg * Math.PI) / 180 })
                      }
                    }}
                  />
                  <strong>{activeSlideRotationDeg.toFixed(0)}°</strong>
                </div>
              </label>

              {activeSlide.triggerMode === 'timed' && (
                <label className="slide-param-slider">
                  <span>Delay</span>
                  <div className="slide-param-slider-control">
                    <input
                      type="range"
                      min={0}
                      max={60}
                      step={0.1}
                      value={activeSlide.triggerDelayMs / 1000}
                      onWheel={handleRangeWheel}
                      onChange={(event) => {
                        const parsed = parseNumberInput(event.target.value)
                        if (parsed !== null) {
                          updateActiveSlide({
                            triggerDelayMs: Math.min(60_000, Math.max(0, Math.round(parsed * 1000))),
                          })
                        }
                      }}
                    />
                    <strong>{Number((activeSlide.triggerDelayMs / 1000).toFixed(1))}s</strong>
                  </div>
                </label>
              )}

              {activeSlide.transitionType !== 'instant' && (
                <label className="slide-param-slider">
                  <span>Duration</span>
                  <div className="slide-param-slider-control">
                    <input
                      type="range"
                      min={1}
                      max={10}
                      step={0.1}
                      value={activeSlide.transitionDurationMs / 1000}
                      onWheel={handleRangeWheel}
                      onChange={(event) => {
                        const parsed = parseNumberInput(event.target.value)
                        if (parsed !== null) {
                          const rounded = Math.round(parsed * 1000)
                          const clamped = Math.min(10_000, Math.max(1_000, rounded))
                          updateActiveSlide({ transitionDurationMs: clamped })
                        }
                      }}
                    />
                    <strong>{Number((activeSlide.transitionDurationMs / 1000).toFixed(1))}s</strong>
                  </div>
                </label>
              )}
            </div>
          ) : (
            <p className="panel-empty">Create or select a slide to edit parameters.</p>
          )}
        </section>

        <section className="panel">
          <h2>Object Tools</h2>
          <div className="action-grid">
            {objectTools.map((tool) => (
              <button
                key={tool.label}
                type="button"
                className="tool-btn icon-btn"
                disabled={tool.label === 'Group' || tool.label === 'Ungroup'}
                onClick={() => handleObjectTool(tool.label)}
                aria-label={tool.label}
                title={tool.label}
              >
                <FontAwesomeIcon icon={tool.icon} />
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          {!isGradientEditorVisible && <h2>Object Parameters</h2>}
          {isGradientEditorVisible ? (
              <div className="object-gradient-editor">
                <div className="object-gradient-editor-header">
                  <h3>{isCanvasGradientEditorVisible ? 'Canvas Gradient' : 'Gradient'}</h3>
                  <div className="object-gradient-editor-actions">
                    <button
                      type="button"
                      className="object-param-secondary-btn icon-btn"
                      disabled={gradientEditorLocked}
                      onClick={randomizeSelectedGradient}
                      aria-label="Randomize gradient"
                      title="Randomize gradient"
                    >
                      <FontAwesomeIcon icon={faDice} />
                    </button>
                    <button
                      type="button"
                      className="object-param-secondary-btn"
                      onClick={closeFillEditor}
                    >
                      Back
                    </button>
                  </div>
                </div>

                <div
                  ref={gradientPreviewRef}
                  className={`object-gradient-preview ${
                    selectedGradient.gradientType === 'circles' ? 'circles-mode' : ''
                  }`}
                  style={{ background: selectedGradientCss }}
                  onPointerMove={
                    selectedGradient.gradientType === 'circles' ? handleGradientPreviewPointerMove : undefined
                  }
                  onPointerUp={
                    selectedGradient.gradientType === 'circles' ? handleGradientPreviewPointerUp : undefined
                  }
                  onPointerCancel={
                    selectedGradient.gradientType === 'circles' ? handleGradientPreviewPointerUp : undefined
                  }
                  onDoubleClick={
                    selectedGradient.gradientType === 'circles' ? handleGradientPreviewDoubleClick : undefined
                  }
                >
                  {selectedGradient.gradientType === 'circles' &&
                    selectedGradientStopsWithUiIds.map(({ uiId, stop }, index) => (
                      <button
                        key={`${uiId}-point`}
                        type="button"
                        className="object-gradient-circle-point"
                        style={{
                          left: `${Math.max(0, Math.min(100, toFiniteNumber(stop.xPercent ?? 50, 50)))}%`,
                          top: `${Math.max(0, Math.min(100, toFiniteNumber(stop.yPercent ?? 50, 50)))}%`,
                          background: stop.color,
                        }}
                        disabled={gradientEditorLocked}
                        onPointerDown={(event) => handleGradientPreviewPointerDown(event, index)}
                        onDoubleClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          removeSelectedGradientStop(index)
                        }}
                        aria-label={`Circle point ${index + 1}`}
                        title="Drag to position circle, double-click to remove"
                      />
                    ))}
                  <div className="object-gradient-preview-meta">
                    <span>
                      {selectedGradient.gradientType === 'radial'
                        ? 'Radial'
                        : selectedGradient.gradientType === 'circles'
                          ? 'Circles'
                          : 'Linear'}
                    </span>
                    <span>
                      {selectedGradient.gradientType === 'linear'
                        ? `${selectedGradient.angleDeg}deg`
                        : selectedGradient.gradientType === 'circles'
                          ? `${selectedGradient.stops.length} circles`
                          : `${selectedGradient.stops.length} stops`}
                    </span>
                    <span>{selectedGradient.stops.length} colors</span>
                  </div>
                </div>

                {selectedGradient.gradientType !== 'circles' && (
                  <div
                    ref={gradientTrackRef}
                    className="object-gradient-stop-track"
                    style={{ background: selectedGradientTrackCss }}
                    onPointerMove={handleGradientTrackPointerMove}
                    onPointerUp={handleGradientTrackPointerUp}
                    onPointerCancel={handleGradientTrackPointerUp}
                    onDoubleClick={handleGradientTrackDoubleClick}
                  >
                    {selectedGradientStopsWithUiIds.map(({ uiId, stop }, index) => (
                      <span
                        key={uiId}
                        className="object-gradient-stop"
                        data-gradient-stop-index={index}
                        style={{
                          left: `${stop.positionPercent}%`,
                          background: stop.color,
                        }}
                        onPointerDown={(event) => handleGradientStopPointerDown(event, index)}
                      />
                    ))}
                  </div>
                )}

                <div className="slide-param-switch switch-3 object-gradient-type-switch" role="group" aria-label="Gradient type">
                  <button
                    type="button"
                    className={selectedGradient.gradientType === 'linear' ? 'active' : ''}
                    disabled={gradientEditorLocked}
                    onClick={() => updateSelectedGradient({ gradientType: 'linear' })}
                  >
                    Linear
                  </button>
                  <button
                    type="button"
                    className={selectedGradient.gradientType === 'radial' ? 'active' : ''}
                    disabled={gradientEditorLocked}
                    onClick={() => updateSelectedGradient({ gradientType: 'radial' })}
                  >
                    Radial
                  </button>
                  <button
                    type="button"
                    className={selectedGradient.gradientType === 'circles' ? 'active' : ''}
                    disabled={gradientEditorLocked}
                    onClick={() => updateSelectedGradient({ gradientType: 'circles' })}
                  >
                    Circles
                  </button>
                </div>

                <DndContext
                  sensors={gradientStopDnDSensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleGradientStopDragEnd}
                >
                  <SortableContext
                    items={selectedGradientStopsWithUiIds.map((entry) => entry.uiId)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="object-gradient-stop-list">
                      {selectedGradientStopsWithUiIds.map(({ uiId, stop }, index) => {
                        const previousStop = selectedGradient.stops[index - 1]
                        const nextStop = selectedGradient.stops[index + 1]
                        const minPosition = previousStop ? previousStop.positionPercent + 1 : 0
                        const maxPosition = nextStop ? nextStop.positionPercent - 1 : 100
                        return (
                          <SortableGradientStopItem
                            key={uiId}
                            sortableId={uiId}
                            stop={stop}
                            index={index}
                            minPosition={minPosition}
                            maxPosition={maxPosition}
                            canRemove={selectedGradient.stops.length > 2}
                            disabled={gradientEditorLocked}
                            onWheel={handleRangeWheel}
                            onChangeColor={(stopIndex, color) =>
                              updateSelectedGradientStop(stopIndex, { color })
                            }
                            onChangePosition={(stopIndex, positionPercent) =>
                              updateSelectedGradientStop(stopIndex, { positionPercent })
                            }
                            onRemove={removeSelectedGradientStop}
                          />
                        )
                      })}
                    </div>
                  </SortableContext>
                </DndContext>

                {selectedGradient.stops.length < MAX_GRADIENT_STOPS && (
                  <button
                    type="button"
                    className="object-param-secondary-btn object-gradient-add-stop-btn"
                    disabled={gradientEditorLocked}
                    onClick={() => addSelectedGradientStop()}
                    title="Add color stop"
                    aria-label="Add color stop"
                  >
                    <FontAwesomeIcon icon={faPlus} />
                  </button>
                )}

                {selectedGradient.gradientType === 'linear' && (
                  <div className="object-gradient-angle-row">
                    <div className="object-gradient-angle-compass" aria-hidden="true">
                      <span
                        className="object-gradient-angle-compass-indicator"
                        style={{ transform: `translateX(-50%) rotate(${selectedGradient.angleDeg}deg)` }}
                      />
                    </div>
                    <div
                      className="object-gradient-angle-presets"
                      role="group"
                      aria-label="Gradient direction presets"
                    >
                      {GRADIENT_ANGLE_PRESETS.map((preset) => (
                        <button
                          key={`${preset.angleDeg}-${preset.label}`}
                          type="button"
                          className={selectedGradient.angleDeg === preset.angleDeg ? 'active' : ''}
                          disabled={gradientEditorLocked}
                          onClick={() => updateSelectedGradient({ angleDeg: preset.angleDeg })}
                          title={`${preset.angleDeg}°`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedGradient.gradientType === 'linear' && (
                  <label className="object-param-slider">
                  <span>Angle</span>
                  <div className="object-param-slider-control object-gradient-angle-slider-control">
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={selectedGradient.angleDeg}
                      disabled={gradientEditorLocked}
                      onWheel={handleRangeWheel}
                      onChange={(event) => {
                        const parsed = parseNumberInput(event.target.value)
                        if (parsed !== null) {
                          updateSelectedGradient({ angleDeg: parsed })
                        }
                      }}
                    />
                    <input
                      type="number"
                      className="object-gradient-angle-input"
                      min={-180}
                      max={180}
                      step={1}
                      value={selectedGradient.angleDeg}
                      disabled={gradientEditorLocked}
                      onChange={(event) => {
                        const parsed = parseNumberInput(event.target.value)
                        if (parsed !== null) {
                          updateSelectedGradient({ angleDeg: parsed })
                        }
                      }}
                      aria-label="Gradient angle in degrees"
                    />
                    <strong>{selectedGradient.angleDeg}°</strong>
                  </div>
                  </label>
                )}
              </div>
            ) : selectedObject ? (
              <div className="object-params-panel">
                <div className="object-param-row">
                  <span>X, Y</span>
                  <div className="object-param-inputs">
                    <input
                      type="number"
                      step={0.1}
                      value={selectedObject.x.toFixed(1)}
                      disabled={selectedObjectTransformLocked}
                      onChange={(event) => {
                        const parsed = parseNumberInput(event.target.value)
                        if (parsed !== null) {
                          updateSelectedObjectTransform({ x: parsed })
                        }
                      }}
                    />
                    <input
                      type="number"
                      step={0.1}
                      value={selectedObject.y.toFixed(1)}
                      disabled={selectedObjectTransformLocked}
                      onChange={(event) => {
                        const parsed = parseNumberInput(event.target.value)
                        if (parsed !== null) {
                          updateSelectedObjectTransform({ y: parsed })
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="object-param-row">
                  <span>W, H</span>
                  <div className="object-param-inputs">
                    <input
                      type="number"
                      min={1}
                      step={0.1}
                      value={selectedObject.w.toFixed(1)}
                      disabled={selectedObjectTransformLocked}
                      onChange={(event) => {
                        const parsed = parseNumberInput(event.target.value)
                        if (parsed !== null) {
                          updateSelectedObjectTransform({ w: parsed })
                        }
                      }}
                    />
                    <input
                      type="number"
                      min={1}
                      step={0.1}
                      value={selectedObject.h.toFixed(1)}
                      disabled={selectedObjectTransformLocked}
                      onChange={(event) => {
                        const parsed = parseNumberInput(event.target.value)
                        if (parsed !== null) {
                          updateSelectedObjectTransform({ h: parsed })
                        }
                      }}
                    />
                  </div>
                </div>

                <label className="object-param-slider">
                  <span>Rotation</span>
                  <div className="object-param-slider-control">
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={selectedObjectRotationDeg}
                      disabled={selectedObjectTransformLocked}
                      onWheel={handleRangeWheel}
                      onChange={(event) => {
                        const parsed = parseNumberInput(event.target.value)
                        if (parsed !== null) {
                          updateSelectedObjectTransform({ rotation: (parsed * Math.PI) / 180 })
                        }
                      }}
                    />
                    <strong>{selectedObjectRotationDeg.toFixed(0)}°</strong>
                  </div>
                </label>

                <label className="object-param-slider">
                  <span>Opacity</span>
                  <div className="object-param-slider-control">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={selectedObjectOpacityPercent}
                      disabled={
                        (!selectedShapeObject && !selectedTextboxObject && !selectedImageObject) ||
                        selectedObjectTransformLocked
                      }
                      onWheel={handleRangeWheel}
                      onChange={(event) => {
                        if (selectedShapeObject) {
                          handleShapeOpacityChange(selectedShapeObject.id, event.target.value)
                        } else if (selectedTextboxObject) {
                          const parsed = parseNumberInput(event.target.value)
                          if (parsed !== null) {
                            updateSelectedTextboxData({ opacityPercent: parsed })
                          }
                        } else if (selectedImageObject) {
                          const parsed = parseNumberInput(event.target.value)
                          if (parsed !== null) {
                            updateSelectedImageData({ opacityPercent: parsed })
                          }
                        }
                      }}
                    />
                    <strong>
                      {selectedShapeObject || selectedTextboxObject || selectedImageObject
                        ? `${Math.round(selectedObjectOpacityPercent)}%`
                        : 'N/A'}
                    </strong>
                  </div>
                </label>

                <label className="object-param-slider">
                  <span>Radius</span>
                  <div className="object-param-slider-control">
                    <input
                      type="range"
                      min={0}
                      max={MAX_RADIUS_PERCENT}
                      step={1}
                      value={selectedShapeObject?.type === 'shape_circle' ? 0 : selectedObjectRadiusPercent}
                      disabled={
                        (!selectedShapeObject && !selectedImageObject) ||
                        (selectedShapeObject?.type === 'shape_circle') ||
                        selectedObjectTransformLocked
                      }
                      onWheel={handleRangeWheel}
                      onChange={(event) => {
                        const parsed = parseNumberInput(event.target.value)
                        if (parsed !== null && selectedShapeObject) {
                          updateSelectedShapeData({
                            radius: radiusPercentToPx(parsed, selectedShapeObject.w, selectedShapeObject.h),
                          })
                        } else if (parsed !== null && selectedImageObject) {
                          updateSelectedImageData({
                            radius: radiusPercentToPx(parsed, selectedImageObject.w, selectedImageObject.h),
                          })
                        }
                      }}
                    />
                    <strong>
                      {selectedShapeObject
                        ? selectedShapeObject.type === 'shape_circle'
                          ? 'Auto'
                          : `${Math.round(selectedObjectRadiusPercent)}%`
                        : selectedImageObject
                          ? `${Math.round(selectedObjectRadiusPercent)}%`
                        : 'N/A'}
                    </strong>
                  </div>
                </label>

                {(selectedShapeObject || selectedTextboxObject) && (
                <div className="object-param-row">
                  <span>Background</span>
                  {selectedShapeObject ? (
                    <div className="object-param-fill-controls">
                      <div className="slide-param-switch switch-3" role="group" aria-label="Shape fill mode">
                        <button
                          type="button"
                          className={
                            selectedShapeObject.shapeData.fillMode === 'solid' &&
                            selectedShapeObject.shapeData.fillColor !== 'transparent'
                              ? 'active'
                              : ''
                          }
                          disabled={selectedObjectTransformLocked}
                          onClick={() => {
                            updateSelectedShapeData({
                              fillMode: 'solid',
                              fillGradient: null,
                              fillColor:
                                selectedShapeObject.shapeData.fillColor === 'transparent'
                                  ? '#244a80'
                                  : selectedShapeObject.shapeData.fillColor,
                            })
                            closeFillEditor()
                          }}
                        >
                          Solid
                        </button>
                        <button
                          type="button"
                          className={selectedShapeObject.shapeData.fillMode === 'linearGradient' ? 'active' : ''}
                          disabled={selectedObjectTransformLocked}
                          onClick={() => {
                            updateSelectedShapeData({
                              fillMode: 'linearGradient',
                              fillGradient:
                                selectedShapeObject.shapeData.fillGradient ??
                                normalizeFillGradient(
                                  null,
                                  selectedShapeObject.shapeData.fillColor === 'transparent'
                                    ? '#244a80'
                                    : selectedShapeObject.shapeData.fillColor,
                                  '#ffffff'
                                ),
                            })
                          }}
                        >
                          Gradient
                        </button>
                        <button
                          type="button"
                          className={
                            selectedShapeObject.shapeData.fillMode === 'solid' &&
                            selectedShapeObject.shapeData.fillColor === 'transparent'
                              ? 'active'
                              : ''
                          }
                          disabled={selectedObjectTransformLocked}
                          onClick={() => {
                            updateSelectedShapeData({
                              fillMode: 'solid',
                              fillGradient: null,
                              fillColor: 'transparent',
                            })
                            closeFillEditor()
                          }}
                        >
                          None
                        </button>
                      </div>

                      {selectedShapeObject.shapeData.fillMode === 'solid' &&
                      selectedShapeObject.shapeData.fillColor !== 'transparent' ? (
                        <ColorPickerChip
                          className="object-param-color-chip"
                          value={asHexColor(selectedShapeObject.shapeData.fillColor, '#244a80')}
                          fallback="#244a80"
                          disabled={selectedObjectTransformLocked}
                          onChange={(nextColor) => {
                            updateSelectedShapeData({ fillColor: nextColor })
                          }}
                          ariaLabel="Shape background color"
                          title="Shape background color"
                        />
                      ) : selectedShapeObject.shapeData.fillMode === 'linearGradient' ? (
                        <button
                          type="button"
                          className="object-param-color-chip object-param-gradient-chip"
                          style={{ background: getShapeBackground(selectedShapeObject.shapeData) }}
                          disabled={selectedObjectTransformLocked}
                          onClick={openObjectFillEditor}
                          aria-label="Edit gradient"
                          title="Edit gradient"
                        />
                      ) : null}
                    </div>
                  ) : selectedTextboxObject ? (
                    <div className="object-param-fill-controls">
                      <div className="slide-param-switch switch-3" role="group" aria-label="Textbox fill mode">
                        <button
                          type="button"
                          className={
                            selectedTextboxFillMode === 'solid' &&
                            selectedTextboxObject.textboxData.backgroundColor !== 'transparent'
                              ? 'active'
                              : ''
                          }
                          disabled={selectedObjectTransformLocked}
                          onClick={() => {
                            updateSelectedTextboxData({
                              fillMode: 'solid',
                              fillGradient: null,
                              backgroundColor:
                                selectedTextboxObject.textboxData.backgroundColor === 'transparent'
                                  ? DEFAULT_TEXTBOX_BACKGROUND
                                  : selectedTextboxObject.textboxData.backgroundColor,
                            })
                            closeFillEditor()
                          }}
                        >
                          Solid
                        </button>
                        <button
                          type="button"
                          className={selectedTextboxFillMode === 'linearGradient' ? 'active' : ''}
                          disabled={selectedObjectTransformLocked}
                          onClick={() => {
                            updateSelectedTextboxData({
                              fillMode: 'linearGradient',
                              fillGradient:
                                selectedTextboxObject.textboxData.fillGradient ??
                                normalizeFillGradient(
                                  null,
                                  selectedTextboxObject.textboxData.backgroundColor === 'transparent'
                                    ? DEFAULT_TEXTBOX_BACKGROUND
                                    : selectedTextboxObject.textboxData.backgroundColor,
                                  '#ffffff'
                                ),
                            })
                          }}
                        >
                          Gradient
                        </button>
                        <button
                          type="button"
                          className={
                            selectedTextboxFillMode === 'solid' &&
                            selectedTextboxObject.textboxData.backgroundColor === 'transparent'
                              ? 'active'
                              : ''
                          }
                          disabled={selectedObjectTransformLocked}
                          onClick={() => {
                            updateSelectedTextboxData({
                              fillMode: 'solid',
                              fillGradient: null,
                              backgroundColor: 'transparent',
                            })
                            closeFillEditor()
                          }}
                        >
                          None
                        </button>
                      </div>

                      {selectedTextboxFillMode === 'solid' &&
                      selectedTextboxObject.textboxData.backgroundColor !== 'transparent' ? (
                        <ColorPickerChip
                          className="object-param-color-chip"
                          value={asHexColor(
                            selectedTextboxObject.textboxData.backgroundColor,
                            DEFAULT_TEXTBOX_BACKGROUND
                          )}
                          fallback={DEFAULT_TEXTBOX_BACKGROUND}
                          disabled={selectedObjectTransformLocked}
                          onChange={(nextColor) => {
                            updateSelectedTextboxData({ backgroundColor: nextColor })
                          }}
                          ariaLabel="Textbox background color"
                          title="Textbox background color"
                        />
                      ) : selectedTextboxFillMode === 'linearGradient' ? (
                        <button
                          type="button"
                          className="object-param-color-chip object-param-gradient-chip"
                          style={{ background: getTextboxBackground(selectedTextboxObject.textboxData) }}
                          disabled={selectedObjectTransformLocked}
                          onClick={openObjectFillEditor}
                          aria-label="Edit textbox gradient"
                          title="Edit textbox gradient"
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
                )}

                <div className="object-param-row">
                  <span>Border</span>
                  {selectedShapeObject ? (
                    <div
                      className={`object-param-border-controls ${
                        selectedShapeObject.shapeData.borderWidth <= 0 ? 'border-none' : ''
                      }`}
                    >
                      <BorderWidthDropdown
                        value={selectedShapeObject.shapeData.borderWidth}
                        borderColor={selectedShapeObject.shapeData.borderColor}
                        disabled={selectedObjectTransformLocked}
                        onChange={(nextValue) => {
                          updateSelectedShapeData({
                            borderWidth: Math.max(0, Math.min(20, Math.round(nextValue))),
                          })
                        }}
                      />
                      {selectedShapeObject.shapeData.borderWidth > 0 && (
                        <>
                          <BorderStyleDropdown
                            value={selectedShapeObject.shapeData.borderType}
                            borderColor={selectedShapeObject.shapeData.borderColor}
                            borderWidth={selectedShapeObject.shapeData.borderWidth}
                            disabled={selectedObjectTransformLocked}
                            onChange={(nextValue) =>
                              updateSelectedShapeData({
                                borderType: nextValue,
                              })
                            }
                          />
                          <ColorPickerChip
                            value={asHexColor(selectedShapeObject.shapeData.borderColor, '#9db5de')}
                            fallback="#9db5de"
                            disabled={selectedObjectTransformLocked}
                            onChange={(nextColor) => {
                              updateSelectedShapeData({ borderColor: nextColor })
                            }}
                            ariaLabel="Shape border color"
                            title="Shape border color"
                          />
                        </>
                      )}
                    </div>
                  ) : selectedTextboxObject ? (
                    <div
                      className={`object-param-border-controls ${
                        selectedTextboxObject.textboxData.borderWidth <= 0 ? 'border-none' : ''
                      }`}
                    >
                      <BorderWidthDropdown
                        value={selectedTextboxObject.textboxData.borderWidth}
                        borderColor={selectedTextboxObject.textboxData.borderColor}
                        disabled={selectedObjectTransformLocked}
                        onChange={(nextValue) => {
                          updateSelectedTextboxData({
                            borderWidth: nextValue,
                          })
                        }}
                      />
                      {selectedTextboxObject.textboxData.borderWidth > 0 && (
                        <>
                          <BorderStyleDropdown
                            value={selectedTextboxObject.textboxData.borderType}
                            borderColor={selectedTextboxObject.textboxData.borderColor}
                            borderWidth={selectedTextboxObject.textboxData.borderWidth}
                            disabled={selectedObjectTransformLocked}
                            onChange={(nextValue) => {
                              updateSelectedTextboxData({
                                borderType: nextValue,
                              })
                            }}
                          />
                          <ColorPickerChip
                            value={asHexColor(
                              selectedTextboxObject.textboxData.borderColor,
                              DEFAULT_TEXTBOX_BORDER_COLOR
                            )}
                            fallback={DEFAULT_TEXTBOX_BORDER_COLOR}
                            disabled={selectedObjectTransformLocked}
                            onChange={(nextColor) => {
                              updateSelectedTextboxData({ borderColor: nextColor })
                            }}
                            ariaLabel="Textbox border color"
                            title="Textbox border color"
                          />
                        </>
                      )}
                    </div>
                  ) : selectedImageObject ? (
                    <div
                      className={`object-param-border-controls ${
                        selectedImageObject.imageData.borderWidth <= 0 ? 'border-none' : ''
                      }`}
                    >
                      <BorderWidthDropdown
                        value={selectedImageObject.imageData.borderWidth}
                        borderColor={selectedImageObject.imageData.borderColor}
                        disabled={selectedObjectTransformLocked}
                        onChange={(nextValue) => {
                          updateSelectedImageData({
                            borderWidth: nextValue,
                          })
                        }}
                      />
                      {selectedImageObject.imageData.borderWidth > 0 && (
                        <>
                          <BorderStyleDropdown
                            value={selectedImageObject.imageData.borderType}
                            borderColor={selectedImageObject.imageData.borderColor}
                            borderWidth={selectedImageObject.imageData.borderWidth}
                            disabled={selectedObjectTransformLocked}
                            onChange={(nextValue) => {
                              updateSelectedImageData({
                                borderType: nextValue,
                              })
                            }}
                          />
                          <ColorPickerChip
                            value={asHexColor(
                              selectedImageObject.imageData.borderColor,
                              DEFAULT_TEXTBOX_BORDER_COLOR
                            )}
                            fallback={DEFAULT_TEXTBOX_BORDER_COLOR}
                            disabled={selectedObjectTransformLocked}
                            onChange={(nextColor) => {
                              updateSelectedImageData({ borderColor: nextColor })
                            }}
                            ariaLabel="Image border color"
                            title="Image border color"
                          />
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="object-param-muted">Border controls are available for shapes, textboxes and images.</div>
                  )}
                </div>

                <div className="object-param-row">
                  <span>Protected</span>
                  <div className="slide-param-switch" role="group" aria-label="Object protection">
                    <button
                      type="button"
                      className={selectedObject.locked ? 'active' : ''}
                      disabled={selectedObjectLockedByAncestor}
                      onClick={() => setSelectedObjectProtected(true)}
                    >
                      <FontAwesomeIcon icon={faLock} /> On
                    </button>
                    <button
                      type="button"
                      className={!selectedObject.locked ? 'active' : ''}
                      disabled={selectedObjectLockedByAncestor}
                      onClick={() => setSelectedObjectProtected(false)}
                    >
                      <FontAwesomeIcon icon={faLockOpen} /> Off
                    </button>
                  </div>
                </div>

                {canToggleGroupFromSelection && (
                  <div className="object-param-row">
                    <span>Group</span>
                    <button
                      type="button"
                      className="object-param-secondary-btn"
                      onClick={() => {
                        if (selectedGroupObject) {
                          enterGroup(selectedGroupObject.id)
                        }
                      }}
                      aria-label="Enter group"
                      title="Enter group"
                    >
                      <FontAwesomeIcon icon={faLayerGroup} /> Enter
                    </button>
                  </div>
                )}
              </div>
            ) : selectedObjectIds.length > 1 ? (
            <p className="panel-empty">
              Numeric transform fields are available only for a single selected object.
            </p>
          ) : (
            <div className="background-params object-params-panel">
              <div className="object-param-row">
                <span>Background</span>
                <div className="object-param-fill-controls">
                  <div className="slide-param-switch switch-2" role="group" aria-label="Canvas background mode">
                    <button
                      type="button"
                      className={canvasBackgroundControl.fillMode === 'solid' ? 'active' : ''}
                      onClick={() => {
                        setCanvasBackground(backgroundColorValue)
                        closeFillEditor()
                      }}
                    >
                      Solid
                    </button>
                    <button
                      type="button"
                      className={canvasBackgroundControl.fillMode === 'linearGradient' ? 'active' : ''}
                      onClick={() => {
                        setCanvasBackground(canvasGradientCss)
                      }}
                    >
                      Gradient
                    </button>
                  </div>
                  {canvasBackgroundControl.fillMode === 'solid' ? (
                    <ColorPickerChip
                      className="object-param-color-chip"
                      value={backgroundColorValue}
                      fallback="#1f365a"
                      disabled={false}
                      onChange={(nextColor) => {
                        setCanvasBackground(nextColor)
                        closeFillEditor()
                      }}
                      ariaLabel="Canvas background color"
                      title="Canvas background color"
                    />
                  ) : (
                    <button
                      type="button"
                      className="object-param-color-chip object-param-gradient-chip"
                      style={{ background: canvasGradientCss }}
                      onClick={openCanvasFillEditor}
                      aria-label="Edit canvas gradient"
                      title="Edit canvas gradient"
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </aside>

      <main className="canvas-area">
        {mode === 'present' && (
          <div className="present-hud">
            <span className="present-hud-title">{activeSlide?.name ?? document.meta.title}</span>
            <span className="present-hud-status">
              {orderedSlides.length === 0 || activeSlideIndex < 0
                ? '0 / 0'
                : `${activeSlideIndex + 1} / ${orderedSlides.length}`}
            </span>
            <button
              type="button"
              className="present-hud-btn"
              onClick={goToPreviousSlide}
              title="Previous slide"
              disabled={!activeSlide || activeSlideIndex <= 0}
            >
              Prev
            </button>
            <button
              type="button"
              className="present-hud-btn"
              onClick={goToNextSlide}
              title="Next slide"
              disabled={!activeSlide || activeSlideIndex >= orderedSlides.length - 1}
            >
              Next
            </button>
            <button
              type="button"
              className="present-hud-btn"
              onClick={exitPresentMode}
              title="Exit present mode"
            >
              Exit
            </button>
          </div>
        )}

        <input
          ref={loadInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleLoadFile}
          style={{ display: 'none' }}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept={SUPPORTED_IMAGE_ACCEPT}
          multiple
          onChange={handleImageFile}
          style={{ display: 'none' }}
        />

        {mode === 'present' ? (
          <PresentStage model={document} slide={activeSlide} />
        ) : (
          <CanvasViewport hoveredSlideId={hoveredSlideId} />
        )}
      </main>
    </div>
  )
}

export default App
