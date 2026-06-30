// Vanilla chess board renderer. Wraps chess.js.
// Usage: const b = new ChessBoard('board-element-id', chess, { onMove, flipped });

const PIECE_CDN = 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/piece/cburnett/';
const PIECE_UNICODE = {
  wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟',
};

class ChessBoard {
  constructor(containerId, chess, opts = {}) {
    this.el       = document.getElementById(containerId);
    this.chess    = chess;
    this.onMove   = opts.onMove || (() => {});
    this.flipped  = opts.flipped || false;
    this.interactive = opts.interactive !== false;
    this.selected = null;      // currently clicked square
    this.legalDests = [];
    this.lastMove = null;      // { from, to }
    this.highlighted = null;   // best-move square to flash
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
      if (this.highlighted === sqName)   sq.classList.add('best-move');
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

  // Flash the best move square briefly
  flashBestMove(uci, durationMs = 2500) {
    if (!uci) return;
    const to = uci.slice(2, 4);
    this.highlighted = to;
    this.render();
    setTimeout(() => {
      this.highlighted = null;
      this.render();
    }, durationMs);
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
