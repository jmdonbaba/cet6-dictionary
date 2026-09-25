# Page Navigation Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unobtrusive main-page buttons that jump smoothly to the top or bottom while staying responsive, accessible, and out of the way of modals.

**Architecture:** Keep this small feature inside `index.html`, following the project’s current single-file UI pattern. A fixed button group is controlled by one throttled state updater based on document scroll geometry, modal visibility, viewport resize, and content mutation.

**Tech Stack:** Vanilla HTML/CSS/JavaScript and Node.js built-in test runner.

## Global Constraints

- Two circular buttons appear vertically at the main page’s lower-right edge: up above down.
- Hide the group when the document is not scrollable or the modal overlay is open.
- Disable the up button at the top and the down button at the bottom.
- Use smooth scrolling unless `prefers-reduced-motion: reduce` is active.
- Each button has a minimum 44×44px touch target, visible keyboard focus, Chinese `aria-label`, and `title`.
- Respect mobile safe-area insets and do not introduce horizontal overflow.
- Do not change favorites, export, search, or JSON backup behavior.

---

## File Structure

- Modify `index.html`: navigation markup, responsive styles, and scroll-state behavior.
- Create `tests/page-navigation.test.js`: static contracts for accessibility, responsive positioning, reduced motion, and edge behavior.

---

### Task 1: Add Accessible Responsive Navigation Controls

**Files:**
- Modify: `index.html:37-41`
- Modify: `index.html:569-574`
- Create: `tests/page-navigation.test.js`

**Interfaces:**
- Consumes: existing CSS variables and document body.
- Produces: `#pageJumpControls`, `#btnJumpTop`, and `#btnJumpBottom` DOM elements.

- [ ] **Step 1: Write failing markup and style tests**

Create `tests/page-navigation.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('index.html', 'utf8');

test('renders accessible top and bottom controls', () => {
  assert.match(source, /id="pageJumpControls"/);
  assert.match(source, /id="btnJumpTop"[^>]*aria-label="回到页面顶部"[^>]*title="回到顶部"/);
  assert.match(source, /id="btnJumpBottom"[^>]*aria-label="前往页面底部"[^>]*title="前往底部"/);
});

test('controls are touch-safe and honor mobile safe areas', () => {
  assert.match(source, /\.page-jump-btn\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
  assert.match(source, /env\(safe-area-inset-right/);
  assert.match(source, /env\(safe-area-inset-bottom/);
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `node --test tests/page-navigation.test.js`

Expected: FAIL because the controls are absent.

- [ ] **Step 3: Add markup and CSS**

Insert immediately after `.container` and before `.toast`:

```html
<nav class="page-jump-controls" id="pageJumpControls" aria-label="页面快捷导航" hidden>
  <button class="page-jump-btn" id="btnJumpTop" type="button" aria-label="回到页面顶部" title="回到顶部">
    <span aria-hidden="true">↑</span>
  </button>
  <button class="page-jump-btn page-jump-btn-primary" id="btnJumpBottom" type="button" aria-label="前往页面底部" title="前往底部">
    <span aria-hidden="true">↓</span>
  </button>
