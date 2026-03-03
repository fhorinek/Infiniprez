import { useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCompass, faLock, faLockOpen, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons'
import type { CanvasObject, ShapeData } from '../model'
import { useEditorStore } from '../store'
import { type CameraState } from '../store/types'
import {
  cameraDragDeltaToWorld,
  clamp,
  getDynamicGridStep,
  getViewWorldBounds,
  rotatePoint,
  screenToWorld,
  type Point,
  type ViewportSize,
  worldToScreen,
} from './math'

interface GridLine {
  id: string
  value: number
}

interface PanInteraction {
  pointerId: number
  originClient: Point
  cameraStart: CameraState
}

interface ObjectInteraction {
  pointerId: number
  objectId: string
  mode: 'move' | 'resize' | 'rotate'
  originClient: Point
  objectStart: Pick<CanvasObject, 'x' | 'y' | 'w' | 'h' | 'rotation'>
  cameraStart: CameraState
  centerScreenStart: Point
  startPointerAngle: number
}

function useViewportSize(ref: RefObject<HTMLElement>) {
  const [size, setSize] = useState<ViewportSize>({ width: 1, height: 1 })

  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }

      const { width, height } = entry.contentRect
      setSize({
        width: Math.max(1, width),
        height: Math.max(1, height),
      })
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return size
}

function createGridLines(min: number, max: number, step: number): GridLine[] {
  const safeStep = Math.max(0.00001, step)
  const start = Math.floor(min / safeStep) * safeStep
  const lines: GridLine[] = []

  for (let value = start; value <= max + safeStep; value += safeStep) {
    lines.push({
      id: value.toFixed(3),
      value,
    })
  }

  return lines
}

function getShapeBackground(shapeData: ShapeData): string {
  if (shapeData.fillMode === 'linearGradient' && shapeData.fillGradient) {
    const gradient = shapeData.fillGradient
    return `linear-gradient(${gradient.angleDeg}deg, ${gradient.colorA}, ${gradient.colorB})`
  }
  return shapeData.fillColor
}

function getObjectLabel(object: CanvasObject): string {
  if (object.type === 'textbox') {
    const content = object.textboxData.runs.map((run) => run.text).join('')
    return content.length > 0 ? content : 'Textbox'
  }

  if (object.type === 'image') {
    return 'Image'
  }

  if (object.type === 'shape_rect') {
    return 'Rectangle'
  }

  if (object.type === 'shape_circle') {
    return 'Circle'
  }

  if (object.type === 'shape_arrow') {
    return 'Arrow'
  }

  return 'Group'
}

