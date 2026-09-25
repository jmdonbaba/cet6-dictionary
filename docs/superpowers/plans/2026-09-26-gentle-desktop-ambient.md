# Gentle Desktop Ambient Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move page-edge navigation beside the desktop content column, replace text arrows with polished SVG icons, and add a gentle pointer-following background light.

**Architecture:** Keep the layout and ambient visuals in `index.html`. Extend the existing page navigation tests and add a focused ambient-background test; pointer tracking writes CSS variables at most once per animation frame and is gated by fine-pointer and reduced-motion media queries.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, inline SVG, Node.js built-in test runner

## Global Constraints

- Hide page navigation at viewport widths of 1000px or less.
- Do not cover card content on narrow screens.
- Keep pointer effects non-interactive and behind all application content.
- Do not register pointer tracking for reduced-motion users or non-fine pointers.
- Do not change query, favorite, export, or scroll semantics.

---

### Task 1: Desktop Side Navigation and Gentle Pointer Light

**Files:**
- Modify: `tests/page-navigation.test.js`
- Create: `tests/ambient-background.test.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: `#pageJumpControls`, `#btnJumpTop`, `#btnJumpBottom`, `updatePageJumpControls()`, and the document root style.
- Produces: desktop-only side placement, inline SVG arrows, `--spotlight-x`, `--spotlight-y`, `--spotlight-opacity`, and frame-throttled pointer tracking.

- [ ] **Step 1: Write failing navigation tests**

Update `tests/page-navigation.test.js` to require `top: 50%`, `left: calc(50% + 426px)`, `transform: translateY(-50%)`, a `max-width: 1000px` hide rule, and SVG arrow paths with rounded strokes.

- [ ] **Step 2: Write failing ambient-background tests**

Create `tests/ambient-background.test.js` to assert:

```js
assert.match(source, /body\s*\{[^}]*radial-gradient/s);
assert.match(source, /body::before\s*\{[^}]*radial-gradient\([^)]*var\(--spotlight-x\)[^)]*var\(--spotlight-y\)/s);
assert.match(source, /matchMedia\('\(hover: hover\) and \(pointer: fine\)'\)/);
assert.match(source, /requestAnimationFrame\(paintPointerSpotlight\)/);
assert.match(source, /--spotlight-opacity',\s*'0'/);
assert.match(source, /prefers-reduced-motion: reduce/);
```

- [ ] **Step 3: Verify RED**

Run `node --test tests/page-navigation.test.js tests/ambient-background.test.js`.

Expected: failures for the old bottom-right positioning, text arrows, and missing ambient light.

- [ ] **Step 4: Implement desktop navigation**

In `index.html`, position `.page-jump-controls` at the desktop content column's right edge and vertical center. Add a `max-width: 1000px` rule with `display: none !important`. Replace the arrow text spans with 24×24 inline SVG paths using `fill="none"`, `stroke="currentColor"`, `stroke-linecap="round"`, and `stroke-linejoin="round"`.

- [ ] **Step 5: Implement the ambient background**

Add static low-opacity lavender and warm-white radial gradients to `body`. Add a fixed `body::before` spotlight layer using the three CSS variables, with `pointer-events: none`, and keep `.container` above it. Register pointer listeners only when `(hover: hover) and (pointer: fine)` matches and reduced motion is off; batch CSS variable writes through `requestAnimationFrame` and set opacity to zero on pointer leave.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
node --test tests/page-navigation.test.js tests/ambient-background.test.js
node --test
git diff --check
```

Expected: all tests pass with no whitespace errors.

Commit with:

```powershell
git add index.html tests/page-navigation.test.js tests/ambient-background.test.js
git commit -m "style: add gentle desktop ambient effects"
```
