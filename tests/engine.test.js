'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine');
const levels = require('../levels');
const pos = pieces => E.fromPieces(pieces);
const sq = E.at;

test('initial board has 32 pieces and the standard opening perft counts', () => {
  const board = E.initialBoard();
  assert.equal(board.filter(Boolean).length, 32);
  assert.equal(E.legalMoves(board, 'r').length, 44);
  const secondPly = E.legalMoves(board, 'r').reduce((total, m) => total + E.legalMoves(E.apply(board, m), 'b').length, 0);
  assert.equal(secondPly, 1920);
  assert.equal(E.inCheck(board, 'r'), false);
  assert.equal(E.inCheck(board, 'b'), false);
});

test('rook cannot jump or capture its own pieces', () => {
  const b = pos([['rR', 5, 4], ['rP', 3, 4], ['bP', 5, 6], ['bR', 5, 8]]);
  const moves = E.pseudo(b, sq(5, 4));
  assert(moves.includes(sq(4, 4)));
  assert(!moves.includes(sq(3, 4)));
  assert(!moves.includes(sq(2, 4)));
  assert(moves.includes(sq(5, 6)));
  assert(!moves.includes(sq(5, 8)));
});

test('cannon needs exactly one screen to capture, and cannot land beyond the screen', () => {
  const b = pos([['rC', 7, 4], ['rP', 5, 4], ['bN', 2, 4], ['bR', 0, 4], ['bP', 7, 7]]);
  const moves = E.pseudo(b, sq(7, 4));
  assert(moves.includes(sq(6, 4)));
  assert(moves.includes(sq(2, 4)));
  for (const target of [sq(5, 4), sq(4, 4), sq(0, 4), sq(7, 7)]) assert(!moves.includes(target));
});

test('horse leg blocks exactly the two associated destinations', () => {
  const b = pos([['rN', 5, 4], ['rP', 4, 4]]);
  const moves = E.pseudo(b, sq(5, 4));
  assert.equal(moves.length, 6);
  assert(!moves.includes(sq(3, 3)));
  assert(!moves.includes(sq(3, 5)));
  assert(moves.includes(sq(4, 2)));
});

test('elephant cannot cross river or jump its eye', () => {
  const b = pos([['rE', 5, 4], ['rP', 6, 5], ['bE', 4, 2]]);
  assert.deepEqual(E.pseudo(b, sq(5, 4)), [sq(7, 2)]);
  assert(E.pseudo(b, sq(4, 2)).every(target => Math.floor(target / 9) <= 4));
});

test('advisor and general stay in palace', () => {
  const b = pos([['rA', 7, 3], ['rK', 9, 5], ['bA', 2, 5], ['bK', 0, 3]]);
  assert.deepEqual(E.pseudo(b, sq(7, 3)), [sq(8, 4)]);
  assert.deepEqual(E.pseudo(b, sq(2, 5)), [sq(1, 4)]);
  assert.deepEqual(E.pseudo(b, sq(9, 5)).sort(), [sq(8, 5), sq(9, 4)].sort());
});

test('soldiers move forward only before river, sideways after river, never backwards', () => {
  const b = pos([['rP', 5, 4], ['rP', 4, 2], ['bP', 5, 6], ['bP', 4, 8]]);
  assert.deepEqual(E.pseudo(b, sq(5, 4)), [sq(4, 4)]);
  assert.deepEqual(E.pseudo(b, sq(4, 2)).sort(), [sq(3, 2), sq(4, 1), sq(4, 3)].sort());
  assert.deepEqual(E.pseudo(b, sq(5, 6)).sort(), [sq(6, 6), sq(5, 5), sq(5, 7)].sort());
  assert.deepEqual(E.pseudo(b, sq(4, 8)), [sq(5, 8)]);
});

test('cannot expose facing generals, while a blocking piece can move along the file', () => {
  const b = pos([['bK', 0, 4], ['rK', 9, 4], ['rR', 5, 4]]);
  const moves = E.legalMoves(b, 'r', sq(5, 4));
  assert(moves.some(m => m.to === sq(4, 4)));
  assert(!moves.some(m => m.to === sq(5, 3)));
  const exposed = b.slice(); exposed[sq(5, 4)] = null;
  assert(E.inCheck(exposed, 'r')); assert(E.inCheck(exposed, 'b'));
});

test('every legal check evasion actually protects the general', () => {
  const b = pos([['bK', 0, 3], ['rK', 9, 4], ['bR', 5, 4], ['rR', 7, 0], ['rA', 9, 3]]);
  assert(E.inCheck(b, 'r'));
  const moves = E.legalMoves(b, 'r');
  assert(moves.length > 0);
  for (const m of moves) assert(!E.inCheck(E.apply(b, m), 'r'));
  assert(!moves.some(m => m.from === sq(7, 0) && m.to === sq(6, 0)));
});

test('stalemate is a loss in Xiangqi, even without check', () => {
  const b = pos([['bK', 0, 4], ['rK', 9, 3], ['rR', 1, 0], ['rR', 2, 5]]);
  assert.equal(E.inCheck(b, 'b'), false);
  assert.deepEqual(E.outcome(b, 'b'), { winner: 'r', reason: 'stalemate' });
});

test('search returns legal moves and finds an immediate mate', () => {
  const b = pos(levels[0].pieces);
  const move = E.bestMove(b, 'r', { depth: 3, timeMs: 500 });
  assert(E.legalMoves(b, 'r').some(m => m.from === move.from && m.to === move.to));
  assert.equal(E.outcome(E.apply(b, move), 'b').winner, 'r');
  assert.deepEqual(b, pos(levels[0].pieces), 'search must not mutate its input');
});

test('exhausting the solver budget returns unknown instead of a false result', () => {
  const result = E.solve(pos(levels[11].pieces), 'r', 3, { maxNodes: 1 });
  assert.equal(result.complete, false);
  assert.equal(result.win, null);
});

for (const level of levels.filter(level => level.kind === 'puzzle')) {
  test(`level ${level.id}: legal setup and forced win within ${level.moves} red moves against every defense`, () => {
    const b = pos(level.pieces);
    assert.equal(E.inCheck(b, 'r'), false);
    assert.equal(E.inCheck(b, 'b'), false);
    assert.equal(E.outcome(b, 'r'), null);
    const solution = E.solve(b, 'r', level.moves, { maxNodes: 200000 });
    assert.equal(solution.complete, true);
    assert.equal(solution.win, true);
    function verify(position, side, remaining) {
      const end = E.outcome(position, side);
      if (end) { assert.equal(end.winner, 'r'); return; }
      if (side === 'r') {
        assert(remaining > 0);
        const answer = E.solve(position, 'r', remaining, { maxNodes: 200000 });
        assert.equal(answer.win, true);
        assert(E.legalMoves(position, side).some(m => m.from === answer.move.from && m.to === answer.move.to));
        verify(E.apply(position, answer.move), 'b', remaining - 1);
      } else {
        for (const reply of E.legalMoves(position, 'b')) verify(E.apply(position, reply), 'r', remaining);
      }
    }
    verify(b, 'r', level.moves);
  });
}
