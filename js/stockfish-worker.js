importScripts('https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js');

let engine = Stockfish();
let pendingCallback = null;
let infoLines = [];

engine.onmessage = function(event) {
  const line = typeof event === 'object' ? event.data : event;

  self.postMessage({ type: 'output', line });

  if (line.startsWith('bestmove')) {
    const parts = line.split(' ');
    const bestMove = parts[1];
    const ponder   = parts[3] || null;
    self.postMessage({ type: 'bestmove', bestMove, ponder, infoLines: infoLines.slice() });
    infoLines = [];
  } else if (line.startsWith('info') && line.includes('score')) {
    infoLines.push(line);
  }
};

self.onmessage = function(event) {
  const { cmd, payload } = event.data;

  switch (cmd) {
    case 'init':
      engine.postMessage('uci');
      engine.postMessage('setoption name Hash value 64');
      engine.postMessage('isready');
      break;

    case 'setSkill':
      engine.postMessage(`setoption name Skill Level value ${payload.level}`);
      break;

    case 'analyzePosition':
      // Evaluate a position to get its score and best move
      // payload: { fen, depth }
      engine.postMessage('stop');
      infoLines = [];
      engine.postMessage(`position fen ${payload.fen}`);
      engine.postMessage(`setoption name Skill Level value 20`); // always max for analysis
      engine.postMessage(`go depth ${payload.depth || 18}`);
      break;

    case 'makeMove':
      // Let engine play a move with the given skill level
      // payload: { moves (space-sep UCI from start), skillLevel, movetime }
      engine.postMessage('stop');
      infoLines = [];
      engine.postMessage(`setoption name Skill Level value ${payload.skillLevel}`);
      engine.postMessage(`position startpos moves ${payload.moves}`);
      engine.postMessage(`go movetime ${payload.movetime || 1000}`);
      break;

    case 'stop':
      engine.postMessage('stop');
      break;
  }
};
