import type { ShapeData, ShapeKind } from './model'

export interface ShapeKindOption {
  id: ShapeKind | 'circle'
  label: string
  clipPath?: string
}

export interface ShapeSvgDescriptor {
  kind: 'path' | 'ellipse'
  d?: string
  cx?: number
  cy?: number
  rx?: number
  ry?: number
}

export interface ShapeAdjustmentHandle {
  xPercent: number
  yPercent: number
  title: string
}

export const SHAPE_KIND_OPTIONS: ShapeKindOption[] = [
  { id: 'rect', label: 'Rectangle' },
  { id: 'roundedRect', label: 'Rounded Rectangle' },
  { id: 'diamond', label: 'Diamond', clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' },
  { id: 'triangle', label: 'Triangle', clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)' },
  { id: 'trapezoid', label: 'Trapezoid', clipPath: 'polygon(18% 0%, 82% 0%, 100% 100%, 0% 100%)' },
  {
    id: 'parallelogram',
    label: 'Parallelogram',
    clipPath: 'polygon(20% 0%, 100% 0%, 80% 100%, 0% 100%)',
  },
  {
    id: 'hexagon',
    label: 'Hexagon',
    clipPath: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
  },
  {
    id: 'pentagon',
    label: 'Pentagon',
    clipPath: 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)',
  },
  {
    id: 'octagon',
    label: 'Octagon',
    clipPath: 'polygon(28% 0%, 72% 0%, 100% 28%, 100% 72%, 72% 100%, 28% 100%, 0% 72%, 0% 28%)',
  },
  {
    id: 'star',
    label: 'Star',
    clipPath:
      'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
  },
  {
    id: 'cloud',
    label: 'Cloud',
    clipPath:
      'polygon(17% 69%, 9% 58%, 10% 44%, 18% 34%, 31% 31%, 38% 18%, 51% 12%, 64% 17%, 72% 27%, 85% 28%, 94% 38%, 95% 52%, 89% 63%, 78% 69%, 67% 70%, 57% 76%, 44% 77%, 34% 72%, 24% 73%)',
  },
  { id: 'circle', label: 'Circle' },
]

const SHAPE_KIND_SET = new Set<ShapeKind>([
  'rect',
  'roundedRect',
  'diamond',
  'triangle',
  'trapezoid',
  'parallelogram',
  'hexagon',
  'pentagon',
  'octagon',
  'star',
  'cloud',
])

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function toPointPath(points: Array<{ x: number; y: number }>) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ') + ' Z'
}

function toSmoothClosedPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) {
    return ''
  }
  let path = `M ${points[0].x} ${points[0].y}`
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    const midX = (current.x + next.x) / 2
    const midY = (current.y + next.y) / 2
    path += ` Q ${current.x} ${current.y} ${midX} ${midY}`
  }
  return `${path} Z`
}

function getRoundedRectPath(width: number, height: number, radius: number) {
  const safeRadius = clamp(radius, 0, Math.min(width, height) / 2)
  if (safeRadius <= 0.001) {
    return `M 0 0 H ${width} V ${height} H 0 Z`
  }
  return [
    `M ${safeRadius} 0`,
    `H ${width - safeRadius}`,
    `A ${safeRadius} ${safeRadius} 0 0 1 ${width} ${safeRadius}`,
    `V ${height - safeRadius}`,
    `A ${safeRadius} ${safeRadius} 0 0 1 ${width - safeRadius} ${height}`,
    `H ${safeRadius}`,
    `A ${safeRadius} ${safeRadius} 0 0 1 0 ${height - safeRadius}`,
    `V ${safeRadius}`,
    `A ${safeRadius} ${safeRadius} 0 0 1 ${safeRadius} 0`,
    'Z',
  ].join(' ')
}

function getStarPath(width: number, height: number, innerRatio: number) {
  const centerX = width / 2
  const centerY = height / 2
  const outerRadius = Math.min(width, height) / 2
  const innerRadius = outerRadius * innerRatio
  const points = Array.from({ length: 10 }, (_, index) => {
    const isOuter = index % 2 === 0
    const angle = -Math.PI / 2 + (index * Math.PI) / 5
    const radius = isOuter ? outerRadius : innerRadius
    return {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    }
  })
  return toPointPath(points)
}

function getCloudPath(width: number, height: number, topPercent: number) {
  const topY = clamp(height * (topPercent / 100), height * 0.04, height * 0.38)
  const points = [
    { x: width * 0.16, y: height * 0.72 },
    { x: width * 0.08, y: height * 0.59 },
    { x: width * 0.09, y: height * 0.44 },
    { x: width * 0.18, y: height * 0.34 },
    { x: width * 0.31, y: height * 0.32 },
    { x: width * 0.38, y: topY + height * 0.08 },
    { x: width * 0.5, y: topY },
    { x: width * 0.63, y: topY + height * 0.05 },
    { x: width * 0.73, y: height * 0.27 },
    { x: width * 0.86, y: height * 0.3 },
    { x: width * 0.95, y: height * 0.42 },
    { x: width * 0.94, y: height * 0.57 },
    { x: width * 0.84, y: height * 0.68 },
    { x: width * 0.69, y: height * 0.71 },
    { x: width * 0.56, y: height * 0.8 },
    { x: width * 0.42, y: height * 0.79 },
    { x: width * 0.31, y: height * 0.72 },
    { x: width * 0.22, y: height * 0.74 },
  ]
  return toSmoothClosedPath(points)
}

