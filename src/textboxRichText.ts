import type { TextboxData } from './model'

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
