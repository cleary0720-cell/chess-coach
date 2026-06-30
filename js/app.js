// Main game controller for index.html

const SKILL_ELO = [
  200, 400, 600,                                              // 0-2  new beginner levels
  800, 900, 1000, 1100, 1200, 1300, 1400, 1500,             // 3-10
  1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300,           // 11-18
  2400, 2500, 2600, 2700, 3000,                              // 19-23
];

function getSFSkill(level) {
  if (level <= 2) return 0;          // all beginner levels use SF skill 0
  return Math.min(20, level - 3);   // level 3→SF0, level 4→SF1, ..., level 23→SF20
}

function getMoveTime(level) {
  if (level === 0) return 75;
  if (level === 1) return 250;
  if (level === 2) return 600;
  return 1500;
}

let chess            = new Chess();
let board            = null;
let sfWorker         = null;
let playerColor      = 'white';
let skillLevel       = 10;
let gameActive       = false;
let focusTechnique   = null;
let selectedOpening  = null;

// Per-game tracking
let moveLog     = [];          // [{san, uci, fenBefore, fenAfter, evalBefore, evalAfter, cpLoss, quality, coaching}]
let moveHistory = [];          // UCI strings from startpos (for engine)
let pendingAnalysis = null;    // { fenBefore, userMove, fenAfter, moveNum }
let evalBefore  = null;        // centipawn score before user's move (white POV)
let analysisPhase = 'idle';    // 'idle' | 'pre' | 'post'
let gameId      = null;

function init() {
  const settings = Storage.getSettings();
  skillLevel  = settings.skillLevel;
  playerColor = settings.playerColor === 'random'
    ? (Math.random() < 0.5 ? 'white' : 'black')
    : settings.playerColor;

  chess = new Chess();
  board = new ChessBoard('board', chess, {
    onMove: handleUserMove,
    flipped: playerColor === 'black',
  });

  sfWorker = new Worker('js/stockfish-worker.js');
  sfWorker.onmessage = handleWorkerMsg;
  sfWorker.postMessage({ cmd: 'init' });
  sfWorker.postMessage({ cmd: 'setSkill', payload: { level: skillLevel } });

  gameId      = Date.now().toString();
  moveLog     = [];
  moveHistory = [];
  gameActive  = true;
  analysisPhase = 'idle';
  updateUndoBtn();

  updateSkillLabel();
  renderMoveHistory();
  updateTurnIndicator();
  document.getElementById('coachContent').innerHTML = `
    <div class="empty-state" style="padding:16px 0">
      <div class="icon">🎓</div>
      <p>Make your first move to start receiving coaching.</p>
    </div>`;

  // If engine plays first (player is black)
  if (playerColor === 'black') {
    gameActive = true;
    board.setInteractive(false);
    setTimeout(engineMove, 400);
  }
}

function handleWorkerMsg(event) {
  const msg = event.data;

  // Parse score from info lines
  if (msg.type === 'output' && msg.line.includes('score')) {
    const cpMatch   = msg.line.match(/score cp (-?\d+)/);
    const mateMatch = msg.line.match(/score mate (-?\d+)/);
    let score = null;
    if (cpMatch)   score = parseInt(cpMatch[1]);
    if (mateMatch) score = parseInt(mateMatch[1]) > 0 ? 9999 : -9999;

    if (score !== null) {
      if (analysisPhase === 'pre') evalBefore = score;
      updateEvalBar(score);
    }
  }

  if (msg.type === 'bestmove') {
    if (analysisPhase === 'pre') {
      // We have the best move and score before user's move.
      pendingAnalysis.bestMoveFromPre = msg.bestMove;
      // Now analyze the position AFTER the user's move.
      analysisPhase = 'post';
      sfWorker.postMessage({
        cmd: 'analyzePosition',
        payload: { fen: pendingAnalysis.fenAfter, depth: 10 },
      });
    } else if (analysisPhase === 'post') {
      // We now have eval after user's move.
      analysisPhase = 'idle';
      const bestMoveUCI = pendingAnalysis.bestMoveFromPre;
      const evalAfterVal = parseLastScore(msg.infoLines);
      finishMoveAnalysis(bestMoveUCI, evalAfterVal);
    } else if (analysisPhase === 'suggest') {
      analysisPhase = 'idle';
      handleSuggestion(msg.bestMove);
    } else {
      // Engine's reply move
      const engineMoveUCI = msg.bestMove;
      if (engineMoveUCI && engineMoveUCI !== '(none)') {
        const move = board.applyMove(engineMoveUCI);
        if (move) {
          moveHistory.push(engineMoveUCI);
          updateTurnIndicator();
          checkGameEnd();
          if (gameActive) {
            board.setInteractive(true);
            // Start pre-move analysis for upcoming user move
          }
        }
      }
    }
  }
}

