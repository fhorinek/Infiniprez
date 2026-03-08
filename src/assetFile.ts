import type { Asset } from './model'
import { readFileAsDataUrl, toAssetBase64 } from './imageFile'

export type LibraryAssetKind = 'image' | 'video' | 'audio' | 'font' | 'style'

export function findMatchingLibraryAsset(
  assets: readonly Asset[],
  candidate: Pick<Asset, 'dataBase64'>
): Asset | null {
  return assets.find((asset) => asset.dataBase64 === candidate.dataBase64) ?? null
}

const MB = 1024 * 1024
const MAX_LIBRARY_ASSET_BYTES: Record<LibraryAssetKind, number> = {
  image: 20 * MB,
  video: 32 * MB,
  audio: 16 * MB,
  font: 8 * MB,
  style: 4 * MB,
}

const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpg',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'image/webp',
])

const VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
])

const AUDIO_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/ogg',
  'audio/webm',
  'audio/flac',
  'audio/x-flac',
])

const FONT_MIME_TYPES = new Set([
  'font/woff',
  'font/woff2',
  'font/ttf',
  'font/otf',
  'font/sfnt',
  'application/font-woff',
  'application/x-font-ttf',
  'application/x-font-truetype',
  'application/x-font-opentype',
  'application/font-sfnt',
  'application/vnd.ms-fontobject',
])

const STYLE_MIME_TYPES = new Set([
  'application/json',
  'text/json',
])

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'mov'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac'])
const FONT_EXTENSIONS = new Set(['woff', 'woff2', 'ttf', 'otf', 'eot'])
const STYLE_EXTENSIONS = new Set(['json'])

export const SUPPORTED_LIBRARY_ASSET_ACCEPT = [
  ...IMAGE_MIME_TYPES,
  ...VIDEO_MIME_TYPES,
  ...AUDIO_MIME_TYPES,
  ...FONT_MIME_TYPES,
  ...STYLE_MIME_TYPES,
  ...[
    ...IMAGE_EXTENSIONS,
    ...VIDEO_EXTENSIONS,
    ...AUDIO_EXTENSIONS,
    ...FONT_EXTENSIONS,
    ...STYLE_EXTENSIONS,
  ].map(
    (extension) => `.${extension}`
  ),
].join(',')

function getFileExtension(name: string) {
  const trimmed = name.trim().toLowerCase()
  const lastDot = trimmed.lastIndexOf('.')
  return lastDot >= 0 ? trimmed.slice(lastDot + 1) : ''
}

function resolveMimeTypeForExtension(extension: string) {
  switch (extension) {
    case 'svg':
      return 'image/svg+xml'
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'mp4':
      return 'video/mp4'
    case 'webm':
      return 'video/webm'
    case 'ogv':
      return 'video/ogg'
    case 'mov':
      return 'video/quicktime'
    case 'mp3':
      return 'audio/mpeg'
    case 'wav':
      return 'audio/wav'
    case 'm4a':
      return 'audio/mp4'
    case 'aac':
      return 'audio/aac'
    case 'ogg':
    case 'oga':
      return 'audio/ogg'
    case 'flac':
      return 'audio/flac'
    case 'woff2':
      return 'font/woff2'
    case 'woff':
      return 'font/woff'
    case 'ttf':
      return 'font/ttf'
    case 'otf':
      return 'font/otf'
    case 'eot':
      return 'application/vnd.ms-fontobject'
    case 'json':
      return 'application/json'
    default:
      return ''
  }
}

export function resolveLibraryAssetKind(source: Pick<Asset, 'mimeType' | 'name'>): LibraryAssetKind | null {
  const extension = getFileExtension(source.name)
  const mimeType = (source.mimeType || resolveMimeTypeForExtension(extension)).toLowerCase()
  if (IMAGE_MIME_TYPES.has(mimeType) || IMAGE_EXTENSIONS.has(extension)) {
    return 'image'
  }
  if (VIDEO_MIME_TYPES.has(mimeType) || VIDEO_EXTENSIONS.has(extension)) {
    return 'video'
  }
  if (AUDIO_MIME_TYPES.has(mimeType) || AUDIO_EXTENSIONS.has(extension)) {
    return 'audio'
  }
  if (FONT_MIME_TYPES.has(mimeType) || FONT_EXTENSIONS.has(extension)) {
    return 'font'
  }
  if (STYLE_MIME_TYPES.has(mimeType) || STYLE_EXTENSIONS.has(extension)) {
    return 'style'
  }
  return null
}

