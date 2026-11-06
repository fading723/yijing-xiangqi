'use strict';
// A minimal DOM adapter runs the real application with its real engine.
// It validates round/state persistence without adding browser dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../engine');
const levels = require('../levels');
const chapters = require('../campaign-design');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const key = 'yijing-offline-v2', legacyKey = 'yijing-offline-v1';

function boot(saved, blockedStorage = false, keepWelcome = false) {
  class Element {
    constructor() {
      this.children = []; this.events = {}; this.attrs = {}; this.style = {}; this.dataset = {};
      this.className = ''; this.value = ''; this.textContent = ''; this.disabled = false; this.open = false;
      this.classList = {
        add: name => { if (!this.className.split(' ').includes(name)) this.className += ' ' + name; },
        remove: name => { this.className = this.className.split(' ').filter(n => n !== name).join(' '); },
        toggle: (name, value) => { if (value) this.classList.add(name); else this.classList.remove(name); }
      };
    }
    set innerHTML(value) { this._html = value; this.children = []; }
    get innerHTML() { return this._html || ''; }
    appendChild(child) { this.children.push(child); }
    addEventListener(name, fn) { this.events[name] = fn; }
    setAttribute(name, value) { this.attrs[name] = value; }
    click() { if (!this.disabled) this.events.click?.({}); }
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() {}
  }
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element()]));
  elements['difficulty-select'].value = '3';
  const storage = new Map(saved ? [[saved.version === 1 ? legacyKey : key, typeof saved === 'string' ? saved : JSON.stringify(saved)]] : []);
  const timers = new Map(); let timerId = 0, now = 0;
  const document = { getElementById: id => elements[id], createElement: () => new Element(), querySelectorAll: () => [], addEventListener() {} };
  const context = { document, localStorage: { getItem: k => { if (blockedStorage) throw Error('Denied'); return storage.get(k); }, setItem: (k, value) => { if (blockedStorage) throw Error('Denied'); storage.set(k, value); } },
    setTimeout: (fn, delay = 0) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; }, clearTimeout: id => timers.delete(id),
    Blob, URL, console, addEventListener() {}, Xiangqi: E, XiangqiLevels: levels, XiangqiChapters: chapters, createXiangqi: globalThis.createXiangqi };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'app.js' });
  if (!keepWelcome && elements['welcome-dialog'].open) elements['welcome-start'].click();
  return {
    elements, storage, document,
    data: () => JSON.parse(storage.get(key)),
    click: id => elements[id].click(),
    change: (id, value) => { elements[id].value = value; elements[id].events.change?.({}); },
    move: (from, to) => { if (elements['board-squares'].children[from].attrs['aria-pressed'] !== 'true') elements['board-squares'].children[from].click(); elements['board-squares'].children[to].click(); },
    drain: () => { let count = 0; while (timers.size) { assert(++count < 40, 'timer loop should settle'); const [id, task] = [...timers].sort((a, b) => a[1].at - b[1].at)[0]; timers.delete(id); now = task.at; task.fn(); } }
  };
}

test('new players see the guide once and can play immediately after dismissing it', () => {
  const app = boot(undefined, false, true);
  assert.equal(app.elements['welcome-dialog'].open, true);
  assert.equal(app.data().introSeen, false);
  app.click('welcome-start');
  assert.equal(app.elements['welcome-dialog'].open, false);
  assert.equal(app.data().introSeen, true);
  assert.equal(boot(app.data(), false, true).elements['welcome-dialog'].open, false);
  app.move(18, 23);
  assert.equal(app.data().progress[0], 3);
});

test('welcome can open rules or be dismissed with Escape without resetting the game', () => {
  const app = boot(undefined, false, true);
  app.click('welcome-rules');
  assert.equal(app.elements['welcome-dialog'].open, false);
  assert.equal(app.elements['help-dialog'].open, true);
  assert.equal(app.data().introSeen, true);
  const other = boot(undefined, false, true);
  let prevented = false;
  other.elements['welcome-dialog'].events.cancel({ preventDefault() { prevented = true; } });
  assert(prevented);
  assert.equal(other.elements['welcome-dialog'].open, false);
  other.move(18, 23);
  assert.equal(other.data().progress[0], 3);
});

