// Vanilla chess board renderer. Wraps chess.js.
// Usage: const b = new ChessBoard('board-element-id', chess, { onMove, flipped });

const PIECE_CDN = 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/piece/cburnett/';
const PIECE_UNICODE = {
  wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟',
};

class ChessBoard {
  constructor(containerId, chess, opts = {}) {
    this.el          = document.getElementById(containerId);
    this.chess       = chess;
    this.onMove      = opts.onMove || (() => {});
    this.flipped     = opts.flipped || false;
    this.interactive = opts.interactive !== false;
    this.selected    = null;
    this.legalDests  = [];
    this.lastMove    = null;
    this.highlighted = null;
    this.userArrows  = [];
    this._build();
  }

  _files() { return this.flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h']; }
  _ranks() { return this.flipped ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1]; }

  _build() {
    this.el.innerHTML = '';
    const ranks = this._ranks();
    const files = this._files();
    ranks.forEach((rank, ri) => {
      files.forEach((file, fi) => {
        const sq = document.createElement('div');
        const sqName = file + rank;
        sq.className = 'sq ' + ((ri + fi) % 2 === 0 ? 'light' : 'dark');
        sq.dataset.sq = sqName;

        // Coordinates
        if (fi === 0) {
          const r = document.createElement('span');
          r.className = 'coord rank';
          r.textContent = rank;
          sq.appendChild(r);
        }
        if (ri === 7) {
          const f = document.createElement('span');
          f.className = 'coord file';
          f.textContent = file;
          sq.appendChild(f);
        }

        if (this.interactive) {
          sq.addEventListener('click', (e) => this._handleClick(sqName));
        }
        this.el.appendChild(sq);
      });
    });

    // SVG overlay for arrows
    this.arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.arrowSvg.setAttribute('viewBox', '0 0 8 8');
    this.arrowSvg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;overflow:hidden';
    this.el.appendChild(this.arrowSvg);

    this._setupArrowDraw();
    this.render();
  }

  render() {
    const ranks = this._ranks();
    const files = this._files();
    this.el.querySelectorAll('.sq').forEach(sq => {
      const sqName = sq.dataset.sq;
      // Clear dynamic content (keep coord spans)
      sq.querySelectorAll('.piece, .dot, .capture-ring').forEach(e => e.remove());
      sq.classList.remove('selected', 'last-move-from', 'last-move-to', 'best-move');

      // Piece
      const piece = this.chess.get(sqName);
      if (piece) {
        const key = piece.color + piece.type.toUpperCase();
        const p = document.createElement('img');
        p.className = 'piece';
        p.src = PIECE_CDN + key + '.svg';
        p.alt = key;
        p.dataset.color = piece.color;
        sq.appendChild(p);
      }

      // Legal move dots
      if (this.legalDests.includes(sqName)) {
        if (piece) {
          const ring = document.createElement('div');
          ring.className = 'capture-ring';
          sq.appendChild(ring);
        } else {
          const dot = document.createElement('div');
          dot.className = 'dot';
          sq.appendChild(dot);
        }
      }

      // Highlights
      if (this.selected === sqName) sq.classList.add('selected');
      if (this.lastMove?.from === sqName) sq.classList.add('last-move-from');
      if (this.lastMove?.to   === sqName) sq.classList.add('last-move-to');
      if (this.highlighted?.from === sqName) sq.classList.add('best-move-from');
      if (this.highlighted?.to   === sqName) sq.classList.add('best-move');
    });
  }

  _handleClick(sqName) {
    const piece = this.chess.get(sqName);

    // If a square is already selected
    if (this.selected) {
      // Try to make the move
      const move = this.chess.move({ from: this.selected, to: sqName, promotion: 'q' });
      if (move) {
        this.lastMove = { from: move.from, to: move.to };
        this.selected = null;
        this.legalDests = [];
        this.highlighted = null;
        this._clearAiArrows();
        this.render();
        this.onMove(move);
        return;
      }
      // Clicked another own piece — reselect
      if (piece && piece.color === this.chess.turn()) {
        this._select(sqName);
        return;
      }
      // Deselect
      this.selected = null;
      this.legalDests = [];
      this.render();
      return;
    }

    // Select own piece
    if (piece && piece.color === this.chess.turn()) {
      this._select(sqName);
    }
  }

  _select(sqName) {
    this.selected = sqName;
    this.legalDests = this.chess.moves({ square: sqName, verbose: true }).map(m => m.to);
    this.render();
  }

