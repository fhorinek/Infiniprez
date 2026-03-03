# Infiniprez Implementation Tasks (React MVP)

## 0. Project Setup
- [x] Initialize app with Vite + React + TypeScript.
- [x] Add state + utility deps: `zustand`, `immer`, `zod`, `dnd-kit`.
- [x] Define folder structure: `model/`, `store/`, `commands/`, `canvas/`, `presentation/`, `persistence/`, `ui/`.
- [x] Add linting and formatting (`eslint`, `prettier`) and baseline scripts.
- [x] Create app shell with left sidebar + right canvas layout.
- [x] Add top-toolbar `New Document` icon action with confirmation dialog.

Done criteria:
- App runs locally with stable TypeScript build.
- Core layout matches design sections.

## 1. Document Model + Validation
- [x] Implement TypeScript model for `Document`, `Slide`, `Object`, and `Asset`.
- [x] Implement object union types: `textbox`, `image`, `shape_rect`, `shape_circle`, `shape_arrow`, `group`.
- [x] Add `zod` schemas for load/import validation.
- [x] Add explicit document/schema version field in `meta.version` (current version only, no backward migration in MVP).

Done criteria:
- Document can be created, serialized, and validated.
- Invalid document input is rejected safely.

## 2. Editor Store + Command History
- [x] Create global editor store (document + UI state + camera state).
- [x] Implement command interface: `execute`, `undo`, `redo`.
- [x] Add history stacks and command batching for drag interactions.
- [x] Route all mutating actions through command bus.

Done criteria:
- Undo/redo works for at least object create/move/delete and slide create/delete.

## 3. Canvas + Camera + Grid
- [x] Implement infinite canvas viewport with world coordinates.
- [x] Add camera pan (drag), zoom (wheel), rotate (`Alt + wheel`).
- [x] Render adaptive grid with hierarchical subdivisions.
- [x] Add coordinate conversion helpers (screen <-> world).
- [x] Implement canvas snap settings (`snapToGrid`, `snapToObjectEdges`, `snapTolerancePx`).
- [x] Set default `snapTolerancePx` to `8`.
- [ ] Enable snapping by default and support temporary snap bypass with `Alt` during move/resize.

Done criteria:
- Navigation is smooth and grid scales correctly with zoom.

## 4. Object Creation + Selection + Transform
- [x] Add tools for textbox, image placeholder, rectangle, circle, arrow.
- [x] Implement `shape_arrow` MVP as straight single-headed only (defer variants).
- [x] Implement single-click select and clear selection on empty click.
- [x] Implement transform controls: move, resize handles, rotate handle.
- [ ] Apply grid and object-edge snapping during move/resize transforms.
- [ ] For rotated objects, apply object-edge snapping against axis-aligned bounding boxes (MVP rule).
- [x] Implement lock/unlock behavior and lock icon control.
- [x] Implement shape fill modes: solid color and 2-stop linear gradient (`colorA`, `colorB`, `angleDeg`).
- [ ] Implement shape opacity as percent (`0..100`) in model and UI controls.

Done criteria:
- Selected unlocked objects can be transformed.
- Locked objects remain selectable but not transformable.

## 5. Multi-Select + Marquee + Layering
- [x] Implement `Shift + drag` marquee selection.
- [x] Apply marquee mode by horizontal drag direction: right = containment, left = intersection.
- [x] Support multi-selection with additive selection logic.
- [x] Restrict numeric property panel edits (`X/Y/W/H/Rotation`) to single selection only.
- [x] Implement layer actions: top/up/down/bottom.
- [x] Add object context menu with enable/disable rules.
- [x] Implement `Delete` key to remove selected unlocked objects immediately.
- [x] Ensure `Backspace` does not delete objects (reserved for text editing).
- [x] Ensure locked objects are protected from keyboard/context delete actions.

Done criteria:
- Multi-select operations apply consistently to all selected objects.

## 6. Group / Ungroup + Isolated Group Edit
- [ ] Implement `group` object creation from selected items.
- [ ] Implement ungroup with child restoration.
- [ ] Add enter-group flows: double-click, `Enter`, toolbar icon.
- [ ] Add exit-group flows: `Esc`, explicit action.
- [ ] Restrict hit testing/editing to active group while isolated.

Done criteria:
- Group hierarchy remains valid after group/ungroup/undo/redo.

