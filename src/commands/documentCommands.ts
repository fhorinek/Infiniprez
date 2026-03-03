import { produce } from 'immer'
import type { Command } from './types'
import type { CanvasObject, DocumentModel, LayerOrderAction, Slide, ZIndexSnapshot } from '../model'

type TransformSnapshot = Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'rotation'>
type SlideOrderSnapshot = Record<string, number>

function withUpdatedTimestamp(document: DocumentModel): DocumentModel {
  return produce(document, (draft) => {
    draft.meta.updatedAt = new Date().toISOString()
  })
}

function sortSlidesByOrderIndex(slides: Slide[]) {
  return [...slides].sort((a, b) => a.orderIndex - b.orderIndex)
}

export function createObjectCommand(object: CanvasObject): Command<DocumentModel> {
  return {
    label: 'Create object',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const exists = draft.objects.some((entry) => entry.id === object.id)
          if (!exists) {
            draft.objects.push(object)
          }
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          draft.objects = draft.objects.filter((entry) => entry.id !== object.id)
        })
      ),
  }
}

export function createAssetCommand(asset: DocumentModel['assets'][number]): Command<DocumentModel> {
  return {
    label: 'Create asset',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const exists = draft.assets.some((entry) => entry.id === asset.id)
          if (!exists) {
            draft.assets.push(asset)
          }
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          draft.assets = draft.assets.filter((entry) => entry.id !== asset.id)
        })
      ),
  }
}

export function deleteObjectsCommand(
  objectIds: string[],
  removed: Array<{ object: CanvasObject; index: number }>
): Command<DocumentModel> {
  return {
    label: 'Delete objects',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          draft.objects = draft.objects.filter((entry) => !objectIds.includes(entry.id))
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const rebuilt = [...draft.objects]
          const sorted = [...removed].sort((a, b) => a.index - b.index)

          for (const entry of sorted) {
            rebuilt.splice(entry.index, 0, entry.object)
          }

          draft.objects = rebuilt
        })
      ),
  }
}

export function moveObjectCommand(
  objectId: string,
  before: TransformSnapshot,
  after: TransformSnapshot
): Command<DocumentModel> {
  return {
    label: 'Move object',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (!target) {
            return
          }
          target.x = after.x
          target.y = after.y
          target.w = after.w
          target.h = after.h
          target.rotation = after.rotation
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (!target) {
            return
          }
          target.x = before.x
          target.y = before.y
          target.w = before.w
          target.h = before.h
          target.rotation = before.rotation
        })
      ),
  }
}

export function createSlideCommand(slide: Slide): Command<DocumentModel> {
  return {
    label: 'Create slide',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const exists = draft.slides.some((entry) => entry.id === slide.id)
          if (!exists) {
            draft.slides = sortSlidesByOrderIndex([...draft.slides, slide])
          }
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          draft.slides = draft.slides.filter((entry) => entry.id !== slide.id)
        })
      ),
  }
}

export function deleteSlideCommand(
  slideId: string,
  removedSlide: Slide,
  removedIndex: number
): Command<DocumentModel> {
  return {
    label: 'Delete slide',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          draft.slides = draft.slides.filter((entry) => entry.id !== slideId)
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const rebuiltSlides = [...draft.slides]
          rebuiltSlides.splice(removedIndex, 0, removedSlide)
          draft.slides = sortSlidesByOrderIndex(rebuiltSlides)
        })
      ),
  }
}

function applySlideOrderSnapshot(draft: DocumentModel, snapshot: SlideOrderSnapshot) {
  if (Object.keys(snapshot).length === 0) {
    return
  }

  for (const slide of draft.slides) {
    const next = snapshot[slide.id]
    if (next !== undefined) {
      slide.orderIndex = next
    }
  }

  draft.slides = sortSlidesByOrderIndex(draft.slides)
}

