import { create } from 'zustand'
import {
  combineCommands,
  createEmptyHistory,
  createObjectCommand,
  createSlideCommand,
  deleteObjectsCommand,
  deleteSlideCommand,
  executeCommand,
  moveObjectCommand,
  recordExecutedCommand,
  redoCommand,
  setObjectLockCommand,
  undoCommand,
  type Command,
} from '../commands'
import { createEmptyDocument, type CanvasObject, type DocumentModel } from '../model'
import type { CameraState, EditorState, EditorStore, UiState } from './types'

const DEFAULT_CAMERA: CameraState = {
  x: 0,
  y: 0,
  zoom: 1,
  rotation: 0,
}

const DEFAULT_UI: UiState = {
  mode: 'edit',
  selectedObjectIds: [],
  selectedSlideId: null,
  activeGroupId: null,
}

function createInitialState(): EditorState {
  return {
    document: createEmptyDocument(),
    camera: { ...DEFAULT_CAMERA },
    ui: { ...DEFAULT_UI },
    history: createEmptyHistory<DocumentModel>(),
    pendingBatch: null,
  }
}

function executeOrQueueCommand(state: EditorState, command: Command<DocumentModel>): EditorState {
  if (state.pendingBatch) {
    return {
      ...state,
      document: command.execute(state.document),
      pendingBatch: {
        ...state.pendingBatch,
        commands: [...state.pendingBatch.commands, command],
      },
    }
  }

  const result = executeCommand(state.document, state.history, command)
  return {
    ...state,
    document: result.state,
    history: result.history,
  }
}

function captureRemovedObjects(document: DocumentModel, objectIds: string[]) {
  return document.objects
    .map((object, index) => ({ object, index }))
    .filter((entry) => objectIds.includes(entry.object.id))
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  ...createInitialState(),

  setCamera: (camera) =>
    set((state) => ({
      ...state,
      camera,
    })),

  selectObjects: (objectIds) =>
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        selectedObjectIds: objectIds,
      },
    })),

  clearSelection: () =>
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        selectedObjectIds: [],
      },
    })),

  executeDocumentCommand: (command) =>
    set((state) => {
      return executeOrQueueCommand(state, command)
    }),

  beginCommandBatch: (label) =>
    set((state) => ({
      ...state,
      pendingBatch: { label, commands: [] },
    })),

  commitCommandBatch: () =>
    set((state) => {
      if (!state.pendingBatch || state.pendingBatch.commands.length === 0) {
        return { ...state, pendingBatch: null }
      }

      const batchedCommand = combineCommands(state.pendingBatch.label, state.pendingBatch.commands)
      return {
        ...state,
        history: recordExecutedCommand(state.history, batchedCommand),
        pendingBatch: null,
      }
    }),

  cancelCommandBatch: () =>
    set((state) => {
      if (!state.pendingBatch || state.pendingBatch.commands.length === 0) {
        return { ...state, pendingBatch: null }
      }

      const rollback = combineCommands('Cancel batch', state.pendingBatch.commands)
      return {
        ...state,
        document: rollback.undo(state.document),
        pendingBatch: null,
      }
    }),

  undo: () =>
    set((state) => {
      const result = undoCommand(state.document, state.history)
      return {
        ...state,
        document: result.state,
        history: result.history,
      }
    }),

  redo: () =>
    set((state) => {
      const result = redoCommand(state.document, state.history)
      return {
        ...state,
        document: result.state,
        history: result.history,
      }
    }),

  createObject: (object) => {
    const command = createObjectCommand(object)
    get().executeDocumentCommand(command)
  },

  moveObject: (objectId, next) => {
    const target = get().document.objects.find((entry) => entry.id === objectId)
    if (!target) {
      return
    }

    const before: Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'rotation'> = {
      x: target.x,
      y: target.y,
      w: target.w,
      h: target.h,
      rotation: target.rotation,
    }

    const command = moveObjectCommand(objectId, before, next)
    get().executeDocumentCommand(command)
  },

  deleteObjects: (objectIds) => {
    if (objectIds.length === 0) {
      return
    }

    const removed = captureRemovedObjects(get().document, objectIds)
    if (removed.length === 0) {
      return
    }

    const command = deleteObjectsCommand(objectIds, removed)
    get().executeDocumentCommand(command)

    const selectedSet = new Set(get().ui.selectedObjectIds)
    const hasRemovedSelected = objectIds.some((id) => selectedSet.has(id))
    if (hasRemovedSelected) {
      get().clearSelection()
    }
  },

  toggleObjectLock: (objectId) => {
    const target = get().document.objects.find((entry) => entry.id === objectId)
    if (!target) {
      return
    }

    const command = setObjectLockCommand(objectId, target.locked, !target.locked)
    get().executeDocumentCommand(command)
  },

  createSlide: (slide) => {
    const command = createSlideCommand(slide)
    get().executeDocumentCommand(command)
  },

  deleteSlide: (slideId) => {
    const removedIndex = get().document.slides.findIndex((entry) => entry.id === slideId)
    if (removedIndex < 0) {
      return
    }

    const removedSlide = get().document.slides[removedIndex]
    const command = deleteSlideCommand(slideId, removedSlide, removedIndex)
    get().executeDocumentCommand(command)
  },
}))
