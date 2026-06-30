// Claude Haiku coaching via Cloudflare Worker proxy
// Update PROXY_URL after deploying the worker

const PROXY_URL = 'https://chess-claude-proxy.cleary0720.workers.dev';

const SYSTEM_PROMPT = `You are a friendly, encouraging chess coach helping a beginner get better at chess.
Give concise, specific feedback — 2 to 3 sentences max. Always be specific to the position, never generic.
Reference chess concepts by name (pin, fork, hanging piece, discovered attack, etc.) but always explain what the term means in plain English for this exact position.
When the player blundered, be honest but constructive — explain what went wrong and what to look for next time.
CRITICAL: Never use chess notation abbreviations on their own. Always write moves in plain English, like "Bishop to b5, giving check" or "pawn captures on d5" — never just "Bb5+" or "exd5". The player is a beginner who does not know chess notation.`;

async function getCoaching(ctx) {
  const { moveNumber, playerColor, userMoveSAN, userMoveUCI, bestMoveSAN, bestMoveUCI, cpLoss, quality, fenBefore, fenAfter, phase } = ctx;

  const isGreatMove = cpLoss <= 25;
  const instruction = isGreatMove
    ? `This was a ${quality.toLowerCase()} move. In 2 sentences, explain what makes ${userMoveSAN} strong in this position.`
    : `In 2–3 sentences: (1) explain concisely what's wrong with ${userMoveSAN} or what it misses, (2) explain what ${bestMoveSAN} achieves instead. Be specific to the position.`;

  const techniqueNote = ctx.focusTechnique
    ? `\nFocus technique this session: ${ctx.focusTechnique}. After your main feedback, add one sentence if there is a ${ctx.focusTechnique} opportunity available for ${playerColor} in the current position. If none exists, do not mention it.`
    : '';

  const userMessage = `Move ${moveNumber} — playing as ${playerColor}.
Player played: ${userMoveSAN} (${userMoveUCI})
Stockfish's best move: ${bestMoveSAN} (${bestMoveUCI})
Centipawn loss: ${cpLoss}cp — classified as: ${quality}
Game phase: ${phase}
FEN before the move: ${fenBefore}

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

// Offline fallback if Worker is not yet deployed or errors
function fallbackCoaching(cpLoss, quality, userMoveSAN, bestMoveSAN) {
  if (cpLoss <= 10)  return `Great move! ${userMoveSAN} was the best choice in this position.`;
  if (cpLoss <= 25)  return `Excellent move — ${userMoveSAN} is very strong here.`;
  if (cpLoss <= 50)  return `Good move. ${bestMoveSAN} was marginally better, but ${userMoveSAN} is solid.`;
  if (cpLoss <= 100) return `Slight inaccuracy. ${bestMoveSAN} would have been stronger here — it gives a better advantage.`;
  if (cpLoss <= 200) return `Mistake! ${userMoveSAN} costs some advantage. ${bestMoveSAN} was the right move to keep your position strong.`;
  return `Blunder! ${userMoveSAN} gives away significant advantage. ${bestMoveSAN} was the best response here.`;
}
