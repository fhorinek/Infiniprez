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
  const stageBackground = escapeHtml(
    document.canvas.background || 'radial-gradient(circle at 20% 20%, #1f365a 0%, #0f1523 55%)'
  )
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
  let currentCamera = { x: 0, y: 0, zoom: 1, rotation: 0 };
  let transitionFrame = null;

  const toNumber = (value, fallback) => (Number.isFinite(value) ? value : fallback);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const resolveTransitionProgress = (transitionType, progress) => {
    const clamped = clamp(progress, 0, 1);
    if (transitionType === 'linear') {
      return clamped;
    }
    if (transitionType === 'instant') {
      return clamped >= 1 ? 1 : 0;
    }
    return easeInOutCubic(clamped);
  };
  const resolveTransitionDurationMs = (transitionType, durationMs) => {
    const rounded = Math.round(toNumber(durationMs, 0));
    if (transitionType === 'instant') {
      return clamp(rounded, 0, 10000);
    }
    return clamp(rounded, 1000, 10000);
  };
  const interpolateCamera = (start, end, t) => ({
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    zoom: start.zoom + (end.zoom - start.zoom) * t,
    rotation: start.rotation + (end.rotation - start.rotation) * t,
  });

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

  const escapeHtmlRuntime = (value) =>
    String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const getTextboxHtml = (object) => {
    const stored = String(object?.textboxData?.richTextHtml || '').trim();
    if (stored.length > 0) {
      return stored;
    }
    return '<p><br /></p>';
  };
  const getGradientBackground = (gradient, fallbackStartColor, fallbackEndColor) => {
    const gradientStops = Array.isArray(gradient?.stops) && gradient.stops.length >= 2
      ? gradient.stops
        .slice(0, 5)
        .sort((a, b) => toNumber(a?.positionPercent, 0) - toNumber(b?.positionPercent, 0))
        .map((stop) =>
          String(stop?.color || gradient.colorA || fallbackStartColor) + ' ' +
          String(clamp(toNumber(stop?.positionPercent, 0), 0, 100)) + '%')
      : [
          String(gradient?.colorA || fallbackStartColor) + ' 0%',
          String(gradient?.colorB || fallbackEndColor) + ' 100%',
        ];
    if (gradient?.gradientType === 'circles') {
      const circleLayers = Array.isArray(gradient?.stops) && gradient.stops.length >= 2
        ? gradient.stops
          .slice(0, 5)
          .map((stop, index) => {
            const xPercent = clamp(toNumber(stop?.xPercent, index === 0 ? 35 : 65), 0, 100);
            const yPercent = clamp(toNumber(stop?.yPercent, 50), 0, 100);
            const radiusPercent = clamp(toNumber(stop?.positionPercent, 42), 8, 100);
            const color = String(stop?.color || gradient.colorA || fallbackStartColor);
            return 'radial-gradient(circle at ' + String(xPercent) + '% ' + String(yPercent) +
              '%, ' + color + ' 0%, transparent ' + String(radiusPercent) + '%)';
          })
          .join(', ')
        : '';
      if (circleLayers.length > 0) {
        return circleLayers + ', ' + String(gradient.colorB || fallbackEndColor);
      }
    }
    if (gradient?.gradientType === 'radial') {
      return 'radial-gradient(circle, ' + gradientStops.join(', ') + ')';
    }
    return 'linear-gradient(' + String(toNumber(gradient?.angleDeg, 45)) + 'deg, ' +
      gradientStops.join(', ') + ')';
  };
  const getShapeStyle = (object) => ({
    fillMode: object?.shapeData?.fillMode || 'solid',
    fillColor: object?.shapeData?.fillColor || '#244a80',
    fillGradient: object?.shapeData?.fillGradient || null,
    borderColor: object?.shapeData?.borderColor || '#8fb0e6',
    borderType: object?.shapeData?.borderType || 'solid',
    borderWidth: clamp(toNumber(object?.shapeData?.borderWidth, 1), 0, 20),
    radius: clamp(toNumber(object?.shapeData?.radius, 0), 0, 1000),
    opacityPercent: clamp(toNumber(object?.shapeData?.opacityPercent, 100), 0, 100),
  });
  const getShapeBackground = (shapeStyle) => {
    if (shapeStyle.fillMode === 'linearGradient' && shapeStyle.fillGradient) {
      return getGradientBackground(shapeStyle.fillGradient, shapeStyle.fillColor, '#ffffff');
    }
    return shapeStyle.fillColor;
  };
  const getTextboxStyle = (object) => ({
    fillMode: object?.textboxData?.fillMode || 'solid',
    backgroundColor: object?.textboxData?.backgroundColor || '#1f3151',
    fillGradient: object?.textboxData?.fillGradient || null,
    borderColor: object?.textboxData?.borderColor || '#b2c6ee',
    borderType: object?.textboxData?.borderType || 'solid',
    borderWidth: clamp(toNumber(object?.textboxData?.borderWidth, 1), 0, 20),
    opacityPercent: clamp(toNumber(object?.textboxData?.opacityPercent, 100), 0, 100),
  });
  const getImageStyle = (object) => ({
    borderColor: object?.imageData?.borderColor || '#b2c6ee',
    borderType: object?.imageData?.borderType || 'solid',
    borderWidth: clamp(toNumber(object?.imageData?.borderWidth, 0), 0, 20),
    radius: clamp(toNumber(object?.imageData?.radius, 0), 0, 1000),
    opacityPercent: clamp(toNumber(object?.imageData?.opacityPercent, 100), 0, 100),
    cropLeftPercent: clamp(toNumber(object?.imageData?.cropLeftPercent, 0), 0, 100),
    cropTopPercent: clamp(toNumber(object?.imageData?.cropTopPercent, 0), 0, 100),
    cropRightPercent: clamp(toNumber(object?.imageData?.cropRightPercent, 0), 0, 100),
    cropBottomPercent: clamp(toNumber(object?.imageData?.cropBottomPercent, 0), 0, 100),
  });
  const getTextboxBackground = (textboxStyle) => {
    if (textboxStyle.fillMode === 'linearGradient' && textboxStyle.fillGradient) {
      return getGradientBackground(
        textboxStyle.fillGradient,
        textboxStyle.backgroundColor,
        '#ffffff'
      );
    }
    return textboxStyle.backgroundColor;
  };

  const getImageSrc = (assetId) => {
    const asset = assetsById[assetId];
    if (!asset || !asset.mimeType || !asset.dataBase64) {
      return null;
    }
    return 'data:' + asset.mimeType + ';base64,' + asset.dataBase64;
  };

  const getViewport = () => ({ width: window.innerWidth, height: window.innerHeight });
  const getSlideCamera = (slide) =>
    slide
      ? {
          x: toNumber(slide.x, 0),
          y: toNumber(slide.y, 0),
          zoom: clamp(toNumber(slide.zoom, 1), 0.01, 100),
          rotation: toNumber(slide.rotation, 0),
        }
      : { x: 0, y: 0, zoom: 1, rotation: 0 };
  const stopTransition = () => {
    if (transitionFrame !== null) {
      cancelAnimationFrame(transitionFrame);
      transitionFrame = null;
    }
  };

  const renderCamera = (camera) => {
    const viewport = getViewport();
    stage.innerHTML = '';

    const objects = Array.isArray(model.objects) ? [...model.objects] : [];
    objects.sort((a, b) => a.zIndex - b.zIndex);

    for (const object of objects) {
      if (object.type === 'group') {
        continue;
      }

      const center = worldToScreen(
        { x: toNumber(object.x, 0), y: toNumber(object.y, 0) },
        camera,
        viewport
      );
      const width = Math.max(1, toNumber(object.w, 1) * camera.zoom);
      const height = Math.max(1, toNumber(object.h, 1) * camera.zoom);
      const element = document.createElement('div');
      element.className = 'export-object ' + object.type;
      element.style.left = String(center.x - width / 2) + 'px';
      element.style.top = String(center.y - height / 2) + 'px';
      element.style.width = String(width) + 'px';
      element.style.height = String(height) + 'px';
      element.style.transform =
        'rotate(' + String(toNumber(object.rotation, 0) + camera.rotation) + 'rad)';

      if (object.type === 'shape_rect' || object.type === 'shape_circle' || object.type === 'shape_arrow') {
        const shapeStyle = getShapeStyle(object);
        element.style.borderWidth = String(shapeStyle.borderWidth * camera.zoom) + 'px';
        element.style.borderStyle = shapeStyle.borderType;
        element.style.borderColor = shapeStyle.borderColor;
        element.style.background = getShapeBackground(shapeStyle);
        element.style.opacity = String(shapeStyle.opacityPercent / 100);
        element.style.borderRadius =
          object.type === 'shape_circle'
            ? '999px'
            : String(shapeStyle.radius * camera.zoom) + 'px';
        if (object.type === 'shape_arrow') {
          element.textContent = '→';
          element.style.display = 'grid';
          element.style.placeItems = 'center';
          element.style.fontSize = '24px';
        }
      } else if (object.type === 'image') {
        const imageStyle = getImageStyle(object);
        element.style.borderWidth = String(imageStyle.borderWidth * camera.zoom) + 'px';
        element.style.borderStyle = imageStyle.borderType;
        element.style.borderColor = imageStyle.borderColor;
        element.style.borderRadius = String(imageStyle.radius * camera.zoom) + 'px';
        element.style.opacity = String(imageStyle.opacityPercent / 100);
        element.style.background = 'transparent';
        const src = getImageSrc(object.imageData?.assetId);
        if (src) {
          const image = document.createElement('img');
          image.src = src;
          image.alt = '';
          image.style.width = String(Math.max(1, object.w * camera.zoom)) + 'px';
          image.style.height = String(Math.max(1, object.h * camera.zoom)) + 'px';
          image.style.objectFit = 'fill';
          const cropIsApplied =
            imageStyle.cropLeftPercent > 0.01 ||
            imageStyle.cropTopPercent > 0.01 ||
            imageStyle.cropRightPercent > 0.01 ||
            imageStyle.cropBottomPercent > 0.01;
          image.style.clipPath = cropIsApplied
            ? 'inset(' +
              String(imageStyle.cropTopPercent) + '% ' +
              String(imageStyle.cropRightPercent) + '% ' +
              String(imageStyle.cropBottomPercent) + '% ' +
              String(imageStyle.cropLeftPercent) + '%)'
            : 'none';
          image.draggable = false;
          element.appendChild(image);
        }
      } else if (object.type === 'textbox') {
        const textboxStyle = getTextboxStyle(object);
        element.style.borderWidth = String(textboxStyle.borderWidth * camera.zoom) + 'px';
        element.style.borderStyle = textboxStyle.borderType;
        element.style.borderColor = textboxStyle.borderColor;
        element.style.background = getTextboxBackground(textboxStyle);
        element.style.opacity = String(textboxStyle.opacityPercent / 100);
        element.style.padding = '0';
        const richContent = document.createElement('div');
        richContent.className = 'export-textbox-content textbox-rich-content';
        richContent.style.transform = 'scale(' + String(clamp(toNumber(camera.zoom, 1), 0.01, 100)) + ')';
        richContent.style.transformOrigin = 'top left';
        richContent.style.width = String(100 / clamp(toNumber(camera.zoom, 1), 0.01, 100)) + '%';
        richContent.style.height = String(100 / clamp(toNumber(camera.zoom, 1), 0.01, 100)) + '%';
        richContent.style.fontFamily = String(object?.textboxData?.fontFamily || 'Space Grotesk');
        richContent.innerHTML = getTextboxHtml(object);
        element.appendChild(richContent);
      }

      stage.appendChild(element);
    }
  };

  const transitionToSlide = (slide, forceInstant) => {
    const targetCamera = getSlideCamera(slide);
    const transitionType = forceInstant ? 'instant' : slide?.transitionType || 'ease';
    const durationMs =
      transitionType === 'instant'
        ? 0
        : resolveTransitionDurationMs(transitionType, slide?.transitionDurationMs ?? 2000);

    stopTransition();
    if (durationMs <= 0) {
      currentCamera = targetCamera;
      renderCamera(currentCamera);
      return;
    }

    const startCamera = currentCamera;
    const startedAtMs = performance.now();
    const tick = (nowMs) => {
      const progress = clamp((nowMs - startedAtMs) / durationMs, 0, 1);
      const eased = resolveTransitionProgress(transitionType, progress);
      currentCamera = interpolateCamera(startCamera, targetCamera, eased);
      renderCamera(currentCamera);
      if (progress < 1) {
        transitionFrame = requestAnimationFrame(tick);
      } else {
        transitionFrame = null;
      }
    };
    transitionFrame = requestAnimationFrame(tick);
  };

  const setSlideIndex = (nextIndex, forceInstant = false) => {
    if (slides.length === 0) {
      transitionToSlide(null, true);
      title.textContent = model.meta?.title || 'Export';
      count.textContent = '0 / 0';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }

    const bounded = Math.max(0, Math.min(slides.length - 1, nextIndex));
    currentSlideIndex = bounded;
    const slide = slides[bounded];
    transitionToSlide(slide, forceInstant);
    title.textContent = slide?.name || model.meta?.title || 'Export';
    count.textContent = String(bounded + 1) + ' / ' + String(slides.length);
    prevBtn.disabled = bounded <= 0;
    nextBtn.disabled = bounded >= slides.length - 1;
  };

  prevBtn.addEventListener('click', () => setSlideIndex(currentSlideIndex - 1));
  nextBtn.addEventListener('click', () => setSlideIndex(currentSlideIndex + 1));
  window.addEventListener('resize', () => renderCamera(currentCamera));
  setSlideIndex(START_SLIDE_INDEX, true);
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
      background: ${stageBackground};
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
    }
    .export-object.textbox {
      display: block;
      white-space: normal;
      padding: 0;
    }
    .export-textbox-content {
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    .textbox-rich-content {
      width: 100%;
      height: 100%;
      padding: 3.84px 6.08px;
      line-height: 1.35;
      white-space: pre-wrap;
      outline: none;
      color: #e9f2ff;
    }
    .textbox-rich-content p {
      margin: 0;
    }
    .textbox-rich-content ul,
    .textbox-rich-content ol {
      margin: 0;
      padding-left: 1.2em;
    }
    .textbox-rich-content.textbox-align-left {
      text-align: left;
    }
    .textbox-rich-content.textbox-align-center {
      text-align: center;
    }
    .textbox-rich-content.textbox-align-right {
      text-align: right;
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
