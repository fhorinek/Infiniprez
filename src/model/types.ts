export const CURRENT_SCHEMA_VERSION = '1.0' as const
export const DEFAULT_CANVAS_BACKGROUND =
  'radial-gradient(circle at 20% 20%, #1f365a 0%, #0f1523 55%)'

export type SchemaVersion = typeof CURRENT_SCHEMA_VERSION

export type TriggerMode = 'manual' | 'timed'
export type TransitionType = 'ease' | 'linear' | 'instant'
export type BorderType = 'solid' | 'dashed' | 'dotted'
export type FillMode = 'solid' | 'linearGradient'
export type GradientType = 'linear' | 'radial' | 'circles'
export type ShapeKind =
  | 'rect'
  | 'roundedRect'
  | 'diamond'
  | 'triangle'
  | 'trapezoid'
  | 'parallelogram'
  | 'hexagon'
  | 'pentagon'
  | 'octagon'
  | 'star'
  | 'cloud'
export type TextAlignment = 'left' | 'center' | 'right'
export type TextVerticalAlignment = 'top' | 'middle' | 'bottom'
export type TextListType = 'none' | 'bullet' | 'numbered'
export type ImageFilterPreset = 'none' | 'bw' | 'sepia' | 'vibrant' | 'warm' | 'cool' | 'dramatic'
export type TemplatePlaceholderKind = 'universal' | 'text' | 'list' | 'image'

export interface DocumentMeta {
  version: SchemaVersion
  title: string
  createdAt: string
  updatedAt: string
}

export interface CanvasSettings {
  gridVisible: boolean
  baseGridSize: number
  snapToGrid: boolean
  snapToObjectEdges: boolean
  snapTolerancePx: number
  background: string
}

export interface Slide {
  id: string
  name: string
  x: number
  y: number
  zoom: number
  rotation: number
  triggerMode: TriggerMode
  triggerDelayMs: number
  transitionType: TransitionType
  transitionDurationMs: number
  orderIndex: number
}

export interface TextRun {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  color: string
  fontSize: number
}

export interface TextboxData {
  runs: TextRun[]
  richTextHtml: string
  fontFamily: string
  alignment: TextAlignment
  verticalAlignment?: TextVerticalAlignment
  listType: TextListType
  autoHeight: boolean
  fillMode: FillMode
  backgroundColor: string
  fillGradient: FillGradient | null
  borderColor: string
  borderType: BorderType
  borderWidth: number
  radius: number
  opacityPercent: number
  shadowColor: string
  shadowBlurPx: number
  shadowAngleDeg: number
}

export interface ImageData {
  assetId: string
  intrinsicWidth: number
  intrinsicHeight: number
  borderColor: string
  borderType: BorderType
  borderWidth: number
  radius: number
  opacityPercent: number
  cropEnabled: boolean
  cropLeftPercent: number
  cropTopPercent: number
  cropRightPercent: number
  cropBottomPercent: number
  effectsEnabled: boolean
  filterPreset: ImageFilterPreset
  shadowColor: string
  shadowBlurPx: number
  shadowAngleDeg: number
}

export interface VideoData {
  assetId: string
  intrinsicWidth: number
  intrinsicHeight: number
  borderColor: string
  borderType: BorderType
  borderWidth: number
  radius: number
  opacityPercent: number
  autoplay: boolean
  loop: boolean
  muted: boolean
  shadowColor: string
  shadowBlurPx: number
  shadowAngleDeg: number
}

export interface SoundData {
  assetId: string
  borderColor: string
  borderType: BorderType
  borderWidth: number
  radius: number
  opacityPercent: number
  loop: boolean
  shadowColor: string
  shadowBlurPx: number
  shadowAngleDeg: number
}

export interface FillGradientStop {
  color: string
  positionPercent: number
  xPercent?: number
  yPercent?: number
}

export interface FillGradient {
  colorA: string
  colorB: string
  angleDeg: number
  gradientType: GradientType
  stops: FillGradientStop[]
}

export interface ShapeData {
  kind: ShapeKind
  adjustmentPercent: number
  borderColor: string
  borderType: BorderType
  borderWidth: number
  fillMode: FillMode
  fillColor: string
  fillGradient: FillGradient | null
  radius: number
  opacityPercent: number
  shadowColor: string
  shadowBlurPx: number
  shadowAngleDeg: number
}

export interface GroupData {
  childIds: string[]
}

export interface TemplatePlaceholderData {
  kind: TemplatePlaceholderKind
  prompt: string
}

export interface BaseObject {
  id: string
  x: number
  y: number
  w: number
  h: number
  rotation: number
  scalePercent: number
  keepAspectRatio: boolean
  locked: boolean
  zIndex: number
  parentGroupId: string | null
}

export interface TextboxObject extends BaseObject {
  type: 'textbox'
  textboxData: TextboxData
}

export interface ImageObject extends BaseObject {
  type: 'image'
  imageData: ImageData
}

export interface VideoObject extends BaseObject {
  type: 'video'
  videoData: VideoData
}

export interface SoundObject extends BaseObject {
  type: 'sound'
  soundData: SoundData
}

export interface ShapeRectObject extends BaseObject {
  type: 'shape_rect'
  shapeData: ShapeData
}

export interface ShapeCircleObject extends BaseObject {
  type: 'shape_circle'
  shapeData: ShapeData
}

export interface GroupObject extends BaseObject {
  type: 'group'
  groupData: GroupData
}

export interface TemplatePlaceholderObject extends BaseObject {
  type: 'template_placeholder'
  templatePlaceholderData: TemplatePlaceholderData
}

export type CanvasObject =
  | TextboxObject
  | ImageObject
  | VideoObject
  | SoundObject
  | ShapeRectObject
  | ShapeCircleObject
  | TemplatePlaceholderObject
  | GroupObject

export interface Asset {
  id: string
  name: string
  mimeType: string
  dataBase64: string
  intrinsicWidth?: number | null
  intrinsicHeight?: number | null
  durationSec?: number | null
}

export interface DocumentModel {
  meta: DocumentMeta
  canvas: CanvasSettings
  slides: Slide[]
  objects: CanvasObject[]
  assets: Asset[]
}
