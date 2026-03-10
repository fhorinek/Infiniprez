import type { DocumentModel } from '../model'
import { resolveLibraryAssetKind } from '../assetFile'
import { buildAssetFontFaceCss, resolveAssetFontFamily } from '../fontAssets'
import {
  buildPresentationScene,
  resolveTransitionDurationMs,
  shouldAutoAdvanceSlide,
  PRESENTATION_BACKWARD_KEYS,
  PRESENTATION_FORWARD_KEYS,
} from '../presentation'
import { resolveTextboxBaseTextStyle, textboxUsesFontFamily } from '../textboxRichText'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function collectExportAssets(document: DocumentModel) {
  const usedAssetIds = new Set<string>()

  document.objects.forEach((object) => {
    if (object.type === 'image') {
      usedAssetIds.add(object.imageData.assetId)
      return
    }
    if (object.type === 'video') {
      usedAssetIds.add(object.videoData.assetId)
      return
    }
    if (object.type === 'sound') {
      usedAssetIds.add(object.soundData.assetId)
      return
    }
    if (object.type !== 'textbox') {
      return
    }
    document.assets.forEach((asset) => {
      if (resolveLibraryAssetKind(asset) !== 'font') {
        return
      }
      if (!textboxUsesFontFamily(object.textboxData, resolveAssetFontFamily(asset))) {
        return
      }
      usedAssetIds.add(asset.id)
    })
  })

  return document.assets.filter((asset) => usedAssetIds.has(asset.id))
}

