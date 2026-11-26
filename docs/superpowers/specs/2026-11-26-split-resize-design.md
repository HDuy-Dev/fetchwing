# Drag to resize Request vs Response/Mock

Approved 2026-11-26.

## Intent
When the request part (URL, Params, Headers, Body) is long, the user wants to drag to give Response/Mock more room (or less).

## Today
`.req` is as tall as its content, capped at `max-height: 55%`, then scrolls. `.resp` takes the rest (`min-height: 120px`). Nothing is draggable.

## Design
- A horizontal drag handle between `#editor` and `#bottom`. Dragging sets the request part's height, and may exceed 55%.
- Limits: the URL bar stays visible; Response/Mock keeps at least 120px. A saved height is re-clamped when the panel shrinks.
- One height shared by all requests, persisted with the existing `store` (localStorage) helper in `panel.js`.
- Double-click resets to the automatic height. Until the user drags, layout is unchanged.
- Keyboard: the handle is a focusable `role="separator"`; Up/Down resize it.
- Hidden in the side-by-side layout (`max-height: 440px` and `min-width: 900px`), where the saved height must not apply.

## Non-goals
Resizing in the side-by-side layout, resizing the sidebar, per-request heights.

## Approaches
1. Custom drag handle (chosen): full-width target, works above the 55% cap, keyboard accessible, a bit of JS.
2. CSS `resize: vertical` on `.req`: no JS, but only a small corner grip that is hard to see and grab, and fights `max-height`.

## Left to the builder
Handle styling, keyboard step size, file placement of the logic.
