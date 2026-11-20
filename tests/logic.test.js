import assert from 'node:assert/strict';
import {
  createMatchScore,
  scorePoint,
  formatTennisScore,
} from '../logic.js';

function playSequence(seq, opts = {}) {
  let state = createMatchScore(opts);
  for (const who of seq) {
    state = scorePoint(state, who);
  }
  return state;
}

// 1. 0-0 initial state
{
  const s = createMatchScore();
  const fmt = formatTennisScore(s);
  assert.equal(fmt.playerLabel, '0');
  assert.equal(fmt.opponentLabel, '0');
  assert.equal(fmt.winner, null);
  assert.equal(s.server, 'player');
}

// 2. Clean 4-0 win
{
  let s = createMatchScore();
  s = scorePoint(s, 'player');
  assert.equal(formatTennisScore(s).statusText, '15 - 0');
  s = scorePoint(s, 'player');
  assert.equal(formatTennisScore(s).statusText, '30 - 0');
  s = scorePoint(s, 'player');
  assert.equal(formatTennisScore(s).statusText, '40 - 0');
  s = scorePoint(s, 'player');
  assert.equal(s.winner, 'player');
  assert.equal(formatTennisScore(s).statusText, 'GAME PLAYER');
}

// 3. 4-2 and 5-3 wins
{
  const s42 = playSequence(['player', 'opponent', 'player', 'opponent', 'player', 'player']);
  assert.equal(s42.playerPoints, 4);
  assert.equal(s42.opponentPoints, 2);
  assert.equal(s42.winner, 'player');

  const s53 = playSequence([
    'player', 'player', 'player',
    'opponent', 'opponent', 'opponent',
    'opponent', 'opponent',
  ]);
  assert.equal(s53.playerPoints, 3);
  assert.equal(s53.opponentPoints, 5);
  assert.equal(s53.winner, 'opponent');
}

// 4. 3-3 Deuce, Advantage, back to Deuce, 4-3 NOT a win
{
  let s = playSequence(['player', 'opponent', 'player', 'opponent', 'player', 'opponent']);
  assert.equal(s.winner, null);
  let fmt = formatTennisScore(s);
  assert.equal(fmt.isDeuce, true);
  assert.equal(fmt.deuceCount, 1);

  // 4-3 is Advantage, NOT a win
  s = scorePoint(s, 'player');
  assert.equal(s.playerPoints, 4);
  assert.equal(s.opponentPoints, 3);
  assert.equal(s.winner, null);
  fmt = formatTennisScore(s);
  assert.equal(fmt.isAdvantage, true);
  assert.equal(fmt.playerLabel, 'AD');

  // Back to 4-4 Deuce #2
  s = scorePoint(s, 'opponent');
  assert.equal(s.winner, null);
  fmt = formatTennisScore(s);
  assert.equal(fmt.isDeuce, true);
  assert.equal(fmt.deuceCount, 2);

  // Strict mode: 5-5 is Deuce #3, then 6-5 is still Advantage, 7-5 wins
  s = scorePoint(s, 'player'); // 5-4 Ad
  s = scorePoint(s, 'opponent'); // 5-5 Deuce #3
  assert.equal(s.winner, null);
  assert.equal(formatTennisScore(s).deuceCount, 3);
  assert.equal(formatTennisScore(s).isDecidingPoint, false);

  s = scorePoint(s, 'player'); // 6-5 Ad
  assert.equal(s.winner, null);
  s = scorePoint(s, 'player'); // 7-5 Win
  assert.equal(s.winner, 'player');
}

// 5. Quick deuce ON: 3rd deuce (5-5) is deciding point
{
  let s = playSequence(
    [
      'player', 'opponent', 'player', 'opponent', 'player', 'opponent', // 3-3 Deuce 1
      'player', 'opponent', // 4-4 Deuce 2
      'player', 'opponent', // 5-5 Deuce 3
    ],
    { quickDeuce: true }
  );
  assert.equal(s.winner, null);
  const fmt = formatTennisScore(s);
  assert.equal(fmt.isDecidingPoint, true);
  assert.equal(fmt.statusText, 'DECIDING POINT');

  s = scorePoint(s, 'opponent'); // 5-6 wins immediately
  assert.equal(s.winner, 'opponent');
}

// 6. Serve alternation
{
  let s = createMatchScore({ firstServer: 'player' });
  assert.equal(s.server, 'player');
  s = scorePoint(s, 'player');
  assert.equal(s.server, 'opponent');
  s = scorePoint(s, 'opponent');
  assert.equal(s.server, 'player');
  s = scorePoint(s, 'player');
  assert.equal(s.server, 'opponent');
}

// 7. No further points after match won
{
  const s = playSequence(['player', 'player', 'player', 'player', 'opponent']);
  assert.equal(s.playerPoints, 4);
  assert.equal(s.opponentPoints, 0);
  assert.equal(s.winner, 'player');
}

console.log('All Step 0 logic tests passed.');
