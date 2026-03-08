import { create } from 'zustand'
import {
  combineCommands,
  createEmptyHistory,
  createAssetCommand,
  createObjectCommand,
  createSlideCommand,
  deleteAssetCommand,
  deleteObjectsCommand,
  deleteSlideCommand,
  executeCommand,
  groupObjectsCommand,
  moveObjectCommand,
  recordExecutedCommand,
  redoCommand,
  setCanvasSettingsCommand,
  setSlideOrderCommand,
  setObjectKeepAspectRatioCommand,
  setShapeDataCommand,
  setShapeOpacityCommand,
  setCanvasBackgroundCommand,
  setTextboxDataCommand,
  setObjectZIndexCommand,
  setObjectLockCommand,
  setImageDataCommand,
  setSoundDataCommand,
  setVideoDataCommand,
  updateSlideCommand,
  ungroupObjectCommand,
  undoCommand,
  type Command,
} from '../commands'
import {
  computeLayerZIndexSnapshots,
  createEmptyDocument,
  DEFAULT_CANVAS_SETTINGS,
  type Asset,
  type CanvasSettings,
  type CanvasObject,
  type DocumentModel,
  type ImageData,
  type ShapeData,
  type Slide,
  type SoundData,
  type VideoData,
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

function normalizeCameraRotation(rotation: number): number {
  const twoPi = Math.PI * 2
  let normalized = rotation
  while (normalized > Math.PI) {
    normalized -= twoPi
  }
  while (normalized < -Math.PI) {
    normalized += twoPi
  }
  return normalized
}

function normalizeCameraZoom(zoom: number): number {
  return Math.min(100, Math.max(0.01, zoom))
}

function normalizeCanvasGridSize(baseGridSize: number): number {
  if (!Number.isFinite(baseGridSize)) {
    return 100
  }
  return Math.min(1000, Math.max(10, baseGridSize))
}

function normalizeCanvasSnapTolerance(snapTolerancePx: number): number {
  if (!Number.isFinite(snapTolerancePx)) {
    return 8
  }
  return Math.min(64, Math.max(1, snapTolerancePx))
}

function normalizeCanvasSettings(canvas: CanvasSettings): CanvasSettings {
  return {
    ...canvas,
    background: canvas.background.trim() || DEFAULT_CANVAS_SETTINGS.background,
    baseGridSize: normalizeCanvasGridSize(canvas.baseGridSize),
    snapTolerancePx: normalizeCanvasSnapTolerance(canvas.snapTolerancePx),
  }
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

function getEmptyGroupIds(document: DocumentModel): string[] {
  let remainingObjects = [...document.objects]
  const emptyGroupIds = new Set<string>()

  while (true) {
    const childCounts = new Map<string, number>()
    for (const object of remainingObjects) {
      if (object.type === 'group') {
        childCounts.set(object.id, 0)
      }
    }
    for (const object of remainingObjects) {
      if (object.parentGroupId && childCounts.has(object.parentGroupId)) {
        childCounts.set(object.parentGroupId, (childCounts.get(object.parentGroupId) ?? 0) + 1)
      }
    }

    const nextEmptyGroupIds = remainingObjects
      .filter(
        (object): object is Extract<CanvasObject, { type: 'group' }> =>
          object.type === 'group' && (childCounts.get(object.id) ?? 0) === 0
      )
      .map((object) => object.id)

    if (nextEmptyGroupIds.length === 0) {
      return [...emptyGroupIds]
    }

    nextEmptyGroupIds.forEach((id) => emptyGroupIds.add(id))
    const removedSet = new Set(nextEmptyGroupIds)
    remainingObjects = remainingObjects.filter((object) => !removedSet.has(object.id))
  }
}

function removeObjectsById(document: DocumentModel, objectIds: string[]): DocumentModel {
  if (objectIds.length === 0) {
    return document
  }
  const removedSet = new Set(objectIds)
  const nextObjects = document.objects.filter((object) => !removedSet.has(object.id))
  if (nextObjects.length === document.objects.length) {
    return document
  }
  return {
    ...document,
    objects: nextObjects,
  }
}

function restoreRemovedObjects(
  document: DocumentModel,
  removed: Array<{ object: CanvasObject; index: number }>
): DocumentModel {
  if (removed.length === 0) {
    return document
  }
  const rebuilt = [...document.objects]
  const sorted = [...removed].sort((a, b) => a.index - b.index)
  for (const entry of sorted) {
    rebuilt.splice(entry.index, 0, entry.object)
  }
  return {
    ...document,
    objects: rebuilt,
  }
}

function cleanupEmptyGroups(document: DocumentModel): DocumentModel {
  return removeObjectsById(document, getEmptyGroupIds(document))
}

function createEmptyGroupCleanupCommand(document: DocumentModel): Command<DocumentModel> | null {
  const emptyGroupIds = getEmptyGroupIds(document)
  if (emptyGroupIds.length === 0) {
    return null
  }
  const removed = captureRemovedObjects(document, emptyGroupIds)
  if (removed.length === 0) {
    return null
  }
  return {
    label: 'Delete objects',
    execute: (state) => removeObjectsById(state, emptyGroupIds),
    undo: (state) => restoreRemovedObjects(state, removed),
  }
}

function normalizeUiStateForDocument(ui: UiState, document: DocumentModel): UiState {
  const objectIds = new Set(document.objects.map((object) => object.id))
  return {
    ...ui,
    selectedObjectIds: ui.selectedObjectIds.filter((id) => objectIds.has(id)),
    activeGroupId: ui.activeGroupId && objectIds.has(ui.activeGroupId) ? ui.activeGroupId : null,
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

  const provisionalState = command.execute(state.document)
  const cleanupCommand = createEmptyGroupCleanupCommand(provisionalState)
  const finalCommand = cleanupCommand ? combineCommands(command.label, [command, cleanupCommand]) : command
  const result = executeCommand(state.document, state.history, finalCommand)
  return {
    ...state,
    document: result.state,
    history: result.history,
    ui: normalizeUiStateForDocument(state.ui, result.state),
  }
}

function captureRemovedObjects(document: DocumentModel, objectIds: string[]) {
  return document.objects
    .map((object, index) => ({ object, index }))
    .filter((entry) => objectIds.includes(entry.object.id))
}

function collectObjectIdsForDeletion(document: DocumentModel, objectIds: string[]): string[] {
  if (objectIds.length === 0) {
    return []
  }

  const objectById = new Map(document.objects.map((object) => [object.id, object]))
  const childrenByParent = new Map<string, string[]>()
  for (const object of document.objects) {
    if (!object.parentGroupId) {
      continue
    }
    const children = childrenByParent.get(object.parentGroupId)
    if (children) {
      children.push(object.id)
    } else {
      childrenByParent.set(object.parentGroupId, [object.id])
    }
  }

  const resolved = new Set<string>()
  const stack = [...new Set(objectIds)]

  while (stack.length > 0) {
    const nextId = stack.pop()
    if (!nextId || resolved.has(nextId)) {
      continue
    }

    const target = objectById.get(nextId)
    if (!target) {
      continue
    }
    resolved.add(nextId)

    if (target.type !== 'group') {
      continue
    }

    for (const childId of target.groupData.childIds) {
      if (!resolved.has(childId)) {
        stack.push(childId)
      }
    }
    for (const childId of childrenByParent.get(target.id) ?? []) {
      if (!resolved.has(childId)) {
        stack.push(childId)
      }
    }
  }

  return [...resolved]
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

function clampSlideTriggerDelay(value: number) {
  const rounded = Math.round(value)
  return Math.min(60_000, Math.max(0, rounded))
}

function clampSlideTransitionDuration(value: number, transitionType: Slide['transitionType']) {
  const rounded = Math.round(value)
  if (transitionType === 'instant') {
    return Math.min(10_000, Math.max(0, rounded))
  }
  return Math.min(10_000, Math.max(1_000, rounded))
}

function normalizeSlideForStore(slide: Slide): Slide {
  return {
    ...slide,
    triggerDelayMs: clampSlideTriggerDelay(slide.triggerDelayMs),
    transitionDurationMs: clampSlideTransitionDuration(
      slide.transitionDurationMs,
      slide.transitionType
    ),
  }
}

type TransformSnapshot = Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'rotation' | 'scalePercent'>

function hasTransformChanged(before: TransformSnapshot, after: TransformSnapshot): boolean {
  return (
    before.x !== after.x ||
    before.y !== after.y ||
    before.w !== after.w ||
    before.h !== after.h ||
    before.rotation !== after.rotation ||
    before.scalePercent !== after.scalePercent
  )
}

function getTransformSnapshot(object: CanvasObject): TransformSnapshot {
  return {
    x: object.x,
    y: object.y,
    w: object.w,
    h: object.h,
    rotation: object.rotation,
    scalePercent: object.scalePercent,
  }
}

function getContentBoundsForGroup(
  group: Extract<CanvasObject, { type: 'group' }>,
  objectById: Map<string, CanvasObject>,
  transforms: Map<string, TransformSnapshot>
): ReturnType<typeof getObjectWorldAabb> | null {
  const seen = new Set<string>()
  const stack = [...group.groupData.childIds]
  const leafBounds: Array<ReturnType<typeof getObjectWorldAabb>> = []

  while (stack.length > 0) {
    const nextId = stack.pop()
    if (!nextId || seen.has(nextId)) {
      continue
    }
    seen.add(nextId)

    const object = objectById.get(nextId)
    if (!object) {
      continue
    }

    if (object.type === 'group') {
      stack.push(...object.groupData.childIds)
      continue
    }

    const transform = transforms.get(object.id)
    if (!transform) {
      continue
    }
    leafBounds.push(getObjectWorldAabb(transform))
  }

  if (leafBounds.length === 0) {
    return null
  }

  return leafBounds.reduce(
    (acc, bounds) => ({
      minX: Math.min(acc.minX, bounds.minX),
      minY: Math.min(acc.minY, bounds.minY),
      maxX: Math.max(acc.maxX, bounds.maxX),
      maxY: Math.max(acc.maxY, bounds.maxY),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    }
  )
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  ...createInitialState(),

  setCamera: (camera) =>
    set((state) => ({
      ...state,
      camera: {
        ...camera,
        zoom: normalizeCameraZoom(camera.zoom),
        rotation: normalizeCameraRotation(camera.rotation),
      },
    })),

  setCanvasBackground: (background) => {
    const nextBackground = background.trim()
    if (nextBackground.length === 0) {
      return
    }

    const beforeBackground = get().document.canvas.background
    if (beforeBackground === nextBackground) {
      return
    }

    const command = setCanvasBackgroundCommand(beforeBackground, nextBackground)
    get().executeDocumentCommand(command)
  },

  setCanvasSettings: (nextCanvasSettings) => {
    const beforeCanvas = get().document.canvas
    const afterCanvas = normalizeCanvasSettings({
      ...beforeCanvas,
      ...nextCanvasSettings,
    })
    if (JSON.stringify(beforeCanvas) === JSON.stringify(afterCanvas)) {
      return
    }

    const command = setCanvasSettingsCommand(beforeCanvas, afterCanvas)
    get().executeDocumentCommand(command)
  },

  setMode: (mode) =>
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        mode,
      },
    })),

  replaceDocument: (document) =>
    set((state) => ({
      ...state,
      document: cleanupEmptyGroups(document),
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

  selectSlide: (slideId) =>
    set((state) => ({
      ...state,
      ui: {
        ...state.ui,
        selectedSlideId: slideId,
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

      const cleanupCommand = createEmptyGroupCleanupCommand(state.document)
      const commands = cleanupCommand
        ? [...state.pendingBatch.commands, cleanupCommand]
        : state.pendingBatch.commands
      const batchedCommand = combineCommands(state.pendingBatch.label, commands)
      const nextDocument = cleanupCommand ? cleanupCommand.execute(state.document) : state.document
      return {
        ...state,
        document: nextDocument,
        history: recordExecutedCommand(state.history, batchedCommand),
        pendingBatch: null,
        ui: normalizeUiStateForDocument(state.ui, nextDocument),
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
        ui: normalizeUiStateForDocument(state.ui, result.state),
      }
    }),

  redo: () =>
    set((state) => {
      const result = redoCommand(state.document, state.history)
      return {
        ...state,
        document: result.state,
        history: result.history,
        ui: normalizeUiStateForDocument(state.ui, result.state),
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

  deleteAsset: (assetId: string) => {
    const assets = get().document.assets
    const index = assets.findIndex((entry) => entry.id === assetId)
    if (index < 0) {
      return
    }
    const command = deleteAssetCommand(assetId, { asset: assets[index], index })
    get().executeDocumentCommand(command)
  },

  moveObject: (objectId, next) => {
    const objects = get().document.objects
    const selectedIds = new Set(get().ui.selectedObjectIds)
    const objectById = new Map(objects.map((entry) => [entry.id, entry]))
    const target = objectById.get(objectId)
    if (!target) {
      return
    }
    const normalizedNext: TransformSnapshot = {
      ...next,
      scalePercent: next.scalePercent ?? target.scalePercent,
    }

    const currentTransforms = new Map<string, TransformSnapshot>(
      objects.map((entry) => [entry.id, getTransformSnapshot(entry)])
    )
    currentTransforms.set(objectId, normalizedNext)

    const commandEntries: Array<{ id: string; before: TransformSnapshot; after: TransformSnapshot }> =
      []
    const movedBefore = getTransformSnapshot(target)
    if (hasTransformChanged(movedBefore, normalizedNext)) {
      commandEntries.push({ id: objectId, before: movedBefore, after: normalizedNext })
    }

    const ancestorIds: string[] = []
    let ancestorId = target.parentGroupId
    while (ancestorId) {
      const candidate = objectById.get(ancestorId)
      if (!candidate || candidate.type !== 'group') {
        break
      }
      ancestorIds.push(ancestorId)
      ancestorId = candidate.parentGroupId
    }

    for (const groupId of ancestorIds) {
      if (selectedIds.has(groupId)) {
        continue
      }
      const group = objectById.get(groupId)
      if (!group || group.type !== 'group') {
        continue
      }

      const aggregate = getContentBoundsForGroup(group, objectById, currentTransforms)
      if (!aggregate) {
        continue
      }

      const before = getTransformSnapshot(group)
      const after: TransformSnapshot = {
        x: (aggregate.minX + aggregate.maxX) / 2,
        y: (aggregate.minY + aggregate.maxY) / 2,
        w: Math.max(20, aggregate.maxX - aggregate.minX),
        h: Math.max(20, aggregate.maxY - aggregate.minY),
        rotation: currentTransforms.get(groupId)?.rotation ?? group.rotation,
        scalePercent: group.scalePercent,
      }

      currentTransforms.set(groupId, after)
      if (hasTransformChanged(before, after)) {
        commandEntries.push({ id: groupId, before, after })
      }
    }

    for (const entry of commandEntries) {
      const command = moveObjectCommand(entry.id, entry.before, entry.after)
      get().executeDocumentCommand(command)
    }
  },

  deleteObjects: (objectIds) => {
    if (objectIds.length === 0) {
      return
    }

    const idsToDelete = collectObjectIdsForDeletion(get().document, objectIds)
    const removed = captureRemovedObjects(get().document, idsToDelete)
    if (removed.length === 0) {
      return
    }

    const command = deleteObjectsCommand(idsToDelete, removed)
    get().executeDocumentCommand(command)

    const selectedSet = new Set(get().ui.selectedObjectIds)
    const hasRemovedSelected = idsToDelete.some((id) => selectedSet.has(id))
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

  setObjectKeepAspectRatio: (objectId, locked) => {
    const target = get().document.objects.find((entry) => entry.id === objectId)
    if (!target) {
      return
    }

    const beforeLocked = target.keepAspectRatio
    if (beforeLocked === locked) {
      return
    }

    const command = setObjectKeepAspectRatioCommand(objectId, beforeLocked, locked)
    get().executeDocumentCommand(command)
  },

  setImageData: (objectId, imageData: ImageData) => {
    const target = get().document.objects.find((entry) => entry.id === objectId)
    if (!target || target.type !== 'image') {
      return
    }

    const command = setImageDataCommand(objectId, target.imageData, imageData)
    get().executeDocumentCommand(command)
  },

  setVideoData: (objectId, videoData: VideoData) => {
    const target = get().document.objects.find((entry) => entry.id === objectId)
    if (!target || target.type !== 'video') {
      return
    }

    const command = setVideoDataCommand(objectId, target.videoData, videoData)
    get().executeDocumentCommand(command)
  },

  setSoundData: (objectId, soundData: SoundData) => {
    const target = get().document.objects.find((entry) => entry.id === objectId)
    if (!target || target.type !== 'sound') {
      return
    }

    const command = setSoundDataCommand(objectId, target.soundData, soundData)
    get().executeDocumentCommand(command)
  },

  setTextboxData: (objectId, textboxData) => {
    const target = get().document.objects.find((entry) => entry.id === objectId)
    if (!target || target.type !== 'textbox') {
      return
    }

    const command = setTextboxDataCommand(objectId, target.textboxData, textboxData)
    get().executeDocumentCommand(command)
  },

  setShapeOpacity: (objectId, opacityPercent) => {
    const target = get().document.objects.find((entry) => entry.id === objectId)
    if (!target || (target.type !== 'shape_rect' && target.type !== 'shape_circle')) {
      return
    }

    const nextOpacity = Math.max(0, Math.min(100, Math.round(opacityPercent)))
    if (target.shapeData.opacityPercent === nextOpacity) {
      return
    }

    const command = setShapeOpacityCommand(objectId, target.shapeData.opacityPercent, nextOpacity)
    get().executeDocumentCommand(command)
  },

  setShapeData: (objectId, shapeData: ShapeData) => {
    const target = get().document.objects.find((entry) => entry.id === objectId)
    if (!target || (target.type !== 'shape_rect' && target.type !== 'shape_circle')) {
      return
    }

    const command = setShapeDataCommand(objectId, target.shapeData, shapeData)
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
      scalePercent: 100,
      keepAspectRatio: false,
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
    const command = createSlideCommand(normalizeSlideForStore(slide))
    get().executeDocumentCommand(command)
  },

  updateSlide: (slideId, next) => {
    const before = get().document.slides.find((entry) => entry.id === slideId)
    if (!before) {
      return
    }
    const normalizedNext = normalizeSlideForStore({
      ...next,
      id: slideId,
    })
    const command = updateSlideCommand(slideId, before, normalizedNext)
    get().executeDocumentCommand(command)
  },

  deleteSlide: (slideId) => {
    const selectedBefore = get().ui.selectedSlideId
    const removedIndex = get().document.slides.findIndex((entry) => entry.id === slideId)
    if (removedIndex < 0) {
      return
    }

    const removedSlide = get().document.slides[removedIndex]
    const command = deleteSlideCommand(slideId, removedSlide, removedIndex)
    get().executeDocumentCommand(command)

    if (selectedBefore === slideId) {
      const remainingSlides = [...get().document.slides].sort((a, b) => a.orderIndex - b.orderIndex)
      const fallback =
        remainingSlides[Math.min(removedIndex, Math.max(0, remainingSlides.length - 1))]?.id ?? null
      get().selectSlide(fallback)
    }
  },

  reorderSlides: (orderedSlideIds) => {
    const slides = get().document.slides
    if (orderedSlideIds.length !== slides.length) {
      return
    }

    const slideSet = new Set(slides.map((slide) => slide.id))
    if (orderedSlideIds.some((id) => !slideSet.has(id))) {
      return
    }

    const beforeSnapshot = Object.fromEntries(
      slides.map((slide) => [slide.id, slide.orderIndex])
    ) as Record<string, number>
    const afterSnapshot = Object.fromEntries(
      orderedSlideIds.map((slideId, orderIndex) => [slideId, orderIndex])
    ) as Record<string, number>

    const hasChanges = slides.some((slide) => beforeSnapshot[slide.id] !== afterSnapshot[slide.id])
    if (!hasChanges) {
      return
    }

    const command = setSlideOrderCommand(beforeSnapshot, afterSnapshot)
    get().executeDocumentCommand(command)
  },
}))
