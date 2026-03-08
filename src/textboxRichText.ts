import type { TextboxData } from './model'

const DEFAULT_TEXTBOX_FONT_SIZE_PX = 28
const DEFAULT_TEXTBOX_TEXT_COLOR = '#f0f3fc'
const PX_PER_PT = 96 / 72

export function resolveTextboxRichHtml(textboxData: TextboxData): string {
  const stored = textboxData.richTextHtml?.trim() ?? ''
  if (stored.length > 0) {
    return stored
  }
  return '<p><br /></p>'
}

export function richHtmlToPlainText(html: string): string {
  const withLineBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

  return withLineBreaks.replace(/\n{3,}/g, '\n\n').trimEnd()
}

function parseCssFontSizePx(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback
  }

  const trimmed = value.trim().toLowerCase()
  const numeric = Number(trimmed.replace('px', '').replace('pt', '').trim())
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback
  }
  if (trimmed.endsWith('pt')) {
    return numeric * PX_PER_PT
  }
  return numeric
}

export function resolveTextboxBaseTextStyle(textboxData: TextboxData) {
  const firstRun = textboxData.runs.find((run) => run.text.trim().length > 0) ?? textboxData.runs[0]
  const fallback = {
    fontFamily: textboxData.fontFamily || 'Arial',
    fontSizePx: firstRun?.fontSize ?? DEFAULT_TEXTBOX_FONT_SIZE_PX,
    textColor: firstRun?.color ?? DEFAULT_TEXTBOX_TEXT_COLOR,
  }

  if (typeof DOMParser === 'undefined') {
    return fallback
  }

  const html = resolveTextboxRichHtml(textboxData).trim()
  if (html.length === 0) {
    return fallback
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(`<div data-root="textbox-style">${html}</div>`, 'text/html')
  const root = doc.querySelector('[data-root="textbox-style"]')
  if (!(root instanceof HTMLElement)) {
    return fallback
  }

  let fontFamily = fallback.fontFamily
  let fontSizePx = fallback.fontSizePx
  let textColor = fallback.textColor
  let hasFontFamily = false
  let hasFontSize = false
  let hasTextColor = false

  const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
  for (const element of elements) {
    if (element.tagName === 'BR') {
      continue
    }
    if (!hasFontFamily && element.style.fontFamily) {
      fontFamily = element.style.fontFamily
      hasFontFamily = true
    }
    if (!hasFontSize && element.style.fontSize) {
      fontSizePx = parseCssFontSizePx(element.style.fontSize, fontSizePx)
      hasFontSize = true
    }
    if (!hasTextColor && element.style.color) {
      textColor = element.style.color
      hasTextColor = true
    }
    if (hasFontFamily && hasFontSize && hasTextColor) {
      break
    }
  }

  return {
    fontFamily,
    fontSizePx,
    textColor,
  }
}

function normalizeFontFamilyToken(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, '').toLowerCase()
}

function splitFontFamilyList(value: string) {
  return value
    .split(',')
    .map((entry) => normalizeFontFamilyToken(entry))
    .filter((entry) => entry.length > 0)
}

export function textboxUsesFontFamily(textboxData: TextboxData, targetFontFamily: string) {
  const normalizedTarget = normalizeFontFamilyToken(targetFontFamily)
  if (normalizedTarget.length === 0) {
    return false
  }

  if (splitFontFamilyList(textboxData.fontFamily || '').includes(normalizedTarget)) {
    return true
  }

  if (typeof DOMParser === 'undefined') {
    return false
  }

  const html = resolveTextboxRichHtml(textboxData).trim()
  if (html.length === 0) {
    return false
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(`<div data-root="textbox-fonts">${html}</div>`, 'text/html')
  const root = doc.querySelector('[data-root="textbox-fonts"]')
  if (!(root instanceof HTMLElement)) {
    return false
  }

  const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
  return elements.some((element) => splitFontFamilyList(element.style.fontFamily).includes(normalizedTarget))
}

export function applyTextboxThemeRichHtml(
  html: string,
  options: { fontFamily: string; textColor: string }
) {
  const trimmed = html.trim()
  if (trimmed.length === 0 || typeof DOMParser === 'undefined') {
    return html
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(`<div data-root="textbox-theme">${html}</div>`, 'text/html')
  const root = doc.querySelector('[data-root="textbox-theme"]')
  if (!(root instanceof HTMLElement)) {
    return html
  }

  const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
  for (const element of elements) {
    if (element.tagName === 'BR') {
      continue
    }
    element.style.fontFamily = options.fontFamily
    element.style.color = options.textColor
  }

  return root.innerHTML
}
