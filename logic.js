/**
 * Pure game logic for Perfect Day Pong.
 * Runs in both browser (ES module) and Node.js tests with zero dependencies.
 */

const POINT_LABELS = ['0', '15', '30', '40'];

export function createMatchScore({ quickDeuce = false, firstServer = 'player' } = {}) {
  return {
    playerPoints: 0,
    opponentPoints: 0,
    quickDeuce: Boolean(quickDeuce),
    firstServer: firstServer === 'opponent' ? 'opponent' : 'player',
    server: firstServer === 'opponent' ? 'opponent' : 'player',
    pointNumber: 0,
    deuceCount: 0,
    winner: null,
    lastScorer: null,
  };
}

export function isMatchWon(playerPoints, opponentPoints, quickDeuce = false) {
  if (playerPoints >= 4 || opponentPoints >= 4) {
    const diff = Math.abs(playerPoints - opponentPoints);
    if (diff >= 2) {
      return playerPoints > opponentPoints ? 'player' : 'opponent';
    }
    // Quick deuce: 3rd deuce (5-5) is a single deciding point, so reaching 6-5 or 5-6 wins.
    if (quickDeuce && Math.min(playerPoints, opponentPoints) >= 5 && diff >= 1) {
      return playerPoints > opponentPoints ? 'player' : 'opponent';
    }
  }
  return null;
}

export function getDeuceCount(playerPoints, opponentPoints) {
  if (playerPoints >= 3 && opponentPoints >= 3 && playerPoints === opponentPoints) {
    return playerPoints - 2; // 3-3 => 1, 4-4 => 2, 5-5 => 3
  }
  return Math.max(0, Math.min(playerPoints, opponentPoints) - 2);
}

export function scorePoint(state, scorer) {
  if (scorer !== 'player' && scorer !== 'opponent') {
    throw new Error(`Invalid scorer: ${scorer}`);
  }
  if (state.winner) {
    return state;
  }

  const playerPoints = state.playerPoints + (scorer === 'player' ? 1 : 0);
  const opponentPoints = state.opponentPoints + (scorer === 'opponent' ? 1 : 0);
  const pointNumber = state.pointNumber + 1;
  const winner = isMatchWon(playerPoints, opponentPoints, state.quickDeuce);
  const deuceCount = getDeuceCount(playerPoints, opponentPoints);
  const otherServer = state.firstServer === 'player' ? 'opponent' : 'player';
  const server = pointNumber % 2 === 0 ? state.firstServer : otherServer;

  return {
    ...state,
    playerPoints,
    opponentPoints,
    pointNumber,
    deuceCount,
    winner,
    lastScorer: scorer,
    server: winner ? state.server : server,
  };
}

export function formatTennisScore(state) {
  const { playerPoints, opponentPoints, quickDeuce, winner, deuceCount } = state;

  if (winner) {
    return {
      playerLabel: winner === 'player' ? 'GAME' : '',
      opponentLabel: winner === 'opponent' ? 'GAME' : '',
      statusText: winner === 'player' ? 'GAME PLAYER' : 'GAME OPPONENT',
      announcerText: winner === 'player' ? 'Game.' : 'Game to opponent.',
      isDeuce: false,
      isAdvantage: false,
      isDecidingPoint: false,
      deuceCount,
      winner,
    };
  }

  if (playerPoints >= 3 && opponentPoints >= 3) {
    if (playerPoints === opponentPoints) {
      const isDecidingPoint = quickDeuce && deuceCount >= 3;
      return {
        playerLabel: '40',
        opponentLabel: '40',
        statusText: isDecidingPoint ? 'DECIDING POINT' : 'DEUCE',
        announcerText: isDecidingPoint ? 'Deuce. Deciding point.' : 'Deuce.',
        isDeuce: true,
        isAdvantage: false,
        isDecidingPoint,
        deuceCount,
        winner: null,
      };
    }
    const advPlayer = playerPoints > opponentPoints;
    return {
      playerLabel: advPlayer ? 'AD' : '40',
      opponentLabel: advPlayer ? '40' : 'AD',
      statusText: advPlayer ? 'ADVANTAGE PLAYER' : 'ADVANTAGE OPPONENT',
      announcerText: advPlayer ? 'Advantage, viewer.' : 'Advantage, broadcast.',
      isDeuce: false,
      isAdvantage: true,
      isDecidingPoint: false,
      deuceCount,
      winner: null,
    };
  }

  const pLabel = POINT_LABELS[playerPoints] ?? '40';
  const oLabel = POINT_LABELS[opponentPoints] ?? '40';
  const word = (l) => (l === '0' ? 'Love' : l);
  const announcerText =
    pLabel === oLabel
      ? pLabel === '0'
        ? 'Love all.'
        : `${word(pLabel)} all.`
      : `${word(pLabel)}. ${word(oLabel)}.`;

  return {
    playerLabel: pLabel,
    opponentLabel: oLabel,
    statusText: `${pLabel} - ${oLabel}`,
    announcerText,
    isDeuce: false,
    isAdvantage: false,
    isDecidingPoint: false,
    deuceCount,
    winner: null,
  };
}
