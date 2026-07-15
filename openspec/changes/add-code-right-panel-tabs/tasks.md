## 1. Tab state and layout foundation

- [x] 1.1 Add built-in contribution IDs and a pure versioned Code right-tab state model with open, activate, close, collapse, normalization, and legacy migration behavior
- [x] 1.2 Integrate per-workspace tab persistence and derived active `rightPanelMode` into the workbench layout while retaining the vertical-rail width reservation

## 2. Tab navigation chrome

- [x] 2.1 Build the accessible horizontal tab strip, dynamic labels, close behavior, overflow handling, collapse control, and single-level `+` tool menu
- [x] 2.2 Wire Code-mode rail/top actions and route existing Dev Preview, review, canvas, subagent, file-preview, terminal, and extension launch paths through the tab controller

## 3. Tool integration and lifecycle

- [x] 3.1 Move Terminal into a keep-alive right-workspace tab while preserving internal PTY tabs, shortcut behavior, and visible refitting
- [x] 3.2 Move Files and File preview into distinct tabs while preserving workspace/design trees, file references, preview tabs, pins, and thread-retention rules
- [x] 3.3 Add a docked Side conversations tab with count/running state and keep Subagents as its existing independent detail tab
- [x] 3.4 Keep trusted extension tabs mounted across selection, preserve locked permission review, and dispose tabs on close, revocation, or workspace invalidation

## 4. Compatibility, copy, and specifications

- [x] 4.1 Add English and Simplified Chinese tab/menu labels and update extension/video-editor guidance for direct rail/tool-menu tabs
- [x] 4.2 Preserve Write, Design, and SDD panel behavior, retain the Code launcher rail, and remove obsolete file-column and terminal-drawer state without changing public IPC/runtime contracts

## 5. Verification

- [x] 5.1 Add focused state, accessibility, tool-routing, layout, side-conversation, terminal, file, and extension lifecycle tests
- [x] 5.2 Run focused Vitest, typecheck, full tests, build, strict OpenSpec validation, visual smoke checks, and diff hygiene checks

## 6. Navigation correction

- [x] 6.1 Restore the existing Code vertical icon rail and route its built-in and extension launchers through the singleton tab controller
- [x] 6.2 Support an expanded empty right workspace instead of automatically opening Files or Browser
- [x] 6.3 Make the horizontal tab chrome an Electron no-drag region so the `+` launcher and tab controls receive pointer input
- [x] 6.4 Add correction-focused state, layout, rail, and menu tests; rerun validation and update navigation guidance
