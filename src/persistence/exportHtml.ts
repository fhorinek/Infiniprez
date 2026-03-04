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

  const runtimeScript = `
(() => {
  const model = window.__INFINIPREZ_EXPORT__;
  const assetsById = window.__INFINIPREZ_EXPORT_ASSETS__ || {};
  const stage = document.getElementById('stage');
  const prevBtn = document.getElementById('prev-slide');
  const nextBtn = document.getElementById('next-slide');
  const title = document.getElementById('slide-title');
  const count = document.getElementById('slide-count');
  const slides = Array.isArray(model.slides)
    ? [...model.slides].sort((a, b) => a.orderIndex - b.orderIndex)
    : [];
  const START_SLIDE_INDEX = 0;
  let currentSlideIndex = 0;

  const rotatePoint = (point, radians) => {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
      x: point.x * cos - point.y * sin,
      y: point.x * sin + point.y * cos,
    };
  };

  const worldToScreen = (world, camera, viewport) => {
    const translated = {
      x: (world.x - camera.x) * camera.zoom,
      y: (world.y - camera.y) * camera.zoom,
    };
    const rotated = rotatePoint(translated, camera.rotation);
    return {
      x: rotated.x + viewport.width / 2,
      y: rotated.y + viewport.height / 2,
    };
  };

  const getTextContent = (object) =>
    object?.textboxData?.runs?.map((run) => run.text || '').join('') || 'Text';

  const getImageSrc = (assetId) => {
    const asset = assetsById[assetId];
    if (!asset || !asset.mimeType || !asset.dataBase64) {
      return null;
    }
    return 'data:' + asset.mimeType + ';base64,' + asset.dataBase64;
  };

  const getViewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  const renderSlide = (slide) => {
    const camera = slide
      ? { x: slide.x, y: slide.y, zoom: slide.zoom, rotation: slide.rotation }
      : { x: 0, y: 0, zoom: 1, rotation: 0 };
    const viewport = getViewport();
    stage.innerHTML = '';

    const objects = Array.isArray(model.objects) ? [...model.objects] : [];
    objects.sort((a, b) => a.zIndex - b.zIndex);

    for (const object of objects) {
      if (object.type === 'group') {
        continue;
      }

      const center = worldToScreen({ x: object.x, y: object.y }, camera, viewport);
      const width = object.w * camera.zoom;
      const height = object.h * camera.zoom;
      const element = document.createElement('div');
      element.className = 'export-object ' + object.type;
      element.style.left = String(center.x - width / 2) + 'px';
      element.style.top = String(center.y - height / 2) + 'px';
      element.style.width = String(width) + 'px';
      element.style.height = String(height) + 'px';
      element.style.transform = 'rotate(' + String(object.rotation + camera.rotation) + 'rad)';

      if (object.type === 'shape_rect' || object.type === 'shape_circle' || object.type === 'shape_arrow') {
        element.style.borderWidth = String((object.shapeData?.borderWidth || 1) * camera.zoom) + 'px';
        element.style.borderStyle = object.shapeData?.borderType || 'solid';
        element.style.borderColor = object.shapeData?.borderColor || '#8fb0e6';
        element.style.opacity = String((object.shapeData?.opacityPercent ?? 100) / 100);
        if (object.type === 'shape_circle') {
          element.style.borderRadius = '999px';
        }
        if (object.type === 'shape_arrow') {
          element.textContent = '→';
          element.style.display = 'grid';
          element.style.placeItems = 'center';
          element.style.fontSize = '24px';
        }
      } else if (object.type === 'image') {
        const src = getImageSrc(object.imageData?.assetId);
        if (src) {
          const image = document.createElement('img');
          image.src = src;
          image.alt = '';
          image.style.width = '100%';
          image.style.height = '100%';
          image.style.objectFit = 'fill';
          image.draggable = false;
          element.appendChild(image);
        }
      } else if (object.type === 'textbox') {
        element.textContent = getTextContent(object);
      }

      stage.appendChild(element);
    }
  };

  const setSlideIndex = (nextIndex) => {
    if (slides.length === 0) {
      renderSlide(null);
      title.textContent = model.meta?.title || 'Export';
      count.textContent = '0 / 0';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }

    const bounded = Math.max(0, Math.min(slides.length - 1, nextIndex));
    currentSlideIndex = bounded;
    const slide = slides[bounded];
    renderSlide(slide);
    title.textContent = slide?.name || model.meta?.title || 'Export';
    count.textContent = String(bounded + 1) + ' / ' + String(slides.length);
    prevBtn.disabled = bounded <= 0;
    nextBtn.disabled = bounded >= slides.length - 1;
  };

  prevBtn.addEventListener('click', () => setSlideIndex(currentSlideIndex - 1));
  nextBtn.addEventListener('click', () => setSlideIndex(currentSlideIndex + 1));
  window.addEventListener('resize', () => setSlideIndex(currentSlideIndex));
  setSlideIndex(START_SLIDE_INDEX);
})();
`.trim()

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none';"
  />
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
      position: fixed;
      inset: 0;
    }
    #stage {
      position: absolute;
      inset: 0;
      overflow: hidden;
      background: radial-gradient(circle at 20% 20%, #1f365a 0%, #0f1523 55%);
    }
    #hud {
      position: absolute;
      left: 50%;
      bottom: 1rem;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.45rem 0.6rem;
      border-radius: 999px;
      border: 1px solid rgba(173, 202, 255, 0.24);
      background: rgba(7, 13, 28, 0.82);
    }
    #slide-title {
      font-size: 0.85rem;
      color: #d8e8ff;
      margin-right: 0.25rem;
    }
    #slide-count {
      font-size: 0.78rem;
      color: #9bb2d9;
      margin-right: 0.25rem;
    }
    #hud button {
      font: inherit;
      border: 1px solid rgba(173, 202, 255, 0.28);
      border-radius: 999px;
      background: rgba(46, 66, 100, 0.85);
      color: #e9f2ff;
      padding: 0.28rem 0.62rem;
      cursor: pointer;
    }
    #hud button:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .export-object {
      position: absolute;
      transform-origin: center center;
      color: #e9f2ff;
      border: 1px solid rgba(175, 199, 240, 0.35);
      user-select: none;
      overflow: hidden;
      display: grid;
      place-items: center;
      background: rgba(28, 45, 74, 0.45);
      white-space: pre-wrap;
      font-size: 15px;
      padding: 0.35rem;
      text-align: left;
    }
    .export-object img {
      pointer-events: none;
      display: block;
    }
  </style>
</head>
<body>
  <main>
    <div id="stage"></div>
    <div id="hud">
      <span id="slide-title"></span>
      <span id="slide-count"></span>
      <button id="prev-slide" type="button">Prev</button>
      <button id="next-slide" type="button">Next</button>
    </div>
  </main>
  <script>
    window.__INFINIPREZ_EXPORT__ = ${serialized};
    window.__INFINIPREZ_EXPORT_ASSETS__ = ${serializedAssets};
    ${runtimeScript}
  </script>
</body>
</html>`
}
