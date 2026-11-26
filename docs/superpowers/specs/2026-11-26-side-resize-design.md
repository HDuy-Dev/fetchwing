# Drag to resize the sidebar

Approved 2026-11-26. Follows `2026-11-26-split-resize-design.md`.

**Intent:** the sidebar is a fixed 248px, so long names get cut off; the user wants to drag its width.

**Design**
- A vertical handle on the sidebar's right edge; it takes no layout space.
- Width 200px to 480px, always leaving at least 360px for the work area. A saved width is clamped when the panel narrows and comes back when it widens.
- Persisted through `store` as `fw.sideWidth`. Double-click resets to 248px. Left/Right resize after focusing or clicking the handle.
- Under 760px the sidebar is a drawer: no handle, drawer stays 248px.

**Non-goals:** dragging to collapse the sidebar.

**Approaches:** (1) same custom handle as the request split, sharing its drag/keyboard code (chosen); (2) CSS `resize: horizontal`: no JS, but only a corner grip, no persistence or keyboard.
