import {
  ROOM,
  gameToAudioCoords,
  computeDistanceGain,
  computeDopplerRate,
  quantizeToNextStep,
  createVoiceTracker,
  pickScaleMidi,
  midiToFreq,
} from './logic.js';

/**
 * Procedural 3D Spatial Web Audio + Layered Detroit House Sequencer.
 * Zero external samples. Starts strictly after user gesture.
 */
export function createAudioEngine(getSettings) {
  let ctx = null;
  let masterGain = null;
  let limiter = null;
  let musicBus = null;
  let musicDuckGain = null;
  let sfxBus = null;
  let delayNode = null;
  let delayFeedback = null;

  // Continuous ball voice
  let ballOsc = null;
  let ballFilter = null;
  let ballGain = null;
  let ballPanner = null;

  // Sequencer state
  let seqTimer = null;
  let gridStartSec = 0;
  let currentStep = 0;
  let nextStepTime = 0;
  let bpm = 124;
  let rootMidi = 45; // A2
  let rallyHits = 0;
  let matchIntensity = 0;
  let currentAct = 1;
  let opponentId = '';
  let louPhase = 1;
  let isPlayingMatch = false;
  let isDeuceBreakdown = false;
  let muted = false;
  let lastQuantizedStep = -1;
  let quantizedOnStepCount = 0;
  let fillBarsRemaining = 0;
  let pendingStinger = null; // 'win' | 'loss' | null
  // Optional player-loaded lead line (see midi.js). Null means the built-in house track only.
  let motif = null;
  let motifByStep = null;
  let motifCursor = 0;

  const tracker = createVoiceTracker({ maxVoices: 24, minSurfaceIntervalMs: 40 });
  let nextVoiceId = 1;

  function ensureContext() {
    if (ctx) return ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    try {
      ctx = new AudioCtx();
      masterGain = ctx.createGain();
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.08;

      musicBus = ctx.createGain();
      musicDuckGain = ctx.createGain();
      sfxBus = ctx.createGain();

      // Subtle Detroit house tape-style echo bus
      delayNode = ctx.createDelay(1.0);
      delayNode.delayTime.value = (60 / 124) * 0.75; // dotted 8th feel
      delayFeedback = ctx.createGain();
      delayFeedback.gain.value = 0.24;
      const delayFilter = ctx.createBiquadFilter();
      delayFilter.type = 'lowpass';
      delayFilter.frequency.value = 2200;
      delayNode.connect(delayFilter);
      delayFilter.connect(delayFeedback);
      delayFeedback.connect(delayNode);
      delayFilter.connect(musicBus);

      musicBus.connect(musicDuckGain);
      musicDuckGain.connect(masterGain);
      sfxBus.connect(masterGain);
      masterGain.connect(limiter);
      limiter.connect(ctx.destination);

      setListenerPosition(0, 0, ROOM.cameraZ);
      initBallVoice();
      applyVolumes();
      gridStartSec = ctx.currentTime + 0.05;
      nextStepTime = gridStartSec;
      startSequencerLoop();
      return ctx;
    } catch {
      ctx = null;
      return null;
    }
  }

  function setListenerPosition(x, y, z) {
    if (!ctx) return;
    const L = ctx.listener;
    const ac = gameToAudioCoords(x, y, z);
    if (L.positionX) {
      L.positionX.value = ac.x;
      L.positionY.value = ac.y;
      L.positionZ.value = ac.z;
      L.forwardX.value = 0;
      L.forwardY.value = 0;
      L.forwardZ.value = -1;
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    } else if (L.setPosition) {
      L.setPosition(ac.x, ac.y, ac.z);
      L.setOrientation(0, 0, -1, 0, 1, 0);
    }
  }

  function createSpatialNode(useHrtf) {
    if (!ctx) return null;
    if (useHrtf && typeof ctx.createPanner === 'function') {
      try {
        const p = ctx.createPanner();
        p.panningModel = 'HRTF';
        p.distanceModel = 'inverse';
        p.refDistance = 2.6;
        p.maxDistance = 28;
        p.rolloffFactor = 1.15;
        return { kind: 'hrtf', node: p };
      } catch {
        // fall through
      }
    }
    const sp = ctx.createStereoPanner();
    const dg = ctx.createGain();
    sp.connect(dg);
    return { kind: 'stereo', node: sp, gainNode: dg };
  }

  function positionSpatialNode(spatial, x, y, z, immediate = false) {
    if (!ctx || !spatial) return;
    const ac = gameToAudioCoords(x, y, z);
    const t = ctx.currentTime;
    if (spatial.kind === 'hrtf') {
      const p = spatial.node;
      if (p.positionX) {
        if (immediate) {
          p.positionX.setValueAtTime(ac.x, t);
          p.positionY.setValueAtTime(ac.y, t);
          p.positionZ.setValueAtTime(ac.z, t);
        } else {
          p.positionX.setTargetAtTime(ac.x, t, 0.015);
          p.positionY.setTargetAtTime(ac.y, t, 0.015);
          p.positionZ.setTargetAtTime(ac.z, t, 0.015);
        }
      } else if (p.setPosition) {
        p.setPosition(ac.x, ac.y, ac.z);
      }
    } else {
      const pan = Math.max(-1, Math.min(1, ac.x / ROOM.halfW));
      const dist = Math.hypot(ac.x, ac.y, ac.z - (-ROOM.cameraZ));
      const g = computeDistanceGain(dist);
      if (immediate) {
        spatial.node.pan.setValueAtTime(pan, t);
        spatial.gainNode.gain.setValueAtTime(g, t);
      } else {
        spatial.node.pan.setTargetAtTime(pan, t, 0.015);
        spatial.gainNode.gain.setTargetAtTime(g, t, 0.015);
      }
    }
  }

  function initBallVoice() {
    if (!ctx) return;
    const useHrtf = getSettings?.().spatialMode !== 'speakers';
    ballOsc = ctx.createOscillator();
    ballOsc.type = 'triangle';
    ballOsc.frequency.value = 180;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 175;

    ballFilter = ctx.createBiquadFilter();
    ballFilter.type = 'lowpass';
    ballFilter.frequency.value = 900;
    ballFilter.Q.value = 1.6;

    ballGain = ctx.createGain();
    ballGain.gain.value = 0.0001;

    ballPanner = createSpatialNode(useHrtf);
    ballOsc.connect(hp);
    hp.connect(ballFilter);
    ballFilter.connect(ballGain);

    if (ballPanner.kind === 'hrtf') {
      ballGain.connect(ballPanner.node);
      ballPanner.node.connect(sfxBus);
    } else {
      ballGain.connect(ballPanner.node);
      ballPanner.gainNode.connect(sfxBus);
    }
    ballOsc.start();
  }

  function rebuildBallPannerIfNeeded() {
    if (!ctx || !ballGain) return;
    const wantHrtf = getSettings?.().spatialMode !== 'speakers';
    const isHrtf = ballPanner?.kind === 'hrtf';
    if (wantHrtf !== isHrtf) {
      try {
        ballGain.disconnect();
        if (ballPanner?.gainNode) ballPanner.gainNode.disconnect();
        if (ballPanner?.node) ballPanner.node.disconnect();
      } catch {
        // ignore
      }
      ballPanner = createSpatialNode(wantHrtf);
      if (ballPanner.kind === 'hrtf') {
        ballGain.connect(ballPanner.node);
        ballPanner.node.connect(sfxBus);
      } else {
        ballGain.connect(ballPanner.node);
        ballPanner.gainNode.connect(sfxBus);
      }
    }
  }

  function updateBallVoice(ball, active) {
    if (!ctx || !ballGain || !ballOsc || !ballFilter) return;
    rebuildBallPannerIfNeeded();
    const t = ctx.currentTime;
    if (!active) {
      ballGain.gain.setTargetAtTime(0.0001, t, 0.04);
      return;
    }
    positionSpatialNode(ballPanner, ball.x, ball.y, ball.z, false);
    const dist = Math.hypot(ball.x, ball.y, ball.z - ROOM.cameraZ);
    const doppler = computeDopplerRate(
      { x: ball.x, y: ball.y, z: ball.z },
      { x: ball.vx, y: ball.vy, z: ball.vz }
    );
    const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
    const baseFreq = 165 + Math.min(180, speed * 5.2);
    ballOsc.frequency.setTargetAtTime(baseFreq * doppler, t, 0.02);

    const nearFactor = Math.max(0, Math.min(1, 1 - ball.z / ROOM.depth));
    ballFilter.frequency.setTargetAtTime(520 + nearFactor * 2600, t, 0.025);
    ballGain.gain.setTargetAtTime(0.032 + nearFactor * 0.055, t, 0.025);

    if (ball.vz < 0 && dist < 7.0) {
      musicDuckGain.gain.setTargetAtTime(0.66, t, 0.02);
    } else {
      musicDuckGain.gain.setTargetAtTime(1.0, t, 0.14);
    }
  }

  function applyVolumes() {
    if (!ctx || !masterGain) return;
    const s = getSettings?.() || {};
    const master = muted ? 0 : (s.masterVolume ?? 0.8);
    const music = s.musicVolume ?? 0.42;
    const sfx = s.sfxVolume ?? 0.88;
    const t = ctx.currentTime;
    masterGain.gain.setTargetAtTime(master, t, 0.02);
    musicBus.gain.setTargetAtTime(music, t, 0.02);
    sfxBus.gain.setTargetAtTime(sfx, t, 0.02);
  }

  function duckMusicBriefly(depth = 0.65) {
    if (!ctx || !musicDuckGain) return;
    const t = ctx.currentTime;
    musicDuckGain.gain.cancelScheduledValues(t);
    musicDuckGain.gain.setTargetAtTime(depth, t, 0.005);
    musicDuckGain.gain.setTargetAtTime(1.0, t + 0.06, 0.12);
  }

  function triggerOneShot(spatialPos, priority, durationSec, builderFn) {
    if (!ctx || ctx.state !== 'running') return;
    const id = nextVoiceId++;
    const nodesToClean = [];
    const voice = {
      id,
      priority,
      startedAt: ctx.currentTime,
      cleanup: () => {
        for (const n of nodesToClean) {
          try { n.disconnect(); } catch { /* ignore */ }
        }
      },
    };
    const stolen = tracker.registerVoice(voice);
    if (stolen) stolen.cleanup();

    const useHrtf = getSettings?.().spatialMode !== 'speakers';
    const spatial = spatialPos ? createSpatialNode(useHrtf) : null;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';

    if (spatial) {
      positionSpatialNode(spatial, spatialPos.x, spatialPos.y, spatialPos.z, true);
      const dist = Math.hypot(spatialPos.x, spatialPos.y, spatialPos.z - ROOM.cameraZ);
      filter.frequency.value = Math.max(900, 7200 - dist * 260);
      filter.connect(spatial.node);
      if (spatial.kind === 'hrtf') {
        spatial.node.connect(sfxBus);
        nodesToClean.push(spatial.node);
      } else {
        spatial.gainNode.connect(sfxBus);
        nodesToClean.push(spatial.node, spatial.gainNode);
      }
    } else {
      filter.frequency.value = 8000;
      filter.connect(sfxBus);
    }
    nodesToClean.push(filter);

    builderFn(filter, nodesToClean);

    setTimeout(() => {
      tracker.releaseVoice(id);
      voice.cleanup();
    }, Math.ceil((durationSec + 0.08) * 1000));
  }

  function playImpact(event) {
    if (!ctx || ctx.state !== 'running') return;
    const nowMs = performance.now();
    const surfaceKey = event.type === 'paddle' ? `paddle-${event.side}` : `wall-${event.surface}`;
    if (!tracker.canTriggerSurface(surfaceKey, nowMs)) return;

    const now = ctx.currentTime;
    const pos = { x: event.x, y: event.y, z: event.z };

    if (event.type === 'paddle') {
      const isPlayer = event.side === 'player';
      // With a loaded motif each racket hit steps the melody forward, so rallies play the tune.
      const midi = motif ? nextMotifMidi(isPlayer ? 0 : -12) : pickScaleMidi(rootMidi + (isPlayer ? 24 : 12), rallyHits, isPlayer ? 2 : 0);
      const freq = midiToFreq(midi);
      triggerOneShot(pos, isPlayer ? 3 : 2, 0.18, (out, bag) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = isPlayer ? 'triangle' : 'square';
        osc.frequency.setValueAtTime(freq * 1.4, now);
        osc.frequency.exponentialRampToValueAtTime(freq, now + 0.035);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(isPlayer ? 0.34 : 0.26, now + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
        osc.connect(g);
        g.connect(out);
        osc.start(now);
        osc.stop(now + 0.17);
        bag.push(osc, g);
      });
      duckMusicBriefly(0.68);
      rallyHits += 1;
      if (delayFeedback) {
        delayFeedback.gain.setTargetAtTime(Math.min(0.42, 0.2 + rallyHits * 0.02), now, 0.05);
      }
      scheduleQuantizedAnswer(pos, isPlayer ? 'bleep' : 'stab', motif ? midi + 12 : null);
    } else if (event.type === 'wall') {
      const offset = event.surface === 'floor' ? 0 : event.surface === 'ceiling' ? 4 : 2;
      const freq = midiToFreq(pickScaleMidi(rootMidi + 24, rallyHits, offset));
      triggerOneShot(pos, 1, 0.12, (out, bag) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.72, now + 0.09);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(0.18, now + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
        osc.connect(g);
        g.connect(out);
        osc.start(now);
        osc.stop(now + 0.11);
        bag.push(osc, g);
      });
      scheduleQuantizedAnswer(pos, 'hat');
    } else if (event.type === 'miss') {
      rallyHits = 0;
      fillBarsRemaining = 1;
      if (delayFeedback) {
        delayFeedback.gain.setTargetAtTime(0.2, now, 0.05);
      }
      const isPlayerScore = event.side === 'opponent';
      triggerOneShot(pos, 4, 0.35, (out, bag) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(isPlayerScore ? 260 : 140, now);
        osc.frequency.exponentialRampToValueAtTime(isPlayerScore ? 440 : 68, now + 0.28);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(0.28, now + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.33);
        osc.connect(g);
        g.connect(out);
        osc.start(now);
        osc.stop(now + 0.34);
        bag.push(osc, g);
      });
      duckMusicBriefly(0.55);
    }
  }

  function scheduleQuantizedAnswer(pos, kind, forcedMidi = null) {
    if (!ctx || ctx.state !== 'running') return;
    const q = quantizeToNextStep(ctx.currentTime, gridStartSec, bpm, 4);
    if (q.stepIndex !== lastQuantizedStep) {
      lastQuantizedStep = q.stepIndex;
      quantizedOnStepCount = 0;
    }
    if (quantizedOnStepCount >= 2) return;
    quantizedOnStepCount += 1;

    const when = q.stepTime;
    const midi = forcedMidi ?? pickScaleMidi(rootMidi + (kind === 'stab' ? 12 : 24), rallyHits, kind === 'bleep' ? 3 : 1);
    const freq = midiToFreq(midi);

    triggerOneShot(pos, 1, Math.max(0.25, when - ctx.currentTime + 0.2), (out, bag) => {
      if (kind === 'hat') {
        const bufSize = Math.floor(ctx.sampleRate * 0.045);
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 6500;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.08, when);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
        src.connect(hp);
        hp.connect(g);
        g.connect(out);
        src.start(when);
        bag.push(src, hp, g);
        return;
      }

      const osc = ctx.createOscillator();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      osc.type = kind === 'bleep' ? 'square' : 'sawtooth';
      osc.frequency.setValueAtTime(freq, when);
      f.type = 'lowpass';
      f.Q.value = 4.5;
      f.frequency.setValueAtTime(kind === 'bleep' ? 2800 : 1200, when);
      f.frequency.exponentialRampToValueAtTime(420, when + 0.14);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(0.11, when + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.15);
      osc.connect(f);
      f.connect(g);
      g.connect(out);
      osc.start(when);
      osc.stop(when + 0.16);
      bag.push(osc, f, g);
    });
  }

  // --- Sequencer (Layered Bleepy Detroit House) ---
  function triggerKick(t) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(132, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.09);
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    osc.connect(g);
    g.connect(musicBus);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  function triggerClap(t) {
    const len = Math.floor(ctx.sampleRate * 0.09);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1650;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);
    src.connect(bp);
    bp.connect(g);
    g.connect(musicBus);
    src.start(t);
  }

  function triggerHat(t, open = false) {
    const dur = open ? 0.14 : 0.045;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = open ? 6200 : 7800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(open ? 0.11 : 0.055, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp);
    hp.connect(g);
    g.connect(musicBus);
    src.start(t);
  }

  function triggerBassOrArp(t, midi, isArp) {
    const osc = ctx.createOscillator();
    const filt = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = isArp ? 'square' : 'sawtooth';
    osc.frequency.setValueAtTime(midiToFreq(midi), t);
    filt.type = 'lowpass';
    filt.Q.value = isArp ? 5.2 : 2.5;
    const openBoost = Math.min(2200, rallyHits * 180);
    filt.frequency.setValueAtTime((isArp ? 1400 : 380) + openBoost, t);
    filt.frequency.exponentialRampToValueAtTime(isArp ? 320 : 120, t + 0.16);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(isArp ? 0.085 : 0.16, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (isArp ? 0.15 : 0.21));
    osc.connect(filt);
    filt.connect(g);
    g.connect(musicBus);
    if (isArp && delayNode) {
      g.connect(delayNode);
    }
    osc.start(t);
    osc.stop(t + 0.22);
  }

  function triggerChordStab(t, root, detuneCents = 6, bright = false) {
    // Minor-7th Detroit house chord stab (root, +3, +7, +10)
    const intervals = [0, 3, 7, 10];
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 3.2;
    filt.frequency.setValueAtTime(bright ? 3200 : 1900, t);
    filt.frequency.exponentialRampToValueAtTime(340, t + 0.26);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.27);
    filt.connect(g);
    g.connect(musicBus);
    if (delayNode) g.connect(delayNode);

    for (const semi of intervals) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(midiToFreq(root + 12 + semi), t);
      osc.detune.value = (semi % 2 === 0 ? 1 : -1) * detuneCents;
      osc.connect(filt);
      osc.start(t);
      osc.stop(t + 0.28);
    }
  }

  function triggerWarmPad(t, root) {
    const intervals = [0, 4, 7, 11]; // warm lifted major-7th pad for Lou Phase 3 / Act III
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.85);
    filt.connect(g);
    g.connect(musicBus);
    for (const semi of intervals) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(midiToFreq(root + 12 + semi), t);
      osc.connect(filt);
      osc.start(t);
      osc.stop(t + 1.9);
    }
  }

  const BASS_PATTERN = [0, -1, 0, -1, 3, -1, 0, -1, 5, -1, 3, -1, 7, -1, 5, 3];
  const MOTIF_BASS_PATTERN = [0, -1, 0, -1, 7, -1, 0, -1, 0, -1, 0, -1, 7, -1, 0, -1];
  const ARP_PATTERN = [12, -1, 15, 19, -1, 17, 15, -1, 12, -1, 19, -1, 22, 19, 15, -1];

  function nextMotifMidi(octaveShift = 0) {
    const n = motif.notes[motifCursor % motif.notes.length];
    motifCursor += 1;
    return n.midi + octaveShift;
  }

  function setMotif(next) {
    motif = next && next.notes?.length ? next : null;
    motifByStep = motif ? new Map(motif.notes.map(n => [n.step, n])) : null;
    motifCursor = 0;
  }

  function triggerLead(t, midi, lenSteps, octaveLayer = false) {
    const stepSec = 60 / bpm / 4;
    const dur = Math.min(0.5, Math.max(0.08, lenSteps * stepSec * 0.8));
    const osc = ctx.createOscillator();
    const filt = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = octaveLayer ? 'triangle' : 'square';
    osc.frequency.setValueAtTime(midiToFreq(midi + (octaveLayer ? 12 : 0)), t);
    filt.type = 'lowpass';
    filt.Q.value = 3;
    filt.frequency.setValueAtTime(1800 + Math.min(3000, rallyHits * 260), t);
    filt.frequency.exponentialRampToValueAtTime(900, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(octaveLayer ? 0.03 : 0.065, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filt);
    filt.connect(g);
    g.connect(musicBus);
    if (delayNode) g.connect(delayNode);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function scheduleStep(step, t) {
    const s16 = step % 16;
    if (s16 === 0 && pendingStinger) {
      const notes = pendingStinger === 'win' ? [12, 15, 19, 24] : [12, 10, 7, 3];
      notes.forEach((n, idx) => {
        triggerBassOrArp(t + idx * 0.11, rootMidi + n, true);
      });
      pendingStinger = null;
    }

    if (!isPlayingMatch) return;
    const stepSec = 60 / bpm / 4;
    const swing = s16 % 2 === 1 ? stepSec * 0.08 : 0;
    const time = t + swing;

    const isLouDark = opponentId === 'lou_reed' && louPhase < 3;
    const isLouWarm = opponentId === 'lou_reed' && louPhase === 3;
    let effectiveRoot = isLouWarm ? rootMidi + 5 : rootMidi;
    // With a loaded lead line, take the bass tonic from it and keep to root/fifth so the harmony cannot clash.
    if (motif) effectiveRoot = 36 + motif.tonicPitchClass;

    if (!isDeuceBreakdown && s16 % 4 === 0) {
      triggerKick(time);
    }
    if (s16 % 4 === 2) {
      triggerHat(time, true);
    } else if (s16 % 2 === 1 && (matchIntensity >= 1 || rallyHits >= 2 || currentAct >= 2)) {
      triggerHat(time, false);
    }

    // Clap on 2 and 4 (and fill on point scored)
    if (!isDeuceBreakdown && !isLouDark && (s16 === 4 || s16 === 12 || (fillBarsRemaining > 0 && s16 >= 12))) {
      if (currentAct >= 2 || matchIntensity >= 1 || rallyHits >= 3 || fillBarsRemaining > 0) {
        triggerClap(time);
      }
    }

    const bassPattern = motif ? MOTIF_BASS_PATTERN : BASS_PATTERN;
    if (!isDeuceBreakdown && bassPattern[s16] >= 0) {
      triggerBassOrArp(time, effectiveRoot + bassPattern[s16], false);
    }

    if (!motif && (matchIntensity >= 1 || rallyHits >= 1) && ARP_PATTERN[s16] >= 0) {
      triggerBassOrArp(time, effectiveRoot + ARP_PATTERN[s16], true);
    }

    // Minor-7th chord stabs (Act II/III, or high rally)
    if (!motif && !isDeuceBreakdown && !isLouDark && (currentAct >= 2 || rallyHits >= 4) && (s16 === 3 || s16 === 10)) {
      const detune = opponentId === 'david_bowie' ? 14 : 6;
      const bright = opponentId === 'elton_john' || isLouWarm;
      triggerChordStab(time, effectiveRoot, detune, bright);
    }

    // Loaded lead line loops on the beat grid; longer rallies open the filter and add an octave layer.
    if (motifByStep) {
      const note = motifByStep.get(step % motif.length);
      if (note && !isDeuceBreakdown) {
        triggerLead(time, note.midi, note.len);
        if (rallyHits >= 4) triggerLead(time, note.midi, note.len, true);
      }
    }

    // Warm pad on Act III or Lou Phase 3 / Deuce breakdown
    if (s16 === 0 && (currentAct === 3 || isLouWarm || isDeuceBreakdown)) {
      triggerWarmPad(time, effectiveRoot);
    }

    if (s16 === 15 && fillBarsRemaining > 0) {
      fillBarsRemaining -= 1;
    }
  }

  function startSequencerLoop() {
    if (seqTimer) return;
    seqTimer = setInterval(() => {
      if (!ctx || ctx.state !== 'running') return;
      const stepSec = 60 / bpm / 4;
      if (delayNode) delayNode.delayTime.value = stepSec * 3;
      const horizon = ctx.currentTime + 0.12;
      while (nextStepTime < horizon) {
        scheduleStep(currentStep, nextStepTime);
        nextStepTime += stepSec;
        currentStep += 1;
      }
    }, 25);
  }

  function playUiBeep(freq = 660, dur = 0.06) {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  }

  function playContinuityIdent(act = 1) {
    if (!ctx || ctx.state !== 'running') return;
    const base = act === 1 ? 57 : act === 2 ? 60 : 62;
    const phrase = [0, 4, 7, 12];
    const t = ctx.currentTime + 0.02;
    phrase.forEach((semi, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(midiToFreq(base + semi), t + idx * 0.09);
      g.gain.setValueAtTime(0.0001, t + idx * 0.09);
      g.gain.linearRampToValueAtTime(0.08, t + idx * 0.09 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + idx * 0.09 + 0.18);
      osc.connect(g);
      g.connect(musicBus);
      osc.start(t + idx * 0.09);
      osc.stop(t + idx * 0.09 + 0.2);
    });
  }

  async function unlockFromGesture() {
    const c = ensureContext();
    if (!c) return false;
    if (c.state === 'suspended') {
      try {
        await c.resume();
      } catch {
        return false;
      }
    }
    applyVolumes();
    return c.state === 'running';
  }

  function handleVisibilityChange() {
    if (!ctx) return;
    if (document.hidden) {
      if (ctx.state === 'running') {
        ctx.suspend().catch(() => {});
      }
    } else {
      ctx.resume().catch(() => {});
    }
  }

  document.addEventListener('visibilitychange', handleVisibilityChange);

  return {
    unlockFromGesture,
    isRunning: () => Boolean(ctx && ctx.state === 'running'),
    toggleMute: () => {
      muted = !muted;
      applyVolumes();
      return muted;
    },
    isMuted: () => muted,
    applyVolumes,
    setMatchState: ({
      playing,
      bpm: nextBpm,
      intensity = 0,
      deuce = false,
      root = 45,
      act = 1,
      oppId = '',
      lou = 1,
    }) => {
      isPlayingMatch = playing;
      if (nextBpm) bpm = nextBpm;
      matchIntensity = intensity;
      isDeuceBreakdown = deuce;
      rootMidi = root;
      currentAct = act;
      opponentId = oppId;
      louPhase = lou;
    },
    setMotif,
    hasMotif: () => Boolean(motif),
    triggerStinger: (kind) => {
      pendingStinger = kind;
    },
    playContinuityIdent,
    resetRally: () => {
      rallyHits = 0;
    },
    updateBallVoice,
    playImpact,
    playUiBeep,
    destroy: () => {
      if (seqTimer) clearInterval(seqTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (ctx) ctx.close().catch(() => {});
    },
  };
}
