import type { DocumentModel } from '../model'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildPresentationExportHtml(document: DocumentModel): string {
  const serialized = JSON.stringify(document)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(document.meta.title || 'Infiniprez Export')}</title>
</head>
<body>
  <main>
    <h1>${escapeHtml(document.meta.title || 'Infiniprez Export')}</h1>
    <p>Slides: ${document.slides.length}</p>
  </main>
  <script>
    window.__INFINIPREZ_EXPORT__ = ${serialized};
  </script>
</body>
</html>`
}