function parseLastScore(infoLines) {
  for (let i = infoLines.length - 1; i >= 0; i--) {
    const cpMatch   = infoLines[i].match(/score cp (-?\d+)/);
    const mateMatch = infoLines[i].match(/score mate (-?\d+)/);
    if (cpMatch)   return parseInt(cpMatch[1]);
    if (mateMatch) return parseInt(mateMatch[1]) > 0 ? 9999 : -9999;
  }
  return 0;
}

function handleUserMove(move) {
  if (!gameActive) return;

  const uci = move.from + move.to + (move.promotion || '');
  moveHistory.push(uci);
  updateTurnIndicator();

  const fenAfter = chess.fen();
  const moveNum  = Math.ceil(moveHistory.length / 2);

  pendingAnalysis = {
    fenBefore:     move.before || null, // set below
    fenAfter,
    userMove:      move,
    moveNum,
    bestMoveFromPre: null,
  };

  // Show thinking indicator
  showThinking();

  // Get the FEN before the move — we need to undo and redo
  chess.undo();
  const fenBefore = chess.fen();
  chess.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });

  pendingAnalysis.fenBefore = fenBefore;

  // Phase 1: analyze position BEFORE user's move to get best move + score
  analysisPhase = 'pre';
  sfWorker.postMessage({
    cmd: 'analyzePosition',
    payload: { fen: fenBefore, depth: 12 },
  });

  if (checkGameEnd()) return;
}

function finishMoveAnalysis(bestMoveUCIFromPre, evalAfterVal) {
  if (!pendingAnalysis) return;

  const { fenBefore, fenAfter, userMove, moveNum } = pendingAnalysis;
  const userUCI = userMove.from + userMove.to + (userMove.promotion || '');

  // cpLoss: from the perspective of the player who moved
  // evalBefore is white's POV; flip for black
  const mult = (userMove.color === 'w') ? 1 : -1;
  const evalB = (evalBefore ?? 0) * mult;

  // Store best move from pre-analysis
  pendingAnalysis.bestMoveFromPre = bestMoveUCIFromPre;

  // evalAfter is from the side that just moved *against* us — it's opponent's turn now
  // So from the player's POV: evalAfter should also be flipped (opponent just got the position)
  const evalA = evalAfterVal * mult * -1;

  const cpLoss = Math.max(0, Math.min(evalB - evalA, 500));
  const quality = classifyMove(cpLoss);

  // Best move in SAN
  let bestMoveSAN = bestMoveUCIFromPre;
  try {
    const tmp = new Chess(fenBefore);
    const bm = tmp.move({ from: bestMoveUCIFromPre.slice(0,2), to: bestMoveUCIFromPre.slice(2,4), promotion: bestMoveUCIFromPre[4] || 'q' });
    if (bm) bestMoveSAN = bm.san;
  } catch(e) {}

  const entry = {
    san:       userMove.san,
    uci:       userUCI,
    fenBefore,
    fenAfter,
    evalBefore: evalBefore ?? 0,
    evalAfter: evalAfterVal,
    cpLoss,
    quality:   quality.label,
    qualityCls: quality.cls,
    symbol:    quality.symbol,
    bestMoveUCI: bestMoveUCIFromPre,
    bestMoveSAN,
    moveNum,
    coaching:  null,
    playerColor: userMove.color === 'w' ? 'white' : 'black',
  };

  moveLog.push(entry);
  renderMoveHistory();
  updateUndoBtn();

  // Show coaching card immediately with quality, then fetch Claude
  renderCoachingCard(entry, null, true);

  getCoaching({
    moveNumber:   moveNum,
    playerColor:  entry.playerColor,
    userMoveSAN:  userMove.san,
    userMoveUCI:  userUCI,
    bestMoveSAN,
    bestMoveUCI:  bestMoveUCIFromPre,
    cpLoss,
    quality:      quality.label,
    fenBefore,
    fenAfter,
    phase:        gamePhase(moveNum),
    focusTechnique,
    selectedOpening,
  }).then(text => {
    entry.coaching = text;
    renderCoachingCard(entry, text, false);
  }).catch(() => {
    renderCoachingCard(entry, 'Analysis complete.', false);
  });

  pendingAnalysis = null;

  // Engine's turn
  if (gameActive) {
    board.setInteractive(false);
    setTimeout(engineMove, 300);
  }
}

