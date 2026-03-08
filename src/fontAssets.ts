import type { Asset } from './model'
import { resolveLibraryAssetKind } from './assetFile'

export const COMMON_TEXTBOX_FONTS = [
  'Arial',
  'Verdana',
  'Trebuchet MS',
  'Times New Roman',
  'Georgia',
  'Courier New',
]

function getFileExtension(name: string) {
  const trimmed = name.trim().toLowerCase()
  const lastDot = trimmed.lastIndexOf('.')
  return lastDot >= 0 ? trimmed.slice(lastDot + 1) : ''
}

function escapeCssString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export function resolveAssetFontFamily(asset: Pick<Asset, 'name'>) {
  return asset.name.replace(/\.[^.]+$/, '').trim() || asset.name
}

function resolveFontFormat(asset: Pick<Asset, 'mimeType' | 'name'>) {
  const mimeType = asset.mimeType.toLowerCase()
  const extension = getFileExtension(asset.name)
  if (mimeType.includes('woff2') || extension === 'woff2') {
    return 'woff2'
  }
  if (mimeType.includes('woff') || extension === 'woff') {
    return 'woff'
  }
  if (mimeType.includes('opentype') || mimeType.includes('otf') || extension === 'otf') {
    return 'opentype'
  }
  if (mimeType.includes('embedded') || extension === 'eot') {
    return 'embedded-opentype'
  }
  return 'truetype'
}

export function collectAvailableTextboxFonts(assets: Asset[], currentFontFamily?: string | null) {
  const next = [...COMMON_TEXTBOX_FONTS]
  assets.forEach((asset) => {
    if (resolveLibraryAssetKind(asset) !== 'font') {
      return
    }
    const family = resolveAssetFontFamily(asset)
    if (!next.includes(family)) {
      next.push(family)
    }
  })
  if (currentFontFamily && !next.includes(currentFontFamily)) {
    next.push(currentFontFamily)
  }
  return next
}

export function buildAssetFontFaceCss(assets: Asset[]) {
  return assets
    .filter((asset) => resolveLibraryAssetKind(asset) === 'font')
    .map((asset) => {
      const family = escapeCssString(resolveAssetFontFamily(asset))
      const format = resolveFontFormat(asset)
      const mimeType = asset.mimeType || 'font/ttf'
      return `@font-face { font-family: '${family}'; src: url(data:${mimeType};base64,${asset.dataBase64}) format('${format}'); font-display: swap; }`
    })
    .join('\n')
}
