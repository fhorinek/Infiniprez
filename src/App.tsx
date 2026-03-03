import { useRef, type ChangeEvent, type CSSProperties } from 'react'
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
  faClock,
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

function App() {
  const loadInputRef = useRef<HTMLInputElement>(null)

  const document = useEditorStore((state) => state.document)
  const camera = useEditorStore((state) => state.camera)
  const setCamera = useEditorStore((state) => state.setCamera)
  const undo = useEditorStore((state) => state.undo)
  const canUndo = useEditorStore((state) => state.history.past.length > 0)
  const replaceDocument = useEditorStore((state) => state.replaceDocument)
  const resetDocument = useEditorStore((state) => state.resetDocument)
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
  const orderedSlides = [...document.slides].sort((a, b) => a.orderIndex - b.orderIndex)
  const activeSlideId = selectedSlideId ?? orderedSlides[0]?.id ?? null
  const activeSlide = orderedSlides.find((slide) => slide.id === activeSlideId) ?? null
  const slideDnDSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    })
  )

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
      onClick: () => undefined,
      disabled: true,
      disabledReason: 'Not implemented yet',
    },
    {
      label: 'Present Current',
      icon: faForwardStep,
      onClick: () => undefined,
      disabled: true,
      disabledReason: 'Not implemented yet',
    },
  ]

  return (
    <div className="app-shell">
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
          <div className="panel-title-row">
            <h2>Slides</h2>
            <button
              type="button"
              className="panel-icon-btn icon-btn"
              aria-label="Create slide"
              title="Create slide from current camera"
              onClick={handleCreateSlide}
            >
              <FontAwesomeIcon icon={faFileCirclePlus} />
            </button>
          </div>
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
                      onClick={() => selectSlide(slide.id)}
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
          <table className="property-table" aria-label="Slide parameters">
            <tbody>
              <tr>
                <td>Name</td>
                <td>Intro Shot</td>
              </tr>
              <tr>
                <td>X / Y</td>
                <td>120 / 80</td>
              </tr>
              <tr>
                <td>Zoom</td>
                <td>1.25</td>
              </tr>
              <tr>
                <td>Rotation</td>
                <td>12</td>
              </tr>
              <tr>
                <td>Trigger</td>
                <td>
                  <FontAwesomeIcon icon={faClock} /> timed
                </td>
              </tr>
            </tbody>
          </table>
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
