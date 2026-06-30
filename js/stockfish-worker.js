// Proxy between app.js (structured commands) and stockfish.js (raw UCI strings).
// stockfish.js overrides self.onmessage and calls postMessage(line) for output.

const _post = self.postMessage.bind(self);
let sfHandler = null;
let infoLines = [];

// Intercept stockfish's postMessage(line) calls before it's loaded
self.postMessage = function(line) {
  if (typeof line !== 'string') return;
  _post({ type: 'output', line });
  if (line.startsWith('bestmove')) {
    const parts = line.split(' ');
    _post({ type: 'bestmove', bestMove: parts[1], ponder: parts[3] || null, infoLines: infoLines.slice() });
    infoLines = [];
  } else if (line.startsWith('info') && line.includes('score')) {
    infoLines.push(line);
  }
};

// Load stockfish — sets self.onmessage to its UCI handler
importScripts('../lib/stockfish.js');

// Capture stockfish's handler, replace with our own
sfHandler = self.onmessage;

function send(str) { sfHandler.call(self, { data: str }); }

self.onmessage = function(event) {
  const { cmd, payload } = event.data;
  switch (cmd) {
    case 'init':
      send('uci');
      send('setoption name Hash value 64');
      send('isready');
      break;
    case 'setSkill':
      send(`setoption name Skill Level value ${payload.level}`);
      break;
    case 'analyzePosition':
      send('stop');
      infoLines = [];
      send(`position fen ${payload.fen}`);
      send('setoption name Skill Level value 20');
      send(`go depth ${payload.depth || 12}`);
      break;
    case 'makeMove':
      send('stop');
      infoLines = [];
      send(`setoption name Skill Level value ${payload.skillLevel}`);
      send(`position startpos moves ${payload.moves}`);
      send(`go movetime ${payload.movetime || 1000}`);
      break;
    case 'stop':
      send('stop');
      break;
  }
};
