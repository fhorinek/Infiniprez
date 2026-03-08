import type {
  CanvasObject,
  FillGradient,
  ShapeData,
  TemplatePlaceholderData,
  TextboxData,
} from './model'
import { getDefaultShapeAdjustment } from './shapeStyle'
import type { TextStyleRoleId } from './stylePresets'

const TEMPLATE_FONT_SCALE = 0.82

export interface TemplateLayoutTheme {
  fontFamily: string
  surface: string
  surfaceAlt: string
  accent: string
  accentSoft: string
  border: string
  borderSoft: string
  text: string
  mutedText: string
  inverseText: string
  highlight: string
}

export interface LayoutFrame {
  x: number
  y: number
  w: number
  h: number
}

export interface TemplateObjectFactory {
  shape(type: 'shape_rect' | 'shape_circle', frame: LayoutFrame, shapeData: ShapeData): CanvasObject
  textbox(frame: LayoutFrame, textboxData: TextboxData): CanvasObject
  placeholder(frame: LayoutFrame, templatePlaceholderData: TemplatePlaceholderData): CanvasObject
}

type ColorSpec = string | { blend: { a: ColorSpec; b: ColorSpec; mix: number } }

type ShapeGradientSpec = {
  colorA: ColorSpec
  colorB: ColorSpec
  angleDeg: number
}

type ShapeNode = {
  kind: 'shape'
  shapeType: 'shape_rect' | 'shape_circle'
  frame: LayoutFrame
  shapeData?: {
    kind?: ShapeData['kind']
    fillColor?: ColorSpec
    fillGradient?: ShapeGradientSpec | null
    borderColor?: ColorSpec
    borderWidth?: number
    radius?: number
  }
}

type PanelNode = {
  kind: 'panel'
  frame: LayoutFrame
  variant?: 'surface' | 'accent' | 'muted'
}

type PlaceholderNode = {
  kind: 'placeholder'
  frame: LayoutFrame
  prompt: string
  placeholderKind?: TemplatePlaceholderData['kind']
}

type TextboxNode = {
  kind: 'textbox'
  frame: LayoutFrame
  text: string
  format?: 'paragraph' | 'bulletList'
  items?: string[]
  style?: {
    role?: TextStyleRoleId
    color?: ColorSpec
    fontFamily?: string
    fontSize?: number
    fontWeight?: number
    textAlign?: TextboxData['alignment']
    lineHeight?: number
    italic?: boolean
    letterSpacingEm?: number
  }
  box?: {
    backgroundColor?: ColorSpec
    borderColor?: ColorSpec
    borderWidth?: number
    alignment?: TextboxData['alignment']
    listType?: TextboxData['listType']
  }
}

type BaseFrameNode = {
  kind: 'baseFrame'
}

type RepeatNode = {
  kind: 'repeat'
  count: number
  startIndex?: number
  step?: Partial<LayoutFrame>
  node: TemplateLayoutNode
}

export type TemplateLayoutNode = BaseFrameNode | PanelNode | PlaceholderNode | TextboxNode | ShapeNode | RepeatNode

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseFrame(value: unknown): LayoutFrame | null {
  if (!isRecord(value)) {
    return null
  }
  if (
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.w) ||
    !isFiniteNumber(value.h)
  ) {
    return null
  }
  return {
    x: value.x,
    y: value.y,
    w: value.w,
    h: value.h,
  }
}

function parseColorSpec(value: unknown): ColorSpec | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }
  if (!isRecord(value) || !isRecord(value.blend)) {
    return null
  }
  const a = parseColorSpec(value.blend.a)
  const b = parseColorSpec(value.blend.b)
  const mix = value.blend.mix
  if (!a || !b || !isFiniteNumber(mix)) {
    return null
  }
  return {
    blend: {
      a,
      b,
      mix,
    },
  }
}