export function CanvasViewport() {
  const viewportRef = useRef<HTMLDivElement>(null)
  const panRef = useRef<PanInteraction | null>(null)
  const objectInteractionRef = useRef<ObjectInteraction | null>(null)

  const camera = useEditorStore((state) => state.camera)
  const setCamera = useEditorStore((state) => state.setCamera)
  const canvasSettings = useEditorStore((state) => state.document.canvas)
  const objects = useEditorStore((state) => state.document.objects)
  const selectedObjectIds = useEditorStore((state) => state.ui.selectedObjectIds)
  const selectObjects = useEditorStore((state) => state.selectObjects)
  const clearSelection = useEditorStore((state) => state.clearSelection)
  const moveObject = useEditorStore((state) => state.moveObject)
  const toggleObjectLock = useEditorStore((state) => state.toggleObjectLock)
  const beginCommandBatch = useEditorStore((state) => state.beginCommandBatch)
  const commitCommandBatch = useEditorStore((state) => state.commitCommandBatch)

  const viewportSize = useViewportSize(viewportRef)
  const orderedObjects = useMemo(() => [...objects].sort((a, b) => a.zIndex - b.zIndex), [objects])
  const selectedObject =
    selectedObjectIds.length === 1
      ? (orderedObjects.find((entry) => entry.id === selectedObjectIds[0]) ?? null)
      : null

  const gridStep = useMemo(
    () => getDynamicGridStep(canvasSettings.baseGridSize, camera.zoom),
    [canvasSettings.baseGridSize, camera.zoom]
  )
  const minorGridStep = gridStep / 10
  const worldBounds = useMemo(
    () => getViewWorldBounds(camera, viewportSize),
    [camera, viewportSize]
  )

  const majorGridLines = useMemo(() => {
    if (!canvasSettings.gridVisible) {
      return { x: [], y: [] } as { x: GridLine[]; y: GridLine[] }
    }
    return {
      x: createGridLines(worldBounds.minX, worldBounds.maxX, gridStep),
      y: createGridLines(worldBounds.minY, worldBounds.maxY, gridStep),
    }
  }, [
    canvasSettings.gridVisible,
    gridStep,
    worldBounds.maxX,
    worldBounds.maxY,
    worldBounds.minX,
    worldBounds.minY,
  ])

  const minorGridLines = useMemo(() => {
    if (!canvasSettings.gridVisible) {
      return { x: [], y: [] } as { x: GridLine[]; y: GridLine[] }
    }
    return {
      x: createGridLines(worldBounds.minX, worldBounds.maxX, minorGridStep),
      y: createGridLines(worldBounds.minY, worldBounds.maxY, minorGridStep),
    }
  }, [
    canvasSettings.gridVisible,
    minorGridStep,
    worldBounds.maxX,
    worldBounds.maxY,
    worldBounds.minX,
    worldBounds.minY,
  ])

  function getViewportRelativePoint(clientX: number, clientY: number): Point {
    const element = viewportRef.current
    if (!element) {
      return { x: 0, y: 0 }
    }
    const bounds = element.getBoundingClientRect()
    return {
      x: clientX - bounds.left,
      y: clientY - bounds.top,
    }
  }

  useEffect(() => {
    const element = viewportRef.current
    if (!element) {
      return
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const pointerScreen = getViewportRelativePoint(event.clientX, event.clientY)
      const worldBefore = screenToWorld(pointerScreen, camera, viewportSize)

      if (event.altKey) {
        const rotationDelta = event.deltaY * 0.002
        const nextRotation = camera.rotation + rotationDelta
        const rotatedCamera = { ...camera, rotation: nextRotation }
        const worldAfter = screenToWorld(pointerScreen, rotatedCamera, viewportSize)

        setCamera({
          ...rotatedCamera,
          x: rotatedCamera.x + (worldBefore.x - worldAfter.x),
          y: rotatedCamera.y + (worldBefore.y - worldAfter.y),
        })
        return
      }

      const zoomFactor = Math.exp(-event.deltaY * 0.0015)
      const nextZoom = clamp(camera.zoom * zoomFactor, 0.1, 10)
      const zoomedCamera = { ...camera, zoom: nextZoom }
      const worldAfter = screenToWorld(pointerScreen, zoomedCamera, viewportSize)

      setCamera({
        ...zoomedCamera,
        x: zoomedCamera.x + (worldBefore.x - worldAfter.x),
        y: zoomedCamera.y + (worldBefore.y - worldAfter.y),
      })
    }

    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [camera, setCamera, viewportSize])

  function beginObjectInteraction(
    event: PointerEvent<HTMLElement>,
    object: CanvasObject,
    mode: ObjectInteraction['mode']
  ) {
    if (object.locked) {
      return
    }

    const centerScreenStart = worldToScreen({ x: object.x, y: object.y }, camera, viewportSize)
    const pointerScreen = getViewportRelativePoint(event.clientX, event.clientY)
    const startPointerAngle = Math.atan2(
      pointerScreen.y - centerScreenStart.y,
      pointerScreen.x - centerScreenStart.x
    )

    beginCommandBatch('Object transform')
    objectInteractionRef.current = {
      pointerId: event.pointerId,
      objectId: object.id,
      mode,
      originClient: { x: event.clientX, y: event.clientY },
      objectStart: {
        x: object.x,
        y: object.y,
        w: object.w,
        h: object.h,
        rotation: object.rotation,
      },
      cameraStart: camera,
      centerScreenStart,
      startPointerAngle,
    }

    viewportRef.current?.setPointerCapture(event.pointerId)
  }

  function applyObjectInteraction(
    event: PointerEvent<HTMLDivElement>,
    interaction: ObjectInteraction
  ) {
    const deltaClient = {
      x: event.clientX - interaction.originClient.x,
      y: event.clientY - interaction.originClient.y,
    }
    const deltaWorld = cameraDragDeltaToWorld(deltaClient, interaction.cameraStart)

    if (interaction.mode === 'move') {
      moveObject(interaction.objectId, {
        x: interaction.objectStart.x + deltaWorld.x,
        y: interaction.objectStart.y + deltaWorld.y,
        w: interaction.objectStart.w,
        h: interaction.objectStart.h,
        rotation: interaction.objectStart.rotation,
      })
      return
    }

    if (interaction.mode === 'resize') {
      // Resize is computed in the object's local axis space so dragging
      // follows the selected handle even when object is rotated.
      const localDelta = rotatePoint(deltaWorld, -interaction.objectStart.rotation)
      const nextWidth = Math.max(20, interaction.objectStart.w + localDelta.x)
      const nextHeight = Math.max(20, interaction.objectStart.h + localDelta.y)
      const appliedWidthDelta = nextWidth - interaction.objectStart.w
      const appliedHeightDelta = nextHeight - interaction.objectStart.h
      const centerShiftLocal = {
        x: appliedWidthDelta / 2,
        y: appliedHeightDelta / 2,
      }
      const centerShiftWorld = rotatePoint(centerShiftLocal, interaction.objectStart.rotation)

      moveObject(interaction.objectId, {
        x: interaction.objectStart.x + centerShiftWorld.x,
        y: interaction.objectStart.y + centerShiftWorld.y,
        w: nextWidth,
        h: nextHeight,
        rotation: interaction.objectStart.rotation,
      })
      return
    }

    const pointerScreen = getViewportRelativePoint(event.clientX, event.clientY)
    const currentAngle = Math.atan2(
      pointerScreen.y - interaction.centerScreenStart.y,
      pointerScreen.x - interaction.centerScreenStart.x
    )
    const rotationDelta = currentAngle - interaction.startPointerAngle

    moveObject(interaction.objectId, {
      x: interaction.objectStart.x,
      y: interaction.objectStart.y,
      w: interaction.objectStart.w,
      h: interaction.objectStart.h,
      rotation: interaction.objectStart.rotation + rotationDelta,
    })
  }

  function handleViewportPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) {
      return
    }

    event.preventDefault()
    clearSelection()
    panRef.current = {
      pointerId: event.pointerId,
      originClient: { x: event.clientX, y: event.clientY },
      cameraStart: camera,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleViewportPointerMove(event: PointerEvent<HTMLDivElement>) {
    const interaction = objectInteractionRef.current
    if (interaction && interaction.pointerId === event.pointerId) {
      applyObjectInteraction(event, interaction)
      return
    }

    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) {
      return
    }

    const deltaScreen = {
      x: event.clientX - pan.originClient.x,
      y: event.clientY - pan.originClient.y,
    }

    const worldDelta = cameraDragDeltaToWorld(deltaScreen, pan.cameraStart)
    setCamera({
      ...pan.cameraStart,
      x: pan.cameraStart.x - worldDelta.x,
      y: pan.cameraStart.y - worldDelta.y,
    })
  }

  function handleViewportPointerUp(event: PointerEvent<HTMLDivElement>) {
    const interaction = objectInteractionRef.current
    if (interaction && interaction.pointerId === event.pointerId) {
      objectInteractionRef.current = null
      commitCommandBatch()
    }

    const pan = panRef.current
    if (pan && pan.pointerId === event.pointerId) {
      panRef.current = null
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div
      ref={viewportRef}
      className="canvas-stage"
      onPointerDown={handleViewportPointerDown}
      onPointerMove={handleViewportPointerMove}
      onPointerUp={handleViewportPointerUp}
      onPointerCancel={handleViewportPointerUp}
    >
      <svg
        width={viewportSize.width}
        height={viewportSize.height}
        className="grid-svg"
        aria-hidden="true"
      >
        <g className="minor-grid">
          {minorGridLines.x.map((line) => {
            const start = worldToScreen(
              { x: line.value, y: worldBounds.minY },
              camera,
              viewportSize
            )
            const end = worldToScreen({ x: line.value, y: worldBounds.maxY }, camera, viewportSize)
            return <line key={`x-${line.id}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
          })}
          {minorGridLines.y.map((line) => {
            const start = worldToScreen(
              { x: worldBounds.minX, y: line.value },
              camera,
              viewportSize
            )
            const end = worldToScreen({ x: worldBounds.maxX, y: line.value }, camera, viewportSize)
            return <line key={`y-${line.id}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
          })}
        </g>

        <g className="major-grid">
          {majorGridLines.x.map((line) => {
            const start = worldToScreen(
              { x: line.value, y: worldBounds.minY },
              camera,
              viewportSize
            )
            const end = worldToScreen({ x: line.value, y: worldBounds.maxY }, camera, viewportSize)
            return <line key={`mx-${line.id}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
          })}
          {majorGridLines.y.map((line) => {
            const start = worldToScreen(
              { x: worldBounds.minX, y: line.value },
              camera,
              viewportSize
            )
            const end = worldToScreen({ x: worldBounds.maxX, y: line.value }, camera, viewportSize)
            return <line key={`my-${line.id}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
          })}
        </g>
      </svg>

      <div className="objects-layer">
        {orderedObjects.map((object) => {
          const center = worldToScreen({ x: object.x, y: object.y }, camera, viewportSize)
          const widthPx = object.w * camera.zoom
          const heightPx = object.h * camera.zoom
          const isSelected = selectedObjectIds.includes(object.id)

          const baseStyle = {
            left: center.x - widthPx / 2,
            top: center.y - heightPx / 2,
            width: widthPx,
            height: heightPx,
            transform: `rotate(${object.rotation + camera.rotation}rad)`,
          }

          const objectClasses = [
            'canvas-object',
            object.type,
            isSelected ? 'selected' : '',
            object.locked ? 'locked' : '',
          ]
            .filter(Boolean)
            .join(' ')

          const shapeStyle =
            object.type === 'shape_rect' ||
            object.type === 'shape_circle' ||
            object.type === 'shape_arrow'
              ? {
                  borderColor: object.shapeData.borderColor,
                  borderStyle: object.shapeData.borderType,
                  borderWidth: object.shapeData.borderWidth * camera.zoom,
                  background: getShapeBackground(object.shapeData),
                  opacity: object.shapeData.opacityPercent / 100,
                  borderRadius: object.type === 'shape_circle' ? '9999px' : undefined,
                }
              : {}

          return (
            <div
              key={object.id}
              className={objectClasses}
              style={{ ...baseStyle, ...shapeStyle }}
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                selectObjects([object.id])
                beginObjectInteraction(event, object, 'move')
              }}
            >
              {object.type === 'shape_arrow' ? (
                <svg
                  viewBox="0 0 100 20"
                  preserveAspectRatio="none"
                  className="arrow-svg"
                  aria-hidden="true"
                >
                  <line x1="0" y1="10" x2="88" y2="10" />
                  <polygon points="88,3 100,10 88,17" />
                </svg>
              ) : (
                <span>{getObjectLabel(object)}</span>
              )}
            </div>
          )
        })}
      </div>

      {selectedObject && (
        <div
          className={`selection-overlay ${selectedObject.locked ? 'locked' : ''}`}
          style={{
            left:
              worldToScreen({ x: selectedObject.x, y: selectedObject.y }, camera, viewportSize).x -
              (selectedObject.w * camera.zoom) / 2,
            top:
              worldToScreen({ x: selectedObject.x, y: selectedObject.y }, camera, viewportSize).y -
              (selectedObject.h * camera.zoom) / 2,
            width: selectedObject.w * camera.zoom,
            height: selectedObject.h * camera.zoom,
            transform: `rotate(${selectedObject.rotation + camera.rotation}rad)`,
          }}
        >
          {!selectedObject.locked && (
            <>
              <button
                type="button"
                className="resize-handle"
                aria-label="Resize"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  beginObjectInteraction(event, selectedObject, 'resize')
                }}
              />
              <button
                type="button"
                className="rotate-handle"
                aria-label="Rotate"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  beginObjectInteraction(event, selectedObject, 'rotate')
                }}
              />
            </>
          )}

          <button
            type="button"
            className="lock-handle"
            onClick={(event) => {
              event.stopPropagation()
              toggleObjectLock(selectedObject.id)
            }}
            aria-label={selectedObject.locked ? 'Unlock object' : 'Lock object'}
            title={selectedObject.locked ? 'Unlock object' : 'Lock object'}
          >
            <FontAwesomeIcon icon={selectedObject.locked ? faLockOpen : faLock} />
          </button>
        </div>
      )}

      <div className="camera-card" aria-label="Camera position">
        <span className="camera-pos-item">X {camera.x.toFixed(1)}</span>
        <span className="camera-pos-item">Y {camera.y.toFixed(1)}</span>
        <span className="camera-pos-item">
          <FontAwesomeIcon icon={faMagnifyingGlass} />
          {camera.zoom.toFixed(2)}
        </span>
        <span className="camera-pos-item">
          <FontAwesomeIcon icon={faCompass} />
          {((camera.rotation * 180) / Math.PI).toFixed(1)}°
        </span>
      </div>
    </div>
  )
}