export function setSlideOrderCommand(
  beforeSnapshot: SlideOrderSnapshot,
  afterSnapshot: SlideOrderSnapshot
): Command<DocumentModel> {
  return {
    label: 'Reorder slides',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          applySlideOrderSnapshot(draft, afterSnapshot)
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          applySlideOrderSnapshot(draft, beforeSnapshot)
        })
      ),
  }
}

export function setObjectLockCommand(
  objectId: string,
  beforeLocked: boolean,
  afterLocked: boolean
): Command<DocumentModel> {
  return {
    label: afterLocked ? 'Lock object' : 'Unlock object',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (!target) {
            return
          }
          target.locked = afterLocked
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (!target) {
            return
          }
          target.locked = beforeLocked
        })
      ),
  }
}

export function setShapeOpacityCommand(
  objectId: string,
  beforeOpacityPercent: number,
  afterOpacityPercent: number
): Command<DocumentModel> {
  return {
    label: 'Set shape opacity',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (
            !target ||
            (target.type !== 'shape_rect' &&
              target.type !== 'shape_circle' &&
              target.type !== 'shape_arrow')
          ) {
            return
          }
          target.shapeData.opacityPercent = afterOpacityPercent
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (
            !target ||
            (target.type !== 'shape_rect' &&
              target.type !== 'shape_circle' &&
              target.type !== 'shape_arrow')
          ) {
            return
          }
          target.shapeData.opacityPercent = beforeOpacityPercent
        })
      ),
  }
}

export function groupObjectsCommand(
  groupObject: CanvasObject,
  childParentBefore: Record<string, string | null>
): Command<DocumentModel> {
  return {
    label: 'Group objects',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const hasGroup = draft.objects.some((entry) => entry.id === groupObject.id)
          if (!hasGroup) {
            draft.objects.push(groupObject)
          }

          for (const object of draft.objects) {
            if (childParentBefore[object.id] !== undefined) {
              object.parentGroupId = groupObject.id
            }
          }
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          draft.objects = draft.objects.filter((entry) => entry.id !== groupObject.id)

          for (const object of draft.objects) {
            const beforeParent = childParentBefore[object.id]
            if (beforeParent !== undefined) {
              object.parentGroupId = beforeParent
            }
          }
        })
      ),
  }
}

export function ungroupObjectCommand(
  groupObject: CanvasObject,
  childParentBefore: Record<string, string | null>
): Command<DocumentModel> {
  return {
    label: 'Ungroup objects',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          draft.objects = draft.objects.filter((entry) => entry.id !== groupObject.id)

          for (const object of draft.objects) {
            if (childParentBefore[object.id] !== undefined) {
              object.parentGroupId = null
            }
          }
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const hasGroup = draft.objects.some((entry) => entry.id === groupObject.id)
          if (!hasGroup) {
            draft.objects.push(groupObject)
          }

          for (const object of draft.objects) {
            const beforeParent = childParentBefore[object.id]
            if (beforeParent !== undefined) {
              object.parentGroupId = beforeParent
            }
          }
        })
      ),
  }
}

const LAYER_ACTION_LABEL: Record<LayerOrderAction, string> = {
  top: 'Bring to front',
  up: 'Bring forward',
  down: 'Send backward',
  bottom: 'Send to back',
}

function applyZIndexSnapshot(draft: DocumentModel, snapshot: ZIndexSnapshot) {
  if (Object.keys(snapshot).length === 0) {
    return
  }

  for (const object of draft.objects) {
    const next = snapshot[object.id]
    if (next !== undefined) {
      object.zIndex = next
    }
  }
}

export function setObjectZIndexCommand(
  action: LayerOrderAction,
  beforeSnapshot: ZIndexSnapshot,
  afterSnapshot: ZIndexSnapshot
): Command<DocumentModel> {
  return {
    label: LAYER_ACTION_LABEL[action],
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          applyZIndexSnapshot(draft, afterSnapshot)
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          applyZIndexSnapshot(draft, beforeSnapshot)
        })
      ),
  }
}