## 7. Clipboard + Duplicate + Image Drop
- [ ] Implement copy/paste via shortcuts and context menu.
- [ ] Deep clone selected objects with new ids and preserved styles.
- [ ] Preserve relative positions for multi-object paste.
- [ ] Apply progressive `+20,+20` offset on repeated pastes.
- [ ] Reset paste offset sequence when user copies a different source selection.
- [ ] Support copy/paste of groups with child id remapping.
- [ ] Implement duplicate/remove context actions.
- [ ] Add drag-and-drop image import (`png`, `jpg`, `jpeg`, `gif`, `svg`).

Done criteria:
- Clipboard actions are safe on invalid payloads and never crash.

## 8. Slide Management + Slide Parameters
- [ ] Build ordered slide list with drag-and-drop reorder.
- [ ] Add slide create/update/delete from camera state.
- [ ] Add slide parameter table and two-way binding to selected slide.
- [ ] Validate `triggerDelayMs` in `0..3600000`.
- [ ] Validate `transitionDurationMs` in `1000..10000` when transition is not `instant`.
- [ ] Treat `transitionType = ease` as fixed `easeInOutCubic` (no curve selector in MVP).

Done criteria:
- Slide order and parameters persist correctly after edits and reload.

## 9. Present Mode Runtime
- [ ] Implement present mode entry from beginning and from current slide.
- [ ] Implement camera transition engine: `ease`, `linear`, `instant`.
- [ ] Implement slide progression for manual next/previous and timed auto-advance.
- [ ] Fullscreen support and keyboard navigation.
- [ ] Implement present-mode keys: next (`Right/Down/Space/PageDown`), previous (`Left/Up/PageUp`), exit (`Esc`).

Done criteria:
- Presentation follows slide order and per-slide trigger/transition settings.

## 10. Floating Contextual Toolbars
- [ ] Add text toolbar shown only for selected/edited textboxes.
- [ ] Add shape toolbar shown only for selected shape objects.
- [ ] Anchor toolbars above object in screen space.
- [ ] Keep toolbar position synced during pan/zoom/rotate.

Done criteria:
- Toolbars appear only when relevant and track object position reliably.

## 11. Persistence (Autosave + Manual Save/Load)
- [ ] Implement autosave every 20s only when document changed.
- [ ] Store latest snapshot + timestamp in local storage.
- [ ] Keep rolling backups capped to 200 snapshots.
- [ ] Auto-load latest snapshot on startup.
- [ ] Treat autosave as default startup source priority.
- [ ] Implement `New Document` reset flow (blank document defaults + fresh timestamps/ids + clean undo/redo history).
- [ ] Implement XML save with embedded Base64 assets.
- [ ] Implement XML load restoring full document state.
- [ ] Implement strict XML v1.0 layout with fixed section order (`meta`, `canvas`, `slides`, `objects`, `assets`) and stable element names.

Done criteria:
- Restarting app restores latest autosave state.
- XML round-trip preserves slides, objects, and assets.

## 12. Standalone Presentation HTML Export
- [ ] Build export pipeline that produces single HTML file.
- [ ] Embed assets/styles/scripts as inline Base64 or inline text.
- [ ] Remove editor UI and include presentation runtime only.
- [ ] Ensure export opens from `file://` without network access.
- [ ] Start playback from first slide.

Done criteria:
- Exported file runs offline and presents correctly on a fresh browser profile.

## 13. Text Editing and Formatting
- [ ] Implement in-place textbox editing.
- [ ] Support basic rich text formatting controls.
- [ ] Add bullets and numbered list support in text model.
- [ ] Implement textbox auto-height as default behavior (grow with content, no internal scroll in MVP).

Done criteria:
- Rich text edits persist through save/load and undo/redo.

## 14. QA + Regression Tests
- [ ] Unit tests for geometry transforms and command reducers.
- [ ] Unit tests for slide timing and transition selection.
- [ ] Add integration test for group isolate mode.
- [ ] Add integration test for copy/paste with groups.
- [ ] Add integration test for paste offset reset after copying a different source selection.
- [ ] Add integration test for autosave restore.
- [ ] Add integration test for `New Document` reset behavior.
- [ ] Add integration test for export runtime boot.
- [ ] Add smoke E2E: create content -> create slides -> present -> export.

Done criteria:
- Critical editor flows pass in CI.

## Suggested Delivery Milestones
- [ ] Milestone A: Tasks 0-4 (interactive editor foundation).
- [ ] Milestone B: Tasks 5-8 (editing power + slide authoring).
- [ ] Milestone C: Tasks 9-12 (presentation + persistence + export).
- [ ] Milestone D: Tasks 13-14 (text depth + hardening).