test('existing saves skip the welcome and blocked storage still allows play', () => {
  for (const version of [1, 2]) {
    const app = boot({ version, progress: [3], sessions: {} }, false, true);
    assert.equal(app.elements['welcome-dialog'].open, false);
    assert.equal(app.data().progress[0], 3);
  }
  const app = boot(undefined, true, true);
  app.click('welcome-start');
  app.move(18, 23);
  assert.equal(app.elements['result-dialog'].open, true);
});

test('first win awards three stars and unlocks only the next level', () => {
  const app = boot(); app.move(18, 23);
  assert.equal(app.data().progress[0], 3);
  assert.equal(app.elements['result-dialog'].open, true);
  app.click('next-button');
  assert.equal(app.data().sessions.challenge.levelIndex, 1);
  assert.equal(app.data().sessions.challenge.moves.length, 0);
  assert.equal(app.data().progress[1], 0);
});

test('a nonwinning last move fails; undo restores the board and lowers rating', () => {
  const app = boot(); app.move(18, 19);
  assert.equal(app.data().sessions.challenge.finished.reason, 'budget');
  app.click('undo-button');
  assert.equal(app.data().sessions.challenge.moves.length, 0);
  assert.equal(app.data().sessions.challenge.finished, null);
  app.move(18, 23);
  assert.equal(app.data().progress[0], 2);
});

test('hint works with no Worker, and a hinted win awards two stars', () => {
  const app = boot(); app.click('hint-button'); app.drain();
  assert.equal(app.data().sessions.challenge.hintUsed, true);
  assert.match(app.elements['hint-path'].attrs.d, /^M/);
  app.move(18, 23); assert.equal(app.data().progress[0], 2);
});

test('using hint and undo awards one star; replay never lowers an existing best', () => {
  const app = boot(); app.click('hint-button'); app.drain(); app.move(18, 19); app.click('undo-button'); app.move(18, 23);
  assert.equal(app.data().progress[0], 1);
  app.click('retry-button'); app.move(18, 23); assert.equal(app.data().progress[0], 3);
  app.click('retry-button'); app.click('hint-button'); app.drain(); app.move(18, 23); assert.equal(app.data().progress[0], 3);
});

test('practice AI makes a legal reply and undo restores the entire round', () => {
  const app = boot(); app.click('practice-tab'); app.move(54, 45); app.drain();
  const moves = app.data().sessions.practice.moves;
  assert.equal(moves.length, 2);
  const blackBoard = E.apply(E.initialBoard(), moves[0]);
  assert(E.legalMoves(blackBoard, 'b').some(m => m.from === moves[1].from && m.to === moves[1].to));
  app.click('undo-button');
  assert.equal(app.data().sessions.practice.moves.length, 0);
  assert.equal(app.elements['board-squares'].children[54].attrs['aria-label'], '红兵，第7行第1列');
});

test('undo and mode changes cancel pending computer responses', () => {
  const app = boot(); app.click('practice-tab'); app.move(54, 45); app.click('undo-button'); app.drain();
  assert.equal(app.data().sessions.practice.moves.length, 0);
  app.move(54, 45); app.click('challenge-tab'); app.drain();
  assert.equal(app.data().mode, 'challenge');
  assert.equal(app.data().sessions.challenge.moves.length, 0);
  app.click('practice-tab'); app.drain();
  assert.equal(app.data().sessions.practice.moves.length, 2);
});

test('refresh restores legal moves, scores and pending black turn', () => {
  const original = boot(); original.move(18, 23); original.click('next-button'); original.click('practice-tab'); original.move(54, 45);
  const restored = boot(original.data()); restored.drain();
  assert.equal(restored.data().progress[0], 3);
  assert.equal(restored.data().sessions.practice.moves.length, 2);
  restored.click('challenge-tab');
  assert.equal(restored.data().sessions.challenge.levelIndex, 1);
});

