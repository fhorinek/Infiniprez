export const CURRENT_SCHEMA_VERSION = '1.0' as const

export type SchemaVersion = typeof CURRENT_SCHEMA_VERSION

export type TriggerMode = 'manual' | 'timed'
export type TransitionType = 'ease' | 'linear' | 'instant'
export type BorderType = 'solid' | 'dashed' | 'dotted'
export type FillMode = 'solid' | 'linearGradient'
export type TextAlignment = 'left' | 'center' | 'right'
export type TextListType = 'none' | 'bullet' | 'numbered'

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
  fontFamily: string
  alignment: TextAlignment
  listType: TextListType
  autoHeight: boolean
}

export interface ImageData {
  assetId: string
  intrinsicWidth: number
  intrinsicHeight: number
  keepAspectRatio: boolean
}

export interface FillGradient {
  colorA: string
  colorB: string
  angleDeg: number
}

export interface ShapeData {
  borderColor: string
  borderType: BorderType
  borderWidth: number
  fillMode: FillMode
  fillColor: string
  fillGradient: FillGradient | null
  opacityPercent: number
}

export interface GroupData {
  childIds: string[]
}

export interface BaseObject {
  id: string
  x: number
  y: number
  w: number
  h: number
  rotation: number
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

export interface ShapeRectObject extends BaseObject {
  type: 'shape_rect'
  shapeData: ShapeData
}

export interface ShapeCircleObject extends BaseObject {
  type: 'shape_circle'
  shapeData: ShapeData
}

export interface ShapeArrowObject extends BaseObject {
  type: 'shape_arrow'
  shapeData: ShapeData
}

export interface GroupObject extends BaseObject {
  type: 'group'
  groupData: GroupData
}

export type CanvasObject =
  | TextboxObject
  | ImageObject
  | ShapeRectObject
  | ShapeCircleObject
  | ShapeArrowObject
  | GroupObject

export interface Asset {
  id: string
  name: string
  mimeType: string
  dataBase64: string
}

export interface DocumentModel {
  meta: DocumentMeta
  canvas: CanvasSettings
  slides: Slide[]
  objects: CanvasObject[]
  assets: Asset[]
}
