import type { DocumentModel } from '../model'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function serializeSection(tagName: string, value: unknown): string {
  return `  <${tagName}>${escapeXml(JSON.stringify(value))}</${tagName}>`
}

export function serializeDocumentToXml(document: DocumentModel): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<infiniprez version="${escapeXml(document.meta.version)}">`,
    serializeSection('meta', document.meta),
    serializeSection('canvas', document.canvas),
    serializeSection('slides', document.slides),
    serializeSection('objects', document.objects),
    serializeSection('assets', document.assets),
    '</infiniprez>',
  ].join('\n')
}
