# Infiniprez Implementation Tasks (v0.1)

## 1. Planning Rules

- Priority order: P0 > P1 > P2.
- Each task includes acceptance criteria.
- Execute phases in order unless a dependency explicitly allows parallel work.

## 2. Phase 0: Project Bootstrap

## T-001 (P0) Initialize project scaffold
- Description: Create React + TypeScript + Vite app with strict TS config.
- Acceptance:
  - `npm run dev` starts app.
  - `npm run build` succeeds.
  - TS strict mode enabled.

## T-002 (P0) Install baseline dependencies
- Description: Add Mantine, Fabric.js, Zustand, dnd-kit, tiptap, XML utilities, and icon library.
- Acceptance:
  - Dependencies locked in `package.json`.
  - App compiles after install.
  - One icon package selected and documented.

## T-003 (P0) Define folder structure
- Description: Create module structure matching `technical-spec.md`.
- Acceptance:
  - `src/` contains app, ui, canvas, state, domain, persistence, features, utils.
  - Basic placeholder files exist for each module.

## 3. Phase 1: App Shell and Core State

## T-010 (P0) Build editor layout shell
- Description: Implement left sidebar and right canvas region layout.
- Acceptance:
  - Sidebar sections present (top controls, slide list, slide params, object tools, object params).
  - Canvas viewport fills right panel.
  - Responsive behavior works on desktop and laptop widths.

## T-011 (P0) Create global store slices
- Description: Implement Zustand slices for document, slides, objects, selection, history, and UI mode.
- Acceptance:
  - Store actions typed.
  - State can be inspected in devtools.
  - Initial document loads with defaults.

## T-012 (P1) Keyboard shortcut framework
- Description: Add command-based hotkey dispatcher.
- Acceptance:
  - Shortcuts work for undo/redo/copy/paste.
  - Conflicts with text editing are handled.

## 4. Phase 2: Canvas Runtime

## T-020 (P0) Integrate Fabric canvas
- Description: Create Fabric stage wrapper with mount/unmount lifecycle.
- Acceptance:
  - Canvas initializes cleanly.
  - Resize observer keeps canvas dimensions synced with panel.

## T-021 (P0) Implement camera controller
- Description: Add pan, zoom, rotate controls with pointer-centered zoom and `Alt + wheel` rotate.
- Acceptance:
  - Drag pans camera.
  - Wheel zooms smoothly.
  - Alt+wheel rotates view.
  - Camera state stored in app state.
  - Gesture-level camera commands are undoable/redoable.

## T-022 (P1) Implement adaptive grid renderer
- Description: Draw major/minor grid levels based on zoom density spec.
- Acceptance:
  - Grid follows pan/zoom/rotate.
  - Base spacing appears as 100x100 px at normal zoom.
  - Subdivision into 10x10 appears at higher zoom.

## 5. Phase 3: Object System

## T-030 (P0) Object factories
- Description: Implement create object actions for textbox, image, rectangle, circle, arrow.
- Acceptance:
  - Object creation buttons add object to canvas and state.
  - Default dimensions and style are applied.

## T-031 (P0) Selection and transform handles
- Description: Wire selection, multi-selection, resize, rotate, drag, and lock behavior.
- Acceptance:
  - Selected objects show handles.
  - `Shift + drag` on empty canvas shows marquee and multi-selects intersecting objects.
  - Locked object is selectable but cannot transform.
  - Transform updates property panel and state.
  - Selection commands are undoable/redoable.

## T-032 (P1) Object properties panel
- Description: Bind x/y/w/h/rotation/lock and layer actions to selected object(s).
- Acceptance:
  - Editing properties updates canvas immediately.
  - Layer commands up/down/top/bottom are functional and undoable.

## T-033 (P1) Group and ungroup
- Description: Implement grouping model and group transforms.
- Acceptance:
  - Multi-select can be grouped.
  - Group can be ungrouped.
  - User can enter group-isolated edit mode for a selected group.
  - While in group mode, objects outside active group cannot be selected or edited.
  - `Esc` exits group mode.
  - Undo/redo supports group/ungroup and enter/exit group mode.

## 6. Phase 4: Clipboard and Asset Input

## T-040 (P0) Copy/paste object graph
- Description: Implement in-app clipboard payload and paste offset logic.
- Acceptance:
  - Ctrl/Cmd+C and Ctrl/Cmd+V work.
  - Deep copy with new IDs.
  - Repeated paste offsets by +20/+20.
  - Groups paste with remapped child IDs.