function parseShapeGradientSpec(value: unknown): ShapeGradientSpec | null {
  if (!isRecord(value)) {
    return null
  }
  const colorA = parseColorSpec(value.colorA)
  const colorB = parseColorSpec(value.colorB)
  if (!colorA || !colorB || !isFiniteNumber(value.angleDeg)) {
    return null
  }
  return {
    colorA,
    colorB,
    angleDeg: value.angleDeg,
  }
}

function parseShapeNode(value: Record<string, unknown>): ShapeNode | null {
  if (value.shapeType !== 'shape_rect' && value.shapeType !== 'shape_circle') {
    return null
  }
  const frame = parseFrame(value.frame)
  if (!frame) {
    return null
  }
  if (value.shapeData === undefined) {
    return {
      kind: 'shape',
      shapeType: value.shapeType,
      frame,
    }
  }
  if (!isRecord(value.shapeData)) {
    return null
  }

  const color = parseColorSpec(value.shapeData.fillColor)
  const border = parseColorSpec(value.shapeData.borderColor)
  const gradient =
    value.shapeData.fillGradient === null
      ? null
      : parseShapeGradientSpec(value.shapeData.fillGradient)
  if (value.shapeData.fillColor !== undefined && !color) {
    return null
  }
  if (value.shapeData.borderColor !== undefined && !border) {
    return null
  }
  if (value.shapeData.fillGradient !== undefined && value.shapeData.fillGradient !== null && !gradient) {
    return null
  }
  if (
    (value.shapeData.borderWidth !== undefined && !isFiniteNumber(value.shapeData.borderWidth)) ||
    (value.shapeData.radius !== undefined && !isFiniteNumber(value.shapeData.radius))
  ) {
    return null
  }

  const shapeKind = value.shapeData.kind
  const isValidShapeKind =
    shapeKind === undefined ||
    shapeKind === 'rect' ||
    shapeKind === 'roundedRect' ||
    shapeKind === 'diamond' ||
    shapeKind === 'triangle' ||
    shapeKind === 'trapezoid' ||
    shapeKind === 'parallelogram' ||
    shapeKind === 'hexagon' ||
    shapeKind === 'pentagon' ||
    shapeKind === 'octagon' ||
    shapeKind === 'star' ||
    shapeKind === 'cloud'
  if (!isValidShapeKind) {
    return null
  }

  return {
    kind: 'shape',
    shapeType: value.shapeType,
    frame,
    shapeData: {
      ...(shapeKind ? { kind: shapeKind } : {}),
      ...(color ? { fillColor: color } : {}),
      ...(border ? { borderColor: border } : {}),
      ...(gradient !== undefined ? { fillGradient: gradient } : {}),
      ...(isFiniteNumber(value.shapeData.borderWidth) ? { borderWidth: value.shapeData.borderWidth } : {}),
      ...(isFiniteNumber(value.shapeData.radius) ? { radius: value.shapeData.radius } : {}),
    },
  }
}

function parsePanelNode(value: Record<string, unknown>): PanelNode | null {
  const frame = parseFrame(value.frame)
  if (!frame) {
    return null
  }
  const variant = value.variant
  if (variant !== undefined && variant !== 'surface' && variant !== 'accent' && variant !== 'muted') {
    return null
  }
  return {
    kind: 'panel',
    frame,
    ...(variant ? { variant } : {}),
  }
}

function parsePlaceholderNode(value: Record<string, unknown>): PlaceholderNode | null {
  const frame = parseFrame(value.frame)
  if (!frame || typeof value.prompt !== 'string' || value.prompt.trim().length === 0) {
    return null
  }
  const placeholderKind = value.placeholderKind
  if (
    placeholderKind !== undefined &&
    placeholderKind !== 'universal' &&
    placeholderKind !== 'text' &&
    placeholderKind !== 'list' &&
    placeholderKind !== 'image'
  ) {
    return null
  }
  return {
    kind: 'placeholder',
    frame,
    prompt: value.prompt,
    ...(placeholderKind ? { placeholderKind } : {}),
  }
}

