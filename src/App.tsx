import { useEffect, useMemo, useRef, type ChangeEvent, type CSSProperties } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowsLeftRightToLine,
  faArrowsUpDownLeftRight,
  faCircle,
  faCopy,
  faCropSimple,
  faDownload,
  faFileArrowDown,
  faFileCirclePlus,
  faFloppyDisk,
  faForwardStep,
  faLayerGroup,
  faLock,
  faLockOpen,
  faObjectUngroup,
  faPenToSquare,
  faPlay,
  faRotateLeft,
  faRotate,
  faSquare,
  faTrashCan,
  faUndo,
} from '@fortawesome/free-solid-svg-icons'
import { CanvasViewport } from './canvas'
import {
  deserializeDocument,
  serializeDocument,
  type CanvasObject,
  type DocumentModel,
  type ShapeData,
  type Slide,
} from './model'
import { useEditorStore } from './store'
import type { CameraState } from './store/types'
import './App.css'

function SortableSlideItem({
  slide,
  isActive,
  onClick,
}: {
  slide: Slide
  isActive: boolean
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slide.id,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`slide-item ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''}`}
      {...attributes}
      {...listeners}
      title="Drag to reorder"
      onClick={onClick}
    >
      {slide.name || `Slide ${slide.orderIndex + 1}`}
    </li>
  )
}

function parseCameraState(value: unknown): CameraState | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const entry = value as Partial<CameraState>
  if (
    typeof entry.x !== 'number' ||
    typeof entry.y !== 'number' ||
    typeof entry.zoom !== 'number' ||
    typeof entry.rotation !== 'number'
  ) {
    return null
  }

  if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y) || !Number.isFinite(entry.rotation)) {
    return null
  }
  if (!Number.isFinite(entry.zoom) || entry.zoom <= 0) {
    return null
  }

  return {
    x: entry.x,
    y: entry.y,
    zoom: entry.zoom,
    rotation: entry.rotation,
  }
}

function parseStoredFile(payload: string): { document: DocumentModel; camera: CameraState | null } {
  const parsed = JSON.parse(payload) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid file payload')
  }

  const entry = parsed as Record<string, unknown>
  if ('document' in entry) {
    return {
      document: deserializeDocument(JSON.stringify(entry.document)),
      camera: parseCameraState(entry.camera),
    }
  }

  return {
    document: deserializeDocument(payload),
    camera: null,
  }
}

function hasLockedAncestor(object: CanvasObject, objectById: Map<string, CanvasObject>): boolean {
  let parentId = object.parentGroupId
  while (parentId) {
    const parent = objectById.get(parentId)
    if (!parent || parent.type !== 'group') {
      return false
    }
    if (parent.locked) {
      return true
    }
    parentId = parent.parentGroupId
  }
  return false
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

const AUTOSAVE_LATEST_KEY = 'infiniprez.autosave.latest'
const AUTOSAVE_BACKUPS_KEY = 'infiniprez.autosave.backups'
const AUTOSAVE_BACKUP_LIMIT = 200

interface AutosavePayload {
  snapshot: string
  savedAt: string
}

function interpolateCamera(start: CameraState, end: CameraState, t: number): CameraState {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    zoom: start.zoom + (end.zoom - start.zoom) * t,
    rotation: start.rotation + (end.rotation - start.rotation) * t,
  }
}

