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
  const serializedAssets = JSON.stringify(
    Object.fromEntries(
      document.assets.map((asset) => [
        asset.id,
        {
          name: asset.name,
          mimeType: asset.mimeType,
          dataBase64: asset.dataBase64,
        },
      ])
    )
  )
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(document.meta.title || 'Infiniprez Export')}</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: "Space Grotesk", "Segoe UI", sans-serif;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background: #0f1523;
      color: #e9f2ff;
    }
    main {
      max-width: 960px;
      margin: 0 auto;
      padding: 1.2rem;
    }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(document.meta.title || 'Infiniprez Export')}</h1>
    <p>Slides: ${document.slides.length}</p>
  </main>
  <script>
    window.__INFINIPREZ_EXPORT__ = ${serialized};
    window.__INFINIPREZ_EXPORT_ASSETS__ = ${serializedAssets};
  </script>
</body>
</html>`
}
