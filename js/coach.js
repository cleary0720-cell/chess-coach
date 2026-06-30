// Claude Haiku coaching via Cloudflare Worker proxy
// Update PROXY_URL after deploying the worker

const PROXY_URL = 'https://chess-claude-proxy.cleary0720.workers.dev';

const SYSTEM_PROMPT = `You are a friendly, encouraging chess coach helping a beginner get better at chess.
Give concise, specific feedback — 2 to 3 sentences max. Always be specific to the position, never generic.
Reference chess concepts by name (pin, fork, hanging piece, discovered attack, etc.) but always explain what the term means in plain English for this exact position.
When the player blundered, be honest but constructive — explain what went wrong and what to look for next time.
CRITICAL: Never use chess notation abbreviations on their own. Always write moves in plain English, like "Bishop to b5, giving check" or "pawn captures on d5" — never just "Bb5+" or "exd5". The player is a beginner who does not know chess notation.
STRICT ACCURACY RULE: Only state the location of pieces you are given explicitly in the move data below. NEVER guess or infer where other pieces are from the FEN — you may misread it. If you want to mention a piece's location, only do so if it is the piece being moved or the piece being captured. Do not mention where the king, rooks, or any other piece is unless that information is directly given to you.`;

const PIECE_NAMES = {K:'King', Q:'Queen', R:'Rook', B:'Bishop', N:'Knight'};
function pieceFromSAN(san) {
  if (!san) return 'piece';
  if (san.startsWith('O')) return 'King (castling)';
  return PIECE_NAMES[san[0]] || 'Pawn';
}

async function getCoaching(ctx) {
  const { moveNumber, playerColor, userMoveSAN, userMoveUCI, bestMoveSAN, bestMoveUCI, cpLoss, quality, fenBefore, phase } = ctx;

  const userPiece = pieceFromSAN(userMoveSAN);
  const userFrom  = userMoveUCI ? userMoveUCI.slice(0,2) : '?';
  const userTo    = userMoveUCI ? userMoveUCI.slice(2,4) : '?';
  const bestPiece = pieceFromSAN(bestMoveSAN);
  const bestFrom  = bestMoveUCI ? bestMoveUCI.slice(0,2) : '?';
  const bestTo    = bestMoveUCI ? bestMoveUCI.slice(2,4) : '?';

  const isGreatMove = cpLoss <= 25;
  const instruction = isGreatMove
    ? `This was a ${quality.toLowerCase()} move. In 2 sentences, explain what makes moving the ${userPiece} from ${userFrom} to ${userTo} strong here.`
    : `In 2–3 sentences: (1) explain what's wrong with moving the ${userPiece} from ${userFrom} to ${userTo}, (2) explain what moving the ${bestPiece} from ${bestFrom} to ${bestTo} achieves instead.`;

  const techniqueNote = ctx.focusTechnique
    ? `\nFocus technique: ${ctx.focusTechnique}. After your main feedback, add one sentence if there is a clear ${ctx.focusTechnique} opportunity in the current position. If none, do not mention it.`
    : '';

  const userMessage = `Move ${moveNumber} — ${playerColor} to play.
Player moved: ${userPiece} from ${userFrom} to ${userTo} (centipawn loss: ${cpLoss}cp — ${quality})
Stockfish's best: ${bestPiece} from ${bestFrom} to ${bestTo}
Game phase: ${phase}
FEN (for context only — do NOT describe positions of pieces not listed above): ${fenBefore}

${instruction}${techniqueNote}`;

  try {
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) throw new Error('Worker error: ' + response.status);
    const data = await response.json();
    return data.content?.[0]?.text || 'Analysis complete.';
  } catch (err) {
    console.warn('Coaching fetch failed:', err);
    return fallbackCoaching(cpLoss, quality, userMoveSAN, bestMoveSAN);
  }
}

async function getSuggestionCoaching({ uci, moveSAN, pieceName, fromSq, toSq, playerColor, phase }) {
  const userMessage = `The player (${playerColor}) asked for a move suggestion. Game phase: ${phase}.
Suggested move: Move your ${pieceName} from ${fromSq} to ${toSq}.

In 2-3 sentences, explain in plain English why this is a good move. What does it accomplish — what threat does it create, what piece does it develop, or what weakness does it fix? Only describe the ${pieceName} being moved and pieces it directly interacts with. Do not describe the location of any other pieces. Write for a beginner.`;

  try {
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!response.ok) throw new Error('Worker error: ' + response.status);
    const data = await response.json();
    return data.content?.[0]?.text || 'This is a strong move for your position.';
  } catch(err) {
    console.warn('Suggestion coaching failed:', err);
    throw err;
  }
}

// Offline fallback if Worker is not yet deployed or errors
function fallbackCoaching(cpLoss, quality, userMoveSAN, bestMoveSAN) {
  if (cpLoss <= 10)  return `Great move! ${userMoveSAN} was the best choice in this position.`;
  if (cpLoss <= 25)  return `Excellent move — ${userMoveSAN} is very strong here.`;
  if (cpLoss <= 50)  return `Good move. ${bestMoveSAN} was marginally better, but ${userMoveSAN} is solid.`;
  if (cpLoss <= 100) return `Slight inaccuracy. ${bestMoveSAN} would have been stronger here — it gives a better advantage.`;
  if (cpLoss <= 200) return `Mistake! ${userMoveSAN} costs some advantage. ${bestMoveSAN} was the right move to keep your position strong.`;
  return `Blunder! ${userMoveSAN} gives away significant advantage. ${bestMoveSAN} was the best response here.`;
}