function engineMove() {
  if (!gameActive) return;
  sfWorker.postMessage({
    cmd: 'makeMove',
    payload: { moves: moveHistory.join(' '), skillLevel: getSFSkill(skillLevel), movetime: getMoveTime(skillLevel) },
  });
}

function checkGameEnd() {
  if (chess.game_over()) {
    gameActive = false;
    board.setInteractive(false);

    let result, title;
    if (chess.in_checkmate()) {
      const winner = chess.turn() === 'w' ? 'Black' : 'White';
      result = (winner.toLowerCase() === playerColor) ? 'win' : 'loss';
      title = winner + ' wins by checkmate!';
    } else if (chess.in_stalemate()) {
      result = 'draw'; title = 'Draw by stalemate';
    } else if (chess.in_threefold_repetition()) {
      result = 'draw'; title = 'Draw by repetition';
    } else if (chess.insufficient_material()) {
      result = 'draw'; title = 'Draw — insufficient material';
    } else {
      result = 'draw'; title = 'Draw';
    }

    showGameEnd(title, result);
    return true;
  }
  return false;
}

function showGameEnd(title, result) {
  const userMoves = moveLog.filter(m => m.playerColor === playerColor);
  const acpl = userMoves.length
    ? Math.round(userMoves.reduce((s,m) => s+m.cpLoss, 0) / userMoves.length)
    : 0;
  const accuracy = Math.round(acplToAccuracy(acpl) * 10) / 10;
  const blunders  = userMoves.filter(m => m.cpLoss > 200).length;
  const mistakes  = userMoves.filter(m => m.cpLoss > 100 && m.cpLoss <= 200).length;

  const stats = Storage.getStats();
  const prevElo = stats.estimatedElo;

  // Save game
  Storage.saveGame({
    id: gameId,
    date: new Date().toISOString(),
    result,
    playerColor,
    skillLevel,
    pgn: chess.pgn(),
    moves: moveLog,
    acpl,
    accuracy,
    blunders,
    mistakes,
    inaccuracies: userMoves.filter(m => m.cpLoss > 50 && m.cpLoss <= 100).length,
    eloAfter: Storage.getStats().estimatedElo,
  });

  const newStats = Storage.getStats();

  document.getElementById('gameEndTitle').textContent = title;
  document.getElementById('geAccuracy').textContent  = accuracy + '%';
  document.getElementById('geACPL').textContent      = acpl;
  document.getElementById('geBlunders').textContent  = blunders;
  document.getElementById('geMistakes').textContent  = mistakes;

  const eloEl = document.getElementById('geEloChange');
  if (newStats.estimatedElo && prevElo) {
    const diff = newStats.estimatedElo - prevElo;
    eloEl.textContent = `Estimated ELO: ${newStats.estimatedElo} (${diff >= 0 ? '+' : ''}${diff})`;
  } else if (newStats.estimatedElo) {
    eloEl.textContent = `Estimated ELO: ${newStats.estimatedElo}`;
  } else {
    eloEl.textContent = 'Play 3+ games to unlock ELO estimate.';
  }

  document.getElementById('gameEndModal').style.display = 'flex';
}

function resignGame() {
  if (!gameActive) return;
  showGameEnd('You resigned.', 'loss');
  gameActive = false;
  board.setInteractive(false);
}

function newGame() {
  if (sfWorker) { sfWorker.postMessage({ cmd: 'stop' }); sfWorker.terminate(); }
  init();
}

function closeModal() {
  document.getElementById('gameEndModal').style.display = 'none';
}

function setColor(color, btn) {
  document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  Storage.saveSettings({ playerColor: color });
}

function updateSkillLabel() {
  skillLevel = parseInt(document.getElementById('skillSlider').value);
  Storage.saveSettings({ skillLevel });
  document.getElementById('skillLabel').textContent = '~' + SKILL_ELO[skillLevel] + ' ELO';
  if (sfWorker) sfWorker.postMessage({ cmd: 'setSkill', payload: { level: getSFSkill(skillLevel) } });
}

