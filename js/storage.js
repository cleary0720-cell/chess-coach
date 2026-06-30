const Storage = (() => {
  const KEY_GAMES    = 'chess_games';
  const KEY_STATS    = 'chess_stats';
  const KEY_SETTINGS = 'chess_settings';
  const KEY_PUZZLES  = 'chess_puzzles';

  function get(key, def) {
    try { return JSON.parse(localStorage.getItem(key)) ?? def; }
    catch { return def; }
  }
  function set(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  return {
    getGames()    { return get(KEY_GAMES, []); },
    getStats()    { return get(KEY_STATS, { gamesPlayed:0, wins:0, losses:0, draws:0, avgAccuracy:0, avgACPL:0, eloHistory:[], recommendedSkillLevel:10 }); },
    getSettings() { return get(KEY_SETTINGS, { skillLevel:10, playerColor:'white', showCoaching:true }); },
    getPuzzles()  { return get(KEY_PUZZLES, { solved:[], streak:0, byTheme:{} }); },

    saveGame(gameObj) {
      const games = this.getGames();
      games.unshift(gameObj); // newest first
      if (games.length > 100) games.pop();
      set(KEY_GAMES, games);
      this.recalcStats();
    },

    recalcStats() {
      const games = this.getGames();
      if (!games.length) return;
      const recent = games.slice(0, 10);
      const avgACPL = recent.reduce((s, g) => s + (g.acpl || 0), 0) / recent.length;
      const avgAccuracy = recent.reduce((s, g) => s + (g.accuracy || 0), 0) / recent.length;
      const estimatedElo = games.length >= 3 ? acplToElo(avgACPL) : null;
      const stats = {
        gamesPlayed: games.length,
        wins:   games.filter(g => g.result === 'win').length,
        losses: games.filter(g => g.result === 'loss').length,
        draws:  games.filter(g => g.result === 'draw').length,
        avgACPL: Math.round(avgACPL),
        avgAccuracy: Math.round(avgAccuracy * 10) / 10,
        estimatedElo,
        eloHistory: games.slice(0, 20).map(g => g.eloAfter).filter(Boolean).reverse(),
        recommendedSkillLevel: estimatedElo ? eloToSkillLevel(estimatedElo + 150) : 10,
      };
      set(KEY_STATS, stats);
      return stats;
    },

    saveSettings(s) { set(KEY_SETTINGS, { ...this.getSettings(), ...s }); },

    savePuzzleResult(id, solved, angle) {
      const p = this.getPuzzles();
      if (!p.solved.includes(id)) p.solved.push(id);
      if (solved) {
        p.streak = (p.streak || 0) + 1;
        if (angle) {
          p.byTheme[angle] = p.byTheme[angle] || { solved: 0, attempted: 0 };
          p.byTheme[angle].solved++;
        }
      } else {
        p.streak = 0;
      }
      if (angle) {
        p.byTheme[angle] = p.byTheme[angle] || { solved: 0, attempted: 0 };
        p.byTheme[angle].attempted++;
      }
      set(KEY_PUZZLES, p);
      return p;
    },
  };
})();

function acplToElo(acpl) {
  return Math.min(2800, Math.max(400, Math.round(3000 - acpl * 16)));
}

function acplToAccuracy(acpl) {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * acpl) - 3.1669));
}

function eloToSkillLevel(elo) {
  const table = [
    [800,0],[900,1],[1000,2],[1100,3],[1200,4],[1300,5],[1400,6],[1500,7],
    [1600,8],[1700,9],[1800,10],[1900,11],[2000,12],[2100,13],[2200,14],
    [2300,15],[2400,16],[2500,17],[2600,18],[2700,19],[3000,20],
  ];
  return table.reduce((best, [e, s]) =>
    Math.abs(e - elo) < Math.abs(best[0] - elo) ? [e, s] : best
  )[1];
}

function classifyMove(cpLoss) {
  if (cpLoss <= 10)  return { label:'Best',        cls:'best',       symbol:'!!' };
  if (cpLoss <= 25)  return { label:'Excellent',   cls:'excellent',  symbol:'!'  };
  if (cpLoss <= 50)  return { label:'Good',        cls:'good',       symbol:''   };
  if (cpLoss <= 100) return { label:'Inaccuracy',  cls:'inaccuracy', symbol:'?!' };
  if (cpLoss <= 200) return { label:'Mistake',     cls:'mistake',    symbol:'?'  };
  return               { label:'Blunder',     cls:'blunder',    symbol:'??' };
}

function gamePhase(moveNumber) {
  if (moveNumber <= 10) return 'opening';
  if (moveNumber <= 30) return 'middlegame';
  return 'endgame';
}
