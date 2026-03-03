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
  faRotate,
  faSquare,
  faTrashCan,
  faUndo,
} from '@fortawesome/free-solid-svg-icons'
import { CanvasViewport } from './canvas'
import type { CanvasObject, ShapeData } from './model'
import { useEditorStore } from './store'
import './App.css'

function App() {
  const document = useEditorStore((state) => state.document)
  const selectedObjectIds = useEditorStore((state) => state.ui.selectedObjectIds)
  const createObject = useEditorStore((state) => state.createObject)
  const toggleObjectLock = useEditorStore((state) => state.toggleObjectLock)

  const selectedObject =
    selectedObjectIds.length === 1
      ? (document.objects.find((entry) => entry.id === selectedObjectIds[0]) ?? null)
      : null

  const projectActions = [
    { label: 'New Document', icon: faFileCirclePlus },
    { label: 'Load', icon: faFileArrowDown },
    { label: 'Save', icon: faFloppyDisk },
    { label: 'Export HTML', icon: faDownload },
    { label: 'Undo', icon: faUndo },
    { label: 'Present', icon: faPlay },
    { label: 'Present Current', icon: faForwardStep },
  ]

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
    const base = {
      id: createId(),
      x: 0,
      y: 0,
      w: 260,
      h: 160,
      rotation: 0,
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
            keepAspectRatio: true,
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
          w: 320,
          h: 60,
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <header className="sidebar-header">
          <h1>Infiniprez</h1>
          <p>React MVP shell</p>
        </header>

        <section className="panel">
          <h2>Project + Session</h2>
          <div className="action-grid">
            {projectActions.map((action) => (
              <button key={action.label} type="button" className="tool-btn">
                <FontAwesomeIcon icon={action.icon} />
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title-row">
            <h2>Slides</h2>
            <button type="button" className="panel-icon-btn" aria-label="Create slide">
              <FontAwesomeIcon icon={faFileCirclePlus} />
            </button>
          </div>
          <ol className="slide-list">
            <li className="slide-item active">Intro Shot</li>
            <li className="slide-item">Problem</li>
            <li className="slide-item">Solution</li>
          </ol>
          <div className="inline-actions">
            <button type="button">Update</button>
            <button type="button" className="danger">
              <FontAwesomeIcon icon={faTrashCan} />
              <span>Delete</span>
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
                className="tool-btn"
                disabled={tool.label === 'Group' || tool.label === 'Ungroup'}
                onClick={() => handleObjectTool(tool.label)}
              >
                <FontAwesomeIcon icon={tool.icon} />
                <span>{tool.label}</span>
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
              <button
                type="button"
                className="lock-toggle-btn"
                onClick={() => toggleObjectLock(selectedObject.id)}
              >
                <FontAwesomeIcon icon={selectedObject.locked ? faLockOpen : faLock} />
                <span>{selectedObject.locked ? 'Unlock' : 'Lock'}</span>
              </button>
            </div>
          ) : (
            <p className="panel-empty">Select one object to view transform properties.</p>
          )}
        </section>
      </aside>

      <main className="canvas-area">
        <div className="canvas-toolbar">
          <button type="button">
            <FontAwesomeIcon icon={faArrowsLeftRightToLine} />
            <span>Snap</span>
          </button>
          <button type="button">
            <FontAwesomeIcon icon={faRotate} />
            <span>Rotate View</span>
          </button>
          <button type="button">
            <FontAwesomeIcon icon={faCopy} />
            <span>Copy</span>
          </button>
        </div>

        <CanvasViewport />
      </main>
    </div>
  )
}

export default App
