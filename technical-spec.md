# Infiniprez Technical Specification (v0.3)

## 1. Scope

This document defines the implementation architecture for Infiniprez based on `design.md`.

In scope:
- Single-user local web app.
- Infinite zoomable canvas with camera rotation.
- Slide bookmarks with per-slide trigger and transition config.
- Object editing (text, image, shapes), multi-select, grouping, lock, layering.
- Copy/paste with keyboard and context menu.
- Autosave to local storage and manual XML import/export with embedded images.
- Standalone presentation export as a single self-contained HTML file.
- Edit mode and Present mode.

Out of scope:
- Real-time collaboration.
- Cloud storage/sync.
- Audio/video embedding.
- Plugin system.

## 2. Technology Decisions

## 2.1 Frontend
- `React 19` + `TypeScript` + `Vite`.
- `Mantine` for application shell, forms, panels, menus, modals.
- Icons: Font Awesome (`@fortawesome/*`) project-wide.

## 2.2 Canvas + Interaction
- `Fabric.js` as primary canvas runtime.
- Custom camera controller on top of Fabric viewport transform to support:
  - pan
  - zoom
  - rotation (including `Alt + Wheel`)

## 2.3 Editor Features
- Rich text: `tiptap` + `@mantine/tiptap` for bullets/numbered lists.
- Drag-and-drop:
  - File/image drop to canvas: native browser drag-and-drop API.
  - Supported image formats: `png`, `jpeg`/`jpg`, `gif`, `svg`.
  - Slide reordering: `@dnd-kit/core` + `@dnd-kit/sortable`.

## 2.4 State + Persistence
- Global state: `Zustand`.
- Undo/redo: command history plugin in store.
- Autosave storage: browser `localStorage`.
- XML import/export:
  - Parse: `fast-xml-parser`.
  - Serialize: `XMLSerializer`.
- Standalone HTML export:
  - Build one HTML document string with inline CSS + inline JS.
  - Embed presentation data and assets in the generated file.

## 3. High-Level Architecture

## 3.1 Module Layout

Proposed folders:

```txt
src/
  app/
    App.tsx
    routes.ts
  ui/
    shell/
    sidebar/
    canvas/
    presenter/
  canvas/
    fabric-stage.ts
    camera-controller.ts
    object-factory.ts
    selection-controller.ts
    grid-renderer.ts
  state/
    store.ts
    slices/
      document-slice.ts
      slides-slice.ts
      objects-slice.ts
      selection-slice.ts
      history-slice.ts
      ui-slice.ts
  domain/
    model.ts
    commands.ts
    validation.ts
  persistence/
    autosave.ts
    html-export/
      exporter.ts
      template.ts
      runtime.ts
    xml/
      serializer.ts
      parser.ts
      schema.ts
    assets.ts
  features/
    slides/
    objects/
    clipboard/
    present/
  utils/
    id.ts
    math.ts
    throttle.ts
```

## 3.2 Runtime Boundaries
- React layer handles layout, forms, toolbars, and mode switching.
- Fabric layer handles rendering and direct manipulation.
- Zustand layer is source of truth for document and UI state.
- Persistence layer converts in-memory document to/from storage and XML.

## 4. Core Data Contracts

```ts
export type TriggerMode = "manual" | "timed";
export type TransitionType = "ease" | "linear" | "instant";
export type StrokeType = "solid" | "dashed" | "dotted";
export type ObjectType =
  | "textbox"
  | "image"
  | "shape_rect"
  | "shape_circle"
  | "shape_arrow"
  | "group";

export interface Slide {
  id: string;
  name: string;
  x: number;
  y: number;
  zoom: number;
  rotation: number;
  triggerMode: TriggerMode;
  triggerDelayMs?: number; // timed mode: 0..3_600_000 ms
  transitionType: TransitionType;
  transitionDurationMs?: number; // ease/linear: 1_000..10_000 ms
  orderIndex: number;
}

export interface BaseObject {
  id: string;
  type: ObjectType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  locked: boolean;
  zIndex: number;
}

export interface TextboxObject extends BaseObject {
  type: "textbox";
  richTextJson: string;
}

export interface ImageObject extends BaseObject {
  type: "image";
  assetId: string;
  fitMode: "contain" | "cover" | "stretch";
}

export interface ShapeObject extends BaseObject {
  type: "shape_rect" | "shape_circle" | "shape_arrow";
  borderColor: string;
  borderType: StrokeType;
  borderWidth: number;
  fillColor?: string;
  fillGradient?: {
    kind: "linear" | "radial";
    stops: Array<{ offset: number; color: string }>;
    angleDeg?: number;
  };
  opacity: number; // 0..1
}

export interface GroupObject extends BaseObject {
  type: "group";
  childIds: string[];
}

export type CanvasObject =
  | TextboxObject
  | ImageObject
  | ShapeObject
  | GroupObject;

export interface Asset {
  id: string;
  mimeType: string;
  dataBase64: string;
  sha1?: string;
}

export interface DocumentModel {
  meta: {
    version: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  };
  canvas: {
    gridVisible: boolean;
    snapEnabled: boolean;
  };
  slides: Slide[];
  objects: CanvasObject[];
  assets: Asset[];
}
```