export function normalizeShapeKind(value: unknown): ShapeKind {
  return typeof value === 'string' && SHAPE_KIND_SET.has(value as ShapeKind)
    ? (value as ShapeKind)
    : 'rect'
}

export function getShapeClipPath(kind: ShapeKind): string | null {
  return SHAPE_KIND_OPTIONS.find((option) => option.id === kind)?.clipPath ?? null
}

export function shapeSupportsRadius(kind: ShapeKind): boolean {
  return kind === 'rect' || kind === 'roundedRect'
}

export function shapeSupportsAdjustmentHandle(kind: ShapeKind): boolean {
  return (
    kind === 'roundedRect' ||
    kind === 'trapezoid' ||
    kind === 'parallelogram' ||
    kind === 'hexagon' ||
    kind === 'pentagon' ||
    kind === 'octagon' ||
    kind === 'star' ||
    kind === 'cloud'
  )
}

export function getDefaultShapeAdjustment(kind: ShapeKind): number {
  switch (kind) {
    case 'trapezoid':
      return 18
    case 'parallelogram':
      return 20
    case 'hexagon':
      return 25
    case 'pentagon':
      return 38
    case 'octagon':
      return 28
    case 'star':
      return 45
    case 'cloud':
      return 12
    default:
      return 50
  }
}

export function clampShapeAdjustment(kind: ShapeKind, value: number): number {
  switch (kind) {
    case 'trapezoid':
    case 'parallelogram':
    case 'hexagon':
      return clamp(value, 0, 40)
    case 'pentagon':
      return clamp(value, 20, 70)
    case 'octagon':
      return clamp(value, 10, 35)
    case 'star':
      return clamp(value, 15, 80)
    case 'cloud':
      return clamp(value, 6, 28)
    default:
      return clamp(value, 0, 100)
  }
}

export function getShapeBorderRadius(kind: ShapeKind, radiusPx: number): string {
  if (!shapeSupportsRadius(kind)) {
    return '0px'
  }
  return `${Math.max(0, radiusPx)}px`
}

export function getShapeSvgDescriptor(
  shapeType: 'shape_rect' | 'shape_circle',
  shapeData: ShapeData,
  width: number,
  height: number
): ShapeSvgDescriptor {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  if (shapeType === 'shape_circle') {
    return {
      kind: 'ellipse',
      cx: safeWidth / 2,
      cy: safeHeight / 2,
      rx: safeWidth / 2,
      ry: safeHeight / 2,
    }
  }

  const kind = normalizeShapeKind(shapeData.kind)
  const adjustment = clampShapeAdjustment(kind, shapeData.adjustmentPercent)
  switch (kind) {
    case 'rect':
      return { kind: 'path', d: getRoundedRectPath(safeWidth, safeHeight, 0) }
    case 'roundedRect':
      return {
        kind: 'path',
        d: getRoundedRectPath(safeWidth, safeHeight, Math.max(0, shapeData.radius)),
      }
    case 'diamond':
      return {
        kind: 'path',
        d: toPointPath([
          { x: safeWidth / 2, y: 0 },
          { x: safeWidth, y: safeHeight / 2 },
          { x: safeWidth / 2, y: safeHeight },
          { x: 0, y: safeHeight / 2 },
        ]),
      }
    case 'triangle':
      return {
        kind: 'path',
        d: toPointPath([
          { x: safeWidth / 2, y: 0 },
          { x: safeWidth, y: safeHeight },
          { x: 0, y: safeHeight },
        ]),
      }
    case 'trapezoid': {
      const inset = (safeWidth * adjustment) / 100
      return {
        kind: 'path',
        d: toPointPath([
          { x: inset, y: 0 },
          { x: safeWidth - inset, y: 0 },
          { x: safeWidth, y: safeHeight },
          { x: 0, y: safeHeight },
        ]),
      }
    }
    case 'parallelogram': {
      const skew = (safeWidth * adjustment) / 100
      return {
        kind: 'path',
        d: toPointPath([
          { x: skew, y: 0 },
          { x: safeWidth, y: 0 },
          { x: safeWidth - skew, y: safeHeight },
          { x: 0, y: safeHeight },
        ]),
      }
    }
    case 'hexagon': {
      const inset = (safeWidth * adjustment) / 100
      return {
        kind: 'path',
        d: toPointPath([
          { x: inset, y: 0 },
          { x: safeWidth - inset, y: 0 },
          { x: safeWidth, y: safeHeight / 2 },
          { x: safeWidth - inset, y: safeHeight },
          { x: inset, y: safeHeight },
          { x: 0, y: safeHeight / 2 },
        ]),
      }
    }
    case 'pentagon': {
      const shoulderY = (safeHeight * adjustment) / 100
      return {
        kind: 'path',
        d: toPointPath([
          { x: safeWidth / 2, y: 0 },
          { x: safeWidth, y: shoulderY },
          { x: safeWidth * 0.82, y: safeHeight },
          { x: safeWidth * 0.18, y: safeHeight },
          { x: 0, y: shoulderY },
        ]),
      }
    }
    case 'octagon': {
      const inset = (Math.min(safeWidth, safeHeight) * adjustment) / 100
      return {
        kind: 'path',
        d: toPointPath([
          { x: inset, y: 0 },
          { x: safeWidth - inset, y: 0 },
          { x: safeWidth, y: inset },
          { x: safeWidth, y: safeHeight - inset },
          { x: safeWidth - inset, y: safeHeight },
          { x: inset, y: safeHeight },
          { x: 0, y: safeHeight - inset },
          { x: 0, y: inset },
        ]),
      }
    }
    case 'star':
      return {
        kind: 'path',
        d: getStarPath(safeWidth, safeHeight, adjustment / 100),
      }
    case 'cloud':
      return {
        kind: 'path',
        d: getCloudPath(safeWidth, safeHeight, adjustment),
      }
    default:
      return { kind: 'path', d: getRoundedRectPath(safeWidth, safeHeight, 0) }
  }
}

