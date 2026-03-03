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
  faObjectUngroup,
  faPenToSquare,
  faPlay,
  faRotate,
  faSquare,
  faTrashCan,
  faUndo,
} from '@fortawesome/free-solid-svg-icons'
import { CanvasViewport } from './canvas'
import './App.css'

function App() {
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

  const propertyItems = ['X', 'Y', 'W', 'H', 'Rotation', 'Lock/Unlock', 'Layer: Top/Up/Down/Bottom']

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
              <button key={tool.label} type="button" className="tool-btn">
                <FontAwesomeIcon icon={tool.icon} />
                <span>{tool.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Selected Object</h2>
          <ul className="property-list">
            {propertyItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
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
