# Infiniprez Design (Draft v0.2)

## 1. Product Concept

Infiniprez is a presentation editor/player where all content lives on one infinite, zoomable canvas.  
“Slides” are named camera bookmarks (position + zoom + rotation + trigger) that define the presentation path.

Core promise:

- Build a non-linear, cinematic presentation in one workspace.
- Edit freely on canvas, then present via ordered camera moves between slide bookmarks.

## 2. Primary Modes

### 2.1 Edit Mode

- Left toolbar for project actions, slide management, and object tools.
- Right side interactive canvas for authoring.
- Full direct manipulation: pan/zoom/rotate view, select/move/resize/rotate objects.

### 2.2 Present Mode

- Fullscreen playback of slide sequence.
- Camera transitions between saved slide bookmarks.
- Trigger-based progression:
  - `manual`
  - `timed`

## 3. Layout

## 3.1 Left Sidebar (Edit Mode)

### Top section: Project + Session Controls

- New Document
- Load
- Save
- Export Presentation HTML
- Undo
- Redo
- Fullscreen
- Present from beginning
- Present from current
- Icons use Font Awesome (project-wide consistent set).
- `New Document` resets the editor to a blank document state (new ids/timestamps, empty objects/slides, default camera).
- `New Document` action should ask for confirmation before reset.

### Middle section: Slide List

- Ordered list of slides.
- Reordering by drag-and-drop.
- Each row shows at minimum:
  - Slide name
- Actions:
  - `+` Create new slide from current camera view
  - `Update` Overwrite selected slide camera with current view
  - `Delete` Remove selected slide

### Below slide list: Slide Parameters Table

- Fields for selected slide:
  - Name
  - X
  - Y
  - Zoom
  - Rotation
  - Trigger mode (`manual` or `timed`)
  - Trigger delay (for timed trigger, range `0..3600` seconds)
  - Transition type (`ease`, `linear`, `instant`)
  - Transition duration (per slide for `ease/linear`, range `1..10` seconds, ignored for `instant`)

### Bottom section: Object Tools

- Add textbox
- Add image
- Add clipart:
  - Rectangle
  - Circle
  - Arrow
    - MVP arrow is straight, single-headed.
- Group selected
- Ungroup selected
- All tool actions should use labeled icons from the selected icon library.

### Bottom-most: Selected Object Properties

- Property panel edit scope:
  - Numeric transform fields (`X`, `Y`, `W`, `H`, `Rotation`) are editable only for single selection.
  - For multi-selection, these numeric fields are not editable.
- X
- Y
- W
- H
  - For textboxes in auto-height mode, `H` is content-driven (read-only in property panel).
- Rotation
- Lock/Unlock
- Layer order:
  - Top
  - Up
  - Down
  - Bottom
  - Layer operations are applied within the current parent scope (root scope or the same parent group).
- For basic shapes (`shape_rect`, `shape_circle`, `shape_arrow`):
  - Border color
  - Border type (`solid`, `dashed`, `dotted`)
  - Border width (`0..20`, world units)
    - Stroke thickness is world-space and scales with canvas/object transforms.
  - Body fill color
  - Body fill gradient
    - MVP supports linear gradient with exactly 2 color stops (`colorA`, `colorB`) and `angleDeg`.
  - Opacity (`0..100` percent)
- Special contextual toolbars:
  - Text toolbar floats above edited text object.
  - Shape toolbar floats above edited shape object.
  - These toolbars show only when relevant object type is selected/edited.

## 3.2 Right Side: Canvas

- Infinite/large 2D workspace with visible grid.
- Grid pans/zooms together with canvas transform.
- Coordinate system uses abstract world units (not screen pixels).
- Adaptive grid density:
  - At normal zoom, visible spacing is 100x100 px.
  - When zooming in so a 100x100 cell fills that view scale, grid subdivides into 10x10 smaller cells.
  - The same subdivision pattern continues with further zoom in/out.
- Canvas navigation:
  - Drag mouse to pan view
  - Mouse wheel to zoom
  - `Alt + Wheel` to rotate view
- Snapping (MVP):
  - Grid snapping for move/resize operations.
  - Object-edge snapping for move/resize operations.
  - For rotated objects, edge snapping uses axis-aligned bounding-box edges in MVP.
  - Snapping is enabled by default.
  - Holding `Alt` while dragging/resizing temporarily disables snapping.
  - Default `snapTolerancePx` is `8`.
  - Snap behavior is controlled by canvas settings flags.

## 4. Canvas Object Interaction

## 4.1 Selection + Editability

- Objects can be selected by click.
- `Shift + drag` on empty canvas creates a selection rectangle (marquee) for multi-select.
  - Drag direction rule (horizontal):
    - Dragging to the right selects only fully contained objects.
    - Dragging to the left selects intersecting objects.
- Locked objects are selectable but not directly transformable.
- Unlocked objects are editable.
- Groups support isolated edit mode: when entered, objects outside that group are unavailable until exit.

## 4.2 Transform Controls (when selected)

