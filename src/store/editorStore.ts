import { create } from 'zustand'
import {
  combineCommands,
  createEmptyHistory,
  createAssetCommand,
  createObjectCommand,
  createSlideCommand,
  deleteObjectsCommand,
  deleteSlideCommand,
  executeCommand,
  groupObjectsCommand,
  moveObjectCommand,
  recordExecutedCommand,
  redoCommand,
  setShapeOpacityCommand,
  setObjectZIndexCommand,
  setObjectLockCommand,
  ungroupObjectCommand,
  undoCommand,
  type Command,
} from '../commands'
import {
  computeLayerZIndexSnapshots,
  createEmptyDocument,
  type Asset,
  type CanvasObject,
  type DocumentModel,
} from '../model'
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

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

function getObjectWorldAabb(object: Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'rotation'>) {
  const halfW = object.w / 2
  const halfH = object.h / 2
  const cos = Math.cos(object.rotation)
  const sin = Math.sin(object.rotation)
  const corners = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ].map((corner) => ({
    x: object.x + corner.x * cos - corner.y * sin,
    y: object.y + corner.x * sin + corner.y * cos,
  }))

  return {
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y)),
  }
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  ...createInitialState(),

  setCamera: (camera) =>
    set((state) => ({
      ...state,
      camera,
    })),

  replaceDocument: (document) =>
    set((state) => ({
      ...state,
      document,
      history: createEmptyHistory<DocumentModel>(),
      pendingBatch: null,
      ui: {
        ...state.ui,
        selectedObjectIds: [],
        selectedSlideId: null,
        activeGroupId: null,
      },
    })),

  resetDocument: () =>
    set((state) => ({
      ...state,
      ...createInitialState(),
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

  enterGroup: (groupId) =>
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        selectedObjectIds: [],
        activeGroupId: groupId,
      },
    })),

  exitGroup: () =>
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        selectedObjectIds: [],
        activeGroupId: null,
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

  createAsset: (asset: Asset) => {
    const command = createAssetCommand(asset)
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

  reorderObjectsLayer: (objectIds, action) => {
    if (objectIds.length === 0) {
      return
    }

    const { before, after } = computeLayerZIndexSnapshots(get().document.objects, objectIds, action)
    if (Object.keys(after).length === 0) {
      return
    }

    const command = setObjectZIndexCommand(action, before, after)
    get().executeDocumentCommand(command)
  },

  toggleObjectLock: (objectId) => {
    const target = get().document.objects.find((entry) => entry.id === objectId)
    if (!target) {
      return
    }

    const command = setObjectLockCommand(objectId, target.locked, !target.locked)
    get().executeDocumentCommand(command)
  },

  setShapeOpacity: (objectId, opacityPercent) => {
    const target = get().document.objects.find((entry) => entry.id === objectId)
    if (
      !target ||
      (target.type !== 'shape_rect' && target.type !== 'shape_circle' && target.type !== 'shape_arrow')
    ) {
      return
    }

    const nextOpacity = Math.max(0, Math.min(100, Math.round(opacityPercent)))
    if (target.shapeData.opacityPercent === nextOpacity) {
      return
    }

    const command = setShapeOpacityCommand(objectId, target.shapeData.opacityPercent, nextOpacity)
    get().executeDocumentCommand(command)
  },

  groupObjects: (objectIds) => {
    const sourceIds = [...new Set(objectIds)]
    if (sourceIds.length < 2) {
      return
    }

    const selected = get().document.objects.filter((entry) => sourceIds.includes(entry.id))
    const groupable = selected.filter(
      (entry) => entry.type !== 'group' && entry.parentGroupId === null
    )
    if (groupable.length < 2) {
      return
    }

    const bounds = groupable
      .map((entry) => getObjectWorldAabb(entry))
      .reduce(
        (acc, entry) => ({
          minX: Math.min(acc.minX, entry.minX),
          minY: Math.min(acc.minY, entry.minY),
          maxX: Math.max(acc.maxX, entry.maxX),
          maxY: Math.max(acc.maxY, entry.maxY),
        }),
        {
          minX: Number.POSITIVE_INFINITY,
          minY: Number.POSITIVE_INFINITY,
          maxX: Number.NEGATIVE_INFINITY,
          maxY: Number.NEGATIVE_INFINITY,
        }
      )

    const nextZIndex =
      get().document.objects.reduce((max, entry) => Math.max(max, entry.zIndex), 0) + 1
    const groupId = createId()
    const groupObject: CanvasObject = {
      id: groupId,
      type: 'group',
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
      w: Math.max(20, bounds.maxX - bounds.minX),
      h: Math.max(20, bounds.maxY - bounds.minY),
      rotation: 0,
      locked: false,
      zIndex: nextZIndex,
      parentGroupId: null,
      groupData: {
        childIds: groupable.map((entry) => entry.id),
      },
    }

    const childParentBefore = Object.fromEntries(
      groupable.map((entry) => [entry.id, entry.parentGroupId])
    ) as Record<string, string | null>

    const command = groupObjectsCommand(groupObject, childParentBefore)
    get().executeDocumentCommand(command)
    get().selectObjects([groupId])
  },

  ungroupObjects: (objectIds) => {
    if (objectIds.length === 0) {
      return
    }

    const targets = get().document.objects.filter(
      (entry): entry is Extract<CanvasObject, { type: 'group' }> =>
        objectIds.includes(entry.id) && entry.type === 'group'
    )
    if (targets.length === 0) {
      return
    }

    for (const group of targets) {
      const childParentBefore = Object.fromEntries(
        group.groupData.childIds.map((childId: string) => [childId, group.id])
      ) as Record<string, string | null>
      const command = ungroupObjectCommand(group, childParentBefore)
      get().executeDocumentCommand(command)
    }

    const restoredChildren = targets.flatMap((group) => group.groupData.childIds)
    if (restoredChildren.length > 0) {
      get().selectObjects(restoredChildren)
    }
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
