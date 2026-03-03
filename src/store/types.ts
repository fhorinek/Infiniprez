import type { Command, HistoryState } from '../commands'
import type { CanvasObject, DocumentModel, Slide } from '../model'

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
  executeDocumentCommand: (command: Command<DocumentModel>) => void
  beginCommandBatch: (label: string) => void
  commitCommandBatch: () => void
  cancelCommandBatch: () => void
  undo: () => void
  redo: () => void
  createObject: (object: CanvasObject) => void
  moveObject: (
    objectId: string,
    next: Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'rotation'>
  ) => void
  deleteObjects: (objectIds: string[]) => void
  createSlide: (slide: Slide) => void
  deleteSlide: (slideId: string) => void
}

export type EditorStore = EditorState & EditorActions