function parseTextboxNode(value: Record<string, unknown>): TextboxNode | null {
  const frame = parseFrame(value.frame)
  if (!frame || typeof value.text !== 'string') {
    return null
  }

  const format = value.format
  if (format !== undefined && format !== 'paragraph' && format !== 'bulletList') {
    return null
  }

  const items = Array.isArray(value.items) ? value.items.filter((entry): entry is string => typeof entry === 'string') : undefined

  let style: TextboxNode['style']
  if (value.style !== undefined) {
    if (!isRecord(value.style)) {
      return null
    }
    const role = value.style.role
    if (
      role !== undefined &&
      role !== 'title' &&
      role !== 'heading' &&
      role !== 'description' &&
      role !== 'label' &&
      role !== 'text' &&
      role !== 'caption'
    ) {
      return null
    }
    const color = value.style.color === undefined ? null : parseColorSpec(value.style.color)
    if (value.style.color !== undefined && !color) {
      return null
    }
    if (
      (value.style.fontSize !== undefined && !isFiniteNumber(value.style.fontSize)) ||
      (value.style.fontWeight !== undefined && !isFiniteNumber(value.style.fontWeight)) ||
      (value.style.lineHeight !== undefined && !isFiniteNumber(value.style.lineHeight)) ||
      (value.style.letterSpacingEm !== undefined && !isFiniteNumber(value.style.letterSpacingEm))
    ) {
      return null
    }

    if (
      value.style.textAlign !== undefined &&
      value.style.textAlign !== 'left' &&
      value.style.textAlign !== 'center' &&
      value.style.textAlign !== 'right'
    ) {
      return null
    }

    style = {
      ...(role ? { role } : {}),
      ...(color ? { color } : {}),
      ...(typeof value.style.fontFamily === 'string' ? { fontFamily: value.style.fontFamily } : {}),
      ...(isFiniteNumber(value.style.fontSize) ? { fontSize: value.style.fontSize } : {}),
      ...(isFiniteNumber(value.style.fontWeight) ? { fontWeight: value.style.fontWeight } : {}),
      ...(typeof value.style.italic === 'boolean' ? { italic: value.style.italic } : {}),
      ...(value.style.textAlign ? { textAlign: value.style.textAlign } : {}),
      ...(isFiniteNumber(value.style.lineHeight) ? { lineHeight: value.style.lineHeight } : {}),
      ...(isFiniteNumber(value.style.letterSpacingEm) ? { letterSpacingEm: value.style.letterSpacingEm } : {}),
    }
  }

  let box: TextboxNode['box']
  if (value.box !== undefined) {
    if (!isRecord(value.box)) {
      return null
    }

    const backgroundColor = value.box.backgroundColor === undefined ? null : parseColorSpec(value.box.backgroundColor)
    const borderColor = value.box.borderColor === undefined ? null : parseColorSpec(value.box.borderColor)
    if ((value.box.backgroundColor !== undefined && !backgroundColor) || (value.box.borderColor !== undefined && !borderColor)) {
      return null
    }

    if (value.box.borderWidth !== undefined && !isFiniteNumber(value.box.borderWidth)) {
      return null
    }

    if (
      value.box.alignment !== undefined &&
      value.box.alignment !== 'left' &&
      value.box.alignment !== 'center' &&
      value.box.alignment !== 'right'
    ) {
      return null
    }

    if (
      value.box.listType !== undefined &&
      value.box.listType !== 'none' &&
      value.box.listType !== 'bullet' &&
      value.box.listType !== 'numbered'
    ) {
      return null
    }

    box = {
      ...(backgroundColor ? { backgroundColor } : {}),
      ...(borderColor ? { borderColor } : {}),
      ...(isFiniteNumber(value.box.borderWidth) ? { borderWidth: value.box.borderWidth } : {}),
      ...(value.box.alignment ? { alignment: value.box.alignment } : {}),
      ...(value.box.listType ? { listType: value.box.listType } : {}),
    }
  }

  return {
    kind: 'textbox',
    frame,
    text: value.text,
    ...(format ? { format } : {}),
    ...(items && items.length > 0 ? { items } : {}),
    ...(style && Object.keys(style).length > 0 ? { style } : {}),
    ...(box && Object.keys(box).length > 0 ? { box } : {}),
  }
}

