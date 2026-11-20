// Deterministic ON FIRE coverage: timed-strike helpers plus full physics
// rallies through stepBallPhysics with clicks issued against ball position,
// never wall-clock. Run with: node tests/on-fire.test.mjs
import {
  ROOM,
  createPaddle,
  createBall,
  stepBallPhysics,
  createTimedStrikeState,
  timedStrikeClick,
  timedStrikeContact,
  timedStrikeFrame,
  timedStrikeReset,
  isOnFire,
  timedStrikeBoost,
  TIMED_STRIKE_WINDOW,
  TIMED_STRIKE_BOOST,
  ON_FIRE_STREAK,
  ON_FIRE_DURATION,
  ON_FIRE_BOOST,
} from '../logic.js';

let failures = 0;
function ok(cond, name) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures += 1; console.error(`FAIL - ${name}`); }
}

// --- Helper-level behaviour -------------------------------------------------
{
  const ts = createTimedStrikeState();
  // Click just before contact -> timed, streak 1.
  timedStrikeClick(ts, 10.0);
  let r = timedStrikeContact(ts, 10.0 + TIMED_STRIKE_WINDOW * 0.5);
  ok(r.timed && !r.mistimed && ts.streak === 1, 'click before contact within window is timed');
  // No-click return: streak untouched, not broken.
  r = timedStrikeContact(ts, 11.5);
  ok(!r.timed && !r.mistimed && ts.streak === 1, 'plain no-click return leaves streak intact');
  // Late click within window after contact counts as timed.
  timedStrikeClick(ts, 11.5 + TIMED_STRIKE_WINDOW * 0.9);
  ok(ts.streak === 2, 'late click within window claims the contact');
  // Third consecutive timed strike lights ON FIRE.
  timedStrikeClick(ts, 13.0);
  r = timedStrikeContact(ts, 13.05);
  ok(r.timed && r.firedUp && isOnFire(ts, 13.06), 'three consecutive timed strikes ignite ON FIRE');
  ok(ts.activations === 1, 'activation counted once');
  // Fire expires after the bounded duration and the streak resets.
  const sweep = timedStrikeFrame(ts, 13.06 + ON_FIRE_DURATION + 0.01);
  ok(sweep.fireEnded && !isOnFire(ts, 13.1 + ON_FIRE_DURATION) && ts.streak === 0, 'fire is time-bounded and streak resets after it');
}

{
  const ts = createTimedStrikeState();
  // Mistimed click: window expires with no contact -> streak lost.
  timedStrikeClick(ts, 5.0);
  const sweep = timedStrikeFrame(ts, 5.0 + TIMED_STRIKE_WINDOW + 0.001);
  ok(sweep.mistimed && ts.streak === 0, 'click with no contact in window is mistimed');
  const plain = timedStrikeContact(ts, 6.0); // no click parked; streak stays 0, return unaffected
  ok(!plain.timed && !plain.mistimed, 'return after a mistimed click is still a clean normal return');
  // Mistimed click also extinguishes an active fire.
  const ts2 = createTimedStrikeState();
  for (let i = 0; i < ON_FIRE_STREAK; i++) {
    timedStrikeClick(ts2, i * 2);
    timedStrikeContact(ts2, i * 2 + 0.05);
  }
  ok(isOnFire(ts2, ON_FIRE_STREAK * 2), 'fire lit for mistimed-extinguish setup');
  timedStrikeClick(ts2, 100.0); // far from any contact; fire ends at sweep
  timedStrikeFrame(ts2, 100.0 + TIMED_STRIKE_WINDOW + 0.001);
  ok(!isOnFire(ts2, 100.2) && ts2.streak === 0, 'mistimed click extinguishes ON FIRE');
  // Reset clears everything (point end).
  timedStrikeReset(ts2);
  ok(ts2.streak === 0 && ts2.lastClickAt === null && ts2.onFireUntil === 0, 'point-end reset clears state');
}

{
  // Boost selection: fire boost > pending timed boost > 1.
  const ts = createTimedStrikeState();
  ok(timedStrikeBoost(ts, 1.0) === 1.0, 'no click, no fire: normal physics');
  timedStrikeClick(ts, 1.0);
  ok(timedStrikeBoost(ts, 1.05) === TIMED_STRIKE_BOOST, 'in-window click gives timed boost');
  ts.onFireUntil = 5.0;
  ok(timedStrikeBoost(ts, 2.0) === ON_FIRE_BOOST, 'ON FIRE boost wins while lit');
}