  // Programmatically make a move (engine move)
  applyMove(uci) {
    const from = uci.slice(0, 2);
    const to   = uci.slice(2, 4);
    const promo = uci[4] || 'q';
    const move = this.chess.move({ from, to, promotion: promo });
    if (move) {
      this.lastMove = { from, to };
      this.selected = null;
      this.legalDests = [];
      this.highlighted = null;
      this.render();
    }
    return move;
  }

  // Show best move with arrow and highlighted squares
  flashBestMove(uci, durationMs = 3000) {
    if (!uci) return;
    const from = uci.slice(0, 2);
    const to   = uci.slice(2, 4);
    this._clearAiArrows();
    this.highlighted = { from, to };
    this.render();
    this._drawArrow(from, to, 'rgba(0,200,80,0.88)', 'ai-arrow');
    setTimeout(() => {
      this.highlighted = null;
      this._clearAiArrows();
      this.render();
    }, durationMs);
  }

  _squareCenter(sqName) {
    const fi = this._files().indexOf(sqName[0]);
    const ri = this._ranks().indexOf(parseInt(sqName[1]));
    return { x: fi + 0.5, y: ri + 0.5 };
  }

  _clearAiArrows() {
    if (this.arrowSvg) this.arrowSvg.querySelectorAll('.ai-arrow').forEach(e => e.remove());
  }

  _clearArrows() {
    this._clearAiArrows();
    if (this.arrowSvg) this.arrowSvg.querySelectorAll('.user-arrow').forEach(e => e.remove());
    this.userArrows = [];
  }

  _drawArrow(from, to, color, cls) {
    const fc = this._squareCenter(from);
    const tc = this._squareCenter(to);
    const dx = tc.x - fc.x, dy = tc.y - fc.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.1) return;
    const ux = dx / len, uy = dy / len;
    const px = -uy,  py = ux; // perpendicular

    const SW  = 0.14;                        // shaft half-width
    const HW  = 0.28;                        // head half-width
    const HL  = Math.min(0.45, len * 0.45); // head length
    const gap = 0.22;                        // gap from source center

    const sx  = fc.x + ux * gap, sy  = fc.y + uy * gap;
    const hbx = tc.x - ux * HL,  hby = tc.y - uy * HL;

    const pts = [
      [sx  + px*SW,  sy  + py*SW],
      [hbx + px*SW,  hby + py*SW],
      [hbx + px*HW,  hby + py*HW],
      [tc.x,         tc.y        ],
      [hbx - px*HW,  hby - py*HW],
      [hbx - px*SW,  hby - py*SW],
      [sx  - px*SW,  sy  - py*SW],
    ].map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(' ');

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', pts);
    poly.setAttribute('fill', color);
    poly.setAttribute('opacity', '0.88');
    poly.classList.add(cls);
    this.arrowSvg.appendChild(poly);
  }

  _setupArrowDraw() {
    let dragFrom = null;

    this.el.addEventListener('contextmenu', e => e.preventDefault());

    this.el.addEventListener('mousedown', e => {
      if (e.button !== 2) return;
      e.preventDefault();
      const sq = e.target.closest('[data-sq]');
      dragFrom = sq ? sq.dataset.sq : null;
    });

    this.el.addEventListener('mouseup', e => {
      if (e.button !== 2) return;
      e.preventDefault();
      const sq = e.target.closest('[data-sq]');
      const dragTo = sq ? sq.dataset.sq : null;

      if (dragFrom && dragTo && dragFrom !== dragTo) {
        this.userArrows.push({ from: dragFrom, to: dragTo });
        this._drawArrow(dragFrom, dragTo, 'rgba(235,145,0,0.88)', 'user-arrow');
      } else {
        // Click without drag — clear user arrows
        this.arrowSvg.querySelectorAll('.user-arrow').forEach(e => e.remove());
        this.userArrows = [];
      }
      dragFrom = null;
    });
  }

  flip(flipped) {
    this.flipped = flipped;
    this._build();
  }

  setInteractive(val) {
    this.interactive = val;
    // Rebuild to rewire (or strip) listeners
    this._build();
  }

  // Load a position from FEN without affecting game state
  loadFen(fen) {
    this.chess.load(fen);
    this.selected = null;
    this.legalDests = [];
    this.lastMove = null;
    this.render();
  }
}