## 5. Canvas and Camera

## 5.1 Coordinate System
- World coordinates are abstract units.
- Viewport transform maps world units to screen pixels.

## 5.2 Camera State
- `camera = { x, y, zoom, rotation }`
- Interaction:
  - drag to pan
  - wheel to zoom (pointer-centered zoom)
  - `Alt + wheel` to rotate
- Camera actions are command-tracked and undoable/redoable.
- Continuous interactions (drag/wheel) are coalesced into one history entry per gesture.

## 5.3 Grid Renderer
- Grid overlays the world space and follows viewport transform.
- Base visible cell is `100x100` pixels at normal zoom.
- At deeper zoom, each major cell subdivides into `10x10` minor cells.
- Subdivision repeats recursively as zoom increases.

## 5.4 Object Handles
- 9 square resize handles.
- Corner handles scale proportionally.
- Edge handles resize on one axis.
- Circular rotate handle above object.
- Center drag handle for moving.
- Lock toggle below center.

## 6. Editor Interaction Model

## 6.1 Selection
- Single click selects one object.
- Shift-click toggles multi-selection.
- `Shift + drag` on empty canvas starts a marquee selection rectangle.
- Marquee selects all unlocked and locked objects intersecting the rectangle bounds.
- Locked objects remain selectable but non-transformable.
- Selection changes are command-tracked and undoable/redoable.

## 6.2 Grouping
- `Group` creates a group object with child IDs.
- `Ungroup` removes group object and restores children as selected.
- Transforming group applies transform to all children.
- User can enter group-isolated edit mode for a selected group.
- Enter methods:
  - double-click selected group
  - `Enter` key on selected group
  - enter-group icon next to lock icon
- In group-isolated mode, hit-testing and editing are restricted to descendants of the active group.
- Objects outside active group are unavailable for selection/edit until exit.
- `Esc` exits current group level (or full group mode if at root level).
- Enter/exit group mode is command-tracked and undoable/redoable.

## 6.3 Layering
- Commands:
  - `top`
  - `up`
  - `down`
  - `bottom`
- Layer commands mutate `zIndex` deterministically and are undoable.

## 6.4 Clipboard
- In-app clipboard schema for canvas object payload.
- Copy serializes selected object graph.
- Paste deep-clones with new IDs and remapped child IDs.
- Paste offset increments by `(+20, +20)` from last paste anchor.
- Clipboard operations are undoable commands.

## 6.5 Object Context Menu
- Right-click on selected object(s) opens context menu bound to selection.
- Supported actions:
  - `duplicate`
  - `remove`
  - `group`
  - `ungroup`
  - `layer_top`
  - `layer_up`
  - `layer_down`
  - `layer_bottom`
- Menu item availability depends on selection state:
  - `group` enabled only for valid multi-selection.
  - `ungroup` enabled only when selected node is group.
- Context-menu actions dispatch existing command handlers and are undoable/redoable.

## 6.6 Contextual Floating Toolbars
- UI overlay renders object-type-specific toolbar above active edited object.
- Toolbar anchor is computed from object world bounds transformed into screen coordinates.
- Toolbar updates position during camera pan/zoom/rotation and object transforms.
- Toolbar variants:
  - text toolbar (rich text quick actions)
  - shape toolbar (border/fill/gradient/opacity quick actions)
- Toolbar visibility rules:
  - shown only for selected editable object type
  - hidden on deselect, mode switch, or when object is not editable
- Toolbar actions dispatch existing property-edit commands and are undoable/redoable.

## 7. Slides and Presentation

## 7.1 Slide CRUD
- Add from current camera.
- Update selected slide from current camera.
- Delete slide.
- Reorder slides with drag-and-drop.

## 7.2 Presentation Entry
- `Present from beginning`: starts at first slide in order.
- `Present from current`: starts at selected slide.
- Presentation entry commands are undoable/redoable.