export function buildPresentationExportHtml(document: DocumentModel): string {
  const exportAssets = collectExportAssets(document)
  const exportDocument = {
    ...document,
    assets: exportAssets,
  }
  const serialized = JSON.stringify(exportDocument)
  const serializedForwardKeys = JSON.stringify(PRESENTATION_FORWARD_KEYS)
  const serializedBackwardKeys = JSON.stringify(PRESENTATION_BACKWARD_KEYS)
  const serializedResolveTransitionDurationMs = resolveTransitionDurationMs.toString()
  const serializedShouldAutoAdvanceSlide = shouldAutoAdvanceSlide.toString()
  const serializedBuildPresentationScene = buildPresentationScene.toString()
  const fontAssetCss = buildAssetFontFaceCss(exportAssets)
  const stageBackground = escapeHtml(
    document.canvas.background || 'radial-gradient(circle at 20% 20%, #1f365a 0%, #0f1523 55%)'
  )
  const serializedAssets = JSON.stringify(
    Object.fromEntries(
      exportAssets.map((asset) => [
        asset.id,
        {
          name: asset.name,
          mimeType: asset.mimeType,
          dataBase64: asset.dataBase64,
        },
      ])
    )
  )
  const serializedTextboxBaseStyles = JSON.stringify(
    Object.fromEntries(
      document.objects
        .filter((object) => object.type === 'textbox')
        .map((object) => [object.id, resolveTextboxBaseTextStyle(object.textboxData)])
    )
  )

  const runtimeScript = `
(() => {
  const model = window.__INFINIPREZ_EXPORT__;
  const assetsById = window.__INFINIPREZ_EXPORT_ASSETS__ || {};
  const textboxBaseStylesById = window.__INFINIPREZ_EXPORT_TEXTBOX_STYLES__ || {};
  const stage = document.getElementById('stage');
  const prevBtn = document.getElementById('prev-slide');
  const nextBtn = document.getElementById('next-slide');
  const freeBtn = document.getElementById('free-move');
  const title = document.getElementById('slide-title');
  const count = document.getElementById('slide-count');
  const cameraLayer = document.createElement('div');
  cameraLayer.className = 'export-stage-camera';
  const objectsLayer = document.createElement('div');
  objectsLayer.className = 'export-stage-objects';
  cameraLayer.appendChild(objectsLayer);
  stage.appendChild(cameraLayer);
  const slides = Array.isArray(model.slides)
    ? [...model.slides].sort((a, b) => a.orderIndex - b.orderIndex)
    : [];
  const START_SLIDE_INDEX = 0;
  let currentSlideIndex = 0;
  let currentCamera = { x: 0, y: 0, zoom: 1, rotation: 0 };
  let timedAdvanceTimeout = null;
  let freeMoveEnabled = false;
  let panInteraction = null;
  let wheelNavigateThrottleUntil = 0;
  let fullscreenAttempted = false;
  const CAMERA_ROTATION_STEP_RAD = (10 * Math.PI) / 180;
  const FORWARD_KEYS = ${serializedForwardKeys};
  const BACKWARD_KEYS = ${serializedBackwardKeys};

  const toNumber = (value, fallback) => (Number.isFinite(value) ? value : fallback);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const resolveTransitionDurationMs = ${serializedResolveTransitionDurationMs};
  const shouldAutoAdvanceSlide = ${serializedShouldAutoAdvanceSlide};
  const buildPresentationScene = ${serializedBuildPresentationScene};

  const rotatePoint = (point, radians) => {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
      x: point.x * cos - point.y * sin,
      y: point.x * sin + point.y * cos,
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

  const getViewport = () => ({ width: window.innerWidth, height: window.innerHeight });
  const getSlideCamera = (slide) =>
    slide
      ? {
          x: toNumber(slide.x, 0),
          y: toNumber(slide.y, 0),
          zoom: (() => {
            const diagonal = toNumber(slide.diagonal, NaN);
            if (Number.isFinite(diagonal) && diagonal > 0) {
              const defaultFrameHalfDiagonal = Math.hypot(1600, 900) / 2;
              return clamp(defaultFrameHalfDiagonal / diagonal, 0.01, 100);
            }
            return clamp(toNumber(slide.zoom, 1), 0.01, 100);
          })(),
          rotation: toNumber(slide.rotation, 0),
        }
      : { x: 0, y: 0, zoom: 1, rotation: 0 };
  const applyCameraTransition = (transitionType, durationMs) => {
    if (transitionType === 'instant' || durationMs <= 0) {
      cameraLayer.style.transition = 'none';
      return;
    }
    const easing = transitionType === 'linear' ? 'linear' : 'cubic-bezier(0.645, 0.045, 0.355, 1)';
    cameraLayer.style.transition = 'transform ' + String(durationMs) + 'ms ' + easing;
  };
  const stopTimedAdvance = () => {
    if (timedAdvanceTimeout !== null) {
      window.clearTimeout(timedAdvanceTimeout);
      timedAdvanceTimeout = null;
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
    const onFirstInteraction = (event) => {
      window.removeEventListener('pointerdown', onFirstInteraction, true);
      window.removeEventListener('keydown', onFirstInteraction, true);
      if (event && typeof event.preventDefault === 'function' && event.cancelable) {
        event.preventDefault();
      }
      if (event && typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
      if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
      }
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
  const getVisibleWorldBounds = (camera) => {
    const viewport = getViewport();
    const corners = [
      screenToWorld({ x: 0, y: 0 }, camera, viewport),
      screenToWorld({ x: viewport.width, y: 0 }, camera, viewport),
      screenToWorld({ x: 0, y: viewport.height }, camera, viewport),
      screenToWorld({ x: viewport.width, y: viewport.height }, camera, viewport),
    ];
    return {
      minX: Math.min(...corners.map((corner) => corner.x)),
      minY: Math.min(...corners.map((corner) => corner.y)),
      maxX: Math.max(...corners.map((corner) => corner.x)),
      maxY: Math.max(...corners.map((corner) => corner.y)),
    };
  };
  const mergeWorldBounds = (a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  });
  const expandWorldBounds = (bounds, padding) => {
    const safePadding = Math.max(0, padding);
    return {
      minX: bounds.minX - safePadding,
      minY: bounds.minY - safePadding,
      maxX: bounds.maxX + safePadding,
      maxY: bounds.maxY + safePadding,
    };
  };

  const applyCameraTransform = (camera) => {
    const viewport = getViewport();
    cameraLayer.style.transform =
      'translate(' + String(viewport.width / 2) + 'px, ' + String(viewport.height / 2) + 'px) ' +
      'rotate(' + String(camera.rotation) + 'rad) ' +
      'scale(' + String(camera.zoom) + ') ' +
      'translate(' + String(-camera.x) + 'px, ' + String(-camera.y) + 'px)';
  };

  const renderScene = (cullingBounds, enableCulling) => {
    buildPresentationScene({
      documentRef: document,
      layer: objectsLayer,
      objects: model.objects,
      assetsById,
      objectClassPrefix: 'export',
      textboxHtmlResolver: (object) => {
        const stored = String(object?.textboxData?.richTextHtml || '').trim();
        if (stored.length > 0) {
          return stored;
        }
        return '<p><br /></p>';
      },
      textboxBaseStyleResolver: (object) => {
        const entry = textboxBaseStylesById[object?.id] || null;
        if (entry) {
          return entry;
        }
        return {
          fontFamily: String(object?.textboxData?.fontFamily || 'Arial'),
          fontSizePx: toNumber(object?.textboxData?.fontSizePx, 28),
          textColor: String(object?.textboxData?.textColor || '#f0f3fc'),
        };
      },
      enableCulling: Boolean(enableCulling),
      cullingBounds: enableCulling ? cullingBounds : null,
    });
  };

  const renderCamera = (camera) => {
    applyCameraTransform(camera);
  };

  const transitionToSlide = (slide, forceInstant) => {
    const targetCamera = getSlideCamera(slide);
    const startCamera = currentCamera;
    const transitionType = forceInstant ? 'instant' : slide?.transitionType || 'ease';
    const durationMs =
      transitionType === 'instant'
        ? 0
        : resolveTransitionDurationMs(transitionType, slide?.transitionDurationMs ?? 2000);
    const shouldCullForTransition = !freeMoveEnabled && durationMs <= 0;
    const mergedBounds = mergeWorldBounds(
      getVisibleWorldBounds(startCamera),
      getVisibleWorldBounds(targetCamera)
    );
    const viewport = getViewport();
    const minZoom = Math.max(0.01, Math.min(startCamera.zoom, targetCamera.zoom));
    const transitionPadding = Math.hypot(viewport.width, viewport.height) / (2 * minZoom);
    const cullingBounds = expandWorldBounds(mergedBounds, transitionPadding);
    renderScene(cullingBounds, shouldCullForTransition);

    applyCameraTransition(transitionType, durationMs);
    currentCamera = targetCamera;
    renderCamera(currentCamera);
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
  const syncTimedAdvance = () => {
    stopTimedAdvance();
    const slide = slides[currentSlideIndex] || null;
    if (freeMoveEnabled || !shouldAutoAdvanceSlide(slide, currentSlideIndex, slides.length)) {
      return;
    }
    const delayMs = Math.max(0, Math.round(toNumber(slide.triggerDelayMs, 0)));
    timedAdvanceTimeout = window.setTimeout(() => {
      setSlideIndex(currentSlideIndex + 1);
    }, delayMs);
  };

  const setSlideIndex = (nextIndex, forceInstant = false) => {
    stopTimedAdvance();
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
    syncTimedAdvance();
  };
  const setFreeMoveEnabled = (nextValue) => {
    const nextEnabled = Boolean(nextValue);
    if (freeMoveEnabled === nextEnabled) {
      return;
    }
    freeMoveEnabled = nextEnabled;
    applyCameraTransition('instant', 0);
    stage.classList.toggle('free-move-enabled', freeMoveEnabled);
    stage.classList.remove('dragging');
    if (freeMoveEnabled) {
      renderScene(null, false);
    }
    if (freeBtn) {
      freeBtn.classList.toggle('active', freeMoveEnabled);
      freeBtn.setAttribute('aria-pressed', freeMoveEnabled ? 'true' : 'false');
      freeBtn.title = freeMoveEnabled ? 'Disable free move' : 'Enable free move';
    }
    stopTimedAdvance();
    if (!freeMoveEnabled && slides.length > 0) {
      transitionToSlide(slides[currentSlideIndex], true);
    }
    updateNavigationState();
    syncTimedAdvance();
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
  window.addEventListener('keydown', (event) => {
    if (FORWARD_KEYS.includes(event.key)) {
      event.preventDefault();
      setSlideIndex(currentSlideIndex + 1);
      return;
    }
    if (BACKWARD_KEYS.includes(event.key)) {
      event.preventDefault();
      setSlideIndex(currentSlideIndex - 1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        void document.exitFullscreen().catch(() => undefined);
      }
    }
  });
  window.addEventListener('resize', () => renderCamera(currentCamera));
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
    content="default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none';"
  />
  <title>${escapeHtml(document.meta.title || 'Infiniprez Export')}</title>
  <style>
    ${fontAssetCss}
    :root {
      color-scheme: dark;
      font-family: Arial, Verdana, sans-serif;
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
    .export-stage-camera {
      position: absolute;
      inset: 0;
      transform-origin: 0 0;
      will-change: transform;
      pointer-events: none;
    }
    .export-stage-objects {
      position: absolute;
      left: 0;
      top: 0;
      pointer-events: none;
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
      user-select: none;
      overflow: hidden;
      pointer-events: none;
      display: grid;
      place-items: center;
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
    .export-object.template_placeholder {
      --export-template-scale: 1;
      border-width: calc(1px * var(--export-template-scale));
      border-style: dashed;
      border-color: rgba(183, 213, 255, 0.6);
      background:
        linear-gradient(135deg, rgba(27, 44, 74, 0.82), rgba(18, 28, 47, 0.9));
      padding: 0;
    }
    .export-object.sound {
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: center;
      gap: 0.7rem;
      padding: 0.7rem 0.9rem;
      background: linear-gradient(135deg, rgba(32, 52, 92, 0.92), rgba(19, 28, 48, 0.96));
      cursor: pointer;
    }
    .export-template-placeholder {
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      display: grid;
      place-items: center;
      gap: calc(0.35rem * var(--export-template-scale));
      padding: calc(0.8rem * var(--export-template-scale));
      text-align: center;
    }
    .export-template-placeholder span {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: calc(3.8rem * var(--export-template-scale));
      padding: calc(0.2rem * var(--export-template-scale))
        calc(0.55rem * var(--export-template-scale));
      border-radius: 999px;
      border: calc(1px * var(--export-template-scale)) solid rgba(197, 221, 255, 0.34);
      background: rgba(142, 184, 255, 0.18);
      font-size: calc(0.74rem * var(--export-template-scale));
      font-weight: 800;
      letter-spacing: 0.12em;
    }
    .export-template-placeholder strong {
      max-width: 100%;
      font-size: calc(1rem * var(--export-template-scale));
      line-height: 1.22;
      font-weight: 700;
      white-space: pre-wrap;
    }
    .export-textbox-content {
      position: absolute;
      top: 0;
      left: 0;
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
    .textbox-rich-content ul,
    .textbox-rich-content ol,
    .textbox-rich-content li,
    .textbox-rich-content li::marker {
      font-family: inherit;
      font-size: inherit;
      color: inherit;
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
    .textbox-rich-content.textbox-v-align-middle {
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .textbox-rich-content.textbox-v-align-bottom {
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
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
    window.__INFINIPREZ_EXPORT_TEXTBOX_STYLES__ = ${serializedTextboxBaseStyles};
    ${runtimeScript}
  </script>
</body>
</html>`
}