function updateTurnIndicator() {
  const turn = chess.turn();
  const dot  = document.getElementById('turnDot');
  const text = document.getElementById('turnText');
  dot.className = 'turn-dot ' + (turn === 'w' ? 'white' : 'black');
  if (chess.game_over()) {
    text.textContent = 'Game over';
  } else if (chess.in_check()) {
    text.textContent = (turn === 'w' ? 'White' : 'Black') + ' is in check!';
  } else {
    text.textContent = (turn === 'w' ? 'White' : 'Black') + ' to move';
  }
}

function updateEvalBar(score) {
  const clamped = Math.max(-1000, Math.min(1000, score));
  const pct = 50 + (clamped / 1000) * 50; // 0–100, 50 = equal
  document.getElementById('evalBarFill').style.width = pct + '%';
  const display = score > 9000 ? 'M' : score < -9000 ? '-M' : (score / 100).toFixed(1);
  document.getElementById('evalLabel').textContent = score >= 0 ? '+' + display : display;
}

function showThinking() {
  document.getElementById('coachContent').innerHTML = `
    <div class="thinking">
      <span>Analyzing</span>
      <div class="dots"><span></span><span></span><span></span></div>
    </div>`;
}

function renderCoachingCard(entry, coachText, loading) {
  const q = { label: entry.quality, cls: entry.qualityCls, symbol: entry.symbol };
  const bestBtn = entry.bestMoveUCI !== entry.uci
    ? `<button class="btn btn-secondary btn-sm" onclick="board.flashBestMove('${entry.bestMoveUCI}')">Show best move</button>`
    : '';

  document.getElementById('coachContent').innerHTML = `
    <div class="coaching-card">
      <div class="move-badge quality-${q.cls}">
        ${q.symbol ? q.symbol + ' ' : ''}${q.label}
        <span style="font-weight:400;color:inherit;opacity:0.7">${entry.cpLoss}cp loss</span>
      </div>
      <div class="coach-text">
        ${loading
          ? '<div class="thinking"><span>Getting coaching</span><div class="dots"><span></span><span></span><span></span></div></div>'
          : (coachText || '')
        }
      </div>
      ${entry.bestMoveUCI !== entry.uci ? `
        <div class="best-move-row">
          Best: <strong>${sanToEnglish(entry.bestMoveSAN)}</strong>
          ${bestBtn}
        </div>` : ''}
    </div>`;
}

function renderMoveHistory() {
  const el = document.getElementById('moveHistory');
  if (!moveLog.length) { el.innerHTML = ''; return; }

  let html = '';
  for (let i = 0; i < moveLog.length; i += 2) {
    const w = moveLog[i];
    const b = moveLog[i + 1];
    const num = Math.floor(i / 2) + 1;
    html += `<div class="move-pair">
      <span class="move-num">${num}.</span>
      <span class="move-san" onclick="showMoveCoaching(${i})">${w.san}<span class="symbol" style="color:var(--${w.qualityCls || 'text'})">${w.symbol}</span></span>
      ${b ? `<span class="move-san" onclick="showMoveCoaching(${i+1})">${b.san}<span class="symbol" style="color:var(--${b.qualityCls || 'text'})">${b.symbol}</span></span>` : ''}
    </div>`;
  }
  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}

function showMoveCoaching(idx) {
  const entry = moveLog[idx];
  if (!entry) return;
  renderCoachingCard(entry, entry.coaching, false);
}

function suggestMove() {
  if (!gameActive || analysisPhase !== 'idle') return;
  const btn = document.getElementById('suggestBtn');
  if (btn) { btn.disabled = true; btn.textContent = '💡 Thinking…'; }
  analysisPhase = 'suggest';
  sfWorker.postMessage({ cmd: 'analyzePosition', payload: { fen: chess.fen(), depth: 12 } });
}