function App() {
  const loadInputRef = useRef<HTMLInputElement>(null)
  const didAttemptAutosaveRestoreRef = useRef(false)
  const latestDocumentSnapshotRef = useRef<string>('')
  const latestAutosavedSnapshotRef = useRef<string>('')

  const document = useEditorStore((state) => state.document)
  const camera = useEditorStore((state) => state.camera)
  const setCamera = useEditorStore((state) => state.setCamera)
  const undo = useEditorStore((state) => state.undo)
  const canUndo = useEditorStore((state) => state.history.past.length > 0)
  const replaceDocument = useEditorStore((state) => state.replaceDocument)
  const resetDocument = useEditorStore((state) => state.resetDocument)
  const mode = useEditorStore((state) => state.ui.mode)
  const setMode = useEditorStore((state) => state.setMode)
  const selectedObjectIds = useEditorStore((state) => state.ui.selectedObjectIds)
  const activeGroupId = useEditorStore((state) => state.ui.activeGroupId)
  const createObject = useEditorStore((state) => state.createObject)
  const toggleObjectLock = useEditorStore((state) => state.toggleObjectLock)
  const setShapeOpacity = useEditorStore((state) => state.setShapeOpacity)
  const enterGroup = useEditorStore((state) => state.enterGroup)
  const reorderSlides = useEditorStore((state) => state.reorderSlides)
  const createSlide = useEditorStore((state) => state.createSlide)
  const updateSlide = useEditorStore((state) => state.updateSlide)
  const deleteSlide = useEditorStore((state) => state.deleteSlide)
  const selectSlide = useEditorStore((state) => state.selectSlide)
  const selectedSlideId = useEditorStore((state) => state.ui.selectedSlideId)
  const transitionFrameRef = useRef<number | null>(null)
  const timedAdvanceTimeoutRef = useRef<number | null>(null)

  const selectedObject =
    selectedObjectIds.length === 1
      ? (document.objects.find((entry) => entry.id === selectedObjectIds[0]) ?? null)
      : null
  const objectById = new Map(document.objects.map((object) => [object.id, object]))
  const selectedShapeObject =
    selectedObject &&
      (selectedObject.type === 'shape_rect' ||
        selectedObject.type === 'shape_circle' ||
        selectedObject.type === 'shape_arrow')
      ? selectedObject
      : null
  const selectedGroupObject =
    selectedObject && selectedObject.type === 'group' ? selectedObject : null
  const selectedObjectLockedByAncestor = selectedObject
    ? hasLockedAncestor(selectedObject, objectById)
    : false
  const canToggleGroupFromSelection = Boolean(selectedGroupObject && activeGroupId === null)
  const orderedSlides = useMemo(
    () => [...document.slides].sort((a, b) => a.orderIndex - b.orderIndex),
    [document.slides]
  )
  const activeSlideId = selectedSlideId ?? orderedSlides[0]?.id ?? null
  const activeSlide = orderedSlides.find((slide) => slide.id === activeSlideId) ?? null
  const activeSlideRotationDeg = activeSlide ? (activeSlide.rotation * 180) / Math.PI : 0
  const activeSlideIndex = activeSlide ? orderedSlides.findIndex((slide) => slide.id === activeSlide.id) : -1
  const slideDnDSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    })
  )

  function stopSlideTransition() {
    if (transitionFrameRef.current !== null) {
      cancelAnimationFrame(transitionFrameRef.current)
      transitionFrameRef.current = null
    }
  }

  function transitionCameraToSlide(slide: Slide, forceInstant = false) {
    stopSlideTransition()
    const targetCamera: CameraState = {
      x: slide.x,
      y: slide.y,
      zoom: slide.zoom,
      rotation: slide.rotation,
    }

    const transitionType = forceInstant ? 'instant' : slide.transitionType
    const durationMs =
      transitionType === 'instant'
        ? 0
        : Math.min(10_000, Math.max(1_000, slide.transitionDurationMs))
    if (durationMs <= 0) {
      setCamera(targetCamera)
      return
    }

    const easing = transitionType === 'linear' ? (t: number) => t : easeInOutCubic
    const startCamera = camera
    const startedAtMs = performance.now()

    const tick = (nowMs: number) => {
      const elapsed = nowMs - startedAtMs
      const progress = Math.min(1, Math.max(0, elapsed / durationMs))
      const eased = easing(progress)
      setCamera(interpolateCamera(startCamera, targetCamera, eased))
      if (progress < 1) {
        transitionFrameRef.current = requestAnimationFrame(tick)
      } else {
        transitionFrameRef.current = null
      }
    }

    transitionFrameRef.current = requestAnimationFrame(tick)
  }

  const objectTools = [
    { label: 'Textbox', icon: faPenToSquare },
    { label: 'Image', icon: faCropSimple },
    { label: 'Rectangle', icon: faSquare },
    { label: 'Circle', icon: faCircle },
    { label: 'Arrow', icon: faArrowsUpDownLeftRight },
    { label: 'Group', icon: faLayerGroup },
    { label: 'Ungroup', icon: faObjectUngroup },
  ]

  function createId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    return `id-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  }

  function getNextZIndex() {
    const maxZ = document.objects.reduce((max, entry) => Math.max(max, entry.zIndex), 0)
    return maxZ + 1
  }

  function getDefaultShapeData(): ShapeData {
    return {
      borderColor: '#9db5de',
      borderType: 'solid',
      borderWidth: 2,
      fillMode: 'solid',
      fillColor: '#244a80',
      fillGradient: null,
      opacityPercent: 100,
    }
  }

  function handleObjectTool(label: string) {
    const safeZoom = Math.max(camera.zoom, 0.001)
    const creationScale = 1 / safeZoom

    const base = {
      id: createId(),
      x: camera.x,
      y: camera.y,
      w: 260 * creationScale,
      h: 160 * creationScale,
      rotation: -camera.rotation,
      locked: false,
      zIndex: getNextZIndex(),
      parentGroupId: null,
    } satisfies Pick<
      CanvasObject,
      'id' | 'x' | 'y' | 'w' | 'h' | 'rotation' | 'locked' | 'zIndex' | 'parentGroupId'
    >

    switch (label) {
      case 'Textbox':
        createObject({
          ...base,
          type: 'textbox',
          textboxData: {
            runs: [
              {
                text: 'New text',
                bold: false,
                italic: false,
                underline: false,
                color: '#f0f3fc',
                fontSize: 28,
              },
            ],
            fontFamily: 'Space Grotesk',
            alignment: 'left',
            listType: 'none',
            autoHeight: true,
          },
        })
        break
      case 'Image':
        createObject({
          ...base,
          type: 'image',
          imageData: {
            assetId: '',
            intrinsicWidth: 1200,
            intrinsicHeight: 800,
            keepAspectRatio: false,
          },
        })
        break
      case 'Rectangle':
        createObject({
          ...base,
          type: 'shape_rect',
          shapeData: getDefaultShapeData(),
        })
        break
      case 'Circle':
        createObject({
          ...base,
          type: 'shape_circle',
          shapeData: getDefaultShapeData(),
        })
        break
      case 'Arrow':
        createObject({
          ...base,
          w: 320 * creationScale,
          h: 60 * creationScale,
          type: 'shape_arrow',
          shapeData: {
            ...getDefaultShapeData(),
            fillColor: 'transparent',
          },
        })
        break
      default:
        break
    }
  }

  function handleNewDocument() {
    const shouldReset = window.confirm(
      'Reset to a new empty document? Unsaved changes will be lost.'
    )
    if (!shouldReset) {
      return
    }
    resetDocument()
  }

  function handleShapeOpacityChange(objectId: string, value: string) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      return
    }
    setShapeOpacity(objectId, parsed)
  }

  function handleSlideDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : null
    if (!overId || activeId === overId) {
      return
    }

    const oldIndex = orderedSlides.findIndex((slide) => slide.id === activeId)
    const newIndex = orderedSlides.findIndex((slide) => slide.id === overId)
    if (oldIndex < 0 || newIndex < 0) {
      return
    }

    const reordered = arrayMove(orderedSlides, oldIndex, newIndex)
    reorderSlides(reordered.map((slide) => slide.id))
  }

  function goToSlideByIndex(index: number) {
    const target = orderedSlides[index]
    if (!target) {
      return
    }
    selectSlide(target.id)
    transitionCameraToSlide(target)
  }

  function focusCameraOnSlide(slide: Slide) {
    transitionCameraToSlide({
      ...slide,
      transitionType: 'ease',
      transitionDurationMs: 700,
    })
  }

  function handleSlideSelection(slideId: string) {
    const target = orderedSlides.find((slide) => slide.id === slideId)
    if (!target) {
      return
    }
    selectSlide(slideId)
    if (mode === 'present') {
      transitionCameraToSlide(target)
      return
    }
    focusCameraOnSlide(target)
  }

  function goToNextSlide() {
    if (activeSlideIndex < 0) {
      return
    }
    goToSlideByIndex(activeSlideIndex + 1)
  }

  function goToPreviousSlide() {
    if (activeSlideIndex < 0) {
      return
    }
    goToSlideByIndex(activeSlideIndex - 1)
  }

  function enterPresentMode(fromCurrent: boolean) {
    if (orderedSlides.length === 0) {
      setMode('present')
      selectSlide(null)
    } else {
      const startSlide =
        fromCurrent && activeSlide
          ? activeSlide
          : orderedSlides[0]
      selectSlide(startSlide.id)
      setMode('present')
      transitionCameraToSlide(startSlide, true)
    }

    if (typeof window.document.documentElement.requestFullscreen === 'function') {
      void window.document.documentElement.requestFullscreen().catch(() => undefined)
    }
  }

  function exitPresentMode() {
    setMode('edit')
    stopSlideTransition()
    if (timedAdvanceTimeoutRef.current !== null) {
      window.clearTimeout(timedAdvanceTimeoutRef.current)
      timedAdvanceTimeoutRef.current = null
    }

    if (
      window.document.fullscreenElement &&
      typeof window.document.exitFullscreen === 'function'
    ) {
      void window.document.exitFullscreen().catch(() => undefined)
    }
  }

  function handleCreateSlide() {
    const slide: Slide = {
      id: createId(),
      name: `Slide ${orderedSlides.length + 1}`,
      x: camera.x,
      y: camera.y,
      zoom: camera.zoom,
      rotation: camera.rotation,
      triggerMode: 'manual',
      triggerDelayMs: 0,
      transitionType: 'ease',
      transitionDurationMs: 2000,
      orderIndex: orderedSlides.length,
    }
    createSlide(slide)
    selectSlide(slide.id)
  }

  function handleUpdateSlideFromCamera() {
    if (!activeSlide) {
      return
    }
    updateSlide(activeSlide.id, {
      ...activeSlide,
      x: camera.x,
      y: camera.y,
      zoom: camera.zoom,
      rotation: camera.rotation,
    })
  }

  function handleDeleteActiveSlide() {
    if (!activeSlide) {
      return
    }
    deleteSlide(activeSlide.id)
  }

  function updateActiveSlide(patch: Partial<Slide>) {
    if (!activeSlide) {
      return
    }
    updateSlide(activeSlide.id, {
      ...activeSlide,
      ...patch,
    })
  }

  function parseNumberInput(value: string): number | null {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      return null
    }
    return parsed
  }

  useEffect(() => {
    if (didAttemptAutosaveRestoreRef.current) {
      return
    }
    didAttemptAutosaveRestoreRef.current = true

    try {
      const raw = window.localStorage.getItem(AUTOSAVE_LATEST_KEY)
      if (!raw) {
        return
      }
      const payload = JSON.parse(raw) as Partial<AutosavePayload>
      if (!payload || typeof payload.snapshot !== 'string') {
        return
      }

      const loaded = parseStoredFile(payload.snapshot)
      replaceDocument(loaded.document)
      if (loaded.camera) {
        setCamera(loaded.camera)
      }
      latestDocumentSnapshotRef.current = payload.snapshot
      latestAutosavedSnapshotRef.current = payload.snapshot
    } catch {
      // Ignore invalid autosave payloads.
    }
  }, [replaceDocument, setCamera])

  useEffect(() => {
    latestDocumentSnapshotRef.current = serializeDocument(document)
  }, [document])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const snapshot = latestDocumentSnapshotRef.current
      if (!snapshot || snapshot === latestAutosavedSnapshotRef.current) {
        return
      }

      const payload = {
        snapshot,
        savedAt: new Date().toISOString(),
      }
      try {
        window.localStorage.setItem(AUTOSAVE_LATEST_KEY, JSON.stringify(payload))

        const rawBackups = window.localStorage.getItem(AUTOSAVE_BACKUPS_KEY)
        const parsedBackups = rawBackups ? (JSON.parse(rawBackups) as unknown) : []
        const backups = Array.isArray(parsedBackups) ? (parsedBackups as AutosavePayload[]) : []
        backups.push(payload)
        const cappedBackups = backups.slice(-AUTOSAVE_BACKUP_LIMIT)
        window.localStorage.setItem(AUTOSAVE_BACKUPS_KEY, JSON.stringify(cappedBackups))
      } catch {
        // Ignore storage failures in restricted browser modes.
      }
      latestAutosavedSnapshotRef.current = snapshot
    }, 20_000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (mode !== 'present') {
      if (timedAdvanceTimeoutRef.current !== null) {
        window.clearTimeout(timedAdvanceTimeoutRef.current)
        timedAdvanceTimeoutRef.current = null
      }
      return
    }
    if (!activeSlide || activeSlide.triggerMode !== 'timed') {
      return
    }
    if (activeSlideIndex < 0 || activeSlideIndex >= orderedSlides.length - 1) {
      return
    }

    timedAdvanceTimeoutRef.current = window.setTimeout(() => {
      goToNextSlide()
    }, activeSlide.triggerDelayMs)

    return () => {
      if (timedAdvanceTimeoutRef.current !== null) {
        window.clearTimeout(timedAdvanceTimeoutRef.current)
        timedAdvanceTimeoutRef.current = null
      }
    }
  }, [
    activeSlide,
    activeSlideIndex,
    mode,
    orderedSlides.length,
    selectedSlideId,
    activeSlide?.triggerDelayMs,
    activeSlide?.triggerMode,
  ])

  useEffect(() => {
    if (mode !== 'present') {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Right' ||
        event.key === 'ArrowRight' ||
        event.key === 'ArrowDown' ||
        event.key === 'PageDown' ||
        event.key === ' '
      ) {
        event.preventDefault()
        goToNextSlide()
        return
      }

      if (
        event.key === 'Left' ||
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowUp' ||
        event.key === 'PageUp'
      ) {
        event.preventDefault()
        goToPreviousSlide()
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        exitPresentMode()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, selectedSlideId, activeSlideIndex, orderedSlides.length])

  useEffect(() => {
    return () => {
      stopSlideTransition()
      if (timedAdvanceTimeoutRef.current !== null) {
        window.clearTimeout(timedAdvanceTimeoutRef.current)
        timedAdvanceTimeoutRef.current = null
      }
    }
  }, [])

  function handleSaveDocument() {
    const serialized = JSON.stringify(
      {
        document: JSON.parse(serializeDocument(document)),
        camera,
      },
      null,
      2
    )
    const blob = new Blob([serialized], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const downloadLink = window.document.createElement('a')
    downloadLink.href = url
    downloadLink.download = 'infiniprez-document.json'
    downloadLink.click()
    URL.revokeObjectURL(url)
  }

  function handleLoadClick() {
    loadInputRef.current?.click()
  }

  async function handleLoadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const payload = await file.text()
      const loaded = parseStoredFile(payload)
      replaceDocument(loaded.document)
      if (loaded.camera) {
        setCamera(loaded.camera)
      }
    } catch {
      window.alert('Failed to load file. Use a valid Infiniprez JSON document.')
    } finally {
      event.target.value = ''
    }
  }

  const projectActions = [
    { label: 'New Document', icon: faFileCirclePlus, onClick: handleNewDocument, disabled: false },
    { label: 'Load', icon: faFileArrowDown, onClick: handleLoadClick, disabled: false },
    { label: 'Save', icon: faFloppyDisk, onClick: handleSaveDocument, disabled: false },
    {
      label: 'Export HTML',
      icon: faDownload,
      onClick: () => undefined,
      disabled: true,
      disabledReason: 'Not implemented yet',
    },
    { label: 'Undo', icon: faUndo, onClick: undo, disabled: !canUndo },
    {
      label: 'Present',
      icon: faPlay,
      onClick: () => enterPresentMode(false),
      disabled: false,
    },
    {
      label: 'Present Current',
      icon: faForwardStep,
      onClick: () => enterPresentMode(true),
      disabled: false,
    },
  ]

  return (
    <div className={`app-shell ${mode === 'present' ? 'present-mode' : ''}`}>
      <aside className="sidebar">
        <section className="panel">
          <h2>Project + Session</h2>
          <div className="action-grid">
            {projectActions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="tool-btn icon-btn"
                aria-label={action.label}
                title={
                  action.disabled
                    ? `${action.label}: ${action.disabledReason ?? 'Unavailable'}`
                    : action.label
                }
                onClick={action.onClick}
                disabled={action.disabled}
              >
                <FontAwesomeIcon icon={action.icon} />
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Slides</h2>
          {orderedSlides.length > 0 ? (
            <DndContext
              sensors={slideDnDSensors}
              collisionDetection={closestCenter}
              onDragEnd={handleSlideDragEnd}
            >
              <SortableContext
                items={orderedSlides.map((slide) => slide.id)}
                strategy={verticalListSortingStrategy}
              >
                <ol className="slide-list">
                  {orderedSlides.map((slide) => (
                    <SortableSlideItem
                      key={slide.id}
                      slide={slide}
                      isActive={slide.id === activeSlideId}
                      onClick={() => handleSlideSelection(slide.id)}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          ) : (
            <p className="panel-empty">No slides yet.</p>
          )}
          <div className="inline-actions">
            <button
              type="button"
              className="icon-btn"
              aria-label="Create slide"
              title="Create slide from current camera"
              onClick={handleCreateSlide}
            >
              <FontAwesomeIcon icon={faFileCirclePlus} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Update slide"
              title="Update selected slide from current camera"
              disabled={!activeSlide}
              onClick={handleUpdateSlideFromCamera}
            >
              <FontAwesomeIcon icon={faRotateLeft} />
            </button>
            <button
              type="button"
              className="danger icon-btn"
              aria-label="Delete slide"
              title="Delete selected slide"
              disabled={!activeSlide}
              onClick={handleDeleteActiveSlide}
            >
              <FontAwesomeIcon icon={faTrashCan} />
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>Slide Parameters</h2>
          {activeSlide ? (
            <div className="slide-params-panel" aria-label="Slide parameters">
              <label className="slide-param-field">
                <span>Name</span>
                <input
                  type="text"
                  value={activeSlide.name}
                  onChange={(event) => updateActiveSlide({ name: event.target.value })}
                />
              </label>

              <div className="slide-param-coords">
                <label className="slide-param-field">
                  <span>X</span>
                  <input
                    type="number"
                    step={1}
                    value={activeSlide.x}
                    onChange={(event) => {
                      const parsed = parseNumberInput(event.target.value)
                      if (parsed !== null) {
                        updateActiveSlide({ x: parsed })
                      }
                    }}
                  />
                </label>
                <label className="slide-param-field">
                  <span>Y</span>
                  <input
                    type="number"
                    step={1}
                    value={activeSlide.y}
                    onChange={(event) => {
                      const parsed = parseNumberInput(event.target.value)
                      if (parsed !== null) {
                        updateActiveSlide({ y: parsed })
                      }
                    }}
                  />
                </label>
              </div>

              <div className="slide-param-switch-row">
                <span>Trigger</span>
                <div className="slide-param-switch" role="group" aria-label="Trigger mode">
                  <button
                    type="button"
                    className={activeSlide.triggerMode === 'manual' ? 'active' : ''}
                    onClick={() => updateActiveSlide({ triggerMode: 'manual' })}
                  >
                    Manual
                  </button>
                  <button
                    type="button"
                    className={activeSlide.triggerMode === 'timed' ? 'active' : ''}
                    onClick={() => updateActiveSlide({ triggerMode: 'timed' })}
                  >
                    Timed
                  </button>
                </div>
              </div>

              <div className="slide-param-switch-row">
                <span>Transition</span>
                <div className="slide-param-switch switch-3" role="group" aria-label="Transition type">
                  <button
                    type="button"
                    className={activeSlide.transitionType === 'ease' ? 'active' : ''}
                    onClick={() => updateActiveSlide({ transitionType: 'ease' })}
                  >
                    Ease
                  </button>
                  <button
                    type="button"
                    className={activeSlide.transitionType === 'linear' ? 'active' : ''}
                    onClick={() => updateActiveSlide({ transitionType: 'linear' })}
                  >
                    Linear
                  </button>
                  <button
                    type="button"
                    className={activeSlide.transitionType === 'instant' ? 'active' : ''}
                    onClick={() => updateActiveSlide({ transitionType: 'instant' })}
                  >
                    Instant
                  </button>
                </div>
              </div>

              <label className="slide-param-slider">
                <span>
                  Zoom
                  <strong>{activeSlide.zoom.toFixed(2)}x</strong>
                </span>
                <input
                  type="range"
                  min={0.1}
                  max={4}
                  step={0.01}
                  value={activeSlide.zoom}
                  onChange={(event) => {
                    const parsed = parseNumberInput(event.target.value)
                    if (parsed !== null) {
                      updateActiveSlide({ zoom: Math.max(0.1, parsed) })
                    }
                  }}
                />
              </label>

              <label className="slide-param-slider">
                <span>
                  Rotation
                  <strong>{activeSlideRotationDeg.toFixed(0)}deg</strong>
                </span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={activeSlideRotationDeg}
                  onChange={(event) => {
                    const parsed = parseNumberInput(event.target.value)
                    if (parsed !== null) {
                      updateActiveSlide({ rotation: (parsed * Math.PI) / 180 })
                    }
                  }}
                />
              </label>

              <label className="slide-param-slider">
                <span>
                  Trigger Delay
                  <strong>{activeSlide.triggerDelayMs}ms</strong>
                </span>
                <input
                  type="range"
                  min={0}
                  max={3_600_000}
                  step={1_000}
                  value={activeSlide.triggerDelayMs}
                  disabled={activeSlide.triggerMode !== 'timed'}
                  onChange={(event) => {
                    const parsed = parseNumberInput(event.target.value)
                    if (parsed !== null) {
                      updateActiveSlide({
                        triggerDelayMs: Math.min(3_600_000, Math.max(0, Math.round(parsed))),
                      })
                    }
                  }}
                />
              </label>

              <label className="slide-param-slider">
                <span>
                  Duration
                  <strong>{activeSlide.transitionDurationMs}ms</strong>
                </span>
                <input
                  type="range"
                  min={activeSlide.transitionType === 'instant' ? 0 : 1000}
                  max={10_000}
                  step={100}
                  value={activeSlide.transitionDurationMs}
                  onChange={(event) => {
                    const parsed = parseNumberInput(event.target.value)
                    if (parsed !== null) {
                      const rounded = Math.round(parsed)
                      const clamped =
                        activeSlide.transitionType === 'instant'
                          ? Math.min(10_000, Math.max(0, rounded))
                          : Math.min(10_000, Math.max(1_000, rounded))
                      updateActiveSlide({ transitionDurationMs: clamped })
                    }
                  }}
                />
              </label>
            </div>
          ) : (
            <p className="panel-empty">Create or select a slide to edit parameters.</p>
          )}
        </section>

        <section className="panel">
          <h2>Object Tools</h2>
          <div className="action-grid">
            {objectTools.map((tool) => (
              <button
                key={tool.label}
                type="button"
                className="tool-btn icon-btn"
                disabled={tool.label === 'Group' || tool.label === 'Ungroup'}
                onClick={() => handleObjectTool(tool.label)}
                aria-label={tool.label}
                title={tool.label}
              >
                <FontAwesomeIcon icon={tool.icon} />
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Selected Object</h2>
          {selectedObject ? (
            <div className="selected-object-grid">
              <div>X</div>
              <div>{selectedObject.x.toFixed(1)}</div>
              <div>Y</div>
              <div>{selectedObject.y.toFixed(1)}</div>
              <div>W</div>
              <div>{selectedObject.w.toFixed(1)}</div>
              <div>H</div>
              <div>{selectedObject.h.toFixed(1)}</div>
              <div>Rotation</div>
              <div>{selectedObject.rotation.toFixed(2)}</div>
              {selectedShapeObject && (
                <>
                  <div>Opacity</div>
                  <div className="shape-opacity-control">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={selectedShapeObject.shapeData.opacityPercent}
                      onChange={(event) =>
                        handleShapeOpacityChange(selectedShapeObject.id, event.target.value)
                      }
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={selectedShapeObject.shapeData.opacityPercent}
                      onChange={(event) =>
                        handleShapeOpacityChange(selectedShapeObject.id, event.target.value)
                      }
                    />
                    <span>%</span>
                  </div>
                </>
              )}
              <div className="selected-object-actions">
                <button
                  type="button"
                  className="lock-toggle-btn icon-btn"
                  onClick={() => toggleObjectLock(selectedObject.id)}
                  aria-label={
                    selectedObjectLockedByAncestor
                      ? 'Object inherits lock from parent group'
                      : selectedObject.locked
                        ? 'Unlock object'
                        : 'Lock object'
                  }
                  title={
                    selectedObjectLockedByAncestor
                      ? 'Unlock parent group to modify this object'
                      : selectedObject.locked
                        ? 'Unlock object'
                        : 'Lock object'
                  }
                  disabled={selectedObjectLockedByAncestor}
                >
                  <FontAwesomeIcon icon={selectedObject.locked ? faLockOpen : faLock} />
                </button>
                {canToggleGroupFromSelection && (
                  <button
                    type="button"
                    className="lock-toggle-btn icon-btn"
                    onClick={() => {
                      if (selectedGroupObject) {
                        enterGroup(selectedGroupObject.id)
                      }
                    }}
                    aria-label="Enter group"
                    title="Enter group"
                  >
                    <FontAwesomeIcon icon={faLayerGroup} />
                  </button>
                )}
              </div>
            </div>
          ) : selectedObjectIds.length > 1 ? (
            <p className="panel-empty">
              Numeric transform fields are available only for a single selected object.
            </p>
          ) : (
            <p className="panel-empty">Select one object to view transform properties.</p>
          )}
        </section>
      </aside>

      <main className="canvas-area">
        <div className="canvas-toolbar">
          <button
            type="button"
            className="icon-btn"
            aria-label="Snap"
            title="Snap (not implemented)"
            disabled
          >
            <FontAwesomeIcon icon={faArrowsLeftRightToLine} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Rotate view"
            title="Rotate view (not implemented)"
            disabled
          >
            <FontAwesomeIcon icon={faRotate} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Copy"
            title="Copy (not implemented)"
            disabled
          >
            <FontAwesomeIcon icon={faCopy} />
          </button>
        </div>

        {mode === 'present' && (
          <div className="present-hud">
            {!activeSlide && <span className="present-hud-status">No slides</span>}
            <button
              type="button"
              className="icon-btn"
              onClick={goToPreviousSlide}
              title="Previous slide"
              disabled={!activeSlide || activeSlideIndex <= 0}
            >
              <FontAwesomeIcon icon={faRotateLeft} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={goToNextSlide}
              title="Next slide"
              disabled={!activeSlide || activeSlideIndex >= orderedSlides.length - 1}
            >
              <FontAwesomeIcon icon={faForwardStep} />
            </button>
            <button type="button" className="icon-btn" onClick={exitPresentMode} title="Exit present mode">
              <FontAwesomeIcon icon={faPlay} />
            </button>
          </div>
        )}

        <input
          ref={loadInputRef}
          type="file"
          accept="application/json"
          onChange={handleLoadFile}
          style={{ display: 'none' }}
        />

        <CanvasViewport />
      </main>
    </div>
  )
}

export default App
