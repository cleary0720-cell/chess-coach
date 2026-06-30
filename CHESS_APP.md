# Chess Coach App — Project Reference

## What this is
A browser-based chess improvement platform. Play vs Stockfish AI with real-time Claude coaching after every move, track ELO over time, practice tactics puzzles, and study mini-lessons.

## Tech Stack
- **Frontend:** Vanilla HTML/CSS/JavaScript — no framework, no build step
- **Chess logic:** chess.js 0.10.3 (`lib/chess.min.js`)
- **Chess engine:** Stockfish.js 10.0.2 via CDN, running in a Web Worker (`js/stockfish-worker.js`)
- **AI Coaching:** Claude Haiku via Cloudflare Worker proxy (`worker/claude-proxy/`)
- **Puzzles:** Lichess Puzzle API (free, no auth) — `https://lichess.org/api/puzzle/next`
- **Storage:** localStorage (all keys prefixed `chess_`)
- **Deployment:** GitHub Pages

## File Structure
```
chess-coach/
├── index.html          Play page (main game)
├── lessons.html        Tactics puzzles + mini-lessons
├── history.html        Game history + post-game review
├── stats.html          ELO estimate, accuracy charts
├── css/style.css       All shared styles
├── js/
│   ├── app.js          Game controller (uses board.js, coach.js, storage.js)
│   ├── stockfish-worker.js  Web Worker — owns the Stockfish engine
│   ├── coach.js        Claude Haiku API calls — update PROXY_URL here
│   ├── storage.js      localStorage helpers + ELO/accuracy math
│   ├── board.js        ChessBoard class — renders FEN, handles moves
│   ├── lessons.js      Lichess puzzle fetch, puzzle validation, mini-lessons
│   ├── history.js      Game history list, move-by-move replay
│   └── stats.js        ELO trend, accuracy charts (raw Canvas)
├── lib/chess.min.js    Chess.js bundled locally
├── worker/claude-proxy/
│   ├── index.js        Cloudflare Worker source
│   └── wrangler.toml   Worker config
└── CHESS_APP.md        This file
```

## Deployment Steps

### 1. GitHub Pages
```bash
cd chess-coach
git init
git add .
git commit -m "Initial chess coach app"
gh repo create chess-coach --public --source=. --push
# Then enable Pages in repo Settings → Pages → Deploy from branch: main
```

### 2. Cloudflare Worker (Claude Proxy)
```bash
cd worker/claude-proxy
npm install -g wrangler   # if not already installed
# Edit wrangler.toml — set ALLOWED_ORIGIN to your GitHub Pages URL
wrangler deploy
wrangler secret put ANTHROPIC_API_KEY   # paste your Anthropic API key
```

### 3. Wire it up
After deploying the Worker:
- Copy your Worker URL (e.g., `https://chess-claude-proxy.YOUR_NAME.workers.dev`)
- Update `PROXY_URL` in `js/coach.js`
- Commit and push

## Configuration

### To change Claude coaching behavior
Edit `SYSTEM_PROMPT` and `buildCoachingPrompt` in `js/coach.js`.

### To change Stockfish analysis depth
Edit `depth` values in `js/app.js` (currently 18 for pre-move, 15 for post-move analysis).

### To add/edit mini-lessons
Edit the `LESSONS` object in `js/lessons.js` — each entry has `icon`, `title`, `desc`, and `content` (HTML string).

## ELO Estimation Formula
```
estimatedElo = clamp(3000 - (ACPL × 16), 400, 2800)
accuracy     = 103.1668 × e^(-0.04354 × ACPL) - 3.1669
```
Requires 3+ games. Uses last 10 games for rolling average.

## Cost
~$0.00064 per coaching call (Claude Haiku).
At 160 calls/hour (coaching every move): ~$0.10/hour → ~$37/year.

## Move Quality Thresholds (cp loss)
| Label      | CP Loss |
|------------|---------|
| Best !!    | 0–10    |
| Excellent! | 11–25   |
| Good       | 26–50   |
| Inaccuracy | 51–100  |
| Mistake    | 101–200 |
| Blunder    | 200+    |

## Known Issues / Future Work
- [ ] Add sound effects (move, capture, check)
- [ ] Board theme switcher (wooden, green, blue)
- [ ] Mobile portrait layout polish
- [ ] PGN export button
- [ ] Support pawn promotion UI (currently auto-promotes to queen)
