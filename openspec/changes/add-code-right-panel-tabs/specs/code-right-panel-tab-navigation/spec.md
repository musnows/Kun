## ADDED Requirements

### Requirement: Code tools use one tabbed right workspace
Kun SHALL expose terminal, browser, files, file preview, side conversations, todo, available plans, changes, code canvas, subagents, and right-sidebar extension Views as independently selectable tabs in the Code-mode right workspace. Each built-in tool or fully qualified extension contribution MUST have at most one top-level tab.

#### Scenario: User opens several different tools
- **WHEN** the user opens Files, Subagents, and Side conversations from the tool menu
- **THEN** Kun SHALL retain three ordered tabs and SHALL switch the active content without closing the other tools

#### Scenario: User selects an already open tool
- **WHEN** a Browser tab already exists and the user selects Browser again
- **THEN** Kun SHALL activate the existing Browser tab without adding a duplicate

### Requirement: Existing Code entry points activate the matching tab
All existing Code-mode launch paths SHALL use the shared tab controller. Dev Preview SHALL activate Browser, review SHALL activate Changes, file selection SHALL activate File preview, code-canvas requests SHALL activate Canvas, the terminal shortcut SHALL activate Terminal, and existing subagent and extension actions SHALL activate their matching contribution.

#### Scenario: File is selected from Files
- **WHEN** the user selects a workspace file from the Files tab
- **THEN** Kun SHALL retain the Files tab, open or activate File preview, and select that file in the preview's existing internal tab set

#### Scenario: Terminal shortcut is used
- **WHEN** the configured terminal shortcut is pressed while Terminal is not active
- **THEN** Kun SHALL expand the right workspace and open or activate Terminal

### Requirement: Top-level tabs preserve existing nested state
Visited open tab panels SHALL remain mounted but inactive while another top-level tab is selected. Terminal SHALL retain its internal PTY tabs, File preview SHALL retain its internal file tabs and pinning behavior, Browser SHALL retain its navigation state, and extension Views SHALL retain their active View Session until their top-level tab is closed or invalidated.

#### Scenario: User returns to a visited terminal
- **WHEN** the user switches from a multi-PTY Terminal tab to Browser and then back
- **THEN** the same active PTY tab and terminal session SHALL remain available and the terminal SHALL refit to the visible panel

#### Scenario: User closes an extension tab
- **WHEN** the user closes an open extension tab
- **THEN** Kun SHALL unmount that View, dispose its View Session, and preserve all unrelated open tabs

### Requirement: Files, side conversations, and subagents remain distinct tools
Kun SHALL render Files, Side conversations, and Subagents as separate top-level tools. Files SHALL contain the existing workspace/design file-tree navigation, Side conversations SHALL provide its existing conversation creation, selection, status, and messaging workflow in docked form, and Subagents SHALL retain its existing detail workflow.

#### Scenario: Side conversation is running
- **WHEN** one or more side conversations exist for the active parent thread
- **THEN** the Side conversations menu row and tab SHALL expose the bounded count and running indication without merging those conversations into Subagents

### Requirement: Tabs and tool menu are accessible
The right workspace SHALL provide a horizontally scrollable tablist with roving keyboard focus, Arrow/Home/End navigation, close controls, and associated tabpanels. The `+` launcher SHALL expose a single-level keyboard-accessible menu and SHALL dismiss on Escape or outside interaction.

#### Scenario: Keyboard user navigates the tablist
- **WHEN** keyboard focus is on an active tab and the user presses an arrow key, Home, or End
- **THEN** focus and selection SHALL move to the corresponding enabled tab and the associated panel SHALL be identified through ARIA relationships

#### Scenario: Active tab is closed
- **WHEN** the active tab is closed
- **THEN** Kun SHALL activate the next tab to its right, otherwise the previous tab, and SHALL collapse the workspace if no tabs remain

### Requirement: Right workspace may open without selecting a tool
The Code right workspace SHALL support an expanded state with an empty tab list and no active contribution. In that state Kun SHALL render the tab chrome, an operable `+` launcher, and blank workspace content until the user chooses a tool from the `+` menu or vertical icon rail.

#### Scenario: User expands an empty right workspace
- **WHEN** no Code right-workspace tabs exist and the user activates the unified right-workspace toggle
- **THEN** Kun SHALL expand an empty workspace without automatically opening Files, Browser, or another contribution
- **AND** selecting a launcher SHALL create or activate exactly one matching tab

### Requirement: Tab state is workspace-scoped and backward compatible
Kun SHALL persist a versioned ordered tab list, active tab, expanded state, and existing right-panel width per normalized workspace. A valid legacy single `rightPanelMode` SHALL migrate into a one-tab registry, while unknown, unavailable, or unauthorized contributions MUST be removed fail-closed.

#### Scenario: Legacy panel selection is restored
- **WHEN** no tab registry exists and legacy layout storage contains a valid Browser panel mode
- **THEN** Kun SHALL create an expanded registry containing one active Browser tab

#### Scenario: Workspace changes
- **WHEN** the active conversation changes to a different workspace
- **THEN** Kun SHALL load and validate that workspace's tab registry and SHALL NOT reuse an extension tab that is unavailable or untrusted there

### Requirement: Thread-specific tabs follow active-thread lifecycle
Browser, Plan, and Side conversations SHALL close when their owning active thread changes. File preview SHALL follow its existing pinned and preserve-across-thread rules, while Todo, Changes, Canvas, and Subagents SHALL rebind to the active thread or workspace according to their existing contracts.

#### Scenario: Parent conversation changes while side conversation tab is open
- **WHEN** the user selects a different main conversation
- **THEN** Kun SHALL close the previous Side conversations tab and SHALL NOT show its child conversations under the new parent

### Requirement: Code layout retains the launcher rail without duplicate content columns
Code mode SHALL retain the existing 48-pixel vertical icon rail as a direct launcher while it SHALL NOT render the separate file-tree side column or bottom terminal drawer. Rail and `+` menu selections SHALL use the same singleton tab controller. Opening the empty workspace or a Code tool SHALL use at least the 560-pixel preferred right-workspace width when space permits, SHALL preserve user resizing, and SHALL leave at least the existing 560-pixel minimum for the main conversation after reserving the rail.

#### Scenario: User opens Files on a wide desktop
- **WHEN** Code mode has sufficient width and Files is opened from a collapsed state
- **THEN** Kun SHALL open the tabbed right workspace at no less than the preferred width beside the retained icon rail without rendering an additional file column

### Requirement: Non-Code workspaces remain unchanged
Write, Design, and SDD-specific assistant panels SHALL retain their existing navigation, placement, sizing, and lifecycle.

#### Scenario: User switches to Design mode
- **WHEN** the user leaves Code mode for Design mode
- **THEN** Kun SHALL render the existing Design canvas and assistant/implement panels without the Code tool tab strip