function handleSuggestion(uci) {
  const btn = document.getElementById('suggestBtn');
  if (btn) { btn.disabled = false; btn.textContent = '💡 Suggest a Move'; }
  if (!uci || uci === '(none)') return;

  board.flashBestMove(uci, 7000);

  // Extract piece info explicitly so Claude doesn't have to guess from FEN
  const fromSq = uci.slice(0, 2);
  const toSq   = uci.slice(2, 4);
  const pieceObj = chess.get(fromSq);
  const PNAMES = {k:'King', q:'Queen', r:'Rook', b:'Bishop', n:'Knight', p:'Pawn'};
  const pieceName = pieceObj ? PNAMES[pieceObj.type] : 'piece';

  let moveSAN = uci;
  try {
    const tmp = new Chess(chess.fen());
    const m = tmp.move({ from: fromSq, to: toSq, promotion: uci[4] || 'q' });
    if (m) moveSAN = m.san;
  } catch(e) {}

  document.getElementById('coachContent').innerHTML = `
    <div class="coaching-card">
      <div class="move-badge" style="background:rgba(83,52,131,0.25);color:#a78bfa;margin-bottom:10px">💡 Suggested Move</div>
      <div class="coach-text">
        <div class="thinking"><span>Getting explanation</span><div class="dots"><span></span><span></span><span></span></div></div>
      </div>
    </div>`;

  getSuggestionCoaching({
    uci, moveSAN, pieceName, fromSq, toSq,
    playerColor,
    phase: gamePhase(Math.ceil(moveHistory.length / 2)),
  }).then(text => {
    document.getElementById('coachContent').innerHTML = `
      <div class="coaching-card">
        <div class="move-badge" style="background:rgba(83,52,131,0.25);color:#a78bfa;margin-bottom:10px">💡 Suggested Move</div>
        <div class="coach-text">${text}</div>
        <div class="best-move-row" style="margin-top:10px">
          <button class="btn btn-secondary btn-sm" onclick="board.flashBestMove('${uci}',5000)">Show again</button>
        </div>
      </div>`;
  }).catch(() => {
    document.getElementById('coachContent').innerHTML = `
      <div class="coaching-card">
        <div class="move-badge" style="background:rgba(83,52,131,0.25);color:#a78bfa;margin-bottom:10px">💡 Suggested Move</div>
        <div class="coach-text">Try ${sanToEnglish(moveSAN)} — it's the strongest option in this position.</div>
      </div>`;
  });
}

function undoMove() {
  if (moveLog.length === 0) return;

  if (sfWorker) sfWorker.postMessage({ cmd: 'stop' });
  analysisPhase = 'idle';
  pendingAnalysis = null;

  // Undo engine's move then user's move
  chess.undo();
  chess.undo();
  moveHistory.pop();
  moveHistory.pop();
  moveLog.pop();

  // Restore last-move highlight from remaining history
  const hist = chess.history({ verbose: true });
  board.lastMove = hist.length > 0
    ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to }
    : null;
  board.highlighted = null;
  board._clearArrows();
  board.setInteractive(true);
  board.render();

  gameActive = true;
  renderMoveHistory();
  updateTurnIndicator();
  updateUndoBtn();

  document.getElementById('coachContent').innerHTML = `
    <div class="empty-state" style="padding:16px 0">
      <div class="icon">↩</div>
      <p>Move undone. Make your next move to continue.</p>
    </div>`;
}

function updateUndoBtn() {
  const btn = document.getElementById('undoBtn');
  if (btn) btn.disabled = moveLog.length === 0;
}

const TECHNIQUE_DESCS = {
  'Fork':              'Coach will alert you when you can attack two pieces at once with one move.',
  'Pin':               'Coach will spot when you can pin an opponent\'s piece to a more valuable one behind it.',
  'Skewer':            'Coach will look for skewers — forcing a valuable piece to move and winning what\'s behind it.',
  'Discovered Attack': 'Coach will highlight when moving one piece reveals a hidden attack by another.',
  'Back Rank Mate':    'Coach will watch for checkmate threats on the opponent\'s back rank.',
  'Hanging Pieces':    'Coach will point out undefended opponent pieces you can capture for free.',
};