// --- Physics-level: boosted returns stay clamped, normal returns unchanged --
function runExchanges({ clickEvery = 1, exchanges = 6, boost = null, maxZSpeed = 28 } = {}) {
  // Each exchange: ball placed deep, flying at the player; paddle parked on
  // the ball line so every crossing is a contact. Clicks are issued when the
  // ball's time-to-contact enters the window, like a player watching the ball.
  const ts = createTimedStrikeState();
  const pad = createPaddle();
  pad.x = 0; pad.y = 0.2;
  const ball = createBall({ x: 0, y: 0.2, z: 14, vx: 0, vy: 0, vz: -12 });
  const dt = 1 / 120;
  let elapsed = 0;
  const contacts = [];
  for (let ex = 0; ex < exchanges; ex++) {
    // Reset the flight toward the player, carrying speed like a real rally.
    // Position and lateral velocity reset too: this harness isolates contact
    // timing, not shot placement.
    ball.x = 0; ball.y = 0.2; ball.z = 14;
    ball.vx = 0; ball.vy = 0; ball.spinX = 0; ball.spinY = 0;
    ball.vz = -Math.max(12, Math.abs(ball.vz));
    let clicked = false;
    for (let f = 0; f < 600; f++) {
      // Perfect-bot paddle: tracks the ball line so every crossing is a
      // contact. This harness isolates strike timing, not aim.
      pad.x = ball.x; pad.y = ball.y;
      if (!clicked && clickEvery && ball.vz < 0) {
        const ttc = (ball.z - ROOM.playerZ) / Math.abs(ball.vz || 1);
        if (ttc <= TIMED_STRIKE_WINDOW * 0.9 && ttc > 0) {
          timedStrikeClick(ts, elapsed);
          clicked = true;
        }
      }
      const speedMultiplier = boost ? boost(ts, elapsed) : 1.0;
      const { events } = stepBallPhysics(ball, pad, createPaddle(), dt, {
        speedMultiplier,
        maxZSpeed,
      });
      let contacted = false;
      for (const ev of events) {
        if (ev.type === 'paddle' && ev.side === 'player') {
          contacts.push({ t: elapsed, speed: ev.speed, res: timedStrikeContact(ts, elapsed) });
          contacted = true;
        }
      }
      timedStrikeFrame(ts, elapsed);
      elapsed += dt;
      if (contacted) break;
    }
  }
  return { ts, contacts, maxZSpeed };
}

{
  const { contacts } = runExchanges({ clickEvery: 1, exchanges: 4 });
  const timedCount = contacts.filter((c) => c.res.timed).length;
  ok(contacts.length === 4, `sim rally produced ${contacts.length}/4 player contacts`);
  ok(timedCount >= 3, `ball-watched clicks register as timed strikes (${timedCount}/4)`);
  ok(contacts.every((c) => c.speed <= 28 + 1e-9), 'timed returns stay clamped to max speed');
}

{
  const { ts, contacts } = runExchanges({ clickEvery: 1, exchanges: 6, boost: timedStrikeBoost });
  ok(ts.activations >= 1, 'ON FIRE activates inside a simulated rally');
  ok(contacts.every((c) => c.speed <= 28 + 1e-9), 'ON FIRE returns stay clamped to max speed');
  const speeds = contacts.map((c) => c.speed);
  ok(speeds[speeds.length - 1] >= speeds[0], 'boosted rally does not slow the ball');
}

{
  // Normal rally with zero clicks: physics identical to before the feature.
  const noClick = runExchanges({ clickEvery: 0, exchanges: 4 });
  ok(noClick.contacts.length === 4, 'no-click rally still returns normally');
  ok(noClick.ts.streak === 0 && noClick.ts.timedHits === 0 && noClick.ts.activations === 0, 'no clicks: no streak, no fire, returns unaffected');
  ok(noClick.contacts.every((c) => !c.res.timed && !c.res.mistimed), 'no-click contacts are clean normal returns');
}

console.log(failures ? `${failures} FAILURES` : 'all on-fire tests passed');
process.exit(failures ? 1 : 0);
