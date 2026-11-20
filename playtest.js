import { ACT1_POOL, ACT2_POOL, OPPONENTS, ROOM, formatTennisScore, isMatchWon } from './logic.js';

// Mouse samples are positions, not a velocity command. Apply once per rendered
// frame, before fixed physics steps, so there is no easing or 120 Hz quantisation.
export function applyMouseSample(pad, input, dt, room = ROOM) {
  const maxX = room.halfW - pad.width * 0.5;
  const maxY = room.halfH - pad.height * 0.5;
  const x = Math.max(-1, Math.min(1, input.targetNormX)) * maxX;
  const y = Math.max(-1, Math.min(1, input.targetNormY)) * maxY;
  pad.prevX = pad.x;
  pad.prevY = pad.y;
  // Use display-frame time, not one physics substep. Keep the measured swipe
  // velocity through every substep in this frame so spin is not lost at impact.
  const elapsed = Math.max(dt, 1 / 240);
  pad.vx = (x - pad.x) / elapsed;
  pad.vy = (y - pad.y) / elapsed;
  pad.x = x;
  pad.y = y;
}

export function getScoreCall(score) {
  const fmt = formatTennisScore(score);
  if (score.winner) return score.winner === 'player' ? 'Match to you.' : 'Match to opponent.';
  if (fmt.isDecidingPoint) return 'Deuce. Deciding point. Next point wins.';
  let call = fmt.isDeuce || fmt.isAdvantage
    ? fmt.announcerText.replace('viewer', 'you').replace('broadcast', 'opponent')
    : `You ${fmt.playerLabel === '0' ? 'love' : fmt.playerLabel}. Opponent ${fmt.opponentLabel === '0' ? 'love' : fmt.opponentLabel}.`;
  if (isMatchWon(score.playerPoints + 1, score.opponentPoints, score.quickDeuce)) call += ' Match point, you.';
  if (isMatchWon(score.playerPoints, score.opponentPoints + 1, score.quickDeuce)) call += ' Match point, opponent.';
  return call;
}

// Keep the urgent part first so an immediate serve cannot hide match point.
// The HUD labels the score order as YOU, then OPPONENT.
export function getSpokenScoreCall(score) {
  const fmt = formatTennisScore(score);
  if (score.winner || fmt.isDeuce || fmt.isAdvantage) return getScoreCall(score);
  const call = getScoreCall(score);
  const urgent = call.includes('Match point, you.') ? 'Match point, you. '
    : call.includes('Match point, opponent.') ? 'Match point, opponent. ' : '';
  const word = label => label === '0' ? 'Love' : label;
  return `${urgent}${word(fmt.playerLabel)}. ${word(fmt.opponentLabel)}.`;
}

export function getRunRoute(run) {
  const fixed = { 5: 'bono', 6: 'elton_john', 7: 'david_bowie', 8: 'lou_reed' };
  return Array.from({ length: 9 }, (_, index) => {
    const past = index < run.matchIndex;
    const current = index === run.matchIndex;
    let ids, type;
    if (fixed[index]) { ids = [fixed[index]]; type = 'fixed'; }
    else if (past) { ids = [run.usedOpponents[index]].filter(Boolean); type = 'played'; }
    else if (current) { ids = [...run.offeredOpponents]; type = 'offered'; }
    else { ids = (index < 3 ? ACT1_POOL : ACT2_POOL).filter(id => !run.usedOpponents.includes(id)); type = 'pool'; }
    return { index, act: Math.floor(index / 3) + 1, past, current, type, ids, names: ids.map(id => OPPONENTS[id].name) };
  });
}