function setTechnique(tech, btn) {
  if (focusTechnique === tech) {
    focusTechnique = null;
    document.querySelectorAll('.technique-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('techniqueDesc').textContent = '';
  } else {
    focusTechnique = tech;
    document.querySelectorAll('.technique-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('techniqueDesc').textContent = TECHNIQUE_DESCS[tech] || '';
  }
}

const OPENINGS = {
  'Italian Game':    { color:'white', mainLine:'1.e4 e5 2.Nf3 Nc6 3.Bc4',        ideas:'Open with your king\'s pawn (e4), develop your knight to f3, then place your bishop on c4 aiming at f7. Castle kingside for safety. The goal is fast development and central control.' },
  'Ruy López':       { color:'white', mainLine:'1.e4 e5 2.Nf3 Nc6 3.Bb5',        ideas:'After e4 and Nf3, pin Black\'s knight with your bishop on b5. This indirectly pressures Black\'s e5 pawn. Follow up with castle, d3 or d4 to open the center.' },
  "Queen's Gambit":  { color:'white', mainLine:'1.d4 d5 2.c4',                    ideas:'Open with d4, then offer the c-pawn with c4 — this is the gambit. If Black captures it you get active pieces; if Black declines, you have a strong center. Follow up with Nc3, Nf3, and e3.' },
  'London System':   { color:'white', mainLine:'1.d4 d5 2.Nf3 Nf6 3.Bf4',        ideas:'Open with d4, develop your knight to f3, then bring your bishop to f4 before playing e3. This solid setup is hard to attack. Follow up with Be2, c3, and castle kingside.' },
  'King\'s Fianchetto': { color:'white', mainLine:'1.g3 2.Bg2 3.Nf3',            ideas:'Fianchetto your bishop to g2 (via g3) to control the center from a distance. This hypermodern approach lets Black take the center while you undermine it. Follow up with d3, Nf3, and castle.' },
  'Sicilian Defense':  { color:'black', mainLine:'1...c5 (after White plays e4)', ideas:'When White plays e4, respond with c5. This fights for the center without mirroring White. Aim to develop your knight to c6 or f6, control d4, and create queenside counterplay.' },
  'French Defense':    { color:'black', mainLine:'1...e6 (after White plays e4)', ideas:'When White plays e4, respond with e6. Plan to follow with d5 to challenge the center. The French is solid — you accept a slightly cramped position but get a strong pawn structure to build on.' },
  'Caro-Kann':         { color:'black', mainLine:'1...c6 (after White plays e4)', ideas:'When White plays e4, respond with c6, preparing d5. This challenges the center solidly without early piece development. Black gets a very solid structure and good endgame prospects.' },
  "King's Indian":     { color:'black', mainLine:'1...Nf6 2...g6 3...Bg7',        ideas:'Develop your knight to f6, fianchetto your bishop to g7 (via g6). Let White build a big center, then counterattack with d6 and e5. Your bishop on g7 becomes a powerful long-range weapon.' },
};

function setOpening(name, btn) {
  if (selectedOpening?.name === name) {
    selectedOpening = null;
    document.querySelectorAll('.opening-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('openingDesc').textContent = '';
  } else {
    const o = OPENINGS[name];
    selectedOpening = { name, ...o };
    document.querySelectorAll('.opening-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('openingDesc').textContent = `${o.color === 'white' ? 'As White' : 'As Black'} · ${o.mainLine}`;
  }
}

function sanToEnglish(san) {
  if (!san) return san;
  if (san === 'O-O-O') return 'queenside castle';
  if (san === 'O-O')   return 'kingside castle';
  const pieces = { K:'King', Q:'Queen', R:'Rook', B:'Bishop', N:'Knight' };
  const check = san.includes('#') ? ' (checkmate)' : san.includes('+') ? ' (check)' : '';
  const clean = san.replace(/[+#!?]/g, '');
  const hasPiece = pieces[clean[0]];
  const piece = hasPiece ? pieces[clean[0]] : 'Pawn';
  const rest  = hasPiece ? clean.slice(1) : clean;
  if (rest.includes('x')) {
    const dest = rest.split('x').pop();
    return `${piece} captures on ${dest}${check}`;
  }
  if (rest.includes('=')) {
    const [dest, promo] = rest.split('=');
    return `Pawn to ${dest}, promotes to ${pieces[promo] || promo}${check}`;
  }
  return `${piece} to ${rest}${check}`;
}

// Load settings on startup
window.addEventListener('DOMContentLoaded', () => {
  const settings = Storage.getSettings();

  // Allow ?level=N from stats page "Play This Level" button
  const urlLevel = new URLSearchParams(window.location.search).get('level');
  if (urlLevel !== null) {
    const lvl = Math.max(0, Math.min(20, parseInt(urlLevel)));
    settings.skillLevel = lvl;
    Storage.saveSettings({ skillLevel: lvl });
  }

  document.getElementById('skillSlider').value = settings.skillLevel;
  document.querySelectorAll('.color-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.color === (settings.playerColor || 'white'));
  });
  init();
});
