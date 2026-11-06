(function (root) {
  'use strict';

  function createXiangqi() {
    const ROWS = 10, COLS = 9;
    const other = side => side === 'r' ? 'b' : 'r';
    const at = (r, c) => r * 9 + c;
    const inside = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 9;
    const palace = (r, c, side) => c >= 3 && c <= 5 && (side === 'r' ? r >= 7 && r <= 9 : r >= 0 && r <= 2);
    const values = { K: 100000, R: 900, C: 440, N: 420, E: 200, A: 200, P: 100 };

    function pseudo(board, from) {
      const piece = board[from];
      if (!piece) return [];
      const side = piece[0], type = piece[1], r = Math.floor(from / 9), c = from % 9;
      const moves = [];
      function add(y, x) {
        if (inside(y, x) && (!board[at(y, x)] || board[at(y, x)][0] !== side)) moves.push(at(y, x));
      }
      if (type === 'R' || type === 'C') {
        for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let screen = false;
          for (let y = r + dy, x = c + dx; inside(y, x); y += dy, x += dx) {
            const target = board[at(y, x)];
            if (type === 'R') {
              if (!target || target[0] !== side) moves.push(at(y, x));
              if (target) break;
            } else if (!screen) {
              if (target) screen = true;
              else moves.push(at(y, x));
            } else if (target) {
              if (target[0] !== side) moves.push(at(y, x));
              break;
            }
          }
        }
      } else if (type === 'N') {
        for (const [dy, dx, ly, lx] of [[-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0], [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1]]) {
          if (inside(r + ly, c + lx) && !board[at(r + ly, c + lx)]) add(r + dy, c + dx);
        }
      } else if (type === 'E') {
        for (const [dy, dx] of [[-2, -2], [-2, 2], [2, -2], [2, 2]]) {
          const y = r + dy, x = c + dx;
          if (inside(y, x) && (side === 'r' ? y >= 5 : y <= 4) && !board[at(r + dy / 2, c + dx / 2)]) add(y, x);
        }
      } else if (type === 'A') {
        for (const [dy, dx] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          if (palace(r + dy, c + dx, side)) add(r + dy, c + dx);
        }
      } else if (type === 'K') {
        for (const [dy, dx] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          if (palace(r + dy, c + dx, side)) add(r + dy, c + dx);
        }
        for (const dy of [-1, 1]) {
          for (let y = r + dy; inside(y, c); y += dy) {
            const target = board[at(y, c)];
            if (target) {
              if (target === other(side) + 'K') moves.push(at(y, c));
              break;
            }
          }
        }
      } else if (type === 'P') {
        add(r + (side === 'r' ? -1 : 1), c);
        if (side === 'r' ? r <= 4 : r >= 5) { add(r, c - 1); add(r, c + 1); }
      }
      return moves;
    }

    function apply(board, move) {
      const next = board.slice();
      next[move.to] = next[move.from];
      next[move.from] = null;
      return next;
    }

    function inCheck(board, side) {
      const king = board.indexOf(side + 'K');
      if (king < 0) return true;
      for (let i = 0; i < 90; i++) {
        if (board[i] && board[i][0] !== side && pseudo(board, i).includes(king)) return true;
      }
      return false;
    }

    function legalMoves(board, side, onlyFrom) {
      if (!board.includes(side + 'K')) return [];
      const moves = [];
      for (let i = 0; i < 90; i++) {
        if (onlyFrom !== undefined && i !== onlyFrom) continue;
        if (!board[i] || board[i][0] !== side) continue;
        for (const to of pseudo(board, i)) {
          const move = { from: i, to };
          if (!inCheck(apply(board, move), side)) moves.push(move);
        }
      }
      return moves;
    }

    function outcome(board, turn) {
      if (!board.includes(turn + 'K')) return { winner: other(turn), reason: 'capture' };
      if (!board.includes(other(turn) + 'K')) return { winner: turn, reason: 'capture' };
      if (!legalMoves(board, turn).length) return { winner: other(turn), reason: inCheck(board, turn) ? 'checkmate' : 'stalemate' };
      return null;
    }

    function evaluate(board, side) {
      let score = 0;
      for (let i = 0; i < 90; i++) {
        const p = board[i];
        if (!p) continue;
        const row = Math.floor(i / 9), col = i % 9;
        const advance = p[0] === 'r' ? 9 - row : row;
        let v = values[p[1]];
        if (p[1] === 'P') v += advance * 13 + (advance >= 5 ? 65 : 0);
        if (['N', 'C', 'R'].includes(p[1])) {
          v += 4 * (4 - Math.abs(col - 4)) + advance * 2 + pseudo(board, i).length * (p[1] === 'N' ? 4 : 2);
          const king = board.indexOf(other(p[0]) + 'K');
          if (king >= 0) v += Math.max(0, 8 - Math.abs(row - Math.floor(king / 9)) - Math.abs(col - king % 9)) * 3;
        }
        if (p[1] === 'K') {
          // Reward a connected home defense, especially while many attacking pieces remain.
          const defenders = board.filter(q => q && q[0] === p[0] && ['A', 'E'].includes(q[1])).length;
          v += defenders * 12;
        }
        score += p[0] === side ? v : -v;
      }
      return score;
    }

    function ordered(board, moves, preferred) {
      const rank = m => (preferred && preferred.from === m.from && preferred.to === m.to ? 1000000 : 0) + (board[m.to] ? values[board[m.to][1]] * 10 - values[board[m.from][1]] : 0);
      return moves.sort((a, b) => rank(b) - rank(a));
    }

    function bestMove(board, side, options = {}) {
      const maxDepth = options.depth || 3, deadline = Date.now() + (options.timeMs || 900);
      const maxNodes = options.maxNodes || 40000, qDepth = options.qDepth ?? 2;
      const roots = legalMoves(board, side);
      if (!roots.length) return null;
      let chosen = roots[0], nodes = 0;
      const timeout = {}, table = new Map(), path = new Set();
      const prior = new Map();
      for (const key of options.positions || []) prior.set(key, (prior.get(key) || 0) + 1);
      const positionKey = (position, turn) => position.join(',') + turn;
      function tick() {
        nodes++;
        if (nodes > maxNodes || ((nodes & 31) === 0 && Date.now() > deadline)) throw timeout;
      }
      function quiet(position, turn, alpha, beta, ply, remaining, moves) {
        tick();
        const checked = inCheck(position, turn);
        if (!moves.length) return -1000000 + ply;
        const stand = evaluate(position, turn);
        if (remaining <= 0) return stand;
        if (!checked) {
          if (stand >= beta) return stand;
          alpha = Math.max(alpha, stand);
        }
        const candidates = checked ? moves : moves.filter(m => position[m.to]);
        for (const move of ordered(position, candidates)) {
          const next = apply(position, move), nextSide = other(turn);
          const score = -quiet(next, nextSide, -beta, -alpha, ply + 1, remaining - 1, legalMoves(next, nextSide));
          if (score >= beta) return score;
          alpha = Math.max(alpha, score);
        }
        return alpha;
      }
      function search(position, turn, depth, alpha, beta, ply) {
        tick();
        if (!position.includes(turn + 'K')) return -1000000 + ply;
        const key = positionKey(position, turn);
        if ((prior.get(key) || 0) >= 2 || path.has(key)) return 0;
        const entry = table.get(key), originalAlpha = alpha;
        if (entry && entry.depth >= depth) {
          if (entry.flag === 'exact') return entry.score;
          if (entry.flag === 'lower') alpha = Math.max(alpha, entry.score);
          else beta = Math.min(beta, entry.score);
          if (alpha >= beta) return entry.score;
        }
        const moves = legalMoves(position, turn);
        if (!moves.length) return -1000000 + ply;
        if (depth <= 0) return quiet(position, turn, alpha, beta, ply, qDepth, moves);
        let best = -Infinity, move = moves[0];
        path.add(key);
        try {
          for (const m of ordered(position, moves, entry?.move)) {
            const score = -search(apply(position, m), other(turn), depth - 1, -beta, -alpha, ply + 1);
            if (score > best) { best = score; move = m; }
            alpha = Math.max(alpha, score);
            if (alpha >= beta) break;
          }
        } finally { path.delete(key); }
        // Mate distances are relative to the current root, so don't cache them.
        if (Math.abs(best) < 900000) {
          table.set(key, { depth, score: best, move, flag: best <= originalAlpha ? 'upper' : best >= beta ? 'lower' : 'exact' });
        }
        return best;
      }
      path.add(positionKey(board, side));
      for (let depth = 1; depth <= maxDepth; depth++) {
        let roundMove = chosen, best = -Infinity;
        try {
          for (const m of ordered(board, roots.slice(), chosen)) {
            const next = apply(board, m);
            const repeatedCheck = prior.has(positionKey(next, other(side))) && inCheck(next, other(side));
            const score = -search(next, other(side), depth - 1, -Infinity, -best, 1) - (repeatedCheck ? 60 : 0);
            if (score > best) { best = score; roundMove = m; }
          }
          chosen = roundMove;
        } catch (err) { if (err !== timeout) throw err; break; }
        if (best > 900000 || Date.now() > deadline) break;
      }
      return chosen;
    }

    // Exact bounded puzzle solver: every legal black defense must lose.
    // A node limit returns "unknown", never a false proof of a winning line.
    function solve(board, turn = 'r', redMoves = 3, options = {}) {
      const maxNodes = options.maxNodes || 100000;
      const cache = new Map();
      let nodes = 0;
      const limit = {};
      function visit(position, side, remaining) {
        if (++nodes > maxNodes) throw limit;
        const end = outcome(position, side);
        if (end) return { win: end.winner === 'r', distance: 0, move: null };
        if (side === 'r' && remaining <= 0) return { win: false, distance: 0, move: null };
        const key = position.map(p => p || '.').join('') + side + remaining;
        if (cache.has(key)) return cache.get(key);
        let moves = legalMoves(position, side);
        moves = ordered(position, moves).map(m => ({ ...m, check: inCheck(apply(position, m), other(side)) })).sort((a, b) => Number(b.check) - Number(a.check));
        let best = null;
        for (const move of moves) {
          const child = visit(apply(position, move), other(side), remaining - (side === 'r' ? 1 : 0));
          const candidate = { win: child.win, distance: child.distance + 1, move: { from: move.from, to: move.to } };
          if (side === 'r' && child.win) { best = candidate; break; }
          if (side === 'b' && !child.win) { best = candidate; break; }
          if (!best || (side === 'b' && candidate.distance > best.distance)) best = candidate;
        }
        cache.set(key, best);
        return best;
      }
      try { return { ...visit(board, turn, redMoves), nodes, complete: true }; }
      catch (err) { if (err !== limit) throw err; return { win: null, move: null, nodes, complete: false }; }
    }

    function fromPieces(pieces) {
      const board = Array(90).fill(null);
      for (const [piece, row, col] of pieces) {
        if (!inside(row, col) || board[at(row, col)]) throw new Error('Invalid or duplicate position');
        board[at(row, col)] = piece;
      }
      return board;
    }

    function initialBoard() {
      const board = Array(90).fill(null);
      ['R', 'N', 'E', 'A', 'K', 'A', 'E', 'N', 'R'].forEach((p, c) => { board[c] = 'b' + p; board[81 + c] = 'r' + p; });
      [1, 7].forEach(c => { board[18 + c] = 'bC'; board[63 + c] = 'rC'; });
      [0, 2, 4, 6, 8].forEach(c => { board[27 + c] = 'bP'; board[54 + c] = 'rP'; });
      return board;
    }

    return { ROWS, COLS, at, other, pseudo, apply, inCheck, legalMoves, outcome, bestMove, solve, fromPieces, initialBoard };
  }

  root.createXiangqi = createXiangqi;
  root.Xiangqi = createXiangqi();
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Xiangqi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
