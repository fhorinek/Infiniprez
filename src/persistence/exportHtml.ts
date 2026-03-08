import type { DocumentModel } from '../model'
import { resolveLibraryAssetKind } from '../assetFile'
import { buildAssetFontFaceCss, resolveAssetFontFamily } from '../fontAssets'
import {
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
  const slides = Array.isArray(model.slides)
    ? [...model.slides].sort((a, b) => a.orderIndex - b.orderIndex)
    : [];
  const START_SLIDE_INDEX = 0;
  let currentSlideIndex = 0;
  let currentCamera = { x: 0, y: 0, zoom: 1, rotation: 0 };
  let transitionFrame = null;
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
  const shouldAutoAdvanceSlide = (slide, slideIndex, totalSlides) => {
    if (!slide) {
      return false;
    }
    if (slide.triggerMode !== 'timed') {
      return false;
    }
    return slideIndex >= 0 && slideIndex < totalSlides - 1;
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
  const getTemplatePlaceholderBadge = (kind) => {
    if (kind === 'image') {
      return 'IMG';
    }
    if (kind === 'list') {
      return 'LIST';
    }
    return 'TEXT';
  };
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
    kind: [
      'rect',
      'roundedRect',
      'diamond',
      'triangle',
      'trapezoid',
      'parallelogram',
      'hexagon',
      'pentagon',
      'octagon',
      'star',
      'cloud',
    ].includes(String(object?.shapeData?.kind))
      ? String(object.shapeData.kind)
      : 'rect',
    adjustmentPercent: clamp(toNumber(object?.shapeData?.adjustmentPercent, 50), 0, 100),
    fillMode: object?.shapeData?.fillMode || 'solid',
    fillColor: object?.shapeData?.fillColor || '#244a80',
    fillGradient: object?.shapeData?.fillGradient || null,
    borderColor: object?.shapeData?.borderColor || '#8fb0e6',
    borderType: object?.shapeData?.borderType || 'solid',
    borderWidth: clamp(toNumber(object?.shapeData?.borderWidth, 1), 0, 20),
    radius: clamp(toNumber(object?.shapeData?.radius, 0), 0, 1000000),
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
  const getShapeClipPath = (kind) => {
    switch (kind) {
      case 'diamond':
        return 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
      case 'triangle':
        return 'polygon(50% 0%, 100% 100%, 0% 100%)';
      case 'trapezoid':
        return 'polygon(18% 0%, 82% 0%, 100% 100%, 0% 100%)';
      case 'parallelogram':
        return 'polygon(20% 0%, 100% 0%, 80% 100%, 0% 100%)';
      case 'hexagon':
        return 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
      case 'pentagon':
        return 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)';
      case 'octagon':
        return 'polygon(28% 0%, 72% 0%, 100% 28%, 100% 72%, 72% 100%, 28% 100%, 0% 72%, 0% 28%)';
      case 'star':
        return 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';
      case 'cloud':
        return 'polygon(17% 69%, 9% 58%, 10% 44%, 18% 34%, 31% 31%, 38% 18%, 51% 12%, 64% 17%, 72% 27%, 85% 28%, 94% 38%, 95% 52%, 89% 63%, 78% 69%, 67% 70%, 57% 76%, 44% 77%, 34% 72%, 24% 73%)';
      default:
        return '';
    }
  };
  const toPointPath = (points) => points.map((point, index) =>
    (index === 0 ? 'M ' : 'L ') + point.x + ' ' + point.y
  ).join(' ') + ' Z';
  const toSmoothClosedPath = (points) => {
    if (!points || points.length < 2) {
      return '';
    }
    let path = 'M ' + points[0].x + ' ' + points[0].y;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      const midX = (current.x + next.x) / 2;
      const midY = (current.y + next.y) / 2;
      path += ' Q ' + current.x + ' ' + current.y + ' ' + midX + ' ' + midY;
    }
    return path + ' Z';
  };
  const getRoundedRectPath = (width, height, radius) => {
    const safeRadius = clamp(radius, 0, Math.min(width, height) / 2);
    if (safeRadius <= 0.001) {
      return 'M 0 0 H ' + width + ' V ' + height + ' H 0 Z';
    }
    return [
      'M ' + safeRadius + ' 0',
      'H ' + (width - safeRadius),
      'A ' + safeRadius + ' ' + safeRadius + ' 0 0 1 ' + width + ' ' + safeRadius,
      'V ' + (height - safeRadius),
      'A ' + safeRadius + ' ' + safeRadius + ' 0 0 1 ' + (width - safeRadius) + ' ' + height,
      'H ' + safeRadius,
      'A ' + safeRadius + ' ' + safeRadius + ' 0 0 1 0 ' + (height - safeRadius),
      'V ' + safeRadius,
      'A ' + safeRadius + ' ' + safeRadius + ' 0 0 1 ' + safeRadius + ' 0',
      'Z',
    ].join(' ');
  };
  const getStarPath = (width, height, innerRatio) => {
    const centerX = width / 2;
    const centerY = height / 2;
    const outerRadius = Math.min(width, height) / 2;
    const innerRadius = outerRadius * innerRatio;
    const points = Array.from({ length: 10 }, (_, index) => {
      const isOuter = index % 2 === 0;
      const angle = -Math.PI / 2 + (index * Math.PI) / 5;
      const radius = isOuter ? outerRadius : innerRadius;
      return {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      };
    });
    return toPointPath(points);
  };
  const getCloudPath = (width, height, topPercent) => {
    const topY = clamp(height * (topPercent / 100), height * 0.04, height * 0.38);
    return toSmoothClosedPath([
      { x: width * 0.16, y: height * 0.72 },
      { x: width * 0.08, y: height * 0.59 },
      { x: width * 0.09, y: height * 0.44 },
      { x: width * 0.18, y: height * 0.34 },
      { x: width * 0.31, y: height * 0.32 },
      { x: width * 0.38, y: topY + height * 0.08 },
      { x: width * 0.5, y: topY },
      { x: width * 0.63, y: topY + height * 0.05 },
      { x: width * 0.73, y: height * 0.27 },
      { x: width * 0.86, y: height * 0.3 },
      { x: width * 0.95, y: height * 0.42 },
      { x: width * 0.94, y: height * 0.57 },
      { x: width * 0.84, y: height * 0.68 },
      { x: width * 0.69, y: height * 0.71 },
      { x: width * 0.56, y: height * 0.8 },
      { x: width * 0.42, y: height * 0.79 },
      { x: width * 0.31, y: height * 0.72 },
      { x: width * 0.22, y: height * 0.74 },
    ]);
  };
  const getShapeSvgDescriptor = (type, shapeStyle, width, height) => {
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);
    if (type === 'shape_circle') {
      return {
        kind: 'ellipse',
        cx: safeWidth / 2,
        cy: safeHeight / 2,
        rx: safeWidth / 2,
        ry: safeHeight / 2,
      };
    }
    switch (shapeStyle.kind) {
      case 'roundedRect':
        return { kind: 'path', d: getRoundedRectPath(safeWidth, safeHeight, shapeStyle.radius) };
      case 'diamond':
        return { kind: 'path', d: toPointPath([{ x: safeWidth / 2, y: 0 }, { x: safeWidth, y: safeHeight / 2 }, { x: safeWidth / 2, y: safeHeight }, { x: 0, y: safeHeight / 2 }]) };
      case 'triangle':
        return { kind: 'path', d: toPointPath([{ x: safeWidth / 2, y: 0 }, { x: safeWidth, y: safeHeight }, { x: 0, y: safeHeight }]) };
      case 'trapezoid': {
        const inset = (safeWidth * clamp(shapeStyle.adjustmentPercent, 0, 40)) / 100;
        return { kind: 'path', d: toPointPath([{ x: inset, y: 0 }, { x: safeWidth - inset, y: 0 }, { x: safeWidth, y: safeHeight }, { x: 0, y: safeHeight }]) };
      }
      case 'parallelogram': {
        const skew = (safeWidth * clamp(shapeStyle.adjustmentPercent, 0, 40)) / 100;
        return { kind: 'path', d: toPointPath([{ x: skew, y: 0 }, { x: safeWidth, y: 0 }, { x: safeWidth - skew, y: safeHeight }, { x: 0, y: safeHeight }]) };
      }
      case 'hexagon': {
        const inset = (safeWidth * clamp(shapeStyle.adjustmentPercent, 0, 40)) / 100;
        return { kind: 'path', d: toPointPath([{ x: inset, y: 0 }, { x: safeWidth - inset, y: 0 }, { x: safeWidth, y: safeHeight / 2 }, { x: safeWidth - inset, y: safeHeight }, { x: inset, y: safeHeight }, { x: 0, y: safeHeight / 2 }]) };
      }
      case 'pentagon': {
        const shoulderY = (safeHeight * clamp(shapeStyle.adjustmentPercent, 20, 70)) / 100;
        return { kind: 'path', d: toPointPath([{ x: safeWidth / 2, y: 0 }, { x: safeWidth, y: shoulderY }, { x: safeWidth * 0.82, y: safeHeight }, { x: safeWidth * 0.18, y: safeHeight }, { x: 0, y: shoulderY }]) };
      }
      case 'octagon': {
        const inset = (Math.min(safeWidth, safeHeight) * clamp(shapeStyle.adjustmentPercent, 10, 35)) / 100;
        return { kind: 'path', d: toPointPath([{ x: inset, y: 0 }, { x: safeWidth - inset, y: 0 }, { x: safeWidth, y: inset }, { x: safeWidth, y: safeHeight - inset }, { x: safeWidth - inset, y: safeHeight }, { x: inset, y: safeHeight }, { x: 0, y: safeHeight - inset }, { x: 0, y: inset }]) };
      }
      case 'star':
        return { kind: 'path', d: getStarPath(safeWidth, safeHeight, clamp(shapeStyle.adjustmentPercent, 15, 80) / 100) };
      case 'cloud':
        return { kind: 'path', d: getCloudPath(safeWidth, safeHeight, clamp(shapeStyle.adjustmentPercent, 6, 28)) };
      case 'rect':
      default:
        return { kind: 'path', d: getRoundedRectPath(safeWidth, safeHeight, 0) };
    }
  };
  const getShapeBorderRadius = (kind, radiusPx) => {
    if (kind !== 'rect' && kind !== 'roundedRect') {
      return '0px';
    }
    return String(Math.max(0, radiusPx)) + 'px';
  };
  const getTextboxStyle = (object) => ({
    fillMode: object?.textboxData?.fillMode || 'solid',
    backgroundColor: object?.textboxData?.backgroundColor || '#1f3151',
    fillGradient: object?.textboxData?.fillGradient || null,
    borderColor: object?.textboxData?.borderColor || '#b2c6ee',
    borderType: object?.textboxData?.borderType || 'solid',
    borderWidth: clamp(toNumber(object?.textboxData?.borderWidth, 1), 0, 20),
    radius: clamp(toNumber(object?.textboxData?.radius, 0), 0, 1000000),
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
    radius: clamp(toNumber(object?.imageData?.radius, 0), 0, 1000000),
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
  const getVideoStyle = (object) => ({
    borderColor: object?.videoData?.borderColor || '#b2c6ee',
    borderType: object?.videoData?.borderType || 'solid',
    borderWidth: clamp(toNumber(object?.videoData?.borderWidth, 0), 0, 20),
    radius: clamp(toNumber(object?.videoData?.radius, 0), 0, 1000000),
    opacityPercent: clamp(toNumber(object?.videoData?.opacityPercent, 100), 0, 100),
    autoplay: Boolean(object?.videoData?.autoplay),
    loop: Boolean(object?.videoData?.loop),
    muted: Boolean(object?.videoData?.muted),
    shadowColor: String(object?.videoData?.shadowColor || '#000000'),
    shadowBlurPx: clamp(toNumber(object?.videoData?.shadowBlurPx, 0), 0, 200),
    shadowAngleDeg: clamp(toNumber(object?.videoData?.shadowAngleDeg, 45), -180, 180),
  });
  const getSoundStyle = (object) => ({
    borderColor: object?.soundData?.borderColor || '#b2c6ee',
    borderType: object?.soundData?.borderType || 'solid',
    borderWidth: clamp(toNumber(object?.soundData?.borderWidth, 0), 0, 20),
    radius: clamp(toNumber(object?.soundData?.radius, 18), 0, 1000000),
    opacityPercent: clamp(toNumber(object?.soundData?.opacityPercent, 100), 0, 100),
    loop: Boolean(object?.soundData?.loop),
    shadowColor: String(object?.soundData?.shadowColor || '#000000'),
    shadowBlurPx: clamp(toNumber(object?.soundData?.shadowBlurPx, 0), 0, 200),
    shadowAngleDeg: clamp(toNumber(object?.soundData?.shadowAngleDeg, 45), -180, 180),
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
  const getObjectBorderScale = (object) =>
    clamp(toNumber(object?.scalePercent, 100), 1, 10000) / 100;

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

      if (object.type === 'shape_rect' || object.type === 'shape_circle') {
        const shapeStyle = getShapeStyle(object);
        const borderScale = getObjectBorderScale(object);
        element.style.opacity = String(shapeStyle.opacityPercent / 100);
        element.style.filter = resolveShadowFilter(
          shapeStyle.shadowColor,
          shapeStyle.shadowBlurPx,
          shapeStyle.shadowAngleDeg,
          camera.zoom
        );
        const svgNamespace = 'http://www.w3.org/2000/svg';
        const shapeSvg = document.createElementNS(svgNamespace, 'svg');
        shapeSvg.setAttribute('viewBox', '0 0 ' + String(Math.max(1, toNumber(object.w, 1))) + ' ' + String(Math.max(1, toNumber(object.h, 1))));
        shapeSvg.setAttribute('preserveAspectRatio', 'none');
        shapeSvg.style.position = 'absolute';
        shapeSvg.style.inset = '0';
        shapeSvg.style.width = '100%';
        shapeSvg.style.height = '100%';
        shapeSvg.style.overflow = 'visible';
        const descriptor = getShapeSvgDescriptor(object.type, shapeStyle, Math.max(1, toNumber(object.w, 1)), Math.max(1, toNumber(object.h, 1)));
        const borderShape =
          descriptor.kind === 'ellipse'
            ? document.createElementNS(svgNamespace, 'ellipse')
            : document.createElementNS(svgNamespace, 'path');
        if (descriptor.kind === 'ellipse') {
          borderShape.setAttribute('cx', String(descriptor.cx));
          borderShape.setAttribute('cy', String(descriptor.cy));
          borderShape.setAttribute('rx', String(descriptor.rx));
          borderShape.setAttribute('ry', String(descriptor.ry));
        } else {
          borderShape.setAttribute('d', String(descriptor.d));
        }
        const clipPathId = 'shape-fill-' + String(object.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const defs = document.createElementNS(svgNamespace, 'defs');
        const clipPath = document.createElementNS(svgNamespace, 'clipPath');
        clipPath.setAttribute('id', clipPathId);
        clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
        const clipShape =
          descriptor.kind === 'ellipse'
            ? document.createElementNS(svgNamespace, 'ellipse')
            : document.createElementNS(svgNamespace, 'path');
        if (descriptor.kind === 'ellipse') {
          clipShape.setAttribute('cx', String(descriptor.cx));
          clipShape.setAttribute('cy', String(descriptor.cy));
          clipShape.setAttribute('rx', String(descriptor.rx));
          clipShape.setAttribute('ry', String(descriptor.ry));
        } else {
          clipShape.setAttribute('d', String(descriptor.d));
        }
        clipPath.appendChild(clipShape);
        defs.appendChild(clipPath);
        shapeSvg.appendChild(defs);
        const fillLayer = document.createElementNS(svgNamespace, 'foreignObject');
        fillLayer.setAttribute('x', '0');
        fillLayer.setAttribute('y', '0');
        fillLayer.setAttribute('width', String(Math.max(1, toNumber(object.w, 1))));
        fillLayer.setAttribute('height', String(Math.max(1, toNumber(object.h, 1))));
        fillLayer.setAttribute('clip-path', 'url(#' + clipPathId + ')');
        const fillLayerContent = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
        fillLayerContent.style.width = '100%';
        fillLayerContent.style.height = '100%';
        fillLayerContent.style.background = getShapeBackground(shapeStyle);
        fillLayer.appendChild(fillLayerContent);
        borderShape.setAttribute('fill', 'none');
        borderShape.setAttribute('stroke', shapeStyle.borderColor);
        borderShape.setAttribute('stroke-width', String(shapeStyle.borderWidth * borderScale));
        borderShape.setAttribute('stroke-linejoin', 'round');
        borderShape.setAttribute('stroke-linecap', 'round');
        if (shapeStyle.borderType === 'dashed') {
          borderShape.setAttribute('stroke-dasharray', String(shapeStyle.borderWidth * borderScale * 4) + ' ' + String(shapeStyle.borderWidth * borderScale * 2));
        } else if (shapeStyle.borderType === 'dotted') {
          borderShape.setAttribute('stroke-dasharray', String(shapeStyle.borderWidth * borderScale) + ' ' + String(shapeStyle.borderWidth * borderScale * 1.8));
        }
        shapeSvg.appendChild(fillLayer);
        shapeSvg.appendChild(borderShape);
        element.appendChild(shapeSvg);
      } else if (object.type === 'image') {
        const imageStyle = getImageStyle(object);
        const borderScale = getObjectBorderScale(object);
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
        clipLayer.style.borderWidth = String(imageStyle.borderWidth * borderScale * camera.zoom) + 'px';
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
      } else if (object.type === 'video') {
        const videoStyle = getVideoStyle(object);
        const borderScale = getObjectBorderScale(object);
        element.style.opacity = String(videoStyle.opacityPercent / 100);
        element.style.background = 'transparent';
        element.style.cursor = 'pointer';
        element.addEventListener('pointerdown', (event) => {
          event.stopPropagation();
        });
        element.style.filter = resolveShadowFilter(
          videoStyle.shadowColor,
          videoStyle.shadowBlurPx,
          videoStyle.shadowAngleDeg,
          camera.zoom
        );
        const clipLayer = document.createElement('div');
        clipLayer.className = 'export-image-clip';
        clipLayer.style.borderWidth = String(videoStyle.borderWidth * borderScale * camera.zoom) + 'px';
        clipLayer.style.borderStyle = videoStyle.borderType;
        clipLayer.style.borderColor = videoStyle.borderColor;
        clipLayer.style.clipPath =
          'inset(0% 0% 0% 0% round ' +
          String(videoStyle.radius * camera.zoom) + 'px)';
        const src = getImageSrc(object.videoData?.assetId);
        if (src) {
          const video = document.createElement('video');
          video.src = src;
          video.muted = videoStyle.muted;
          video.loop = videoStyle.loop;
          video.autoplay = false;
          video.playsInline = true;
          video.controls = false;
          video.preload = 'metadata';
          video.style.width = String(Math.max(1, object.w * camera.zoom)) + 'px';
          video.style.height = String(Math.max(1, object.h * camera.zoom)) + 'px';
          video.style.objectFit = 'fill';
          clipLayer.appendChild(video);
          element.addEventListener('click', (event) => {
            event.stopPropagation();
            if (video.paused) {
              void video.play().catch(() => undefined);
            } else {
              video.pause();
            }
          });
        }
        element.appendChild(clipLayer);
      } else if (object.type === 'sound') {
        const soundStyle = getSoundStyle(object);
        const borderScale = getObjectBorderScale(object);
        const soundContentScale = borderScale;
        element.style.opacity = String(soundStyle.opacityPercent / 100);
        element.style.background = 'linear-gradient(135deg, rgba(32, 52, 92, 0.92), rgba(19, 28, 48, 0.96))';
        element.style.filter = resolveShadowFilter(
          soundStyle.shadowColor,
          soundStyle.shadowBlurPx,
          soundStyle.shadowAngleDeg,
          camera.zoom
        );
        element.style.borderWidth = String(soundStyle.borderWidth * borderScale * camera.zoom) + 'px';
        element.style.borderStyle = soundStyle.borderType;
        element.style.borderColor = soundStyle.borderColor;
        element.style.borderRadius = String(soundStyle.radius * camera.zoom) + 'px';
        element.style.cursor = 'pointer';
        element.addEventListener('pointerdown', (event) => {
          event.stopPropagation();
        });
        element.style.padding =
          String(12 * camera.zoom * soundContentScale) + 'px ' +
          String(16 * camera.zoom * soundContentScale) + 'px';
        element.style.display = 'grid';
        element.style.gridTemplateColumns =
          String(18 * camera.zoom * soundContentScale) + 'px minmax(0, 1fr)';
        element.style.alignItems = 'center';
        element.style.gap = String(12 * camera.zoom * soundContentScale) + 'px';
        const asset = assetsById[object.soundData?.assetId];
        const icon = document.createElement('span');
        icon.textContent = '▶';
        icon.style.fontSize = String(Math.max(14, 18 * camera.zoom * soundContentScale)) + 'px';
        icon.style.lineHeight = '1';
        const label = document.createElement('strong');
        label.textContent = String(asset?.name || 'Sound');
        label.style.overflow = 'hidden';
        label.style.textOverflow = 'ellipsis';
        label.style.whiteSpace = 'nowrap';
        label.style.fontSize = String(Math.max(11, 13 * camera.zoom * soundContentScale)) + 'px';
        const audio = document.createElement('audio');
        const src = getImageSrc(object.soundData?.assetId);
        if (src) {
          audio.src = src;
        }
        audio.loop = soundStyle.loop;
        audio.preload = 'metadata';
        audio.addEventListener('play', () => {
          icon.textContent = '❚❚';
        });
        audio.addEventListener('pause', () => {
          icon.textContent = '▶';
        });
        element.addEventListener('click', (event) => {
          event.stopPropagation();
          if (audio.paused) {
            void audio.play().catch(() => undefined);
          } else {
            audio.pause();
          }
        });
        element.appendChild(icon);
        element.appendChild(label);
        element.appendChild(audio);
      } else if (object.type === 'template_placeholder') {
        const templateScale = Math.max(
          0.01,
          camera.zoom * getObjectBorderScale(object)
        );
        element.style.setProperty('--export-template-scale', String(templateScale));
        const shell = document.createElement('div');
        shell.className =
          'export-template-placeholder kind-' +
          String(object.templatePlaceholderData?.kind || 'text');
        const badge = document.createElement('span');
        badge.textContent = getTemplatePlaceholderBadge(
          String(object.templatePlaceholderData?.kind || 'text')
        );
        const label = document.createElement('strong');
        label.textContent = String(object.templatePlaceholderData?.prompt || 'Placeholder');
        shell.appendChild(badge);
        shell.appendChild(label);
        element.appendChild(shell);
      } else if (object.type === 'textbox') {
        const textboxStyle = getTextboxStyle(object);
        element.style.borderWidth = String(textboxStyle.borderWidth * getObjectBorderScale(object) * camera.zoom) + 'px';
        element.style.borderStyle = textboxStyle.borderType;
        element.style.borderColor = textboxStyle.borderColor;
        element.style.borderRadius = String(textboxStyle.radius * camera.zoom) + 'px';
        element.style.background = getTextboxBackground(textboxStyle);
        element.style.opacity = String(textboxStyle.opacityPercent / 100);
        element.style.boxShadow = resolveShadowCss(
          textboxStyle.shadowColor,
          textboxStyle.shadowBlurPx,
          textboxStyle.shadowAngleDeg,
          camera.zoom
        );
        element.style.padding = '0';
        const renderTextboxScale = clamp(
          toNumber(camera.zoom, 1) *
            clamp(toNumber(object?.scalePercent, 100), 1, 10000) / 100,
          0.01,
          300
        );
        const richContent = document.createElement('div');
        richContent.className = 'export-textbox-content textbox-rich-content';
        richContent.style.transform = 'scale(' + String(renderTextboxScale) + ')';
        richContent.style.transformOrigin = 'top left';
        richContent.style.width = String(100 / renderTextboxScale) + '%';
        richContent.style.height = String(100 / renderTextboxScale) + '%';
        const textboxBaseStyle = textboxBaseStylesById[object.id] || null;
        richContent.style.fontFamily = String(textboxBaseStyle?.fontFamily || object?.textboxData?.fontFamily || 'Arial');
        richContent.style.fontSize = String(toNumber(textboxBaseStyle?.fontSizePx, 28)) + 'px';
        richContent.style.color = String(textboxBaseStyle?.textColor || '#f0f3fc');
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
    stage.classList.toggle('free-move-enabled', freeMoveEnabled);
    stage.classList.remove('dragging');
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
