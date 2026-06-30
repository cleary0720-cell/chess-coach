// stats.html controller

function playRecommended() {
  const stats = Storage.getStats();
  const level = stats.recommendedSkillLevel ?? 10;
  window.location = `index.html?level=${level}`;
}

function drawLineChart(canvasId, data, opts = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 400;
  const H = canvas.height;
  canvas.width = W;

  if (!data.length) return;

  const min = Math.min(...data) - 5;
  const max = Math.max(...data) + 5;
  const range = max - min || 1;

  const pad = { top: 10, right: 12, bottom: 24, left: 40 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  ctx.clearRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y); ctx.stroke();
  }

  // Y-axis labels
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = Math.round(max - (range / 4) * i);
    const y = pad.top + (chartH / 4) * i;
    ctx.fillText(val, pad.left - 4, y + 3);
  }

  // X-axis labels
  ctx.textAlign = 'center';
  data.forEach((_, i) => {
    if (data.length <= 10 || i % Math.ceil(data.length / 5) === 0) {
      const x = pad.left + (i / Math.max(data.length - 1, 1)) * chartW;
      ctx.fillText(i + 1, x, H - 4);
    }
  });

  // Line
  ctx.beginPath();
  ctx.strokeStyle = opts.color || '#e94560';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  data.forEach((val, i) => {
    const x = pad.left + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = pad.top + chartH - ((val - min) / range) * chartH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Dots
  data.forEach((val, i) => {
    const x = pad.left + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = pad.top + chartH - ((val - min) / range) * chartH;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = opts.color || '#e94560';
    ctx.fill();
  });
}

function renderStats() {
  const stats  = Storage.getStats();
  const games  = Storage.getGames();

  // ELO card
  const eloEl = document.getElementById('eloVal');
  if (stats.estimatedElo) {
    eloEl.textContent = stats.estimatedElo;
    document.getElementById('eloBasis').textContent =
      `Based on last ${Math.min(games.length, 10)} games`;
    const history = stats.eloHistory || [];
    if (history.length >= 2) {
      const diff = history[history.length - 1] - history[history.length - 2];
      document.getElementById('eloTrend').textContent =
        diff >= 0 ? `▲ +${diff} trending up` : `▼ ${diff} trending down`;
      document.getElementById('eloTrend').style.color =
        diff >= 0 ? 'var(--excellent)' : 'var(--blunder)';
    }
  } else {
    eloEl.textContent = '—';
    document.getElementById('eloBasis').textContent =
      `Play ${Math.max(0, 3 - games.length)} more game(s) to unlock`;
  }

  // Accuracy
  const accEl = document.getElementById('accuracyVal');
  accEl.textContent = stats.avgAccuracy ? stats.avgAccuracy + '%' : '—';

  // Games
  document.getElementById('gamesVal').textContent = stats.gamesPlayed || 0;
  document.getElementById('recordSub').textContent =
    `${stats.wins}W / ${stats.losses}L / ${stats.draws}D`;

  // Recommended difficulty
  const recEl = document.getElementById('recDiffVal');
  const recLvl = stats.recommendedSkillLevel ?? 10;
  recEl.textContent = `Level ${recLvl}`;
  document.getElementById('recDiffSub').textContent =
    stats.estimatedElo
      ? `~${1800 + (recLvl - 10) * 100} ELO opponent — slightly above your level`
      : 'Default — play games to calibrate';

  // Accuracy chart
  const accData = games.slice(0, 20).map(g => g.accuracy || 0).reverse();
  if (accData.length) {
    document.getElementById('noAccuracyData').style.display = 'none';
    drawLineChart('accuracyChart', accData, { color: '#2ecc71' });
  } else {
    document.getElementById('noAccuracyData').style.display = 'block';
  }

  // ELO chart
  const eloData = stats.eloHistory || [];
  if (eloData.length >= 2) {
    document.getElementById('noEloData').style.display = 'none';
    drawLineChart('eloChart', eloData, { color: '#e94560' });
  } else {
    document.getElementById('noEloData').style.display = 'block';
  }

  // Quality breakdown
  const allMoves = games.flatMap(g => g.moves || []);
  const userMoves = allMoves.filter(m => m.playerColor !== undefined);
  if (userMoves.length) {
    const counts = { best:0, excellent:0, good:0, inaccuracy:0, mistake:0, blunder:0 };
    userMoves.forEach(m => {
      const k = (m.quality || 'Good').toLowerCase();
      if (k in counts) counts[k]++;
    });
    const total = userMoves.length;
    const labels = { best:'Best !!', excellent:'Excellent !', good:'Good', inaccuracy:'Inaccuracy ?!', mistake:'Mistake ?', blunder:'Blunder ??' };
    const colors = { best:'var(--best)', excellent:'var(--excellent)', good:'var(--good)', inaccuracy:'var(--inaccuracy)', mistake:'var(--mistake)', blunder:'var(--blunder)' };
    document.getElementById('qualityBreakdown').innerHTML = Object.entries(counts).map(([k, n]) => `
      <div style="text-align:center">
        <div style="font-size:22px;font-weight:700;color:${colors[k]}">${n}</div>
        <div style="font-size:12px;color:${colors[k]}">${labels[k]}</div>
        <div style="font-size:11px;color:var(--text-muted)">${total ? Math.round(n/total*100) : 0}%</div>
      </div>`).join('');
  }
}

window.addEventListener('DOMContentLoaded', renderStats);
window.addEventListener('resize', () => {
  const stats = Storage.getStats();
  const games = Storage.getGames();
  const accData = games.slice(0,20).map(g => g.accuracy || 0).reverse();
  if (accData.length) drawLineChart('accuracyChart', accData, { color:'#2ecc71' });
  const eloData = stats.eloHistory || [];
  if (eloData.length >= 2) drawLineChart('eloChart', eloData, { color:'#e94560' });
});
