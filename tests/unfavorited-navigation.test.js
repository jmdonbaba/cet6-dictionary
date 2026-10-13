const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('index.html', 'utf8');

function loadFunction(name, context) {
  const match = source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} must exist`);
  return new Function(...Object.keys(context), `${match[0]}; return ${name};`)(...Object.values(context));
}

function card(word, top, searching = false) {
  const focusCalls = [];
  const button = { focus: options => focusCalls.push(options) };
  return {
    _wordData: word ? { word } : null,
    _searching: searching,
    focusCalls,
    getBoundingClientRect: () => ({ top }),
    querySelector: () => word ? button : null
  };
}

function navigationHarness(cards, favorites = [], reducedMotion = false) {
  const scrolls = [];
  const notices = [];
  const animations = [];
  const storage = new Map([['cet6_vocab_favorites', JSON.stringify(favorites)]]);
  const getVFavs = loadFunction('getVFavs', {
    VFAV_KEY: 'cet6_vocab_favorites', localStorage: { getItem: key => storage.get(key) }
  });
  const context = {
    $wsModules: { querySelectorAll: () => cards },
    $btnJumpUnfavorited: {
      getAnimations: () => animations,
      animate: (frames, options) => {
        const animation = { frames, options, canceled: false, cancel() { this.canceled = true; } };
        animations.push(animation);
        return animation;
      }
    },
    getVFavs,
    matchMedia: () => ({ matches: reducedMotion }),
    window: { scrollY: 600, scrollTo: options => scrolls.push(options) },
    toast: message => notices.push(message)
  };
  return {
    jump: loadFunction('jumpToFirstUnfavoritedCard', context),
    scrolls, notices, animations, storage, context
  };
}

test('jumps to the first unfavorited result in page order, skipping drafts and active searches', () => {
  const cards = [card(null, -500), card('Aspire', -200), card('loading', 100, true),
    card('benefit', 380), card('contribute', 900)];
  const harness = navigationHarness(cards, [{ word: 'ASPIRE' }]);
  harness.jump();

  assert.deepEqual(harness.scrolls, [{ top: 956, behavior: 'smooth' }]);
  assert.deepEqual(cards.map(item => item.focusCalls.length), [0, 0, 0, 1, 0]);
  assert.deepEqual(cards[3].focusCalls, [{ preventScroll: true }]);
  assert.deepEqual(harness.notices, []);
  assert.equal(harness.storage.get('cet6_vocab_favorites'), '[{"word":"ASPIRE"}]');
});

test('each click reads current favorites and starts from the first card even when scrolled below it', () => {
  const cards = [card('aspire', -400), card('benefit', 200), card('contribute', 800)];
  const harness = navigationHarness(cards);
  harness.jump();
  assert.equal(harness.scrolls[0].top, 176);

  harness.storage.set('cet6_vocab_favorites', JSON.stringify([{ word: 'aspire' }]));
  harness.jump();
  assert.equal(harness.scrolls[1].top, 776);

  harness.storage.set('cet6_vocab_favorites', '[]');
  harness.jump();
  assert.equal(harness.scrolls[2].top, 176);
  assert.deepEqual(cards.map(item => item.focusCalls.length), [2, 1, 0]);
  assert.equal(harness.animations.length, 3);
  assert.ok(harness.animations[0].canceled);
  assert.ok(harness.animations[1].canceled);
});

test('reports that all completed cards are saved without scrolling or changing favorites', () => {
  const cards = [card(null, 0), card('aspire', 200)];
  const harness = navigationHarness(cards, [{ word: 'aspire' }]);
  harness.jump();
  assert.deepEqual(harness.scrolls, []);
  assert.deepEqual(harness.notices, ['当前卡片都已收藏']);
  assert.deepEqual(cards[1].focusCalls, []);
  assert.equal(harness.storage.get('cet6_vocab_favorites'), '[{"word":"aspire"}]');
});

test('reports no eligible cards on an empty page or while all results are loading', () => {
  for (const cards of [[], [card(null, 0), card('loading', 200, true)]]) {
    const harness = navigationHarness(cards);
    harness.jump();
    assert.deepEqual(harness.scrolls, []);
    assert.deepEqual(harness.notices, ['当前没有可收藏的卡片']);
  }
});

test('reduced motion disables the bounce and uses immediate scrolling, clamped to the page top', () => {
  const harness = navigationHarness([card('aspire', -590)], [], true);
  harness.jump();
  assert.deepEqual(harness.scrolls, [{ top: 0, behavior: 'auto' }]);
  assert.deepEqual(harness.animations, []);
});

test('the unfavorited shortcut stays available on short pages and hides while a modal is open', () => {
  const context = {
    pageJumpFrame: 1,
    document: { scrollingElement: { scrollTop: 0, scrollHeight: 600, clientHeight: 800 } },
    $modalOverlay: { style: { display: 'none' } },
    $pageJumpControls: {}, $btnJumpTop: {}, $btnJumpBottom: {}, $btnJumpUnfavorited: {}
  };
  const update = loadFunction('updatePageJumpControls', context);
  update();
  assert.equal(context.$pageJumpControls.hidden, true);
  assert.equal(context.$btnJumpUnfavorited.hidden, false);

  context.$modalOverlay.style.display = 'flex';
  update();
  assert.equal(context.$btnJumpUnfavorited.hidden, true);
});
