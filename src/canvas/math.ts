import type { CameraState } from '../store/types'

export interface Point {
  x: number
  y: number
}

export interface ViewportSize {
  width: number
  height: number
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function rotatePoint(point: Point, radians: number): Point {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }
}

export function worldToScreen(world: Point, camera: CameraState, viewport: ViewportSize): Point {
  const translated = {
    x: (world.x - camera.x) * camera.zoom,
    y: (world.y - camera.y) * camera.zoom,
  }
  const rotated = rotatePoint(translated, camera.rotation)
  return {
    x: rotated.x + viewport.width / 2,
    y: rotated.y + viewport.height / 2,
  }
}

export function screenToWorld(screen: Point, camera: CameraState, viewport: ViewportSize): Point {
  const centered = {
    x: screen.x - viewport.width / 2,
    y: screen.y - viewport.height / 2,
  }
  const unrotated = rotatePoint(centered, -camera.rotation)
  return {
    x: unrotated.x / camera.zoom + camera.x,
    y: unrotated.y / camera.zoom + camera.y,
  }
}

export function cameraDragDeltaToWorld(deltaScreen: Point, camera: CameraState): Point {
  const unrotated = rotatePoint(deltaScreen, -camera.rotation)
  return {
    x: unrotated.x / camera.zoom,
    y: unrotated.y / camera.zoom,
  }
}

export function getDynamicGridStep(baseGridSize: number, zoom: number): number {
  const exponent = Math.floor(Math.log10(zoom || 1))
  return baseGridSize / 10 ** exponent
}

export function getViewWorldBounds(camera: CameraState, viewport: ViewportSize) {
  const corners = [
    screenToWorld({ x: 0, y: 0 }, camera, viewport),
    screenToWorld({ x: viewport.width, y: 0 }, camera, viewport),
    screenToWorld({ x: viewport.width, y: viewport.height }, camera, viewport),
    screenToWorld({ x: 0, y: viewport.height }, camera, viewport),
  ]

  return {
    minX: Math.min(...corners.map((entry) => entry.x)),
    maxX: Math.max(...corners.map((entry) => entry.x)),
    minY: Math.min(...corners.map((entry) => entry.y)),
    maxY: Math.max(...corners.map((entry) => entry.y)),
  }
}
