type SceneAsset = {
    name?: string
    mimeType?: string
    dataBase64?: string
}

type TextboxBaseStyle = {
    fontFamily?: string
    fontSizePx?: number
    textColor?: string
}

interface BuildPresentationSceneOptions {
    documentRef: Document
    layer: HTMLElement
    objects: unknown[]
    assetsById: Record<string, SceneAsset>
    objectClassPrefix: 'present' | 'export'
    textboxHtmlResolver: (object: any) => string
    textboxBaseStyleResolver: (object: any) => TextboxBaseStyle | null
    enableCulling?: boolean
    cullingBounds?: {
        minX: number
        minY: number
        maxX: number
        maxY: number
    } | null
}

export function buildPresentationScene(options: BuildPresentationSceneOptions): void {
    function toNumber(value: unknown, fallback: number): number {
        return Number.isFinite(value) ? Number(value) : fallback
    }

    function clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value))
    }

    function getObjectBorderScale(object: any): number {
        return clamp(toNumber(object?.scalePercent, 100), 1, 10000) / 100
    }

    function getGradientBackground(gradient: any, fallbackStartColor: string, fallbackEndColor: string): string {
        const gradientStops = Array.isArray(gradient?.stops) && gradient.stops.length >= 2
            ? gradient.stops
                .slice(0, 5)
                .sort((a: any, b: any) => toNumber(a?.positionPercent, 0) - toNumber(b?.positionPercent, 0))
                .map(
                    (stop: any) =>
                        String(stop?.color || gradient.colorA || fallbackStartColor) +
                        ' ' +
                        String(clamp(toNumber(stop?.positionPercent, 0), 0, 100)) +
                        '%'
                )
            : [
                String(gradient?.colorA || fallbackStartColor) + ' 0%',
                String(gradient?.colorB || fallbackEndColor) + ' 100%',
            ]

        if (gradient?.gradientType === 'circles') {
            const circleLayers = Array.isArray(gradient?.stops) && gradient.stops.length >= 2
                ? gradient.stops
                    .slice(0, 5)
                    .map((stop: any, index: number) => {
                        const xPercent = clamp(toNumber(stop?.xPercent, index === 0 ? 35 : 65), 0, 100)
                        const yPercent = clamp(toNumber(stop?.yPercent, 50), 0, 100)
                        const radiusPercent = clamp(toNumber(stop?.positionPercent, 42), 8, 100)
                        const color = String(stop?.color || gradient.colorA || fallbackStartColor)
                        return (
                            'radial-gradient(circle at ' +
                            String(xPercent) +
                            '% ' +
                            String(yPercent) +
                            '%, ' +
                            color +
                            ' 0%, transparent ' +
                            String(radiusPercent) +
                            '%)'
                        )
                    })
                    .join(', ')
                : ''

            if (circleLayers.length > 0) {
                return circleLayers + ', ' + String(gradient.colorB || fallbackEndColor)
            }
        }

        if (gradient?.gradientType === 'radial') {
            return 'radial-gradient(circle, ' + gradientStops.join(', ') + ')'
        }

        return (
            'linear-gradient(' +
            String(toNumber(gradient?.angleDeg, 45)) +
            'deg, ' +
            gradientStops.join(', ') +
            ')'
        )
    }

    function getShapeBackground(shapeData: any): string {
        const fillMode = String(shapeData?.fillMode || 'solid')
        if (fillMode === 'linearGradient' && shapeData?.fillGradient) {
            return getGradientBackground(shapeData.fillGradient, String(shapeData?.fillColor || '#244a80'), '#ffffff')
        }
        return String(shapeData?.fillColor || '#244a80')
    }

    function resolveImageFilterCss(effectsEnabled: boolean, filterPreset: string): string {
        if (!effectsEnabled) {
            return 'none'
        }
        switch (filterPreset) {
            case 'bw':
                return 'grayscale(100%)'
            case 'sepia':
                return 'sepia(100%)'
            case 'vibrant':
                return 'saturate(180%) contrast(112%)'
            case 'warm':
                return 'sepia(22%) saturate(128%) hue-rotate(-12deg) brightness(103%)'
            case 'cool':
                return 'saturate(112%) hue-rotate(14deg) brightness(102%)'
            case 'dramatic':
                return 'contrast(140%) saturate(122%) brightness(94%)'
            default:
                return 'none'
        }
    }

    function resolveShadowCss(color: string, blurPx: number, angleDeg: number, zoom: number): string {
        const safeBlur = clamp(toNumber(blurPx, 0), 0, 200)
        if (safeBlur <= 0) {
            return 'none'
        }
        let normalizedAngle = toNumber(angleDeg, 45)
        while (normalizedAngle > 180) {
            normalizedAngle -= 360
        }
        while (normalizedAngle < -180) {
            normalizedAngle += 360
        }
        const angleRad = (normalizedAngle * Math.PI) / 180
        const safeZoom = Math.max(0.01, toNumber(zoom, 1))
        const distance = 12 * safeZoom
        const offsetX = Math.cos(angleRad) * distance
        const offsetY = Math.sin(angleRad) * distance
        return (
            String(offsetX.toFixed(2)) +
            'px ' +
            String(offsetY.toFixed(2)) +
            'px ' +
            String((safeBlur * safeZoom).toFixed(2)) +
            'px ' +
            String(color || '#000000')
        )
    }

    function resolveShadowFilter(color: string, blurPx: number, angleDeg: number, zoom: number): string {
        const shadow = resolveShadowCss(color, blurPx, angleDeg, zoom)
        if (shadow === 'none') {
            return 'none'
        }
        return 'drop-shadow(' + shadow + ')'
    }

    function toPointPath(points: Array<{ x: number; y: number }>): string {
        return points
            .map((point, index) => (index === 0 ? 'M ' : 'L ') + point.x + ' ' + point.y)
            .join(' ') + ' Z'
    }

    function toSmoothClosedPath(points: Array<{ x: number; y: number }>): string {
        if (!points || points.length < 2) {
            return ''
        }
        let path = 'M ' + points[0].x + ' ' + points[0].y
        for (let index = 0; index < points.length; index += 1) {
            const current = points[index]
            const next = points[(index + 1) % points.length]
            const midX = (current.x + next.x) / 2
            const midY = (current.y + next.y) / 2
            path += ' Q ' + current.x + ' ' + current.y + ' ' + midX + ' ' + midY
        }
        return path + ' Z'
    }

    function getRoundedRectPath(width: number, height: number, radius: number): string {
        const safeRadius = clamp(radius, 0, Math.min(width, height) / 2)
        if (safeRadius <= 0.001) {
            return 'M 0 0 H ' + width + ' V ' + height + ' H 0 Z'
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
        ].join(' ')
    }

    function getStarPath(width: number, height: number, innerRatio: number): string {
        const centerX = width / 2
        const centerY = height / 2
        const outerRadius = Math.min(width, height) / 2
        const innerRadius = outerRadius * innerRatio
        const points = Array.from({ length: 10 }, (_, index) => {
            const isOuter = index % 2 === 0
            const angle = -Math.PI / 2 + (index * Math.PI) / 5
            const radius = isOuter ? outerRadius : innerRadius
            return {
                x: centerX + Math.cos(angle) * radius,
                y: centerY + Math.sin(angle) * radius,
            }
        })
        return toPointPath(points)
    }

    function getCloudPath(width: number, height: number, topPercent: number): string {
        const topY = clamp(height * (topPercent / 100), height * 0.04, height * 0.38)
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
        ])
    }

    function getShapeSvgDescriptor(type: string, shapeData: any, width: number, height: number) {
        const safeWidth = Math.max(1, width)
        const safeHeight = Math.max(1, height)
        if (type === 'shape_circle') {
            return {
                kind: 'ellipse',
                cx: safeWidth / 2,
                cy: safeHeight / 2,
                rx: safeWidth / 2,
                ry: safeHeight / 2,
            } as const
        }

        const kind = String(shapeData?.kind || 'rect')
        const adjustmentPercent = clamp(toNumber(shapeData?.adjustmentPercent, 50), 0, 100)
        switch (kind) {
            case 'roundedRect':
                return { kind: 'path', d: getRoundedRectPath(safeWidth, safeHeight, clamp(toNumber(shapeData?.radius, 0), 0, 1000000)) } as const
            case 'diamond':
                return { kind: 'path', d: toPointPath([{ x: safeWidth / 2, y: 0 }, { x: safeWidth, y: safeHeight / 2 }, { x: safeWidth / 2, y: safeHeight }, { x: 0, y: safeHeight / 2 }]) } as const
            case 'triangle':
                return { kind: 'path', d: toPointPath([{ x: safeWidth / 2, y: 0 }, { x: safeWidth, y: safeHeight }, { x: 0, y: safeHeight }]) } as const
            case 'trapezoid': {
                const inset = (safeWidth * clamp(adjustmentPercent, 0, 40)) / 100
                return { kind: 'path', d: toPointPath([{ x: inset, y: 0 }, { x: safeWidth - inset, y: 0 }, { x: safeWidth, y: safeHeight }, { x: 0, y: safeHeight }]) } as const
            }
            case 'parallelogram': {
                const skew = (safeWidth * clamp(adjustmentPercent, 0, 40)) / 100
                return { kind: 'path', d: toPointPath([{ x: skew, y: 0 }, { x: safeWidth, y: 0 }, { x: safeWidth - skew, y: safeHeight }, { x: 0, y: safeHeight }]) } as const
            }
            case 'hexagon': {
                const inset = (safeWidth * clamp(adjustmentPercent, 0, 40)) / 100
                return { kind: 'path', d: toPointPath([{ x: inset, y: 0 }, { x: safeWidth - inset, y: 0 }, { x: safeWidth, y: safeHeight / 2 }, { x: safeWidth - inset, y: safeHeight }, { x: inset, y: safeHeight }, { x: 0, y: safeHeight / 2 }]) } as const
            }
            case 'pentagon': {
                const shoulderY = (safeHeight * clamp(adjustmentPercent, 20, 70)) / 100
                return { kind: 'path', d: toPointPath([{ x: safeWidth / 2, y: 0 }, { x: safeWidth, y: shoulderY }, { x: safeWidth * 0.82, y: safeHeight }, { x: safeWidth * 0.18, y: safeHeight }, { x: 0, y: shoulderY }]) } as const
            }
            case 'octagon': {
                const inset = (Math.min(safeWidth, safeHeight) * clamp(adjustmentPercent, 10, 35)) / 100
                return { kind: 'path', d: toPointPath([{ x: inset, y: 0 }, { x: safeWidth - inset, y: 0 }, { x: safeWidth, y: inset }, { x: safeWidth, y: safeHeight - inset }, { x: safeWidth - inset, y: safeHeight }, { x: inset, y: safeHeight }, { x: 0, y: safeHeight - inset }, { x: 0, y: inset }]) } as const
            }
            case 'star':
                return { kind: 'path', d: getStarPath(safeWidth, safeHeight, clamp(adjustmentPercent, 15, 80) / 100) } as const
            case 'cloud':
                return { kind: 'path', d: getCloudPath(safeWidth, safeHeight, clamp(adjustmentPercent, 6, 28)) } as const
            case 'rect':
            default:
                return { kind: 'path', d: getRoundedRectPath(safeWidth, safeHeight, 0) } as const
        }
    }

    function getTemplatePlaceholderBadge(kind: string): string {
        if (kind === 'image') {
            return 'IMG'
        }
        if (kind === 'list') {
            return 'LIST'
        }
        return 'TEXT'
    }

    const {
        documentRef,
        layer,
        objects,
        assetsById,
        objectClassPrefix,
        textboxHtmlResolver,
        textboxBaseStyleResolver,
        enableCulling,
        cullingBounds,
    } = options

    const effectiveCullingBounds =
        enableCulling &&
            cullingBounds &&
            Number.isFinite(cullingBounds.minX) &&
            Number.isFinite(cullingBounds.minY) &&
            Number.isFinite(cullingBounds.maxX) &&
            Number.isFinite(cullingBounds.maxY)
            ? cullingBounds
            : null

    layer.innerHTML = ''
    const orderedObjects = (Array.isArray(objects) ? [...objects] : [])
        .sort((a: any, b: any) => toNumber(a?.zIndex, 0) - toNumber(b?.zIndex, 0))
        .filter((object: any) => object?.type !== 'group')

    for (const object of orderedObjects as any[]) {
        const objectW = Math.max(1, toNumber(object?.w, 1))
        const objectH = Math.max(1, toNumber(object?.h, 1))
        const objectX = toNumber(object?.x, 0)
        const objectY = toNumber(object?.y, 0)
        if (effectiveCullingBounds) {
            // Use a conservative bounding circle test so rotated objects are not clipped out.
            const objectRadius = Math.hypot(objectW, objectH) / 2
            if (
                objectX + objectRadius < effectiveCullingBounds.minX ||
                objectX - objectRadius > effectiveCullingBounds.maxX ||
                objectY + objectRadius < effectiveCullingBounds.minY ||
                objectY - objectRadius > effectiveCullingBounds.maxY
            ) {
                continue
            }
        }

        const element = documentRef.createElement('div')
        element.className = objectClassPrefix + '-object ' + String(object.type)
        element.style.left = String(objectX - objectW / 2) + 'px'
        element.style.top = String(objectY - objectH / 2) + 'px'
        element.style.width = String(objectW) + 'px'
        element.style.height = String(objectH) + 'px'
        element.style.transform = 'rotate(' + String(toNumber(object?.rotation, 0)) + 'rad)'

        if (object.type === 'shape_rect' || object.type === 'shape_circle') {
            const shapeData = object?.shapeData || {}
            const borderScale = getObjectBorderScale(object)
            element.style.opacity = String(clamp(toNumber(shapeData?.opacityPercent, 100), 0, 100) / 100)
            element.style.filter = resolveShadowFilter(
                String(shapeData?.shadowColor || '#000000'),
                clamp(toNumber(shapeData?.shadowBlurPx, 0), 0, 200),
                clamp(toNumber(shapeData?.shadowAngleDeg, 45), -180, 180),
                1
            )

            const svgNamespace = 'http://www.w3.org/2000/svg'
            const shapeSvg = documentRef.createElementNS(svgNamespace, 'svg')
            shapeSvg.setAttribute('viewBox', '0 0 ' + String(objectW) + ' ' + String(objectH))
            shapeSvg.setAttribute('preserveAspectRatio', 'none')
            shapeSvg.style.position = 'absolute'
            shapeSvg.style.inset = '0'
            shapeSvg.style.width = '100%'
            shapeSvg.style.height = '100%'
            shapeSvg.style.overflow = 'visible'

            const descriptor = getShapeSvgDescriptor(String(object.type), shapeData, objectW, objectH)
            const borderShape =
                descriptor.kind === 'ellipse'
                    ? documentRef.createElementNS(svgNamespace, 'ellipse')
                    : documentRef.createElementNS(svgNamespace, 'path')
            if (descriptor.kind === 'ellipse') {
                borderShape.setAttribute('cx', String(descriptor.cx))
                borderShape.setAttribute('cy', String(descriptor.cy))
                borderShape.setAttribute('rx', String(descriptor.rx))
                borderShape.setAttribute('ry', String(descriptor.ry))
            } else {
                borderShape.setAttribute('d', String(descriptor.d))
            }

            const clipPathId =
                objectClassPrefix + '-shape-fill-' + String(object.id || '').replace(/[^a-zA-Z0-9_-]/g, '')
            const defs = documentRef.createElementNS(svgNamespace, 'defs')
            const clipPath = documentRef.createElementNS(svgNamespace, 'clipPath')
            clipPath.setAttribute('id', clipPathId)
            clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse')
            const clipShape =
                descriptor.kind === 'ellipse'
                    ? documentRef.createElementNS(svgNamespace, 'ellipse')
                    : documentRef.createElementNS(svgNamespace, 'path')
            if (descriptor.kind === 'ellipse') {
                clipShape.setAttribute('cx', String(descriptor.cx))
                clipShape.setAttribute('cy', String(descriptor.cy))
                clipShape.setAttribute('rx', String(descriptor.rx))
                clipShape.setAttribute('ry', String(descriptor.ry))
            } else {
                clipShape.setAttribute('d', String(descriptor.d))
            }
            clipPath.appendChild(clipShape)
            defs.appendChild(clipPath)
            shapeSvg.appendChild(defs)

            const fillLayer = documentRef.createElementNS(svgNamespace, 'foreignObject')
            fillLayer.setAttribute('x', '0')
            fillLayer.setAttribute('y', '0')
            fillLayer.setAttribute('width', String(objectW))
            fillLayer.setAttribute('height', String(objectH))
            fillLayer.setAttribute('clip-path', 'url(#' + clipPathId + ')')
            const fillLayerContent = documentRef.createElementNS('http://www.w3.org/1999/xhtml', 'div')
            fillLayerContent.style.width = '100%'
            fillLayerContent.style.height = '100%'
            fillLayerContent.style.background = getShapeBackground(shapeData)
            fillLayer.appendChild(fillLayerContent)

            const borderWidth = clamp(toNumber(shapeData?.borderWidth, 1), 0, 20) * borderScale
            borderShape.setAttribute('fill', 'none')
            borderShape.setAttribute('stroke', String(shapeData?.borderColor || '#8fb0e6'))
            borderShape.setAttribute('stroke-width', String(borderWidth))
            borderShape.setAttribute('stroke-linejoin', 'round')
            borderShape.setAttribute('stroke-linecap', 'round')
            const borderType = String(shapeData?.borderType || 'solid')
            if (borderType === 'dashed') {
                borderShape.setAttribute('stroke-dasharray', String(borderWidth * 4) + ' ' + String(borderWidth * 2))
            } else if (borderType === 'dotted') {
                borderShape.setAttribute('stroke-dasharray', String(borderWidth) + ' ' + String(borderWidth * 1.8))
            }

            shapeSvg.appendChild(fillLayer)
            shapeSvg.appendChild(borderShape)
            element.appendChild(shapeSvg)
        } else if (object.type === 'image') {
            const imageData = object?.imageData || {}
            const borderScale = getObjectBorderScale(object)
            element.style.opacity = String(clamp(toNumber(imageData?.opacityPercent, 100), 0, 100) / 100)
            element.style.background = 'transparent'
            element.style.filter = resolveShadowFilter(
                String(imageData?.shadowColor || '#000000'),
                clamp(toNumber(imageData?.shadowBlurPx, 0), 0, 200),
                clamp(toNumber(imageData?.shadowAngleDeg, 45), -180, 180),
                1
            )

            const clipLayer = documentRef.createElement('div')
            clipLayer.className = objectClassPrefix + '-image-clip'
            clipLayer.style.borderWidth =
                String(clamp(toNumber(imageData?.borderWidth, 0), 0, 20) * borderScale) + 'px'
            clipLayer.style.borderStyle = String(imageData?.borderType || 'solid')
            clipLayer.style.borderColor = String(imageData?.borderColor || '#b2c6ee')
            clipLayer.style.clipPath =
                'inset(' +
                String(clamp(toNumber(imageData?.cropTopPercent, 0), 0, 100)) +
                '% ' +
                String(clamp(toNumber(imageData?.cropRightPercent, 0), 0, 100)) +
                '% ' +
                String(clamp(toNumber(imageData?.cropBottomPercent, 0), 0, 100)) +
                '% ' +
                String(clamp(toNumber(imageData?.cropLeftPercent, 0), 0, 100)) +
                '% round ' +
                String(clamp(toNumber(imageData?.radius, 0), 0, 1000000)) +
                'px)'

            const asset = assetsById[String(imageData?.assetId || '')]
            if (asset?.mimeType && asset?.dataBase64) {
                const image = documentRef.createElement('img')
                image.src = 'data:' + asset.mimeType + ';base64,' + asset.dataBase64
                image.alt = ''
                image.style.width = '100%'
                image.style.height = '100%'
                image.style.objectFit = 'fill'
                image.style.filter = resolveImageFilterCss(
                    Boolean(imageData?.effectsEnabled),
                    ['none', 'bw', 'sepia', 'vibrant', 'warm', 'cool', 'dramatic'].includes(
                        String(imageData?.filterPreset)
                    )
                        ? String(imageData?.filterPreset)
                        : 'none'
                )
                image.draggable = false
                clipLayer.appendChild(image)
            }
            element.appendChild(clipLayer)
        } else if (object.type === 'video') {
            const videoData = object?.videoData || {}
            const borderScale = getObjectBorderScale(object)
            element.style.opacity = String(clamp(toNumber(videoData?.opacityPercent, 100), 0, 100) / 100)
            element.style.background = 'transparent'
            element.style.cursor = 'pointer'
            element.addEventListener('pointerdown', (event) => {
                event.stopPropagation()
            })
            element.style.filter = resolveShadowFilter(
                String(videoData?.shadowColor || '#000000'),
                clamp(toNumber(videoData?.shadowBlurPx, 0), 0, 200),
                clamp(toNumber(videoData?.shadowAngleDeg, 45), -180, 180),
                1
            )

            const clipLayer = documentRef.createElement('div')
            clipLayer.className = objectClassPrefix + '-image-clip'
            clipLayer.style.borderWidth =
                String(clamp(toNumber(videoData?.borderWidth, 0), 0, 20) * borderScale) + 'px'
            clipLayer.style.borderStyle = String(videoData?.borderType || 'solid')
            clipLayer.style.borderColor = String(videoData?.borderColor || '#b2c6ee')
            clipLayer.style.clipPath =
                'inset(0% 0% 0% 0% round ' + String(clamp(toNumber(videoData?.radius, 0), 0, 1000000)) + 'px)'

            const asset = assetsById[String(videoData?.assetId || '')]
            if (asset?.mimeType && asset?.dataBase64) {
                const video = documentRef.createElement('video')
                video.src = 'data:' + asset.mimeType + ';base64,' + asset.dataBase64
                video.muted = Boolean(videoData?.muted)
                video.loop = Boolean(videoData?.loop)
                video.autoplay = false
                video.playsInline = true
                video.controls = false
                video.preload = 'metadata'
                video.style.width = '100%'
                video.style.height = '100%'
                video.style.objectFit = 'fill'
                clipLayer.appendChild(video)
                element.addEventListener('click', (event) => {
                    event.stopPropagation()
                    if (video.paused) {
                        void video.play().catch(() => undefined)
                    } else {
                        video.pause()
                    }
                })
            }
            element.appendChild(clipLayer)
        } else if (object.type === 'sound') {
            const soundData = object?.soundData || {}
            const borderScale = getObjectBorderScale(object)
            const soundContentScale = borderScale
            element.style.opacity = String(clamp(toNumber(soundData?.opacityPercent, 100), 0, 100) / 100)
            element.style.background = 'linear-gradient(135deg, rgba(32, 52, 92, 0.92), rgba(19, 28, 48, 0.96))'
            element.style.filter = resolveShadowFilter(
                String(soundData?.shadowColor || '#000000'),
                clamp(toNumber(soundData?.shadowBlurPx, 0), 0, 200),
                clamp(toNumber(soundData?.shadowAngleDeg, 45), -180, 180),
                1
            )
            element.style.borderWidth =
                String(clamp(toNumber(soundData?.borderWidth, 0), 0, 20) * borderScale) + 'px'
            element.style.borderStyle = String(soundData?.borderType || 'solid')
            element.style.borderColor = String(soundData?.borderColor || '#b2c6ee')
            element.style.borderRadius = String(clamp(toNumber(soundData?.radius, 18), 0, 1000000)) + 'px'
            element.style.cursor = 'pointer'
            element.addEventListener('pointerdown', (event) => {
                event.stopPropagation()
            })
            element.style.padding = String(12 * soundContentScale) + 'px ' + String(16 * soundContentScale) + 'px'
            element.style.display = 'grid'
            element.style.gridTemplateColumns = String(18 * soundContentScale) + 'px minmax(0, 1fr)'
            element.style.alignItems = 'center'
            element.style.gap = String(12 * soundContentScale) + 'px'

            const asset = assetsById[String(soundData?.assetId || '')]
            const icon = documentRef.createElement('span')
            icon.textContent = '▶'
            icon.style.fontSize = String(Math.max(14, 18 * soundContentScale)) + 'px'
            icon.style.lineHeight = '1'
            const label = documentRef.createElement('strong')
            label.textContent = String(asset?.name || 'Sound')
            label.style.overflow = 'hidden'
            label.style.textOverflow = 'ellipsis'
            label.style.whiteSpace = 'nowrap'
            label.style.fontSize = String(Math.max(11, 13 * soundContentScale)) + 'px'

            const audio = documentRef.createElement('audio')
            if (asset?.mimeType && asset?.dataBase64) {
                audio.src = 'data:' + asset.mimeType + ';base64,' + asset.dataBase64
            }
            audio.loop = Boolean(soundData?.loop)
            audio.preload = 'metadata'
            audio.addEventListener('play', () => {
                icon.textContent = '❚❚'
            })
            audio.addEventListener('pause', () => {
                icon.textContent = '▶'
            })
            element.addEventListener('click', (event) => {
                event.stopPropagation()
                if (audio.paused) {
                    void audio.play().catch(() => undefined)
                } else {
                    audio.pause()
                }
            })

            element.appendChild(icon)
            element.appendChild(label)
            element.appendChild(audio)
        } else if (object.type === 'template_placeholder') {
            const templateScale = Math.max(0.01, getObjectBorderScale(object))
            const kind = String(object?.templatePlaceholderData?.kind || 'text')
            element.style.setProperty('--' + objectClassPrefix + '-template-scale', String(templateScale))
            if (objectClassPrefix === 'present') {
                element.classList.add('template-placeholder')
            }
            const shell = documentRef.createElement('div')
            shell.className = objectClassPrefix + '-template-placeholder kind-' + kind
            const badge = documentRef.createElement('span')
            badge.textContent = getTemplatePlaceholderBadge(kind)
            const label = documentRef.createElement('strong')
            label.textContent = String(object?.templatePlaceholderData?.prompt || 'Placeholder')
            shell.appendChild(badge)
            shell.appendChild(label)
            element.appendChild(shell)
        } else if (object.type === 'textbox') {
            const textboxData = object?.textboxData || {}
            const textboxBaseStyle = textboxBaseStyleResolver(object)
            const borderScale = getObjectBorderScale(object)
            const borderWidth = clamp(toNumber(textboxData?.borderWidth, 1), 0, 20) * borderScale
            const borderRadius = clamp(toNumber(textboxData?.radius, 0), 0, 1000000)
            const opacity = clamp(toNumber(textboxData?.opacityPercent, 100), 0, 100) / 100
            const fillMode = String(textboxData?.fillMode || 'solid')
            const backgroundColor = String(textboxData?.backgroundColor || '#1f3151')
            const renderTextboxScale = Math.max(0.01, borderScale)

            element.style.borderWidth = String(borderWidth) + 'px'
            element.style.borderStyle = String(textboxData?.borderType || 'solid')
            element.style.borderColor = String(textboxData?.borderColor || '#b2c6ee')
            element.style.borderRadius = String(borderRadius) + 'px'
            element.style.background =
                fillMode === 'linearGradient' && textboxData?.fillGradient
                    ? getGradientBackground(textboxData.fillGradient, backgroundColor, '#ffffff')
                    : backgroundColor
            element.style.opacity = String(opacity)
            element.style.boxShadow = resolveShadowCss(
                String(textboxData?.shadowColor || '#000000'),
                clamp(toNumber(textboxData?.shadowBlurPx, 0), 0, 200),
                clamp(toNumber(textboxData?.shadowAngleDeg, 45), -180, 180),
                1
            )
            element.style.padding = '0'

            const verticalAlignment = String(textboxData?.verticalAlignment || 'top')
            const richContent = documentRef.createElement('div')
            richContent.className =
                objectClassPrefix +
                '-textbox-content textbox-rich-content textbox-v-align-' +
                verticalAlignment
            richContent.style.transform = 'scale(' + String(renderTextboxScale) + ')'
            richContent.style.transformOrigin = 'top left'
            richContent.style.width = String(100 / renderTextboxScale) + '%'
            richContent.style.height = String(100 / renderTextboxScale) + '%'
            richContent.style.fontFamily = String(textboxBaseStyle?.fontFamily || textboxData?.fontFamily || 'Arial')
            richContent.style.fontSize = String(toNumber(textboxBaseStyle?.fontSizePx, 28)) + 'px'
            richContent.style.color = String(textboxBaseStyle?.textColor || '#f0f3fc')
            richContent.innerHTML = textboxHtmlResolver(object)
            element.appendChild(richContent)
        }

        layer.appendChild(element)
    }
}
