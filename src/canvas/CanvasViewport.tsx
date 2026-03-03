import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
  type WheelEvent,
} from 'react'
import { useEditorStore } from '../store'
import {
  cameraDragDeltaToWorld,
  clamp,
  getDynamicGridStep,
  getViewWorldBounds,
  screenToWorld,
  type Point,
  type ViewportSize,
  worldToScreen,
} from './math'

interface GridLine {
  id: string
  axis: 'x' | 'y'
  value: number
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

function createGridLines(min: number, max: number, step: number, axis: 'x' | 'y'): GridLine[] {
  const safeStep = Math.max(0.00001, step)
  const start = Math.floor(min / safeStep) * safeStep
  const lines: GridLine[] = []

  for (let value = start; value <= max + safeStep; value += safeStep) {
    lines.push({
      id: `${axis}-${value.toFixed(3)}`,
      axis,
      value,
    })
  }

  return lines
}

export function CanvasViewport() {
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragOriginRef = useRef<Point | null>(null)
  const dragCameraStartRef = useRef(useEditorStore.getState().camera)

  const camera = useEditorStore((state) => state.camera)
  const setCamera = useEditorStore((state) => state.setCamera)
  const canvasSettings = useEditorStore((state) => state.document.canvas)

  const viewportSize = useViewportSize(viewportRef)
  const gridStep = useMemo(
    () => getDynamicGridStep(canvasSettings.baseGridSize, camera.zoom),
    [canvasSettings.baseGridSize, camera.zoom]
  )
  const minorGridStep = gridStep / 10
  const worldBounds = useMemo(() => getViewWorldBounds(camera, viewportSize), [camera, viewportSize])

  const majorGridLines = useMemo(() => {
    if (!canvasSettings.gridVisible) {
      return { x: [], y: [] } as { x: GridLine[]; y: GridLine[] }
    }
    return {
      x: createGridLines(worldBounds.minX, worldBounds.maxX, gridStep, 'x'),
      y: createGridLines(worldBounds.minY, worldBounds.maxY, gridStep, 'y'),
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
      x: createGridLines(worldBounds.minX, worldBounds.maxX, minorGridStep, 'x'),
      y: createGridLines(worldBounds.minY, worldBounds.maxY, minorGridStep, 'y'),
    }
  }, [
    canvasSettings.gridVisible,
    minorGridStep,
    worldBounds.maxX,
    worldBounds.maxY,
    worldBounds.minX,
    worldBounds.minY,
  ])

  function screenPointFromPointer(event: PointerEvent | WheelEvent): Point {
    const element = viewportRef.current
    if (!element) {
      return { x: 0, y: 0 }
    }
    const bounds = element.getBoundingClientRect()
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) {
      return
    }

    event.preventDefault()
    dragOriginRef.current = { x: event.clientX, y: event.clientY }
    dragCameraStartRef.current = camera
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragOriginRef.current) {
      return
    }

    const deltaScreen = {
      x: event.clientX - dragOriginRef.current.x,
      y: event.clientY - dragOriginRef.current.y,
    }

    const worldDelta = cameraDragDeltaToWorld(deltaScreen, dragCameraStartRef.current)
    setCamera({
      ...dragCameraStartRef.current,
      x: dragCameraStartRef.current.x - worldDelta.x,
      y: dragCameraStartRef.current.y - worldDelta.y,
    })
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragOriginRef.current) {
      dragOriginRef.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault()
    const pointerScreen = screenPointFromPointer(event)

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

  return (
    <div
      ref={viewportRef}
      className="canvas-stage"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
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
            return <line key={line.id} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
          })}
          {minorGridLines.y.map((line) => {
            const start = worldToScreen(
              { x: worldBounds.minX, y: line.value },
              camera,
              viewportSize
            )
            const end = worldToScreen({ x: worldBounds.maxX, y: line.value }, camera, viewportSize)
            return <line key={line.id} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
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
            return <line key={line.id} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
          })}
          {majorGridLines.y.map((line) => {
            const start = worldToScreen(
              { x: worldBounds.minX, y: line.value },
              camera,
              viewportSize
            )
            const end = worldToScreen({ x: worldBounds.maxX, y: line.value }, camera, viewportSize)
            return <line key={line.id} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
          })}
        </g>
      </svg>

      <div className="camera-card">
        <h3>Canvas Viewport</h3>
        <p>
          Drag to pan, wheel to zoom, and <strong>Alt + wheel</strong> to rotate.
        </p>
        <dl className="camera-stats">
          <dt>X</dt>
          <dd>{camera.x.toFixed(1)}</dd>
          <dt>Y</dt>
          <dd>{camera.y.toFixed(1)}</dd>
          <dt>Zoom</dt>
          <dd>{camera.zoom.toFixed(3)}</dd>
          <dt>Rotation</dt>
          <dd>{camera.rotation.toFixed(3)}</dd>
        </dl>
      </div>
    </div>
  )
}