## T-041 (P1) Context menu copy/paste
- Description: Add right-click context menu integration for clipboard operations.
- Acceptance:
  - Copy/paste available from context menu.
  - Disabled state shown when action unavailable.

## T-042 (P0) Drag-and-drop image import
- Description: Support image file drop onto canvas and asset registration.
- Acceptance:
  - Browser-supported image files can be dropped.
  - New image object appears at drop location.
  - Asset stored in document model.

## 7. Phase 5: Slide System and Present Mode

## T-050 (P0) Slide CRUD from camera
- Description: Add create/update/delete actions for slide bookmarks.
- Acceptance:
  - Create from current camera works.
  - Update selected slide from current camera works.
  - Delete removes slide and updates order index.

## T-051 (P0) Slide reorder with drag-and-drop
- Description: Implement sortable slide list.
- Acceptance:
  - Reordering updates `orderIndex`.
  - Reorder action is undoable.

## T-052 (P0) Slide parameters panel
- Description: Bind name, position, zoom, rotation, trigger, and transition fields.
- Acceptance:
  - Panel edits update selected slide.
  - Per-slide transition duration ignored when transition is instant.

## T-053 (P0) Present mode runtime
- Description: Build fullscreen presentation runtime with start-from-beginning/current entry.
- Acceptance:
  - Both start buttons work.
  - Manual progression works.
  - Timed progression starts timer on slide entry and auto-advances.
  - Per-slide transition type and duration are applied.
  - Presentation commands (`start`, `next`, `previous`) are undoable/redoable.

## 8. Phase 6: Rich Text

## T-060 (P1) Rich text editor integration
- Description: Integrate tiptap editor for text object editing.
- Acceptance:
  - Text supports basic formatting.
  - Bullet list and numbered list supported.
  - Content stored as stable JSON payload.

## T-061 (P1) Canvas text render bridge
- Description: Convert rich text document to canvas rendering format.
- Acceptance:
  - Text style renders consistently after save/load.
  - Editing existing text object restores previous formatting.

## 9. Phase 7: Persistence and XML

## T-070 (P0) Autosave service
- Description: Save full document every 20 seconds and on lifecycle events.
- Acceptance:
  - Autosave timestamp updates.
  - Last autosave restores automatically on startup.

## T-071 (P0) XML serializer
- Description: Serialize full document model including embedded Base64 assets.
- Acceptance:
  - Generated XML includes meta/canvas/slides/objects/assets sections.
  - Exported file can be re-imported losslessly for core properties.

## T-072 (P0) XML parser
- Description: Parse XML into document model with validation and unknown-tag tolerance.
- Acceptance:
  - Valid XML loads into editor.
  - Unknown tags do not break loading.
  - Invalid XML returns safe, actionable error.

## T-073 (P0) Standalone presentation HTML exporter
- Description: Generate one self-contained HTML file for presentation playback only.
- Acceptance:
  - Export generates a single `.html` file.
  - File embeds document data and all used assets.
  - File contains no external dependencies (no CDN/local sidecar files).
  - Opening exported file locally (`file://`) starts presentation runtime and works offline.
  - Exported runtime exposes no edit UI/features.

## 10. Phase 8: History, Quality, and Hardening

## T-080 (P0) Undo/redo command engine
- Description: Implement command stack and wire all user commands.
- Acceptance:
  - Undo/redo works for object, slide, clipboard, layer, grouping, group enter/exit, property, selection, camera, and presentation actions.
  - History reset behavior on file load is defined and implemented.

## T-081 (P1) Unit tests
- Description: Add tests for transform math, clipboard remap, XML round-trip, and command stack.
- Acceptance:
  - Test suite runs in CI.
  - Core modules have baseline coverage.

## T-082 (P1) Integration tests
- Description: Add end-to-end scenarios for core editing and presentation workflows.
- Acceptance:
  - Test scripts cover create->edit->present->save->reload cycle.
  - Group isolation behavior is verified (enter group, external objects unavailable, `Esc` exit).
  - Exported standalone HTML presentation is validated in offline/local-open flow.
  - No critical regressions in main flow.

## T-083 (P2) Performance pass
- Description: Profile rendering and interaction with large object counts.
- Acceptance:
  - Pan/zoom remains smooth on target document size.
  - Hot paths documented and optimized.

## 11. Immediate Next Sprint Proposal

Sprint objective: Deliver a minimal usable editor with camera navigation and basic objects.

Sprint backlog:
1. T-001
2. T-002
3. T-003
4. T-010
5. T-011
6. T-020
7. T-021
8. T-030
9. T-031

Sprint done criteria:
- User can navigate canvas, create and transform objects, and see state reflected in UI.