function parseRepeatNode(value: Record<string, unknown>): RepeatNode | null {
  if (!isFiniteNumber(value.count) || value.count <= 0 || value.count > 100) {
    return null
  }
  const startIndex = value.startIndex
  if (startIndex !== undefined && !isFiniteNumber(startIndex)) {
    return null
  }
  let step: Partial<LayoutFrame> | undefined
  if (value.step !== undefined) {
    if (!isRecord(value.step)) {
      return null
    }
    step = {}
    if (value.step.x !== undefined) {
      if (!isFiniteNumber(value.step.x)) {
        return null
      }
      step.x = value.step.x
    }
    if (value.step.y !== undefined) {
      if (!isFiniteNumber(value.step.y)) {
        return null
      }
      step.y = value.step.y
    }
    if (value.step.w !== undefined) {
      if (!isFiniteNumber(value.step.w)) {
        return null
      }
      step.w = value.step.w
    }
    if (value.step.h !== undefined) {
      if (!isFiniteNumber(value.step.h)) {
        return null
      }
      step.h = value.step.h
    }
  }

  const node = parseTemplateLayoutNode(value.node)
  if (!node) {
    return null
  }

  return {
    kind: 'repeat',
    count: Math.floor(value.count),
    ...(isFiniteNumber(startIndex) ? { startIndex: Math.floor(startIndex) } : {}),
    ...(step ? { step } : {}),
    node,
  }
}

function parseTemplateLayoutNode(value: unknown): TemplateLayoutNode | null {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return null
  }
  switch (value.kind) {
    case 'baseFrame':
      return { kind: 'baseFrame' }
    case 'panel':
      return parsePanelNode(value)
    case 'placeholder':
      return parsePlaceholderNode(value)
    case 'textbox':
      return parseTextboxNode(value)
    case 'shape':
      return parseShapeNode(value)
    case 'repeat':
      return parseRepeatNode(value)
    default:
      return null
  }
}

export function parseTemplateLayout(value: unknown): TemplateLayoutNode[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const nodes: TemplateLayoutNode[] = []
  for (const entry of value) {
    const node = parseTemplateLayoutNode(entry)
    if (!node) {
      return null
    }
    nodes.push(node)
  }
  return nodes
}

function parseHex(hex: string) {
  const normalized = hex.trim().replace('#', '')
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((value) => `${value}${value}`)
          .join('')
      : normalized
  if (!/^[0-9a-f]{6}$/i.test(expanded)) {
    return null
  }
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  }
}

function toHex(color: { r: number; g: number; b: number }) {
  return `#${[color.r, color.g, color.b]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'))
    .join('')}`
}

