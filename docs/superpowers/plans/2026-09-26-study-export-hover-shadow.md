# Study Export Hover Shadow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a subtle mouse-hover shadow to the favorites study-export button without changing its position, color, size, or touch behavior.

**Architecture:** Extend the existing inline CSS in `index.html` beside `.btn-study-export`. Reuse the project's established `@media (hover: hover)` pattern so touch devices do not receive a sticky hover state, and protect the behavior with a structural Node test.

**Tech Stack:** Vanilla HTML/CSS, Node.js built-in test runner

## Global Constraints

- Only apply the effect on devices matching `@media (hover: hover)`.
- Use a subtle shadow without transform, movement, color, or sizing changes.
- Do not change the export menu behavior or the HTML/Markdown export formats.

---

### Task 1: Add the Export Button Hover Shadow

**Files:**
- Modify: `tests/study-export-ui.test.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: Existing `.btn-study-export` button class and the project's `@media (hover: hover)` CSS convention.
- Produces: A `.btn-study-export:hover` rule scoped to hover-capable devices.

- [ ] **Step 1: Write the failing test**

Add this test to `tests/study-export-ui.test.js`:

```js
test('adds a subtle export-button shadow only on hover-capable devices', () => {
  assert.match(source, /@media \(hover: hover\) \{[\s\S]*?\.btn-study-export:hover\s*\{[^}]*box-shadow:\s*0 3px 10px rgba\(15, 23, 42, \.14\);[^}]*\}/);
  const hoverRule = source.match(/\.btn-study-export:hover\s*\{([^}]*)\}/);
  assert.ok(hoverRule);
  assert.doesNotMatch(hoverRule[1], /transform|background|color|padding|width|height/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test tests/study-export-ui.test.js
```

Expected: FAIL because `.btn-study-export:hover` does not yet define the shadow.

- [ ] **Step 3: Add the minimal hover rule**

Place this beside the existing `.btn-study-export` styles in `index.html`:

```css
@media (hover: hover) {
  .btn-study-export:hover { box-shadow: 0 3px 10px rgba(15, 23, 42, .14); }
}
```

- [ ] **Step 4: Run focused and full tests**

Run:

```powershell
node --test tests/study-export-ui.test.js
node --test
```

Expected: The focused test and all project tests pass with zero failures.

- [ ] **Step 5: Commit**

```powershell
git add index.html tests/study-export-ui.test.js
git commit -m "style: add export button hover shadow"
```
