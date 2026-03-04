import { deserializeDocument, type DocumentModel } from '../model'

const XML_LAYOUT_VERSION = '1.0'
const XML_SECTION_ORDER = ['meta', 'canvas', 'slides', 'objects', 'assets'] as const

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
    `<infiniprez version="${XML_LAYOUT_VERSION}">`,
    serializeSection('meta', document.meta),
    serializeSection('canvas', document.canvas),
    serializeSection('slides', document.slides),
    serializeSection('objects', document.objects),
    serializeSection('assets', document.assets),
    '</infiniprez>',
  ].join('\n')
}

function parseXmlSection(root: Element, tagName: string): unknown {
  const section = root.querySelector(`:scope > ${tagName}`)
  if (!section || section.textContent === null) {
    throw new Error(`Missing XML section: ${tagName}`)
  }
  return JSON.parse(section.textContent)
}

export function deserializeDocumentFromXml(payload: string): DocumentModel {
  const parser = new DOMParser()
  const xml = parser.parseFromString(payload, 'application/xml')
  if (xml.querySelector('parsererror')) {
    throw new Error('Invalid XML')
  }

  const root = xml.querySelector('infiniprez')
  if (!root) {
    throw new Error('Missing infiniprez root element')
  }
  if (root.getAttribute('version') !== XML_LAYOUT_VERSION) {
    throw new Error(`Unsupported XML layout version: ${root.getAttribute('version') ?? 'none'}`)
  }

  const rootChildren = Array.from(root.children).map((entry) => entry.tagName)
  if (
    rootChildren.length !== XML_SECTION_ORDER.length ||
    rootChildren.some((entry, index) => entry !== XML_SECTION_ORDER[index])
  ) {
    throw new Error(
      `Invalid XML section order; expected ${XML_SECTION_ORDER.join(' -> ')}`
    )
  }

  const rawDocument = {
    meta: parseXmlSection(root, 'meta'),
    canvas: parseXmlSection(root, 'canvas'),
    slides: parseXmlSection(root, 'slides'),
    objects: parseXmlSection(root, 'objects'),
    assets: parseXmlSection(root, 'assets'),
  }

  return deserializeDocument(JSON.stringify(rawDocument))
}
