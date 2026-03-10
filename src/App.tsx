import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from 'react'
import { createPortal } from 'react-dom'
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
  faArrowDownAZ,
  faArrowDownWideShort,
  faArrowUpShortWide,
  faArrowUpZA,
  faBackwardStep,
  faBoxArchive,
  faChevronLeft,
  faChevronRight,
  faDice,
  faFont,
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
  faShapes,
  faTrashCan,
  faUndo,
  faVideo,
  faVolumeHigh,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { CanvasViewport } from './canvas'
import {
  deserializeDocument,
  serializeDocument,
  type Asset,
  type CanvasObject,
  type DocumentModel,
  type FillMode,
  type FillGradient,
  type FillGradientStop,
  type ImageData,
  type ShapeKind,
  type ShapeData,
  type Slide,
  type SoundData,
  type TextboxData,
  type VideoData,
} from './model'
import {
  buildPresentationExportHtml,
} from './persistence'
import {
  buildPresentationScene,
  interpolateCamera,
  isBackwardPresentationKey,
  isForwardPresentationKey,
  shouldAutoAdvanceSlide,
  resolveTransitionDurationMs,
} from './presentation'
import { useEditorStore } from './store'
import type { CameraState } from './store/types'
import {
  applyTextboxThemeRichHtml,
  resolveTextboxBaseTextStyle,
  resolveTextboxRichHtml,
  textboxUsesFontFamily,
} from './textboxRichText'
import {
  buildLibraryAsset,
  findMatchingLibraryAsset,
  isSupportedLibraryAssetFile,
  resolveLibraryAssetKind,
  SUPPORTED_LIBRARY_ASSET_ACCEPT,
  validateLibraryAssetFile,
  type LibraryAssetKind,
} from './assetFile'
import {
  SUPPORTED_IMAGE_ACCEPT,
  getImageDimensions,
  isSupportedImageFile,
  readFileAsDataUrl,
  toAssetBase64,
} from './imageFile'
import { cameraDragDeltaToWorld } from './canvas/math'
import {
  createDefaultImageData,
  createDefaultSoundData,
  createDefaultVideoData,
  getDefaultPlacedMediaSize,
  getZoomAdjustedObjectScalePercent,
  isObjectAspectRatioLocked,
  resolveObjectBorderScale,
} from './objectDefaults'
import {
  buildSlideTemplateInstance,
  getSlideTemplateCatalogEntries,
  getSlideTemplateDefinitionById,
  getSlideTemplateFrameSize,
  registerRuntimeSlideTemplateDefinition,
  unregisterRuntimeSlideTemplateDefinitionsBySourceAssetId,
  getSlideTemplatesForStyle,
  isSlideTemplateDefinition,
  resolveSlideTemplateTheme,
  type SlideTemplateDefinition,
  type SlideTemplate,
} from './slideTemplates'
import {
  SHAPE_KIND_OPTIONS,
  clampShapeAdjustment,
  getDefaultShapeAdjustment,
  normalizeShapeKind,
  shapeSupportsRadius,
} from './shapeStyle'
import { ShapeSvg } from './ShapeSvg'
import {
  getStylePresetCatalogEntries,
  getStylePresetDefinitionById,
  getObjectStyleRole,
  isStylePresetDefinition,
  registerRuntimeStylePresetDefinition,
  unregisterRuntimeStylePresetDefinitionsBySourceAssetId,
  getTextStyleRole,
  type ObjectStyleRoleId,
  type StylePresetDefinition,
  type StylePreset,
} from './stylePresets'
import { ASSET_LIBRARY_DRAG_MIME, type AssetLibraryDragPayload } from './assetDrag'
import { buildAssetFontFaceCss, resolveAssetFontFamily } from './fontAssets'
import {
  diagonalFromZoom,
  getTargetFrameHalfDiagonal,
  zoomFromDiagonal,
} from './slideDiagonal'
import './App.css'

const OBJECT_SCALE_MIN_PERCENT = 1
const OBJECT_SCALE_MAX_PERCENT = 10000

type ScalableCanvasObject = Extract<
  CanvasObject,
  {
    type:
    | 'shape_rect'
    | 'shape_circle'
    | 'textbox'
    | 'image'
    | 'video'
    | 'sound'
    | 'template_placeholder'
  }
>
type RightSidebarDesignTab = 'styles' | 'templates' | 'assets'
type ShapeCreationPresetId = ShapeKind | 'circle'
type DesignAssetContextMenu =
  | {
    kind: 'style'
    id: string
    x: number
    y: number
  }
  | {
    kind: 'template'
    id: string
    x: number
    y: number
  }

function camerasAreEqual(a: CameraState, b: CameraState): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom && a.rotation === b.rotation
}

interface ObjectScaleBaseline {
  id: string
  type: ScalableCanvasObject['type']
  x: number
  y: number
  w: number
  h: number
  rotation: number
  scalePercent: number
}

function clampObjectScalePercent(value: number) {
  if (!Number.isFinite(value)) {
    return 100
  }
  return Math.max(OBJECT_SCALE_MIN_PERCENT, Math.min(OBJECT_SCALE_MAX_PERCENT, Math.round(value)))
}

function createObjectScaleBaseline(object: ScalableCanvasObject): ObjectScaleBaseline {
  return {
    id: object.id,
    type: object.type,
    x: object.x,
    y: object.y,
    w: object.w,
    h: object.h,
    rotation: object.rotation,
    scalePercent: object.scalePercent,
  }
}

function resolveTextboxObjectScale(_textboxData: TextboxData, scalePercent: number) {
  return clampObjectScalePercent(scalePercent) / 100
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

function screenToWorldPresent(
  screen: { x: number; y: number },
  camera: CameraState,
  viewport: { width: number; height: number }
) {
  const centered = {
    x: screen.x - viewport.width / 2,
    y: screen.y - viewport.height / 2,
  }
  const unrotated = rotatePoint(centered, -camera.rotation)
  return {
    x: unrotated.x / camera.zoom + camera.x,
    y: unrotated.y / camera.zoom + camera.y,
  }
}

function getPresentVisibleWorldBounds(
  camera: CameraState,
  viewport: { width: number; height: number }
): { minX: number; minY: number; maxX: number; maxY: number } {
  const corners = [
    screenToWorldPresent({ x: 0, y: 0 }, camera, viewport),
    screenToWorldPresent({ x: viewport.width, y: 0 }, camera, viewport),
    screenToWorldPresent({ x: 0, y: viewport.height }, camera, viewport),
    screenToWorldPresent({ x: viewport.width, y: viewport.height }, camera, viewport),
  ]
  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    minY: Math.min(...corners.map((corner) => corner.y)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    maxY: Math.max(...corners.map((corner) => corner.y)),
  }
}

function mergePresentWorldBounds(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number }
): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

function expandPresentWorldBounds(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  padding: number
): { minX: number; minY: number; maxX: number; maxY: number } {
  const safePadding = Math.max(0, padding)
  return {
    minX: bounds.minX - safePadding,
    minY: bounds.minY - safePadding,
    maxX: bounds.maxX + safePadding,
    maxY: bounds.maxY + safePadding,
  }
}

function toFiniteNumber(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

function normalizeOptionalId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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
const MAX_SHAPE_RADIUS = 1000000
const MAX_RADIUS_PERCENT = 100
const MAX_SHADOW_BLUR_PX = 200
const MAX_GRADIENT_STOPS = 5
const MIN_GRADIENT_HUE_SEPARATION_DEG = 108
const PRESENT_FREE_MOVE_ROTATION_STEP_RAD = (10 * Math.PI) / 180
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

type CreationToolType = 'textbox' | 'shape_rect' | 'shape_circle' | 'image'
const SUPPORTED_VIDEO_ACCEPT = 'video/mp4,video/webm,video/ogg,video/quicktime,.mp4,.webm,.ogg,.ogv,.mov'
const SUPPORTED_AUDIO_ACCEPT =
  'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/webm,audio/flac,audio/x-flac,.mp3,.wav,.m4a,.aac,.ogg,.oga,.flac'

interface PendingImagePlacement {
  assetId?: string
  name: string
  mimeType: string
  dataBase64: string
  intrinsicWidth: number
  intrinsicHeight: number
  persistAfterPlace?: boolean
}

interface AssetLibraryEntry {
  asset: Asset
  src: string
  intrinsicWidth: number
  intrinsicHeight: number
  usageCount: number
  kind: LibraryAssetKind
  base64Size: number
  durationSec: number | null
  linkedStylePresetNames: string[]
  linkedSlideTemplateNames: string[]
  parentStyleAssetId: string | null
  parentStyleAssetName: string | null
  embeddedChildAssetCount: number
  embeddedChildAssetNames: string[]
}

type AssetLibraryFilter = LibraryAssetKind | null
type AssetLibrarySort = 'name' | 'size'
type AssetLibrarySortDirection = 'asc' | 'desc'

function buildAssetDataUrl(asset: Asset): string {
  return `data:${asset.mimeType};base64,${asset.dataBase64}`
}

function AssetDropHint({
  compact = false,
  onClick,
}: {
  compact?: boolean
  onClick?: () => void
}) {
  const items = [
    { key: 'image', icon: faImage, label: 'Image' },
    { key: 'video', icon: faVideo, label: 'Video' },
    { key: 'font', icon: faFont, label: 'Font' },
    { key: 'sound', icon: faVolumeHigh, label: 'Sound' },
    { key: 'style', icon: faFileImport, label: 'Style' },
  ]

  const content = (
    <>
      <span className={`asset-drop-hint ${compact ? 'compact' : ''}`}>
        {items.map((item) => (
          <span key={item.key} className="asset-drop-hint-item">
            <span className="asset-drop-hint-icon">
              <FontAwesomeIcon icon={item.icon} />
              <span className="asset-drop-hint-plus">
                <FontAwesomeIcon icon={faPlus} />
              </span>
            </span>
            <span className="asset-drop-hint-label">{item.label}</span>
          </span>
        ))}
      </span>
      <span className="asset-drop-hint-caption">... or drop here from your computer</span>
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        className={`asset-drop-hint-action ${compact ? 'compact' : ''}`}
        onClick={onClick}
        title="Add assets from your computer"
      >
        {content}
      </button>
    )
  }

  return (
    <span className={`asset-drop-hint-static ${compact ? 'compact' : ''}`} aria-hidden="true">
      {content}
    </span>
  )
}

function formatBase64PayloadSize(size: number) {
  if (size >= 1_000_000) {
    return `${(size / 1_000_000).toFixed(2)} MB`
  }
  if (size >= 1_000) {
    return `${(size / 1_000).toFixed(1)} KB`
  }
  return `${size} B`
}

function formatAssetDuration(durationSec: number | null | undefined) {
  if (durationSec === null || durationSec === undefined || !Number.isFinite(durationSec) || durationSec <= 0) {
    return null
  }
  const totalSeconds = Math.round(durationSec)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function getAssetTypeLabel(kind: LibraryAssetKind) {
  switch (kind) {
    case 'audio':
      return 'Sound'
    case 'video':
      return 'Video'
    case 'font':
      return 'Font'
    case 'style':
      return 'Style JSON'
    default:
      return 'Image'
  }
}

function getAssetTypeIcon(kind: LibraryAssetKind) {
  switch (kind) {
    case 'audio':
      return faVolumeHigh
    case 'video':
      return faVideo
    case 'font':
      return faFont
    case 'style':
      return faFileImport
    default:
      return faImage
  }
}

function inferStylePreset(document: DocumentModel, presets: StylePreset[]): StylePreset | null {
  const firstTextbox = document.objects.find((object) => object.type === 'textbox')
  return (
    presets.find(
      (preset) =>
        document.canvas.background === preset.canvasBackground &&
        (!firstTextbox || firstTextbox.textboxData.fontFamily === preset.fontFamily)
    ) ?? null
  )
}

function normalizeColorForStyleMatch(value: string | undefined) {
  return (value ?? '').trim().toLowerCase()
}

function resolvePresetTextRole(
  preset: StylePreset | null,
  role: Parameters<typeof getTextStyleRole>[1],
  stylePresets: StylePreset[]
) {
  const fallbackPreset = preset ?? stylePresets[0] ?? null
  return getTextStyleRole(fallbackPreset, role)
}

function resolvePresetObjectRole(
  preset: StylePreset | null,
  role: ObjectStyleRoleId,
  stylePresets: StylePreset[]
) {
  const fallbackPreset = preset ?? stylePresets[0] ?? null
  return getObjectStyleRole(fallbackPreset, role)
}

function inferObjectStyleRoleIdForObject(
  object: CanvasObject | null,
  preset: StylePreset | null
): ObjectStyleRoleId | null {
  if (!object || object.type === 'group' || object.type === 'template_placeholder') {
    return null
  }
  if (!preset) {
    return null
  }
  const candidates = preset.objectStyles
  if (candidates.length === 0) {
    return null
  }

  const findByMatch = (predicate: (entry: (typeof candidates)[number]) => boolean) =>
    candidates.find(predicate)?.id ?? null

  if (object.type === 'shape_rect' || object.type === 'shape_circle') {
    const fill = normalizeColorForStyleMatch(object.shapeData.fillColor)
    const border = normalizeColorForStyleMatch(object.shapeData.borderColor)
    return findByMatch(
      (entry) =>
        normalizeColorForStyleMatch(entry.fillColor) === fill &&
        normalizeColorForStyleMatch(entry.borderColor) === border
    )
  }

  if (object.type === 'textbox') {
    const fill = normalizeColorForStyleMatch(object.textboxData.backgroundColor)
    const border = normalizeColorForStyleMatch(object.textboxData.borderColor)
    return findByMatch(
      (entry) =>
        normalizeColorForStyleMatch(entry.fillColor) === fill &&
        normalizeColorForStyleMatch(entry.borderColor) === border
    )
  }

  if (object.type === 'image') {
    const border = normalizeColorForStyleMatch(object.imageData.borderColor)
    return findByMatch((entry) => normalizeColorForStyleMatch(entry.borderColor) === border)
  }

  if (object.type === 'video') {
    const border = normalizeColorForStyleMatch(object.videoData.borderColor)
    return findByMatch((entry) => normalizeColorForStyleMatch(entry.borderColor) === border)
  }

  if (object.type === 'sound') {
    const border = normalizeColorForStyleMatch(object.soundData.borderColor)
    return findByMatch((entry) => normalizeColorForStyleMatch(entry.borderColor) === border)
  }

  return null
}

function PresentStage({
  model,
  slide,
  freeMoveEnabled,
  onNavigateNext,
  onNavigatePrevious,
}: {
  model: DocumentModel
  slide: Slide | null
  freeMoveEnabled: boolean
  onNavigateNext: () => void
  onNavigatePrevious: () => void
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const cameraLayerRef = useRef<HTMLDivElement>(null)
  const objectsLayerRef = useRef<HTMLDivElement>(null)
  const panRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    startCamera: CameraState
  } | null>(null)
  const wheelNavigateThrottleUntilRef = useRef(0)
  const autoplayTimeoutRef = useRef<number | null>(null)
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

  const safeViewport =
    viewport.width > 0 && viewport.height > 0
      ? viewport
      : {
        width: typeof window === 'undefined' ? 1 : window.innerWidth,
        height: typeof window === 'undefined' ? 1 : window.innerHeight,
      }
  const targetCamera = slide
    ? {
      x: toFiniteNumber(slide.x, 0),
      y: toFiniteNumber(slide.y, 0),
      zoom: Math.min(
        100,
        Math.max(
          0.01,
          zoomFromDiagonal(
            toFiniteNumber(
              slide.diagonal,
              diagonalFromZoom(1, safeViewport.width, safeViewport.height)
            ),
            safeViewport.width,
            safeViewport.height
          )
        )
      ),
      rotation: toFiniteNumber(slide.rotation, 0),
    }
    : { x: 0, y: 0, zoom: 1, rotation: 0 }
  const currentCameraRef = useRef<CameraState>(targetCamera)
  const previousFreeMoveEnabledRef = useRef(freeMoveEnabled)
  const cameraTransitionUntilRef = useRef(0)
  const applyCameraTransition = (transitionType: Slide['transitionType'], durationMs: number) => {
    const cameraLayer = cameraLayerRef.current
    if (!cameraLayer) {
      return
    }
    if (transitionType === 'instant' || durationMs <= 0) {
      cameraLayer.style.transition = 'none'
      cameraTransitionUntilRef.current = 0
      return
    }
    const easing = transitionType === 'linear' ? 'linear' : 'cubic-bezier(0.645, 0.045, 0.355, 1)'
    cameraLayer.style.transition = `transform ${durationMs}ms ${easing}`
    cameraTransitionUntilRef.current = performance.now() + durationMs
  }
  const applyCameraTransform = (camera: CameraState) => {
    const cameraLayer = cameraLayerRef.current
    if (!cameraLayer) {
      return
    }
    cameraLayer.style.transform =
      `translate(${safeViewport.width / 2}px, ${safeViewport.height / 2}px) ` +
      `rotate(${camera.rotation}rad) scale(${camera.zoom}) ` +
      `translate(${-camera.x}px, ${-camera.y}px)`
  }

  useEffect(() => {
    const wasFreeMoveEnabled = previousFreeMoveEnabledRef.current
    previousFreeMoveEnabledRef.current = freeMoveEnabled
    if (freeMoveEnabled) {
      applyCameraTransition('instant', 0)
      return
    }
    if (!freeMoveEnabled && wasFreeMoveEnabled) {
      applyCameraTransition('instant', 0)
      currentCameraRef.current = targetCamera
      applyCameraTransform(targetCamera)
    }
  }, [freeMoveEnabled, targetCamera])

  useEffect(() => {
    applyCameraTransition('instant', 0)
    applyCameraTransform(currentCameraRef.current)
  }, [safeViewport.height, safeViewport.width])

  useEffect(() => {
    const transitionType = slide?.transitionType ?? 'instant'
    const durationMs = slide
      ? resolveTransitionDurationMs(slide.transitionType, slide.transitionDurationMs)
      : 0
    applyCameraTransition(transitionType, durationMs)
    currentCameraRef.current = targetCamera
    applyCameraTransform(targetCamera)
  }, [
    slide?.transitionDurationMs,
    slide?.transitionType,
    targetCamera.rotation,
    targetCamera.x,
    targetCamera.y,
    targetCamera.zoom,
  ])

  useEffect(() => {
    return () => {
      if (autoplayTimeoutRef.current !== null) {
        window.clearTimeout(autoplayTimeoutRef.current)
        autoplayTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (autoplayTimeoutRef.current !== null) {
      window.clearTimeout(autoplayTimeoutRef.current)
      autoplayTimeoutRef.current = null
    }

    if (!slide) {
      return
    }

    const delayMs = freeMoveEnabled
      ? 0
      : resolveTransitionDurationMs(slide.transitionType, slide.transitionDurationMs)
    autoplayTimeoutRef.current = window.setTimeout(() => {
      const objectsLayer = objectsLayerRef.current
      if (!objectsLayer) {
        return
      }
      const slideId = slide.id

      const videos = Array.from(objectsLayer.querySelectorAll('video[data-autoplay-slide-id]'))
      videos.forEach((video) => {
        if (!(video instanceof HTMLVideoElement) || video.dataset.autoplaySlideId !== slideId) {
          return
        }
        try {
          video.currentTime = 0
        } catch {
          // Ignore if setting currentTime is blocked.
        }
        void video.play().catch(() => undefined)
      })

      const audios = Array.from(objectsLayer.querySelectorAll('audio[data-autoplay-slide-id]'))
      audios.forEach((audio) => {
        if (!(audio instanceof HTMLAudioElement) || audio.dataset.autoplaySlideId !== slideId) {
          return
        }
        try {
          audio.currentTime = 0
        } catch {
          // Ignore if setting currentTime is blocked.
        }
        void audio.play().catch(() => undefined)
      })
    }, Math.max(0, delayMs))

    return () => {
      if (autoplayTimeoutRef.current !== null) {
        window.clearTimeout(autoplayTimeoutRef.current)
        autoplayTimeoutRef.current = null
      }
    }
  }, [freeMoveEnabled, model.objects, slide])

  useEffect(() => {
    const objectsLayer = objectsLayerRef.current
    if (!objectsLayer) {
      return
    }

    const assetsById = Object.fromEntries(
      model.assets.map((asset) => [asset.id, asset])
    ) as Record<string, { name: string; mimeType: string; dataBase64: string }>
    const isTransitioning = !freeMoveEnabled && performance.now() < cameraTransitionUntilRef.current
    const startBounds = getPresentVisibleWorldBounds(currentCameraRef.current, safeViewport)
    const endBounds = getPresentVisibleWorldBounds(targetCamera, safeViewport)
    const mergedBounds = mergePresentWorldBounds(startBounds, endBounds)
    const minZoom = Math.max(
      0.01,
      Math.min(currentCameraRef.current.zoom, targetCamera.zoom)
    )
    const transitionPadding = Math.hypot(safeViewport.width, safeViewport.height) / (2 * minZoom)
    const cullingBounds = expandPresentWorldBounds(mergedBounds, transitionPadding)
    buildPresentationScene({
      documentRef: objectsLayer.ownerDocument,
      layer: objectsLayer,
      objects: model.objects,
      assetsById,
      objectClassPrefix: 'present',
      textboxHtmlResolver: (object) => resolveTextboxRichHtml(object.textboxData),
      textboxBaseStyleResolver: (object) => resolveTextboxBaseTextStyle(object.textboxData),
      enableCulling: !freeMoveEnabled && !isTransitioning,
      cullingBounds: !freeMoveEnabled && !isTransitioning ? cullingBounds : null,
    })
    applyCameraTransform(currentCameraRef.current)
  }, [
    freeMoveEnabled,
    model.assets,
    model.objects,
    safeViewport.height,
    safeViewport.width,
    targetCamera.rotation,
    targetCamera.x,
    targetCamera.y,
    targetCamera.zoom,
  ])

  function handlePresentStagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.defaultPrevented) {
      return
    }
    if (!freeMoveEnabled && isInteractivePointerTarget(event.target)) {
      return
    }
    if (freeMoveEnabled) {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      panRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startCamera: currentCameraRef.current,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    if (event.button === 0) {
      event.preventDefault()
      onNavigateNext()
      return
    }

    if (event.button === 2) {
      event.preventDefault()
      onNavigatePrevious()
    }
  }

  function handlePresentStagePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!freeMoveEnabled) {
      return
    }
    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) {
      return
    }

    event.preventDefault()
    const deltaWorld = cameraDragDeltaToWorld(
      {
        x: event.clientX - pan.startClientX,
        y: event.clientY - pan.startClientY,
      },
      pan.startCamera
    )
    const nextCamera: CameraState = {
      ...pan.startCamera,
      x: pan.startCamera.x - deltaWorld.x,
      y: pan.startCamera.y - deltaWorld.y,
    }
    currentCameraRef.current = nextCamera
    applyCameraTransform(nextCamera)
  }

  function handlePresentStagePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!freeMoveEnabled) {
      return
    }
    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) {
      return
    }
    panRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handlePresentStageWheel = useCallback(
    (event: globalThis.WheelEvent) => {
      if (event.defaultPrevented) {
        return
      }
      event.preventDefault()

      if (freeMoveEnabled) {
        const stageBounds = stageRef.current?.getBoundingClientRect()
        const pointerScreen = stageBounds
          ? {
            x: event.clientX - stageBounds.left,
            y: event.clientY - stageBounds.top,
          }
          : {
            x: safeViewport.width / 2,
            y: safeViewport.height / 2,
          }
        const startCamera = currentCameraRef.current
        const worldBefore = screenToWorldPresent(pointerScreen, startCamera, safeViewport)
        if (event.altKey) {
          const rotationDelta = Math.max(
            -PRESENT_FREE_MOVE_ROTATION_STEP_RAD * 6,
            Math.min(
              PRESENT_FREE_MOVE_ROTATION_STEP_RAD * 6,
              (event.deltaY / 120) * PRESENT_FREE_MOVE_ROTATION_STEP_RAD
            )
          )
          if (Math.abs(rotationDelta) < 0.0001) {
            return
          }
          const rotatedCamera: CameraState = {
            ...startCamera,
            rotation: startCamera.rotation + rotationDelta,
          }
          const worldAfter = screenToWorldPresent(pointerScreen, rotatedCamera, safeViewport)
          const nextCamera: CameraState = {
            ...rotatedCamera,
            x: rotatedCamera.x + (worldBefore.x - worldAfter.x),
            y: rotatedCamera.y + (worldBefore.y - worldAfter.y),
          }
          currentCameraRef.current = nextCamera
          applyCameraTransform(nextCamera)
          return
        }
        const zoomFactor = event.deltaY > 0 ? 0.92 : 1.08
        const nextZoom = Math.max(0.05, Math.min(100, startCamera.zoom * zoomFactor))
        const nextCamera: CameraState = {
          ...startCamera,
          zoom: nextZoom,
        }
        const worldAfter = screenToWorldPresent(pointerScreen, nextCamera, safeViewport)
        const anchoredCamera: CameraState = {
          ...nextCamera,
          x: nextCamera.x + (worldBefore.x - worldAfter.x),
          y: nextCamera.y + (worldBefore.y - worldAfter.y),
        }
        currentCameraRef.current = anchoredCamera
        applyCameraTransform(anchoredCamera)
        return
      }

      const now = performance.now()
      if (now < wheelNavigateThrottleUntilRef.current) {
        return
      }
      if (Math.abs(event.deltaY) < 6) {
        return
      }
      wheelNavigateThrottleUntilRef.current = now + 220
      if (event.deltaY > 0) {
        onNavigateNext()
        return
      }
      onNavigatePrevious()
    },
    [freeMoveEnabled, onNavigateNext, onNavigatePrevious, safeViewport.height, safeViewport.width]
  )

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) {
      return
    }

    const onWheel = (event: globalThis.WheelEvent) => {
      handlePresentStageWheel(event)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      stage.removeEventListener('wheel', onWheel)
    }
  }, [handlePresentStageWheel])

  return (
    <div
      ref={stageRef}
      className={`present-stage ${freeMoveEnabled ? 'free-move-enabled' : ''}`}
      style={{ background: model.canvas.background }}
      onPointerDown={handlePresentStagePointerDown}
      onPointerMove={handlePresentStagePointerMove}
      onPointerUp={handlePresentStagePointerUp}
      onContextMenu={(event) => {
        if (event.defaultPrevented) {
          return
        }
        if (!freeMoveEnabled) {
          event.preventDefault()
        }
      }}
    >
      <div ref={cameraLayerRef} className="present-stage-camera">
        <div ref={objectsLayerRef} className="present-stage-objects" />
      </div>
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

interface LibraryAssetDefinition {
  name: string
  mimeType: string
  dataBase64: string
  intrinsicWidth?: number | null
  intrinsicHeight?: number | null
  durationSec?: number | null
}

interface TypedDesignBundleExtraction {
  styles: StylePresetDefinition[]
  templates: SlideTemplateDefinition[]
  assets: LibraryAssetDefinition[]
}

function parseDataUrlAssetPayload(value: string): { mimeType: string; dataBase64: string } | null {
  const match = value.trim().match(/^data:([^;,]+);base64,(.+)$/i)
  if (!match) {
    return null
  }
  return {
    mimeType: match[1].trim().toLowerCase(),
    dataBase64: match[2].trim(),
  }
}

function parseLibraryAssetDefinitionFromUnknown(payload: unknown): LibraryAssetDefinition | null {
  const record = asRecord(payload)
  if (!record) {
    return null
  }

  const nestedAsset = asRecord(record.asset)
  const source = nestedAsset ?? record

  const parsedDataUrl =
    typeof source.dataUrl === 'string' && source.dataUrl.trim().length > 0
      ? parseDataUrlAssetPayload(source.dataUrl)
      : null
  const explicitBase64 =
    typeof source.dataBase64 === 'string' && source.dataBase64.trim().length > 0
      ? source.dataBase64.trim()
      : null
  const mimeType =
    (typeof source.mimeType === 'string' && source.mimeType.trim().length > 0
      ? source.mimeType.trim().toLowerCase()
      : parsedDataUrl?.mimeType) ?? ''
  const dataBase64 = explicitBase64 ?? parsedDataUrl?.dataBase64 ?? ''
  const name = typeof source.name === 'string' ? source.name.trim() : ''
  if (!name || !mimeType || !dataBase64) {
    return null
  }

  const kind = resolveLibraryAssetKind({ mimeType, name })
  if (!kind || kind === 'style') {
    return null
  }

  const intrinsicWidth =
    typeof source.intrinsicWidth === 'number' && Number.isFinite(source.intrinsicWidth) && source.intrinsicWidth > 0
      ? source.intrinsicWidth
      : null
  const intrinsicHeight =
    typeof source.intrinsicHeight === 'number' && Number.isFinite(source.intrinsicHeight) && source.intrinsicHeight > 0
      ? source.intrinsicHeight
      : null
  const durationSec =
    typeof source.durationSec === 'number' && Number.isFinite(source.durationSec) && source.durationSec >= 0
      ? source.durationSec
      : null

  return {
    name,
    mimeType,
    dataBase64,
    intrinsicWidth,
    intrinsicHeight,
    durationSec,
  }
}

function extractTypedDesignBundleFromUnknown(payload: unknown): TypedDesignBundleExtraction | null {
  if (!Array.isArray(payload)) {
    return null
  }

  const styles: StylePresetDefinition[] = []
  const templates: SlideTemplateDefinition[] = []
  const assets: LibraryAssetDefinition[] = []
  let hasTypedItems = false

  for (const item of payload) {
    const record = asRecord(item)
    if (!record || typeof record.type !== 'string') {
      continue
    }
    hasTypedItems = true
    const itemType = record.type.trim().toLowerCase()
    if (itemType === 'style') {
      const candidate = asRecord(record.style) ?? asRecord(record.definition) ?? asRecord(record.value) ?? record
      if (isStylePresetDefinition(candidate)) {
        styles.push(candidate)
      }
      continue
    }
    if (itemType === 'template') {
      const candidate =
        asRecord(record.template) ?? asRecord(record.definition) ?? asRecord(record.value) ?? record
      if (isSlideTemplateDefinition(candidate)) {
        templates.push(candidate)
      }
      continue
    }
    if (itemType === 'asset') {
      const parsed = parseLibraryAssetDefinitionFromUnknown(record)
      if (parsed) {
        assets.push(parsed)
      }
    }
  }

  if (!hasTypedItems) {
    return null
  }

  return {
    styles,
    templates,
    assets,
  }
}

function extractStylePresetDefinitionsFromUnknown(payload: unknown): StylePresetDefinition[] {
  const typedBundle = extractTypedDesignBundleFromUnknown(payload)
  if (typedBundle) {
    return typedBundle.styles
  }
  if (isStylePresetDefinition(payload)) {
    return [payload]
  }
  if (Array.isArray(payload)) {
    return payload.filter(isStylePresetDefinition)
  }
  const record = asRecord(payload)
  if (!record) {
    return []
  }
  if (isStylePresetDefinition(record.preset)) {
    return [record.preset]
  }
  if (Array.isArray(record.stylePresets)) {
    return record.stylePresets.filter(isStylePresetDefinition)
  }
  if (Array.isArray(record.styles)) {
    return record.styles.filter(isStylePresetDefinition)
  }
  return []
}

function extractSlideTemplateDefinitionsFromUnknown(payload: unknown): SlideTemplateDefinition[] {
  const typedBundle = extractTypedDesignBundleFromUnknown(payload)
  if (typedBundle) {
    return typedBundle.templates
  }
  if (isSlideTemplateDefinition(payload)) {
    return [payload]
  }
  if (Array.isArray(payload)) {
    return payload.filter(isSlideTemplateDefinition)
  }
  const record = asRecord(payload)
  if (!record) {
    return []
  }
  if (isSlideTemplateDefinition(record.template)) {
    return [record.template]
  }
  if (Array.isArray(record.slideTemplates)) {
    return record.slideTemplates.filter(isSlideTemplateDefinition)
  }
  if (Array.isArray(record.templates)) {
    return record.templates.filter(isSlideTemplateDefinition)
  }
  return []
}

function extractLibraryAssetDefinitionsFromUnknown(payload: unknown): LibraryAssetDefinition[] {
  const typedBundle = extractTypedDesignBundleFromUnknown(payload)
  if (typedBundle) {
    return typedBundle.assets
  }
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => parseLibraryAssetDefinitionFromUnknown(entry))
      .filter((entry): entry is LibraryAssetDefinition => Boolean(entry))
  }
  const record = asRecord(payload)
  if (!record) {
    return []
  }
  if (Array.isArray(record.assets)) {
    return record.assets
      .map((entry) => parseLibraryAssetDefinitionFromUnknown(entry))
      .filter((entry): entry is LibraryAssetDefinition => Boolean(entry))
  }
  if (Array.isArray(record.libraryAssets)) {
    return record.libraryAssets
      .map((entry) => parseLibraryAssetDefinitionFromUnknown(entry))
      .filter((entry): entry is LibraryAssetDefinition => Boolean(entry))
  }
  const single = parseLibraryAssetDefinitionFromUnknown(record)
  return single ? [single] : []
}

