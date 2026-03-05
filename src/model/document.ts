import { validateDocument } from './schema'
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_CANVAS_BACKGROUND,
  type CanvasSettings,
  type DocumentModel,
  type SchemaVersion,
} from './types'

export const DEFAULT_DOCUMENT_TITLE = 'Untitled Document'

export const DEFAULT_CANVAS_SETTINGS: CanvasSettings = {
  gridVisible: true,
  baseGridSize: 100,
  snapToGrid: true,
  snapToObjectEdges: true,
  snapTolerancePx: 8,
  background: DEFAULT_CANVAS_BACKGROUND,
}

export function getCurrentSchemaVersion(): SchemaVersion {
  return CURRENT_SCHEMA_VERSION
}

export function createEmptyDocument(title = DEFAULT_DOCUMENT_TITLE): DocumentModel {
  const timestamp = new Date().toISOString()

  return {
    meta: {
      version: CURRENT_SCHEMA_VERSION,
      title,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    canvas: { ...DEFAULT_CANVAS_SETTINGS },
    slides: [],
    objects: [],
    assets: [],
  }
}

export function serializeDocument(document: DocumentModel): string {
  return JSON.stringify(document, null, 2)
}

export function deserializeDocument(payload: string): DocumentModel {
  const parsed = JSON.parse(payload) as unknown
  return validateDocument(parsed)
}