export function getShapeAdjustmentHandle(
  shapeType: 'shape_rect' | 'shape_circle',
  shapeData: ShapeData,
  width: number,
  _height: number
): ShapeAdjustmentHandle | null {
  if (shapeType === 'shape_circle') {
    return null
  }
  const kind = normalizeShapeKind(shapeData.kind)
  if (!shapeSupportsAdjustmentHandle(kind)) {
    return null
  }

  const safeWidth = Math.max(1, width)
  const adjustment = clampShapeAdjustment(kind, shapeData.adjustmentPercent)

  switch (kind) {
    case 'roundedRect':
      return {
        xPercent: clamp((Math.max(0, shapeData.radius) / safeWidth) * 100, 0, 50),
        yPercent: 0,
        title: 'Adjust rounded corner',
      }
    case 'trapezoid':
      return {
        xPercent: adjustment,
        yPercent: 0,
        title: 'Adjust top edge',
      }
    case 'parallelogram':
      return {
        xPercent: adjustment,
        yPercent: 0,
        title: 'Adjust skew',
      }
    case 'hexagon':
      return {
        xPercent: adjustment,
        yPercent: 0,
        title: 'Adjust side inset',
      }
    case 'pentagon':
      return {
        xPercent: 50,
        yPercent: adjustment,
        title: 'Adjust top edges',
      }
    case 'octagon':
      return {
        xPercent: adjustment,
        yPercent: 0,
        title: 'Adjust corner cut',
      }
    case 'star':
      return {
        xPercent: 50,
        yPercent: clamp(50 - adjustment / 2, 8, 42),
        title: 'Adjust inner points',
      }
    case 'cloud':
      return {
        xPercent: 50,
        yPercent: adjustment,
        title: 'Adjust cloud top',
      }
    default:
      return null
  }
}

export function resolveShapeAdjustmentFromLocalPoint(
  shapeType: 'shape_rect' | 'shape_circle',
  shapeData: ShapeData,
  width: number,
  height: number,
  localX: number,
  localY: number
): Partial<ShapeData> | null {
  if (shapeType === 'shape_circle') {
    return null
  }

  const kind = normalizeShapeKind(shapeData.kind)
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const clampedX = clamp(localX, 0, safeWidth)
  const clampedY = clamp(localY, 0, safeHeight)

  switch (kind) {
    case 'roundedRect':
      return {
        radius: clamp(clampedX, 0, Math.min(safeWidth, safeHeight) / 2),
      }
    case 'trapezoid':
      return { adjustmentPercent: clampShapeAdjustment(kind, (Math.min(clampedX, safeWidth - clampedX) / safeWidth) * 100) }
    case 'parallelogram':
      return { adjustmentPercent: clampShapeAdjustment(kind, (clampedX / safeWidth) * 100) }
    case 'hexagon':
      return { adjustmentPercent: clampShapeAdjustment(kind, (Math.min(clampedX, safeWidth - clampedX) / safeWidth) * 100) }
    case 'pentagon':
      return { adjustmentPercent: clampShapeAdjustment(kind, (clampedY / safeHeight) * 100) }
    case 'octagon':
      return {
        adjustmentPercent: clampShapeAdjustment(
          kind,
          (Math.min(clampedX, safeWidth - clampedX, clampedY, safeHeight - clampedY) /
            Math.min(safeWidth, safeHeight)) *
            100
        ),
      }
    case 'star': {
      const centerY = safeHeight / 2
      const outerRadius = Math.min(safeWidth, safeHeight) / 2
      const innerRadius = clamp(centerY - clampedY, outerRadius * 0.15, outerRadius * 0.8)
      return { adjustmentPercent: clampShapeAdjustment(kind, (innerRadius / outerRadius) * 100) }
    }
    case 'cloud':
      return { adjustmentPercent: clampShapeAdjustment(kind, (clampedY / safeHeight) * 100) }
    default:
      return null
  }
}
