export interface AlignmentRect {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface AlignmentUnit {
  id: string
  bounds: AlignmentRect
}

export interface AlignmentDelta {
  id: string
  x: number
  y: number
}

export type AlignmentAction =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'center-horizontal'
  | 'center-vertical'
  | 'center'
  | 'distribute-horizontal'
  | 'distribute-vertical'

function getRectWidth(rect: AlignmentRect) {
  return rect.maxX - rect.minX
}

function getRectHeight(rect: AlignmentRect) {
  return rect.maxY - rect.minY
}

function getRectCenter(rect: AlignmentRect) {
  return {
    x: (rect.minX + rect.maxX) / 2,
    y: (rect.minY + rect.maxY) / 2,
  }
}

export function getAlignmentBounds(units: AlignmentUnit[]): AlignmentRect | null {
  if (units.length === 0) {
    return null
  }

  const [first, ...rest] = units
  const bounds = { ...first.bounds }

  for (const unit of rest) {
    bounds.minX = Math.min(bounds.minX, unit.bounds.minX)
    bounds.minY = Math.min(bounds.minY, unit.bounds.minY)
    bounds.maxX = Math.max(bounds.maxX, unit.bounds.maxX)
    bounds.maxY = Math.max(bounds.maxY, unit.bounds.maxY)
  }

  return bounds
}

export function getAlignmentDeltas(units: AlignmentUnit[], action: AlignmentAction): AlignmentDelta[] {
  if (units.length < 2) {
    return []
  }

  const bounds = getAlignmentBounds(units)
  if (!bounds) {
    return []
  }

  const boundsCenter = getRectCenter(bounds)

  if (action === 'left') {
    return units.map((unit) => ({
      id: unit.id,
      x: bounds.minX - unit.bounds.minX,
      y: 0,
    }))
  }

  if (action === 'right') {
    return units.map((unit) => ({
      id: unit.id,
      x: bounds.maxX - unit.bounds.maxX,
      y: 0,
    }))
  }

  if (action === 'top') {
    return units.map((unit) => ({
      id: unit.id,
      x: 0,
      y: bounds.minY - unit.bounds.minY,
    }))
  }

  if (action === 'bottom') {
    return units.map((unit) => ({
      id: unit.id,
      x: 0,
      y: bounds.maxY - unit.bounds.maxY,
    }))
  }

  if (action === 'center-horizontal') {
    return units.map((unit) => {
      const unitCenter = getRectCenter(unit.bounds)
      return {
        id: unit.id,
        x: boundsCenter.x - unitCenter.x,
        y: 0,
      }
    })
  }

  if (action === 'center-vertical') {
    return units.map((unit) => {
      const unitCenter = getRectCenter(unit.bounds)
      return {
        id: unit.id,
        x: 0,
        y: boundsCenter.y - unitCenter.y,
      }
    })
  }

  if (action === 'center') {
    return units.map((unit) => {
      const unitCenter = getRectCenter(unit.bounds)
      return {
        id: unit.id,
        x: boundsCenter.x - unitCenter.x,
        y: boundsCenter.y - unitCenter.y,
      }
    })
  }

  if (action === 'distribute-horizontal') {
    if (units.length < 3) {
      return []
    }

    const ordered = [...units].sort((a, b) => {
      if (a.bounds.minX !== b.bounds.minX) {
        return a.bounds.minX - b.bounds.minX
      }
      return getRectCenter(a.bounds).x - getRectCenter(b.bounds).x
    })
    const totalWidth = ordered.reduce((sum, unit) => sum + getRectWidth(unit.bounds), 0)
    const gap = (bounds.maxX - bounds.minX - totalWidth) / Math.max(1, ordered.length - 1)
    let cursor = bounds.minX

    return ordered.map((unit) => {
      const delta = {
        id: unit.id,
        x: cursor - unit.bounds.minX,
        y: 0,
      }
      cursor += getRectWidth(unit.bounds) + gap
      return delta
    })
  }

  if (units.length < 3) {
    return []
  }

  const ordered = [...units].sort((a, b) => {
    if (a.bounds.minY !== b.bounds.minY) {
      return a.bounds.minY - b.bounds.minY
    }
    return getRectCenter(a.bounds).y - getRectCenter(b.bounds).y
  })
  const totalHeight = ordered.reduce((sum, unit) => sum + getRectHeight(unit.bounds), 0)
  const gap = (bounds.maxY - bounds.minY - totalHeight) / Math.max(1, ordered.length - 1)
  let cursor = bounds.minY

  return ordered.map((unit) => {
    const delta = {
      id: unit.id,
      x: 0,
      y: cursor - unit.bounds.minY,
    }
    cursor += getRectHeight(unit.bounds) + gap
    return delta
  })
}