function registerDesignAssetDefinitionsFromPayload(
  payload: unknown,
  sourceFileName: string | null,
  sourceAssetId: string | null = null
): {
  styleAdded: number
  styleDuplicates: number
  styleRejected: number
  templateAdded: number
  templateDuplicates: number
  templateRejected: number
} {
  const styleDefinitions = extractStylePresetDefinitionsFromUnknown(payload)
  const templateDefinitions = extractSlideTemplateDefinitionsFromUnknown(payload)

  let styleAdded = 0
  let styleDuplicates = 0
  let styleRejected = 0
  let templateAdded = 0
  let templateDuplicates = 0
  let templateRejected = 0

  for (const definition of styleDefinitions) {
    const result = registerRuntimeStylePresetDefinition(definition, { sourceFileName, sourceAssetId })
    if (result.added) {
      styleAdded += 1
    } else if (result.reason === 'duplicate-id') {
      styleDuplicates += 1
    } else {
      styleRejected += 1
    }
  }

  for (const definition of templateDefinitions) {
    const result = registerRuntimeSlideTemplateDefinition(definition, { sourceFileName, sourceAssetId })
    if (result.added) {
      templateAdded += 1
    } else if (result.reason === 'duplicate-id') {
      templateDuplicates += 1
    } else {
      templateRejected += 1
    }
  }

  return {
    styleAdded,
    styleDuplicates,
    styleRejected,
    templateAdded,
    templateDuplicates,
    templateRejected,
  }
}

function decodeAssetBase64ToText(dataBase64: string): string {
  const binary = window.atob(dataBase64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function isInteractivePointerTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null
  if (!element) {
    return false
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    return true
  }
  if (element.closest('.present-object.video, .present-object.sound, video, audio')) {
    return true
  }
  return Boolean(
    element.closest(
      'button,input,textarea,select,option,label,a[href],[contenteditable="true"],[role="button"]'
    )
  )
}

function isTextInputTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null
  if (!element) {
    return false
  }

  const tagName = element.tagName.toLowerCase()
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true
  }

  return element instanceof HTMLElement ? element.isContentEditable : false
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

function getBorderWidthLabel(width: number): string {
  if (width <= 0) {
    return 'None'
  }
  return `${width}px`
}

function normalizeShadowAngleDeg(value: number): number {
  let normalized = Number.isFinite(value) ? value : 45
  while (normalized > 180) {
    normalized -= 360
  }
  while (normalized < -180) {
    normalized += 360
  }
  return normalized
}

function normalizeRotationRadians(value: number): number {
  let normalized = Number.isFinite(value) ? value : 0
  const fullTurn = Math.PI * 2
  while (normalized > Math.PI) {
    normalized -= fullTurn
  }
  while (normalized <= -Math.PI) {
    normalized += fullTurn
  }
  return normalized
}