</nav>
```

Add fixed positioning with:

```css
.page-jump-controls {
  position: fixed;
  right: max(16px, env(safe-area-inset-right));
  bottom: max(18px, calc(env(safe-area-inset-bottom) + 12px));
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.page-jump-controls[hidden] { display: none; }
.page-jump-btn {
  width: 44px;
  height: 44px;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: #fff;
  color: var(--primary);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.14);
  cursor: pointer;
  font-size: 20px;
}
.page-jump-btn-primary { background: var(--primary); color: #fff; border-color: var(--primary); }
.page-jump-btn:disabled { opacity: 0.35; cursor: default; box-shadow: none; }
@media (max-width: 500px) {
  .page-jump-controls { right: max(10px, env(safe-area-inset-right)); }
}
```

- [ ] **Step 4: Run markup/style tests**

Run: `node --test tests/page-navigation.test.js`

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add index.html tests/page-navigation.test.js
git commit -m "feat: add page jump controls"
```

---

### Task 2: Implement Boundary, Modal, and Reduced-Motion Behavior

**Files:**
- Modify: `index.html:620-670`
- Modify: `index.html:1170-1225`
- Modify: `tests/page-navigation.test.js`

**Interfaces:**
- Consumes: `#modalOverlay`, document scrolling element, `matchMedia`, scroll/resize events, and DOM mutations under `#wordSearchModules`.
- Produces: `updatePageJumpControls() -> void` and `jumpToPageEdge(edge) -> void`.

- [ ] **Step 1: Write failing behavior tests**

Append to `tests/page-navigation.test.js`:

```js
test('updates visibility and disabled state from scroll geometry and modal state', () => {
  assert.match(source, /function updatePageJumpControls\(\)/);
  assert.match(source, /scrollHeight\s*>\s*clientHeight\s*\+\s*1/);
  assert.match(source, /\$modalOverlay\.style\.display\s*!==\s*'none'/);
  assert.match(source, /\$btnJumpTop\.disabled\s*=\s*scrollTop\s*<=\s*1/);
  assert.match(source, /\$btnJumpBottom\.disabled\s*=\s*scrollTop\s*\+\s*clientHeight\s*>=\s*scrollHeight\s*-\s*1/);
});

test('uses reduced-motion-aware top and bottom scrolling', () => {
  assert.match(source, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
  assert.match(source, /window\.scrollTo\(\{\s*top:\s*edge === 'top' \? 0 : document\.documentElement\.scrollHeight/);
  assert.match(source, /behavior:\s*reducedMotion \? 'auto' : 'smooth'/);
});

test('refreshes controls after scrolling, resizing, modal changes, and content changes', () => {
  assert.match(source, /addEventListener\('scroll', schedulePageJumpUpdate/);
  assert.match(source, /addEventListener\('resize', schedulePageJumpUpdate/);
  assert.match(source, /new MutationObserver\(schedulePageJumpUpdate\)/);
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `node --test tests/page-navigation.test.js`

Expected: FAIL because behavior functions are absent.

- [ ] **Step 3: Implement state updates and navigation**

Add DOM references near existing cached elements and use this behavior:

```js
let pageJumpFrame = 0;
function updatePageJumpControls() {
  pageJumpFrame = 0;
  const root = document.scrollingElement || document.documentElement;
  const { scrollTop, scrollHeight, clientHeight } = root;
  const scrollable = scrollHeight > clientHeight + 1;
  const modalOpen = $modalOverlay.style.display !== 'none';
  $pageJumpControls.hidden = !scrollable || modalOpen;
  $btnJumpTop.disabled = scrollTop <= 1;
  $btnJumpBottom.disabled = scrollTop + clientHeight >= scrollHeight - 1;
}

function schedulePageJumpUpdate() {
  if (!pageJumpFrame) pageJumpFrame = requestAnimationFrame(updatePageJumpControls);
}

function jumpToPageEdge(edge) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({
    top: edge === 'top' ? 0 : document.documentElement.scrollHeight,
    behavior: reducedMotion ? 'auto' : 'smooth'
  });
}
```

Wire the two clicks; listen for passive scroll and resize events; observe `#wordSearchModules`, `.footer`, and the modal overlay with one `MutationObserver`; call `schedulePageJumpUpdate()` after opening/closing a modal and after creating/removing search modules. Disconnect is unnecessary because the app is a single persistent page.

- [ ] **Step 4: Run the complete test suite**

Run: `node --test tests/*.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add index.html tests/page-navigation.test.js
git commit -m "feat: wire page edge navigation"
```

---

### Task 3: Mobile and Browser Verification

**Files:**
- Modify if defects are found: `index.html`, `tests/page-navigation.test.js`

**Interfaces:**
- Consumes: completed controls in a local browser.
- Produces: verified desktop/mobile behavior without horizontal overflow or modal overlap.

- [ ] **Step 1: Run all tests**

Run: `node --test tests/*.test.js`

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Verify at desktop and mobile widths**

Serve with `python -m http.server 8000`. At 1440px, 390px, and 320px widths, create enough search modules/results to make the page scroll. Confirm the group appears without increasing `document.documentElement.scrollWidth`, remains clear of the viewport edges, and does not cover the footer project link when scrolled to the bottom.

- [ ] **Step 3: Verify all states**

At the top, only the up button is disabled. Mid-page, both are enabled. At the bottom, only the down button is disabled. With short content, the group is hidden. While any modal is open, the group is hidden and returns after close.

- [ ] **Step 4: Verify motion and keyboard behavior**

Enable reduced-motion in browser settings and confirm jumps are immediate. Disable it and confirm smooth movement. Tab to both buttons, verify visible focus, activate with Enter and Space, and confirm screen-reader names match the Chinese labels.

- [ ] **Step 5: Commit verification fixes when needed**

If changes were required:

```powershell
git add index.html tests/page-navigation.test.js
git commit -m "fix: polish page jump controls"
```

If no changes were required, do not create an empty commit.