## 7.3 Slide Progression
- `manual`: wait for user next action.
- `timed`: start timer on slide entry and auto-advance after `triggerDelayMs`.
- Timed delay range: `0..3_600_000` ms (`0..1h`).
- Manual presentation navigation commands (`next`, `previous`) are undoable/redoable.

## 7.4 Camera Transitions
- Per-slide transition type:
  - `ease`
  - `linear`
  - `instant`
- Per-slide duration for `ease`/`linear`: `1_000..10_000` ms (`1..10s`).
- `instant` ignores duration.

## 8. Persistence

## 8.1 Autosave
- Save full document every 20 seconds only when document state has changed.
- Save on significant events:
  - before unload
  - explicit save
  - mode switch Edit/Present
- Keep rolling backup snapshots capped at `200`.
- On startup, automatically restore latest autosave snapshot.

## 8.2 XML File Format
- Root: `<infiniprez version="1">`.
- Child sections:
  - `<meta>`
  - `<canvas>`
  - `<slides>`
  - `<objects>`
  - `<assets>`
- Assets embedded as Base64 by `assetId`.

## 8.3 Versioning
- Include `meta.version`.
- Parser supports forward compatibility by ignoring unknown tags/attrs.

## 8.4 Standalone HTML Export Format
- Export action generates exactly one `.html` file.
- The file must include:
  - embedded presentation document data
  - embedded assets (Base64 encoding)
  - inline CSS/JS runtime required for playback
- The file must not depend on:
  - remote CDN scripts
  - remote fonts/styles
  - local sidecar files (`.js`, `.css`, images)
- Exported runtime is presentation-only:
  - starts in presenter mode from the first slide
  - supports slide progression and transitions
  - does not expose edit tools, editing shortcuts, or persistence UI
- Exported file must run when opened locally via `file://`.

## 9. Undo/Redo Command System

## 9.1 Command Interface

```ts
interface Command {
  id: string;
  label: string;
  do(): void;
  undo(): void;
  redo(): void;
}
```

## 9.2 Command Categories
- Object operations.
- Object context-menu actions.
- Transform operations.
- Group/ungroup.
- Enter/exit group-isolated edit mode.
- Layer change.
- Clipboard paste.
- Slide operations.
- Property edits.
- Selection commands.
- Camera commands.
- Presentation commands.
- Export commands.

## 9.3 Command Policy
- Every user-invoked command must implement `do()`, `undo()`, and `redo()`.
- `redo()` must restore the exact state produced by original `do()`.
- Continuous input commands (drag, wheel) are coalesced into gesture-level history items.

## 10. Non-Functional Requirements

- Target 60 FPS while panning/zooming on medium presentations (~500 objects).
- Initial load < 2 seconds for common deck sizes (<10 MB XML).
- No data loss on normal tab close due to autosave.
- Keyboard shortcuts must work on Windows/Linux/macOS.
- Exported standalone HTML must perform presentation playback offline without network access.

## 11. Testing Strategy

## 11.1 Unit Tests
- Camera math transforms.
- Slide transition resolver.
- Clipboard ID remapping.
- XML serializer/parser round-trip.
- History command do/undo/redo behavior.

## 11.2 Integration Tests
- Object create/select/transform workflow.
- Shape style edit workflow (border/fill/gradient/opacity) with save/load round-trip.
- Group + ungroup + undo/redo.
- Slide reorder + present from current.
- Timed trigger auto-advance.
- Autosave restore on reload.
- Standalone exported HTML opens locally and runs presentation without external requests.

## 11.3 Manual QA Checklist
- Large canvas navigation.
- Rich text bullet/numbered editing.
- Drag-drop image handling.
- Locked object behavior.
- Layer order correctness.

## 12. Risks and Mitigations

- Risk: camera rotation with Fabric viewport can become mathematically error-prone.
- Mitigation: isolate transform math in `camera-controller.ts` with exhaustive tests.

- Risk: rich text rendering mismatch between editor and canvas.
- Mitigation: store canonical rich text JSON and render through one converter path.

- Risk: XML compatibility drift over versions.
- Mitigation: pin schema version and add migration adapter per version.

## 13. Delivery Milestones

1. Core editor shell + Fabric canvas + camera controls.
2. Object model + transforms + selection + layering.
3. Slide system + presentation runtime.
4. Clipboard + grouping + rich text.
5. Persistence + XML + autosave restore.
6. Standalone presentation HTML export.
7. Hardening: tests, performance, QA.
