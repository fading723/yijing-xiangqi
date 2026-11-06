(function () {
  'use strict';
  const E = window.Xiangqi, levels = window.XiangqiLevels, chapters = window.XiangqiChapters;
  const $ = id => document.getElementById(id);
  const names = { rK: '帅', rA: '仕', rE: '相', rN: '马', rR: '车', rC: '炮', rP: '兵', bK: '将', bA: '士', bE: '象', bN: '马', bR: '车', bC: '炮', bP: '卒' };
  const numerals = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const SAVE_KEY = 'yijing-offline-v2', LEGACY_SAVE_KEY = 'yijing-offline-v1';
  let progress = Array(levels.length).fill(0), sessions = {}, mode = 'challenge', levelIndex = 0, selectedChapter = 0;
  let board, turn = 'r', history = [], selected = null, legalTargets = [], hintMove = null;
  let hintUsed = false, undoUsed = false, finished = null, busy = null, soundOn = false;
  let worker = null, workerUrl = null, jobId = 0, toastTimer, flashTimer, aiTimer, audioContext;
  let storageOK = true, focusSquare = 81;

  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.add('show');
    $('live-status').textContent = message;
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3200);
  }

  function playSound(kind) {
    if (!soundOn) return;
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      const notes = kind === 'win' ? [523, 659, 784] : kind === 'capture' ? [185, 130] : [380];
      notes.forEach((frequency, i) => {
        const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
        const start = audioContext.currentTime + i * .11;
        oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, start);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * .7, start + .15);
        gain.gain.setValueAtTime(.09, start); gain.gain.exponentialRampToValueAtTime(.001, start + .2);
        oscillator.connect(gain); gain.connect(audioContext.destination);
        oscillator.start(start); oscillator.stop(start + .21);
      });
    } catch (_) { /* Sound is optional; the game remains playable. */ }
  }

  function initial() { return mode === 'practice' ? E.initialBoard() : E.fromPieces(levels[levelIndex].pieces); }
  function isPuzzle() { return mode === 'challenge' && levels[levelIndex].kind === 'puzzle'; }
  function redMoves() { return history.filter(entry => entry.side === 'r').length; }
  function unlocked(index) { return index === 0 || progress[index - 1] > 0; }
  function starsForAttempt() { return 3 - Number(hintUsed) - Number(undoUsed); }

  function snapshot() {
    return { levelIndex, moves: history.map(h => h.move), hintUsed, undoUsed, finished };
  }

  function save() {
    sessions[mode] = snapshot();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 2, mode, progress, soundOn, difficulty: $('difficulty-select').value, sessions })); }
    catch (_) {
      storageOK = false;
      $('save-status').textContent = '浏览器未允许存档，本次仍可正常游玩';
    }
  }

  function readSave() {
    try {
      let data;
      for (const key of [SAVE_KEY, LEGACY_SAVE_KEY]) {
        try {
          const candidate = JSON.parse(localStorage.getItem(key) || 'null');
          if (candidate && [1, 2].includes(candidate.version)) { data = candidate; break; }
        } catch (_) { /* A corrupt new save can still fall back to the preserved old save. */ }
      }
      if (!data) return;
      if (Array.isArray(data.progress)) {
        progress = progress.map((_, i) => Number.isInteger(data.progress[i]) && data.progress[i] >= 0 && data.progress[i] <= 3 ? data.progress[i] : 0);
        for (let i = 1; i < progress.length; i++) if (!progress[i - 1]) progress[i] = 0;
      }
      soundOn = data.soundOn === true;
      mode = data.mode === 'practice' ? 'practice' : 'challenge';
      sessions = data.sessions && typeof data.sessions === 'object' ? data.sessions : {};
      if (['2', '3', '4'].includes(data.difficulty)) $('difficulty-select').value = data.difficulty;
    } catch (_) { /* Ignore malformed or unavailable saves. */ }
  }

  function restoreSession() {
    const data = sessions[mode];
    levelIndex = data && Number.isInteger(data.levelIndex) && data.levelIndex >= 0 && data.levelIndex < levels.length && (mode === 'practice' || unlocked(data.levelIndex)) ? data.levelIndex : progress.findIndex(s => s === 0);
    if (levelIndex < 0) levelIndex = 0;
    board = initial(); history = []; turn = 'r'; finished = null;
    hintUsed = data?.hintUsed === true; undoUsed = data?.undoUsed === true;
    if (data && Array.isArray(data.moves)) {
      for (const move of data.moves.slice(0, 10000)) {
        if (!move || !E.legalMoves(board, turn).some(m => m.from === move.from && m.to === move.to)) break;
        recordMove(move);
        if (determineEnd()) break;
      }
      finished = determineEnd();
      // The board is always rebuilt by replaying legal moves, not trusting saved arrays.
    }
    selected = null; legalTargets = []; hintMove = null;
    selectedChapter = levels[levelIndex].chapterIndex;
  }

  function cancelJob() {
    jobId++; clearTimeout(aiTimer);
    if (worker) { worker.terminate(); worker = null; }
    if (workerUrl) { URL.revokeObjectURL(workerUrl); workerUrl = null; }
    busy = null;
  }

  function startLevel(index) {
    if (!unlocked(index)) { toast('先完成上一关，就能开启这一段旅程。'); return; }
    cancelJob(); closeResults();
    mode = 'challenge'; levelIndex = index;
    selectedChapter = levels[index].chapterIndex;
    board = initial(); turn = 'r'; history = []; finished = null;
    hintUsed = false; undoUsed = false; selected = null; legalTargets = []; hintMove = null;
    save(); render();
  }

  function restart() {
    cancelJob(); closeResults();
    board = initial(); turn = 'r'; history = []; finished = null;
    hintUsed = false; undoUsed = false; selected = null; legalTargets = []; hintMove = null;
    save(); render(); toast('棋盘已摆好，再来一局。');
  }

  function switchMode(next) {
    if (mode === next) return;
    save(); cancelJob(); closeResults(); mode = next;
    restoreSession(); render(); save();
    if (finished) showResult(); else if (turn === 'b') queueComputer();
  }

  function notation(position, move) {
    const p = position[move.from], side = p[0], r = Math.floor(move.from / 9), c = move.from % 9;
    const nr = Math.floor(move.to / 9), nc = move.to % 9;
    const num = value => side === 'r' ? numerals[value - 1] : String(value);
    const file = col => side === 'r' ? 9 - col : col + 1;
    let prefix = names[p] + num(file(c));
    const twins = position.map((piece, index) => ({ piece, index })).filter(item => item.piece === p && item.index % 9 === c).sort((a, b) => side === 'r' ? a.index - b.index : b.index - a.index);
    if (twins.length === 2) prefix = (twins[0].index === move.from ? '前' : '后') + names[p];
    if (r === nr) return prefix + '平' + num(file(nc));
    const direction = (side === 'r' ? nr < r : nr > r) ? '进' : '退';
    return prefix + direction + num(['N', 'E', 'A'].includes(p[1]) ? file(nc) : Math.abs(nr - r));
  }

  function recordMove(move) {
    const entry = { move: { from: move.from, to: move.to }, side: turn, before: board.slice(), captured: board[move.to], piece: board[move.from], text: notation(board, move) };
    board = E.apply(board, move); turn = E.other(turn); entry.check = E.inCheck(board, turn); history.push(entry);
  }

  function repetitionResult() {
    const key = board.join(',') + turn;
    const positions = history.map(h => h.before.join(',') + h.side);
    const indices = positions.map((k, i) => k === key ? i : -1).filter(i => i >= 0);
    if (indices.length < 2) return null;
    const cycle = history.slice(indices[indices.length - 2]);
    const perpetual = ['r', 'b'].filter(side => {
      const moves = cycle.filter(h => h.side === side);
      return moves.length >= 2 && moves.every(h => h.check);
    });
    if (perpetual.length === 1) return { winner: E.other(perpetual[0]), reason: 'perpetual' };
    return { winner: null, reason: 'repetition' };
  }

  function determineEnd() {
    const end = E.outcome(board, turn);
    if (end) return end;
    if (isPuzzle() && redMoves() >= levels[levelIndex].moves) return { winner: 'b', reason: 'budget' };
    if (!isPuzzle()) {
      const repetition = repetitionResult();
      if (repetition) return repetition;
      if (history.length >= 120 && history.slice(-120).every(h => !h.captured)) return { winner: null, reason: 'quiet' };
    }
    return null;
  }

  function makeMove(move) {
    recordMove(move); selected = null; legalTargets = []; hintMove = null;
    const last = history[history.length - 1];
    playSound(last.captured ? 'capture' : 'move');
    finished = determineEnd();
    if (finished && finished.winner === 'r' && mode === 'challenge') progress[levelIndex] = Math.max(progress[levelIndex], starsForAttempt());
    save(); render();
    $('live-status').textContent = (last.side === 'r' ? '红方' : '黑方') + last.text + (last.check ? '，将军' : '');
    if (finished) { showResult(); return; }
    if (last.check) flashCheck();
    if (turn === 'b') queueComputer();
  }

  function flashCheck() {
    clearTimeout(flashTimer); $('board-flash').classList.add('show');
    flashTimer = setTimeout(() => $('board-flash').classList.remove('show'), 1000);
  }

  function chooseSquare(index) {
    if (finished) { showResult(); return; }
    if (busy || turn !== 'r') { toast(busy === 'hint' ? '正在推演，请稍等。' : '黑方正在思考，稍等片刻。'); return; }
    if (selected !== null && legalTargets.includes(index)) { makeMove({ from: selected, to: index }); return; }
    if (board[index]?.[0] === 'r') {
      selected = selected === index ? null : index;
      legalTargets = selected === null ? [] : E.legalMoves(board, 'r', selected).map(m => m.to);
      hintMove = null; renderBoard();
      if (selected !== null && !legalTargets.length) toast('这枚棋子暂时无路可走，试试别的棋子。');
      return;
    }
    if (selected !== null) toast(E.pseudo(board, selected).includes(index) ? '这步会让红帅被将军或将帅照面，换个位置吧。' : '这里走不到，亮起的小圆点才是可走位置。');
    else if (board[index]) toast('你执红方，先选一枚红色棋子。');
  }

  function computeJob(engine, data) {
    if (data.puzzle) {
      const solved = engine.solve(data.board, data.side, data.remaining, { maxNodes: 160000 });
      if (data.kind === 'hint' && solved.complete && !solved.win) return { move: null, noWin: true };
      if (solved.complete && solved.move) return { move: solved.move };
      return { move: engine.bestMove(data.board, data.side, { depth: 4, timeMs: 1200 }), estimated: true };
    }
    return { move: engine.bestMove(data.board, data.side, { ...data.ai, positions: data.positions }), strategic: true };
  }

  function runJob(kind, callback) {
    cancelJob(); busy = kind; const token = jobId;
    renderStatus();
    const level = levels[levelIndex];
    const practiceDepth = Number($('difficulty-select').value);
    const ai = mode === 'challenge' && !isPuzzle() ? level.ai : { depth: practiceDepth, maxNodes: [0, 0, 2400, 6200, 14500][practiceDepth], timeMs: practiceDepth === 4 ? 1450 : 900 };
    const hintAI = { depth: Math.max(4, ai.depth), maxNodes: Math.max(14500, ai.maxNodes), timeMs: 1700 };
    const payload = { mode, kind, puzzle: isPuzzle(), board: board.slice(), side: turn,
      remaining: isPuzzle() ? level.moves - redMoves() : null, ai: kind === 'hint' ? hintAI : ai,
      positions: history.map(h => h.before.join(',') + h.side) };
    const started = Date.now();
    const done = result => {
      if (token !== jobId) return;
      if (worker) worker.terminate(); worker = null;
      if (workerUrl) URL.revokeObjectURL(workerUrl); workerUrl = null;
      const delay = kind === 'ai' ? Math.max(0, 360 - (Date.now() - started)) : 0;
      aiTimer = setTimeout(() => { if (token !== jobId) return; busy = null; callback(result); renderStatus(); }, delay);
    };
    const fallback = () => {
      if (worker) worker.terminate(); worker = null;
      if (workerUrl) URL.revokeObjectURL(workerUrl); workerUrl = null;
      aiTimer = setTimeout(() => { if (token === jobId) done(computeJob(E, payload)); }, 40);
    };
    try {
      const source = 'const engine = (' + window.createXiangqi.toString() + ')(); const compute = ' + computeJob.toString() + '; self.onmessage = event => { self.postMessage(compute(engine, event.data)); };';
      workerUrl = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
      worker = new Worker(workerUrl); worker.onmessage = event => done(event.data); worker.onerror = event => { event.preventDefault(); fallback(); }; worker.postMessage(payload);
    } catch (_) { fallback(); }
  }

  function queueComputer() {
    runJob('ai', result => {
      const move = result.move;
      if (move && E.legalMoves(board, 'b').some(m => m.from === move.from && m.to === move.to)) makeMove(move);
      else { finished = determineEnd(); render(); if (finished) showResult(); else toast('电脑未能完成计算，请悔棋后重试。'); }
    });
  }

  function hint() {
    if (finished || turn !== 'r' || busy) return;
    runJob('hint', result => {
      if (!result.move) { toast('当前局面已无法在剩余步数内必胜，试试悔棋或重新开始。'); return; }
      hintUsed = true; hintMove = result.move; selected = result.move.from;
      legalTargets = E.legalMoves(board, 'r', selected).map(m => m.to);
      save(); renderBoard();
      $('insight-text').textContent = (result.strategic || result.estimated ? '建议走法：' : '试着走：') + notation(board, result.move) + (result.strategic ? '。沿着金色箭头落子，再观察黑方的应手，继续组织攻守。' : '。沿着棋盘上的金色箭头，想一想它封住了哪条路。');
      toast('提示已亮起，点击箭头指向的位置即可落子。');
    });
  }

  function undo() {
    if (!history.length) return;
    cancelJob(); closeResults();
    let target = history.length - 1;
    while (target > 0 && history[target].side !== 'r') target--;
    board = history[target].before.slice(); history = history.slice(0, target); turn = 'r';
    finished = null; undoUsed = true; selected = null; legalTargets = []; hintMove = null;
    save(); render(); toast('已回到你上一次落子之前。');
  }

  function buildBoard() {
    let svg = '<rect x="41" y="43" width="458" height="514" fill="none" stroke-width="1.5"/>';
    for (let r = 0; r < 10; r++) svg += `<path d="M46 ${48 + r * 56} H494"/>`;
    for (let c = 0; c < 9; c++) {
      const x = 46 + c * 56;
      svg += `<path d="M${x} 48 V${c === 0 || c === 8 ? 552 : 272}${c > 0 && c < 8 ? ` M${x} 328 V552` : ''}"/>`;
    }
    svg += '<path d="M214 48 326 160 M326 48 214 160 M214 440 326 552 M326 440 214 552"/>';
    for (const r of [2, 3, 6, 7]) for (const c of r === 2 || r === 7 ? [1, 7] : [0, 2, 4, 6, 8]) {
      const x = 46 + c * 56, y = 48 + r * 56;
      for (const dy of [-1, 1]) for (const dx of [-1, 1]) {
        if ((c === 0 && dx === -1) || (c === 8 && dx === 1)) continue;
        svg += `<path d="M${x + 5 * dx} ${y + 14 * dy} V${y + 5 * dy} H${x + 14 * dx}" stroke-width=".9"/>`;
      }
    }
    svg += '<text class="river-text" x="158" y="310" text-anchor="middle">楚河</text><text class="river-text" x="395" y="310" text-anchor="middle">漢界</text><path class="river-decoration" d="M254 297q8-7 16 0t16 0M254 303q8-7 16 0t16 0"/>';
    for (let c = 0; c < 9; c++) svg += `<text class="coordinate" x="${46 + c * 56}" y="25" text-anchor="middle">${c + 1}</text><text class="coordinate" x="${46 + c * 56}" y="582" text-anchor="middle">${numerals[8 - c]}</text>`;
    $('board-art').innerHTML = svg;
    for (let i = 0; i < 90; i++) {
      const button = document.createElement('button');
      button.className = 'board-square'; button.dataset.index = i;
      button.style.left = (46 + i % 9 * 56) / 540 * 100 + '%';
      button.style.top = (48 + Math.floor(i / 9) * 56) / 600 * 100 + '%';
      button.addEventListener('click', () => { focusSquare = i; chooseSquare(i); });
      button.addEventListener('keydown', event => {
        const deltas = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 };
        if (!(event.key in deltas)) return;
        event.preventDefault();
        const next = i + deltas[event.key];
        if (next < 0 || next >= 90 || (event.key === 'ArrowLeft' && i % 9 === 0) || (event.key === 'ArrowRight' && i % 9 === 8)) return;
        focusSquare = next; renderBoard(); $('board-squares').children[next].focus();
      });
      $('board-squares').appendChild(button);
    }
  }

  function renderBoard() {
    const last = history[history.length - 1]?.move;
    const checkedKing = E.inCheck(board, turn) ? board.indexOf(turn + 'K') : -1;
    Array.from($('board-squares').children).forEach((button, index) => {
      const piece = board[index];
      button.className = 'board-square' + (piece ? ' occupied' : '') + (selected === index ? ' selected' : '') + (legalTargets.includes(index) ? ' legal' : '') + (last && (last.from === index || last.to === index) ? ' last-move' : '') + (hintMove?.from === index ? ' hint-from' : '') + (checkedKing === index ? ' in-check' : '');
      button.innerHTML = piece ? `<span class="piece ${piece[0] === 'r' ? 'red' : 'black'}">${names[piece]}</span>` : '';
      button.setAttribute('aria-label', `${piece ? (piece[0] === 'r' ? '红' : '黑') + names[piece] : '空位'}，第${Math.floor(index / 9) + 1}行第${index % 9 + 1}列${legalTargets.includes(index) ? '，可落子' : ''}`);
      button.setAttribute('aria-pressed', selected === index ? 'true' : 'false');
      button.tabIndex = focusSquare === index ? 0 : -1;
    });
    if (hintMove) {
      const x1 = 46 + hintMove.from % 9 * 56, y1 = 48 + Math.floor(hintMove.from / 9) * 56;
      const x2 = 46 + hintMove.to % 9 * 56, y2 = 48 + Math.floor(hintMove.to / 9) * 56;
      const length = Math.hypot(x2 - x1, y2 - y1), dx = (x2 - x1) / length, dy = (y2 - y1) / length;
      $('hint-path').setAttribute('d', `M${x1 + dx * 28} ${y1 + dy * 28} L${x2 - dx * 12} ${y2 - dy * 12}`);
    } else $('hint-path').setAttribute('d', '');
    $('board-tip').textContent = finished ? '本局已结束 · 点击棋盘查看结果' : selected === null ? '点选棋子，开始破局' : '点击亮点，落子无悔';
  }

  function renderJourney() {
    $('level-list').innerHTML = '';
    const chapter = chapters[selectedChapter];
    $('chapter-select').value = String(selectedChapter);
    $('chapter-badge').textContent = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾'][selectedChapter];
    $('chapter-description').textContent = chapter.subtitle;
    $('chapter-page').textContent = `${selectedChapter + 1} / ${chapters.length} 章`;
    $('previous-chapter').disabled = selectedChapter === 0;
    $('next-chapter').disabled = selectedChapter === chapters.length - 1;
    levels.forEach((level, index) => {
      if (level.chapterIndex !== selectedChapter) return;
      const button = document.createElement('button'), locked = !unlocked(index);
      button.className = 'level-button' + (mode === 'challenge' && levelIndex === index ? ' active' : '') + (locked ? ' locked' : '');
      button.setAttribute('aria-label', `第${index + 1}关 ${level.title}${locked ? '，未解锁' : progress[index] ? '，已获' + progress[index] + '星' : ''}`);
      button.setAttribute('aria-current', mode === 'challenge' && levelIndex === index ? 'step' : 'false');
      button.setAttribute('aria-disabled', locked ? 'true' : 'false');
      button.innerHTML = `<span class="level-number">${String(index + 1).padStart(2, '0')}</span><span><span class="level-name">${level.title}</span>${progress[index] ? `<span class="level-stars">${'✦'.repeat(progress[index])}${'·'.repeat(3 - progress[index])}</span>` : ''}</span>${locked ? '<svg class="level-lock"><use href="#i-lock"/></svg>' : ''}`;
      button.addEventListener('click', () => {
        if (mode === 'challenge' && levelIndex === index) { if (finished) showResult(); return; }
        if (mode === 'practice') save();
        startLevel(index);
      });
      $('level-list').appendChild(button);
    });
    const completed = progress.filter(s => s > 0).length;
    $('completed-count').textContent = String(completed).padStart(2, '0');
    $('star-count').innerHTML = String(progress.reduce((a, b) => a + b, 0)).padStart(2, '0') + `<span> / ${levels.length * 3}</span>`;
    $('progress-label').textContent = `${completed} / ${levels.length}`;
    $('progress-fill').style.width = completed / levels.length * 100 + '%';
  }

  function renderStatus() {
    const thinking = busy === 'ai';
    const checked = !finished && E.inCheck(board, turn);
    const label = finished ? finished.winner === 'r' ? '红方获胜' : finished.winner === 'b' ? (finished.reason === 'budget' ? '再试一局' : '黑方获胜') : '此局和棋' : busy === 'hint' ? '正在推演' : thinking ? '黑方思考中' : checked ? '红方被将军' : history.length ? '轮到你落子' : '红方先行';
    $('turn-label').className = 'turn-label' + (busy ? ' thinking' : '');
    $('turn-label').innerHTML = `<span class="turn-dot"></span><strong>${label}</strong><span>${finished ? '棋局已结束' : '你执红棋'}</span>`;
    $('undo-button').disabled = history.length === 0;
    $('hint-button').disabled = !!finished || turn !== 'r' || !!busy;
    $('hint-button').innerHTML = '<svg><use href="#i-bulb"/></svg>' + (busy === 'hint' ? '推演中…' : '给点提示');
    $('sound-button').setAttribute('aria-label', soundOn ? '关闭音效' : '开启音效');
    $('sound-button').setAttribute('aria-pressed', String(soundOn));
    $('sound-button').innerHTML = `<svg><use href="#${soundOn ? 'i-sound' : 'i-mute'}"/></svg>`;
  }

  function render() {
    const level = levels[levelIndex], practice = mode === 'practice';
    $('challenge-tab').classList.toggle('active', !practice); $('practice-tab').classList.toggle('active', practice);
    $('challenge-tab').setAttribute('aria-pressed', String(!practice)); $('practice-tab').setAttribute('aria-pressed', String(practice));
    $('board-mode').textContent = practice ? '自由对弈' : isPuzzle() ? '杀法入门' : '实战闯关 · 不限步数';
    $('level-number').textContent = practice ? '一局闲棋' : '第 ' + String(level.id).padStart(2, '0') + ' 关';
    const difficulty = practice ? Number($('difficulty-select').value) - 1 : Math.min(3, Math.floor(level.chapterIndex / 3) + 1);
    $('difficulty').innerHTML = [1, 2, 3].map(i => `<i class="${i <= difficulty ? 'lit' : ''}"></i>`).join('') + ' ' + (practice ? ['入门', '进阶', '挑战'][difficulty - 1] : chapters[level.chapterIndex].rank);
    $('level-title').textContent = practice ? '闲来一局棋' : level.title;
    $('theme-tag').textContent = practice ? '完整棋局' : level.theme;
    $('level-intro').textContent = practice ? '摆好三十二枚棋子，与电脑从容切磋。没有步数限制，尽情探索。' : level.intro;
    $('objective-text').textContent = isPuzzle() ? `${level.moves} 步内击败黑方` : '击败黑方 · 不限步数';
    $('objective-note').textContent = isPuzzle() ? '红方走一次计为一步' : '将死或困毙黑方即可获胜';
    $('battle-note').hidden = practice || isPuzzle();
    $('move-count').textContent = redMoves(); $('move-limit').textContent = isPuzzle() ? ' / ' + level.moves : ' 步 · 不限';
    $('budget-dots').innerHTML = !isPuzzle() ? '' : Array.from({ length: level.moves }, (_, i) => `<span class="${i < redMoves() ? 'used' : ''}"></span>`).join('');
    $('rating-rule').hidden = practice; $('practice-settings').hidden = !practice;
    $('insight-text').textContent = practice ? '开局先出动马、炮，保持子力联系。进攻之前，别忘了照看自己的帅。' : level.lesson;
    $('history-count').textContent = history.length + ' 手';
    if (!history.length) $('move-history').innerHTML = '<div class="empty-history"><span>—</span><p>好棋，从第一步开始</p></div>';
    else {
      let html = '';
      for (let i = 0; i < history.length; i += 2) html += `<div class="move-row"><span>${i / 2 + 1}</span><span class="red-move">${history[i].text}${history[i].check ? ' +' : ''}</span><span class="black-move">${history[i + 1] ? history[i + 1].text + (history[i + 1].check ? ' +' : '') : '…'}</span></div>`;
      $('move-history').innerHTML = html; $('move-history').scrollTop = $('move-history').scrollHeight;
    }
    if (storageOK) $('save-status').innerHTML = '<svg><use href="#i-check"/></svg>进度自动保存在此浏览器';
    renderJourney(); renderBoard(); renderStatus();
  }

  function closeResults() { if ($('result-dialog').open) $('result-dialog').close(); clearTimeout(flashTimer); $('board-flash').classList.remove('show'); }

  function showResult() {
    if (!finished) return;
    const won = finished.winner === 'r', draw = finished.winner === null, practice = mode === 'practice';
    const finalLevel = levelIndex === levels.length - 1;
    $('result-seal').textContent = won ? '胜' : draw ? '和' : '弈';
    $('result-seal').classList.toggle('loss', !won);
    $('result-eyebrow').textContent = won ? 'A BEAUTIFUL MOVE' : draw ? 'A MOMENT OF BALANCE' : 'EVERY MOVE IS A NEW START';
    $('result-title').textContent = won ? (practice ? '好棋，你赢了。' : finalLevel ? '百关棋旅，已通关。' : isPuzzle() ? '此局，已破。' : '稳扎稳打，赢下此局。') : draw ? '平分秋色。' : '别急，再想一步。';
    $('result-stars').hidden = !won || practice;
    $('result-stars').innerHTML = [1, 2, 3].map(i => `<span class="${i <= starsForAttempt() ? '' : 'dim'}">✦</span>`).join(' ');
    const reasons = { budget: `已用完 ${levels[levelIndex].moves} 步，还没封住黑方的退路。可以悔棋，或重新布置进攻。`, checkmate: '帅已被将死。观察对方的威胁，下一局会更从容。', stalemate: '已无合法走法。象棋中无子可动也判负，记得为帅留一条路。', perpetual: '连续将军造成第三次局面重复，将军方判负。试着换一种进攻。', repetition: '局面第三次重复，本局和棋。', quiet: '连续 120 手没有吃子，本局和棋。', capture: '本局已结束，再来试试新的走法。' };
    $('result-message').textContent = won ? (practice ? `你用了 ${redMoves()} 步赢下这局。` : `用了 ${redMoves()} 步，点亮 ${starsForAttempt()} 颗星。${finalLevel ? '100 关旅程已经完成。' : '下一关已解锁。'}`) : reasons[finished.reason] + (draw && !practice ? ' 获胜才能解锁下一关，可以悔棋换个思路。' : '');
    $('result-lesson').textContent = practice ? '每一局都有新的风景。可以调整电脑棋力，再来一盘；也可以回到残局闯关，练习经典杀法。' : levels[levelIndex].lesson;
    $('next-button').innerHTML = (won && !practice ? finalLevel ? '回到第一关' : '继续下一关' : '重新挑战') + '<svg><use href="#i-arrow"/></svg>';
    $('retry-button').textContent = won ? '再品一局' : history.length ? '悔一步，再试试' : '回到棋盘';
    if (!$('result-dialog').open) { $('result-dialog').showModal(); if (won) playSound('win'); }
  }

  $('challenge-tab').addEventListener('click', () => switchMode('challenge'));
  $('practice-tab').addEventListener('click', () => switchMode('practice'));
  $('undo-button').addEventListener('click', undo); $('hint-button').addEventListener('click', hint); $('restart-button').addEventListener('click', restart);
  $('help-button').addEventListener('click', () => $('help-dialog').showModal());
  $('sound-button').addEventListener('click', () => { soundOn = !soundOn; save(); renderStatus(); if (soundOn) playSound('move'); });
  $('difficulty-select').addEventListener('change', () => { save(); render(); if (turn === 'b' && !finished) queueComputer(); toast('电脑棋力已更新。'); });
  $('chapter-select').addEventListener('change', () => { selectedChapter = Number($('chapter-select').value); renderJourney(); });
  $('previous-chapter').addEventListener('click', () => { if (selectedChapter > 0) selectedChapter--; renderJourney(); });
  $('next-chapter').addEventListener('click', () => { if (selectedChapter < chapters.length - 1) selectedChapter++; renderJourney(); });
  $('continue-journey').addEventListener('click', () => { if (mode === 'practice') switchMode('challenge'); selectedChapter = levels[levelIndex].chapterIndex; renderJourney(); });
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  $('next-button').addEventListener('click', () => { if (finished?.winner === 'r' && mode === 'challenge') startLevel((levelIndex + 1) % levels.length); else restart(); });
  $('retry-button').addEventListener('click', () => { if (finished?.winner === 'r') restart(); else if (history.length) undo(); else closeResults(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { selected = null; legalTargets = []; hintMove = null; renderBoard(); } });
  window.addEventListener('pagehide', save);
  $('chapter-select').innerHTML = chapters.map((chapter, index) => `<option value="${index}">${String(index + 1).padStart(2, '0')} · ${chapter.title}（${index * 10 + 1}–${Math.min(levels.length, (index + 1) * 10)}）</option>`).join('');
  readSave(); buildBoard(); restoreSession(); render(); save();
  if (finished) showResult(); else if (turn === 'b') queueComputer();
})();
