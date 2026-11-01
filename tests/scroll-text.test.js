const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const watcher = fs.readFileSync('appearance.js', 'utf8').match(/  function watchScrollText\(\) \{[\s\S]*?\n  \}/)[0];

function setup() {
  let now = 1000, serial = 0;
  const classes = new Set(), timers = new Map(), events = {};
  const listen = (name, callback) => { events[name] = callback; };
  const clearTimeout = id => timers.delete(id);
  const context = {
    currentStyle: 'glass', GLASS: 'glass',
    performance: { now: () => now }, clearTimeout,
    root: { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } },
    document: { hidden: false, addEventListener: listen },
    window: {
      scrollY: 0, innerHeight: 900, addEventListener: listen,
      setTimeout(callback, delay) { timers.set(++serial, { callback, at: now + delay }); return serial; },
      scrollTo() { throw new Error('text visibility must never drive scrolling'); }
    }
  };
  vm.runInNewContext(watcher + '\nwatchScrollText();', context);
  return {
    context,
    hidden: () => classes.has('glass-fast-scroll'),
    scroll(pixels, elapsed = 16) { now += elapsed; context.window.scrollY += pixels; events.scroll(); },
    wait(elapsed) {
      now += elapsed;
      for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    },
    event: name => events[name]()
  };
}

test('normal reading scrolls keep text visible; fast scrolling hides it', () => {
  const page = setup();
  for (let i = 0; i < 10; i++) page.scroll(30, 50);
  assert.equal(page.hidden(), false);
  page.scroll(100);
  assert.equal(page.hidden(), true);
});

test('text remains hidden through small speed fluctuations and returns after sustained deceleration', () => {
  const page = setup();
  page.scroll(100);
  for (let i = 0; i < 10; i++) page.scroll(25, 20);
  assert.equal(page.hidden(), true, 'do not flicker near the speed boundary');
  for (let i = 0; i < 7; i++) page.scroll(10, 20);
  assert.equal(page.hidden(), false, 'restore before the page has to stop completely');
});

test('text recovers when scrolling stops without a final event', () => {
  const page = setup();
  page.scroll(100);
  page.wait(130);
  assert.equal(page.hidden(), false);
});

test('switching to classic clears the temporary state and keeps fast scrolls readable', () => {
  const page = setup();
  page.scroll(100);
  page.context.currentStyle = 'classic';
  page.event('appearancechange');
  assert.equal(page.hidden(), false);
  page.scroll(300);
  assert.equal(page.hidden(), false);
  page.context.currentStyle = 'glass';
  page.event('appearancechange');
  page.scroll(300);
  assert.equal(page.hidden(), true);
});

test('scroll end, viewport changes and backgrounding always recover the text', () => {
  for (const event of ['scrollend', 'resize', 'visibilitychange']) {
    const page = setup();
    page.scroll(100);
    assert.equal(page.hidden(), true);
    if (event === 'visibilitychange') page.context.document.hidden = true;
    page.event(event);
    assert.equal(page.hidden(), false, event);
  }
});
