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
  const freeBtn = document.getElementById('free-move');
  const title = document.getElementById('slide-title');
  const count = document.getElementById('slide-count');
  const slides = Array.isArray(model.slides)
    ? [...model.slides].sort((a, b) => a.orderIndex - b.orderIndex)
    : [];
  const START_SLIDE_INDEX = 0;
  let currentSlideIndex = 0;
  let currentCamera = { x: 0, y: 0, zoom: 1, rotation: 0 };
  let transitionFrame = null;
  let freeMoveEnabled = false;
  let panInteraction = null;
  let wheelNavigateThrottleUntil = 0;
  let fullscreenAttempted = false;
  const CAMERA_ROTATION_STEP_RAD = (10 * Math.PI) / 180;

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
  const screenToWorld = (screen, camera, viewport) => {
    const centered = {
      x: screen.x - viewport.width / 2,
      y: screen.y - viewport.height / 2,
    };
    const unrotated = rotatePoint(centered, -camera.rotation);
    return {
      x: unrotated.x / camera.zoom + camera.x,
      y: unrotated.y / camera.zoom + camera.y,
    };
  };
  const cameraDragDeltaToWorld = (deltaScreen, camera) => {
    const unrotated = rotatePoint(deltaScreen, -camera.rotation);
    return {
      x: unrotated.x / camera.zoom,
      y: unrotated.y / camera.zoom,
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
    shadowColor: String(object?.shapeData?.shadowColor || '#000000'),
    shadowBlurPx: clamp(toNumber(object?.shapeData?.shadowBlurPx, 0), 0, 200),
    shadowAngleDeg: clamp(toNumber(object?.shapeData?.shadowAngleDeg, 45), -180, 180),
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
    shadowColor: String(object?.textboxData?.shadowColor || '#000000'),
    shadowBlurPx: clamp(toNumber(object?.textboxData?.shadowBlurPx, 0), 0, 200),
    shadowAngleDeg: clamp(toNumber(object?.textboxData?.shadowAngleDeg, 45), -180, 180),
  });
  const resolveImageFilterCss = (effectsEnabled, filterPreset) => {
    if (!effectsEnabled) {
      return 'none';
    }
    switch (filterPreset) {
      case 'bw':
        return 'grayscale(100%)';
      case 'sepia':
        return 'sepia(100%)';
      case 'vibrant':
        return 'saturate(180%) contrast(112%)';
      case 'warm':
        return 'sepia(22%) saturate(128%) hue-rotate(-12deg) brightness(103%)';
      case 'cool':
        return 'saturate(112%) hue-rotate(14deg) brightness(102%)';
      case 'dramatic':
        return 'contrast(140%) saturate(122%) brightness(94%)';
      case 'none':
      default:
        return 'none';
    }
  };
  const resolveShadowCss = (color, blurPx, angleDeg, zoom) => {
    const safeBlur = clamp(toNumber(blurPx, 0), 0, 200);
    if (safeBlur <= 0) {
      return 'none';
    }
    let normalizedAngle = toNumber(angleDeg, 45);
    while (normalizedAngle > 180) {
      normalizedAngle -= 360;
    }
    while (normalizedAngle < -180) {
      normalizedAngle += 360;
    }
    const angleRad = (normalizedAngle * Math.PI) / 180;
    const safeZoom = Math.max(0.01, toNumber(zoom, 1));
    const distance = 12 * safeZoom;
    const offsetX = Math.cos(angleRad) * distance;
    const offsetY = Math.sin(angleRad) * distance;
    return String(offsetX.toFixed(2)) + 'px ' +
      String(offsetY.toFixed(2)) + 'px ' +
      String((safeBlur * safeZoom).toFixed(2)) + 'px ' +
      String(color || '#000000');
  };
  const resolveShadowFilter = (color, blurPx, angleDeg, zoom) => {
    const shadow = resolveShadowCss(color, blurPx, angleDeg, zoom);
    if (shadow === 'none') {
      return 'none';
    }
    return 'drop-shadow(' + shadow + ')';
  };
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
    effectsEnabled: Boolean(object?.imageData?.effectsEnabled),
    filterPreset: ['none', 'bw', 'sepia', 'vibrant', 'warm', 'cool', 'dramatic'].includes(String(object?.imageData?.filterPreset))
      ? String(object?.imageData?.filterPreset)
      : 'none',
    shadowColor: String(object?.imageData?.shadowColor || '#000000'),
    shadowBlurPx: clamp(toNumber(object?.imageData?.shadowBlurPx, 0), 0, 200),
    shadowAngleDeg: clamp(toNumber(object?.imageData?.shadowAngleDeg, 45), -180, 180),
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
  const tryEnterFullscreen = () => {
    if (fullscreenAttempted) {
      return;
    }
    fullscreenAttempted = true;
    const doc = document;
    const root = doc.documentElement;
    const request =
      root.requestFullscreen ||
      root.webkitRequestFullscreen ||
      root.mozRequestFullScreen ||
      root.msRequestFullscreen;
    if (typeof request !== 'function') {
      return;
    }
    try {
      const result = request.call(root);
      if (result && typeof result.catch === 'function') {
        result.catch(() => undefined);
      }
    } catch {
      // Ignore fullscreen request errors in restricted environments.
    }
  };
  const setupFullscreenFallback = () => {
    if (document.fullscreenElement) {
      return;
    }
    const onFirstInteraction = () => {
      window.removeEventListener('pointerdown', onFirstInteraction, true);
      window.removeEventListener('keydown', onFirstInteraction, true);
      tryEnterFullscreen();
    };
    window.addEventListener('pointerdown', onFirstInteraction, true);
    window.addEventListener('keydown', onFirstInteraction, true);
  };
  const getStageRelativePoint = (clientX, clientY) => {
    const bounds = stage.getBoundingClientRect();
    return {
      x: clientX - bounds.left,
      y: clientY - bounds.top,
    };
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
        element.style.boxShadow = resolveShadowCss(
          shapeStyle.shadowColor,
          shapeStyle.shadowBlurPx,
          shapeStyle.shadowAngleDeg,
          camera.zoom
        );
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
        element.style.opacity = String(imageStyle.opacityPercent / 100);
        element.style.background = 'transparent';
        element.style.filter = resolveShadowFilter(
          imageStyle.shadowColor,
          imageStyle.shadowBlurPx,
          imageStyle.shadowAngleDeg,
          camera.zoom
        );
        const clipLayer = document.createElement('div');
        clipLayer.className = 'export-image-clip';
        clipLayer.style.borderWidth = String(imageStyle.borderWidth * camera.zoom) + 'px';
        clipLayer.style.borderStyle = imageStyle.borderType;
        clipLayer.style.borderColor = imageStyle.borderColor;
        clipLayer.style.clipPath =
          'inset(' +
          String(imageStyle.cropTopPercent) + '% ' +
          String(imageStyle.cropRightPercent) + '% ' +
          String(imageStyle.cropBottomPercent) + '% ' +
          String(imageStyle.cropLeftPercent) + '% round ' +
          String(imageStyle.radius * camera.zoom) + 'px)';
        const src = getImageSrc(object.imageData?.assetId);
        if (src) {
          const image = document.createElement('img');
          image.src = src;
          image.alt = '';
          image.style.width = String(Math.max(1, object.w * camera.zoom)) + 'px';
          image.style.height = String(Math.max(1, object.h * camera.zoom)) + 'px';
          image.style.objectFit = 'fill';
          image.style.filter = resolveImageFilterCss(imageStyle.effectsEnabled, imageStyle.filterPreset);
          image.draggable = false;
          clipLayer.appendChild(image);
        }
        element.appendChild(clipLayer);
      } else if (object.type === 'textbox') {
        const textboxStyle = getTextboxStyle(object);
        element.style.borderWidth = String(textboxStyle.borderWidth * camera.zoom) + 'px';
        element.style.borderStyle = textboxStyle.borderType;
        element.style.borderColor = textboxStyle.borderColor;
        element.style.background = getTextboxBackground(textboxStyle);
        element.style.opacity = String(textboxStyle.opacityPercent / 100);
        element.style.boxShadow = resolveShadowCss(
          textboxStyle.shadowColor,
          textboxStyle.shadowBlurPx,
          textboxStyle.shadowAngleDeg,
          camera.zoom
        );
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
  const updateNavigationState = () => {
    if (slides.length === 0) {
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }
    prevBtn.disabled = freeMoveEnabled || currentSlideIndex <= 0;
    nextBtn.disabled = freeMoveEnabled || currentSlideIndex >= slides.length - 1;
  };

  const setSlideIndex = (nextIndex, forceInstant = false) => {
    if (slides.length === 0) {
      transitionToSlide(null, true);
      title.textContent = model.meta?.title || 'Export';
      count.textContent = '0 / 0';
      updateNavigationState();
      return;
    }

    const bounded = Math.max(0, Math.min(slides.length - 1, nextIndex));
    currentSlideIndex = bounded;
    const slide = slides[bounded];
    transitionToSlide(slide, forceInstant);
    title.textContent = slide?.name || model.meta?.title || 'Export';
    count.textContent = String(bounded + 1) + ' / ' + String(slides.length);
    updateNavigationState();
  };
  const setFreeMoveEnabled = (nextValue) => {
    const nextEnabled = Boolean(nextValue);
    if (freeMoveEnabled === nextEnabled) {
      return;
    }
    freeMoveEnabled = nextEnabled;
    stage.classList.toggle('free-move-enabled', freeMoveEnabled);
    stage.classList.remove('dragging');
    if (freeBtn) {
      freeBtn.classList.toggle('active', freeMoveEnabled);
      freeBtn.setAttribute('aria-pressed', freeMoveEnabled ? 'true' : 'false');
      freeBtn.title = freeMoveEnabled ? 'Disable free move' : 'Enable free move';
    }
    if (!freeMoveEnabled && slides.length > 0) {
      transitionToSlide(slides[currentSlideIndex], true);
    }
    updateNavigationState();
  };

  prevBtn.addEventListener('click', () => setSlideIndex(currentSlideIndex - 1));
  nextBtn.addEventListener('click', () => setSlideIndex(currentSlideIndex + 1));
  if (freeBtn) {
    freeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      setFreeMoveEnabled(!freeMoveEnabled);
    });
  }
  stage.addEventListener('pointerdown', (event) => {
    if (freeMoveEnabled) {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      panInteraction = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startCamera: { ...currentCamera },
      };
      stage.classList.add('dragging');
      stage.setPointerCapture(event.pointerId);
      return;
    }

    if (event.button === 0) {
      event.preventDefault();
      setSlideIndex(currentSlideIndex + 1);
      return;
    }
    if (event.button === 2) {
      event.preventDefault();
      setSlideIndex(currentSlideIndex - 1);
    }
  });
  stage.addEventListener('pointermove', (event) => {
    if (!freeMoveEnabled || !panInteraction || panInteraction.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const deltaWorld = cameraDragDeltaToWorld(
      {
        x: event.clientX - panInteraction.startClientX,
        y: event.clientY - panInteraction.startClientY,
      },
      panInteraction.startCamera
    );
    currentCamera = {
      ...panInteraction.startCamera,
      x: panInteraction.startCamera.x - deltaWorld.x,
      y: panInteraction.startCamera.y - deltaWorld.y,
    };
    renderCamera(currentCamera);
  });
  const releasePan = (event) => {
    if (!panInteraction || panInteraction.pointerId !== event.pointerId) {
      return;
    }
    panInteraction = null;
    stage.classList.remove('dragging');
    if (stage.hasPointerCapture(event.pointerId)) {
      stage.releasePointerCapture(event.pointerId);
    }
  };
  stage.addEventListener('pointerup', releasePan);
  stage.addEventListener('pointercancel', releasePan);
  stage.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      if (freeMoveEnabled) {
        const pointerScreen = getStageRelativePoint(event.clientX, event.clientY);
        const viewport = getViewport();
        const worldBefore = screenToWorld(pointerScreen, currentCamera, viewport);
        if (event.altKey) {
          const rotationDelta = clamp(
            (event.deltaY / 120) * CAMERA_ROTATION_STEP_RAD,
            -CAMERA_ROTATION_STEP_RAD * 6,
            CAMERA_ROTATION_STEP_RAD * 6
          );
          if (Math.abs(rotationDelta) < 0.0001) {
            return;
          }
          const rotatedCamera = {
            ...currentCamera,
            rotation: currentCamera.rotation + rotationDelta,
          };
          const worldAfter = screenToWorld(pointerScreen, rotatedCamera, viewport);
          currentCamera = {
            ...rotatedCamera,
            x: rotatedCamera.x + (worldBefore.x - worldAfter.x),
            y: rotatedCamera.y + (worldBefore.y - worldAfter.y),
          };
          renderCamera(currentCamera);
          return;
        }
        const zoomFactor = event.deltaY > 0 ? 0.92 : 1.08;
        const nextZoom = clamp(currentCamera.zoom * zoomFactor, 0.05, 100);
        const nextCamera = { ...currentCamera, zoom: nextZoom };
        const worldAfter = screenToWorld(pointerScreen, nextCamera, viewport);
        currentCamera = {
          ...nextCamera,
          x: nextCamera.x + (worldBefore.x - worldAfter.x),
          y: nextCamera.y + (worldBefore.y - worldAfter.y),
        };
        renderCamera(currentCamera);
        return;
      }

      const now = performance.now();
      if (now < wheelNavigateThrottleUntil || Math.abs(event.deltaY) < 6) {
        return;
      }
      wheelNavigateThrottleUntil = now + 220;
      if (event.deltaY > 0) {
        setSlideIndex(currentSlideIndex + 1);
      } else {
        setSlideIndex(currentSlideIndex - 1);
      }
    },
    { passive: false }
  );
  stage.addEventListener('contextmenu', (event) => {
    if (!freeMoveEnabled) {
      event.preventDefault();
    }
  });
  window.addEventListener('resize', () => renderCamera(currentCamera));
  tryEnterFullscreen();
  setupFullscreenFallback();
  setFreeMoveEnabled(false);
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
      touch-action: none;
    }
    #stage.free-move-enabled {
      cursor: grab;
    }
    #stage.free-move-enabled.dragging {
      cursor: grabbing;
    }
    .present-hud {
      position: fixed;
      right: 0.65rem;
      bottom: 0.65rem;
      z-index: 1200;
      display: flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.28rem 0.38rem;
      border-radius: 999px;
      border: 1px solid rgba(173, 202, 255, 0.22);
      background: rgba(7, 13, 28, 0.58);
      backdrop-filter: blur(4px);
    }
    .present-hud-title {
      font-size: 0.7rem;
      color: #d8e8ff;
      padding: 0 0.1rem;
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .present-hud-status {
      align-self: center;
      font-size: 0.66rem;
      color: #95a6c5;
      padding: 0 0.1rem;
    }
    .present-hud-btn {
      font: inherit;
      font-size: 0.66rem;
      border: 1px solid rgba(173, 202, 255, 0.22);
      border-radius: 999px;
      background: rgba(46, 66, 100, 0.56);
      color: #e9f2ff;
      min-width: 34px;
      padding: 0.18rem 0.46rem;
      cursor: pointer;
    }
    .present-hud-btn.active {
      background: rgba(86, 140, 236, 0.58);
      border-color: rgba(180, 212, 255, 0.54);
    }
    .present-hud-btn:disabled {
      opacity: 0.42;
      cursor: default;
    }
    .export-object {
      position: absolute;
      transform-origin: center center;
      color: #e9f2ff;
      border: 1px solid rgba(175, 199, 240, 0.35);
      user-select: none;
      overflow: hidden;
      pointer-events: none;
      display: grid;
      place-items: center;
      background: rgba(28, 45, 74, 0.45);
    }
    .export-object.image {
      border: 0;
      background: transparent;
      overflow: visible;
      padding: 0;
    }
    .export-image-clip {
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      pointer-events: none;
      display: grid;
      place-items: center;
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
    <div id="hud" class="present-hud">
      <span id="slide-title" class="present-hud-title"></span>
      <span id="slide-count" class="present-hud-status"></span>
      <button id="prev-slide" class="present-hud-btn" type="button" aria-label="Previous slide" title="Previous slide">&#9664;</button>
      <button id="next-slide" class="present-hud-btn" type="button" aria-label="Next slide" title="Next slide">&#9654;</button>
      <button id="free-move" class="present-hud-btn" type="button" aria-label="Enable free move" title="Enable free move">&#9974;</button>
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