test('reload reconstructs a finished puzzle and its result', () => {
  const app = boot(); app.move(18, 23);
  const restored = boot(app.data());
  assert.equal(restored.elements['result-dialog'].open, true);
  assert.equal(restored.data().sessions.challenge.finished.winner, 'r');
});

test('invalid storage, illegal saved moves and denied storage cannot prevent play', () => {
  const bad = boot('broken JSON'); bad.move(18, 23); assert.equal(bad.data().progress[0], 3);
  const tampered = boot({ version: 1, sessions: { challenge: { levelIndex: 0, moves: [{ from: 5, to: 84 }] } } });
  assert.equal(tampered.data().sessions.challenge.moves.length, 0);
  const denied = boot(null, true); denied.move(18, 23); assert.equal(denied.elements['result-dialog'].open, true);
});

test('all twelve tutorial levels still work and now lead to level thirteen', () => {
  const app = boot();
  for (let i = 0; i < 12; i++) {
    let turns = 0;
    while (!app.data().sessions.challenge.finished) {
      assert(++turns <= levels[i].moves);
      const moves = app.data().sessions.challenge.moves;
      let board = E.fromPieces(levels[i].pieces);
      for (const move of moves) board = E.apply(board, move);
      const solution = E.solve(board, 'r', levels[i].moves - Math.ceil(moves.length / 2));
      assert.equal(solution.win, true);
      app.move(solution.move.from, solution.move.to); app.drain();
    }
    assert.equal(app.data().progress[i], 3);
    if (i < 11) app.click('next-button');
  }
  assert.equal(app.data().progress.reduce((a, b) => a + b, 0), 36);
  assert.equal(app.elements['result-title'].textContent, '此局，已破。');
  app.click('next-button');
  assert.equal(app.data().sessions.challenge.levelIndex, 12);
  assert.equal(app.elements['objective-text'].textContent, '击败黑方 · 不限步数');
});