function getObjectWorldAabb(object: CanvasObject) {
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

function getObjectsWorldAabb(objects: CanvasObject[]) {
  if (objects.length === 0) {
    return null
  }

  const first = getObjectWorldAabb(objects[0])
  const bounds = {
    minX: first.minX,
    minY: first.minY,
    maxX: first.maxX,
    maxY: first.maxY,
  }

  for (const object of objects.slice(1)) {
    const objectBounds = getObjectWorldAabb(object)
    bounds.minX = Math.min(bounds.minX, objectBounds.minX)
    bounds.minY = Math.min(bounds.minY, objectBounds.minY)
    bounds.maxX = Math.max(bounds.maxX, objectBounds.maxX)
    bounds.maxY = Math.max(bounds.maxY, objectBounds.maxY)
  }

  return bounds
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
      <div className="object-param-color-chip-wrap">
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
      </div>
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

function SlideTemplatePreview({
  objects,
  frameWidth,
  frameHeight,
}: {
  objects: CanvasObject[]
  frameWidth: number
  frameHeight: number
}) {
  const orderedObjects = [...objects].sort((a, b) => a.zIndex - b.zIndex)

  return (
    <svg
      className="slide-template-preview-canvas"
      viewBox={`0 0 ${frameWidth} ${frameHeight}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {orderedObjects.map((object) => {
        if (object.type === 'group') {
          return null
        }

        const left = object.x - object.w / 2 + frameWidth / 2
        const top = object.y - object.h / 2 + frameHeight / 2

        if (object.type === 'shape_rect' || object.type === 'shape_circle') {
          return (
            <foreignObject
              key={object.id}
              x={left}
              y={top}
              width={object.w}
              height={object.h}
            >
              <div
                className="slide-template-preview-node"
                style={{
                  position: 'relative',
                  opacity: object.shapeData.opacityPercent / 100,
                }}
              >
                <ShapeSvg
                  shapeType={object.type}
                  shapeData={object.shapeData}
                  width={object.w}
                  height={object.h}
                  borderScale={resolveObjectBorderScale(object.scalePercent)}
                  fillBackground={getShapeBackground(object.shapeData)}
                  className="shape-svg-outline"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    overflow: 'visible',
                  }}
                />
              </div>
            </foreignObject>
          )
        }

        if (object.type === 'video') {
          return (
            <foreignObject
              key={object.id}
              x={left}
              y={top}
              width={object.w}
              height={object.h}
            >
              <div
                className="slide-template-preview-node slide-template-preview-video"
                style={{
                  borderColor: object.videoData.borderColor,
                  borderStyle: object.videoData.borderType,
                  borderWidth: `${object.videoData.borderWidth * resolveObjectBorderScale(object.scalePercent)}px`,
                  borderRadius: `${object.videoData.radius}px`,
                  opacity: object.videoData.opacityPercent / 100,
                }}
              >
                <span>VIDEO</span>
              </div>
            </foreignObject>
          )
        }

        if (object.type === 'sound') {
          return (
            <foreignObject
              key={object.id}
              x={left}
              y={top}
              width={object.w}
              height={object.h}
            >
              <div
                className="slide-template-preview-node slide-template-preview-sound"
                style={{
                  borderColor: object.soundData.borderColor,
                  borderStyle: object.soundData.borderType,
                  borderWidth: `${object.soundData.borderWidth * resolveObjectBorderScale(object.scalePercent)}px`,
                  borderRadius: `${object.soundData.radius}px`,
                  opacity: object.soundData.opacityPercent / 100,
                }}
              >
                <FontAwesomeIcon icon={faVolumeHigh} />
                <span>SOUND</span>
              </div>
            </foreignObject>
          )
        }

        if (object.type === 'image') {
          return null
        }

        if (object.type === 'template_placeholder') {
          return (
            <foreignObject
              key={object.id}
              x={left}
              y={top}
              width={object.w}
              height={object.h}
            >
              <div
                className={`slide-template-preview-node slide-template-preview-placeholder kind-${object.templatePlaceholderData.kind}`}
              >
                <span>{getTemplatePlaceholderBadge(object.templatePlaceholderData.kind)}</span>
                <strong>{object.templatePlaceholderData.prompt}</strong>
              </div>
            </foreignObject>
          )
        }

        const textboxBaseStyle = resolveTextboxBaseTextStyle(object.textboxData)
        const textboxContentScale = resolveTextboxObjectScale(object.textboxData, object.scalePercent)
        const textboxVerticalAlignment = object.textboxData.verticalAlignment ?? 'top'
        return (
          <foreignObject
            key={object.id}
            x={left}
            y={top}
            width={object.w}
            height={object.h}
          >
            <div
              className={`slide-template-preview-node textbox align-${object.textboxData.alignment}`}
              style={{
                background: getTextboxBackground(object.textboxData),
                borderColor: object.textboxData.borderColor,
                borderStyle: object.textboxData.borderType,
                borderWidth: `${object.textboxData.borderWidth * resolveObjectBorderScale(object.scalePercent)}px`,
                borderRadius: `${object.textboxData.radius}px`,
                color: textboxBaseStyle.textColor,
                fontFamily: textboxBaseStyle.fontFamily,
                opacity: object.textboxData.opacityPercent / 100,
              }}
            >
              <div
                className={`slide-template-preview-richtext v-align-${textboxVerticalAlignment}`}
                style={{
                  transform: `scale(${textboxContentScale})`,
                  transformOrigin: 'top left',
                  width: `${100 / textboxContentScale}%`,
                  height: `${100 / textboxContentScale}%`,
                }}
                dangerouslySetInnerHTML={{ __html: resolveTextboxRichHtml(object.textboxData) }}
              />
            </div>
          </foreignObject>
        )
      })}
    </svg>
  )
}

function AssetVideoPreview({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  function seekToPreviewStart() {
    const video = videoRef.current
    if (!video) {
      return
    }
    if (Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = Math.max(0, Math.min(video.duration, video.duration * 0.1))
    }
  }

  return (
    <span
      className="asset-library-video-preview"
      onPointerEnter={() => {
        const video = videoRef.current
        if (!video) {
          return
        }
        seekToPreviewStart()
        void video.play().catch(() => undefined)
      }}
      onPointerLeave={() => {
        const video = videoRef.current
        if (!video) {
          return
        }
        video.pause()
        seekToPreviewStart()
      }}
    >
      <video
        ref={videoRef}
        src={src}
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedMetadata={seekToPreviewStart}
      />
    </span>
  )
}

function App() {
  const loadInputRef = useRef<HTMLInputElement>(null)
  const assetLibraryInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const soundInputRef = useRef<HTMLInputElement>(null)
  const didAttemptAutosaveRestoreRef = useRef(false)
  const latestDocumentSnapshotRef = useRef<string>('')
  const latestAutosavedSnapshotRef = useRef<string>('')

  const document = useEditorStore((state) => state.document)
  const camera = useEditorStore((state) => state.camera)
  const setCamera = useEditorStore((state) => state.setCamera)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const canUndo = useEditorStore((state) => state.history.past.length > 0)
  const canRedo = useEditorStore((state) => state.history.future.length > 0)
  const replaceDocument = useEditorStore((state) => state.replaceDocument)
  const resetDocument = useEditorStore((state) => state.resetDocument)
  const mode = useEditorStore((state) => state.ui.mode)
  const setMode = useEditorStore((state) => state.setMode)
  const selectedObjectIds = useEditorStore((state) => state.ui.selectedObjectIds)
  const selectObjects = useEditorStore((state) => state.selectObjects)
  const activeGroupId = useEditorStore((state) => state.ui.activeGroupId)
  const createObject = useEditorStore((state) => state.createObject)
  const createAsset = useEditorStore((state) => state.createAsset)
  const deleteAsset = useEditorStore((state) => state.deleteAsset)
  const beginCommandBatch = useEditorStore((state) => state.beginCommandBatch)
  const commitCommandBatch = useEditorStore((state) => state.commitCommandBatch)
  const moveObject = useEditorStore((state) => state.moveObject)
  const groupObjects = useEditorStore((state) => state.groupObjects)
  const ungroupObjects = useEditorStore((state) => state.ungroupObjects)
  const toggleObjectLock = useEditorStore((state) => state.toggleObjectLock)
  const setObjectKeepAspectRatio = useEditorStore((state) => state.setObjectKeepAspectRatio)
  const setCanvasBackground = useEditorStore((state) => state.setCanvasBackground)
  const setCanvasSettings = useEditorStore((state) => state.setCanvasSettings)
  const setTextboxData = useEditorStore((state) => state.setTextboxData)
  const setShapeOpacity = useEditorStore((state) => state.setShapeOpacity)
  const setShapeData = useEditorStore((state) => state.setShapeData)
  const setImageData = useEditorStore((state) => state.setImageData)
  const setVideoData = useEditorStore((state) => state.setVideoData)
  const setSoundData = useEditorStore((state) => state.setSoundData)
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
  const selectedObjectScaleBaselineRef = useRef<ObjectScaleBaseline | null>(null)
  const multiSelectionScaleBaselineRef = useRef<{
    selectionKey: string
    centerX: number
    centerY: number
    objects: ObjectScaleBaseline[]
  } | null>(null)
  const [hoveredSlideId, setHoveredSlideId] = useState<string | null>(null)
  const [hoveredAssetId, setHoveredAssetId] = useState<string | null>(null)
  const presentFreeMoveEnabled = false
  const presentMouseWheelThrottleUntilRef = useRef(0)
  const [isFillEditorOpen, setIsFillEditorOpen] = useState(false)
  const [fillEditorTarget, setFillEditorTarget] = useState<'object' | 'canvas' | null>(null)
  const [activeStylePresetId, setActiveStylePresetId] = useState<string | null>(null)
  const [designAssetRevision, setDesignAssetRevision] = useState(0)
  const [designAssetContextMenu, setDesignAssetContextMenu] = useState<DesignAssetContextMenu | null>(
    null
  )
  const [activeCreationTool, setActiveCreationTool] = useState<CreationToolType | null>(null)
  const [isAssetLibraryDragOver, setIsAssetLibraryDragOver] = useState(false)
  const [assetLibrarySearch, setAssetLibrarySearch] = useState('')
  const [assetLibraryFilter, setAssetLibraryFilter] = useState<AssetLibraryFilter>(null)
  const [assetLibrarySort, setAssetLibrarySort] = useState<AssetLibrarySort>('name')
  const [assetLibrarySortDirection, setAssetLibrarySortDirection] =
    useState<AssetLibrarySortDirection>('asc')
  const [isAssetBundlerOpen, setIsAssetBundlerOpen] = useState(false)
  const [bundlerCheckedStyles, setBundlerCheckedStyles] = useState<Set<string>>(new Set())
  const [bundlerCheckedTemplates, setBundlerCheckedTemplates] = useState<Set<string>>(new Set())
  const [bundlerCheckedAssets, setBundlerCheckedAssets] = useState<Set<string>>(new Set())
  const [styleCatalogSearch, setStyleCatalogSearch] = useState('')
  const [styleCatalogSortDirection, setStyleCatalogSortDirection] =
    useState<AssetLibrarySortDirection>('asc')
  const [templateCatalogSearch, setTemplateCatalogSearch] = useState('')
  const [templateCatalogSortDirection, setTemplateCatalogSortDirection] =
    useState<AssetLibrarySortDirection>('asc')
  const [activeShapePresetId, setActiveShapePresetId] = useState<ShapeCreationPresetId>('rect')
  const [pendingImagePlacements, setPendingImagePlacements] = useState<PendingImagePlacement[]>([])
  const [selectedObjectScalePercent, setSelectedObjectScalePercent] = useState(100)
  const [multiSelectionScalePercent, setMultiSelectionScalePercent] = useState(100)
  const [activeDesignTab, setActiveDesignTab] = useState<RightSidebarDesignTab>('templates')
  const [isLeftSidebarHidden, setIsLeftSidebarHidden] = useState(false)
  const [isRightSidebarHidden, setIsRightSidebarHidden] = useState(false)
  const [leftObjectParamsPortalNode, setLeftObjectParamsPortalNode] = useState<HTMLDivElement | null>(null)
  const [slidesTargetDisplayPortalNode, setSlidesTargetDisplayPortalNode] = useState<HTMLDivElement | null>(null)
  const [templateTargetDisplayFrame, setTemplateTargetDisplayFrame] = useState<{ width: number; height: number }>({
    width: 1600,
    height: 900,
  })
  const [templateTargetDisplayFittedFrame, setTemplateTargetDisplayFittedFrame] = useState<{ width: number; height: number }>({
    width: 1600,
    height: 900,
  })
  const handleTargetDisplayFrameChange = useCallback(
    (frame: { width: number; height: number; fittedWidth: number; fittedHeight: number }) => {
      setTemplateTargetDisplayFrame({ width: frame.width, height: frame.height })
      setTemplateTargetDisplayFittedFrame({
        width: frame.fittedWidth,
        height: frame.fittedHeight,
      })
    },
    []
  )
  const [isShapeMenuOpen, setIsShapeMenuOpen] = useState(false)
  const shapeMenuRef = useRef<HTMLDivElement | null>(null)
  const stylePresetCatalogEntries = useMemo(() => getStylePresetCatalogEntries(), [designAssetRevision])
  const availableStylePresets = useMemo(
    () => stylePresetCatalogEntries.map((entry) => entry.preset),
    [stylePresetCatalogEntries]
  )
  const inferredStylePreset = useMemo(
    () => inferStylePreset(document, availableStylePresets),
    [availableStylePresets, document]
  )
  const currentStylePreset = useMemo(
    () =>
      availableStylePresets.find((preset) => preset.id === activeStylePresetId) ?? inferredStylePreset,
    [activeStylePresetId, availableStylePresets, inferredStylePreset]
  )
  const effectiveStylePreset = currentStylePreset ?? availableStylePresets[0] ?? null
  const assetFontFaceCss = useMemo(() => buildAssetFontFaceCss(document.assets), [document.assets])
  const slideTemplateTheme = useMemo(
    () => resolveSlideTemplateTheme(effectiveStylePreset),
    [effectiveStylePreset]
  )
  const slideTemplateCatalogEntries = useMemo(
    () => getSlideTemplateCatalogEntries(),
    [designAssetRevision]
  )
  const slideTemplateCatalogEntryById = useMemo(
    () => new Map(slideTemplateCatalogEntries.map((entry) => [entry.definition.id, entry])),
    [slideTemplateCatalogEntries]
  )
  const slideTemplateSets = useMemo(
    () => getSlideTemplatesForStyle(),
    [designAssetRevision]
  )
  const genericSlideTemplates = useMemo(
    () =>
      slideTemplateSets.generic.filter(
        (template) => slideTemplateCatalogEntryById.get(template.id)?.sourceType !== 'asset'
      ),
    [slideTemplateCatalogEntryById, slideTemplateSets.generic]
  )
  const importedTemplateSections = useMemo(() => {
    const grouped = new Map<string, SlideTemplate[]>()
    for (const template of slideTemplateSets.all) {
      const entry = slideTemplateCatalogEntryById.get(template.id)
      if (!entry || entry.sourceType !== 'asset') {
        continue
      }
      const sourceFileName = entry.sourceFileName ?? 'Imported JSON'
      const current = grouped.get(sourceFileName)
      if (current) {
        current.push(template)
      } else {
        grouped.set(sourceFileName, [template])
      }
    }
    return [...grouped.entries()].map(([fileName, templates]) => ({ fileName, templates }))
  }, [slideTemplateCatalogEntryById, slideTemplateSets.all])
  const builtinStylePresets = useMemo(
    () => stylePresetCatalogEntries.filter((entry) => entry.sourceType === 'builtin').map((entry) => entry.preset),
    [stylePresetCatalogEntries]
  )
  const importedStylePresetSections = useMemo(() => {
    const grouped = new Map<string, StylePreset[]>()
    for (const entry of stylePresetCatalogEntries) {
      if (entry.sourceType !== 'asset') {
        continue
      }
      const sourceFileName = entry.sourceFileName ?? 'Imported JSON'
      const current = grouped.get(sourceFileName)
      if (current) {
        current.push(entry.preset)
      } else {
        grouped.set(sourceFileName, [entry.preset])
      }
    }
    return [...grouped.entries()].map(([fileName, presets]) => ({ fileName, presets }))
  }, [stylePresetCatalogEntries])
  const filteredBuiltinStylePresets = useMemo(() => {
    const normalizedSearch = styleCatalogSearch.trim().toLowerCase()
    const filtered = builtinStylePresets.filter((preset) => {
      if (normalizedSearch.length === 0) {
        return true
      }
      return (
        preset.name.toLowerCase().includes(normalizedSearch) ||
        preset.inspiration.toLowerCase().includes(normalizedSearch)
      )
    })
    filtered.sort((a, b) => {
      const comparison = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      return styleCatalogSortDirection === 'desc' ? comparison * -1 : comparison
    })
    return filtered
  }, [builtinStylePresets, styleCatalogSearch, styleCatalogSortDirection])
  const filteredImportedStylePresetSections = useMemo(() => {
    const normalizedSearch = styleCatalogSearch.trim().toLowerCase()
    return importedStylePresetSections
      .map((section) => {
        const presets = section.presets.filter((preset) => {
          if (normalizedSearch.length === 0) {
            return true
          }
          return (
            preset.name.toLowerCase().includes(normalizedSearch) ||
            preset.inspiration.toLowerCase().includes(normalizedSearch)
          )
        })
        presets.sort((a, b) => {
          const comparison = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
          return styleCatalogSortDirection === 'desc' ? comparison * -1 : comparison
        })
        return {
          fileName: section.fileName,
          presets,
        }
      })
      .filter((section) => section.presets.length > 0)
  }, [importedStylePresetSections, styleCatalogSearch, styleCatalogSortDirection])
  const filteredGenericSlideTemplates = useMemo(() => {
    const normalizedSearch = templateCatalogSearch.trim().toLowerCase()
    const filtered = genericSlideTemplates.filter((template) => {
      if (normalizedSearch.length === 0) {
        return true
      }
      return (
        template.name.toLowerCase().includes(normalizedSearch) ||
        template.description.toLowerCase().includes(normalizedSearch)
      )
    })
    filtered.sort((a, b) => {
      const comparison = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      return templateCatalogSortDirection === 'desc' ? comparison * -1 : comparison
    })
    return filtered
  }, [genericSlideTemplates, templateCatalogSearch, templateCatalogSortDirection])
  const filteredImportedTemplateSections = useMemo(() => {
    const normalizedSearch = templateCatalogSearch.trim().toLowerCase()
    return importedTemplateSections
      .map((section) => {
        const templates = section.templates.filter((template) => {
          if (normalizedSearch.length === 0) {
            return true
          }
          return (
            template.name.toLowerCase().includes(normalizedSearch) ||
            template.description.toLowerCase().includes(normalizedSearch)
          )
        })
        templates.sort((a, b) => {
          const comparison = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
          return templateCatalogSortDirection === 'desc' ? comparison * -1 : comparison
        })
        return {
          fileName: section.fileName,
          templates,
        }
      })
      .filter((section) => section.templates.length > 0)
  }, [importedTemplateSections, templateCatalogSearch, templateCatalogSortDirection])
  const availableSlideTemplates = slideTemplateSets.all
  const slideTemplatePreviews = useMemo(() => {
    const frame = getSlideTemplateFrameSize(1)
    return new Map(
      availableSlideTemplates.map((template) => {
        let previewObjectIndex = 0
        const preview = buildSlideTemplateInstance(template, {
          slideId: `preview-${template.id}`,
          orderIndex: 0,
          centerX: 0,
          centerY: 0,
          zoom: 1,
          rotation: 0,
          createId: () => `preview-${template.id}-${previewObjectIndex++}`,
          zIndexStart: 1,
          stylePreset: effectiveStylePreset,
        })
        return [
          template.id,
          {
            frameWidth: frame.width,
            frameHeight: frame.height,
            objects: preview.objects,
          },
        ] as const
      })
    )
  }, [availableSlideTemplates, effectiveStylePreset])
  const currentCreationTool = useMemo(() => {
    if (activeCreationTool === 'image') {
      return pendingImagePlacements.length > 0
        ? { type: 'image' as const, image: pendingImagePlacements[0] }
        : null
    }
    if (activeCreationTool === 'shape_rect') {
      return { type: 'shape_rect' as const, shapeKind: normalizeShapeKind(activeShapePresetId) }
    }
    return activeCreationTool ? { type: activeCreationTool } : null
  }, [activeCreationTool, activeShapePresetId, pendingImagePlacements])
  const selectedObject =
    selectedObjectIds.length === 1
      ? (document.objects.find((entry) => entry.id === selectedObjectIds[0]) ?? null)
      : null
  const objectById = useMemo(
    () => new Map(document.objects.map((object) => [object.id, object])),
    [document.objects]
  )
  const embeddedStyleAssetChildLinks = useMemo(() => {
    const parentByChildAssetId = new Map<
      string,
      {
        parentStyleAssetId: string
        parentStyleAssetName: string
      }
    >()
    const childNamesByParentStyleAssetId = new Map<string, string[]>()

    for (const asset of document.assets) {
      if (resolveLibraryAssetKind(asset) !== 'style') {
        continue
      }
      try {
        const parsed = JSON.parse(decodeAssetBase64ToText(asset.dataBase64)) as unknown
        const embeddedAssets = extractLibraryAssetDefinitionsFromUnknown(parsed)
        for (const embeddedAsset of embeddedAssets) {
          const matchingAsset = findMatchingLibraryAsset(document.assets, {
            dataBase64: embeddedAsset.dataBase64,
          })
          if (!matchingAsset || matchingAsset.id === asset.id) {
            continue
          }
          if (resolveLibraryAssetKind(matchingAsset) === 'style') {
            continue
          }
          if (parentByChildAssetId.has(matchingAsset.id)) {
            continue
          }
          parentByChildAssetId.set(matchingAsset.id, {
            parentStyleAssetId: asset.id,
            parentStyleAssetName: asset.name,
          })
          const parentNames = childNamesByParentStyleAssetId.get(asset.id)
          if (parentNames) {
            if (!parentNames.includes(matchingAsset.name)) {
              parentNames.push(matchingAsset.name)
            }
          } else {
            childNamesByParentStyleAssetId.set(asset.id, [matchingAsset.name])
          }
        }
      } catch {
        // Ignore invalid JSON in style assets.
      }
    }

    return {
      parentByChildAssetId,
      childNamesByParentStyleAssetId,
    }
  }, [document.assets])
  const assetLibraryEntries = useMemo(() => {
    const imageUsageByAssetId = new Map<string, Array<Extract<CanvasObject, { type: 'image' }>>>()
    const videoUsageByAssetId = new Map<string, Array<Extract<CanvasObject, { type: 'video' }>>>()
    const soundUsageByAssetId = new Map<string, Array<Extract<CanvasObject, { type: 'sound' }>>>()
    const fontUsageByAssetId = new Map<string, number>()
    const stylePresetNamesByAssetId = new Map<string, string[]>()
    const templateNamesByAssetId = new Map<string, string[]>()

    for (const entry of stylePresetCatalogEntries) {
      if (entry.sourceType !== 'asset' || !entry.sourceAssetId) {
        continue
      }
      const current = stylePresetNamesByAssetId.get(entry.sourceAssetId)
      if (current) {
        current.push(entry.preset.name)
      } else {
        stylePresetNamesByAssetId.set(entry.sourceAssetId, [entry.preset.name])
      }
    }

    for (const entry of slideTemplateCatalogEntries) {
      if (entry.sourceType !== 'asset' || !entry.sourceAssetId) {
        continue
      }
      const current = templateNamesByAssetId.get(entry.sourceAssetId)
      if (current) {
        current.push(entry.definition.name)
      } else {
        templateNamesByAssetId.set(entry.sourceAssetId, [entry.definition.name])
      }
    }

    document.objects.forEach((object) => {
      if (object.type === 'image') {
        const current = imageUsageByAssetId.get(object.imageData.assetId)
        if (current) {
          current.push(object)
        } else {
          imageUsageByAssetId.set(object.imageData.assetId, [object])
        }
      } else if (object.type === 'video') {
        const current = videoUsageByAssetId.get(object.videoData.assetId)
        if (current) {
          current.push(object)
        } else {
          videoUsageByAssetId.set(object.videoData.assetId, [object])
        }
      } else if (object.type === 'sound') {
        const current = soundUsageByAssetId.get(object.soundData.assetId)
        if (current) {
          current.push(object)
        } else {
          soundUsageByAssetId.set(object.soundData.assetId, [object])
        }
      } else if (object.type === 'textbox') {
        document.assets.forEach((asset) => {
          if (resolveLibraryAssetKind(asset) !== 'font') {
            return
          }
          if (!textboxUsesFontFamily(object.textboxData, resolveAssetFontFamily(asset))) {
            return
          }
          fontUsageByAssetId.set(asset.id, (fontUsageByAssetId.get(asset.id) ?? 0) + 1)
        })
      }
    })

    return document.assets.map((asset) => {
      const linkedImages = imageUsageByAssetId.get(asset.id) ?? []
      const linkedVideos = videoUsageByAssetId.get(asset.id) ?? []
      const linkedSounds = soundUsageByAssetId.get(asset.id) ?? []
      const firstImageUsage = linkedImages[0] ?? null
      const firstVideoUsage = linkedVideos[0] ?? null
      const kind = resolveLibraryAssetKind(asset) ?? 'image'
      const linkedStylePresetNames = stylePresetNamesByAssetId.get(asset.id) ?? []
      const linkedSlideTemplateNames = templateNamesByAssetId.get(asset.id) ?? []
      const parentLink = embeddedStyleAssetChildLinks.parentByChildAssetId.get(asset.id) ?? null
      const embeddedChildAssetNames =
        kind === 'style'
          ? (embeddedStyleAssetChildLinks.childNamesByParentStyleAssetId.get(asset.id) ?? [])
          : []
      const usageCount =
        kind === 'font'
          ? (fontUsageByAssetId.get(asset.id) ?? 0)
          : kind === 'video'
            ? linkedVideos.length
            : kind === 'audio'
              ? linkedSounds.length
              : kind === 'style'
                ? 0
                : linkedImages.length
      return {
        asset,
        src: buildAssetDataUrl(asset),
        intrinsicWidth:
          firstImageUsage?.imageData.intrinsicWidth ??
          firstVideoUsage?.videoData.intrinsicWidth ??
          asset.intrinsicWidth ??
          1200,
        intrinsicHeight:
          firstImageUsage?.imageData.intrinsicHeight ??
          firstVideoUsage?.videoData.intrinsicHeight ??
          asset.intrinsicHeight ??
          800,
        usageCount,
        kind,
        base64Size: asset.dataBase64.length,
        durationSec: asset.durationSec ?? null,
        linkedStylePresetNames,
        linkedSlideTemplateNames,
        parentStyleAssetId: parentLink?.parentStyleAssetId ?? null,
        parentStyleAssetName: parentLink?.parentStyleAssetName ?? null,
        embeddedChildAssetCount: embeddedChildAssetNames.length,
        embeddedChildAssetNames,
      } satisfies AssetLibraryEntry
    })
  }, [
    embeddedStyleAssetChildLinks,
    document.assets,
    document.objects,
    slideTemplateCatalogEntries,
    stylePresetCatalogEntries,
  ])
  const filteredAssetLibraryEntries = useMemo(() => {
    const normalizedSearch = assetLibrarySearch.trim().toLowerCase()
    const entries = [...assetLibraryEntries]
    const matchesFilter = (entry: AssetLibraryEntry) => {
      if (assetLibraryFilter !== null && entry.kind !== assetLibraryFilter) {
        return false
      }
      if (normalizedSearch.length === 0) {
        return true
      }
      return entry.asset.name.toLowerCase().includes(normalizedSearch)
    }

    entries.sort((a, b) => {
      let comparison = 0
      if (assetLibrarySort === 'size') {
        if (a.base64Size !== b.base64Size) {
          comparison = a.base64Size - b.base64Size
        }
      } else {
        comparison = a.asset.name.localeCompare(b.asset.name, undefined, { sensitivity: 'base' })
      }
      if (comparison === 0) {
        comparison = a.asset.name.localeCompare(b.asset.name, undefined, { sensitivity: 'base' })
      }
      return assetLibrarySortDirection === 'desc' ? comparison * -1 : comparison
    })

    const matchedAssetIds = new Set(
      entries.filter((entry) => matchesFilter(entry)).map((entry) => entry.asset.id)
    )

    for (const entry of entries) {
      if (!matchesFilter(entry) || !entry.parentStyleAssetId) {
        continue
      }
      matchedAssetIds.add(entry.parentStyleAssetId)
    }

    const childEntriesByParentId = new Map<string, AssetLibraryEntry[]>()
    for (const entry of entries) {
      if (!entry.parentStyleAssetId || !matchedAssetIds.has(entry.asset.id)) {
        continue
      }
      const siblings = childEntriesByParentId.get(entry.parentStyleAssetId)
      if (siblings) {
        siblings.push(entry)
      } else {
        childEntriesByParentId.set(entry.parentStyleAssetId, [entry])
      }
    }

    const ordered: AssetLibraryEntry[] = []
    for (const entry of entries) {
      if (entry.parentStyleAssetId) {
        continue
      }
      if (!matchedAssetIds.has(entry.asset.id)) {
        continue
      }
      ordered.push(entry)
      const children = childEntriesByParentId.get(entry.asset.id)
      if (children) {
        ordered.push(...children)
      }
    }

    return ordered
  }, [assetLibraryEntries, assetLibraryFilter, assetLibrarySearch, assetLibrarySort, assetLibrarySortDirection])
  const bundlerStyleSections = useMemo(() => {
    const grouped = new Map<string, typeof stylePresetCatalogEntries>()
    for (const entry of stylePresetCatalogEntries) {
      const fileName = entry.sourceType === 'asset'
        ? (entry.sourceFileName ?? 'Imported JSON')
        : 'Built-in styles'
      const current = grouped.get(fileName)
      if (current) {
        current.push(entry)
      } else {
        grouped.set(fileName, [entry])
      }
    }
    return [...grouped.entries()].map(([fileName, entries]) => ({ fileName, entries }))
  }, [stylePresetCatalogEntries])
  const bundlerTemplateSections = useMemo(() => {
    const grouped = new Map<string, typeof slideTemplateCatalogEntries>()
    for (const entry of slideTemplateCatalogEntries) {
      const fileName = entry.sourceType === 'asset'
        ? (entry.sourceFileName ?? 'Imported JSON')
        : 'Built-in templates'
      const current = grouped.get(fileName)
      if (current) {
        current.push(entry)
      } else {
        grouped.set(fileName, [entry])
      }
    }
    return [...grouped.entries()].map(([fileName, entries]) => ({ fileName, entries }))
  }, [slideTemplateCatalogEntries])
  const bundlerAssetTree = useMemo(() => {
    const childrenByParent = new Map<string, AssetLibraryEntry[]>()
    const roots: AssetLibraryEntry[] = []
    for (const entry of assetLibraryEntries) {
      if (!entry.parentStyleAssetId) {
        roots.push(entry)
        continue
      }
      const current = childrenByParent.get(entry.parentStyleAssetId)
      if (current) {
        current.push(entry)
      } else {
        childrenByParent.set(entry.parentStyleAssetId, [entry])
      }
    }
    roots.sort((a, b) => a.asset.name.localeCompare(b.asset.name, undefined, { sensitivity: 'base' }))
    for (const siblings of childrenByParent.values()) {
      siblings.sort((a, b) => a.asset.name.localeCompare(b.asset.name, undefined, { sensitivity: 'base' }))
    }
    return roots.map((root) => ({
      root,
      children: childrenByParent.get(root.asset.id) ?? [],
    }))
  }, [assetLibraryEntries])
  const selectedObjects = useMemo(
    () =>
      selectedObjectIds
        .map((id) => objectById.get(id))
        .filter((entry): entry is CanvasObject => Boolean(entry)),
    [objectById, selectedObjectIds]
  )
  const selectedUnlockedObjects = useMemo(
    () =>
      selectedObjects.filter(
        (object) => !object.locked && !hasLockedAncestor(object, objectById)
      ),
    [objectById, selectedObjects]
  )
  const hasMultiSelection = selectedObjectIds.length > 1
  const selectedShapeObjects = useMemo(
    () =>
      selectedUnlockedObjects.filter(
        (object): object is Extract<CanvasObject, { type: 'shape_rect' | 'shape_circle' }> =>
          object.type === 'shape_rect' || object.type === 'shape_circle'
      ),
    [selectedUnlockedObjects]
  )
  const selectedTextboxObjects = useMemo(
    () =>
      selectedUnlockedObjects.filter(
        (object): object is Extract<CanvasObject, { type: 'textbox' }> => object.type === 'textbox'
      ),
    [selectedUnlockedObjects]
  )
  const selectedImageObjects = useMemo(
    () =>
      selectedUnlockedObjects.filter(
        (object): object is Extract<CanvasObject, { type: 'image' }> => object.type === 'image'
      ),
    [selectedUnlockedObjects]
  )
  const selectedVideoObjects = useMemo(
    () =>
      selectedUnlockedObjects.filter(
        (object): object is Extract<CanvasObject, { type: 'video' }> => object.type === 'video'
      ),
    [selectedUnlockedObjects]
  )
  const selectedSoundObjects = useMemo(
    () =>
      selectedUnlockedObjects.filter(
        (object): object is Extract<CanvasObject, { type: 'sound' }> => object.type === 'sound'
      ),
    [selectedUnlockedObjects]
  )
  const selectedScalableObjects = useMemo(
    () =>
      selectedUnlockedObjects.filter(
        (object): object is ScalableCanvasObject =>
          object.type === 'shape_rect' ||
          object.type === 'shape_circle' ||
          object.type === 'textbox' ||
          object.type === 'image' ||
          object.type === 'video' ||
          object.type === 'sound' ||
          object.type === 'template_placeholder'
      ),
    [selectedUnlockedObjects]
  )
  const selectedShapeObject =
    selectedObject &&
      (selectedObject.type === 'shape_rect' || selectedObject.type === 'shape_circle')
      ? selectedObject
      : null
  const selectedShapeSupportsRadius = Boolean(
    selectedShapeObject &&
    selectedShapeObject.type !== 'shape_circle' &&
    shapeSupportsRadius(normalizeShapeKind(selectedShapeObject.shapeData.kind))
  )
  const selectedTextboxObject =
    selectedObject && selectedObject.type === 'textbox' ? selectedObject : null
  const selectedImageObject =
    selectedObject && selectedObject.type === 'image' ? selectedObject : null
  const selectedVideoObject =
    selectedObject && selectedObject.type === 'video' ? selectedObject : null
  const selectedSoundObject =
    selectedObject && selectedObject.type === 'sound' ? selectedObject : null
  const selectedObjectSupportsStyleRole = Boolean(
    selectedShapeObject ||
    selectedTextboxObject ||
    selectedImageObject ||
    selectedVideoObject ||
    selectedSoundObject
  )
  const selectedObjectStyleRoleId = useMemo(
    () => inferObjectStyleRoleIdForObject(selectedObject, effectiveStylePreset),
    [effectiveStylePreset, selectedObject]
  )
  const selectedTemplatePlaceholderObject =
    selectedObject && selectedObject.type === 'template_placeholder' ? selectedObject : null
  const selectedScalableObject =
    selectedShapeObject ??
    selectedTextboxObject ??
    selectedImageObject ??
    selectedVideoObject ??
    selectedSoundObject ??
    selectedTemplatePlaceholderObject
  const selectedGroupObject =
    selectedObject && selectedObject.type === 'group' ? selectedObject : null
  const selectedObjectLockedByAncestor = selectedObject
    ? hasLockedAncestor(selectedObject, objectById)
    : false
  const canGroupSelectionFromToolbar =
    selectedObjects.length > 1 &&
    selectedObjects.every(
      (object) =>
        object.parentGroupId === null &&
        object.type !== 'group' &&
        !object.locked &&
        !hasLockedAncestor(object, objectById)
    )
  const canUngroupSelectionFromToolbar =
    selectedObjects.length === 1 && selectedObjects[0]?.type === 'group'
  const canToggleGroupFromSelection = Boolean(selectedGroupObject && activeGroupId === null)
  const orderedSlides = useMemo(
    () => [...document.slides].sort((a, b) => a.orderIndex - b.orderIndex),
    [document.slides]
  )
  const mediaAutoplaySlideOptions = useMemo(
    () => orderedSlides.map((slide) => ({ id: slide.id, label: slide.name || `Slide ${slide.orderIndex + 1}` })),
    [orderedSlides]
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
  const isSelectedObjectAspectRatioLockForced = selectedObject?.type === 'shape_circle'
  const isSelectedObjectAspectRatioLocked = isObjectAspectRatioLocked(selectedObject)
  const canScaleSelectedObject = Boolean(selectedScalableObject)
  const canScaleMultiSelection =
    selectedObjectIds.length > 1 &&
    selectedScalableObjects.length > 0 &&
    selectedScalableObjects.length === selectedUnlockedObjects.length
  const multiSelectionScaleKey = useMemo(
    () => selectedScalableObjects.map((object) => object.id).sort().join('|'),
    [selectedScalableObjects]
  )
  const multiSelectedShapeFillReference = selectedShapeObjects[0] ?? null
  const multiSelectedTextboxFillReference = selectedTextboxObjects[0] ?? null
  const hasMultiSelectedFillTargets = selectedShapeObjects.length > 0 || selectedTextboxObjects.length > 0
  const multiSelectedFillMode =
    multiSelectedShapeFillReference?.shapeData.fillMode ??
    multiSelectedTextboxFillReference?.textboxData.fillMode ??
    'solid'
  const isObjectGradientEditorVisible = Boolean(
    isFillEditorOpen &&
    fillEditorTarget === 'object' &&
    (
      (selectedShapeObject &&
        selectedShapeObject.shapeData.fillMode === 'linearGradient') ||
      (selectedTextboxObject &&
        (selectedTextboxObject.textboxData.fillMode ?? 'solid') === 'linearGradient') ||
      (selectedObjectIds.length > 1 && multiSelectedFillMode === 'linearGradient')
    )
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
  const showObjectParameters = selectedObjectIds.length > 0
  const showCanvasParameters = selectedObjectIds.length === 0 && selectedSlide === null
  const showContextParameters = showObjectParameters || showCanvasParameters
  const isCanvasGradientEditorVisible = Boolean(
    isFillEditorOpen &&
    fillEditorTarget === 'canvas' &&
    selectedObjectIds.length === 0 &&
    canvasBackgroundControl.fillMode === 'linearGradient'
  )
  const isGradientEditorVisible = isObjectGradientEditorVisible || isCanvasGradientEditorVisible
  const gradientEditorLocked = isCanvasGradientEditorVisible
    ? false
    : selectedObjectIds.length > 1
      ? (hasMultiSelection && selectedUnlockedObjects.length === 0)
      : selectedObjectTransformLocked
  const selectedTextboxFillMode = selectedTextboxObject?.textboxData.fillMode ?? 'solid'
  const multiSelectedGradientBaseColor = multiSelectedShapeFillReference
    ? multiSelectedShapeFillReference.shapeData.fillColor !== 'transparent'
      ? asHexColor(multiSelectedShapeFillReference.shapeData.fillColor, '#244a80')
      : '#244a80'
    : multiSelectedTextboxFillReference
      ? multiSelectedTextboxFillReference.textboxData.backgroundColor !== 'transparent'
        ? asHexColor(multiSelectedTextboxFillReference.textboxData.backgroundColor, DEFAULT_TEXTBOX_BACKGROUND)
        : DEFAULT_TEXTBOX_BACKGROUND
      : '#244a80'
  const selectedGradientBaseColor =
    isCanvasGradientEditorVisible
      ? canvasBackgroundControl.gradient.colorA
      : selectedObjectIds.length > 1
        ? multiSelectedGradientBaseColor
        : selectedShapeObject && selectedShapeObject.shapeData.fillColor !== 'transparent'
          ? selectedShapeObject.shapeData.fillColor
          : selectedTextboxObject && selectedTextboxObject.textboxData.backgroundColor !== 'transparent'
            ? selectedTextboxObject.textboxData.backgroundColor
            : '#244a80'
  const selectedGradient = normalizeFillGradient(
    isCanvasGradientEditorVisible
      ? canvasBackgroundControl.gradient
      : selectedObjectIds.length > 1
        ? multiSelectedShapeFillReference?.shapeData.fillGradient ??
        multiSelectedTextboxFillReference?.textboxData.fillGradient ??
        null
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
        : selectedVideoObject
          ? Math.max(0, Math.min(100, toFiniteNumber(selectedVideoObject.videoData.opacityPercent, 100)))
          : selectedSoundObject
            ? Math.max(0, Math.min(100, toFiniteNumber(selectedSoundObject.soundData.opacityPercent, 100)))
            : 100
  const selectedObjectRadiusPercent = selectedShapeObject
    ? radiusPxToPercent(
      Math.max(0, Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(selectedShapeObject.shapeData.radius, 0))),
      selectedShapeObject.w,
      selectedShapeObject.h
    )
    : selectedTextboxObject
      ? radiusPxToPercent(
        Math.max(0, Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(selectedTextboxObject.textboxData.radius, 0))),
        selectedTextboxObject.w,
        selectedTextboxObject.h
      )
      : selectedImageObject
        ? radiusPxToPercent(
          Math.max(0, Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(selectedImageObject.imageData.radius, 0))),
          selectedImageObject.w,
          selectedImageObject.h
        )
        : selectedVideoObject
          ? radiusPxToPercent(
            Math.max(0, Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(selectedVideoObject.videoData.radius, 0))),
            selectedVideoObject.w,
            selectedVideoObject.h
          )
          : selectedSoundObject
            ? radiusPxToPercent(
              Math.max(0, Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(selectedSoundObject.soundData.radius, 0))),
              selectedSoundObject.w,
              selectedSoundObject.h
            )
            : 0
  const selectedObjectShadowBlurPx = selectedShapeObject
    ? Math.max(0, Math.min(MAX_SHADOW_BLUR_PX, toFiniteNumber(selectedShapeObject.shapeData.shadowBlurPx, 0)))
    : selectedTextboxObject
      ? Math.max(0, Math.min(MAX_SHADOW_BLUR_PX, toFiniteNumber(selectedTextboxObject.textboxData.shadowBlurPx, 0)))
      : selectedImageObject
        ? Math.max(0, Math.min(MAX_SHADOW_BLUR_PX, toFiniteNumber(selectedImageObject.imageData.shadowBlurPx, 0)))
        : selectedVideoObject
          ? Math.max(0, Math.min(MAX_SHADOW_BLUR_PX, toFiniteNumber(selectedVideoObject.videoData.shadowBlurPx, 0)))
          : selectedSoundObject
            ? Math.max(0, Math.min(MAX_SHADOW_BLUR_PX, toFiniteNumber(selectedSoundObject.soundData.shadowBlurPx, 0)))
            : 0
  const selectedObjectShadowAngleDeg = selectedShapeObject
    ? normalizeShadowAngleDeg(toFiniteNumber(selectedShapeObject.shapeData.shadowAngleDeg, 45))
    : selectedTextboxObject
      ? normalizeShadowAngleDeg(toFiniteNumber(selectedTextboxObject.textboxData.shadowAngleDeg, 45))
      : selectedImageObject
        ? normalizeShadowAngleDeg(toFiniteNumber(selectedImageObject.imageData.shadowAngleDeg, 45))
        : selectedVideoObject
          ? normalizeShadowAngleDeg(toFiniteNumber(selectedVideoObject.videoData.shadowAngleDeg, 45))
          : selectedSoundObject
            ? normalizeShadowAngleDeg(toFiniteNumber(selectedSoundObject.soundData.shadowAngleDeg, 45))
            : 45
  const selectedObjectShadowColor = selectedShapeObject
    ? asHexColor(selectedShapeObject.shapeData.shadowColor, '#000000')
    : selectedTextboxObject
      ? asHexColor(selectedTextboxObject.textboxData.shadowColor, '#000000')
      : selectedImageObject
        ? asHexColor(selectedImageObject.imageData.shadowColor, '#000000')
        : selectedVideoObject
          ? asHexColor(selectedVideoObject.videoData.shadowColor, '#000000')
          : selectedSoundObject
            ? asHexColor(selectedSoundObject.soundData.shadowColor, '#000000')
            : '#000000'
  const multiEditReferenceObject = selectedUnlockedObjects.find(
    (
      object
    ): object is Extract<
      CanvasObject,
      { type: 'shape_rect' | 'shape_circle' | 'textbox' | 'image' | 'video' | 'sound' }
    > =>
      object.type === 'shape_rect' ||
      object.type === 'shape_circle' ||
      object.type === 'textbox' ||
      object.type === 'image' ||
      object.type === 'video' ||
      object.type === 'sound'
  ) ?? null
  const multiEditTransformLocked = hasMultiSelection && selectedUnlockedObjects.length === 0
  const multiEditRotationDeg = multiEditReferenceObject
    ? normalizeShadowAngleDeg((multiEditReferenceObject.rotation * 180) / Math.PI)
    : 0
  const multiEditOpacityPercent = multiEditReferenceObject
    ? multiEditReferenceObject.type === 'textbox'
      ? Math.max(0, Math.min(100, toFiniteNumber(multiEditReferenceObject.textboxData.opacityPercent, 100)))
      : multiEditReferenceObject.type === 'image'
        ? Math.max(0, Math.min(100, toFiniteNumber(multiEditReferenceObject.imageData.opacityPercent, 100)))
        : multiEditReferenceObject.type === 'video'
          ? Math.max(0, Math.min(100, toFiniteNumber(multiEditReferenceObject.videoData.opacityPercent, 100)))
          : multiEditReferenceObject.type === 'sound'
            ? Math.max(0, Math.min(100, toFiniteNumber(multiEditReferenceObject.soundData.opacityPercent, 100)))
            : Math.max(0, Math.min(100, toFiniteNumber(multiEditReferenceObject.shapeData.opacityPercent, 100)))
    : 100
  const multiEditRadiusReference = (
    [
      ...selectedShapeObjects.filter(
        (object): object is Extract<CanvasObject, { type: 'shape_rect' }> =>
          object.type !== 'shape_circle' && shapeSupportsRadius(normalizeShapeKind(object.shapeData.kind))
      ),
      ...selectedTextboxObjects,
      ...selectedImageObjects,
      ...selectedVideoObjects,
      ...selectedSoundObjects,
    ] as Array<Extract<CanvasObject, { type: 'shape_rect' | 'textbox' | 'image' | 'video' | 'sound' }>>
  )[0] ?? null
  const multiEditRadiusPercent = (() => {
    if (!multiEditRadiusReference) {
      return 0
    }
    if (multiEditRadiusReference.type === 'textbox') {
      return radiusPxToPercent(
        Math.max(0, Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(multiEditRadiusReference.textboxData.radius, 0))),
        multiEditRadiusReference.w,
        multiEditRadiusReference.h
      )
    }
    if (multiEditRadiusReference.type === 'image') {
      return radiusPxToPercent(
        Math.max(0, Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(multiEditRadiusReference.imageData.radius, 0))),
        multiEditRadiusReference.w,
        multiEditRadiusReference.h
      )
    }
    if (multiEditRadiusReference.type === 'video') {
      return radiusPxToPercent(
        Math.max(0, Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(multiEditRadiusReference.videoData.radius, 0))),
        multiEditRadiusReference.w,
        multiEditRadiusReference.h
      )
    }
    if (multiEditRadiusReference.type === 'sound') {
      return radiusPxToPercent(
        Math.max(0, Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(multiEditRadiusReference.soundData.radius, 0))),
        multiEditRadiusReference.w,
        multiEditRadiusReference.h
      )
    }
    return radiusPxToPercent(
      Math.max(0, Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(multiEditRadiusReference.shapeData.radius, 0))),
      multiEditRadiusReference.w,
      multiEditRadiusReference.h
    )
  })()
  const multiEditShadowBlurPx = multiEditReferenceObject
    ? multiEditReferenceObject.type === 'textbox'
      ? Math.max(0, Math.min(MAX_SHADOW_BLUR_PX, toFiniteNumber(multiEditReferenceObject.textboxData.shadowBlurPx, 0)))
      : multiEditReferenceObject.type === 'image'
        ? Math.max(0, Math.min(MAX_SHADOW_BLUR_PX, toFiniteNumber(multiEditReferenceObject.imageData.shadowBlurPx, 0)))
        : multiEditReferenceObject.type === 'video'
          ? Math.max(0, Math.min(MAX_SHADOW_BLUR_PX, toFiniteNumber(multiEditReferenceObject.videoData.shadowBlurPx, 0)))
          : multiEditReferenceObject.type === 'sound'
            ? Math.max(0, Math.min(MAX_SHADOW_BLUR_PX, toFiniteNumber(multiEditReferenceObject.soundData.shadowBlurPx, 0)))
            : Math.max(0, Math.min(MAX_SHADOW_BLUR_PX, toFiniteNumber(multiEditReferenceObject.shapeData.shadowBlurPx, 0)))
    : 0
  const multiEditShadowAngleDeg = multiEditReferenceObject
    ? multiEditReferenceObject.type === 'textbox'
      ? normalizeShadowAngleDeg(toFiniteNumber(multiEditReferenceObject.textboxData.shadowAngleDeg, 45))
      : multiEditReferenceObject.type === 'image'
        ? normalizeShadowAngleDeg(toFiniteNumber(multiEditReferenceObject.imageData.shadowAngleDeg, 45))
        : multiEditReferenceObject.type === 'video'
          ? normalizeShadowAngleDeg(toFiniteNumber(multiEditReferenceObject.videoData.shadowAngleDeg, 45))
          : multiEditReferenceObject.type === 'sound'
            ? normalizeShadowAngleDeg(toFiniteNumber(multiEditReferenceObject.soundData.shadowAngleDeg, 45))
            : normalizeShadowAngleDeg(toFiniteNumber(multiEditReferenceObject.shapeData.shadowAngleDeg, 45))
    : 45
  const multiEditShadowColor = multiEditReferenceObject
    ? multiEditReferenceObject.type === 'textbox'
      ? asHexColor(multiEditReferenceObject.textboxData.shadowColor, '#000000')
      : multiEditReferenceObject.type === 'image'
        ? asHexColor(multiEditReferenceObject.imageData.shadowColor, '#000000')
        : multiEditReferenceObject.type === 'video'
          ? asHexColor(multiEditReferenceObject.videoData.shadowColor, '#000000')
          : multiEditReferenceObject.type === 'sound'
            ? asHexColor(multiEditReferenceObject.soundData.shadowColor, '#000000')
            : asHexColor(multiEditReferenceObject.shapeData.shadowColor, '#000000')
    : '#000000'
  const multiEditFillColor =
    selectedShapeObjects[0] && selectedShapeObjects[0].shapeData.fillColor !== 'transparent'
      ? asHexColor(selectedShapeObjects[0].shapeData.fillColor, '#244a80')
      : selectedTextboxObjects[0] &&
        selectedTextboxObjects[0].textboxData.backgroundColor !== 'transparent'
        ? asHexColor(selectedTextboxObjects[0].textboxData.backgroundColor, DEFAULT_TEXTBOX_BACKGROUND)
        : '#244a80'
  const multiSelectedFillIsTransparent = multiSelectedShapeFillReference
    ? multiSelectedShapeFillReference.shapeData.fillColor === 'transparent'
    : multiSelectedTextboxFillReference
      ? multiSelectedTextboxFillReference.textboxData.backgroundColor === 'transparent'
      : false
  const multiEditFillGradientCss = multiSelectedShapeFillReference
    ? getShapeBackground(multiSelectedShapeFillReference.shapeData)
    : multiSelectedTextboxFillReference
      ? getTextboxBackground(multiSelectedTextboxFillReference.textboxData)
      : selectedGradientCss
  const multiEditBorderReference = multiEditReferenceObject
  const multiEditBorderWidth = multiEditBorderReference
    ? multiEditBorderReference.type === 'textbox'
      ? multiEditBorderReference.textboxData.borderWidth
      : multiEditBorderReference.type === 'image'
        ? multiEditBorderReference.imageData.borderWidth
        : multiEditBorderReference.type === 'video'
          ? multiEditBorderReference.videoData.borderWidth
          : multiEditBorderReference.type === 'sound'
            ? multiEditBorderReference.soundData.borderWidth
            : multiEditBorderReference.shapeData.borderWidth
    : 0
  const multiEditBorderType = multiEditBorderReference
    ? multiEditBorderReference.type === 'textbox'
      ? multiEditBorderReference.textboxData.borderType
      : multiEditBorderReference.type === 'image'
        ? multiEditBorderReference.imageData.borderType
        : multiEditBorderReference.type === 'video'
          ? multiEditBorderReference.videoData.borderType
          : multiEditBorderReference.type === 'sound'
            ? multiEditBorderReference.soundData.borderType
            : multiEditBorderReference.shapeData.borderType
    : 'solid'
  const multiEditBorderColor = multiEditBorderReference
    ? multiEditBorderReference.type === 'textbox'
      ? asHexColor(multiEditBorderReference.textboxData.borderColor, DEFAULT_TEXTBOX_BORDER_COLOR)
      : multiEditBorderReference.type === 'image'
        ? asHexColor(multiEditBorderReference.imageData.borderColor, DEFAULT_TEXTBOX_BORDER_COLOR)
        : multiEditBorderReference.type === 'video'
          ? asHexColor(multiEditBorderReference.videoData.borderColor, DEFAULT_TEXTBOX_BORDER_COLOR)
          : multiEditBorderReference.type === 'sound'
            ? asHexColor(multiEditBorderReference.soundData.borderColor, DEFAULT_TEXTBOX_BORDER_COLOR)
            : asHexColor(multiEditBorderReference.shapeData.borderColor, '#9db5de')
    : DEFAULT_TEXTBOX_BORDER_COLOR
  const backgroundColorValue = canvasBackgroundControl.solidColor
  const canvasGradientCss = buildGradientCss(
    canvasBackgroundControl.gradient,
    canvasBackgroundControl.gradient.colorA,
    canvasBackgroundControl.gradient.colorB
  )
  const activeSlideIndex = activeSlide ? orderedSlides.findIndex((slide) => slide.id === activeSlide.id) : -1
  const zoomCompensatedScalePercent = getZoomAdjustedObjectScalePercent(camera.zoom)

  useEffect(() => {
    const styleElement = window.document.createElement('style')
    styleElement.setAttribute('data-infiniprez-font-assets', 'true')
    styleElement.textContent = assetFontFaceCss
    window.document.head.appendChild(styleElement)
    return () => {
      styleElement.remove()
    }
  }, [assetFontFaceCss])

  useEffect(() => {
    setSelectedObjectScalePercent(selectedScalableObject?.scalePercent ?? zoomCompensatedScalePercent)
    selectedObjectScaleBaselineRef.current = selectedScalableObject
      ? createObjectScaleBaseline(selectedScalableObject)
      : null
  }, [selectedScalableObject?.id, selectedScalableObject?.scalePercent, zoomCompensatedScalePercent])

  useEffect(() => {
    setMultiSelectionScalePercent(selectedScalableObjects[0]?.scalePercent ?? zoomCompensatedScalePercent)
    if (!canScaleMultiSelection || multiSelectionScaleKey.length === 0) {
      multiSelectionScaleBaselineRef.current = null
      return
    }

    const bounds = selectedScalableObjects.reduce(
      (acc, object) => ({
        minX: Math.min(acc.minX, object.x - object.w / 2),
        minY: Math.min(acc.minY, object.y - object.h / 2),
        maxX: Math.max(acc.maxX, object.x + object.w / 2),
        maxY: Math.max(acc.maxY, object.y + object.h / 2),
      }),
      {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      }
    )

    multiSelectionScaleBaselineRef.current = {
      selectionKey: multiSelectionScaleKey,
      centerX: (bounds.minX + bounds.maxX) / 2,
      centerY: (bounds.minY + bounds.maxY) / 2,
      objects: selectedScalableObjects.map(createObjectScaleBaseline),
    }
  }, [canScaleMultiSelection, multiSelectionScaleKey, selectedScalableObjects, zoomCompensatedScalePercent])

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
      zoom: resolveSlideZoom(slide),
      rotation: slide.rotation,
    }
    const startCamera = camera
    if (camerasAreEqual(startCamera, targetCamera)) {
      return
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
    const startedAtMs = performance.now()
    let lastAppliedCamera = startCamera

    const tick = (nowMs: number) => {
      const elapsed = nowMs - startedAtMs
      const progress = Math.min(1, Math.max(0, elapsed / durationMs))
      const eased = easing(progress)
      const nextCamera = interpolateCamera(startCamera, targetCamera, eased)
      if (!camerasAreEqual(nextCamera, lastAppliedCamera)) {
        setCamera(nextCamera)
        lastAppliedCamera = nextCamera
      }
      if (progress < 1) {
        transitionFrameRef.current = requestAnimationFrame(tick)
      } else {
        if (!camerasAreEqual(lastAppliedCamera, targetCamera)) {
          setCamera(targetCamera)
        }
        transitionFrameRef.current = null
      }
    }

    transitionFrameRef.current = requestAnimationFrame(tick)
  }

  const objectTools = [
    { label: 'Textbox', icon: faPenToSquare },
    { label: 'Image', icon: faImage },
    { label: 'Video', icon: faVideo },
    { label: 'Sound', icon: faVolumeHigh },
    { label: 'Group', icon: faLayerGroup },
    { label: 'Ungroup', icon: faObjectUngroup },
  ]
  const objectInsertTools = objectTools.filter(
    (tool) => tool.label !== 'Group' && tool.label !== 'Ungroup'
  )
  const objectGroupTools = objectTools.filter(
    (tool) => tool.label === 'Group' || tool.label === 'Ungroup'
  )

  function createId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    return `id-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  }

  function buildLibraryAssetFromDefinition(definition: LibraryAssetDefinition): Asset | null {
    const kind = resolveLibraryAssetKind({ mimeType: definition.mimeType, name: definition.name })
    if (!kind || kind === 'style') {
      return null
    }

    const intrinsicWidth =
      kind === 'image'
        ? (definition.intrinsicWidth ?? 1200)
        : kind === 'video'
          ? (definition.intrinsicWidth ?? 1280)
          : null
    const intrinsicHeight =
      kind === 'image'
        ? (definition.intrinsicHeight ?? 800)
        : kind === 'video'
          ? (definition.intrinsicHeight ?? 720)
          : null
    const durationSec =
      kind === 'video' || kind === 'audio' ? (definition.durationSec ?? null) : null

    return {
      id: createId(),
      name: definition.name,
      mimeType: definition.mimeType,
      dataBase64: definition.dataBase64,
      intrinsicWidth,
      intrinsicHeight,
      durationSec,
    }
  }

  function importLibraryAssetDefinitions(definitions: LibraryAssetDefinition[]) {
    let added = 0
    let duplicates = 0
    let rejected = 0

    for (const definition of definitions) {
      const candidate = buildLibraryAssetFromDefinition(definition)
      if (!candidate) {
        rejected += 1
        continue
      }
      if (findMatchingLibraryAsset(useEditorStore.getState().document.assets, candidate)) {
        duplicates += 1
        continue
      }
      createAsset(candidate)
      added += 1
    }

    return { added, duplicates, rejected }
  }

  function getNextZIndex() {
    const maxZ = document.objects.reduce((max, entry) => Math.max(max, entry.zIndex), 0)
    return maxZ + 1
  }

  function getDefaultShapeData(kind: ShapeKind = 'rect'): ShapeData {
    const foregroundStyle = resolvePresetObjectRole(currentStylePreset, 'foreground-item', availableStylePresets)
    return {
      kind,
      adjustmentPercent: getDefaultShapeAdjustment(kind),
      borderColor: foregroundStyle?.borderColor ?? currentStylePreset?.shapeBorder ?? '#9db5de',
      borderType: 'solid',
      borderWidth: foregroundStyle?.borderWidth ?? 2,
      fillMode: 'solid',
      fillColor: foregroundStyle?.fillColor ?? currentStylePreset?.shapeFill ?? '#244a80',
      fillGradient: null,
      radius: kind === 'roundedRect' ? 30 : 0,
      opacityPercent: foregroundStyle?.opacityPercent ?? 100,
      shadowColor: '#000000',
      shadowBlurPx: 0,
      shadowAngleDeg: 45,
    }
  }

  function getDefaultTextboxData(): TextboxData {
    const textStyle = resolvePresetTextRole(currentStylePreset, 'text', availableStylePresets)
    const backgroundStyle = resolvePresetObjectRole(currentStylePreset, 'background-item', availableStylePresets)
    const textColor = textStyle?.color ?? currentStylePreset?.textColor ?? '#f0f3fc'
    const fontFamily = textStyle?.fontFamily ?? currentStylePreset?.fontFamily ?? 'Arial'
    const fontSize = textStyle?.fontSize ?? 28
    return {
      runs: [
        {
          text: 'New text',
          bold: false,
          italic: false,
          underline: false,
          color: textColor,
          fontSize,
        },
      ],
      richTextHtml: `<p><span style="color: ${textColor}; font-size: ${fontSize}px; font-family: ${fontFamily};">New text</span></p>`,
      fontFamily,
      alignment: 'left',
      verticalAlignment: 'top',
      listType: 'none',
      autoHeight: true,
      fillMode: 'solid',
      backgroundColor: backgroundStyle?.fillColor ?? currentStylePreset?.textboxBackground ?? DEFAULT_TEXTBOX_BACKGROUND,
      fillGradient: null,
      borderColor: backgroundStyle?.borderColor ?? currentStylePreset?.textboxBorder ?? DEFAULT_TEXTBOX_BORDER_COLOR,
      borderType: 'solid',
      borderWidth: backgroundStyle?.borderWidth ?? DEFAULT_TEXTBOX_BORDER_WIDTH,
      radius: 0,
      opacityPercent: 100,
      shadowColor: '#000000',
      shadowBlurPx: 0,
      shadowAngleDeg: 45,
    }
  }

  function clearCreationTool() {
    setActiveCreationTool(null)
    setPendingImagePlacements([])
    setIsShapeMenuOpen(false)
  }

  function handleAssetDragStart(
    event: ReactDragEvent<HTMLElement>,
    assetEntry: AssetLibraryEntry
  ) {
    const payload: AssetLibraryDragPayload = {
      assetId: assetEntry.asset.id,
      intrinsicWidth: assetEntry.intrinsicWidth,
      intrinsicHeight: assetEntry.intrinsicHeight,
      kind:
        assetEntry.kind === 'video'
          ? 'video'
          : assetEntry.kind === 'audio'
            ? 'audio'
            : 'image',
    }
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(ASSET_LIBRARY_DRAG_MIME, JSON.stringify(payload))
    event.dataTransfer.setData('text/plain', assetEntry.asset.name)
  }

  async function addFilesToAssetLibrary(files: File[]) {
    const supportedFiles = files.filter(isSupportedLibraryAssetFile)
    if (supportedFiles.length === 0) {
      return
    }

    const validFiles: File[] = []
    const rejectedMessages: string[] = []
    supportedFiles.forEach((file) => {
      const validationError = validateLibraryAssetFile(file)
      if (validationError) {
        rejectedMessages.push(validationError)
        return
      }
      validFiles.push(file)
    })

    if (validFiles.length === 0) {
      if (rejectedMessages.length > 0) {
        window.alert(rejectedMessages.join('\n'))
      }
      return
    }

    let importedStyleCount = 0
    let importedTemplateCount = 0
    let importedStyleTemplateDuplicatesCount = 0
    let importedEmbeddedAssetCount = 0
    let importedEmbeddedAssetDuplicatesCount = 0
    let importedEmbeddedAssetRejectedCount = 0
    const styleImportMessages: string[] = []

    beginCommandBatch(
      validFiles.length === 1 ? 'Add asset to library' : 'Add assets to library'
    )
    try {
      for (const file of validFiles) {
        const kind = resolveLibraryAssetKind({ mimeType: file.type, name: file.name })
        const candidateAsset = await buildLibraryAsset(file, createId())
        const existingAsset = findMatchingLibraryAsset(useEditorStore.getState().document.assets, candidateAsset)
        const sourceAssetId = existingAsset?.id ?? candidateAsset.id

        if (!existingAsset) {
          createAsset(candidateAsset)
        }

        if (kind === 'style') {
          try {
            const parsed = JSON.parse(await file.text()) as unknown
            const result = registerDesignAssetDefinitionsFromPayload(parsed, file.name, sourceAssetId)
            importedStyleCount += result.styleAdded
            importedTemplateCount += result.templateAdded
            importedStyleTemplateDuplicatesCount += result.styleDuplicates + result.templateDuplicates

            const embeddedAssetResult = importLibraryAssetDefinitions(
              extractLibraryAssetDefinitionsFromUnknown(parsed)
            )
            importedEmbeddedAssetCount += embeddedAssetResult.added
            importedEmbeddedAssetDuplicatesCount += embeddedAssetResult.duplicates
            importedEmbeddedAssetRejectedCount += embeddedAssetResult.rejected

            const discoveredCount =
              result.styleAdded +
              result.styleDuplicates +
              result.styleRejected +
              result.templateAdded +
              result.templateDuplicates +
              result.templateRejected +
              embeddedAssetResult.added +
              embeddedAssetResult.duplicates +
              embeddedAssetResult.rejected
            if (discoveredCount === 0) {
              styleImportMessages.push(`${file.name}: no style, template, or asset definitions found.`)
            }
          } catch {
            styleImportMessages.push(`${file.name}: invalid JSON payload.`)
          }
        }
      }
    } finally {
      commitCommandBatch()
    }

    if (importedStyleCount > 0 || importedTemplateCount > 0) {
      setDesignAssetRevision((current) => current + 1)
    }
    if (
      importedStyleCount > 0 ||
      importedTemplateCount > 0 ||
      importedEmbeddedAssetCount > 0 ||
      importedStyleTemplateDuplicatesCount > 0 ||
      importedEmbeddedAssetDuplicatesCount > 0 ||
      importedEmbeddedAssetRejectedCount > 0
    ) {
      styleImportMessages.push(
        `Imported from JSON assets: ${importedStyleCount} style(s), ${importedTemplateCount} template(s), ${importedEmbeddedAssetCount} embedded asset(s), ${importedStyleTemplateDuplicatesCount + importedEmbeddedAssetDuplicatesCount} duplicate(s), ${importedEmbeddedAssetRejectedCount} rejected asset(s).`
      )
    }

    if (styleImportMessages.length > 0) {
      rejectedMessages.push(...styleImportMessages)
    }

    if (rejectedMessages.length > 0) {
      window.alert(rejectedMessages.join('\n'))
    }
  }

  function openAssetLibraryDialog() {
    assetLibraryInputRef.current?.click()
  }

  async function handleAssetLibraryFileInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    await addFilesToAssetLibrary(files)
  }

  function handleAssetSortChange(nextSort: AssetLibrarySort) {
    if (assetLibrarySort === nextSort) {
      setAssetLibrarySortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setAssetLibrarySort(nextSort)
    setAssetLibrarySortDirection('asc')
  }

  function openAssetBundlerModal() {
    setIsAssetBundlerOpen(true)
  }

  function closeAssetBundlerModal() {
    setIsAssetBundlerOpen(false)
  }

  function handleAssetBundlerExport() {
    const selectedItems = {
      styles: Array.from(bundlerCheckedStyles),
      templates: Array.from(bundlerCheckedTemplates),
      assets: Array.from(bundlerCheckedAssets),
    }

    if (
      selectedItems.styles.length === 0 &&
      selectedItems.templates.length === 0 &&
      selectedItems.assets.length === 0
    ) {
      return
    }

    // Create bundle object
    const bundle = {
      version: 1,
      styles: selectedItems.styles.map(id => stylePresetCatalogEntries.find(e => e.definition.id === id)?.definition).filter(Boolean),
      templates: selectedItems.templates.map(id => slideTemplateCatalogEntries.find(e => e.definition.id === id)?.definition).filter(Boolean),
      assets: selectedItems.assets.map(id => document.assets.find(a => a.id === id)).filter(Boolean),
    }

    // Export as JSON
    const jsonString = JSON.stringify(bundle, null, 2)
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    link.href = url
    link.download = `asset-bundle-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(url)

    // Reset selection and close modal
    setBundlerCheckedStyles(new Set())
    setBundlerCheckedTemplates(new Set())
    setBundlerCheckedAssets(new Set())
    closeAssetBundlerModal()
  }

  function handleStyleCatalogNameSortToggle() {
    setStyleCatalogSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
  }

  function handleTemplateCatalogNameSortToggle() {
    setTemplateCatalogSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
  }

  async function handleAssetLibraryDrop(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault()
    setIsAssetLibraryDragOver(false)
    setActiveDesignTab('assets')
    await addFilesToAssetLibrary(Array.from(event.dataTransfer.files ?? []))
  }

  function handleAssetLibraryDragOver(event: ReactDragEvent<HTMLElement>) {
    if (Array.from(event.dataTransfer.types).includes('Files')) {
      event.preventDefault()
      setIsAssetLibraryDragOver(true)
    }
  }

  function handleAssetLibraryDragLeave(event: ReactDragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsAssetLibraryDragOver(false)
    }
  }

  function handleDeleteAsset(assetId: string) {
    const targetEntry = assetLibraryEntries.find((entry) => entry.asset.id === assetId) ?? null
    const removeImportedDesignEntriesFromBundleSource = () => {
      if (!targetEntry || targetEntry.kind !== 'style') {
        return
      }
      const removedStyleCount = unregisterRuntimeStylePresetDefinitionsBySourceAssetId(assetId)
      const removedTemplateCount = unregisterRuntimeSlideTemplateDefinitionsBySourceAssetId(assetId)
      if (removedStyleCount > 0 || removedTemplateCount > 0) {
        setDesignAssetRevision((current) => current + 1)
      }
    }

    const childEntries = assetLibraryEntries.filter(
      (entry) =>
        embeddedStyleAssetChildLinks.parentByChildAssetId.get(entry.asset.id)
          ?.parentStyleAssetId === assetId
    )

    if (childEntries.length === 0) {
      deleteAsset(assetId)
      removeImportedDesignEntriesFromBundleSource()
      return
    }

    const usedChildren = childEntries.filter((child) => child.usageCount > 0)

    if (usedChildren.length > 0) {
      const usedNames = usedChildren.map((c) => c.asset.name).join(', ')
      const keep = window.confirm(
        `The following embedded assets are currently in use and cannot be automatically removed:\n\n${usedNames}\n\nClick OK to keep those assets and delete everything else.\nClick Cancel to abort.`
      )
      if (!keep) {
        return
      }
      deleteAsset(assetId)
      removeImportedDesignEntriesFromBundleSource()
      for (const child of childEntries) {
        if (child.usageCount === 0) {
          deleteAsset(child.asset.id)
        }
      }
    } else {
      deleteAsset(assetId)
      removeImportedDesignEntriesFromBundleSource()
      for (const child of childEntries) {
        deleteAsset(child.asset.id)
      }
    }
  }

  function ensureLibraryAsset(asset: Asset): Asset {
    const existing = findMatchingLibraryAsset(useEditorStore.getState().document.assets, asset)
    if (existing) {
      return existing
    }
    createAsset(asset)
    return asset
  }

  function handleShapePresetSelection(shapePresetId: ShapeCreationPresetId) {
    setPendingImagePlacements([])
    setActiveShapePresetId(shapePresetId)
    setActiveCreationTool(shapePresetId === 'circle' ? 'shape_circle' : 'shape_rect')
    setIsShapeMenuOpen(false)
  }

  function handleObjectTool(label: string) {
    switch (label) {
      case 'Textbox':
        setPendingImagePlacements([])
        setIsShapeMenuOpen(false)
        setActiveCreationTool((current) => (current === 'textbox' ? null : 'textbox'))
        break
      case 'Image':
        setIsShapeMenuOpen(false)
        setActiveCreationTool('image')
        imageInputRef.current?.click()
        break
      case 'Video':
        setPendingImagePlacements([])
        setIsShapeMenuOpen(false)
        setActiveCreationTool(null)
        videoInputRef.current?.click()
        break
      case 'Sound':
        setPendingImagePlacements([])
        setIsShapeMenuOpen(false)
        setActiveCreationTool(null)
        soundInputRef.current?.click()
        break
      case 'Group':
        if (canGroupSelectionFromToolbar) {
          groupObjects(selectedObjectIds)
        }
        break
      case 'Ungroup':
        if (canUngroupSelectionFromToolbar) {
          ungroupObjects(selectedObjectIds)
        }
        break
      default:
        break
    }
  }

  async function handleImageFile(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter(isSupportedImageFile)
    event.target.value = ''

    if (files.length === 0) {
      if (activeCreationTool === 'image') {
        clearCreationTool()
      }
      return
    }

    try {
      const nextPendingImages: PendingImagePlacement[] = []
      for (const [index, file] of files.entries()) {
        const dataUrl = await readFileAsDataUrl(file)
        const dimensions = await getImageDimensions(dataUrl).catch(() => ({
          width: 1200,
          height: 800,
        }))
        nextPendingImages.push({
          name: file.name || `image-${index + 1}`,
          mimeType: file.type,
          dataBase64: toAssetBase64(dataUrl),
          intrinsicWidth: dimensions.width,
          intrinsicHeight: dimensions.height,
        })
      }
      setPendingImagePlacements(nextPendingImages)
      setActiveCreationTool('image')
    } catch {
      clearCreationTool()
      window.alert('Failed to load image file.')
    }
  }

  async function handleVideoFile(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter(
      (file) => resolveLibraryAssetKind({ mimeType: file.type, name: file.name }) === 'video'
    )
    event.target.value = ''

    if (files.length === 0) {
      return
    }

    beginCommandBatch(files.length === 1 ? 'Add video' : 'Add videos')
    try {
      const createdIds: string[] = []
      const nextZIndex = getNextZIndex()
      for (const [index, file] of files.entries()) {
        const asset = ensureLibraryAsset(await buildLibraryAsset(file, createId()))
        const intrinsicWidth = Math.max(1, asset.intrinsicWidth ?? 1280)
        const intrinsicHeight = Math.max(1, asset.intrinsicHeight ?? 720)
        const frame = getDefaultPlacedMediaSize('video', intrinsicWidth, intrinsicHeight, camera.zoom)
        const objectId = createId()
        createObject({
          id: objectId,
          type: 'video',
          x: camera.x + (index - (files.length - 1) / 2) * (36 / Math.max(camera.zoom, 0.001)),
          y: camera.y + (index - (files.length - 1) / 2) * (24 / Math.max(camera.zoom, 0.001)),
          w: frame.w,
          h: frame.h,
          rotation: -camera.rotation,
          scalePercent: getZoomAdjustedObjectScalePercent(camera.zoom),
          keepAspectRatio: true,
          locked: false,
          zIndex: nextZIndex + index,
          parentGroupId: activeGroupId,
          videoData: createDefaultVideoData(
            asset.id,
            intrinsicWidth,
            intrinsicHeight,
            currentStylePreset?.assetStyle.videoBorder ?? currentStylePreset?.imageBorder
          ),
        })
        createdIds.push(objectId)
      }
      selectObjects(createdIds)
    } catch {
      window.alert('Failed to load video file.')
    } finally {
      commitCommandBatch()
    }
  }

  async function handleSoundFile(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter(
      (file) => resolveLibraryAssetKind({ mimeType: file.type, name: file.name }) === 'audio'
    )
    event.target.value = ''

    if (files.length === 0) {
      return
    }

    beginCommandBatch(files.length === 1 ? 'Add sound' : 'Add sounds')
    try {
      const createdIds: string[] = []
      const nextZIndex = getNextZIndex()
      for (const [index, file] of files.entries()) {
        const asset = ensureLibraryAsset(await buildLibraryAsset(file, createId()))
        const objectId = createId()
        const frame = getDefaultPlacedMediaSize('sound', 1, 1, camera.zoom)
        createObject({
          id: objectId,
          type: 'sound',
          x: camera.x + (index - (files.length - 1) / 2) * (28 / Math.max(camera.zoom, 0.001)),
          y: camera.y + (index - (files.length - 1) / 2) * (18 / Math.max(camera.zoom, 0.001)),
          w: frame.w,
          h: frame.h,
          rotation: -camera.rotation,
          scalePercent: getZoomAdjustedObjectScalePercent(camera.zoom),
          keepAspectRatio: false,
          locked: false,
          zIndex: nextZIndex + index,
          parentGroupId: activeGroupId,
          soundData: createDefaultSoundData(
            asset.id,
            currentStylePreset?.assetStyle.audioBorder ?? currentStylePreset?.imageBorder,
            frame.h / 2
          ),
        })
        createdIds.push(objectId)
      }
      selectObjects(createdIds)
    } catch {
      window.alert('Failed to load sound file.')
    } finally {
      commitCommandBatch()
    }
  }

  function handleCreateObjectFromTool(
    tool: CreationToolType,
    frame: Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'rotation'>
  ) {
    const objectId = createId()
    const initialScalePercent = getZoomAdjustedObjectScalePercent(camera.zoom)

    if (tool === 'textbox') {
      createObject({
        id: objectId,
        type: 'textbox',
        ...frame,
        scalePercent: initialScalePercent,
        keepAspectRatio: false,
        locked: false,
        zIndex: getNextZIndex(),
        parentGroupId: activeGroupId,
        textboxData: getDefaultTextboxData(),
      })
      selectObjects([objectId])
      setActiveCreationTool(null)
      return
    }

    if (tool === 'shape_rect' || tool === 'shape_circle') {
      const shapeKind = tool === 'shape_rect' ? normalizeShapeKind(activeShapePresetId) : 'rect'
      createObject({
        id: objectId,
        type: tool,
        ...frame,
        scalePercent: initialScalePercent,
        keepAspectRatio: tool === 'shape_circle',
        locked: false,
        zIndex: getNextZIndex(),
        parentGroupId: activeGroupId,
        shapeData: getDefaultShapeData(shapeKind),
      })
      selectObjects([objectId])
      setActiveCreationTool(null)
      return
    }

    const pendingImage = pendingImagePlacements[0]
    if (!pendingImage) {
      clearCreationTool()
      return
    }

    if (!pendingImage.assetId) {
      beginCommandBatch('Place image')
    }
    const resolvedAsset =
      pendingImage.assetId
        ? document.assets.find((asset) => asset.id === pendingImage.assetId) ?? null
        : ensureLibraryAsset({
          id: createId(),
          name: pendingImage.name,
          mimeType: pendingImage.mimeType,
          dataBase64: pendingImage.dataBase64,
          intrinsicWidth: pendingImage.intrinsicWidth,
          intrinsicHeight: pendingImage.intrinsicHeight,
          durationSec: null,
        })
    const assetId = resolvedAsset?.id ?? pendingImage.assetId ?? createId()
    createObject({
      id: objectId,
      type: 'image',
      ...frame,
      scalePercent: initialScalePercent,
      keepAspectRatio: true,
      locked: false,
      zIndex: getNextZIndex(),
      parentGroupId: activeGroupId,
      imageData: {
        ...createDefaultImageData(
          assetId,
          pendingImage.intrinsicWidth,
          pendingImage.intrinsicHeight,
          currentStylePreset?.assetStyle.imageBorder ?? currentStylePreset?.imageBorder
        ),
      },
    })
    if (!pendingImage.assetId) {
      commitCommandBatch()
    }
    selectObjects([objectId])
    if (pendingImage.persistAfterPlace) {
      setActiveCreationTool('image')
      return
    }
    setPendingImagePlacements((current) => {
      const next = current.slice(1)
      if (next.length === 0) {
        setActiveCreationTool(null)
      }
      return next
    })
  }

  function handleNewDocument() {
    const shouldReset = window.confirm(
      'Reset to a new empty document? Unsaved changes will be lost.'
    )
    if (!shouldReset) {
      return
    }
    resetDocument()
    setActiveStylePresetId(null)
    clearCreationTool()
    latestDocumentSnapshotRef.current = ''
    latestAutosavedSnapshotRef.current = ''
    try {
      window.localStorage.removeItem(AUTOSAVE_LATEST_KEY)
      window.localStorage.removeItem(AUTOSAVE_BACKUPS_KEY)
    } catch {
      // Ignore storage failures in restricted browser modes.
    }
  }

  function applyStylePreset(preset: StylePreset) {
    const foregroundStyle = getObjectStyleRole(preset, 'foreground-item')
    const backgroundStyle = getObjectStyleRole(preset, 'background-item')
    const textStyle = getTextStyleRole(preset, 'text')
    const baseFontFamily = textStyle?.fontFamily ?? preset.fontFamily
    const baseTextColor = textStyle?.color ?? preset.textColor
    const imageBorder = preset.assetStyle.imageBorder ?? preset.imageBorder
    const videoBorder = preset.assetStyle.videoBorder ?? imageBorder
    const audioBorder = preset.assetStyle.audioBorder ?? imageBorder

    beginCommandBatch(`Apply style preset: ${preset.name}`)
    setCanvasBackground(preset.canvasBackground)

    for (const object of document.objects) {
      if (object.type === 'shape_rect' || object.type === 'shape_circle') {
        setShapeData(object.id, {
          ...object.shapeData,
          fillMode: 'solid',
          fillGradient: null,
          fillColor: foregroundStyle?.fillColor ?? preset.shapeFill,
          borderColor: foregroundStyle?.borderColor ?? preset.shapeBorder,
          borderWidth: foregroundStyle?.borderWidth ?? object.shapeData.borderWidth,
          opacityPercent: foregroundStyle?.opacityPercent ?? object.shapeData.opacityPercent,
        })
        continue
      }

      if (object.type === 'textbox') {
        setTextboxData(object.id, {
          ...object.textboxData,
          fontFamily: baseFontFamily,
          fillMode: 'solid',
          fillGradient: null,
          backgroundColor: backgroundStyle?.fillColor ?? preset.textboxBackground,
          borderColor: backgroundStyle?.borderColor ?? preset.textboxBorder,
          borderWidth: backgroundStyle?.borderWidth ?? object.textboxData.borderWidth,
          runs: object.textboxData.runs.map((run) => ({
            ...run,
            color: baseTextColor,
          })),
          richTextHtml: applyTextboxThemeRichHtml(resolveTextboxRichHtml(object.textboxData), {
            fontFamily: baseFontFamily,
            textColor: baseTextColor,
          }),
        })
        continue
      }

      if (object.type === 'image') {
        setImageData(object.id, {
          ...object.imageData,
          borderColor: imageBorder,
        })
        continue
      }

      if (object.type === 'video') {
        setVideoData(object.id, {
          ...object.videoData,
          borderColor: videoBorder,
        })
        continue
      }

      if (object.type === 'sound') {
        setSoundData(object.id, {
          ...object.soundData,
          borderColor: audioBorder,
        })
        continue
      }
    }

    commitCommandBatch()
    setActiveStylePresetId(preset.id)
  }

  function handleShapeOpacityChange(objectId: string, value: string) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      return
    }
    setShapeOpacity(objectId, parsed)
  }

  function normalizeTextboxData(
    textboxData: TextboxData,
    patch: Partial<TextboxData>
  ): TextboxData {
    let nextTextboxData: TextboxData = {
      ...textboxData,
      ...patch,
      fillMode: (patch.fillMode ?? textboxData.fillMode ?? 'solid') as TextboxData['fillMode'],
      backgroundColor: patch.backgroundColor ?? textboxData.backgroundColor ?? DEFAULT_TEXTBOX_BACKGROUND,
      borderWidth: Math.max(
        0,
        Math.min(
          20,
          Math.round(
            toFiniteNumber(
              patch.borderWidth ?? textboxData.borderWidth,
              DEFAULT_TEXTBOX_BORDER_WIDTH
            )
          )
        )
      ),
      radius: Math.max(
        0,
        Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(patch.radius ?? textboxData.radius, 0))
      ),
      opacityPercent: Math.max(
        0,
        Math.min(
          100,
          Math.round(toFiniteNumber(patch.opacityPercent ?? textboxData.opacityPercent, 100))
        )
      ),
      shadowBlurPx: Math.max(
        0,
        Math.min(
          MAX_SHADOW_BLUR_PX,
          Math.round(toFiniteNumber(patch.shadowBlurPx ?? textboxData.shadowBlurPx, 0))
        )
      ),
      shadowAngleDeg: normalizeShadowAngleDeg(
        toFiniteNumber(patch.shadowAngleDeg ?? textboxData.shadowAngleDeg, 45)
      ),
      shadowColor: asHexColor(
        patch.shadowColor ?? textboxData.shadowColor,
        '#000000'
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
          textboxData.backgroundColor,
          '#ffffff'
        ),
      }
    }

    return nextTextboxData
  }

  function normalizeShapeData(
    shapeData: ShapeData,
    patch: Partial<ShapeData>
  ): ShapeData {
    let nextShapeData: ShapeData = {
      ...shapeData,
      ...patch,
      kind: normalizeShapeKind(patch.kind ?? shapeData.kind),
      adjustmentPercent: clampShapeAdjustment(
        normalizeShapeKind(patch.kind ?? shapeData.kind),
        toFiniteNumber(patch.adjustmentPercent ?? shapeData.adjustmentPercent, getDefaultShapeAdjustment(normalizeShapeKind(patch.kind ?? shapeData.kind)))
      ),
      radius: Math.max(
        0,
        Math.min(
          MAX_SHAPE_RADIUS,
          toFiniteNumber(patch.radius ?? shapeData.radius, 0)
        )
      ),
      shadowBlurPx: Math.max(
        0,
        Math.min(
          MAX_SHADOW_BLUR_PX,
          Math.round(toFiniteNumber(patch.shadowBlurPx ?? shapeData.shadowBlurPx, 0))
        )
      ),
      shadowAngleDeg: normalizeShadowAngleDeg(
        toFiniteNumber(patch.shadowAngleDeg ?? shapeData.shadowAngleDeg, 45)
      ),
      shadowColor: asHexColor(
        patch.shadowColor ?? shapeData.shadowColor,
        '#000000'
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
        fillGradient: normalizeFillGradient(null, shapeData.fillColor, '#ffffff'),
      }
    }

    return nextShapeData
  }

  function normalizeImageData(
    imageData: ImageData,
    patch: Partial<ImageData>
  ): ImageData {
    return {
      ...imageData,
      ...patch,
      borderWidth: Math.max(
        0,
        Math.min(
          20,
          Math.round(toFiniteNumber(patch.borderWidth ?? imageData.borderWidth, 0))
        )
      ),
      radius: Math.max(
        0,
        Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(patch.radius ?? imageData.radius, 0))
      ),
      opacityPercent: Math.max(
        0,
        Math.min(
          100,
          Math.round(toFiniteNumber(patch.opacityPercent ?? imageData.opacityPercent, 100))
        )
      ),
      shadowBlurPx: Math.max(
        0,
        Math.min(
          MAX_SHADOW_BLUR_PX,
          Math.round(toFiniteNumber(patch.shadowBlurPx ?? imageData.shadowBlurPx, 0))
        )
      ),
      shadowAngleDeg: normalizeShadowAngleDeg(
        toFiniteNumber(patch.shadowAngleDeg ?? imageData.shadowAngleDeg, 45)
      ),
      shadowColor: asHexColor(
        patch.shadowColor ?? imageData.shadowColor,
        '#000000'
      ),
    }
  }

  function normalizeVideoData(
    videoData: VideoData,
    patch: Partial<VideoData>
  ): VideoData {
    const autoplaySlideId = normalizeOptionalId(patch.autoplaySlideId ?? videoData.autoplaySlideId)
    return {
      ...videoData,
      ...patch,
      autoplaySlideId,
      autoplay: autoplaySlideId !== null,
      borderWidth: Math.max(
        0,
        Math.min(
          20,
          Math.round(toFiniteNumber(patch.borderWidth ?? videoData.borderWidth, 0))
        )
      ),
      radius: Math.max(
        0,
        Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(patch.radius ?? videoData.radius, 0))
      ),
      opacityPercent: Math.max(
        0,
        Math.min(
          100,
          Math.round(toFiniteNumber(patch.opacityPercent ?? videoData.opacityPercent, 100))
        )
      ),
      shadowBlurPx: Math.max(
        0,
        Math.min(
          MAX_SHADOW_BLUR_PX,
          Math.round(toFiniteNumber(patch.shadowBlurPx ?? videoData.shadowBlurPx, 0))
        )
      ),
      shadowAngleDeg: normalizeShadowAngleDeg(
        toFiniteNumber(patch.shadowAngleDeg ?? videoData.shadowAngleDeg, 45)
      ),
      shadowColor: asHexColor(
        patch.shadowColor ?? videoData.shadowColor,
        '#000000'
      ),
    }
  }

  function normalizeSoundData(
    soundData: SoundData,
    patch: Partial<SoundData>
  ): SoundData {
    const autoplaySlideId = normalizeOptionalId(patch.autoplaySlideId ?? soundData.autoplaySlideId)
    return {
      ...soundData,
      ...patch,
      autoplaySlideId,
      hiddenInPresentation: Boolean(patch.hiddenInPresentation ?? soundData.hiddenInPresentation),
      borderWidth: Math.max(
        0,
        Math.min(
          20,
          Math.round(toFiniteNumber(patch.borderWidth ?? soundData.borderWidth, 0))
        )
      ),
      radius: Math.max(
        0,
        Math.min(MAX_SHAPE_RADIUS, toFiniteNumber(patch.radius ?? soundData.radius, 0))
      ),
      opacityPercent: Math.max(
        0,
        Math.min(
          100,
          Math.round(toFiniteNumber(patch.opacityPercent ?? soundData.opacityPercent, 100))
        )
      ),
      shadowBlurPx: Math.max(
        0,
        Math.min(
          MAX_SHADOW_BLUR_PX,
          Math.round(toFiniteNumber(patch.shadowBlurPx ?? soundData.shadowBlurPx, 0))
        )
      ),
      shadowAngleDeg: normalizeShadowAngleDeg(
        toFiniteNumber(patch.shadowAngleDeg ?? soundData.shadowAngleDeg, 45)
      ),
      shadowColor: asHexColor(
        patch.shadowColor ?? soundData.shadowColor,
        '#000000'
      ),
    }
  }

  function applyToUnlockedSelection(
    label: string,
    apply: (object: CanvasObject) => void
  ) {
    if (selectedUnlockedObjects.length === 0) {
      return
    }
    beginCommandBatch(label)
    selectedUnlockedObjects.forEach((object) => {
      apply(object)
    })
    commitCommandBatch()
  }

  function updateSelectedTextboxData(patch: Partial<TextboxData>) {
    if (
      !selectedTextboxObject ||
      selectedTextboxObject.locked ||
      selectedObjectLockedByAncestor
    ) {
      return
    }

    setTextboxData(
      selectedTextboxObject.id,
      normalizeTextboxData(selectedTextboxObject.textboxData, patch)
    )
  }

  function applyScaleBaselineEntry(
    baseline: ObjectScaleBaseline,
    factor: number,
    centerOverride?: { x: number; y: number }
  ) {
    const target = objectById.get(baseline.id)
    if (!target) {
      return
    }

    const centerX = centerOverride?.x ?? baseline.x
    const centerY = centerOverride?.y ?? baseline.y
    const nextW = Math.max(1, baseline.w * factor)
    const nextH = Math.max(1, baseline.h * factor)

    moveObject(baseline.id, {
      x: centerX + (baseline.x - centerX) * factor,
      y: centerY + (baseline.y - centerY) * factor,
      w: nextW,
      h: nextH,
      rotation: baseline.rotation,
      scalePercent: clampObjectScalePercent(baseline.scalePercent * factor),
    })

  }

  function updateSelectedObjectScale(scalePercent: number) {
    if (!selectedScalableObject || selectedObjectTransformLocked) {
      return
    }

    const nextScalePercent = clampObjectScalePercent(scalePercent)
    const baseline =
      selectedObjectScaleBaselineRef.current ?? createObjectScaleBaseline(selectedScalableObject)
    const baselineScalePercent = Math.max(OBJECT_SCALE_MIN_PERCENT, baseline.scalePercent)
    beginCommandBatch('Scale object')
    applyScaleBaselineEntry(baseline, nextScalePercent / baselineScalePercent)
    commitCommandBatch()
    setSelectedObjectScalePercent(nextScalePercent)
  }

  function updateMultiSelectedObjectScale(scalePercent: number) {
    if (!canScaleMultiSelection || multiEditTransformLocked) {
      return
    }

    const nextScalePercent = clampObjectScalePercent(scalePercent)
    const baseline = multiSelectionScaleBaselineRef.current
    if (!baseline || baseline.objects.length === 0) {
      return
    }

    const referenceScalePercent = Math.max(
      OBJECT_SCALE_MIN_PERCENT,
      baseline.objects[0]?.scalePercent ?? zoomCompensatedScalePercent
    )
    beginCommandBatch('Scale selected objects')
    baseline.objects.forEach((entry) => {
      applyScaleBaselineEntry(entry, nextScalePercent / referenceScalePercent, {
        x: baseline.centerX,
        y: baseline.centerY,
      })
    })
    commitCommandBatch()
    setMultiSelectionScalePercent(nextScalePercent)
  }

  function updateMultiSelectedRotation(rotationDeg: number) {
    if (multiEditTransformLocked || selectedUnlockedObjects.length === 0 || !multiEditReferenceObject) {
      return
    }

    const nextRotationDeg = Math.max(-180, Math.min(180, Math.round(rotationDeg / 10) * 10))
    const referenceRotationDeg = normalizeShadowAngleDeg((multiEditReferenceObject.rotation * 180) / Math.PI)
    const deltaRad = ((nextRotationDeg - referenceRotationDeg) * Math.PI) / 180

    if (Math.abs(deltaRad) < 0.000001) {
      return
    }

    const selectionBounds = getObjectsWorldAabb(selectedUnlockedObjects)
    const selectionCenter = selectionBounds
      ? {
        x: (selectionBounds.minX + selectionBounds.maxX) / 2,
        y: (selectionBounds.minY + selectionBounds.maxY) / 2,
      }
      : {
        x: multiEditReferenceObject.x,
        y: multiEditReferenceObject.y,
      }

    beginCommandBatch(selectedUnlockedObjects.length > 1 ? 'Rotate selected objects' : 'Rotate selected object')
    selectedUnlockedObjects.forEach((object) => {
      const rotatedOffset = rotatePoint(
        {
          x: object.x - selectionCenter.x,
          y: object.y - selectionCenter.y,
        },
        deltaRad
      )
      moveObject(object.id, {
        x: selectionCenter.x + rotatedOffset.x,
        y: selectionCenter.y + rotatedOffset.y,
        w: object.w,
        h: object.h,
        rotation: normalizeRotationRadians(object.rotation + deltaRad),
      })
    })
    commitCommandBatch()
  }

  function updateSelectedObjectTransform(
    patch: Partial<Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'rotation'>>
  ) {
    if (!selectedObject || selectedObject.locked || selectedObjectLockedByAncestor) {
      return
    }

    let nextWidth = Math.max(1, patch.w ?? selectedObject.w)
    let nextHeight = Math.max(1, patch.h ?? selectedObject.h)
    const shouldKeepAspectRatio = isSelectedObjectAspectRatioLocked
    const aspectRatio = Math.max(0.0001, selectedObject.w / Math.max(1, selectedObject.h))

    if (shouldKeepAspectRatio && selectedObject.type !== 'shape_circle') {
      if (patch.w !== undefined && patch.h === undefined) {
        nextHeight = Math.max(1, nextWidth / aspectRatio)
      } else if (patch.h !== undefined && patch.w === undefined) {
        nextWidth = Math.max(1, nextHeight * aspectRatio)
      }
    }

    if (selectedObject.type === 'shape_circle' && (patch.w !== undefined || patch.h !== undefined)) {
      const enforcedSize =
        patch.w !== undefined && patch.h !== undefined
          ? Math.max(nextWidth, nextHeight)
          : patch.w !== undefined
            ? nextWidth
            : nextHeight
      nextWidth = enforcedSize
      nextHeight = enforcedSize
    }

    if (
      selectedObject.type === 'group' &&
      (patch.x !== undefined || patch.y !== undefined || patch.rotation !== undefined)
    ) {
      const targetCenter = {
        x: patch.x ?? selectedObject.x,
        y: patch.y ?? selectedObject.y,
      }
      const targetRotation = patch.rotation ?? selectedObject.rotation
      let rotationDelta = targetRotation - selectedObject.rotation
      while (rotationDelta > Math.PI) {
        rotationDelta -= Math.PI * 2
      }
      while (rotationDelta < -Math.PI) {
        rotationDelta += Math.PI * 2
      }

      const groupCenter = { x: selectedObject.x, y: selectedObject.y }
      const descendantIds: string[] = []
      const stack = [...selectedObject.groupData.childIds]
      const visited = new Set<string>()

      while (stack.length > 0) {
        const nextId = stack.pop()
        if (!nextId || visited.has(nextId)) {
          continue
        }
        visited.add(nextId)
        descendantIds.push(nextId)
        const child = objectById.get(nextId)
        if (child?.type === 'group') {
          stack.push(...child.groupData.childIds)
        }
      }

      const hasTranslation =
        Math.abs(targetCenter.x - selectedObject.x) > 0.000001 ||
        Math.abs(targetCenter.y - selectedObject.y) > 0.000001
      const hasRotation = Math.abs(rotationDelta) > 0.000001
      const batchLabel =
        hasTranslation && hasRotation
          ? 'Transform group'
          : hasTranslation
            ? 'Move group'
            : 'Rotate group'

      beginCommandBatch(batchLabel)
      moveObject(selectedObject.id, {
        x: targetCenter.x,
        y: targetCenter.y,
        w: nextWidth,
        h: nextHeight,
        rotation: normalizeRotationRadians(targetRotation),
      })

      descendantIds.forEach((childId) => {
        const child = objectById.get(childId)
        if (!child) {
          return
        }
        const rotatedOffset = rotatePoint(
          {
            x: child.x - groupCenter.x,
            y: child.y - groupCenter.y,
          },
          rotationDelta
        )
        moveObject(child.id, {
          x: targetCenter.x + rotatedOffset.x,
          y: targetCenter.y + rotatedOffset.y,
          w: child.w,
          h: child.h,
          rotation: normalizeRotationRadians(child.rotation + rotationDelta),
        })
      })
      commitCommandBatch()
      return
    }

    moveObject(selectedObject.id, {
      x: patch.x ?? selectedObject.x,
      y: patch.y ?? selectedObject.y,
      w: nextWidth,
      h: nextHeight,
      rotation: patch.rotation ?? selectedObject.rotation,
    })
  }

  function toggleSelectedObjectAspectRatioLock() {
    if (!selectedObject || selectedObjectTransformLocked || isSelectedObjectAspectRatioLockForced) {
      return
    }
    const nextLocked = !isSelectedObjectAspectRatioLocked
    beginCommandBatch(nextLocked ? 'Lock aspect ratio' : 'Unlock aspect ratio')
    setObjectKeepAspectRatio(selectedObject.id, nextLocked)
    commitCommandBatch()
  }

  function updateSelectedShapeData(patch: Partial<ShapeData>) {
    if (
      !selectedShapeObject ||
      selectedShapeObject.locked ||
      selectedObjectLockedByAncestor
    ) {
      return
    }

    setShapeData(
      selectedShapeObject.id,
      normalizeShapeData(selectedShapeObject.shapeData, patch)
    )
  }

  function updateSelectedImageData(patch: Partial<ImageData>) {
    if (
      !selectedImageObject ||
      selectedImageObject.locked ||
      selectedObjectLockedByAncestor
    ) {
      return
    }

    setImageData(
      selectedImageObject.id,
      normalizeImageData(selectedImageObject.imageData, patch)
    )
  }

  function updateSelectedVideoData(patch: Partial<VideoData>) {
    if (
      !selectedVideoObject ||
      selectedVideoObject.locked ||
      selectedObjectLockedByAncestor
    ) {
      return
    }

    setVideoData(
      selectedVideoObject.id,
      normalizeVideoData(selectedVideoObject.videoData, patch)
    )
  }

  function updateSelectedSoundData(patch: Partial<SoundData>) {
    if (
      !selectedSoundObject ||
      selectedSoundObject.locked ||
      selectedObjectLockedByAncestor
    ) {
      return
    }

    setSoundData(
      selectedSoundObject.id,
      normalizeSoundData(selectedSoundObject.soundData, patch)
    )
  }

  function applySelectedObjectStyleRole(roleId: string) {
    if (
      !selectedObject ||
      !effectiveStylePreset ||
      selectedObject.locked ||
      selectedObjectLockedByAncestor
    ) {
      return
    }

    const role = effectiveStylePreset.objectStyles.find((entry) => entry.id === roleId)
    if (!role) {
      return
    }

    beginCommandBatch(`Apply object style: ${role.label}`)
    if (selectedShapeObject) {
      setShapeData(
        selectedShapeObject.id,
        normalizeShapeData(selectedShapeObject.shapeData, {
          fillMode: 'solid',
          fillGradient: null,
          fillColor: role.fillColor,
          borderColor: role.borderColor,
          borderWidth: role.borderWidth,
          opacityPercent: role.opacityPercent,
        })
      )
    } else if (selectedTextboxObject) {
      const textRole = resolvePresetTextRole(effectiveStylePreset, 'text', availableStylePresets)
      const textColor = role.textColor || textRole?.color || effectiveStylePreset.textColor
      const fontFamily = textRole?.fontFamily ?? effectiveStylePreset.fontFamily
      setTextboxData(
        selectedTextboxObject.id,
        normalizeTextboxData(selectedTextboxObject.textboxData, {
          fillMode: 'solid',
          fillGradient: null,
          backgroundColor: role.fillColor,
          borderColor: role.borderColor,
          borderWidth: role.borderWidth,
          opacityPercent: role.opacityPercent,
          runs: selectedTextboxObject.textboxData.runs.map((run) => ({
            ...run,
            color: textColor,
          })),
          richTextHtml: applyTextboxThemeRichHtml(
            resolveTextboxRichHtml(selectedTextboxObject.textboxData),
            {
              fontFamily,
              textColor,
            }
          ),
        })
      )
    } else if (selectedImageObject) {
      setImageData(
        selectedImageObject.id,
        normalizeImageData(selectedImageObject.imageData, {
          borderColor: role.borderColor,
          opacityPercent: role.opacityPercent,
        })
      )
    } else if (selectedVideoObject) {
      setVideoData(
        selectedVideoObject.id,
        normalizeVideoData(selectedVideoObject.videoData, {
          borderColor: role.borderColor,
          opacityPercent: role.opacityPercent,
        })
      )
    } else if (selectedSoundObject) {
      setSoundData(
        selectedSoundObject.id,
        normalizeSoundData(selectedSoundObject.soundData, {
          borderColor: role.borderColor,
          opacityPercent: role.opacityPercent,
        })
      )
    }
    commitCommandBatch()
  }

  function updateSelectedObjectShadow(
    patch: Partial<Pick<ShapeData, 'shadowColor' | 'shadowBlurPx' | 'shadowAngleDeg'>>
  ) {
    if (selectedShapeObject) {
      updateSelectedShapeData(patch)
      return
    }
    if (selectedTextboxObject) {
      updateSelectedTextboxData(patch)
      return
    }
    if (selectedImageObject) {
      updateSelectedImageData(patch)
      return
    }
    if (selectedVideoObject) {
      updateSelectedVideoData(patch)
      return
    }
    if (selectedSoundObject) {
      updateSelectedSoundData(patch)
    }
  }

  function updateMultiSelectedOpacity(opacityPercent: number) {
    applyToUnlockedSelection('Update selected opacity', (object) => {
      if (object.type === 'textbox') {
        setTextboxData(object.id, normalizeTextboxData(object.textboxData, { opacityPercent }))
        return
      }
      if (object.type === 'image') {
        setImageData(object.id, normalizeImageData(object.imageData, { opacityPercent }))
        return
      }
      if (object.type === 'video') {
        setVideoData(object.id, normalizeVideoData(object.videoData, { opacityPercent }))
        return
      }
      if (object.type === 'sound') {
        setSoundData(object.id, normalizeSoundData(object.soundData, { opacityPercent }))
        return
      }
      if (object.type === 'shape_rect' || object.type === 'shape_circle') {
        setShapeData(object.id, normalizeShapeData(object.shapeData, { opacityPercent }))
      }
    })
  }

  function updateMultiSelectedRadius(radiusPercent: number) {
    applyToUnlockedSelection('Update selected radius', (object) => {
      const radius = radiusPercentToPx(radiusPercent, object.w, object.h)
      if (object.type === 'textbox') {
        setTextboxData(object.id, normalizeTextboxData(object.textboxData, { radius }))
        return
      }
      if (object.type === 'image') {
        setImageData(object.id, normalizeImageData(object.imageData, { radius }))
        return
      }
      if (object.type === 'video') {
        setVideoData(object.id, normalizeVideoData(object.videoData, { radius }))
        return
      }
      if (object.type === 'sound') {
        setSoundData(object.id, normalizeSoundData(object.soundData, { radius }))
        return
      }
      if (
        object.type === 'shape_rect' &&
        shapeSupportsRadius(normalizeShapeKind(object.shapeData.kind))
      ) {
        setShapeData(object.id, normalizeShapeData(object.shapeData, { radius }))
      }
    })
  }

  function updateMultiSelectedShadow(
    patch: Partial<Pick<ShapeData, 'shadowColor' | 'shadowBlurPx' | 'shadowAngleDeg'>>
  ) {
    applyToUnlockedSelection('Update selected shadow', (object) => {
      if (object.type === 'textbox') {
        setTextboxData(object.id, normalizeTextboxData(object.textboxData, patch))
        return
      }
      if (object.type === 'image') {
        setImageData(object.id, normalizeImageData(object.imageData, patch))
        return
      }
      if (object.type === 'video') {
        setVideoData(object.id, normalizeVideoData(object.videoData, patch))
        return
      }
      if (object.type === 'sound') {
        setSoundData(object.id, normalizeSoundData(object.soundData, patch))
        return
      }
      if (object.type === 'shape_rect' || object.type === 'shape_circle') {
        setShapeData(object.id, normalizeShapeData(object.shapeData, patch))
      }
    })
  }

  function updateMultiSelectedBackground(options: {
    fillMode: TextboxData['fillMode']
    color?: string
    gradient?: FillGradient | null
    closeEditor?: boolean
  }) {
    const nextGradient = normalizeFillGradient(options.gradient ?? null, multiEditFillColor, '#ffffff')
    applyToUnlockedSelection('Update selected backgrounds', (object) => {
      if (object.type === 'textbox') {
        setTextboxData(
          object.id,
          normalizeTextboxData(object.textboxData, {
            fillMode: options.fillMode,
            fillGradient: options.fillMode === 'linearGradient' ? nextGradient : null,
            backgroundColor:
              options.fillMode === 'solid'
                ? options.color ?? object.textboxData.backgroundColor
                : object.textboxData.backgroundColor,
          })
        )
        return
      }
      if (object.type === 'shape_rect' || object.type === 'shape_circle') {
        setShapeData(
          object.id,
          normalizeShapeData(object.shapeData, {
            fillMode: options.fillMode,
            fillGradient: options.fillMode === 'linearGradient' ? nextGradient : null,
            fillColor:
              options.fillMode === 'solid'
                ? options.color ?? object.shapeData.fillColor
                : object.shapeData.fillColor,
          })
        )
      }
    })
    if (options.closeEditor ?? true) {
      closeFillEditor()
    }
  }

  function updateMultiSelectedBorder(
    patch: Partial<
      Pick<ShapeData, 'borderWidth' | 'borderType' | 'borderColor'>
    >
  ) {
    applyToUnlockedSelection('Update selected borders', (object) => {
      if (object.type === 'textbox') {
        setTextboxData(object.id, normalizeTextboxData(object.textboxData, patch))
        return
      }
      if (object.type === 'image') {
        setImageData(object.id, normalizeImageData(object.imageData, patch))
        return
      }
      if (object.type === 'video') {
        setVideoData(object.id, normalizeVideoData(object.videoData, patch))
        return
      }
      if (object.type === 'sound') {
        setSoundData(object.id, normalizeSoundData(object.soundData, patch))
        return
      }
      if (object.type === 'shape_rect' || object.type === 'shape_circle') {
        setShapeData(object.id, normalizeShapeData(object.shapeData, patch))
      }
    })
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
    if (selectedObjectIds.length > 1 && (selectedShapeObjects.length > 0 || selectedTextboxObjects.length > 0)) {
      applyToUnlockedSelection('Update selected gradients', (object) => {
        if (object.type === 'textbox') {
          setTextboxData(
            object.id,
            normalizeTextboxData(object.textboxData, {
              fillMode: 'linearGradient',
              fillGradient: nextGradient,
            })
          )
          return
        }
        if (object.type === 'shape_rect' || object.type === 'shape_circle') {
          setShapeData(
            object.id,
            normalizeShapeData(object.shapeData, {
              fillMode: 'linearGradient',
              fillGradient: nextGradient,
            })
          )
        }
      })
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

  function setMultiSelectedProtected(nextProtected: boolean) {
    const targets = selectedObjects.filter(
      (object) => !hasLockedAncestor(object, objectById) && object.locked !== nextProtected
    )
    if (targets.length === 0) {
      return
    }
    beginCommandBatch(nextProtected ? 'Protect selected objects' : 'Unprotect selected objects')
    targets.forEach((object) => {
      toggleObjectLock(object.id)
    })
    commitCommandBatch()
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
    selectObjects([])
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

  function handlePresentShellPointerDownCapture(event: ReactPointerEvent<HTMLDivElement>) {
    const targetElement = event.target instanceof Element ? event.target : null
    if (targetElement?.closest('.present-stage')) {
      return
    }
    if (mode !== 'present' || presentFreeMoveEnabled || isInteractivePointerTarget(event.target)) {
      return
    }
    if (event.button === 0) {
      event.preventDefault()
      goToNextSlide()
      return
    }
    if (event.button === 2) {
      event.preventDefault()
      goToPreviousSlide()
    }
  }

  function handlePresentShellWheelCapture(event: WheelEvent<HTMLDivElement>) {
    const targetElement = event.target instanceof Element ? event.target : null
    if (targetElement?.closest('.present-stage')) {
      return
    }
    if (mode !== 'present' || presentFreeMoveEnabled || isInteractivePointerTarget(event.target)) {
      return
    }
    event.preventDefault()
    const now = performance.now()
    if (now < presentMouseWheelThrottleUntilRef.current || Math.abs(event.deltaY) < 6) {
      return
    }
    presentMouseWheelThrottleUntilRef.current = now + 220
    if (event.deltaY > 0) {
      goToNextSlide()
      return
    }
    goToPreviousSlide()
  }

  function handlePresentShellContextMenuCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (mode !== 'present' || presentFreeMoveEnabled || isInteractivePointerTarget(event.target)) {
      return
    }
    event.preventDefault()
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

  function resolveTargetFrameFitScale() {
    const logicalHalfDiagonal = getTargetFrameHalfDiagonal(
      templateTargetDisplayFrame.width,
      templateTargetDisplayFrame.height
    )
    const fittedHalfDiagonal = getTargetFrameHalfDiagonal(
      templateTargetDisplayFittedFrame.width,
      templateTargetDisplayFittedFrame.height
    )
    if (!Number.isFinite(logicalHalfDiagonal) || !Number.isFinite(fittedHalfDiagonal) || fittedHalfDiagonal <= 0) {
      return 1
    }
    return logicalHalfDiagonal / fittedHalfDiagonal
  }

  function resolveSlideZoom(slide: Slide) {
    return Math.min(
      100,
      Math.max(
        0.01,
        zoomFromDiagonal(
          Math.max(0.0001, slide.diagonal),
          templateTargetDisplayFittedFrame.width,
          templateTargetDisplayFittedFrame.height
        )
      )
    )
  }

  function resolveSlideDiagonal(zoom: number) {
    return Math.max(
      0.0001,
      diagonalFromZoom(
        zoom,
        templateTargetDisplayFittedFrame.width,
        templateTargetDisplayFittedFrame.height
      )
    )
  }

  function handleCreateSlide() {
    const slide: Slide = {
      id: createId(),
      name: `Slide ${orderedSlides.length + 1}`,
      x: camera.x,
      y: camera.y,
      diagonal: resolveSlideDiagonal(camera.zoom),
      rotation: camera.rotation,
      triggerMode: 'manual',
      triggerDelayMs: 0,
      transitionType: 'ease',
      transitionDurationMs: 2000,
      orderIndex: orderedSlides.length,
    }

    createSlide(slide)
    selectSlide(slide.id)
    selectObjects([])
  }

  function handleCreateSlideFromTemplate(templateId: SlideTemplate['id']) {
    const template = availableSlideTemplates.find((entry) => entry.id === templateId)
    if (!template) {
      return
    }

    const centerX = camera.x
    const centerY = camera.y
    const frameFitScale = resolveTargetFrameFitScale()
    const referenceZoom = camera.zoom * frameFitScale
    const referenceRotation = camera.rotation
    const targetTemplateWidth = Math.max(1, templateTargetDisplayFrame.width)
    const targetTemplateHeight = Math.max(1, templateTargetDisplayFrame.height)
    const slideId = createId()
    const { slide, objects } = buildSlideTemplateInstance(template, {
      slideId,
      orderIndex: orderedSlides.length,
      centerX,
      centerY,
      zoom: referenceZoom,
      rotation: referenceRotation,
      frameWidth: targetTemplateWidth,
      frameHeight: targetTemplateHeight,
      scalePercent: getZoomAdjustedObjectScalePercent(referenceZoom),
      createId,
      zIndexStart: getNextZIndex(),
      stylePreset: effectiveStylePreset,
    })
    const templateGroupId = createId()
    const templateFrame = getSlideTemplateFrameSize(
      referenceZoom,
      targetTemplateWidth,
      targetTemplateHeight
    )
    const groupedObjects = objects.map((object) => ({
      ...object,
      parentGroupId: templateGroupId,
    }))
    const templateGroup: CanvasObject = {
      id: templateGroupId,
      type: 'group',
      x: slide.x,
      y: slide.y,
      w: templateFrame.width,
      h: templateFrame.height,
      rotation: slide.rotation,
      scalePercent: 100,
      keepAspectRatio: false,
      locked: false,
      zIndex: getNextZIndex() + objects.length,
      parentGroupId: null,
      groupData: {
        childIds: objects.map((object) => object.id),
      },
    }

    beginCommandBatch(`Create ${template.name} template slide`)
    createSlide(slide)
    createObject(templateGroup)
    groupedObjects.forEach((object) => {
      createObject(object)
    })
    commitCommandBatch()
    selectSlide(slide.id)
    selectObjects([])
    if (mode !== 'present') {
      focusCameraOnSlide(slide)
    }
  }

  function handleUpdateSlideFromCamera() {
    if (!activeSlide) {
      return
    }
    updateSlide(activeSlide.id, {
      ...activeSlide,
      x: camera.x,
      y: camera.y,
      diagonal: resolveSlideDiagonal(camera.zoom),
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
      patch.diagonal !== undefined ||
      patch.rotation !== undefined
    if (cameraFieldsChanged && mode !== 'present') {
      setCamera({
        x: nextSlide.x,
        y: nextSlide.y,
        zoom: resolveSlideZoom(nextSlide),
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

  function setNativeInputValue(input: HTMLInputElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    descriptor?.set?.call(input, value)
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
    setNativeInputValue(input, next.toFixed(precision))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  useEffect(() => {
    if (
      (
        fillEditorTarget === 'object' &&
        !selectedShapeObject &&
        !selectedTextboxObject &&
        !hasMultiSelectedFillTargets
      ) ||
      (fillEditorTarget === 'canvas' && !showCanvasParameters)
    ) {
      closeFillEditor()
    }
  }, [
    fillEditorTarget,
    hasMultiSelectedFillTargets,
    selectedShapeObject,
    selectedTextboxObject,
    showCanvasParameters,
  ])

  useEffect(() => {
    if (!isShapeMenuOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (shapeMenuRef.current?.contains(event.target as Node)) {
        return
      }
      setIsShapeMenuOpen(false)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [isShapeMenuOpen])

  useEffect(() => {
    if (!designAssetContextMenu) {
      return
    }

    const closeMenu = () => setDesignAssetContextMenu(null)
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('.design-asset-context-menu')) {
        return
      }
      closeMenu()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [designAssetContextMenu])

  useEffect(() => {
    let importedCount = 0
    for (const asset of document.assets) {
      if (resolveLibraryAssetKind(asset) !== 'style') {
        continue
      }
      try {
        const parsed = JSON.parse(decodeAssetBase64ToText(asset.dataBase64)) as unknown
        const result = registerDesignAssetDefinitionsFromPayload(parsed, asset.name, asset.id)
        const embeddedAssetResult = importLibraryAssetDefinitions(
          extractLibraryAssetDefinitionsFromUnknown(parsed)
        )
        importedCount += result.styleAdded + result.templateAdded
        importedCount += embeddedAssetResult.added
      } catch {
        // Ignore invalid JSON assets already stored in the library.
      }
    }
    if (importedCount > 0) {
      setDesignAssetRevision((current) => current + 1)
    }
  }, [document.assets])

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
    if (presentFreeMoveEnabled) {
      if (timedAdvanceTimeoutRef.current !== null) {
        window.clearTimeout(timedAdvanceTimeoutRef.current)
        timedAdvanceTimeoutRef.current = null
      }
      return
    }
    if (!shouldAutoAdvanceSlide(activeSlide, activeSlideIndex, orderedSlides.length)) {
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
    presentFreeMoveEnabled,
    selectedSlideId,
    activeSlide?.triggerDelayMs,
    activeSlide?.triggerMode,
  ])

  useEffect(() => {
    if (mode !== 'edit') {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextInputTarget(event.target) || !(event.metaKey || event.ctrlKey)) {
        return
      }

      const key = event.key.toLowerCase()
      if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          if (canRedo) {
            redo()
          }
        } else if (canUndo) {
          undo()
        }
        return
      }

      if (key === 'y') {
        if (canRedo) {
          event.preventDefault()
          redo()
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canRedo, canUndo, mode, redo, undo])

  useEffect(() => {
    if (mode !== 'present') {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (isForwardPresentationKey(event.key)) {
        event.preventDefault()
        goToNextSlide()
        return
      }

      if (isBackwardPresentationKey(event.key)) {
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
    if (mode !== 'present') {
      return
    }

    const onFullscreenChange = () => {
      if (window.document.fullscreenElement) {
        return
      }
      setMode('edit')
      stopSlideTransition()
      if (timedAdvanceTimeoutRef.current !== null) {
        window.clearTimeout(timedAdvanceTimeoutRef.current)
        timedAdvanceTimeoutRef.current = null
      }
    }

    window.document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      window.document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [mode, setMode])

  useEffect(() => {
    return () => {
      stopSlideTransition()
      if (timedAdvanceTimeoutRef.current !== null) {
        window.clearTimeout(timedAdvanceTimeoutRef.current)
        timedAdvanceTimeoutRef.current = null
      }
    }
  }, [])

  function downloadJsonFile(fileName: string, payload: unknown) {
    const serialized = JSON.stringify(payload, null, 2)
    const blob = new Blob([serialized], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const downloadLink = window.document.createElement('a')
    downloadLink.href = url
    downloadLink.download = fileName
    downloadLink.click()
    URL.revokeObjectURL(url)
  }

  function handleSaveDocument() {
    downloadJsonFile('infiniprez-document.json', {
      document: JSON.parse(serializeDocument(document)),
      camera,
    })
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

  function handleOpenDesignAssetContextMenu(
    kind: DesignAssetContextMenu['kind'],
    id: string,
    event: ReactMouseEvent
  ) {
    event.preventDefault()
    setDesignAssetContextMenu({
      kind,
      id,
      x: event.clientX,
      y: event.clientY,
    })
  }

  function handleDownloadStylePresetJson(id: string) {
    const definition = getStylePresetDefinitionById(id)
    if (!definition) {
      return
    }
    downloadJsonFile(`${id}.style-preset.json`, definition)
  }

  function handleDownloadTemplateJson(id: string) {
    const definition = getSlideTemplateDefinitionById(id)
    if (!definition) {
      return
    }
    downloadJsonFile(`${id}.slide-template.json`, definition)
  }

  function handleDownloadDesignAssetFromContextMenu() {
    if (!designAssetContextMenu) {
      return
    }
    if (designAssetContextMenu.kind === 'style') {
      handleDownloadStylePresetJson(designAssetContextMenu.id)
    } else {
      handleDownloadTemplateJson(designAssetContextMenu.id)
    }
    setDesignAssetContextMenu(null)
  }

  async function handleLoadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    let payload = ''
    try {
      payload = await file.text()
      const loaded = parseStoredFile(payload)
      replaceDocument(loaded.document)
      setActiveStylePresetId(null)
      clearCreationTool()
      if (loaded.camera) {
        setCamera(loaded.camera)
      }
    } catch {
      try {
        const parsed = JSON.parse(payload) as unknown
        const result = registerDesignAssetDefinitionsFromPayload(parsed, file.name)
        const embeddedAssetResult = importLibraryAssetDefinitions(
          extractLibraryAssetDefinitionsFromUnknown(parsed)
        )
        const discoveredCount =
          result.styleAdded +
          result.styleDuplicates +
          result.styleRejected +
          result.templateAdded +
          result.templateDuplicates +
          result.templateRejected +
          embeddedAssetResult.added +
          embeddedAssetResult.duplicates +
          embeddedAssetResult.rejected

        if (discoveredCount > 0) {
          if (result.styleAdded > 0 || result.templateAdded > 0) {
            setDesignAssetRevision((current) => current + 1)
          }
          window.alert(
            `Loaded design assets: ${result.styleAdded} style(s), ${result.templateAdded} template(s), ${embeddedAssetResult.added} embedded asset(s), ${result.styleDuplicates + result.templateDuplicates + embeddedAssetResult.duplicates} duplicate(s), ${embeddedAssetResult.rejected} rejected asset(s).`
          )
          return
        }
      } catch {
        // Ignore and show the generic error below.
      }
      window.alert(
        'Failed to load file. Use a valid Infiniprez JSON document or style/template/asset bundle JSON.'
      )
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

  const designAssetContextMenuStyle: CSSProperties | undefined = designAssetContextMenu
    ? {
      left:
        typeof window === 'undefined'
          ? designAssetContextMenu.x
          : Math.max(12, Math.min(designAssetContextMenu.x, window.innerWidth - 220)),
      top:
        typeof window === 'undefined'
          ? designAssetContextMenu.y
          : Math.max(12, Math.min(designAssetContextMenu.y, window.innerHeight - 120)),
    }
    : undefined

  return (
    <div
      className={`app-shell ${mode === 'present' ? 'present-mode' : 'has-context-sidebar'} ${isLeftSidebarHidden ? 'left-sidebar-hidden' : ''} ${isRightSidebarHidden ? 'right-sidebar-hidden' : ''}`}
      onPointerDownCapture={handlePresentShellPointerDownCapture}
      onWheelCapture={handlePresentShellWheelCapture}
      onContextMenuCapture={handlePresentShellContextMenuCapture}
    >
      {isAssetBundlerOpen && typeof window !== 'undefined' && window.document.body && createPortal(
        <div className="asset-bundler-modal-overlay" onClick={closeAssetBundlerModal}>
          <div className="asset-bundler-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="asset-bundler-header">
              <h2 className="asset-bundler-title">Asset Bundler</h2>
              <button
                type="button"
                className="asset-bundler-close-btn"
                onClick={closeAssetBundlerModal}
                aria-label="Close asset bundler"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="asset-bundler-body">
              <div className="asset-bundler-section">
                <h3>Styles ({bundlerCheckedStyles.size})</h3>
                <div className="asset-bundler-list">
                  {bundlerStyleSections.map((section, sectionIndex) => (
                    <div key={`bundler-style-${section.fileName}`} className="asset-bundler-subsection">
                      {sectionIndex > 0 ? <hr className="asset-bundler-divider" /> : null}
                      <div className="asset-bundler-subtitle">{section.fileName}</div>
                      {section.entries.map((entry) => (
                        <label key={entry.definition.id} className="asset-bundler-item">
                          <input
                            type="checkbox"
                            checked={bundlerCheckedStyles.has(entry.definition.id)}
                            onChange={() => {
                              setBundlerCheckedStyles((prev) => {
                                const next = new Set(prev)
                                if (next.has(entry.definition.id)) {
                                  next.delete(entry.definition.id)
                                } else {
                                  next.add(entry.definition.id)
                                }
                                return next
                              })
                            }}
                          />
                          <span className="asset-bundler-item-preview">
                            <FontAwesomeIcon icon={faLayerGroup} />
                          </span>
                          <span className="asset-bundler-item-name">{entry.preset.name}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="asset-bundler-section">
                <h3>Templates ({bundlerCheckedTemplates.size})</h3>
                <div className="asset-bundler-list">
                  {bundlerTemplateSections.map((section, sectionIndex) => (
                    <div key={`bundler-template-${section.fileName}`} className="asset-bundler-subsection">
                      {sectionIndex > 0 ? <hr className="asset-bundler-divider" /> : null}
                      <div className="asset-bundler-subtitle">{section.fileName}</div>
                      {section.entries.map((entry) => (
                        <label key={entry.definition.id} className="asset-bundler-item">
                          <input
                            type="checkbox"
                            checked={bundlerCheckedTemplates.has(entry.definition.id)}
                            onChange={() => {
                              setBundlerCheckedTemplates((prev) => {
                                const next = new Set(prev)
                                if (next.has(entry.definition.id)) {
                                  next.delete(entry.definition.id)
                                } else {
                                  next.add(entry.definition.id)
                                }
                                return next
                              })
                            }}
                          />
                          <span className="asset-bundler-item-preview">
                            <FontAwesomeIcon icon={faFileImport} />
                          </span>
                          <span className="asset-bundler-item-name">{entry.definition.name}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="asset-bundler-section">
                <h3>Assets ({bundlerCheckedAssets.size})</h3>
                <div className="asset-bundler-list">
                  {bundlerAssetTree.map(({ root, children }) => (
                    <div key={`bundler-asset-root-${root.asset.id}`} className="asset-bundler-tree-node">
                      <label className="asset-bundler-item">
                        <input
                          type="checkbox"
                          checked={bundlerCheckedAssets.has(root.asset.id)}
                          onChange={() => {
                            setBundlerCheckedAssets((prev) => {
                              const next = new Set(prev)
                              if (next.has(root.asset.id)) {
                                next.delete(root.asset.id)
                              } else {
                                next.add(root.asset.id)
                              }
                              return next
                            })
                          }}
                        />
                        <span className={`asset-bundler-item-preview ${root.kind}`}>
                          {root.kind === 'image' ? (
                            <img src={root.src} alt="" draggable={false} />
                          ) : (
                            <FontAwesomeIcon icon={getAssetTypeIcon(root.kind)} />
                          )}
                        </span>
                        <span className="asset-bundler-item-name">{root.asset.name}</span>
                      </label>
                      {children.map((child) => (
                        <label
                          key={`bundler-asset-child-${child.asset.id}`}
                          className="asset-bundler-item asset-bundler-item-child"
                        >
                          <input
                            type="checkbox"
                            checked={bundlerCheckedAssets.has(child.asset.id)}
                            onChange={() => {
                              setBundlerCheckedAssets((prev) => {
                                const next = new Set(prev)
                                if (next.has(child.asset.id)) {
                                  next.delete(child.asset.id)
                                } else {
                                  next.add(child.asset.id)
                                }
                                return next
                              })
                            }}
                          />
                          <span className={`asset-bundler-item-preview ${child.kind}`}>
                            {child.kind === 'image' ? (
                              <img src={child.src} alt="" draggable={false} />
                            ) : (
                              <FontAwesomeIcon icon={getAssetTypeIcon(child.kind)} />
                            )}
                          </span>
                          <span className="asset-bundler-item-name">{child.asset.name}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="asset-bundler-footer">
              <button
                type="button"
                className="asset-bundler-export-btn"
                onClick={handleAssetBundlerExport}
                disabled={
                  bundlerCheckedStyles.size === 0 &&
                  bundlerCheckedTemplates.size === 0 &&
                  bundlerCheckedAssets.size === 0
                }
              >
                Export Selected
              </button>
            </div>
          </div>
        </div>,
        window.document.body
      )}
      <aside className={`sidebar sidebar-left ${isLeftSidebarHidden ? 'hidden' : ''}`}>
        <section className="panel">
          <h2>Infiniprez</h2>
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
          <div ref={setSlidesTargetDisplayPortalNode} className="slides-target-display-slot" />
        </section>

        {selectedSlide && selectedObjectIds.length === 0 ? (
          <section className="panel">
            <h2>Slide Parameters</h2>
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
                <span>Diagonal</span>
                <div className="slide-param-slider-control">
                  <input
                    type="range"
                    min={Math.max(
                      0.0001,
                      getTargetFrameHalfDiagonal(templateTargetDisplayFrame.width, templateTargetDisplayFrame.height) / 100
                    )}
                    max={Math.max(
                      0.001,
                      getTargetFrameHalfDiagonal(templateTargetDisplayFrame.width, templateTargetDisplayFrame.height) / 0.01
                    )}
                    step={Math.max(
                      0.0001,
                      getTargetFrameHalfDiagonal(templateTargetDisplayFrame.width, templateTargetDisplayFrame.height) / 1000
                    )}
                    value={activeSlide.diagonal}
                    onWheel={handleRangeWheel}
                    onChange={(event) => {
                      const parsed = parseNumberInput(event.target.value)
                      if (parsed !== null) {
                        updateActiveSlide({ diagonal: Math.max(0.0001, parsed) })
                      }
                    }}
                  />
                  <strong>{activeSlide.diagonal.toFixed(1)}</strong>
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
                    onDoubleClick={() => {
                      updateActiveSlide({ rotation: 0 })
                    }}
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
          </section>
        ) : null}

        <div
          ref={setLeftObjectParamsPortalNode}
          className="sidebar-portal-slot"
        />

        <section className="panel">
          <h2>Object Tools</h2>
          <div className="action-grid">
            <div ref={shapeMenuRef} className="shape-tool-dropdown">
              <button
                type="button"
                className={`tool-btn shape-tool-trigger ${activeCreationTool === 'shape_rect' || activeCreationTool === 'shape_circle' ? 'active' : ''
                  }`}
                onClick={() => {
                  setPendingImagePlacements([])
                  setIsShapeMenuOpen((current) => !current)
                }}
                aria-haspopup="menu"
                aria-expanded={isShapeMenuOpen}
                aria-label="Shapes"
                title="Shapes"
              >
                <FontAwesomeIcon icon={faShapes} />
                <span className="shape-tool-trigger-caret" aria-hidden="true">▼</span>
              </button>
              {isShapeMenuOpen ? (
                <div className="shape-tool-menu" role="menu" aria-label="Shape presets">
                  {SHAPE_KIND_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`shape-tool-option ${activeShapePresetId === option.id ? 'active' : ''}`}
                      onClick={() => handleShapePresetSelection(option.id)}
                      role="menuitem"
                      aria-label={option.label}
                      title={option.label}
                    >
                      <span
                        className={`shape-tool-option-preview ${option.id === 'circle' ? 'circle' : ''}`}
                        style={{
                          clipPath: option.id === 'circle' ? undefined : option.clipPath,
                          borderRadius:
                            option.id === 'circle'
                              ? '999px'
                              : option.id === 'roundedRect'
                                ? '0.45rem'
                                : '0.12rem',
                        }}
                        aria-hidden="true"
                      />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {objectInsertTools.map((tool) => (
              <button
                key={tool.label}
                type="button"
                className={`tool-btn icon-btn ${(tool.label === 'Textbox' && activeCreationTool === 'textbox') ||
                  (tool.label === 'Image' && activeCreationTool === 'image')
                  ? 'active'
                  : ''
                  }`}
                onClick={() => handleObjectTool(tool.label)}
                aria-label={tool.label}
                title={tool.label}
              >
                <FontAwesomeIcon icon={tool.icon} />
              </button>
            ))}
            <div className="object-tools-group-actions">
              {objectGroupTools.map((tool) => (
                <button
                  key={tool.label}
                  type="button"
                  className="tool-btn icon-btn"
                  disabled={
                    tool.label === 'Group'
                      ? !canGroupSelectionFromToolbar
                      : !canUngroupSelectionFromToolbar
                  }
                  onClick={() => handleObjectTool(tool.label)}
                  aria-label={tool.label}
                  title={tool.label}
                >
                  <FontAwesomeIcon icon={tool.icon} />
                </button>
              ))}
            </div>
          </div>
        </section>

      </aside>

      <aside
        className={`sidebar sidebar-right ${isAssetLibraryDragOver ? 'asset-drop-target' : ''} ${isRightSidebarHidden ? 'hidden' : ''}`}
        onDragOver={handleAssetLibraryDragOver}
        onDragLeave={handleAssetLibraryDragLeave}
        onDrop={handleAssetLibraryDrop}
      >
        {isAssetLibraryDragOver ? (
          <div className="sidebar-drop-overlay" aria-hidden="true">
            <AssetDropHint />
          </div>
        ) : null}
        <section className="sidebar-tabbed-pane">
          <div className="panel-tab-switch" role="tablist" aria-label="Design panel sections">
            <button
              type="button"
              role="tab"
              aria-selected={activeDesignTab === 'styles'}
              className={activeDesignTab === 'styles' ? 'active' : ''}
              onClick={() => setActiveDesignTab('styles')}
            >
              Styles
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeDesignTab === 'templates'}
              className={activeDesignTab === 'templates' ? 'active' : ''}
              onClick={() => setActiveDesignTab('templates')}
            >
              Templates
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeDesignTab === 'assets'}
              className={activeDesignTab === 'assets' ? 'active' : ''}
              onClick={() => setActiveDesignTab('assets')}
            >
              Assets
            </button>
          </div>

          {activeDesignTab === 'styles' ? (
            <div className="sidebar-tab-panel">
              <div className="asset-library-toolbar">
                <div className="asset-library-toolbar-row">
                  <input
                    type="search"
                    className="asset-library-search"
                    value={styleCatalogSearch}
                    onChange={(event) => setStyleCatalogSearch(event.target.value)}
                    placeholder="Search styles"
                    aria-label="Search styles"
                  />
                  <button
                    type="button"
                    className="asset-library-order-btn"
                    onClick={handleStyleCatalogNameSortToggle}
                    title={`Order by name ${styleCatalogSortDirection === 'desc' ? '(descending)' : '(ascending)'}`}
                    aria-label={`Order styles by name ${styleCatalogSortDirection === 'desc' ? 'descending' : 'ascending'}`}
                  >
                    <FontAwesomeIcon icon={styleCatalogSortDirection === 'desc' ? faArrowUpZA : faArrowDownAZ} />
                  </button>
                </div>
              </div>
              {filteredBuiltinStylePresets.length > 0 ? (
                <>
                  <div className="slide-template-section-title">System styles</div>
                  <div className="style-preset-grid" aria-label="Document style presets">
                    {filteredBuiltinStylePresets.map((preset) => {
                      const isActive = currentStylePreset?.id === preset.id
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={`style-preset-card ${isActive ? 'active' : ''}`}
                          onClick={() => applyStylePreset(preset)}
                          onContextMenu={(event) => handleOpenDesignAssetContextMenu('style', preset.id, event)}
                          title={`${preset.name}: ${preset.inspiration}`}
                        >
                          <span
                            className="style-preset-preview"
                            style={{ background: preset.canvasBackground }}
                            aria-hidden="true"
                          >
                            <span
                              className="style-preset-preview-shape"
                              style={{
                                background: preset.shapeFill,
                                borderColor: preset.shapeBorder,
                              }}
                            />
                            <span
                              className="style-preset-preview-textbox"
                              style={{
                                background: preset.textboxBackground,
                                borderColor: preset.textboxBorder,
                                color: preset.textColor,
                                fontFamily: preset.fontFamily,
                              }}
                            >
                              Ag
                            </span>
                          </span>
                          <span className="style-preset-name">{preset.name}</span>
                          <span className="style-preset-meta">{preset.inspiration}</span>
                          <span className="style-preset-swatches" aria-hidden="true">
                            <span style={{ background: preset.shapeFill }} />
                            <span style={{ background: preset.textboxBackground }} />
                            <span style={{ background: preset.textColor }} />
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </>
              ) : null}
              {filteredImportedStylePresetSections.map((section) => (
                <div key={`style-section-${section.fileName}`}>
                  <hr className="slide-template-divider" />
                  <div className="slide-template-section-title">{section.fileName}</div>
                  <div className="style-preset-grid" aria-label={`Imported styles from ${section.fileName}`}>
                    {section.presets.map((preset) => {
                      const isActive = currentStylePreset?.id === preset.id
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={`style-preset-card ${isActive ? 'active' : ''}`}
                          onClick={() => applyStylePreset(preset)}
                          onContextMenu={(event) => handleOpenDesignAssetContextMenu('style', preset.id, event)}
                          title={`${preset.name}: ${preset.inspiration}`}
                        >
                          <span
                            className="style-preset-preview"
                            style={{ background: preset.canvasBackground }}
                            aria-hidden="true"
                          >
                            <span
                              className="style-preset-preview-shape"
                              style={{
                                background: preset.shapeFill,
                                borderColor: preset.shapeBorder,
                              }}
                            />
                            <span
                              className="style-preset-preview-textbox"
                              style={{
                                background: preset.textboxBackground,
                                borderColor: preset.textboxBorder,
                                color: preset.textColor,
                                fontFamily: preset.fontFamily,
                              }}
                            >
                              Ag
                            </span>
                          </span>
                          <span className="style-preset-name">{preset.name}</span>
                          <span className="style-preset-meta">{preset.inspiration}</span>
                          <span className="style-preset-swatches" aria-hidden="true">
                            <span style={{ background: preset.shapeFill }} />
                            <span style={{ background: preset.textboxBackground }} />
                            <span style={{ background: preset.textColor }} />
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
              {filteredBuiltinStylePresets.length === 0 && filteredImportedStylePresetSections.length === 0 ? (
                <div className="sidebar-tab-empty">No matching styles.</div>
              ) : null}
            </div>
          ) : activeDesignTab === 'templates' ? (
            <div className="sidebar-tab-panel">
              <div className="asset-library-toolbar">
                <div className="asset-library-toolbar-row">
                  <input
                    type="search"
                    className="asset-library-search"
                    value={templateCatalogSearch}
                    onChange={(event) => setTemplateCatalogSearch(event.target.value)}
                    placeholder="Search templates"
                    aria-label="Search templates"
                  />
                  <button
                    type="button"
                    className="asset-library-order-btn"
                    onClick={handleTemplateCatalogNameSortToggle}
                    title={`Order by name ${templateCatalogSortDirection === 'desc' ? '(descending)' : '(ascending)'}`}
                    aria-label={`Order templates by name ${templateCatalogSortDirection === 'desc' ? 'descending' : 'ascending'}`}
                  >
                    <FontAwesomeIcon
                      icon={templateCatalogSortDirection === 'desc' ? faArrowUpZA : faArrowDownAZ}
                    />
                  </button>
                </div>
              </div>
              <div className="slide-template-section-title">System templates</div>
              <div className="slide-template-grid" aria-label="Generic slide templates">
                {filteredGenericSlideTemplates.map((template) => {
                  const preview = slideTemplatePreviews.get(template.id)
                  return (
                    <button
                      key={template.id}
                      type="button"
                      className="slide-template-card"
                      onClick={() => handleCreateSlideFromTemplate(template.id)}
                      onContextMenu={(event) =>
                        handleOpenDesignAssetContextMenu('template', template.id, event)
                      }
                      title={`${template.name}: ${template.description}`}
                    >
                      <span
                        className="slide-template-preview"
                        style={{ background: slideTemplateTheme.frame }}
                        aria-hidden="true"
                      >
                        {preview ? (
                          <SlideTemplatePreview
                            objects={preview.objects}
                            frameWidth={preview.frameWidth}
                            frameHeight={preview.frameHeight}
                          />
                        ) : null}
                      </span>
                      <span className="slide-template-name">{template.name}</span>
                      <span className="slide-template-description">{template.description}</span>
                    </button>
                  )
                })}
              </div>
              {filteredImportedTemplateSections.map((section) => (
                <div key={`template-section-${section.fileName}`}>
                  <hr className="slide-template-divider" />
                  <div className="slide-template-section-title">{section.fileName}</div>
                  <div className="slide-template-grid" aria-label={`Templates from ${section.fileName}`}>
                    {section.templates.map((template) => {
                      const preview = slideTemplatePreviews.get(template.id)
                      return (
                        <button
                          key={template.id}
                          type="button"
                          className="slide-template-card"
                          onClick={() => handleCreateSlideFromTemplate(template.id)}
                          onContextMenu={(event) =>
                            handleOpenDesignAssetContextMenu('template', template.id, event)
                          }
                          title={`${template.name}: ${template.description}`}
                        >
                          <span
                            className="slide-template-preview"
                            style={{ background: slideTemplateTheme.frame }}
                            aria-hidden="true"
                          >
                            {preview ? (
                              <SlideTemplatePreview
                                objects={preview.objects}
                                frameWidth={preview.frameWidth}
                                frameHeight={preview.frameHeight}
                              />
                            ) : null}
                          </span>
                          <span className="slide-template-name">{template.name}</span>
                          <span className="slide-template-description">{template.description}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
              {filteredGenericSlideTemplates.length === 0 && filteredImportedTemplateSections.length === 0 ? (
                <div className="sidebar-tab-empty">No matching templates.</div>
              ) : null}
            </div>
          ) : (
            <div
              className={`sidebar-tab-panel asset-library-panel ${assetLibraryEntries.length > 0 ? 'with-add-btn' : ''} ${isAssetLibraryDragOver ? 'drag-over' : ''}`}
            >
              {assetLibraryEntries.length > 0 ? (
                <div className="asset-library-toolbar">
                  <div className="asset-library-toolbar-row">
                    <input
                      type="search"
                      className="asset-library-search"
                      value={assetLibrarySearch}
                      onChange={(event) => setAssetLibrarySearch(event.target.value)}
                      placeholder="Search assets"
                      aria-label="Search assets"
                    />
                    <button
                      type="button"
                      className={`asset-library-order-btn ${assetLibrarySort === 'name' ? 'active' : ''}`}
                      onClick={() => handleAssetSortChange('name')}
                      title={`Order by name ${assetLibrarySort === 'name' && assetLibrarySortDirection === 'desc' ? '(descending)' : '(ascending)'}`}
                      aria-label={`Order assets by name ${assetLibrarySort === 'name' && assetLibrarySortDirection === 'desc' ? 'descending' : 'ascending'}`}
                    >
                      <FontAwesomeIcon
                        icon={
                          assetLibrarySort === 'name' && assetLibrarySortDirection === 'desc'
                            ? faArrowUpZA
                            : faArrowDownAZ
                        }
                      />
                    </button>
                    <button
                      type="button"
                      className={`asset-library-order-btn ${assetLibrarySort === 'size' ? 'active' : ''}`}
                      onClick={() => handleAssetSortChange('size')}
                      title={`Order by size ${assetLibrarySort === 'size' && assetLibrarySortDirection === 'desc' ? '(descending)' : '(ascending)'}`}
                      aria-label={`Order assets by size ${assetLibrarySort === 'size' && assetLibrarySortDirection === 'desc' ? 'descending' : 'ascending'}`}
                    >
                      <FontAwesomeIcon
                        icon={
                          assetLibrarySort === 'size' && assetLibrarySortDirection === 'desc'
                            ? faArrowUpShortWide
                            : faArrowDownWideShort
                        }
                      />
                    </button>
                  </div>
                  <div className="asset-library-filter-row" role="group" aria-label="Filter assets by type">
                    {(['image', 'video', 'audio', 'font', 'style'] as const).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        className={assetLibraryFilter === kind ? 'active' : ''}
                        onClick={() =>
                          setAssetLibraryFilter((current) => (current === kind ? null : kind))
                        }
                        title={getAssetTypeLabel(kind)}
                        aria-label={getAssetTypeLabel(kind)}
                      >
                        <FontAwesomeIcon icon={getAssetTypeIcon(kind)} />
                      </button>
                    ))}
                    <button
                      type="button"
                      className="asset-library-order-btn asset-library-bundler-btn"
                      onClick={openAssetBundlerModal}
                      title="Open asset bundler"
                      aria-label="Open asset bundler"
                    >
                      <FontAwesomeIcon icon={faBoxArchive} />
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="asset-library-content">
                {filteredAssetLibraryEntries.length > 0 ? (
                  <div className={`asset-library-grid ${isAssetLibraryDragOver ? 'drag-over' : ''}`} aria-label="Asset library">
                    {filteredAssetLibraryEntries.map((entry) => (
                      <div
                        key={entry.asset.id}
                        className={`asset-library-card ${entry.parentStyleAssetId ? 'child' : ''}`}
                        onPointerEnter={() => setHoveredAssetId(entry.asset.id)}
                        onPointerLeave={() => setHoveredAssetId((current) => (current === entry.asset.id ? null : current))}
                        onDragStart={
                          entry.kind === 'image' ||
                            entry.kind === 'video' ||
                            entry.kind === 'audio'
                            ? (event) => handleAssetDragStart(event, entry)
                            : undefined
                        }
                        draggable={
                          entry.kind === 'image' ||
                          entry.kind === 'video' ||
                          entry.kind === 'audio'
                        }
                        title={
                          entry.kind === 'image' ||
                            entry.kind === 'video' ||
                            entry.kind === 'audio'
                            ? `${entry.asset.name} · Drag onto canvas`
                            : entry.asset.name
                        }
                      >
                        <span className={`asset-library-thumb ${entry.kind}`} aria-hidden="true">
                          {entry.kind === 'image' ? (
                            <img src={entry.src} alt="" draggable={false} />
                          ) : entry.kind === 'video' ? (
                            <AssetVideoPreview src={entry.src} />
                          ) : entry.kind === 'font' ? (
                            <span
                              className="asset-library-font-preview"
                              style={{ fontFamily: resolveAssetFontFamily(entry.asset) }}
                            >
                              <span>Lorem ipsum dolor</span>
                              <span>sit amet consectetur</span>
                              <span>adipiscing elit sed</span>
                              <span>do eiusmod tempor</span>
                              <span>incididunt ut labore</span>
                            </span>
                          ) : entry.kind === 'audio' ? (
                            <span className="asset-library-thumb-label media">
                              <FontAwesomeIcon icon={faVolumeHigh} />
                            </span>
                          ) : entry.kind === 'style' ? (
                            <span className="asset-library-thumb-label media">
                              <FontAwesomeIcon icon={faFileImport} />
                            </span>
                          ) : (
                            <span className="asset-library-thumb-label">
                              Aa
                            </span>
                          )}
                        </span>
                        <span className="asset-library-meta">
                          <span className="asset-library-name">{entry.asset.name}</span>
                          <span className="asset-library-info">
                            <span className={`asset-library-badge ${entry.kind}`}>
                              <FontAwesomeIcon icon={getAssetTypeIcon(entry.kind)} />
                            </span>
                            {entry.kind === 'style' ? (
                              <>
                                {entry.linkedStylePresetNames.length > 0 ? (
                                  <span
                                    className="asset-library-design-pill"
                                    title={entry.linkedStylePresetNames.join('\n')}
                                  >
                                    {entry.linkedStylePresetNames.length === 1
                                      ? '1 style'
                                      : `${entry.linkedStylePresetNames.length} styles`}
                                  </span>
                                ) : null}
                                {entry.linkedSlideTemplateNames.length > 0 ? (
                                  <span
                                    className="asset-library-design-pill"
                                    title={entry.linkedSlideTemplateNames.join('\n')}
                                  >
                                    {entry.linkedSlideTemplateNames.length === 1
                                      ? '1 template'
                                      : `${entry.linkedSlideTemplateNames.length} templates`}
                                  </span>
                                ) : null}
                                {entry.embeddedChildAssetCount > 0 ? (
                                  <span
                                    className="asset-library-design-pill"
                                    title={entry.embeddedChildAssetNames.join('\n')}
                                  >
                                    {entry.embeddedChildAssetCount === 1
                                      ? '1 asset'
                                      : `${entry.embeddedChildAssetCount} assets`}
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              <>
                                <span className="asset-library-usage">
                                  {entry.usageCount === 1 ? '1 use' : `${entry.usageCount} uses`}
                                </span>
                              </>
                            )}
                            {entry.kind === 'video' || entry.kind === 'audio' ? (
                              <span className="asset-library-duration">
                                {formatAssetDuration(entry.durationSec) ?? '0:00'}
                              </span>
                            ) : null}
                            <span className="asset-library-size">
                              {formatBase64PayloadSize(entry.base64Size)}
                            </span>
                          </span>
                        </span>
                        {entry.usageCount === 0 && !entry.parentStyleAssetId ? (
                          <button
                            type="button"
                            className="asset-library-delete-btn"
                            onClick={() => handleDeleteAsset(entry.asset.id)}
                            aria-label={`Delete asset ${entry.asset.name}`}
                            title="Delete unused asset"
                          >
                            <FontAwesomeIcon icon={faTrashCan} />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`sidebar-tab-empty asset-library-empty ${isAssetLibraryDragOver ? 'drag-over' : ''}`}>
                    {assetLibraryEntries.length === 0 ? (
                      <AssetDropHint onClick={openAssetLibraryDialog} />
                    ) : (
                      'No matching assets.'
                    )}
                  </div>
                )}
              </div>
              {assetLibraryEntries.length > 0 ? (
                <button
                  type="button"
                  className="asset-library-add-btn"
                  onClick={openAssetLibraryDialog}
                  title="Add assets from your computer"
                >
                  <FontAwesomeIcon icon={faPlus} />
                  <span>Add Asset</span>
                </button>
              ) : null}
            </div>
          )}
        </section>

        {(() => {
          if (!showContextParameters) {
            return null
          }

          const objectParametersSection = (
            <section className="panel">
              {!isGradientEditorVisible && (
                <h2>{showObjectParameters ? 'Object Parameters' : 'Canvas Parameters'}</h2>
              )}
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
                    className={`object-gradient-preview ${selectedGradient.gradientType === 'circles' ? 'circles-mode' : ''
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

                  {selectedObjectSupportsStyleRole && effectiveStylePreset ? (
                    <div className="object-param-row">
                      <span>Object Style</span>
                      <div className="object-param-inputs-single">
                        <select
                          value={selectedObjectStyleRoleId ?? '__custom'}
                          disabled={selectedObjectTransformLocked}
                          onChange={(event) => {
                            if (event.target.value === '__custom') {
                              return
                            }
                            applySelectedObjectStyleRole(event.target.value)
                          }}
                          aria-label="Object style"
                          title="Apply object style"
                        >
                          <option value="__custom">Custom</option>
                          {effectiveStylePreset.objectStyles.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : null}

                  <div className="object-param-row">
                    <span>W, H</span>
                    <div className="object-param-inputs object-param-inputs-with-toggle">
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
                      <button
                        type="button"
                        className={`object-param-lock-btn ${isSelectedObjectAspectRatioLocked ? 'active' : ''}`}
                        disabled={selectedObjectTransformLocked || isSelectedObjectAspectRatioLockForced}
                        onClick={toggleSelectedObjectAspectRatioLock}
                        aria-label={
                          isSelectedObjectAspectRatioLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'
                        }
                        aria-pressed={isSelectedObjectAspectRatioLocked}
                        title={
                          isSelectedObjectAspectRatioLockForced
                            ? 'Aspect ratio is fixed for circles'
                            : isSelectedObjectAspectRatioLocked
                              ? 'Unlock aspect ratio'
                              : 'Lock aspect ratio'
                        }
                      >
                        <FontAwesomeIcon
                          icon={isSelectedObjectAspectRatioLocked ? faLock : faLockOpen}
                        />
                      </button>
                    </div>
                  </div>

                  {(selectedShapeObject ||
                    selectedTextboxObject ||
                    selectedImageObject ||
                    selectedVideoObject ||
                    selectedSoundObject ||
                    selectedGroupObject) && (
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
                            onDoubleClick={() => {
                              updateSelectedObjectTransform({ rotation: 0 })
                            }}
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
                    )}

                  {canScaleSelectedObject && (
                    <label className="object-param-slider">
                      <span>Scale</span>
                      <div className="object-param-slider-control">
                        <input
                          type="range"
                          min={OBJECT_SCALE_MIN_PERCENT}
                          max={OBJECT_SCALE_MAX_PERCENT}
                          step={1}
                          value={selectedObjectScalePercent}
                          disabled={selectedObjectTransformLocked}
                          onWheel={handleRangeWheel}
                          onDoubleClick={() => {
                            updateSelectedObjectScale(zoomCompensatedScalePercent)
                          }}
                          onChange={(event) => {
                            const parsed = parseNumberInput(event.target.value)
                            if (parsed !== null) {
                              updateSelectedObjectScale(parsed)
                            }
                          }}
                        />
                        <strong>{selectedObjectScalePercent}%</strong>
                      </div>
                    </label>
                  )}

                  {(selectedShapeObject ||
                    selectedTextboxObject ||
                    selectedImageObject ||
                    selectedVideoObject ||
                    selectedSoundObject) && (
                      <label className="object-param-slider">
                        <span>Opacity</span>
                        <div className="object-param-slider-control">
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={selectedObjectOpacityPercent}
                            disabled={selectedObjectTransformLocked}
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
                              } else if (selectedVideoObject) {
                                const parsed = parseNumberInput(event.target.value)
                                if (parsed !== null) {
                                  updateSelectedVideoData({ opacityPercent: parsed })
                                }
                              } else if (selectedSoundObject) {
                                const parsed = parseNumberInput(event.target.value)
                                if (parsed !== null) {
                                  updateSelectedSoundData({ opacityPercent: parsed })
                                }
                              }
                            }}
                          />
                          <strong>{`${Math.round(selectedObjectOpacityPercent)}%`}</strong>
                        </div>
                      </label>
                    )}

                  {(selectedShapeSupportsRadius || selectedTextboxObject || selectedImageObject || selectedVideoObject || selectedSoundObject) && (
                    <label className="object-param-slider">
                      <span>Radius</span>
                      <div className="object-param-slider-control">
                        <input
                          type="range"
                          min={0}
                          max={MAX_RADIUS_PERCENT}
                          step={1}
                          value={selectedObjectRadiusPercent}
                          disabled={selectedObjectTransformLocked}
                          onWheel={handleRangeWheel}
                          onChange={(event) => {
                            const parsed = parseNumberInput(event.target.value)
                            if (parsed !== null && selectedShapeObject) {
                              updateSelectedShapeData({
                                radius: radiusPercentToPx(parsed, selectedShapeObject.w, selectedShapeObject.h),
                              })
                            } else if (parsed !== null && selectedTextboxObject) {
                              updateSelectedTextboxData({
                                radius: radiusPercentToPx(parsed, selectedTextboxObject.w, selectedTextboxObject.h),
                              })
                            } else if (parsed !== null && selectedImageObject) {
                              updateSelectedImageData({
                                radius: radiusPercentToPx(parsed, selectedImageObject.w, selectedImageObject.h),
                              })
                            } else if (parsed !== null && selectedVideoObject) {
                              updateSelectedVideoData({
                                radius: radiusPercentToPx(parsed, selectedVideoObject.w, selectedVideoObject.h),
                              })
                            } else if (parsed !== null && selectedSoundObject) {
                              updateSelectedSoundData({
                                radius: radiusPercentToPx(parsed, selectedSoundObject.w, selectedSoundObject.h),
                              })
                            }
                          }}
                        />
                        <strong>
                          {`${Math.round(selectedObjectRadiusPercent)}%`}
                        </strong>
                      </div>
                    </label>
                  )}

                  {(selectedShapeObject ||
                    selectedTextboxObject ||
                    selectedImageObject ||
                    selectedVideoObject ||
                    selectedSoundObject) && (
                      <div className="object-param-row">
                        <span>Shadow</span>
                        <div className="object-param-shadow-controls">
                          <input
                            type="range"
                            min={-180}
                            max={180}
                            step={1}
                            value={selectedObjectShadowAngleDeg}
                            disabled={selectedObjectTransformLocked}
                            onWheel={handleRangeWheel}
                            onChange={(event) => {
                              const parsed = parseNumberInput(event.target.value)
                              if (parsed !== null) {
                                updateSelectedObjectShadow({ shadowAngleDeg: parsed })
                              }
                            }}
                            aria-label="Shadow angle"
                            title="Shadow angle"
                          />
                          <strong>{Math.round(selectedObjectShadowAngleDeg)}°</strong>
                          <input
                            type="range"
                            min={0}
                            max={MAX_SHADOW_BLUR_PX}
                            step={1}
                            value={selectedObjectShadowBlurPx}
                            disabled={selectedObjectTransformLocked}
                            onWheel={handleRangeWheel}
                            onChange={(event) => {
                              const parsed = parseNumberInput(event.target.value)
                              if (parsed !== null) {
                                updateSelectedObjectShadow({ shadowBlurPx: parsed })
                              }
                            }}
                            aria-label="Shadow blur"
                            title="Shadow blur"
                          />
                          <strong>{Math.round(selectedObjectShadowBlurPx)}px</strong>
                          <ColorPickerChip
                            value={selectedObjectShadowColor}
                            fallback="#000000"
                            disabled={selectedObjectTransformLocked}
                            onChange={(nextColor) => updateSelectedObjectShadow({ shadowColor: nextColor })}
                            ariaLabel="Shadow color"
                            title="Shadow color"
                          />
                        </div>
                      </div>
                    )}

                  {(selectedShapeObject || selectedTextboxObject) && (
                    <div className="object-param-row">
                      <span>Colour</span>
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

                  {(selectedVideoObject || selectedSoundObject) && (
                    <div className="object-param-row">
                      <span>Autoplay on slide</span>
                      <div className="object-param-inputs-single">
                        <select
                          value={
                            selectedVideoObject
                              ? (selectedVideoObject.videoData.autoplaySlideId ?? '')
                              : (selectedSoundObject?.soundData.autoplaySlideId ?? '')
                          }
                          disabled={selectedObjectTransformLocked}
                          onChange={(event) => {
                            const nextSlideId = normalizeOptionalId(event.target.value)
                            if (selectedVideoObject) {
                              updateSelectedVideoData({
                                autoplaySlideId: nextSlideId,
                                autoplay: nextSlideId !== null,
                              })
                            } else if (selectedSoundObject) {
                              updateSelectedSoundData({
                                autoplaySlideId: nextSlideId,
                              })
                            }
                          }}
                          aria-label="Autoplay on slide"
                          title="Choose which slide starts playback automatically"
                        >
                          <option value="">Off</option>
                          {mediaAutoplaySlideOptions.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {(selectedVideoObject || selectedSoundObject) && (
                    <div className="object-param-row">
                      <span>Loop</span>
                      <div className="slide-param-switch" role="group" aria-label="Loop playback">
                        <button
                          type="button"
                          className={
                            selectedVideoObject
                              ? (selectedVideoObject.videoData.loop ? 'active' : '')
                              : (selectedSoundObject?.soundData.loop ? 'active' : '')
                          }
                          disabled={selectedObjectTransformLocked}
                          onClick={() => {
                            if (selectedVideoObject) {
                              updateSelectedVideoData({ loop: true })
                            } else if (selectedSoundObject) {
                              updateSelectedSoundData({ loop: true })
                            }
                          }}
                        >
                          On
                        </button>
                        <button
                          type="button"
                          className={
                            selectedVideoObject
                              ? (!selectedVideoObject.videoData.loop ? 'active' : '')
                              : (!selectedSoundObject?.soundData.loop ? 'active' : '')
                          }
                          disabled={selectedObjectTransformLocked}
                          onClick={() => {
                            if (selectedVideoObject) {
                              updateSelectedVideoData({ loop: false })
                            } else if (selectedSoundObject) {
                              updateSelectedSoundData({ loop: false })
                            }
                          }}
                        >
                          Off
                        </button>
                      </div>
                    </div>
                  )}

                  {selectedSoundObject && (
                    <div className="object-param-row">
                      <span>Visible in presentation</span>
                      <div className="slide-param-switch" role="group" aria-label="Sound visibility in presentation">
                        <button
                          type="button"
                          className={!selectedSoundObject.soundData.hiddenInPresentation ? 'active' : ''}
                          disabled={selectedObjectTransformLocked}
                          onClick={() => updateSelectedSoundData({ hiddenInPresentation: false })}
                        >
                          On
                        </button>
                        <button
                          type="button"
                          className={selectedSoundObject.soundData.hiddenInPresentation ? 'active' : ''}
                          disabled={selectedObjectTransformLocked}
                          onClick={() => updateSelectedSoundData({ hiddenInPresentation: true })}
                        >
                          Off
                        </button>
                      </div>
                    </div>
                  )}

                  {(selectedShapeObject ||
                    selectedTextboxObject ||
                    selectedImageObject ||
                    selectedVideoObject ||
                    selectedSoundObject) && (
                      <div className="object-param-row">
                        <span>Border</span>
                        {selectedShapeObject ? (
                          <div
                            className={`object-param-border-controls ${selectedShapeObject.shapeData.borderWidth <= 0 ? 'border-none' : ''
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
                            className={`object-param-border-controls ${selectedTextboxObject.textboxData.borderWidth <= 0 ? 'border-none' : ''
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
                            className={`object-param-border-controls ${selectedImageObject.imageData.borderWidth <= 0 ? 'border-none' : ''
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
                        ) : selectedVideoObject ? (
                          <div
                            className={`object-param-border-controls ${selectedVideoObject.videoData.borderWidth <= 0 ? 'border-none' : ''
                              }`}
                          >
                            <BorderWidthDropdown
                              value={selectedVideoObject.videoData.borderWidth}
                              borderColor={selectedVideoObject.videoData.borderColor}
                              disabled={selectedObjectTransformLocked}
                              onChange={(nextValue) => {
                                updateSelectedVideoData({
                                  borderWidth: nextValue,
                                })
                              }}
                            />
                            {selectedVideoObject.videoData.borderWidth > 0 && (
                              <>
                                <BorderStyleDropdown
                                  value={selectedVideoObject.videoData.borderType}
                                  borderColor={selectedVideoObject.videoData.borderColor}
                                  borderWidth={selectedVideoObject.videoData.borderWidth}
                                  disabled={selectedObjectTransformLocked}
                                  onChange={(nextValue) => {
                                    updateSelectedVideoData({
                                      borderType: nextValue,
                                    })
                                  }}
                                />
                                <ColorPickerChip
                                  value={asHexColor(
                                    selectedVideoObject.videoData.borderColor,
                                    DEFAULT_TEXTBOX_BORDER_COLOR
                                  )}
                                  fallback={DEFAULT_TEXTBOX_BORDER_COLOR}
                                  disabled={selectedObjectTransformLocked}
                                  onChange={(nextColor) => {
                                    updateSelectedVideoData({ borderColor: nextColor })
                                  }}
                                  ariaLabel="Video border color"
                                  title="Video border color"
                                />
                              </>
                            )}
                          </div>
                        ) : selectedSoundObject ? (
                          <div
                            className={`object-param-border-controls ${selectedSoundObject.soundData.borderWidth <= 0 ? 'border-none' : ''
                              }`}
                          >
                            <BorderWidthDropdown
                              value={selectedSoundObject.soundData.borderWidth}
                              borderColor={selectedSoundObject.soundData.borderColor}
                              disabled={selectedObjectTransformLocked}
                              onChange={(nextValue) => {
                                updateSelectedSoundData({
                                  borderWidth: nextValue,
                                })
                              }}
                            />
                            {selectedSoundObject.soundData.borderWidth > 0 && (
                              <>
                                <BorderStyleDropdown
                                  value={selectedSoundObject.soundData.borderType}
                                  borderColor={selectedSoundObject.soundData.borderColor}
                                  borderWidth={selectedSoundObject.soundData.borderWidth}
                                  disabled={selectedObjectTransformLocked}
                                  onChange={(nextValue) => {
                                    updateSelectedSoundData({
                                      borderType: nextValue,
                                    })
                                  }}
                                />
                                <ColorPickerChip
                                  value={asHexColor(
                                    selectedSoundObject.soundData.borderColor,
                                    DEFAULT_TEXTBOX_BORDER_COLOR
                                  )}
                                  fallback={DEFAULT_TEXTBOX_BORDER_COLOR}
                                  disabled={selectedObjectTransformLocked}
                                  onChange={(nextColor) => {
                                    updateSelectedSoundData({ borderColor: nextColor })
                                  }}
                                  ariaLabel="Sound border color"
                                  title="Sound border color"
                                />
                              </>
                            )}
                          </div>
                        ) : null}
                      </div>
                    )}

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
                <div className="object-params-panel">
                  {canScaleMultiSelection && (
                    <label className="object-param-slider">
                      <span>Scale</span>
                      <div className="object-param-slider-control">
                        <input
                          type="range"
                          min={OBJECT_SCALE_MIN_PERCENT}
                          max={OBJECT_SCALE_MAX_PERCENT}
                          step={1}
                          value={multiSelectionScalePercent}
                          disabled={multiEditTransformLocked}
                          onWheel={handleRangeWheel}
                          onDoubleClick={() => {
                            updateMultiSelectedObjectScale(zoomCompensatedScalePercent)
                          }}
                          onChange={(event) => {
                            const parsed = parseNumberInput(event.target.value)
                            if (parsed !== null) {
                              updateMultiSelectedObjectScale(parsed)
                            }
                          }}
                        />
                        <strong>{multiSelectionScalePercent}%</strong>
                      </div>
                    </label>
                  )}

                  {multiEditReferenceObject && (
                    <label className="object-param-slider">
                      <span>Rotation</span>
                      <div className="object-param-slider-control">
                        <input
                          type="range"
                          min={-180}
                          max={180}
                          step={10}
                          value={multiEditRotationDeg}
                          disabled={multiEditTransformLocked}
                          onWheel={handleRangeWheel}
                          onDoubleClick={() => {
                            updateMultiSelectedRotation(0)
                          }}
                          onChange={(event) => {
                            const parsed = parseNumberInput(event.target.value)
                            if (parsed !== null) {
                              updateMultiSelectedRotation(parsed)
                            }
                          }}
                        />
                        <strong>{multiEditRotationDeg.toFixed(0)}°</strong>
                      </div>
                    </label>
                  )}

                  {(selectedShapeObjects.length > 0 ||
                    selectedTextboxObjects.length > 0 ||
                    selectedImageObjects.length > 0 ||
                    selectedVideoObjects.length > 0 ||
                    selectedSoundObjects.length > 0) && (
                      <label className="object-param-slider">
                        <span>Opacity</span>
                        <div className="object-param-slider-control">
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={multiEditOpacityPercent}
                            disabled={multiEditTransformLocked}
                            onWheel={handleRangeWheel}
                            onChange={(event) => {
                              const parsed = parseNumberInput(event.target.value)
                              if (parsed !== null) {
                                updateMultiSelectedOpacity(parsed)
                              }
                            }}
                          />
                          <strong>{Math.round(multiEditOpacityPercent)}%</strong>
                        </div>
                      </label>
                    )}

                  {multiEditRadiusReference && (
                    <label className="object-param-slider">
                      <span>Radius</span>
                      <div className="object-param-slider-control">
                        <input
                          type="range"
                          min={0}
                          max={MAX_RADIUS_PERCENT}
                          step={1}
                          value={multiEditRadiusPercent}
                          disabled={multiEditTransformLocked}
                          onWheel={handleRangeWheel}
                          onChange={(event) => {
                            const parsed = parseNumberInput(event.target.value)
                            if (parsed !== null) {
                              updateMultiSelectedRadius(parsed)
                            }
                          }}
                        />
                        <strong>{Math.round(multiEditRadiusPercent)}%</strong>
                      </div>
                    </label>
                  )}

                  {(selectedShapeObjects.length > 0 ||
                    selectedTextboxObjects.length > 0 ||
                    selectedImageObjects.length > 0 ||
                    selectedVideoObjects.length > 0 ||
                    selectedSoundObjects.length > 0) && (
                      <div className="object-param-row">
                        <span>Shadow</span>
                        <div className="object-param-shadow-controls">
                          <input
                            type="range"
                            min={-180}
                            max={180}
                            step={1}
                            value={multiEditShadowAngleDeg}
                            disabled={multiEditTransformLocked}
                            onWheel={handleRangeWheel}
                            onChange={(event) => {
                              const parsed = parseNumberInput(event.target.value)
                              if (parsed !== null) {
                                updateMultiSelectedShadow({ shadowAngleDeg: parsed })
                              }
                            }}
                            aria-label="Shadow angle"
                            title="Shadow angle"
                          />
                          <strong>{Math.round(multiEditShadowAngleDeg)}°</strong>
                          <input
                            type="range"
                            min={0}
                            max={MAX_SHADOW_BLUR_PX}
                            step={1}
                            value={multiEditShadowBlurPx}
                            disabled={multiEditTransformLocked}
                            onWheel={handleRangeWheel}
                            onChange={(event) => {
                              const parsed = parseNumberInput(event.target.value)
                              if (parsed !== null) {
                                updateMultiSelectedShadow({ shadowBlurPx: parsed })
                              }
                            }}
                            aria-label="Shadow blur"
                            title="Shadow blur"
                          />
                          <strong>{Math.round(multiEditShadowBlurPx)}px</strong>
                          <ColorPickerChip
                            value={multiEditShadowColor}
                            fallback="#000000"
                            disabled={multiEditTransformLocked}
                            onChange={(nextColor) => updateMultiSelectedShadow({ shadowColor: nextColor })}
                            ariaLabel="Shadow color"
                            title="Shadow color"
                          />
                        </div>
                      </div>
                    )}

                  {(selectedShapeObjects.length > 0 || selectedTextboxObjects.length > 0) && (
                    <div className="object-param-row">
                      <span>Colour</span>
                      <div className="object-param-fill-controls">
                        <div className="slide-param-switch switch-3" role="group" aria-label="Multi-selection fill mode">
                          <button
                            type="button"
                            className={
                              multiSelectedFillMode === 'solid' && !multiSelectedFillIsTransparent
                                ? 'active'
                                : ''
                            }
                            disabled={multiEditTransformLocked}
                            onClick={() => {
                              updateMultiSelectedBackground({
                                fillMode: 'solid',
                                color: multiEditFillColor,
                              })
                            }}
                          >
                            Solid
                          </button>
                          <button
                            type="button"
                            className={multiSelectedFillMode === 'linearGradient' ? 'active' : ''}
                            disabled={multiEditTransformLocked}
                            onClick={() => {
                              updateMultiSelectedBackground({
                                fillMode: 'linearGradient',
                                gradient: selectedGradient,
                              })
                            }}
                          >
                            Gradient
                          </button>
                          <button
                            type="button"
                            className={
                              multiSelectedFillMode === 'solid' && multiSelectedFillIsTransparent
                                ? 'active'
                                : ''
                            }
                            disabled={multiEditTransformLocked}
                            onClick={() => {
                              updateMultiSelectedBackground({
                                fillMode: 'solid',
                                color: 'transparent',
                              })
                            }}
                          >
                            None
                          </button>
                        </div>
                        {multiSelectedFillMode === 'linearGradient' ? (
                          <button
                            type="button"
                            className="object-param-color-chip object-param-gradient-chip"
                            style={{ background: multiEditFillGradientCss }}
                            disabled={multiEditTransformLocked}
                            onClick={openObjectFillEditor}
                            aria-label="Edit background gradient"
                            title="Edit background gradient"
                          />
                        ) : !multiSelectedFillIsTransparent ? (
                          <ColorPickerChip
                            className="object-param-color-chip"
                            value={multiEditFillColor}
                            fallback="#244a80"
                            disabled={multiEditTransformLocked}
                            onChange={(nextColor) => {
                              updateMultiSelectedBackground({
                                fillMode: 'solid',
                                color: nextColor,
                              })
                            }}
                            ariaLabel="Background color"
                            title="Background color"
                          />
                        ) : null}
                      </div>
                    </div>
                  )}

                  {(selectedShapeObjects.length > 0 ||
                    selectedTextboxObjects.length > 0 ||
                    selectedImageObjects.length > 0 ||
                    selectedVideoObjects.length > 0 ||
                    selectedSoundObjects.length > 0) && (
                      <div className="object-param-row">
                        <span>Border</span>
                        <div className={`object-param-border-controls ${multiEditBorderWidth <= 0 ? 'border-none' : ''}`}>
                          <BorderWidthDropdown
                            value={multiEditBorderWidth}
                            borderColor={multiEditBorderColor}
                            disabled={multiEditTransformLocked}
                            onChange={(nextValue) => {
                              updateMultiSelectedBorder({ borderWidth: nextValue })
                            }}
                          />
                          {multiEditBorderWidth > 0 && (
                            <>
                              <BorderStyleDropdown
                                value={multiEditBorderType}
                                borderColor={multiEditBorderColor}
                                borderWidth={multiEditBorderWidth}
                                disabled={multiEditTransformLocked}
                                onChange={(nextValue) => {
                                  updateMultiSelectedBorder({ borderType: nextValue })
                                }}
                              />
                              <ColorPickerChip
                                value={multiEditBorderColor}
                                fallback={DEFAULT_TEXTBOX_BORDER_COLOR}
                                disabled={multiEditTransformLocked}
                                onChange={(nextColor) => {
                                  updateMultiSelectedBorder({ borderColor: nextColor })
                                }}
                                ariaLabel="Border color"
                                title="Border color"
                              />
                            </>
                          )}
                        </div>
                      </div>
                    )}

                  <div className="object-param-row">
                    <span>Protected</span>
                    <div className="slide-param-switch" role="group" aria-label="Multi-selection object protection">
                      <button
                        type="button"
                        disabled={selectedObjects.every((object) => hasLockedAncestor(object, objectById))}
                        onClick={() => setMultiSelectedProtected(true)}
                      >
                        <FontAwesomeIcon icon={faLock} /> On
                      </button>
                      <button
                        type="button"
                        disabled={selectedObjects.every((object) => hasLockedAncestor(object, objectById))}
                        onClick={() => setMultiSelectedProtected(false)}
                      >
                        <FontAwesomeIcon icon={faLockOpen} /> Off
                      </button>
                    </div>
                  </div>
                </div>
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

                  <div className="object-param-row">
                    <span>Show Grid</span>
                    <div className="slide-param-switch switch-2" role="group" aria-label="Show grid">
                      <button
                        type="button"
                        className={document.canvas.gridVisible ? 'active' : ''}
                        onClick={() => {
                          setCanvasSettings({ gridVisible: true })
                        }}
                      >
                        On
                      </button>
                      <button
                        type="button"
                        className={!document.canvas.gridVisible ? 'active' : ''}
                        onClick={() => {
                          setCanvasSettings({ gridVisible: false })
                        }}
                      >
                        Off
                      </button>
                    </div>
                  </div>

                  <div className="object-param-row">
                    <span>Snap Grid</span>
                    <div className="slide-param-switch switch-2" role="group" aria-label="Snap to grid">
                      <button
                        type="button"
                        className={document.canvas.snapToGrid ? 'active' : ''}
                        onClick={() => {
                          setCanvasSettings({ snapToGrid: true })
                        }}
                      >
                        On
                      </button>
                      <button
                        type="button"
                        className={!document.canvas.snapToGrid ? 'active' : ''}
                        onClick={() => {
                          setCanvasSettings({ snapToGrid: false })
                        }}
                      >
                        Off
                      </button>
                    </div>
                  </div>


                  <label className="object-param-slider">
                    <span>Grid Size</span>
                    <div className="object-param-slider-control">
                      <input
                        type="range"
                        min={10}
                        max={400}
                        step={5}
                        value={document.canvas.baseGridSize}
                        onWheel={handleRangeWheel}
                        onDoubleClick={() => {
                          setCanvasSettings({ baseGridSize: 100 })
                        }}
                        onChange={(event) => {
                          const parsed = parseNumberInput(event.target.value)
                          if (parsed !== null) {
                            setCanvasSettings({ baseGridSize: parsed })
                          }
                        }}
                      />
                      <strong>{Math.round(document.canvas.baseGridSize)}px</strong>
                    </div>
                  </label>

                  <div className="object-param-row">
                    <span>Snap Object</span>
                    <div className="slide-param-switch switch-2" role="group" aria-label="Snap to object edges">
                      <button
                        type="button"
                        className={document.canvas.snapToObjectEdges ? 'active' : ''}
                        onClick={() => {
                          setCanvasSettings({ snapToObjectEdges: true })
                        }}
                      >
                        On
                      </button>
                      <button
                        type="button"
                        className={!document.canvas.snapToObjectEdges ? 'active' : ''}
                        onClick={() => {
                          setCanvasSettings({ snapToObjectEdges: false })
                        }}
                      >
                        Off
                      </button>
                    </div>
                  </div>


                  <label className="object-param-slider">
                    <span>Snap Size</span>
                    <div className="object-param-slider-control">
                      <input
                        type="range"
                        min={1}
                        max={32}
                        step={1}
                        value={document.canvas.snapTolerancePx}
                        onWheel={handleRangeWheel}
                        onDoubleClick={() => {
                          setCanvasSettings({ snapTolerancePx: 8 })
                        }}
                        onChange={(event) => {
                          const parsed = parseNumberInput(event.target.value)
                          if (parsed !== null) {
                            setCanvasSettings({ snapTolerancePx: parsed })
                          }
                        }}
                      />
                      <strong>{Math.round(document.canvas.snapTolerancePx)}px</strong>
                    </div>
                  </label>

                </div>
              )}
            </section>
          )

          if (leftObjectParamsPortalNode) {
            return createPortal(objectParametersSection, leftObjectParamsPortalNode)
          }

          return objectParametersSection
        })()}
      </aside>

      {mode !== 'present' && !isLeftSidebarHidden ? (
        <button
          type="button"
          className="sidebar-hide-btn left"
          onClick={() => setIsLeftSidebarHidden(true)}
          aria-label="Hide left sidebar"
          title="Hide left sidebar"
        >
          <FontAwesomeIcon icon={faChevronLeft} />
        </button>
      ) : null}

      {mode !== 'present' && !isRightSidebarHidden ? (
        <button
          type="button"
          className="sidebar-hide-btn right"
          onClick={() => setIsRightSidebarHidden(true)}
          aria-label="Hide right sidebar"
          title="Hide right sidebar"
        >
          <FontAwesomeIcon icon={faChevronRight} />
        </button>
      ) : null}

      {mode !== 'present' && isLeftSidebarHidden ? (
        <button
          type="button"
          className="sidebar-reopen-btn left"
          onClick={() => setIsLeftSidebarHidden(false)}
          aria-label="Show left sidebar"
          title="Show left sidebar"
        >
          <FontAwesomeIcon icon={faChevronRight} />
        </button>
      ) : null}

      {mode !== 'present' && isRightSidebarHidden ? (
        <button
          type="button"
          className="sidebar-reopen-btn right"
          onClick={() => setIsRightSidebarHidden(false)}
          aria-label="Show right sidebar"
          title="Show right sidebar"
        >
          <FontAwesomeIcon icon={faChevronLeft} />
        </button>
      ) : null}

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
              disabled={presentFreeMoveEnabled || !activeSlide || activeSlideIndex <= 0}
            >
              <FontAwesomeIcon icon={faBackwardStep} />
            </button>
            <button
              type="button"
              className="present-hud-btn"
              onClick={goToNextSlide}
              title="Next slide"
              disabled={presentFreeMoveEnabled || !activeSlide || activeSlideIndex >= orderedSlides.length - 1}
            >
              <FontAwesomeIcon icon={faForwardStep} />
            </button>
            <button
              type="button"
              className="present-hud-btn"
              onClick={exitPresentMode}
              title="Exit present mode"
            >
              <FontAwesomeIcon icon={faXmark} />
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
          ref={assetLibraryInputRef}
          type="file"
          accept={SUPPORTED_LIBRARY_ASSET_ACCEPT}
          multiple
          onChange={handleAssetLibraryFileInput}
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
        <input
          ref={videoInputRef}
          type="file"
          accept={SUPPORTED_VIDEO_ACCEPT}
          multiple
          onChange={handleVideoFile}
          style={{ display: 'none' }}
        />
        <input
          ref={soundInputRef}
          type="file"
          accept={SUPPORTED_AUDIO_ACCEPT}
          multiple
          onChange={handleSoundFile}
          style={{ display: 'none' }}
        />

        {mode === 'present' ? (
          <PresentStage
            model={document}
            slide={activeSlide}
            freeMoveEnabled={presentFreeMoveEnabled}
            onNavigateNext={goToNextSlide}
            onNavigatePrevious={goToPreviousSlide}
          />
        ) : (
          <CanvasViewport
            hoveredSlideId={hoveredSlideId}
            hoveredAssetId={hoveredAssetId}
            stylePreset={effectiveStylePreset}
            creationTool={currentCreationTool}
            onCreateObjectFromTool={handleCreateObjectFromTool}
            targetDisplayPortalNode={slidesTargetDisplayPortalNode}
            onTargetDisplayFrameChange={handleTargetDisplayFrameChange}
          />
        )}
      </main>
      {designAssetContextMenu ? (
        <div
          className="design-asset-context-menu"
          role="menu"
          style={designAssetContextMenuStyle}
        >
          <button type="button" onClick={handleDownloadDesignAssetFromContextMenu} role="menuitem">
            Download JSON
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default App
