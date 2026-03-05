type ShadowStyleData = {
  shadowColor?: string
  shadowBlurPx?: number
  shadowAngleDeg?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function resolveObjectShadowCss(shadow: ShadowStyleData, scale = 1): string {
  const blurPx = clamp(Number.isFinite(shadow.shadowBlurPx) ? Number(shadow.shadowBlurPx) : 0, 0, 200)
  if (blurPx <= 0) {
    return 'none'
  }

  const angleDeg = clamp(
    Number.isFinite(shadow.shadowAngleDeg) ? Number(shadow.shadowAngleDeg) : 45,
    -180,
    180
  )
  const angleRad = (angleDeg * Math.PI) / 180
  const safeScale = Math.max(0.01, Number.isFinite(scale) ? Number(scale) : 1)
  const distancePx = 12 * safeScale
  const offsetX = Math.cos(angleRad) * distancePx
  const offsetY = Math.sin(angleRad) * distancePx
  const shadowBlur = blurPx * safeScale
  const color = shadow.shadowColor || '#000000'

  return `${offsetX.toFixed(2)}px ${offsetY.toFixed(2)}px ${shadowBlur.toFixed(2)}px ${color}`
}

export function resolveObjectDropShadowFilter(shadow: ShadowStyleData, scale = 1): string {
  const shadowCss = resolveObjectShadowCss(shadow, scale)
  if (shadowCss === 'none') {
    return 'none'
  }
  return `drop-shadow(${shadowCss})`
}
