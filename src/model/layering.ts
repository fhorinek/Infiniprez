import type { CanvasObject } from './types'

export type LayerOrderAction = 'top' | 'up' | 'down' | 'bottom'

export type ZIndexSnapshot = Record<string, number>

interface OrderedEntry {
  id: string
  zIndex: number
  sourceIndex: number
}

function areArraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) {
    return false
  }

  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false
    }
  }

  return true
}

export function applyLayerOrder(ids: string[], selectedIds: Set<string>, action: LayerOrderAction) {
  if (ids.length <= 1 || selectedIds.size === 0) {
    return ids
  }

  if (action === 'top') {
    const moving = ids.filter((id) => selectedIds.has(id))
    const staying = ids.filter((id) => !selectedIds.has(id))
    return [...staying, ...moving]
  }

  if (action === 'bottom') {
    const moving = ids.filter((id) => selectedIds.has(id))
    const staying = ids.filter((id) => !selectedIds.has(id))
    return [...moving, ...staying]
  }

  const next = [...ids]

  if (action === 'up') {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      if (selectedIds.has(next[index]) && !selectedIds.has(next[index + 1])) {
        const tmp = next[index]
        next[index] = next[index + 1]
        next[index + 1] = tmp
      }
    }
    return next
  }

  for (let index = 1; index < next.length; index += 1) {
    if (selectedIds.has(next[index]) && !selectedIds.has(next[index - 1])) {
      const tmp = next[index]
      next[index] = next[index - 1]
      next[index - 1] = tmp
    }
  }

  return next
}

export function computeLayerZIndexSnapshots(
  objects: CanvasObject[],
  selectedObjectIds: string[],
  action: LayerOrderAction
): { before: ZIndexSnapshot; after: ZIndexSnapshot } {
  if (selectedObjectIds.length === 0) {
    return { before: {}, after: {} }
  }

  const byScope = new Map<string, OrderedEntry[]>()
  const selectedSet = new Set(selectedObjectIds)

  objects.forEach((object, sourceIndex) => {
    const scopeKey = object.parentGroupId ?? '__root__'
    const entry: OrderedEntry = {
      id: object.id,
      zIndex: object.zIndex,
      sourceIndex,
    }

    const list = byScope.get(scopeKey)
    if (list) {
      list.push(entry)
    } else {
      byScope.set(scopeKey, [entry])
    }
  })

  const before: ZIndexSnapshot = {}
  const after: ZIndexSnapshot = {}

  for (const scopeEntries of byScope.values()) {
    const ordered = [...scopeEntries].sort(
      (a, b) => a.zIndex - b.zIndex || a.sourceIndex - b.sourceIndex
    )
    const orderedIds = ordered.map((entry) => entry.id)
    const selectedInScope = orderedIds.filter((id) => selectedSet.has(id))
    if (selectedInScope.length === 0) {
      continue
    }

    const reorderedIds = applyLayerOrder(orderedIds, new Set(selectedInScope), action)
    if (areArraysEqual(orderedIds, reorderedIds)) {
      continue
    }

    const zSlots = ordered.map((entry) => entry.zIndex).sort((a, b) => a - b)
    const byId = new Map(ordered.map((entry) => [entry.id, entry]))

    for (let index = 0; index < reorderedIds.length; index += 1) {
      const id = reorderedIds[index]
      const original = byId.get(id)
      if (!original) {
        continue
      }

      const nextZIndex = zSlots[index]
      if (original.zIndex !== nextZIndex) {
        before[id] = original.zIndex
        after[id] = nextZIndex
      }
    }
  }

  return { before, after }
}

export function canReorderLayer(
  objects: CanvasObject[],
  selectedObjectIds: string[],
  action: LayerOrderAction
) {
  const snapshots = computeLayerZIndexSnapshots(objects, selectedObjectIds, action)
  return Object.keys(snapshots.after).length > 0
}
