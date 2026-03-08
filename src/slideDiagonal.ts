export const DEFAULT_TARGET_FRAME_WIDTH = 1600
export const DEFAULT_TARGET_FRAME_HEIGHT = 900

export function getTargetFrameHalfDiagonal(width: number, height: number) {
    const safeWidth = Math.max(1, width)
    const safeHeight = Math.max(1, height)
    return Math.hypot(safeWidth, safeHeight) / 2
}

export function diagonalFromZoom(zoom: number, frameWidth: number, frameHeight: number) {
    const safeZoom = Math.max(0.0001, zoom)
    const halfDiagonal = getTargetFrameHalfDiagonal(frameWidth, frameHeight)
    return halfDiagonal / safeZoom
}

export function zoomFromDiagonal(diagonal: number, frameWidth: number, frameHeight: number) {
    const safeDiagonal = Math.max(0.0001, diagonal)
    const halfDiagonal = getTargetFrameHalfDiagonal(frameWidth, frameHeight)
    return halfDiagonal / safeDiagonal
}