function blendHex(colorA: string, colorB: string, mix: number) {
  const parsedA = parseHex(colorA)
  const parsedB = parseHex(colorB)
  if (!parsedA || !parsedB) {
    return colorA
  }
  const ratio = Math.max(0, Math.min(1, mix))
  return toHex({
    r: parsedA.r + (parsedB.r - parsedA.r) * ratio,
    g: parsedA.g + (parsedB.g - parsedA.g) * ratio,
    b: parsedA.b + (parsedB.b - parsedA.b) * ratio,
  })
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function paragraphHtml(
  text: string,
  options: {
    color: string
    fontFamily: string
    fontSize: number
    fontWeight?: number
    textAlign?: TextboxData['alignment']
    lineHeight?: number
    italic?: boolean
    letterSpacingEm?: number
  }
) {
  const fontSize = Math.max(12, Math.round(options.fontSize * TEMPLATE_FONT_SCALE))
  const weight = options.fontWeight ?? 400
  const textAlign = options.textAlign ?? 'left'
  const lineHeight = options.lineHeight ?? 1.18
  const letterSpacing = options.letterSpacingEm ?? 0
  const italicCss = options.italic ? 'font-style: italic;' : ''
  return `<p style="text-align: ${textAlign}; line-height: ${lineHeight};"><span style="color: ${options.color}; font-size: ${fontSize}px; font-family: ${options.fontFamily}; font-weight: ${weight}; letter-spacing: ${letterSpacing}em; ${italicCss}">${escapeHtml(text)}</span></p>`
}

function bulletListHtml(
  items: string[],
  options: {
    color: string
    fontFamily: string
    fontSize: number
    fontWeight?: number
    textAlign?: TextboxData['alignment']
    lineHeight?: number
  }
) {
  const fontSize = Math.max(12, Math.round(options.fontSize * TEMPLATE_FONT_SCALE))
  const weight = options.fontWeight ?? 400
  const textAlign = options.textAlign ?? 'left'
  const lineHeight = options.lineHeight ?? 1.3
  return `<ul style="text-align: ${textAlign}; line-height: ${lineHeight};">${items
    .map(
      (item) =>
        `<li><span style="color: ${options.color}; font-size: ${fontSize}px; font-family: ${options.fontFamily}; font-weight: ${weight};">${escapeHtml(item)}</span></li>`
    )
    .join('')}</ul>`
}

function makeLinearGradient(colorA: string, colorB: string, angleDeg: number): FillGradient {
  return {
    colorA,
    colorB,
    angleDeg,
    gradientType: 'linear',
    stops: [
      { color: colorA, positionPercent: 0 },
      { color: colorB, positionPercent: 100 },
    ],
  }
}

function makeShapeData(options: {
  fillColor?: string
  fillGradient?: FillGradient | null
  borderColor?: string
  borderWidth?: number
  radius?: number
  kind?: ShapeData['kind']
}): ShapeData {
  const fillGradient = options.fillGradient ?? null
  const kind = options.kind ?? 'rect'
  return {
    kind,
    adjustmentPercent: getDefaultShapeAdjustment(kind),
    borderColor: options.borderColor ?? '#000000',
    borderType: 'solid',
    borderWidth: options.borderWidth ?? 0,
    fillMode: fillGradient ? 'linearGradient' : 'solid',
    fillColor: options.fillColor ?? '#ffffff',
    fillGradient,
    radius: options.radius ?? 0,
    opacityPercent: 100,
    shadowColor: '#000000',
    shadowBlurPx: 0,
    shadowAngleDeg: 45,
  }
}

function makeTextboxData(options: {
  text: string
  richTextHtml: string
  fontFamily: string
  fontSize: number
  textColor: string
  backgroundColor?: string
  borderColor?: string
  borderWidth?: number
  alignment?: TextboxData['alignment']
  listType?: TextboxData['listType']
}): TextboxData {
  const fontSize = Math.max(12, Math.round(options.fontSize * TEMPLATE_FONT_SCALE))
  return {
    runs: [
      {
        text: options.text,
        bold: false,
        italic: false,
        underline: false,
        color: options.textColor,
        fontSize,
      },
    ],
    richTextHtml: options.richTextHtml,
    fontFamily: options.fontFamily,
    alignment: options.alignment ?? 'left',
    listType: options.listType ?? 'none',
    autoHeight: true,
    fillMode: 'solid',
    backgroundColor: options.backgroundColor ?? 'transparent',
    fillGradient: null,
    borderColor: options.borderColor ?? '#000000',
    borderType: 'solid',
    borderWidth: options.borderWidth ?? 0,
    radius: 0,
    opacityPercent: 100,
    shadowColor: '#000000',
    shadowBlurPx: 0,
    shadowAngleDeg: 45,
  }
}

function withOffset(frame: LayoutFrame, offset: Required<LayoutFrame>): LayoutFrame {
  return {
    x: frame.x + offset.x,
    y: frame.y + offset.y,
    w: frame.w + offset.w,
    h: frame.h + offset.h,
  }
}

function resolveThemeColorSpec(spec: ColorSpec, theme: TemplateLayoutTheme): string {
  if (typeof spec === 'string') {
    if (spec.startsWith('theme.')) {
      const key = spec.slice('theme.'.length) as keyof TemplateLayoutTheme
      const value = theme[key]
      return typeof value === 'string' ? value : spec
    }
    return spec
  }
  const colorA = resolveThemeColorSpec(spec.blend.a, theme)
  const colorB = resolveThemeColorSpec(spec.blend.b, theme)
  return blendHex(colorA, colorB, spec.blend.mix)
}

function buildBaseFrame(factory: TemplateObjectFactory, theme: TemplateLayoutTheme): CanvasObject {
  return factory.shape(
    'shape_rect',
    { x: 0, y: 0, w: 1600, h: 900 },
    makeShapeData({
      fillGradient: makeLinearGradient(theme.surface, blendHex(theme.surface, '#000000', 0.25), 150),
      fillColor: theme.surface,
      borderColor: theme.borderSoft,
      borderWidth: 2,
      radius: 28,
    })
  )
}

function buildPanel(
  factory: TemplateObjectFactory,
  theme: TemplateLayoutTheme,
  frame: LayoutFrame,
  variant: 'surface' | 'accent' | 'muted' = 'surface'
): CanvasObject {
  const fillColor =
    variant === 'accent' ? theme.accent : variant === 'muted' ? theme.surfaceAlt : theme.surface
  const borderColor = variant === 'accent' ? theme.accentSoft : theme.border
  return factory.shape(
    'shape_rect',
    frame,
    makeShapeData({
      fillColor,
      borderColor,
      borderWidth: 2,
      radius: 24,
    })
  )
}

export function buildObjectsFromTemplateLayout(
  layout: TemplateLayoutNode[],
  options: {
    factory: TemplateObjectFactory
    theme: TemplateLayoutTheme
    resolveTextRole: (role: TextStyleRoleId) => { fontFamily: string; fontSize: number; color: string }
  }
): CanvasObject[] {
  const objects: CanvasObject[] = []

  const addNode = (node: TemplateLayoutNode, offset: Required<LayoutFrame>, depth: number) => {
    if (depth > 5) {
      return
    }

    if (node.kind === 'repeat') {
      const step = node.step ?? {}
      const startIndex = node.startIndex ?? 0
      for (let index = 0; index < node.count; index += 1) {
        const iteration = index + startIndex
        const nextOffset: Required<LayoutFrame> = {
          x: offset.x + (step.x ?? 0) * iteration,
          y: offset.y + (step.y ?? 0) * iteration,
          w: offset.w + (step.w ?? 0) * iteration,
          h: offset.h + (step.h ?? 0) * iteration,
        }
        addNode(node.node, nextOffset, depth + 1)
      }
      return
    }

    if (node.kind === 'baseFrame') {
      objects.push(buildBaseFrame(options.factory, options.theme))
      return
    }

    if (node.kind === 'panel') {
      objects.push(buildPanel(options.factory, options.theme, withOffset(node.frame, offset), node.variant ?? 'surface'))
      return
    }

    if (node.kind === 'placeholder') {
      objects.push(
        options.factory.placeholder(withOffset(node.frame, offset), {
          kind: node.placeholderKind ?? 'universal',
          prompt: node.prompt,
        })
      )
      return
    }

    if (node.kind === 'shape') {
      const shapeData = node.shapeData ?? {}
      const fillGradientSpec = shapeData.fillGradient
      const fillGradient =
        fillGradientSpec === undefined || fillGradientSpec === null
          ? null
          : makeLinearGradient(
              resolveThemeColorSpec(fillGradientSpec.colorA, options.theme),
              resolveThemeColorSpec(fillGradientSpec.colorB, options.theme),
              fillGradientSpec.angleDeg
            )
      objects.push(
        options.factory.shape(
          node.shapeType,
          withOffset(node.frame, offset),
          makeShapeData({
            kind: shapeData.kind,
            fillColor:
              shapeData.fillColor === undefined
                ? '#ffffff'
                : resolveThemeColorSpec(shapeData.fillColor, options.theme),
            borderColor:
              shapeData.borderColor === undefined
                ? '#000000'
                : resolveThemeColorSpec(shapeData.borderColor, options.theme),
            borderWidth: shapeData.borderWidth,
            radius: shapeData.radius,
            fillGradient,
          })
        )
      )
      return
    }

    const role = node.style?.role ? options.resolveTextRole(node.style.role) : null
    const fontFamily = node.style?.fontFamily ?? role?.fontFamily ?? options.theme.fontFamily
    const fontSize = node.style?.fontSize ?? role?.fontSize ?? 28
    const textColor =
      node.style?.color !== undefined
        ? resolveThemeColorSpec(node.style.color, options.theme)
        : role?.color ?? options.theme.text
    const textAlign = node.style?.textAlign ?? node.box?.alignment ?? 'left'
    const format = node.format ?? 'paragraph'
    const listItems =
      format === 'bulletList'
        ? node.items && node.items.length > 0
          ? node.items
          : node.text
              .split(/\s{2,}/)
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0)
        : []

    const richTextHtml =
      format === 'bulletList'
        ? bulletListHtml(listItems, {
            color: textColor,
            fontFamily,
            fontSize,
            fontWeight: node.style?.fontWeight,
            textAlign,
            lineHeight: node.style?.lineHeight,
          })
        : paragraphHtml(node.text, {
            color: textColor,
            fontFamily,
            fontSize,
            fontWeight: node.style?.fontWeight,
            textAlign,
            lineHeight: node.style?.lineHeight,
            italic: node.style?.italic,
            letterSpacingEm: node.style?.letterSpacingEm,
          })

    objects.push(
      options.factory.textbox(
        withOffset(node.frame, offset),
        makeTextboxData({
          text: node.text,
          richTextHtml,
          fontFamily,
          fontSize,
          textColor,
          backgroundColor:
            node.box?.backgroundColor !== undefined
              ? resolveThemeColorSpec(node.box.backgroundColor, options.theme)
              : 'transparent',
          borderColor:
            node.box?.borderColor !== undefined
              ? resolveThemeColorSpec(node.box.borderColor, options.theme)
              : '#000000',
          borderWidth: node.box?.borderWidth ?? 0,
          alignment: node.box?.alignment ?? textAlign,
          listType: node.box?.listType ?? (format === 'bulletList' ? 'bullet' : 'none'),
        })
      )
    )
  }

  const zeroOffset: Required<LayoutFrame> = { x: 0, y: 0, w: 0, h: 0 }
  for (const node of layout) {
    addNode(node, zeroOffset, 0)
  }
  return objects
}

export function getDefaultSlideTemplateLayout(): TemplateLayoutNode[] {
  return [
    { kind: 'baseFrame' },
    { kind: 'panel', frame: { x: 455, y: 0, w: 490, h: 620 }, variant: 'muted' },
    { kind: 'placeholder', frame: { x: -340, y: -250, w: 670, h: 130 }, prompt: 'Slide title' },
    { kind: 'placeholder', frame: { x: -360, y: 20, w: 660, h: 360 }, prompt: 'Key points' },
    { kind: 'placeholder', frame: { x: 455, y: -80, w: 330, h: 220 }, prompt: 'Support note' },
  ]
}