- 9 square resize handles around object bounds.
- Edge handles adjust width/height.
- Corner handles scale proportionally.
- One circular rotate handle above top edge.
- Center 4-way arrow handle for drag-move.
- Lock icon below center toggles lock state.
- Object transform conventions:
  - `x`,`y` represent object center in world coordinates.
  - Rotation pivot is always object center.
  - Resizing keeps the opposite handle/edge anchored (fixed) as the dragged handle moves.

## 4.3 Image Placement

- Drag-and-drop image files directly onto canvas.
- Dropped image creates new image object at drop location.
- Supported types: `png`, `jpeg`/`jpg`, `gif`, `svg`.
- Image behaves like a standard PowerPoint picture in MVP:
  - Insert at natural image ratio/size (in world units derived from source dimensions).
  - Keep aspect ratio by default.
  - Corner resize preserves aspect ratio.
  - Edge resize allows single-axis resize.
  - No automatic crop in MVP.

## 4.4 Copy/Paste Objects

- Copy selected objects with:
  - `Ctrl+C` / `Cmd+C`
  - Context menu `Copy`
- Paste objects with:
  - `Ctrl+V` / `Cmd+V`
  - Context menu `Paste`
- Pasted objects are deep copies with new object `id`s and preserved visual properties.
- Multi-selection paste keeps relative positions between objects.
- First paste is offset from original by `+20,+20` world units so the copy is visible.
- Repeated paste offsets again from the last pasted result.
- When user copies a different source selection, paste offset sequence resets to `+20,+20` for that new source.
- Locked objects can be copied; pasted copies keep the same lock state.
- Groups can be copied/pasted as full hierarchies with remapped child ids.
- If clipboard content is invalid/unsupported, paste action is ignored safely.

## 4.5 Group Isolated Edit Mode

- User can enter a selected group by:
  - Double-clicking the group
  - Pressing `Enter` when the group is selected
  - Clicking enter-group icon next to lock icon
- While inside a group, only objects in that group are selectable/editable.
- Objects outside the active group are unavailable for interaction.
- Exit group mode using `Esc` or explicit `Exit group` action/icon.
- Nested groups are supported.
- Group coordinate model:
  - Child object transforms are stored in local coordinates relative to their parent group.
  - Root-level objects use world coordinates.

## 4.6 Object Context Menu

- Right-clicking selected object(s) opens context menu.
- Context menu actions:
  - Duplicate
  - Remove
  - Group
  - Ungroup
  - Layer: Top, Up, Down, Bottom
- Actions are enabled/disabled based on current selection:
  - Group enabled for multi-selection of ungrouped objects.
  - Ungroup enabled when a group is selected.
- Keyboard delete behavior:
  - Pressing `Delete` removes selected unlocked objects immediately.
  - Locked objects are protected and are not deleted by `Delete`.
  - `Backspace` does not delete objects (reserved for text editing behavior).

## 4.7 Contextual Floating Toolbars

- Toolbar position is anchored above the currently edited object on canvas.
- Toolbar follows object position while panning/zooming/rotating view.
- Text toolbar includes quick text formatting controls.
- Shape toolbar includes quick border/fill/opacity controls.
- Object-specific toolbar hides when selection is cleared or object type changes.

## 5. Slide Model

A slide is a named camera bookmark:

- `id`
- `name`
- `x`
- `y`
- `zoom`
- `rotation`
- `triggerMode` (`manual` | `timed`)
- `triggerDelayMs` (used when `triggerMode = timed`, range `0..3600000`)
- `transitionType` (`ease` | `linear` | `instant`)
- `transitionDurationMs` (range `1000..10000` for `ease/linear`, ignored for `instant`)
  - For `transitionType = ease`, easing curve is fixed to `easeInOutCubic` in MVP.
- `orderIndex`

Slides represent viewpoints; objects remain globally on canvas.

## 6. Data Model (Draft)

## 6.1 Document

- `meta`: version, title, createdAt, updatedAt
- `canvas`: global settings:
  - `gridVisible`
  - `baseGridSize`
  - `snapToGrid`
  - `snapToObjectEdges`
  - `snapTolerancePx` (default `8`)
- `slides`: ordered array of slide bookmarks
- `objects`: array of drawable/editable items
- `assets`: embedded image resources (for XML export)

## 6.2 Object Types

- `textbox`
- `image`
- `shape_rect`
- `shape_circle`
- `shape_arrow`
- `group`

Shared object fields:

- `id`
- `type`
- `x`, `y`, `w`, `h` (`x`,`y` are object center; in world coordinates at root level, in parent-local coordinates when inside a group)
- `rotation`
- `locked`
- `zIndex` (stacking order within the same `parentGroupId` scope)
- `parentGroupId` (nullable; `null` means root-level object)

Type-specific fields:

- `textbox`: rich text runs, font, size, color, alignment, bullets/numbered-list markers, autoHeight (default `true`)
- `image`: asset reference, intrinsicWidth, intrinsicHeight, keepAspectRatio
- `shape_*`: borderColor, borderType, borderWidth (`0..20`, world-space), fillMode (`solid` | `linearGradient`), fillColor, fillGradient (`colorA`, `colorB`, `angleDeg`), opacityPercent (`0..100`)
- `group`: ordered children object ids (children may include nested `group` objects)

