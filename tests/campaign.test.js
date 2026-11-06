'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine');
const levels = require('../levels');
const chapters = require('../campaign-design');
const { signature } = require('../scripts/generate-campaign');

test('100 distinct levels, ten chapters and 88 unlimited battle levels', () => {
  assert.equal(levels.length, 100);
  assert.equal(chapters.length, 10);
  assert.deepEqual(levels.map(l => l.id), Array.from({ length: 100 }, (_, i) => i + 1));
  assert.equal(new Set(levels.map(l => l.title)).size, 100);
  assert.equal(new Set(levels.map(l => signature(E.fromPieces(l.pieces)))).size, 100);
  for (let c = 0; c < 10; c++) assert.equal(levels.filter(l => l.chapterIndex === c).length, 10);
  for (const level of levels.slice(12)) {
    assert.equal(level.kind, 'battle'); assert.equal(level.moves, null);
    assert(level.title && level.lesson && level.intro && level.theme);
  }
});

test('difficulty grows by search budget and reduced material advantage', () => {
  const values = { R: 900, N: 420, C: 440, P: 100, K: 0, A: 0, E: 0 };
  const advantage = level => level.pieces.reduce((sum, [p]) => sum + values[p[1]] * (p[0] === 'r' ? 1 : -1), 0);
  for (let i = 13; i < levels.length; i++) {
    assert(levels[i].ai.maxNodes >= levels[i - 1].ai.maxNodes);
    assert(levels[i].ai.depth >= levels[i - 1].ai.depth);
    assert(advantage(levels[i]) <= advantage(levels[i - 1]));
  }
  assert(advantage(levels[12]) >= 900);
  assert.equal(advantage(levels[99]), 0);
  assert(levels.slice(70).every(l => l.pieces.length === 32));
});

for (const level of levels.slice(12)) {
  test(`battle ${level.id}: legal replay, protected generals and no one-move win for either side`, () => {
    let board = E.fromPieces(level.setup.start), turn = 'r';
    for (const move of level.setup.moves) {
      assert(E.legalMoves(board, turn).some(m => m.from === move.from && m.to === move.to));
      board = E.apply(board, move); turn = E.other(turn);
    }
    assert.equal(turn, 'r');
    assert.deepEqual(board, E.fromPieces(level.pieces));
    for (const side of ['r', 'b']) {
      assert.equal(board.filter(p => p === side + 'K').length, 1);
      assert.equal(E.inCheck(board, side), false);
      assert.equal(E.outcome(board, side), null);
      for (const move of E.legalMoves(board, side)) assert.notEqual(E.outcome(E.apply(board, move), E.other(side))?.winner, side);
    }
  });
}

test('all 88 new starting positions sustain eight full rounds in bounded self-play', () => {
  for (const level of levels.slice(12)) {
    let board = E.fromPieces(level.pieces), turn = 'r';
    const positions = [];
    for (let ply = 0; ply < 16; ply++) {
      assert.equal(E.outcome(board, turn), null, `level ${level.id} ended at ply ${ply}`);
      const move = E.bestMove(board, turn, { depth: 2, maxNodes: 1000, timeMs: 5000, qDepth: 1, positions });
      assert(move);
      positions.push(board.join(',') + turn);
      board = E.apply(board, move); turn = E.other(turn);
    }
    assert.equal(E.outcome(board, turn), null, `level ${level.id} ended after eight rounds`);
  }
});
