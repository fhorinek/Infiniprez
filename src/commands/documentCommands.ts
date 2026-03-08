import { produce } from 'immer'
import type { Command } from './types'
import type {
  CanvasSettings,
  CanvasObject,
  DocumentModel,
  ImageData,
  LayerOrderAction,
  ShapeData,
  Slide,
  SoundData,
  TextboxData,
  VideoData,
  ZIndexSnapshot,
} from '../model'

type TransformSnapshot = Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'rotation' | 'scalePercent'>
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
          const exists = draft.assets.some(
            (entry) => entry.id === asset.id || entry.dataBase64 === asset.dataBase64
          )
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

export function deleteAssetCommand(
  assetId: string,
  removed: { asset: DocumentModel['assets'][number]; index: number }
): Command<DocumentModel> {
  return {
    label: 'Delete asset',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          draft.assets = draft.assets.filter((entry) => entry.id !== assetId)
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const rebuilt = [...draft.assets]
          rebuilt.splice(removed.index, 0, removed.asset)
          draft.assets = rebuilt
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
          target.scalePercent = after.scalePercent
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
          target.scalePercent = before.scalePercent
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

export function updateSlideCommand(
  slideId: string,
  before: Slide,
  after: Slide
): Command<DocumentModel> {
  return {
    label: 'Update slide',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.slides.find((entry) => entry.id === slideId)
          if (!target) {
            return
          }

          Object.assign(target, after)
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.slides.find((entry) => entry.id === slideId)
          if (!target) {
            return
          }

          Object.assign(target, before)
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

export function setObjectKeepAspectRatioCommand(
  objectId: string,
  beforeLocked: boolean,
  afterLocked: boolean
): Command<DocumentModel> {
  return {
    label: afterLocked ? 'Lock aspect ratio' : 'Unlock aspect ratio',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (!target) {
            return
          }
          target.keepAspectRatio = afterLocked
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (!target) {
            return
          }
          target.keepAspectRatio = beforeLocked
        })
      ),
  }
}

export function setCanvasBackgroundCommand(
  beforeBackground: string,
  afterBackground: string
): Command<DocumentModel> {
  return {
    label: 'Set canvas background',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          draft.canvas.background = afterBackground
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          draft.canvas.background = beforeBackground
        })
      ),
  }
}

export function setCanvasSettingsCommand(
  beforeCanvas: CanvasSettings,
  afterCanvas: CanvasSettings
): Command<DocumentModel> {
  return {
    label: 'Update canvas settings',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          draft.canvas = { ...afterCanvas }
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          draft.canvas = { ...beforeCanvas }
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
          if (!target || (target.type !== 'shape_rect' && target.type !== 'shape_circle')) {
            return
          }
          target.shapeData.opacityPercent = afterOpacityPercent
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (!target || (target.type !== 'shape_rect' && target.type !== 'shape_circle')) {
            return
          }
          target.shapeData.opacityPercent = beforeOpacityPercent
        })
      ),
  }
}

export function setShapeDataCommand(
  objectId: string,
  beforeShapeData: ShapeData,
  afterShapeData: ShapeData
): Command<DocumentModel> {
  return {
    label: 'Update shape style',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (!target || (target.type !== 'shape_rect' && target.type !== 'shape_circle')) {
            return
          }
          target.shapeData = afterShapeData
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (!target || (target.type !== 'shape_rect' && target.type !== 'shape_circle')) {
            return
          }
          target.shapeData = beforeShapeData
        })
      ),
  }
}

export function setTextboxDataCommand(
  objectId: string,
  beforeTextboxData: TextboxData,
  afterTextboxData: TextboxData
): Command<DocumentModel> {
  return {
    label: 'Update textbox',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (!target || target.type !== 'textbox') {
            return
          }
          target.textboxData = afterTextboxData
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (!target || target.type !== 'textbox') {
            return
          }
          target.textboxData = beforeTextboxData
        })
      ),
  }
}

export function setImageDataCommand(
  objectId: string,
  beforeImageData: ImageData,
  afterImageData: ImageData
): Command<DocumentModel> {
  return {
    label: 'Update image',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (!target || target.type !== 'image') {
            return
          }
          target.imageData = afterImageData
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (!target || target.type !== 'image') {
            return
          }
          target.imageData = beforeImageData
        })
      ),
  }
}

export function setVideoDataCommand(
  objectId: string,
  beforeVideoData: VideoData,
  afterVideoData: VideoData
): Command<DocumentModel> {
  return {
    label: 'Update video',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (!target || target.type !== 'video') {
            return
          }
          target.videoData = afterVideoData
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (!target || target.type !== 'video') {
            return
          }
          target.videoData = beforeVideoData
        })
      ),
  }
}

export function setSoundDataCommand(
  objectId: string,
  beforeSoundData: SoundData,
  afterSoundData: SoundData
): Command<DocumentModel> {
  return {
    label: 'Update sound',
    execute: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (!target || target.type !== 'sound') {
            return
          }
          target.soundData = afterSoundData
        })
      ),
    undo: (state) =>
      withUpdatedTimestamp(
        produce(state, (draft) => {
          const target = draft.objects.find((entry) => entry.id === objectId)
          if (!target || target.type !== 'sound') {
            return
          }
          target.soundData = beforeSoundData
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
