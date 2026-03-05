export const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpg',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
])

export const SUPPORTED_IMAGE_ACCEPT = Array.from(SUPPORTED_IMAGE_TYPES).join(',')

export function isSupportedImageFile(file: File): boolean {
  return SUPPORTED_IMAGE_TYPES.has(file.type)
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Failed to read file'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('Failed to load image dimensions'))
    image.src = dataUrl
  })
}

export function toAssetBase64(dataUrl: string): string {
  const [, base64] = dataUrl.split(',', 2)
  return base64 ?? ''
}
