// lessons.html controller

let currentPuzzle  = null;
let currentAngle   = '';
let puzzleChess    = null;
let puzzleBoard    = null;
let puzzleSolved   = false;

// ────────────────────────────────
// PUZZLE ENGINE
// ────────────────────────────────

async function fetchPuzzle(angle = '') {
  document.getElementById('puzzleStatus').textContent = '';
  document.getElementById('puzzleStatus').className = 'puzzle-status';
  document.getElementById('puzzleExplanation').style.display = 'none';
  document.getElementById('puzzleSideLabel').textContent = 'Loading puzzle...';

  const url = angle
    ? `https://lichess.org/api/puzzle/next?angle=${angle}`
    : 'https://lichess.org/api/puzzle/next';

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Lichess API error');
    const data = await res.json();

    // Build the puzzle start position from the game PGN
    const tmp = new Chess();
    tmp.load_pgn(data.game.pgn);
    const history = tmp.history({ verbose: true });
    const ply = data.puzzle.initialPly;

    const startChess = new Chess();
    for (let i = 0; i < ply; i++) {
      if (history[i]) startChess.move(history[i]);
    }

    currentPuzzle = {
      id:          data.puzzle.id,
      rating:      data.puzzle.rating,
      themes:      data.puzzle.themes || [],
      solution:    data.puzzle.solution, // UCI array
      solIdx:      0,
      fen:         startChess.fen(),
      sideToMove:  startChess.turn() === 'w' ? 'White' : 'Black',
    };
    puzzleSolved = false;

    puzzleChess = new Chess(currentPuzzle.fen);

    if (!puzzleBoard) {
      puzzleBoard = new ChessBoard('puzzleBoard', puzzleChess, {
        onMove: handlePuzzleMove,
        flipped: currentPuzzle.sideToMove === 'Black',
      });
    } else {
      puzzleChess = new Chess(currentPuzzle.fen);
      puzzleBoard.chess = puzzleChess;
      puzzleBoard.flipped = currentPuzzle.sideToMove === 'Black';
      puzzleBoard._build();
    }

    document.getElementById('puzzleSideLabel').textContent =
      `${currentPuzzle.sideToMove} to move — find the best continuation`;
    document.getElementById('puzzleInfo').textContent =
      `Puzzle #${currentPuzzle.id} · ${currentPuzzle.rating} · ${currentPuzzle.themes.slice(0,2).join(', ')}`;

    const streakData = Storage.getPuzzles();
    document.getElementById('streakCount').textContent = streakData.streak || 0;

  } catch (err) {
    console.error('Puzzle fetch error:', err);
    document.getElementById('puzzleSideLabel').textContent = 'Failed to load puzzle — check your connection.';
  }
}

function handlePuzzleMove(move) {
  if (!currentPuzzle || puzzleSolved) return;

  const uci = move.from + move.to + (move.promotion || '');
  const expected = currentPuzzle.solution[currentPuzzle.solIdx];

  if (uci === expected) {
    currentPuzzle.solIdx++;

    if (currentPuzzle.solIdx >= currentPuzzle.solution.length) {
      // Puzzle complete!
      puzzleSolved = true;
      const p = Storage.savePuzzleResult(currentPuzzle.id, true, currentAngle);
      document.getElementById('streakCount').textContent = p.streak;
      document.getElementById('puzzleStatus').textContent = '✓ Correct! Well done.';
      document.getElementById('puzzleStatus').className = 'puzzle-status correct';
      puzzleBoard.setInteractive(false);
      return;
    }

    // Auto-play opponent's reply
    const opponentUCI = currentPuzzle.solution[currentPuzzle.solIdx];
    currentPuzzle.solIdx++;

    setTimeout(() => {
      puzzleBoard.applyMove(opponentUCI);
      if (currentPuzzle.solIdx >= currentPuzzle.solution.length) {
        puzzleSolved = true;
        const p = Storage.savePuzzleResult(currentPuzzle.id, true, currentAngle);
        document.getElementById('streakCount').textContent = p.streak;
        document.getElementById('puzzleStatus').textContent = '✓ Correct! Puzzle solved.';
        document.getElementById('puzzleStatus').className = 'puzzle-status correct';
        puzzleBoard.setInteractive(false);
      } else {
        document.getElementById('puzzleStatus').textContent = '✓ Keep going...';
        document.getElementById('puzzleStatus').className = 'puzzle-status correct';
      }
    }, 400);

  } else {
    // Wrong move — undo it
    puzzleChess.undo();
    puzzleBoard.lastMove = null;
    puzzleBoard.render();

    Storage.savePuzzleResult(currentPuzzle.id, false, currentAngle);
    document.getElementById('streakCount').textContent = 0;
    document.getElementById('puzzleStatus').textContent = '✗ Not quite — try again!';
    document.getElementById('puzzleStatus').className = 'puzzle-status wrong';
  }
}

