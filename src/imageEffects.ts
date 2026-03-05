import type { ImageData, ImageFilterPreset } from './model'

export const IMAGE_FILTER_OPTIONS: Array<{ preset: ImageFilterPreset; label: string }> = [
  { preset: 'none', label: 'None' },
  { preset: 'bw', label: 'B/W' },
  { preset: 'sepia', label: 'Sepia' },
  { preset: 'vibrant', label: 'Vibrant' },
  { preset: 'warm', label: 'Warm' },
  { preset: 'cool', label: 'Cool' },
  { preset: 'dramatic', label: 'Dramatic' },
]

export function resolveImageFilterCss(imageData: Pick<ImageData, 'effectsEnabled' | 'filterPreset'>): string {
  if (!imageData.effectsEnabled) {
    return 'none'
  }

  switch (imageData.filterPreset) {
    case 'bw':
      return 'grayscale(100%)'
    case 'sepia':
      return 'sepia(100%)'
    case 'vibrant':
      return 'saturate(180%) contrast(112%)'
    case 'warm':
      return 'sepia(22%) saturate(128%) hue-rotate(-12deg) brightness(103%)'
    case 'cool':
      return 'saturate(112%) hue-rotate(14deg) brightness(102%)'
    case 'dramatic':
      return 'contrast(140%) saturate(122%) brightness(94%)'
    case 'none':
    default:
      return 'none'
  }
}