export function isSupportedLibraryAssetFile(file: File) {
  return resolveLibraryAssetKind({ mimeType: file.type, name: file.name }) !== null
}

function formatBytes(size: number) {
  if (size >= MB) {
    return `${(size / MB).toFixed(1)} MB`
  }
  if (size >= 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${size} B`
}

export function validateLibraryAssetFile(file: File): string | null {
  const kind = resolveLibraryAssetKind({ mimeType: file.type, name: file.name })
  if (!kind) {
    return 'Unsupported asset type.'
  }
  const limitBytes = MAX_LIBRARY_ASSET_BYTES[kind]
  if (file.size > limitBytes) {
    return `${file.name} is too large for the asset library (${formatBytes(file.size)}). Max ${kind} size is ${formatBytes(limitBytes)}.`
  }
  return null
}

export async function getLibraryAssetMetadata(
  file: File,
  dataUrl: string
): Promise<
  Pick<Asset, 'mimeType' | 'name' | 'dataBase64' | 'intrinsicWidth' | 'intrinsicHeight' | 'durationSec'>
> {
  const mimeType = file.type || resolveMimeTypeForExtension(getFileExtension(file.name))
  const assetKind = resolveLibraryAssetKind({ mimeType, name: file.name })
  if (assetKind === 'image') {
    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => reject(new Error('Failed to load image dimensions'))
      image.src = dataUrl
    }).catch(() => ({ width: 1200, height: 800 }))
    return {
      mimeType,
      name: file.name,
      dataBase64: toAssetBase64(dataUrl),
      intrinsicWidth: dimensions.width,
      intrinsicHeight: dimensions.height,
      durationSec: null,
    }
  }

  if (assetKind === 'video') {
    const dimensions = await new Promise<{ width: number; height: number; durationSec: number | null }>((resolve, reject) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () =>
        resolve({
          width: video.videoWidth || 1280,
          height: video.videoHeight || 720,
          durationSec:
            Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null,
        })
      video.onerror = () => reject(new Error('Failed to load video dimensions'))
      video.src = dataUrl
    }).catch(() => ({ width: 1280, height: 720, durationSec: null }))
    return {
      mimeType,
      name: file.name,
      dataBase64: toAssetBase64(dataUrl),
      intrinsicWidth: dimensions.width,
      intrinsicHeight: dimensions.height,
      durationSec: dimensions.durationSec,
    }
  }

  if (assetKind === 'audio') {
    const metadata = await new Promise<{ durationSec: number | null }>((resolve, reject) => {
      const audio = document.createElement('audio')
      audio.preload = 'metadata'
      audio.onloadedmetadata = () =>
        resolve({
          durationSec:
            Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null,
        })
      audio.onerror = () => reject(new Error('Failed to load audio metadata'))
      audio.src = dataUrl
    }).catch(() => ({ durationSec: null }))
    return {
      mimeType,
      name: file.name,
      dataBase64: toAssetBase64(dataUrl),
      intrinsicWidth: null,
      intrinsicHeight: null,
      durationSec: metadata.durationSec,
    }
  }

  return {
    mimeType,
    name: file.name,
    dataBase64: toAssetBase64(dataUrl),
    intrinsicWidth: null,
    intrinsicHeight: null,
    durationSec: null,
  }
}

export async function buildLibraryAsset(file: File, id: string): Promise<Asset> {
  const dataUrl = await readFileAsDataUrl(file)
  const metadata = await getLibraryAssetMetadata(file, dataUrl)
  return {
    id,
    ...metadata,
  }
}
