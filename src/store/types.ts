import type { Command, HistoryState } from '../commands'
import type {
  Asset,
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
} from '../model'

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
  setCanvasBackground: (background: string) => void
  setCanvasSettings: (nextCanvasSettings: Partial<CanvasSettings>) => void
  setMode: (mode: UiState['mode']) => void
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
  deleteAsset: (assetId: string) => void
  moveObject: (
    objectId: string,
    next: Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'rotation'> & { scalePercent?: number }
  ) => void
  deleteObjects: (objectIds: string[]) => void
  reorderObjectsLayer: (objectIds: string[], action: LayerOrderAction) => void
  toggleObjectLock: (objectId: string) => void
  setObjectKeepAspectRatio: (objectId: string, locked: boolean) => void
  setImageData: (objectId: string, imageData: ImageData) => void
  setVideoData: (objectId: string, videoData: VideoData) => void
  setSoundData: (objectId: string, soundData: SoundData) => void
  setTextboxData: (objectId: string, textboxData: TextboxData) => void
  setShapeOpacity: (objectId: string, opacityPercent: number) => void
  setShapeData: (objectId: string, shapeData: ShapeData) => void
  groupObjects: (objectIds: string[]) => void
  ungroupObjects: (objectIds: string[]) => void
  createSlide: (slide: Slide) => void
  updateSlide: (slideId: string, next: Slide) => void
  deleteSlide: (slideId: string) => void
  reorderSlides: (orderedSlideIds: string[]) => void
}

export type EditorStore = EditorState & EditorActions
