import { produce } from 'immer'
import type { Command } from './types'
import type { CanvasObject, DocumentModel, Slide } from '../model'

type TransformSnapshot = Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'rotation'>

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
