import type { TextAlignment, TextListType } from './model'

const stylePresetModules = import.meta.glob('./assets/styles/presets/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

export const TEXT_STYLE_ROLE_IDS = [
  'title',
  'heading',
  'description',
  'label',
  'text',
  'caption',
] as const

export type TextStyleRoleId = (typeof TEXT_STYLE_ROLE_IDS)[number]

export interface TextStyleRole {
  id: TextStyleRoleId
  label: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  italic: boolean
  underline: boolean
  color: string
  alignment: TextAlignment
  listType: TextListType
}

export const OBJECT_STYLE_ROLE_IDS = [
  'foreground-item',
  'background-item',
  'accent-item',
  'muted-item',
  'highlight-item',
] as const

export type ObjectStyleRoleId = (typeof OBJECT_STYLE_ROLE_IDS)[number]

export interface ObjectStyleRole {
  id: ObjectStyleRoleId
  label: string
  fillColor: string
  borderColor: string
  textColor: string
  borderWidth: number
  opacityPercent: number
}

export interface AssetStylePalette {
  imageBorder: string
  videoBorder: string
  audioBorder: string
  iconTint: string
}

export interface StylePreset {
  id: string
  name: string
  inspiration: string
  fontFamily: string
  canvasBackground: string
  shapeFill: string
  shapeBorder: string
  textboxBackground: string
  textboxBorder: string
  textColor: string
  imageBorder: string
  textStyles: TextStyleRole[]
  objectStyles: ObjectStyleRole[]
  assetStyle: AssetStylePalette
}

export interface StylePresetDefinition {
  id: string
  name: string
  inspiration: string
  fontFamily: string
  canvasBackground: string
  text: {
    primary: string
    secondary: string
    muted: string
    accent: string
  }
  objects: {
    foregroundFill: string
    foregroundBorder: string
    foregroundText: string
    backgroundFill: string
    backgroundBorder: string
    backgroundText: string
    accentFill: string
    accentBorder: string
    accentText: string
    mutedFill: string
    mutedBorder: string
    mutedText: string
    highlightFill: string
    highlightBorder: string
    highlightText: string
  }
  assets: AssetStylePalette
}

export interface StylePresetCatalogEntry {
  definition: StylePresetDefinition
  preset: StylePreset
  sourceType: 'builtin' | 'asset'
  sourceFileName: string | null
  sourceAssetId: string | null
}

function makeTextStyles(
  fontFamily: string,
  palette: {
    primary: string
    secondary: string
    muted: string
    accent: string
  }
): TextStyleRole[] {
  return [
    {
      id: 'title',
      label: 'Title',
      fontFamily,
      fontSize: 56,
      fontWeight: 700,
      italic: false,
      underline: false,
      color: palette.primary,
      alignment: 'left',
      listType: 'none',
    },
    {
      id: 'heading',
      label: 'Heading',
      fontFamily,
      fontSize: 36,
      fontWeight: 700,
      italic: false,
      underline: false,
      color: palette.primary,
      alignment: 'left',
      listType: 'none',
    },
    {
      id: 'description',
      label: 'Description',
      fontFamily,
      fontSize: 24,
      fontWeight: 400,
      italic: false,
      underline: false,
      color: palette.secondary,
      alignment: 'left',
      listType: 'none',
    },
    {
      id: 'label',
      label: 'Label',
      fontFamily,
      fontSize: 18,
      fontWeight: 700,
      italic: false,
      underline: false,
      color: palette.accent,
      alignment: 'left',
      listType: 'none',
    },
    {
      id: 'text',
      label: 'Text',
      fontFamily,
      fontSize: 28,
      fontWeight: 400,
      italic: false,
      underline: false,
      color: palette.primary,
      alignment: 'left',
      listType: 'none',
    },
    {
      id: 'caption',
      label: 'Caption',
      fontFamily,
      fontSize: 16,
      fontWeight: 400,
      italic: true,
      underline: false,
      color: palette.muted,
      alignment: 'left',
      listType: 'none',
    },
  ]
}

function makeObjectStyles(
  palette: StylePresetDefinition['objects']
): ObjectStyleRole[] {
  return [
    {
      id: 'foreground-item',
      label: 'Foreground',
      fillColor: palette.foregroundFill,
      borderColor: palette.foregroundBorder,
      textColor: palette.foregroundText,
      borderWidth: 2,
      opacityPercent: 100,
    },
    {
      id: 'background-item',
      label: 'Background',
      fillColor: palette.backgroundFill,
      borderColor: palette.backgroundBorder,
      textColor: palette.backgroundText,
      borderWidth: 1,
      opacityPercent: 100,
    },
    {
      id: 'accent-item',
      label: 'Accent',
      fillColor: palette.accentFill,
      borderColor: palette.accentBorder,
      textColor: palette.accentText,
      borderWidth: 2,
      opacityPercent: 100,
    },
    {
      id: 'muted-item',
      label: 'Muted',
      fillColor: palette.mutedFill,
      borderColor: palette.mutedBorder,
      textColor: palette.mutedText,
      borderWidth: 1,
      opacityPercent: 95,
    },
    {
      id: 'highlight-item',
      label: 'Highlight',
      fillColor: palette.highlightFill,
      borderColor: palette.highlightBorder,
      textColor: palette.highlightText,
      borderWidth: 2,
      opacityPercent: 100,
    },
  ]
}

export function makeStylePreset(options: StylePresetDefinition): StylePreset {
  const textStyles = makeTextStyles(options.fontFamily, options.text)
  const objectStyles = makeObjectStyles(options.objects)
  const backgroundStyle = objectStyles.find((style) => style.id === 'background-item') ?? objectStyles[1]
  const foregroundStyle = objectStyles.find((style) => style.id === 'foreground-item') ?? objectStyles[0]
  return {
    id: options.id,
    name: options.name,
    inspiration: options.inspiration,
    fontFamily: options.fontFamily,
    canvasBackground: options.canvasBackground,
    shapeFill: foregroundStyle.fillColor,
    shapeBorder: foregroundStyle.borderColor,
    textboxBackground: backgroundStyle.fillColor,
    textboxBorder: backgroundStyle.borderColor,
    textColor: options.text.primary,
    imageBorder: options.assets.imageBorder,
    textStyles,
    objectStyles,
    assetStyle: options.assets,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasStringFields(record: Record<string, unknown>, fields: string[]) {
  return fields.every((field) => typeof record[field] === 'string' && record[field].trim().length > 0)
}

export function isStylePresetDefinition(value: unknown): value is StylePresetDefinition {
  if (!isRecord(value)) {
    return false
  }
  if (
    !hasStringFields(value, ['id', 'name', 'inspiration', 'fontFamily', 'canvasBackground']) ||
    !isRecord(value.text) ||
    !isRecord(value.objects) ||
    !isRecord(value.assets)
  ) {
    return false
  }

  const textOk = hasStringFields(value.text, ['primary', 'secondary', 'muted', 'accent'])
  const objectsOk = hasStringFields(value.objects, [
    'foregroundFill',
    'foregroundBorder',
    'foregroundText',
    'backgroundFill',
    'backgroundBorder',
    'backgroundText',
    'accentFill',
    'accentBorder',
    'accentText',
    'mutedFill',
    'mutedBorder',
    'mutedText',
    'highlightFill',
    'highlightBorder',
    'highlightText',
  ])
  const assetsOk = hasStringFields(value.assets, ['imageBorder', 'videoBorder', 'audioBorder', 'iconTint'])
  return textOk && objectsOk && assetsOk
}

function loadStylePresetDefinitionsFromJsonFiles(): StylePresetDefinition[] {
  const validEntries: StylePresetDefinition[] = []
  const moduleEntries = Object.entries(stylePresetModules).sort(([a], [b]) => a.localeCompare(b))
  for (const [path, value] of moduleEntries) {
    if (!isStylePresetDefinition(value)) {
      console.warn(`Invalid style preset JSON at ${path}; skipping.`)
      continue
    }
    validEntries.push({ ...value, id: value.id.trim() })
  }
  if (validEntries.length === 0) {
    console.warn('No valid style preset JSON files found in src/assets/styles/presets.')
  }
  return validEntries
}

const BUILTIN_STYLE_PRESET_ENTRIES: StylePresetCatalogEntry[] = loadStylePresetDefinitionsFromJsonFiles().map(
  (definition) => ({
    definition,
    preset: makeStylePreset(definition),
    sourceType: 'builtin',
    sourceFileName: null,
    sourceAssetId: null,
  })
)
const runtimeStylePresetEntries: StylePresetCatalogEntry[] = []

export function registerRuntimeStylePresetDefinition(
  definition: StylePresetDefinition,
  options?: { sourceFileName?: string | null; sourceAssetId?: string | null }
) {
  const normalizedId = definition.id.trim()
  if (normalizedId.length === 0) {
    return { added: false, reason: 'missing-id' as const }
  }
  const hasDuplicate = [...BUILTIN_STYLE_PRESET_ENTRIES, ...runtimeStylePresetEntries].some((entry) => entry.definition.id === normalizedId)
  if (hasDuplicate) {
    return { added: false, reason: 'duplicate-id' as const }
  }
  const normalizedDefinition = { ...definition, id: normalizedId }
  runtimeStylePresetEntries.push({
    definition: normalizedDefinition,
    preset: makeStylePreset(normalizedDefinition),
    sourceType: 'asset',
    sourceFileName: options?.sourceFileName?.trim() || null,
    sourceAssetId: options?.sourceAssetId?.trim() || null,
  })
  return { added: true, reason: null }
}

export function getStylePresetCatalogEntries(): StylePresetCatalogEntry[] {
  return [...BUILTIN_STYLE_PRESET_ENTRIES, ...runtimeStylePresetEntries]
}

export function getStylePresetDefinitions(): StylePresetDefinition[] {
  return getStylePresetCatalogEntries().map((entry) => entry.definition)
}

export function getStylePresetDefinitionById(id: string): StylePresetDefinition | null {
  return getStylePresetCatalogEntries().find((entry) => entry.definition.id === id)?.definition ?? null
}

export function getStylePresets(): StylePreset[] {
  return getStylePresetCatalogEntries().map((entry) => entry.preset)
}

export const STYLE_PRESETS: StylePreset[] = BUILTIN_STYLE_PRESET_ENTRIES.map((entry) => entry.preset)

export function getTextStyleRole(preset: StylePreset | null, roleId: TextStyleRoleId): TextStyleRole | null {
  if (!preset) {
    return null
  }
  return preset.textStyles.find((entry) => entry.id === roleId) ?? null
}

export function getObjectStyleRole(
  preset: StylePreset | null,
  roleId: ObjectStyleRoleId
): ObjectStyleRole | null {
  if (!preset) {
    return null
  }
  return preset.objectStyles.find((entry) => entry.id === roleId) ?? null
}
