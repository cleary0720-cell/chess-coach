// history.html controller

let reviewGame  = null;
let reviewIdx   = 0;  // current move index (0 = start)
let reviewChess = null;
let reviewBoard = null;

function renderGameList() {
  const games = Storage.getGames();
  const el = document.getElementById('gameList');

  if (!games.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>No games yet. Play a game to see your history.</p></div>`;
    return;
  }

  el.innerHTML = games.map((g, i) => {
    const date = new Date(g.date).toLocaleDateString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    const resultCls = g.result === 'win' ? 'result-win' : g.result === 'loss' ? 'result-loss' : 'result-draw';
    const resultLabel = g.result === 'win' ? 'Win' : g.result === 'loss' ? 'Loss' : 'Draw';
    return `<div class="game-item" id="game-item-${i}" onclick="loadGame(${i})">
      <div class="game-result ${resultCls}">${resultLabel} — ${g.playerColor === 'white' ? '♙' : '♟'} vs Lvl ${g.skillLevel}</div>
      <div class="game-meta">${date} · ${g.accuracy ?? '?'}% accuracy · ${g.acpl ?? '?'} ACPL · ${(g.moves||[]).length} moves</div>
    </div>`;
  }).join('');
}

function loadGame(idx) {
  const games = Storage.getGames();
  reviewGame  = games[idx];
  reviewIdx   = 0;

  document.querySelectorAll('.game-item').forEach((el, i) =>
    el.classList.toggle('active', i === idx)
  );

  document.getElementById('reviewPanel').style.display = 'block';
  document.getElementById('noReview').style.display = 'none';

  // Header
  const resultCls = reviewGame.result === 'win' ? 'result-win' : reviewGame.result === 'loss' ? 'result-loss' : 'result-draw';
  const resultLabel = reviewGame.result === 'win' ? 'Win' : reviewGame.result === 'loss' ? 'Loss' : 'Draw';
  document.getElementById('reviewResult').className = resultCls;
  document.getElementById('reviewResult').textContent = resultLabel;
  document.getElementById('reviewMeta').textContent =
    `${reviewGame.playerColor} vs Stockfish Level ${reviewGame.skillLevel} · ${new Date(reviewGame.date).toLocaleDateString()}`;
  document.getElementById('reviewAccuracy').textContent = (reviewGame.accuracy ?? '?') + '% accuracy';
  document.getElementById('reviewACPL').textContent = `${reviewGame.acpl ?? '?'} ACPL`;

  // Set up board
  reviewChess = new Chess();
  if (!reviewBoard) {
    reviewBoard = new ChessBoard('reviewBoard', reviewChess, { interactive: false });
  } else {
    reviewBoard.chess = reviewChess;
    reviewBoard.flipped = reviewGame.playerColor === 'black';
    reviewBoard._build();
  }

  // Draw eval chart
  drawEvalChart();

  // Move list
  renderReviewMoveList();

  updateReviewPos();
}

function drawEvalChart() {
  const canvas = document.getElementById('evalChart');
  if (!canvas || !reviewGame?.moves?.length) return;

  const W = canvas.offsetWidth || 500;
  canvas.width = W;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const scores = reviewGame.moves.map(m => m.evalBefore ?? 0);
  const pad = { top: 4, right: 8, bottom: 4, left: 8 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const midY = pad.top + chartH / 2;

  // Background
  ctx.fillStyle = '#0f3460'; ctx.fillRect(0, 0, W, H);

  // Zero line
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.left, midY); ctx.lineTo(pad.left + chartW, midY); ctx.stroke();

  // Fill areas
  scores.forEach((score, i) => {
    const x = pad.left + (i / Math.max(scores.length - 1, 1)) * chartW;
    const clamped = Math.max(-800, Math.min(800, score));
    const h = (clamped / 800) * (chartH / 2);
    ctx.fillStyle = clamped >= 0 ? 'rgba(46,204,113,0.5)' : 'rgba(231,76,60,0.5)';
    ctx.fillRect(x - 2, midY - Math.max(h, 0), 4, Math.abs(h) || 1);
  });
}

function renderReviewMoveList() {
  const moves = reviewGame?.moves || [];
  const el = document.getElementById('reviewMoveList');
  if (!moves.length) { el.innerHTML = ''; return; }

  let html = '';
  for (let i = 0; i < moves.length; i += 2) {
    const w = moves[i];
    const b = moves[i + 1];
    const num = Math.floor(i / 2) + 1;
    html += `<div class="move-pair">
      <span class="move-num">${num}.</span>
      <span class="move-san" id="rmove-${i}" onclick="goToMove(${i+1})">${w.san}<span class="symbol" style="color:var(--${w.qualityCls||'text'})">${w.symbol||''}</span></span>
      ${b ? `<span class="move-san" id="rmove-${i+1}" onclick="goToMove(${i+2})">${b.san}<span class="symbol" style="color:var(--${b.qualityCls||'text'})">${b.symbol||''}</span></span>` : ''}
    </div>`;
  }
  el.innerHTML = html;
}

function goToMove(n) {
  reviewIdx = Math.min(n, (reviewGame?.moves?.length || 0));
  updateReviewPos();
}

function reviewFirst() { reviewIdx = 0; updateReviewPos(); }
function reviewLast()  { reviewIdx = reviewGame?.moves?.length || 0; updateReviewPos(); }
function reviewPrev()  { if (reviewIdx > 0) { reviewIdx--; updateReviewPos(); } }
function reviewNext()  { if (reviewIdx < (reviewGame?.moves?.length || 0)) { reviewIdx++; updateReviewPos(); } }

function updateReviewPos() {
  if (!reviewGame) return;
  const moves = reviewGame.moves || [];

  // Rebuild chess position to reviewIdx
  reviewChess.reset();
  for (let i = 0; i < reviewIdx; i++) {
    const m = moves[i];
    if (m) reviewChess.move({ from: m.uci.slice(0,2), to: m.uci.slice(2,4), promotion: m.uci[4] || 'q' });
  }
  reviewBoard.render();

  if (reviewIdx > 0) {
    const last = moves[reviewIdx - 1];
    reviewBoard.lastMove = { from: last.uci.slice(0,2), to: last.uci.slice(2,4) };
    reviewBoard.render();
  } else {
    reviewBoard.lastMove = null;
    reviewBoard.render();
  }

  // Move label
  document.getElementById('reviewMoveLabel').textContent =
    reviewIdx === 0 ? 'Start' : `Move ${Math.ceil(reviewIdx / 2)} (${reviewIdx % 2 === 1 ? 'White' : 'Black'})`;

  // Highlight current move in list
  document.querySelectorAll('.move-san').forEach(el => el.style.background = '');
  if (reviewIdx > 0) {
    const el = document.getElementById(`rmove-${reviewIdx - 1}`);
    if (el) { el.style.background = 'rgba(233,69,96,0.2)'; el.scrollIntoView({ block:'nearest' }); }
  }

  // Show coaching note for this move
  const noteEl = document.getElementById('reviewCoachNote');
  if (reviewIdx > 0 && moves[reviewIdx - 1]) {
    const m = moves[reviewIdx - 1];
    noteEl.innerHTML = m.coaching
      ? `<div style="margin-bottom:6px"><span class="move-badge quality-${m.qualityCls}" style="display:inline-flex">${m.symbol||''} ${m.quality} — ${m.cpLoss}cp</span></div>${m.coaching}`
      : `<span class="move-badge quality-${m.qualityCls}" style="display:inline-flex">${m.symbol||''} ${m.quality} — ${m.cpLoss}cp</span>`;
  } else {
    noteEl.innerHTML = `<span style="color:var(--text-muted)">Select a move to see coaching.</span>`;
  }
}

window.addEventListener('DOMContentLoaded', renderGameList);