function showHint() {
  if (!currentPuzzle) return;
  const nextUCI = currentPuzzle.solution[currentPuzzle.solIdx];
  if (nextUCI) {
    const sq = nextUCI.slice(0, 2);
    document.getElementById('puzzleStatus').textContent = `Hint: move the piece on ${sq.toUpperCase()}`;
    document.getElementById('puzzleStatus').className = 'puzzle-status';
  }
}

function nextPuzzle() {
  fetchPuzzle(currentAngle);
}

// ────────────────────────────────
// THEME FILTER
// ────────────────────────────────

document.getElementById('themeFilter')?.addEventListener('click', e => {
  const btn = e.target.closest('.theme-btn');
  if (!btn) return;
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentAngle = btn.dataset.angle;
  fetchPuzzle(currentAngle);
});

// ────────────────────────────────
// MINI LESSONS
// ────────────────────────────────

const LESSONS = {
  openings: [
    {
      icon: '♟',
      title: 'Italian Game',
      desc: '1.e4 e5 2.Nf3 Nc6 3.Bc4 — control the center, develop fast.',
      content: `<h4>The Italian Game</h4>
<p>The Italian Game starts with <strong>1.e4 e5 2.Nf3 Nc6 3.Bc4</strong>. White's bishop aims at the f7 square — the weakest point in Black's position at the start of the game (defended only by the king).</p>
<p><strong>Key ideas:</strong></p>
<p>• Control the center with pawns on e4 and d4 (later)</p>
<p>• Develop all pieces before attacking</p>
<p>• Castle kingside early to keep your king safe</p>
<p><strong>Watch out for:</strong> The Fried Liver Attack — if Black plays 3...Nf6, White can sacrifice a knight on f7 for a dangerous attack.</p>
<p><strong>Why it works:</strong> The bishop on c4 is active and controls key squares. It's a great opening for beginners because the ideas are clear and logical.</p>`,
    },
    {
      icon: '♜',
      title: 'Sicilian Defense',
      desc: '1.e4 c5 — Black fights back asymmetrically for dynamic play.',
      content: `<h4>The Sicilian Defense</h4>
<p>After <strong>1.e4 c5</strong>, Black doesn't mirror White's center pawn. Instead, Black fights for the d4 square with a flank pawn. This creates an <em>asymmetrical</em> position with imbalances — meaning both sides have chances.</p>
<p><strong>Why play it:</strong> The Sicilian is the most popular response to 1.e4 at all levels. It gives Black winning chances rather than just trying to equalize.</p>
<p><strong>Key ideas:</strong></p>
<p>• Black will often attack on the queenside (b5, a5 pawn pushes)</p>
<p>• White usually attacks on the kingside</p>
<p>• The half-open c-file is Black's key asset</p>
<p><strong>Famous players:</strong> Bobby Fischer, Gary Kasparov, and Magnus Carlsen have all used the Sicilian at the highest levels.</p>`,
    },
    {
      icon: '♛',
      title: "Queen's Gambit",
      desc: '1.d4 d5 2.c4 — offer a pawn to control the center.',
      content: `<h4>The Queen's Gambit</h4>
<p>White offers a pawn with <strong>1.d4 d5 2.c4</strong>. If Black takes (2...dxc4), White doesn't actually lose the pawn permanently — they can win it back while gaining time and space.</p>
<p><strong>Accepted (2...dxc4):</strong> Black takes the pawn but gives White a strong center. White plays 3.e3 or 3.Nf3 and gets the pawn back easily.</p>
<p><strong>Declined (2...e6):</strong> Black reinforces the center. This leads to solid, strategic positions. More popular at the top level.</p>
<p><strong>Key ideas:</strong></p>
<p>• White wants to build a strong pawn center (d4 + e4)</p>
<p>• The c4 pawn pressures Black's center from the start</p>
<p>• Development and piece activity are the priority</p>`,
    },
    {
      icon: '♙',
      title: 'London System',
      desc: '1.d4 2.Nf3 3.Bf4 — solid setup for White, easy to learn.',
      content: `<h4>The London System</h4>
<p>The London is built with <strong>1.d4, 2.Nf3, 3.Bf4</strong> — a solid, reliable setup that works against almost anything Black plays. It's popular because you don't need to memorize a lot of theory.</p>
<p><strong>Key ideas:</strong></p>
<p>• The bishop goes to f4 <em>before</em> Black can challenge it with ...e5</p>
<p>• White builds a pawn triangle: d4, e3, c3</p>
<p>• Castle kingside and build pressure slowly</p>
<p><strong>Why it's great for improving players:</strong> You can learn a consistent setup and focus on middlegame strategy rather than memorizing opening theory. Magnus Carlsen and many other top players use it.</p>
<p><strong>Downside:</strong> It's solid but not sharp — if you want wild tactics, look elsewhere.</p>`,
    },
  ],
  tactics: [
    {
      icon: '⚔️',
      title: 'Fork',
      desc: 'One piece attacks two enemy pieces at once.',
      content: `<h4>The Fork</h4>
<p>A fork is when one of your pieces attacks two (or more) enemy pieces simultaneously. The opponent can only save one, so you win the other.</p>
<p><strong>Knights are the best forking pieces</strong> because they jump over other pieces and can attack in unexpected ways. A knight fork is called a "family fork" when it attacks the king, queen, and a rook all at once.</p>
<p><strong>Example:</strong> A knight on e5 might attack the queen on d7 and the rook on f7 at the same time. Your opponent must move the queen — and you take the rook.</p>
<p><strong>Pawn forks</strong> are also powerful and often overlooked. A pawn on e5 attacking pieces on d6 and f6 wins material.</p>
<p><strong>How to spot forks:</strong> Look for squares where your knight can land that attack two valuable pieces. Always check knight moves before you play — they're easy to miss.</p>`,
    },
    {
      icon: '📌',
      title: 'Pin',
      desc: 'A piece can\'t move because it shields a more valuable piece.',
      content: `<h4>The Pin</h4>
<p>A pin occurs when attacking a piece that <em>cannot</em> move because doing so would expose a more valuable piece (or the king) behind it.</p>
<p><strong>Absolute pin:</strong> The pinned piece is shielding the king. Moving it is illegal. Example: a bishop pins a knight to the king — the knight cannot move at all.</p>
<p><strong>Relative pin:</strong> The pinned piece is shielding a valuable piece (not the king). Moving it is legal but loses material. Example: a bishop pins a knight to the queen — moving the knight loses the queen.</p>
<p><strong>Pieces that pin:</strong> Bishops, rooks, and queens can create pins along diagonals, files, and ranks.</p>
<p><strong>How to exploit a pin:</strong> Attack the pinned piece with more pieces! A pinned knight can't defend anything effectively. Pile on the pressure.</p>`,
    },
    {
      icon: '🎯',
      title: 'Skewer',
      desc: 'Like a pin, but the valuable piece is in front.',
      content: `<h4>The Skewer</h4>
<p>A skewer is the <em>reverse</em> of a pin. You attack a valuable piece, it moves to safety, and you capture the less valuable piece behind it.</p>
<p><strong>Example:</strong> Your rook checks the king on e8. The king must move — and your rook takes the rook on e1 behind it.</p>
<p><strong>Difference from a pin:</strong> In a pin, you attack the less valuable piece (which can't move). In a skewer, you attack the MORE valuable piece (which must move), then take what's behind it.</p>
<p><strong>Where to look:</strong> After your opponent castles, their king and rook are on the same rank or file. A rook or bishop on that line can skewer the king to the rook.</p>`,
    },
    {
      icon: '💥',
      title: 'Discovered Attack',
      desc: 'Moving one piece reveals an attack from the piece behind it.',
      content: `<h4>The Discovered Attack</h4>
<p>A discovered attack happens when you move one piece, which <em>uncovers</em> an attack by another piece behind it. The opponent has to deal with two threats at once.</p>
<p><strong>Discovered check</strong> is the most powerful version — the uncovered piece gives check to the king, forcing the opponent to respond to check while you do something else with the piece you moved.</p>
<p><strong>Example:</strong> Your bishop is on d3, with your rook behind it on d1. You move the bishop to f5, attacking the queen AND your rook now attacks a piece on d8. Your opponent loses material.</p>
<p><strong>Double check:</strong> Both the piece that moved AND the uncovered piece give check simultaneously. The only escape is to move the king — you can't block or capture both.</p>
<p><strong>How to set them up:</strong> Look for pieces that are "in line" with your rooks and bishops. Moving the front piece can unleash powerful attacks.</p>`,
    },
    {
      icon: '🏠',
      title: 'Back Rank Mate',
      desc: 'Checkmate the king trapped behind its own pawns.',
      content: `<h4>Back Rank Mate</h4>
<p>A back rank mate happens when the king is trapped behind its own pawns (usually after castling) and a rook or queen delivers checkmate on the first or eighth rank.</p>
<p><strong>Why it happens:</strong> After castling, many players leave their king with three pawns in front (g2, h2, f2 for White). These pawns protect the king — but they also trap it. If the first rank is controlled by the opponent, the king has nowhere to go.</p>
<p><strong>Prevention — create a "luft":</strong> Move one of the pawns in front of your king (usually h3 or g3) to give the king an escape square. This prevents back rank mates.</p>
<p><strong>How to spot it:</strong> If your opponent's king is stuck on the back rank and their pieces aren't defending it, look for a rook or queen sacrifice to clear the rank and deliver checkmate.</p>`,
    },
  ],
  endgames: [
    {
      icon: '♚',
      title: 'King Activity',
      desc: 'In the endgame, your king is a powerful attacking piece.',
      content: `<h4>King Activity in the Endgame</h4>
<p>One of the biggest mistakes beginners make in the endgame is keeping their king passive. In the middlegame, you tuck the king away for safety. In the endgame, the king must become an <em>active fighting piece</em>.</p>
<p><strong>Why?</strong> With fewer pieces on the board, the king is relatively safe. And it's very powerful — it can control key squares and escort pawns to promotion.</p>
<p><strong>Key rule:</strong> Activate your king as soon as queens come off the board. March it toward the center or toward the action.</p>
<p><strong>Opposition:</strong> When two kings face each other with one square between them, the player who does NOT have to move has the "opposition" and can push the other king back. This is crucial in king and pawn endgames.</p>`,
    },
    {
      icon: '♟',
      title: 'Passed Pawns',
      desc: 'A pawn with no opposing pawns in its way is a huge asset.',
      content: `<h4>Passed Pawns</h4>
<p>A <strong>passed pawn</strong> is a pawn that has no opposing pawns blocking it or on adjacent files that can capture it. It's free to advance toward promotion — and that's a massive threat.</p>
<p><strong>"A passed pawn must be pushed!"</strong> — Nimzowitsch's famous principle. Advance it, because promoting a pawn to a queen wins the game.</p>
<p><strong>Defending against passed pawns:</strong> Use your rook to block from behind (rook on d1 vs passed pawn on d6 — the rook attacks it from the rear). Use your king to block it in the endgame.</p>
<p><strong>Connected passed pawns</strong> on adjacent files are especially dangerous — they support each other and are nearly unstoppable when they reach the 6th rank.</p>`,
    },
    {
      icon: '♖',
      title: 'Rook Endgames',
      desc: 'The most common endgame — rooks belong behind passed pawns.',
      content: `<h4>Rook Endgames</h4>
<p>Rook endgames are the most common type of endgame. The most important rule:</p>
<p><strong>"Rooks belong behind passed pawns"</strong> — whether yours or the opponent's. Place your rook behind a passed pawn (on the same file, behind it), so it gains more activity as the pawn advances.</p>
<p><strong>Lucena Position:</strong> A winning technique with rook and extra pawn. The technique is called "building a bridge" — use your rook to shield your king as the pawn promotes.</p>
<p><strong>Philidor Position:</strong> A drawing technique for the defender with only a rook vs rook and pawn. Keep your rook on the 6th rank to harass the attacking king, then switch to the back rank when the pawn advances.</p>
<p><strong>Rook activity:</strong> An active rook on an open file is worth much more than a passive rook defending a pawn. Trade passivity for activity whenever possible.</p>`,
    },
  ],
};

function showTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLessons(tab);
}

function renderLessons(tab) {
  const items = LESSONS[tab] || [];
  document.getElementById('lessonsContent').innerHTML = `
    <div class="lessons-grid">
      ${items.map((l, i) => `
        <div class="lesson-card" onclick="openLesson('${tab}',${i})">
          <div class="lesson-icon">${l.icon}</div>
          <div class="lesson-title">${l.title}</div>
          <div class="lesson-desc">${l.desc}</div>
        </div>`).join('')}
    </div>`;
}

function openLesson(tab, idx) {
  const lesson = LESSONS[tab][idx];
  if (!lesson) return;
  document.getElementById('lessonModalTitle').textContent = lesson.title;
  document.getElementById('lessonModalBody').innerHTML = lesson.content;
  document.getElementById('lessonModal').style.display = 'flex';
}

function closeLessonModal() {
  document.getElementById('lessonModal').style.display = 'none';
}

// ────────────────────────────────
// INIT
// ────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  renderLessons('openings');
  fetchPuzzle('');
});
