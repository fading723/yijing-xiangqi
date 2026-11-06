'use strict';
// Offline authoring only: fixed seeds and legal quiet opening moves produce a
// reproducible catalog. No random generation or network access happens in play.
const fs = require('node:fs');
const path = require('node:path');
const E = require('../engine');
const chapters = require('../campaign-design');
const at = E.at;
const openings = [
  [[64,67],[7,24],[88,69],[1,20]], // central cannon, screen horses
  [[83,67],[29,38],[88,69],[1,20]], // elephant opening
  [[56,47],[33,42],[82,65],[7,24]], // pawn opening
  [[64,66],[7,24],[88,69],[29,38]], // palace-corner cannon
  [[70,66],[1,20],[82,65],[7,24]], // cross-palace cannon
  [[58,49],[31,40],[88,69],[7,24]], // central pawn
  [[82,65],[7,24],[88,69],[1,20]], // horse development
  [[54,45],[35,44],[82,65],[7,24]], // flank pawn
  [[88,69],[1,20],[82,65],[7,24]], // double horses
  [[83,67],[7,24],[64,66],[1,20]]  // elephant and palace cannon
];

function random(seed) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}
function pieces(board) { return board.flatMap((piece, i) => piece ? [[piece, Math.floor(i / 9), i % 9]] : []); }
function key(board) { return board.map(p => p || '..').join(''); }
function signature(board) {
  const mirrored = board.map((_, i) => board[Math.floor(i / 9) * 9 + 8 - i % 9]);
  return [key(board), key(mirrored)].sort()[0];
}
function sustainsOpening(start) {
  let board = start, turn = 'r';
  const positions = [], counts = new Map();
  for (let ply = 0; ply < 16; ply++) {
    if (E.outcome(board, turn)) return false;
    const key = board.join(',') + turn;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (counts.get(key) >= 3) return false;
    const move = E.bestMove(board, turn, { depth: 2, maxNodes: 1000, timeMs: 5000, qDepth: 1, positions });
    if (!move) return false;
    positions.push(key); board = E.apply(board, move); turn = E.other(turn);
  }
  return E.outcome(board, turn) === null;
}
function basePosition(spec, variant) {
  const board = E.initialBoard();
  for (const side of ['r', 'b']) {
    const counts = {};
    for (const type of spec[side === 'r' ? 'red' : 'black']) counts[type] = (counts[type] || 0) + 1;
    for (const type of ['R', 'N', 'C', 'P']) {
      let indices = board.flatMap((p, i) => p === side + type ? [i] : []);
      if (variant % 2) indices.reverse();
      if (type === 'P') indices = [indices[2], indices[1], indices[3], indices[0], indices[4]];
      for (const i of indices.slice(counts[type] || 0)) board[i] = null;
    }
  }
  return board;
}
function generate(id, attempt) {
  const chapterIndex = Math.floor((id - 1) / 10), spec = chapters[chapterIndex];
  const variant = (id - 1) % 10, rng = random(id * 17539 + attempt * 7919);
  let board = basePosition(spec, variant), turn = 'r';
  const start = pieces(board), moves = [], visited = new Set([key(board)]);
  const rounds = spec.setupRounds + (chapterIndex === 9 && variant === 8 ? 1 : chapterIndex >= 8 ? 0 : variant % 3);
  for (let ply = 0; ply < rounds * 2; ply++) {
    const candidates = E.legalMoves(board, turn).filter(move => {
      if (board[move.to]) return false;
      const next = E.apply(board, move);
      if (E.inCheck(next, E.other(turn)) || visited.has(key(next))) return false;
      // Don't author a position by hanging a developed piece to an immediate capture.
      return !E.legalMoves(next, E.other(turn)).some(reply => reply.to === move.to);
    });
    if (!candidates.length) return null;
    const script = openings[variant][ply];
    const scripted = script && candidates.find(m => m.from === script[0] && m.to === script[1]);
    const ranked = candidates.map(move => {
      const type = board[move.from][1], row = Math.floor(move.to / 9), col = move.to % 9;
      const oldRow = Math.floor(move.from / 9);
      const advance = turn === 'r' ? oldRow - row : row - oldRow;
      const center = 4 - Math.abs(col - 4);
      const score = rng() * 18 + (['N','R','C'].includes(type) ? 9 : type === 'P' ? 6 : -8) + Math.min(advance, 2) * 3 + center * .8;
      return { move, score };
    }).sort((a, b) => b.score - a.score);
    const move = scripted || ranked[0].move;
    moves.push({ from: move.from, to: move.to });
    board = E.apply(board, move); visited.add(key(board)); turn = E.other(turn);
  }
  if (E.inCheck(board, 'r') || E.inCheck(board, 'b') || E.outcome(board, 'r')) return null;
  // Reject any immediate win for either player. Longer-game smoke checks live in tests.
  for (const side of ['r', 'b']) for (const move of E.legalMoves(board, side)) {
    if (E.outcome(E.apply(board, move), E.other(side))?.winner === side) return null;
  }
  const offset = chapterIndex === 1 ? id - 13 : variant;
  return {
    id, title: spec.titles[offset], chapter: spec.title, chapterIndex, kind: 'battle', moves: null,
    theme: chapterIndex < 5 ? '优势残局 · 不限步数' : chapterIndex < 7 ? '中局实战 · 不限步数' : '完整对弈 · 不限步数',
    intro: spec.intro, lesson: spec.lesson,
    ai: { depth: spec.depth, maxNodes: spec.nodes + variant * 70, timeMs: spec.timeMs },
    pieces: pieces(board), setup: { start, moves }
  };
}

function buildCampaign() {
  const catalog = [], unique = new Set();
  for (let id = 13; id <= 100; id++) {
    let level;
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = generate(id, attempt);
      if (!candidate) continue;
      const sig = signature(E.fromPieces(candidate.pieces));
      if (unique.has(sig)) continue;
      if (!sustainsOpening(E.fromPieces(candidate.pieces))) continue;
      unique.add(sig); level = candidate; break;
    }
    if (!level) throw new Error('Could not author a distinct valid position for level ' + id);
    catalog.push(level);
  }
  return catalog;
}

if (require.main === module) {
  const catalog = buildCampaign();
  const output = '(function(root){\n  "use strict";\n  const campaign = ' + JSON.stringify(catalog, null, 2) + ';\n  root.XiangqiCampaign = campaign;\n  if(typeof module !== "undefined" && module.exports) module.exports = campaign;\n})(typeof globalThis !== "undefined" ? globalThis : this);\n';
  fs.writeFileSync(path.resolve(__dirname, '../campaign-data.js'), output, 'utf8');
  console.log('Authored ' + catalog.length + ' distinct battle positions (no mirror duplicates).');
}
module.exports = { buildCampaign, basePosition, signature };
