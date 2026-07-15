## Context

Code mode currently owns a scalar `rightPanelMode`, renders exactly one `WorkbenchRightPanel` contribution, and reserves a fixed 48-pixel `WorkbenchSideRail`. Files use a second fixed side column, side conversations use an overlay, and the terminal uses a bottom drawer. Several panels contain valuable renderer-owned state (browser navigation, xterm tabs, file-preview tabs, and extension View Sessions), so a tab switch cannot be implemented by simply replacing the scalar and unmounting the previous panel.

The extension platform also defines `views.rightSidebar` as Host-owned, workspace-scoped, permission-gated UI. The new navigation must change discovery chrome without weakening View Session isolation, workspace trust, or deterministic contribution ordering.

## Goals / Non-Goals

**Goals:**

- Give all current Code right-side tools one discoverable, accessible tab model.
- Preserve the state of visited open tools while users switch tabs.
- Keep files, file preview, side conversations, subagents, and extensions as distinct surfaces.
- Migrate legacy single-panel layout state without breaking existing widths or file pins.
- Preserve extension permission review, session disposal, and active-workspace ownership.

**Non-Goals:**

- Supporting duplicate top-level instances of the same tool or contribution.
- Replacing the terminal's internal PTY tabs or the file preview's internal file tabs.
- Adding drag reordering, new global keyboard shortcuts, or public extension layout APIs.
- Changing Write, Design, SDD, Kun runtime, preload, IPC, HTTP, or SSE behavior.

## Decisions

### 1. A renderer-owned tab controller replaces scalar selection

The controller stores a versioned ordered list of contribution IDs, an active ID, and expanded state. `rightPanelMode` remains a derived compatibility value for consumers that only need to know the active surface. Mutations become explicit operations: open/activate, close, collapse, restore, and remove unavailable contributions.

Top-level identity is the fully qualified contribution ID, making built-ins and extensions share one deduplication and persistence model. New built-ins represent terminal, files, and side conversations; file preview retains its existing built-in ID.

Alternative considered: keep `rightPanelMode` and add a visual history strip. Rejected because it cannot express close order, inactive lifecycle, or persistent open tools.

### 2. Tabs are persisted per normalized workspace with legacy migration

The Host persists `CodeRightTabsState` under a versioned browser-storage key indexed by the normalized workspace scope. On first read, a valid legacy `kun.layout.rightPanelMode` becomes a one-tab registry. Unknown IDs and unavailable extension contributions fail closed. The existing width key is retained.

Thread-specific tools are removed when their thread context changes: browser, plan, and side conversation. File preview continues to use its existing pinned/preserve rules; general tools rebind to the active thread. Workspace changes select a different stored registry and force extension availability validation.

Alternative considered: store tabs per thread. Rejected because terminal, file, browser, and extension tools are fundamentally workspace-scoped and would be duplicated across conversations in the same workspace.

### 3. The tab host keeps visited panels alive

The active workspace renders every visited open tab into a keyed panel container. Inactive containers are hidden and inert rather than unmounted. Restored inactive tabs mount lazily on first activation so startup does not create every browser or extension session. Closing a tab or removing a contribution unmounts it, allowing terminal renderer cleanup and extension View Session disposal to run normally.

Terminal receives an active-state notification so xterm refits after becoming visible. Browser and extension Webviews retain their renderer/session state while hidden. Host chrome owns the top-level close and collapse controls; embedded panels suppress duplicate close buttons.

Alternative considered: mount only the active panel. Rejected because browser navigation, terminal tab state, and extension sessions would be recreated on each switch.

### 4. Existing entry points become direct launchers and open operations

The existing vertical rail remains available as a compact direct launcher for its current built-in and extension entries. The `+` menu additionally contains direct rows for terminal, browser, files, side conversations, todo, conditional plan, changes, canvas, subagents, and every extension contribution. Both launchers use the same singleton `openTab` operation. Files open the existing workspace/design tree in docked form; selecting a file opens the separate file-preview tab. Side conversations gain a docked presentation variant instead of overlay positioning. Terminal moves from the bottom drawer into the right-panel stack.

Untrusted extension discovery entries remain visible as locked direct rows. Selecting one calls protected permission review; only a successful contribution refresh opens the tab. There is no nested extension picker.

Alternative considered: make the `+` menu the only launcher. Rejected because the established icon rail is a fast, glanceable navigation surface and removing it breaks the existing Code workflow.

### 5. Code-mode geometry is widened without changing other routes

The 48-pixel vertical rail reservation is retained while the separate file-tree side-column reservation is removed. Opening the right workspace raises its width to at least the existing 560-pixel code preferred width and ordinary Code tabs may grow into all space left after the left sidebar, the rail, and the 560-pixel main minimum. The workspace may be expanded with an empty tab set; it shows the tab chrome and blank content until a launcher is selected. Write, Design, and SDD continue to use their existing panel geometry and overlay rules.

### 6. Accessibility and labels are Host-owned

The tab strip uses `tablist`/`tab`/`tabpanel`, roving focus, Arrow/Home/End navigation, visible close controls, and horizontally scrollable overflow. Menu rows use `menu` semantics and Escape/outside-click dismissal. Built-in titles use locale resources; browser, terminal, file preview, and side conversation may report bounded dynamic titles; extension titles use already-localized manifest metadata.

## Risks / Trade-offs

- [Several hidden Webviews or panels consume memory] → Lazily mount restored tabs, keep only explicitly opened tabs alive, and dispose immediately on close or invalidation.
- [Hidden xterm or Webview content measures zero width] → Notify panels on activation and explicitly refit terminal layout after visibility changes.
- [Files no longer coexist as a fourth column] → Keep Files and File Preview as adjacent top-level destinations with instant switching and preserved file tabs.
- [Extension permission changes leave stale tabs] → Normalize tabs against every contribution snapshot and unmount removed contributions before rendering.
- [Legacy stored state contains removed short IDs] → Reuse existing ID normalization and migrate only validated values.
- [Large existing Workbench component increases regression risk] → Put tab transitions in pure helpers/a focused hook and retain derived `rightPanelMode` for read-only consumers.

## Migration Plan

1. Add new built-in IDs, state parser/reducer, and storage migration while retaining the legacy key reader.
2. Introduce tab host/menu UI and route existing open actions through the controller.
3. Move terminal, files, and side conversations into the host, retain the launcher rail, then remove the old drawer/extra-column layout.
4. Update extension navigation specifications and documentation.
5. Validate focused interactions, full renderer types/tests/build, and retain the old stored key as a one-time fallback for rollback compatibility.

## Open Questions

None. Top-level tools are singletons, existing nested tabs remain authoritative, and Code mode is the only route changed.
