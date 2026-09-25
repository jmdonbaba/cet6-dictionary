# Restrained Interaction Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add restrained spring-like entrance and press feedback while unifying shadows with the existing visual language.

**Architecture:** Keep the feature CSS-only inside `index.html`. Add one focused structural test file that locks the animation boundaries, hover scoping, unified shadow tokens, and reduced-motion fallback without changing application data flow.

**Tech Stack:** Vanilla HTML/CSS, Node.js built-in test runner

## Global Constraints

- Do not change layout, content hierarchy, export behavior, or color palette.
- Keep entrance effects between 160ms and 280ms with movement limited to 6px or less.
- Do not add looping animation, particles, flowing gradients, or persistent motion.
- Disable new animation and scaling under `prefers-reduced-motion: reduce`.
- Scope card hover effects to `@media (hover: hover)`.

---

### Task 1: Add Unified Shadows and Restrained Motion

**Files:**
- Create: `tests/interaction-polish.test.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: Existing `--shadow`, `.card`, `.modal-card.active`, `.study-export-menu`, `.word-result`, `.toast`, and button classes.
- Produces: `--shadow-hover`, `surface-spring-in`, `content-reveal`, consistent hover/press feedback, and a reduced-motion fallback.

- [ ] **Step 1: Write the failing structural tests**

Create `tests/interaction-polish.test.js` with assertions that require:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('index.html', 'utf8');

test('uses the shared shadow language for cards and the export button', () => {
  assert.match(source, /--shadow-hover:\s*0 6px 20px rgba\(15, 23, 42, 0\.08\),\s*0 2px 6px rgba\(15, 23, 42, 0\.05\);/);
  assert.match(source, /@media \(hover: hover\) \{[\s\S]*?\.card:hover\s*\{[^}]*box-shadow:\s*var\(--shadow-hover\);[^}]*\}/);
  assert.match(source, /\.btn-study-export:hover\s*\{[^}]*box-shadow:\s*var\(--shadow\);[^}]*\}/);
});

test('adds restrained spring entrances and button press feedback', () => {
  assert.match(source, /@keyframes surface-spring-in[\s\S]*?translateY\(6px\) scale\(\.98\)[\s\S]*?translateY\(-1px\) scale\(1\.006\)/);
  assert.match(source, /\.modal-card\.active\s*\{[^}]*animation:\s*surface-spring-in 260ms/);
  assert.match(source, /\.study-export-menu:not\(\[hidden\]\)\s*\{[^}]*animation:\s*surface-spring-in 180ms/);
  assert.match(source, /\.word-result\s*>\s*\*\s*\{[^}]*animation:\s*content-reveal 220ms/);
  assert.match(source, /button:not\(:disabled\):active\s*\{[^}]*transform:\s*scale\(\.98\)/);
});

test('animates toast movement and honors reduced motion', () => {
  assert.match(source, /\.toast\s*\{[^}]*transform:\s*translateY\(8px\)/s);
  assert.match(source, /\.toast\.show\s*\{[^}]*transform:\s*translateY\(0\)/s);
  assert.match(source, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation:\s*none\s*!important;[\s\S]*?transform:\s*none\s*!important;/);
});
```

- [ ] **Step 2: Verify RED**

Run `node --test tests/interaction-polish.test.js`.

Expected: all three tests fail because the shared hover token, spring entrances, and reduced-motion block do not exist.

- [ ] **Step 3: Implement the CSS**

In `index.html`:

- Add `--shadow-hover: 0 6px 20px rgba(15, 23, 42, 0.08), 0 2px 6px rgba(15, 23, 42, 0.05);` to `:root`.
- Replace the export button's custom hover shadow with `var(--shadow)`.
- Add `.card:hover { box-shadow: var(--shadow-hover); }` inside a hover-capable media query.
- Add `surface-spring-in` and `content-reveal` keyframes with no more than 6px movement and a single subtle overshoot.
- Apply the animations to active modal cards, visible export menus, and newly inserted result children.
- Add immediate `transform: scale(.98)` press feedback to enabled buttons.
- Add an 8px-to-0 toast translation alongside its opacity transition.
- Add a reduced-motion media query that removes the new animations and transforms.

- [ ] **Step 4: Verify GREEN and regressions**

Run:

```powershell
node --test tests/interaction-polish.test.js
node --test
git diff --check
```

Expected: all focused and full-suite tests pass with no whitespace errors.

- [ ] **Step 5: Commit**

```powershell
git add index.html tests/interaction-polish.test.js
git commit -m "style: add restrained interface motion"
```
