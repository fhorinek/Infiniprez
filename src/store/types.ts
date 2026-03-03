import type { Command, HistoryState } from '../commands'
import type { Asset, CanvasObject, DocumentModel, LayerOrderAction, Slide } from '../model'

export interface CameraState {
  x: number
  y: number
  zoom: number
  rotation: number
}

export interface UiState {
  mode: 'edit' | 'present'
  selectedObjectIds: string[]
  selectedSlideId: string | null
  activeGroupId: string | null
}

export interface PendingBatch {
  label: string
  commands: Command<DocumentModel>[]
}

export interface EditorState {
  document: DocumentModel
  camera: CameraState
  ui: UiState
  history: HistoryState<DocumentModel>
  pendingBatch: PendingBatch | null
}

export interface EditorActions {
  setCamera: (camera: CameraState) => void
  replaceDocument: (document: DocumentModel) => void
  resetDocument: () => void
  selectObjects: (objectIds: string[]) => void
  clearSelection: () => void
  selectSlide: (slideId: string | null) => void
  enterGroup: (groupId: string) => void
  exitGroup: () => void
  executeDocumentCommand: (command: Command<DocumentModel>) => void
  beginCommandBatch: (label: string) => void
  commitCommandBatch: () => void
  cancelCommandBatch: () => void
  undo: () => void
  redo: () => void
  createObject: (object: CanvasObject) => void
  createAsset: (asset: Asset) => void
  moveObject: (
    objectId: string,
    next: Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'rotation'>
  ) => void
  deleteObjects: (objectIds: string[]) => void
  reorderObjectsLayer: (objectIds: string[], action: LayerOrderAction) => void
  toggleObjectLock: (objectId: string) => void
  setShapeOpacity: (objectId: string, opacityPercent: number) => void
  groupObjects: (objectIds: string[]) => void
  ungroupObjects: (objectIds: string[]) => void
  createSlide: (slide: Slide) => void
  updateSlide: (slideId: string, next: Slide) => void
  deleteSlide: (slideId: string) => void
  reorderSlides: (orderedSlideIds: string[]) => void
}

export type EditorStore = EditorState & EditorActions