## 7. Persistence

## 7.1 Autosave

- Every 20 seconds, serialize current document to browser local storage only if document state changed since last autosave.
- Keep at least:
  - Latest autosave snapshot
  - Timestamp
  - Rolling backups capped at `200` snapshots
- On app startup, automatically load the latest autosave snapshot.
- Startup source priority: latest autosave snapshot is loaded by default.

## 7.2 Manual Save/Load

- Save to XML file.
- XML includes embedded encoded images (e.g., Base64 data).
- Load restores full document, including assets and slide order.
- XML format is strict and versioned from day one:
  - Root element: `<infiniprez version="1.0">`.
  - Top-level child sections are fixed and ordered: `<meta>`, `<canvas>`, `<slides>`, `<objects>`, `<assets>`.
  - `<slides>` contains `<slide>` elements with slide model attributes (`id`, `name`, `x`, `y`, `zoom`, `rotation`, `triggerMode`, `triggerDelayMs`, `transitionType`, `transitionDurationMs`, `orderIndex`).
  - `<objects>` contains `<object>` elements with shared attributes (`id`, `type`, `x`, `y`, `w`, `h`, `rotation`, `locked`, `zIndex`, `parentGroupId`) and exactly one type-specific child:
    - `<textboxData>`
    - `<imageData>`
    - `<shapeData>`
    - `<groupData>`
  - `<assets>` contains `<asset>` elements with asset metadata and Base64 payload.
  - Element/attribute names are treated as stable for MVP.
- Backward compatibility is out of scope for this stage:
  - Loader only needs to support current schema version `1.0`.
  - No migration pipeline for older schema versions in MVP.

## 7.3 Standalone Presentation Export

- Export generates one standalone HTML file.
- Exported file embeds all required assets (images, styles, scripts) internally using Base64 encoding.
- Exported file has no external dependencies and no network requirement.
- Exported HTML can be opened locally (for example via `file://`) and used for presentation only.
- Exported HTML includes presentation runtime only (no edit mode UI/tools).
- Exported presentation starts from the first slide.

## 8. Undo/Redo

- Command-stack based history.
- Every user command must support both undo and redo.
- Command history includes:
  - Object create/delete/edit/transform
  - Object duplicate/remove commands
  - Object copy/paste
  - Group/ungroup operations
  - Enter/exit group isolated edit mode
  - Slide create/update/delete/reorder/rename
  - Property panel edits
  - Selection commands (single select, multi-select, marquee select)
- Camera navigation commands (pan, zoom, rotate) are not part of undo/redo history for MVP.
- Presentation navigation commands (start, next, previous) are not part of undo/redo history for MVP.

## 9. Presentation Flow (Draft)

- User enters Present mode using:
  - `Present from beginning`
  - `Present from current`
- Slide progression is either:
  - Manual advance
  - Timed advance based on slide trigger delay (timer starts on slide entry and auto-advances)
  - Manual `Next`/`Previous` during timed playback is allowed and resets timer for the newly entered slide.
  - When timed progression reaches the last slide, playback remains on the last slide (no loop).
- Camera transition behavior is defined per slide:
  - `ease`
  - `linear`
  - `instant`
  - `ease` uses fixed `easeInOutCubic` timing in MVP.
- Present mode keyboard map (MVP):
  - Next: `Right`, `Down`, `Space`, `PageDown`
  - Previous: `Left`, `Up`, `PageUp`
  - Exit present mode: `Esc`

## 10. Suggested MVP Scope

1. Canvas navigation (pan/zoom/rotate) + grid.
2. Object creation (textbox/image/basic shapes), transforms, snapping, and lock behavior.
3. Multi-select and grouping (`group` / `ungroup`).
4. Copy/paste for single and multi-selected objects, including groups.
5. Rich text editing in textbox (including bullets and numbered lists).
6. Slide bookmark CRUD + manual ordering.
7. Per-slide trigger and transition settings.
8. Present mode with start-from-beginning/start-from-current.
9. Layer ordering controls (`top`, `up`, `down`, `bottom`).
10. Local autosave + XML import/export.
11. Standalone presentation HTML export (single-file, offline).
12. Undo/redo for core actions.

## 11. Text Formatting MVP Scope

- Textbox formatting for MVP includes:
  - bold
  - italic
  - underline
  - font size
  - text color
  - alignment (`left`, `center`, `right`)
  - bullets
  - numbered lists
  - auto-height text layout enabled by default (textbox height grows with content)
- Out of MVP scope:
  - links
  - tables
  - multi-level nested lists
  - textbox internal scrolling

## 12. Image MVP Scope

- Crop tooling is out of MVP scope.
- Fit mode switching (`contain`/`cover`/`stretch`) is out of MVP scope.

## 13. Arrow MVP Scope

- `shape_arrow` in MVP is straight and single-headed only.
- Out of MVP scope:
  - double-headed arrows
  - curved arrows
  - advanced arrowhead presets