test('standalone artifact contains all logic and no external script/style/font requests', () => {
  const standalone = fs.readFileSync(path.join(root, '弈境-离线版.html'), 'utf8');
  assert(!/<script[^>]*\bsrc=/i.test(standalone));
  assert(!/<link[^>]*rel="stylesheet"/i.test(standalone));
  assert(!/https?:\/\//i.test(standalone.replaceAll('http://www.w3.org/2000/svg', '')));
  assert(standalone.includes('function createXiangqi()'));
  assert(standalone.includes('function makeMove(move)'));
});

function battleSave(index = 12, moves = []) {
  return { version: 1, mode: 'challenge', progress: Array.from({ length: 100 }, (_, i) => i < index ? 3 : 0),
    sessions: { challenge: { levelIndex: index, moves, hintUsed: false, undoUsed: false } } };
}

test('a twelve-level save extends to 100 while preserving stars, preferences and the current board', () => {
  const original = boot(); original.move(18, 23); original.click('next-button');
  const old = original.data(); old.version = 1; old.progress = old.progress.slice(0, 12); old.soundOn = true; old.difficulty = '4';
  const migrated = boot(old);
  assert.equal(migrated.data().progress.length, 100);
  assert.equal(migrated.data().progress[0], 3);
  assert(migrated.data().progress.slice(12).every(score => score === 0));
  assert.equal(migrated.data().sessions.challenge.levelIndex, 1);
  assert.equal(migrated.data().soundOn, true);
  assert.equal(migrated.data().difficulty, '4');
  assert.deepEqual(JSON.parse(migrated.storage.get(legacyKey)), old, 'retain the original save as a migration backup');
  assert.equal(migrated.data().version, 2);
  assert.equal(migrated.elements['progress-label'].textContent, '1 / 100');
  assert.match(migrated.elements['star-count'].innerHTML, /300/);
  const completedOld = boot({ version: 1, progress: Array(12).fill(3) });
  assert.equal(completedOld.data().sessions.challenge.levelIndex, 12);
});

test('chapter browsing reaches 100, preserves current play and enforces sequential unlocking', () => {
  const app = boot();
  assert.equal(app.elements['level-list'].children.length, 10);
  app.change('chapter-select', '9');
  assert.equal(app.elements['chapter-page'].textContent, '10 / 10 章');
  assert.match(app.elements['level-list'].children[9].attrs['aria-label'], /^第100关/);
  app.elements['level-list'].children[9].click();
  assert.equal(app.data().sessions.challenge.levelIndex, 0);
  app.click('continue-journey');
  assert.equal(app.elements['chapter-select'].value, '0');
  assert.equal(app.elements['previous-chapter'].disabled, true);
});

test('a battle survives eight red moves, can be resumed, and undoes a complete round', () => {
  const app = boot(battleSave());
  let board = E.fromPieces(levels[12].pieces);
  for (let turn = 0; turn < 8; turn++) {
    const move = E.bestMove(board, 'r', { depth: 2, maxNodes: 1600, timeMs: 5000 });
    app.move(move.from, move.to); app.drain();
    const state = app.data().sessions.challenge;
    assert.equal(state.finished, null, `battle must remain active after red move ${turn + 1}`);
    board = E.fromPieces(levels[12].pieces);
    for (const played of state.moves) board = E.apply(board, played);
  }
  assert.equal(app.data().sessions.challenge.moves.length, 16);
  assert.equal(app.elements['move-limit'].textContent, ' 步 · 不限');
  const resumed = boot(app.data());
  assert.equal(resumed.data().sessions.challenge.moves.length, 16);
  assert.equal(resumed.data().sessions.challenge.finished, null);
  resumed.click('undo-button');
  assert.equal(resumed.data().sessions.challenge.moves.length, 14);
  resumed.click('hint-button'); resumed.drain();
  assert.match(resumed.elements['insight-text'].textContent, /建议走法/);
  assert.equal(resumed.data().sessions.challenge.finished, null);
});

test('battle hints do not run bounded mate solving or report that an unlimited budget ran out', () => {
  const app = boot(battleSave(99)); app.click('hint-button'); app.drain();
  assert.equal(app.data().sessions.challenge.hintUsed, true);
  assert.match(app.elements['hint-path'].attrs.d, /^M/);
  assert.match(app.elements['insight-text'].textContent, /建议走法/);
  assert.equal(app.elements['chapter-select'].value, '9');
});

test('a repeated battle position is a draw, never a level completion, and undo resumes play', () => {
  const start = E.fromPieces(levels[99].pieces);
  let cycle;
  for (const red of E.legalMoves(start, 'r')) {
    if (start[red.to]) continue;
    const afterRed = E.apply(start, red);
    if (E.inCheck(afterRed, 'b')) continue;
    for (const black of E.legalMoves(afterRed, 'b')) {
      if (afterRed[black.to]) continue;
      const moves = [red, black, { from: red.to, to: red.from }, { from: black.to, to: black.from }];
      let board = start, side = 'r', valid = true;
      for (const move of moves) {
        if (!E.legalMoves(board, side).some(m => m.from === move.from && m.to === move.to)) { valid = false; break; }
        board = E.apply(board, move); side = E.other(side);
        if (E.inCheck(board, side)) { valid = false; break; }
      }
      if (valid && JSON.stringify(board) === JSON.stringify(start)) { cycle = moves; break; }
    }
    if (cycle) break;
  }
  assert(cycle, 'find a reversible nonchecking cycle on the real final-level board');
  const app = boot(battleSave(99, [...cycle, ...cycle]));
  assert.equal(app.data().sessions.challenge.finished.reason, 'repetition');
  assert.equal(app.data().sessions.challenge.finished.winner, null);
  assert.equal(app.data().progress[99], 0);
  assert.match(app.elements['result-message'].textContent, /获胜才能解锁/);
  app.click('undo-button');
  assert.equal(app.data().sessions.challenge.finished, null);
  assert.equal(app.data().sessions.challenge.moves.length, 6);
});
