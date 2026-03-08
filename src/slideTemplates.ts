import type { CanvasObject, ShapeData, Slide, TemplatePlaceholderData, TextboxData } from './model'
import type { StylePreset, TextStyleRoleId } from './stylePresets'
import { diagonalFromZoom } from './slideDiagonal'
import { getObjectStyleRole, getTextStyleRole } from './stylePresets'
import {
  buildObjectsFromTemplateLayout,
  getDefaultSlideTemplateLayout,
  parseTemplateLayout,
  type TemplateLayoutNode,
} from './templateLayoutRuntime'

const templateCatalogModules = import.meta.glob('./assets/templates/catalog/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

const TEMPLATE_FRAME_WIDTH = 1600
const TEMPLATE_FRAME_HEIGHT = 900
const TEMPLATE_FONT_SCALE = 0.82

export interface SlideTemplate {
  id: string
  name: string
  description: string
  section: 'generic'
}

export interface SlideTemplateDefinition extends SlideTemplate {
  layout: TemplateLayoutNode[]
}

export interface SlideTemplateCatalogEntry {
  definition: SlideTemplateDefinition
  sourceType: 'builtin' | 'asset'
  sourceFileName: string | null
  sourceAssetId: string | null
}

export interface SlideTemplateTheme {
  fontFamily: string
  frame: string
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

interface TemplateObjectBuildOptions {
  centerX: number
  centerY: number
  zoom: number
  rotation: number
  frameWidth?: number
  frameHeight?: number
  scalePercent?: number
  createId: () => string
  zIndexStart: number
  stylePreset: StylePreset | null
}

interface TemplateSlideBuildOptions extends TemplateObjectBuildOptions {
  slideId: string
  orderIndex: number
}

const DEFAULT_STYLE_THEME: SlideTemplateTheme = {
  fontFamily: 'Arial',
  frame: 'linear-gradient(140deg, #17263f 0%, #111d31 100%)',
  surface: '#1c2e4b',
  surfaceAlt: '#263b5e',
  accent: '#4d7fd1',
  accentSoft: '#7ea8ea',
  border: '#8eb0df',
  borderSoft: '#4f6688',
  text: '#edf4ff',
  mutedText: '#b3c6e6',
  inverseText: '#f8fbff',
  highlight: '#b5d0ff',
}

interface RawSlideTemplateRecord {
  id: string
  name: string
  description: string
  section: 'generic' | 'style-specific'
  stylePresetId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isRawSlideTemplateRecord(value: unknown): value is RawSlideTemplateRecord {
  if (!isRecord(value)) {
    return false
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.description !== 'string' ||
    (value.section !== 'generic' && value.section !== 'style-specific')
  ) {
    return false
  }
  if (value.stylePresetId !== undefined) {
    return typeof value.stylePresetId === 'string' && value.stylePresetId.trim().length > 0
  }
  return true
}

function toSlideTemplate(value: RawSlideTemplateRecord): SlideTemplate {
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    // Legacy "style-specific" records are normalized to generic templates.
    section: 'generic',
  }
}

function loadTemplateDefinitionsFromJsonFiles(): SlideTemplateDefinition[] {
  const definitions: SlideTemplateDefinition[] = []
  const moduleEntries = Object.entries(templateCatalogModules).sort(([a], [b]) => a.localeCompare(b))

  for (const [path, value] of moduleEntries) {
    if (!isRawSlideTemplateRecord(value)) {
      console.warn(`Invalid template catalog JSON at ${path}; skipping.`)
      continue
    }
    const layout = parseTemplateLayout((value as { layout?: unknown }).layout)

    definitions.push({
      ...toSlideTemplate(value),
      layout: layout ?? getDefaultSlideTemplateLayout(),
    })
  }

  if (definitions.length === 0) {
    console.warn('No valid template catalog JSON files found in src/assets/templates/catalog.')
  }

  return definitions
}

const BUILTIN_TEMPLATE_CATALOG_ENTRIES: SlideTemplateCatalogEntry[] = loadTemplateDefinitionsFromJsonFiles().map(
  (definition) => ({
    definition,
    sourceType: 'builtin',
    sourceFileName: null,
    sourceAssetId: null,
  })
)
const runtimeTemplateCatalogEntries: SlideTemplateCatalogEntry[] = []

function parseSlideTemplateDefinition(value: unknown): SlideTemplateDefinition | null {
  if (!isRecord(value) || !isRawSlideTemplateRecord(value)) {
    return null
  }
  const parsedLayout = parseTemplateLayout(value.layout)
  if (!parsedLayout) {
    return null
  }
  return {
    ...toSlideTemplate(value),
    layout: parsedLayout,
  }
}

export function isSlideTemplateDefinition(value: unknown): value is SlideTemplateDefinition {
  return parseSlideTemplateDefinition(value) !== null
}

export function registerRuntimeSlideTemplateDefinition(
  value: unknown,
  options?: { sourceFileName?: string | null; sourceAssetId?: string | null }
) {
  const parsed = parseSlideTemplateDefinition(value)
  if (!parsed) {
    return { added: false, reason: 'invalid-format' as const }
  }

  const hasDuplicate = [...BUILTIN_TEMPLATE_CATALOG_ENTRIES, ...runtimeTemplateCatalogEntries].some((entry) => entry.definition.id === parsed.id)
  if (hasDuplicate) {
    return { added: false, reason: 'duplicate-id' as const }
  }

  runtimeTemplateCatalogEntries.push({
    definition: parsed,
    sourceType: 'asset',
    sourceFileName: options?.sourceFileName?.trim() || null,
    sourceAssetId: options?.sourceAssetId?.trim() || null,
  })
  return { added: true, reason: null }
}

export function unregisterRuntimeSlideTemplateDefinitionsBySourceAssetId(sourceAssetId: string) {
  const normalizedSourceAssetId = sourceAssetId.trim()
  if (!normalizedSourceAssetId) {
    return 0
  }
  const initialLength = runtimeTemplateCatalogEntries.length
  for (let index = runtimeTemplateCatalogEntries.length - 1; index >= 0; index -= 1) {
    if (runtimeTemplateCatalogEntries[index].sourceAssetId === normalizedSourceAssetId) {
      runtimeTemplateCatalogEntries.splice(index, 1)
    }
  }
  return initialLength - runtimeTemplateCatalogEntries.length
}

export function getSlideTemplateCatalogEntries(): SlideTemplateCatalogEntry[] {
  return [...BUILTIN_TEMPLATE_CATALOG_ENTRIES, ...runtimeTemplateCatalogEntries]
}

export function getSlideTemplateDefinitions(): SlideTemplateDefinition[] {
  return getSlideTemplateCatalogEntries().map((entry) => entry.definition)
}

export function getSlideTemplateDefinitionById(id: string): SlideTemplateDefinition | null {
  return getSlideTemplateDefinitions().find((entry) => entry.id === id) ?? null
}

function toTemplateCatalogRecord(definition: SlideTemplateDefinition): SlideTemplate {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    section: definition.section,
  }
}

const BUILTIN_TEMPLATE_CATALOG = BUILTIN_TEMPLATE_CATALOG_ENTRIES.map((entry) =>
  toTemplateCatalogRecord(entry.definition)
)

export const SLIDE_TEMPLATES: SlideTemplate[] = BUILTIN_TEMPLATE_CATALOG

function rotatePoint(point: { x: number; y: number }, radians: number) {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }
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

function isDarkHex(hex: string) {
  const parsed = parseHex(hex)
  if (!parsed) {
    return true
  }
  const luminance = (0.2126 * parsed.r + 0.7152 * parsed.g + 0.0722 * parsed.b) / 255
  return luminance < 0.52
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

export function resolveSlideTemplateTheme(stylePreset: StylePreset | null): SlideTemplateTheme {
  const foreground = getObjectStyleRole(stylePreset, 'foreground-item')
  const background = getObjectStyleRole(stylePreset, 'background-item')
  const accent = getObjectStyleRole(stylePreset, 'accent-item')
  const muted = getObjectStyleRole(stylePreset, 'muted-item')
  const highlight = getObjectStyleRole(stylePreset, 'highlight-item')
  const text = getTextStyleRole(stylePreset, 'text')
  const description = getTextStyleRole(stylePreset, 'description')
  const label = getTextStyleRole(stylePreset, 'label')

  const surface = background?.fillColor ?? stylePreset?.textboxBackground ?? DEFAULT_STYLE_THEME.surface
  const accentFill = accent?.fillColor ?? stylePreset?.shapeFill ?? DEFAULT_STYLE_THEME.accent
  const accentText = accent?.textColor ?? DEFAULT_STYLE_THEME.inverseText
  const border = background?.borderColor ?? stylePreset?.textboxBorder ?? DEFAULT_STYLE_THEME.border
  const mainText = text?.color ?? stylePreset?.textColor ?? DEFAULT_STYLE_THEME.text
  const mutedText = description?.color ?? muted?.textColor ?? DEFAULT_STYLE_THEME.mutedText

  return {
    fontFamily: text?.fontFamily ?? stylePreset?.fontFamily ?? DEFAULT_STYLE_THEME.fontFamily,
    frame: stylePreset?.canvasBackground ?? DEFAULT_STYLE_THEME.frame,
    surface,
    surfaceAlt: muted?.fillColor ?? blendHex(surface, '#ffffff', isDarkHex(surface) ? 0.1 : 0.55),
    accent: accentFill,
    accentSoft: highlight?.fillColor ?? blendHex(accentFill, '#ffffff', 0.32),
    border,
    borderSoft: foreground?.borderColor ?? blendHex(border, surface, 0.4),
    text: mainText,
    mutedText,
    inverseText: isDarkHex(accentFill) ? '#ffffff' : accentText,
    highlight: label?.color ?? highlight?.borderColor ?? stylePreset?.imageBorder ?? DEFAULT_STYLE_THEME.highlight,
  }
}

function buildObjectFactory(options: TemplateObjectBuildOptions) {
  let nextZIndex = options.zIndexStart
  const safeZoom = Math.max(0.0001, options.zoom)
  const targetFrameWidth = Math.max(1, options.frameWidth ?? TEMPLATE_FRAME_WIDTH)
  const targetFrameHeight = Math.max(1, options.frameHeight ?? TEMPLATE_FRAME_HEIGHT)
  const frameScaleX = targetFrameWidth / TEMPLATE_FRAME_WIDTH
  const frameScaleY = targetFrameHeight / TEMPLATE_FRAME_HEIGHT
  const frameScaleUniform = Math.min(frameScaleX, frameScaleY)
  const scalePercent = options.scalePercent ?? Math.max(1, Math.min(10000, Math.round(100 / safeZoom)))

  const toWorldPoint = (localX: number, localY: number) => {
    const rotated = rotatePoint(
      {
        x: (localX * frameScaleX) / safeZoom,
        y: (localY * frameScaleY) / safeZoom,
      },
      options.rotation
    )
    return {
      x: options.centerX + rotated.x,
      y: options.centerY + rotated.y,
    }
  }

  return {
    shape(
      type: 'shape_rect' | 'shape_circle',
      frame: { x: number; y: number; w: number; h: number },
      shapeData: ShapeData
    ): CanvasObject {
      const position = toWorldPoint(frame.x, frame.y)
      const object = {
        id: options.createId(),
        type,
        x: position.x,
        y: position.y,
        w: (frame.w * frameScaleX) / safeZoom,
        h: (frame.h * frameScaleY) / safeZoom,
        rotation: options.rotation,
        scalePercent,
        keepAspectRatio: type === 'shape_circle',
        locked: false,
        zIndex: nextZIndex,
        parentGroupId: null,
        shapeData: {
          ...shapeData,
          radius: (Math.max(0, shapeData.radius) * frameScaleUniform) / safeZoom,
        },
      } satisfies CanvasObject
      nextZIndex += 1
      return object
    },
    textbox(frame: { x: number; y: number; w: number; h: number }, textboxData: TextboxData): CanvasObject {
      const position = toWorldPoint(frame.x, frame.y)
      const object = {
        id: options.createId(),
        type: 'textbox' as const,
        x: position.x,
        y: position.y,
        w: (frame.w * frameScaleX) / safeZoom,
        h: (frame.h * frameScaleY) / safeZoom,
        rotation: options.rotation,
        scalePercent,
        keepAspectRatio: false,
        locked: false,
        zIndex: nextZIndex,
        parentGroupId: null,
        textboxData,
      } satisfies CanvasObject
      nextZIndex += 1
      return object
    },
    placeholder(
      frame: { x: number; y: number; w: number; h: number },
      templatePlaceholderData: TemplatePlaceholderData
    ): CanvasObject {
      const position = toWorldPoint(frame.x, frame.y)
      const object = {
        id: options.createId(),
        type: 'template_placeholder' as const,
        x: position.x,
        y: position.y,
        w: (frame.w * frameScaleX) / safeZoom,
        h: (frame.h * frameScaleY) / safeZoom,
        rotation: options.rotation,
        scalePercent,
        keepAspectRatio: false,
        locked: false,
        zIndex: nextZIndex,
        parentGroupId: null,
        templatePlaceholderData,
      } satisfies CanvasObject
      nextZIndex += 1
      return object
    },
  }
}

function getDefaultFontSizeForRole(role: TextStyleRoleId) {
  if (role === 'title') {
    return 56
  }
  if (role === 'heading') {
    return 36
  }
  if (role === 'description') {
    return 24
  }
  if (role === 'label') {
    return 18
  }
  if (role === 'caption') {
    return 16
  }
  return 28
}

function resolveTextRole(theme: SlideTemplateTheme, role: TextStyleRoleId, stylePreset: StylePreset | null) {
  const entry = getTextStyleRole(stylePreset, role)
  const fallbackColor =
    role === 'description' || role === 'caption'
      ? theme.mutedText
      : role === 'label'
        ? theme.highlight
        : theme.text
  return {
    fontFamily: entry?.fontFamily ?? theme.fontFamily,
    fontSize: entry?.fontSize ?? getDefaultFontSizeForRole(role),
    color: entry?.color ?? fallbackColor,
  }
}

function getTemplateDefinitionById(templateId: string): SlideTemplateDefinition | null {
  return getSlideTemplateDefinitions().find((definition) => definition.id === templateId) ?? null
}

function buildObjectsForTemplate(
  templateId: string,
  factory: ReturnType<typeof buildObjectFactory>,
  theme: SlideTemplateTheme,
  stylePreset: StylePreset | null
) {
  const definition = getTemplateDefinitionById(templateId)
  const layout = definition?.layout ?? getDefaultSlideTemplateLayout()
  return buildObjectsFromTemplateLayout(layout, {
    factory,
    theme,
    resolveTextRole: (role) => resolveTextRole(theme, role, stylePreset),
  })
}

export function getSlideTemplatesForStyle(_stylePresetId?: string | null | undefined) {
  const generic = getSlideTemplateDefinitions().map(toTemplateCatalogRecord)
  return {
    generic,
    all: generic,
  }
}

export function getSlideTemplateFrameSize(
  zoom: number,
  frameWidth = TEMPLATE_FRAME_WIDTH,
  frameHeight = TEMPLATE_FRAME_HEIGHT
) {
  const safeZoom = Math.max(0.0001, zoom)
  const safeFrameWidth = Math.max(1, frameWidth)
  const safeFrameHeight = Math.max(1, frameHeight)
  const gapScale = Math.min(
    safeFrameWidth / TEMPLATE_FRAME_WIDTH,
    safeFrameHeight / TEMPLATE_FRAME_HEIGHT
  )
  return {
    width: safeFrameWidth / safeZoom,
    height: safeFrameHeight / safeZoom,
    gap: (180 * gapScale) / safeZoom,
  }
}

export function buildDefaultSlideStarterObjects(options: TemplateObjectBuildOptions): CanvasObject[] {
  const theme = resolveSlideTemplateTheme(options.stylePreset)
  const titleRole = resolveTextRole(theme, 'title', options.stylePreset)
  const textRole = resolveTextRole(theme, 'text', options.stylePreset)
  const factory = buildObjectFactory(options)

  return [
    factory.textbox(
      { x: -340, y: -245, w: 780, h: 130 },
      makeTextboxData({
        text: 'Slide title',
        richTextHtml: paragraphHtml('Slide title', {
          color: titleRole.color,
          fontFamily: titleRole.fontFamily,
          fontSize: titleRole.fontSize,
          fontWeight: 700,
        }),
        fontFamily: titleRole.fontFamily,
        fontSize: titleRole.fontSize,
        textColor: titleRole.color,
      })
    ),
    factory.textbox(
      { x: -280, y: 55, w: 900, h: 360 },
      makeTextboxData({
        text: 'Point one  Point two  Point three',
        richTextHtml: bulletListHtml(['Point one', 'Point two', 'Point three'], {
          color: textRole.color,
          fontFamily: textRole.fontFamily,
          fontSize: textRole.fontSize,
          lineHeight: 1.4,
        }),
        fontFamily: textRole.fontFamily,
        fontSize: textRole.fontSize,
        textColor: textRole.color,
        listType: 'bullet',
      })
    ),
  ]
}

export function buildSlideTemplateInstance(
  template: SlideTemplate,
  options: TemplateSlideBuildOptions
): { slide: Slide; objects: CanvasObject[] } {
  const slide: Slide = {
    id: options.slideId,
    name: `${template.name} ${options.orderIndex + 1}`,
    x: options.centerX,
    y: options.centerY,
    diagonal: diagonalFromZoom(
      options.zoom,
      options.frameWidth ?? TEMPLATE_FRAME_WIDTH,
      options.frameHeight ?? TEMPLATE_FRAME_HEIGHT
    ),
    rotation: options.rotation,
    triggerMode: 'manual',
    triggerDelayMs: 0,
    transitionType: 'ease',
    transitionDurationMs: 2000,
    orderIndex: options.orderIndex,
  }

  const theme = resolveSlideTemplateTheme(options.stylePreset)
  const factory = buildObjectFactory(options)
  const objects = buildObjectsForTemplate(template.id, factory, theme, options.stylePreset)
  return { slide, objects }
}
