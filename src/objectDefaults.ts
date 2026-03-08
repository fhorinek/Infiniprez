import type { CanvasObject, ImageData, SoundData, VideoData } from './model'

const MIN_OBJECT_SCALE_PERCENT = 1
const MAX_OBJECT_SCALE_PERCENT = 10000
const MIN_PLACEMENT_ZOOM = 0.001

function clampObjectScalePercent(value: number) {
  if (!Number.isFinite(value)) {
    return 100
  }
  return Math.max(MIN_OBJECT_SCALE_PERCENT, Math.min(MAX_OBJECT_SCALE_PERCENT, Math.round(value)))
}

export function getZoomAdjustedObjectScalePercent(zoom: number) {
  return clampObjectScalePercent(100 / Math.max(0.0001, zoom))
}

export function resolveObjectBorderScale(scalePercent: number) {
  return clampObjectScalePercent(scalePercent) / 100
}

export function isObjectAspectRatioLocked(object: CanvasObject | null | undefined) {
  if (!object) {
    return false
  }
  if (object.type === 'shape_circle') {
    return true
  }
  return object.keepAspectRatio
}

export function createDefaultImageData(
  assetId: string,
  intrinsicWidth: number,
  intrinsicHeight: number,
  borderColor = '#b2c6ee'
): ImageData {
  return {
    assetId,
    intrinsicWidth,
    intrinsicHeight,
    borderColor,
    borderType: 'solid',
    borderWidth: 0,
    radius: 0,
    opacityPercent: 100,
    cropEnabled: false,
    cropLeftPercent: 0,
    cropTopPercent: 0,
    cropRightPercent: 0,
    cropBottomPercent: 0,
    effectsEnabled: false,
    filterPreset: 'none',
    shadowColor: '#000000',
    shadowBlurPx: 0,
    shadowAngleDeg: 45,
  }
}

export function createDefaultVideoData(
  assetId: string,
  intrinsicWidth: number,
  intrinsicHeight: number,
  borderColor = '#b2c6ee'
): VideoData {
  return {
    assetId,
    intrinsicWidth,
    intrinsicHeight,
    borderColor,
    borderType: 'solid',
    borderWidth: 0,
    radius: 0,
    opacityPercent: 100,
    autoplay: false,
    loop: true,
    muted: true,
    shadowColor: '#000000',
    shadowBlurPx: 0,
    shadowAngleDeg: 45,
  }
}

export function createDefaultSoundData(
  assetId: string,
  borderColor = '#b2c6ee',
  radius = 18
): SoundData {
  return {
    assetId,
    borderColor,
    borderType: 'solid',
    borderWidth: 0,
    radius: Math.max(0, radius),
    opacityPercent: 100,
    loop: false,
    shadowColor: '#000000',
    shadowBlurPx: 0,
    shadowAngleDeg: 45,
  }
}

export function getDefaultPlacedMediaSize(
  kind: 'image' | 'video' | 'sound',
  intrinsicWidth: number,
  intrinsicHeight: number,
  zoom: number
) {
  const safeZoom = Math.max(zoom, MIN_PLACEMENT_ZOOM)
  if (kind === 'sound') {
    return {
      w: 220 / safeZoom,
      h: 56 / safeZoom,
    }
  }

  const aspectRatio = Math.max(0.0001, intrinsicWidth / Math.max(1, intrinsicHeight))
  if (kind === 'video') {
    const width = 320 / safeZoom
    return {
      w: width,
      h: Math.max(60 / safeZoom, width / aspectRatio),
    }
  }

  const width = 260 / safeZoom
  return {
    w: width,
    h: Math.max(40 / safeZoom, width / aspectRatio),
  }
}
