import { ROOM, viewScale } from './logic.js';

/**
 * 3D Perspective Projection + Room Ten / Factory-inspired Canvas 2D Renderer.
 * Projects true 3D (x, y, z) coordinates onto the viewport with crisp depth cues.
 */
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let width = 1280;
  let height = 720;
  let dpr = 1;

  let vignetteCanvas = null;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(320, Math.floor(rect.width));
    height = Math.max(240, Math.floor(rect.height));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    vignetteCanvas = null;
  }

  // Cached edge vignette: built once per resize, drawn under ball, bats and HUD.
  function drawVignette() {
    if (!vignetteCanvas) {
      const vc = document.createElement('canvas');
      vc.width = width;
      vc.height = height;
      const vctx = vc.getContext('2d');
      const g = vctx.createRadialGradient(
        width * 0.5, height * 0.5, Math.min(width, height) * 0.42,
        width * 0.5, height * 0.5, Math.max(width, height) * 0.72
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.26)');
      vctx.fillStyle = g;
      vctx.fillRect(0, 0, width, height);
      vignetteCanvas = vc;
    }
    ctx.drawImage(vignetteCanvas, 0, 0, width, height);
  }

  // Perspective camera behind player bat looking down +z
  function project(x, y, z, shakeX = 0, shakeY = 0) {
    const dz = Math.max(0.45, z - ROOM.cameraZ);
    // Bounded fit: the near plane (z=0, largest projection) always fits the
    // viewport with an outer margin, so corner shots stay fully visible.
    const focal = viewScale(width, height) * (0 - ROOM.cameraZ);
    const scale = focal / dz;
    const sx = width * 0.5 + (x - shakeX) * scale;
    const sy = height * 0.5 - (y - shakeY) * scale;
    return { x: sx, y: sy, scale, dz };
  }

  function drawLine3D(x1, y1, z1, x2, y2, z2, shakeX, shakeY) {
    const p1 = project(x1, y1, z1, shakeX, shakeY);
    const p2 = project(x2, y2, z2, shakeX, shakeY);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  function renderMatch(state) {
    const {
      ball,
      playerPaddle,
      opponentPaddle,
      opponentBoxes,
      flashes = [],
      particles = [],
      ballTrail = [],
      shake = { x: 0, y: 0 },
      theme = { bg: '#111214', roomBg: '#16181c', accent: '#e0533c', line: '#e8e6df' },
      isWarmPhase = false,
      shadowBoost = 1.0,
      bonoDecoy = null,
      bonoShades = false,
    } = state;

    const sx = shake.x || 0;
    const sy = shake.y || 0;

    // Background (matte near-black or Lou Reed Phase 3 warm tint)
    ctx.fillStyle = isWarmPhase ? '#231a14' : theme.bg;
    ctx.fillRect(0, 0, width, height);

    const hw = ROOM.halfW;
    const hh = ROOM.halfH;
    const d = ROOM.depth;

    // 1. Room back wall fill & subtle floor tint for depth contrast
    const fl0 = project(-hw, -hh, 0, sx, sy);
    const fr0 = project(hw, -hh, 0, sx, sy);
    const tr0 = project(hw, hh, 0, sx, sy);
    const tl0 = project(-hw, hh, 0, sx, sy);

    const fl1 = project(-hw, -hh, d, sx, sy);
    const fr1 = project(hw, -hh, d, sx, sy);
    const tr1 = project(hw, hh, d, sx, sy);
    const tl1 = project(-hw, hh, d, sx, sy);

    // Floor plane shading
    const floorGrad = ctx.createLinearGradient(0, fl1.y, 0, fl0.y);
    floorGrad.addColorStop(0, isWarmPhase ? '#2e2118' : '#14161a');
    floorGrad.addColorStop(1, isWarmPhase ? '#3a2a1e' : '#1d2026');
    ctx.fillStyle = floorGrad;
    ctx.beginPath();
    ctx.moveTo(fl0.x, fl0.y);
    ctx.lineTo(fr0.x, fr0.y);
    ctx.lineTo(fr1.x, fr1.y);
    ctx.lineTo(fl1.x, fl1.y);
    ctx.closePath();
    ctx.fill();

    // Back wall plane
    ctx.fillStyle = isWarmPhase ? '#261b13' : '#0f1013';
    ctx.beginPath();
    ctx.moveTo(fl1.x, fl1.y);
    ctx.lineTo(fr1.x, fr1.y);
    ctx.lineTo(tr1.x, tr1.y);
    ctx.lineTo(tl1.x, tl1.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(244,242,235,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 1b. Broom-cupboard broadcast gear on the back wall: a bar monitor (with
    // a tiny duck perched on top), a bouncing VU meter, a patch bay and an ON
    // AIR lamp. Drawn in wall space, kept small, dim and at the edges so the
    // far-plane ball arrival zone stays clean.
    drawBackWallSet(tl1, tr1, fl1, fr1, state.elapsed || 0, isWarmPhase);

    // Side walls and ceiling: faint tonal planes (flat fills, no per-frame gradients)
    const wallFill = (p, q, r, s, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.lineTo(r.x, r.y);
      ctx.lineTo(s.x, s.y);
      ctx.closePath();
      ctx.fill();
    };
    wallFill(fl0, fl1, tl1, tl0, 'rgba(60,90,140,0.10)');
    wallFill(fr0, fr1, tr1, tr0, 'rgba(60,90,140,0.10)');
    wallFill(tl0, tl1, tr1, tr0, 'rgba(255,255,255,0.03)');

    // 1c. Wipeout-style floor: glowing track edges with chevron ticks and a
    // soft specular sheen, all low-alpha so the grid and depth ring still lead.
    {
      const edgeAlpha = isWarmPhase ? 0.18 : 0.3;
      ctx.save();
      ctx.strokeStyle = theme.accent;
      ctx.globalAlpha = edgeAlpha;
      ctx.lineWidth = 2.5;
      drawLine3D(-hw * 0.985, -hh, 0, -hw * 0.985, -hh, d, sx, sy);
      drawLine3D(hw * 0.985, -hh, 0, hw * 0.985, -hh, d, sx, sy);
      ctx.globalAlpha = edgeAlpha * 0.7;
      ctx.lineWidth = 1.4;
      for (let cz = 1; cz < 8; cz++) {
        const z = (d * cz) / 8;
        drawLine3D(-hw * 0.985, -hh, z, -hw * 0.9, -hh, z, sx, sy);
        drawLine3D(hw * 0.985, -hh, z, hw * 0.9, -hh, z, sx, sy);
      }
      ctx.restore();
      const sheen = project(0, -hh + 0.005, d * 0.45, sx, sy);
      const sheenGrad = ctx.createRadialGradient(sheen.x, sheen.y, 0, sheen.x, sheen.y, sheen.scale * 3.2);
      sheenGrad.addColorStop(0, isWarmPhase ? 'rgba(244,212,168,0.05)' : 'rgba(232,230,223,0.05)');
      sheenGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sheenGrad;
      ctx.beginPath();
      ctx.ellipse(sheen.x, sheen.y, sheen.scale * 3.2, sheen.scale * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Converging Grid Lines with depth fog
    const slices = 8;
    for (let i = 0; i <= slices; i++) {
      const z = (d * i) / slices;
      const fogAlpha = 0.08 + (1 - i / slices) * 0.28;
      ctx.strokeStyle = isWarmPhase
        ? `rgba(244, 212, 168, ${fogAlpha.toFixed(3)})`
        : `rgba(232, 230, 223, ${fogAlpha.toFixed(3)})`;
      ctx.lineWidth = i === 0 ? 1.8 : 1;
      const a = project(-hw, -hh, z, sx, sy);
      const b = project(hw, -hh, z, sx, sy);
      const c = project(hw, hh, z, sx, sy);
      const e = project(-hw, hh, z, sx, sy);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(e.x, e.y);
      ctx.closePath();
      ctx.stroke();
    }

    // Longitudinal ribs on floor, ceiling and walls
    ctx.lineWidth = 1;
    const cols = 6;
    for (let c = 0; c <= cols; c++) {
      const x = -hw + (ROOM.width * c) / cols;
      ctx.strokeStyle = c === 0 || c === cols ? 'rgba(232,230,223,0.42)' : 'rgba(232,230,223,0.14)';
      drawLine3D(x, -hh, 0, x, -hh, d, sx, sy); // floor
      drawLine3D(x, hh, 0, x, hh, d, sx, sy);   // ceiling
    }
    const rows = 4;
    for (let r = 1; r < rows; r++) {
      const y = -hh + (ROOM.height * r) / rows;
      ctx.strokeStyle = 'rgba(232,230,223,0.14)';
      drawLine3D(-hw, y, 0, -hw, y, d, sx, sy);
      drawLine3D(hw, y, 0, hw, y, d, sx, sy);
    }

    drawVignette();

    // 2c. Slow transmit-scanline sweep: one soft band drifting down the room,
    // kept near-invisible so it never fights the ball. Phosphor life, 8s cycle.
    {
      const sweepY = (((state.elapsed || 0) % 8) / 8) * (height + 160) - 80;
      const sweepGrad = ctx.createLinearGradient(0, sweepY - 40, 0, sweepY + 40);
      sweepGrad.addColorStop(0, 'rgba(244,242,235,0)');
      sweepGrad.addColorStop(0.5, 'rgba(244,242,235,0.045)');
      sweepGrad.addColorStop(1, 'rgba(244,242,235,0)');
      ctx.fillStyle = sweepGrad;
      ctx.fillRect(0, sweepY - 40, width, 80);
    }

    // 3. DEPTH CUE: Moving Depth Ring along z at ball.z
    if (ball) {
      const bz = Math.max(0, Math.min(d, ball.z));
      const nearness = 1 - bz / d;
      const rA = project(-hw, -hh, bz, sx, sy);
      const rB = project(hw, -hh, bz, sx, sy);
      const rC = project(hw, hh, bz, sx, sy);
      const rD = project(-hw, hh, bz, sx, sy);
      ctx.save();
      ctx.strokeStyle = theme.accent;
      ctx.globalAlpha = (0.35 + nearness * 0.58) * Math.min(1.4, shadowBoost);
      ctx.lineWidth = 1.5 + nearness * 2.5 * shadowBoost;
      ctx.beginPath();
      ctx.moveTo(rA.x, rA.y);
      ctx.lineTo(rB.x, rB.y);
      ctx.lineTo(rC.x, rC.y);
      ctx.lineTo(rD.x, rD.y);
      ctx.closePath();
      ctx.stroke();

      // Tick marks pointing at ball X/Y on the depth ring
      const bxProj = project(ball.x, -hh, bz, sx, sy);
      const byProj = project(-hw, ball.y, bz, sx, sy);
      ctx.beginPath();
      ctx.moveTo(bxProj.x, rA.y - 6);
      ctx.lineTo(bxProj.x, rA.y + 6);
      ctx.moveTo(rA.x - 6, byProj.y);
      ctx.lineTo(rA.x + 6, byProj.y);
      ctx.stroke();
      ctx.restore();
    }

    // 4. Bat-plane arrival flashes
    for (const f of flashes) {
      const fz = f.z;
      const p = project(f.x, f.y, fz, sx, sy);
      const rad = f.radius * p.scale;
      ctx.save();
      ctx.strokeStyle = f.color || theme.accent;
      ctx.globalAlpha = Math.max(0, f.alpha);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 5. Opponent Bat (far plane z = depth)
    drawOpponentBat(
      opponentPaddle,
      opponentBoxes,
      state.opponentStyle,
      theme,
      sx,
      sy,
      state.elapsed || 0,
      (state.score?.playerPoints || 0) + (state.score?.opponentPoints || 0)
    );

    // 6. Ball Floor Shadow + Optional Bono faint decoy shadow (never hides real ball)
    if (bonoDecoy) {
      const ds = project(bonoDecoy.x, -hh + 0.02, bonoDecoy.z, sx, sy);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.24)';
      ctx.beginPath();
      ctx.ellipse(ds.x, ds.y, Math.max(4, 0.35 * ds.scale), Math.max(2, 0.14 * ds.scale), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (ball) {
      const heightAboveFloor = Math.max(0, ball.y - (-hh));
      const shadowScale = Math.max(0.35, 1 - heightAboveFloor / (ROOM.height * 1.4));
      const shProj = project(ball.x, -hh + 0.01, ball.z, sx, sy);
      const rx = Math.max(4, ball.radius * 1.35 * shadowScale * shProj.scale);
      const ry = Math.max(2, rx * 0.38);
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.beginPath();
      ctx.ellipse(shProj.x, shProj.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = theme.accent;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      // Ball trail
      for (let i = 0; i < ballTrail.length; i++) {
        const pt = ballTrail[i];
        const tp = project(pt.x, pt.y, pt.z, sx, sy);
        const tFrac = (i + 1) / (ballTrail.length + 1);
        ctx.save();
        ctx.fillStyle = theme.accent;
        ctx.globalAlpha = tFrac * 0.25;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, Math.max(2, ball.radius * tp.scale * (0.45 + 0.4 * tFrac)), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 7. Ball in 3D perspective: lit sphere (offset hotspot + rim) with a
      // soft glow and a mirrored floor reflection - 1997 gloss, white core and
      // accent rim preserved for readability.
      const bp = project(ball.x, ball.y, ball.z, sx, sy);
      const bRad = Math.max(4, ball.radius * bp.scale);
      // Mirrored floor reflection, fading with height above the floor.
      const refl = project(ball.x, -hh - (ball.y + hh), ball.z, sx, sy);
      const reflAlpha = Math.max(0, 0.16 - heightAboveFloor / (ROOM.height * 1.4) * 0.16);
      if (reflAlpha > 0.01) {
        ctx.save();
        ctx.fillStyle = `rgba(244,242,235,${reflAlpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(refl.x, refl.y, bRad, Math.max(2, bRad * 0.38), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      // Soft outer glow
      const glow = ctx.createRadialGradient(bp.x, bp.y, bRad * 0.4, bp.x, bp.y, bRad * 2.1);
      glow.addColorStop(0, 'rgba(244,242,235,0.16)');
      glow.addColorStop(1, 'rgba(244,242,235,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, bRad * 2.1, 0, Math.PI * 2);
      ctx.fill();
      // Lit sphere: white hotspot up-left, body to mid-grey at the far edge
      const sphere = ctx.createRadialGradient(
        bp.x - bRad * 0.35, bp.y - bRad * 0.35, bRad * 0.1,
        bp.x, bp.y, bRad
      );
      sphere.addColorStop(0, '#ffffff');
      sphere.addColorStop(0.55, '#f4f2eb');
      sphere.addColorStop(1, '#b9b6ac');
      ctx.fillStyle = sphere;
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, bRad, 0, Math.PI * 2);
      ctx.fill();
      // Hard geometric shadow crescent for readability
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = Math.max(1.5, bRad * 0.14);
      ctx.stroke();
      ctx.restore();
    }

    // 8. Particles
    for (const pt of particles) {
      const pp = project(pt.x, pt.y, pt.z, sx, sy);
      ctx.save();
      ctx.fillStyle = pt.color || theme.accent;
      ctx.globalAlpha = Math.max(0, pt.life);
      const sz = Math.max(2, pt.size * pp.scale);
      ctx.fillRect(pp.x - sz * 0.5, pp.y - sz * 0.5, sz, sz);
      ctx.restore();
    }

    // 9. Player see-through wireframe bat (near plane z = 0)
    if (playerPaddle) {
      const p1 = project(playerPaddle.x - playerPaddle.width * 0.5, playerPaddle.y - playerPaddle.height * 0.5, 0, sx, sy);
      const p2 = project(playerPaddle.x + playerPaddle.width * 0.5, playerPaddle.y + playerPaddle.height * 0.5, 0, sx, sy);
      const bx = p1.x;
      const by = p2.y;
      const bw = p2.x - p1.x;
      const bh = p1.y - p2.y;

      ctx.save();
      // Neon under-glow behind the wireframe (console-era bat energy)
      ctx.strokeStyle = theme.accent;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 7;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(244, 242, 235, 0.08)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = '#f4f2eb';
      ctx.lineWidth = 2.4;
      ctx.strokeRect(bx, by, bw, bh);

      // Room Ten see-through centre crosshairs on bat
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1.2;
      const cx = bx + bw * 0.5;
      const cy = by + bh * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy);
      ctx.lineTo(cx + 10, cy);
      ctx.moveTo(cx, cy - 10);
      ctx.lineTo(cx, cy + 10);
      ctx.stroke();

      // Corner registration marks
      const mk = 8;
      ctx.strokeStyle = '#f4f2eb';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx, by + mk); ctx.lineTo(bx, by); ctx.lineTo(bx + mk, by);
      ctx.moveTo(bx + bw - mk, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + mk);
      ctx.moveTo(bx, by + bh - mk); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + mk, by + bh);
      ctx.moveTo(bx + bw - mk, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - mk);
      ctx.stroke();
      ctx.restore();
    }

    // 10. Optional Bono corner sunglasses overlay (strictly in corners, never obscures playfield)
    if (bonoShades) {
      ctx.save();
      ctx.fillStyle = 'rgba(12, 13, 15, 0.72)';
      ctx.strokeStyle = '#d4a84f';
      ctx.lineWidth = 1.5;
      const wCorner = width * 0.14;
      const hCorner = height * 0.11;
      ctx.beginPath();
      ctx.roundRect(14, height - hCorner - 14, wCorner, hCorner, 18);
      ctx.roundRect(width - wCorner - 14, height - hCorner - 14, wCorner, hCorner, 18);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // Radiophonic-workshop / broom-cupboard set dressing for the back wall.
  // Everything is mapped in wall space (u: 0 left -> 1 right, v: 0 top -> 1
  // bottom) so it sits correctly in perspective, and kept dim and peripheral.
  function drawBackWallSet(tl, tr, fl, fr, elapsed, isWarmPhase) {
    const wallPoint = (u, v) => {
      const topX = tl.x + (tr.x - tl.x) * u;
      const topY = tl.y + (tr.y - tl.y) * u;
      const botX = fl.x + (fr.x - fl.x) * u;
      const botY = fl.y + (fr.y - fl.y) * u;
      return { x: topX + (botX - topX) * v, y: topY + (botY - topY) * v };
    };
    const wallQuadPath = (u0, v0, u1, v1) => {
      const a = wallPoint(u0, v0);
      const b = wallPoint(u1, v0);
      const c = wallPoint(u1, v1);
      const d2 = wallPoint(u0, v1);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d2.x, d2.y);
      ctx.closePath();
    };
    ctx.save();
    const gearAlpha = isWarmPhase ? 0.5 : 0.75;
    ctx.globalAlpha = gearAlpha;

    // -- Bar monitor, top-left of the wall: casing, screen, 7 colour bars.
    wallQuadPath(0.045, 0.07, 0.19, 0.3);
    ctx.fillStyle = '#191b1f';
    ctx.fill();
    ctx.strokeStyle = 'rgba(244,242,235,0.35)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    const bars = ['#8a8a86', '#b7a400', '#00a3a3', '#00923f', '#a3007b', '#c01c1c', '#1c3fa0'];
    const mu0 = 0.055;
    const mu1 = 0.18;
    const mv0 = 0.1;
    const mv1 = 0.26;
    for (let i = 0; i < bars.length; i++) {
      const bu0 = mu0 + ((mu1 - mu0) * i) / bars.length;
      const bu1 = mu0 + ((mu1 - mu0) * (i + 1)) / bars.length;
      wallQuadPath(bu0, mv0, bu1, mv1);
      ctx.fillStyle = bars[i];
      ctx.globalAlpha = gearAlpha * 0.6;
      ctx.fill();
    }
    ctx.globalAlpha = gearAlpha;

    // -- Tiny duck perched on the monitor casing: yellow body/head, orange
    // beak, green Mohican. A stylised nod to a certain broom-cupboard puppet.
    const duckBlocks = [
      // [u0, v0, u1, v1, colour]
      [0.085, 0.035, 0.115, 0.07, '#e8c832'],   // body
      [0.1, 0.005, 0.125, 0.04, '#e8c832'],    // head
      [0.125, 0.018, 0.14, 0.032, '#e07b28'],  // beak
      [0.104, -0.014, 0.121, 0.008, '#2f9e44'],// Mohican
      [0.09, 0.055, 0.1, 0.07, '#d4a017'],     // wing shade
    ];
    for (const [du0, dv0, du1, dv1, col] of duckBlocks) {
      wallQuadPath(du0, dv0, du1, dv1);
      ctx.fillStyle = col;
      ctx.fill();
    }
    const eye = wallPoint(0.121, 0.016);
    ctx.fillStyle = '#111214';
    ctx.fillRect(eye.x - 1, eye.y - 1, 2, 2);

    // -- VU meter, top-right: 8 bars bouncing on a slow pseudo-level pattern.
    wallQuadPath(0.8, 0.07, 0.955, 0.24);
    ctx.fillStyle = '#191b1f';
    ctx.fill();
    ctx.strokeStyle = 'rgba(244,242,235,0.35)';
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const level = 0.25 + 0.7 * Math.abs(Math.sin(elapsed * 2.2 + i * 1.7) * Math.cos(elapsed * 0.9 + i));
      const vu0 = 0.812 + i * 0.017;
      const vu1 = vu0 + 0.011;
      const vTop = 0.21 - level * 0.11;
      wallQuadPath(vu0, vTop, vu1, 0.21);
      ctx.fillStyle = i >= 6 ? '#c01c1c' : i >= 4 ? '#d4a84f' : '#00923f';
      ctx.fill();
    }

    // -- Patch bay, right edge: socket grid + one patched cable.
    wallQuadPath(0.86, 0.44, 0.965, 0.72);
    ctx.fillStyle = '#14161a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(244,242,235,0.25)';
    ctx.stroke();
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        const p = wallPoint(0.878 + c * 0.023, 0.49 + r * 0.075);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(244,242,235,0.4)';
        ctx.fill();
      }
    }
    const cab0 = wallPoint(0.878, 0.49);
    const cab1 = wallPoint(0.947, 0.64);
    const cabMid = wallPoint(0.93, 0.53);
    ctx.beginPath();
    ctx.moveTo(cab0.x, cab0.y);
    ctx.quadraticCurveTo(cabMid.x, cabMid.y + 8, cab1.x, cab1.y);
    ctx.strokeStyle = '#e0533c';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    // -- ON AIR lamp, left edge, mostly lit with a slow breathing glow.
    const onAir = 0.55 + 0.2 * Math.sin(elapsed * 1.4);
    wallQuadPath(0.045, 0.46, 0.125, 0.54);
    ctx.fillStyle = '#2a0f0c';
    ctx.fill();
    ctx.strokeStyle = `rgba(224,83,60,${(0.5 + onAir * 0.5).toFixed(3)})`;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    const oa0 = wallPoint(0.055, 0.478);
    const oa1 = wallPoint(0.115, 0.522);
    ctx.fillStyle = `rgba(224,83,60,${(0.35 + onAir * 0.55).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(oa0.x, oa0.y);
    ctx.lineTo(oa1.x, oa0.y);
    ctx.lineTo(oa1.x, oa1.y);
    ctx.lineTo(oa0.x, oa1.y);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawOpponentBat(paddle, boxes, style = 'default', theme, sx, sy, elapsed = 0, scorePoints = 0) {
    if (!paddle) return;
    const list = boxes && boxes.length > 0
      ? boxes
      : [{ x: paddle.x, y: paddle.y, width: paddle.width, height: paddle.height }];

    ctx.save();
    for (let i = 0; i < list.length; i++) {
      const box = list[i];
      const p1 = project(box.x - box.width * 0.5, box.y - box.height * 0.5, ROOM.opponentZ, sx, sy);
      const p2 = project(box.x + box.width * 0.5, box.y + box.height * 0.5, ROOM.opponentZ, sx, sy);
      const bx = p1.x;
      const by = p2.y;
      const bw = Math.max(6, p2.x - p1.x);
      const bh = Math.max(6, p1.y - p2.y);

      const bowieColors = ['#e0533c', '#4ea8de', '#d4a84f', '#f4f2eb'];
      const strokeCol = style === 'lou'
        ? '#f4f2eb'
        : style === 'bowie'
          ? bowieColors[Math.floor(scorePoints / 2) % bowieColors.length]
          : (theme.opponentColor || theme.accent);

      let fillTop;
      let fillBottom;
      if (style === 'lou') {
        [fillTop, fillBottom] = i % 2 === 0 ? ['rgba(255,255,255,0.94)', 'rgba(212,209,200,0.88)'] : ['rgba(34,35,38,0.96)', 'rgba(12,13,15,0.94)'];
      } else if (style === 'piano') {
        [fillTop, fillBottom] = i % 2 === 0 ? ['rgba(255,255,255,0.95)', 'rgba(214,211,202,0.92)'] : ['rgba(36,37,41,0.96)', 'rgba(14,15,18,0.95)'];
      } else if (style === 'horn') {
        [fillTop, fillBottom] = ['rgba(226, 188, 100, 0.34)', 'rgba(196, 146, 58, 0.2)'];
      } else {
        [fillTop, fillBottom] = ['rgba(238, 105, 84, 0.3)', 'rgba(210, 62, 42, 0.18)'];
      }

      // Metallic 16-bit bar: vertical gradient fill + top bevel highlight
      const batGrad = ctx.createLinearGradient(0, by, 0, by + bh);
      batGrad.addColorStop(0, fillTop);
      batGrad.addColorStop(1, fillBottom);
      ctx.fillStyle = batGrad;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx + 1.5, by + 1.5);
      ctx.lineTo(bx + bw - 1.5, by + 1.5);
      ctx.stroke();
      ctx.restore();

      // Abstract opponent motifs (never likenesses)
      if (style === 'horn') {
        // Flared brass bell lines inside wide bat
        ctx.beginPath();
        ctx.moveTo(bx + bw * 0.15, by + bh * 0.5);
        ctx.lineTo(bx + bw * 0.85, by + bh * 0.15);
        ctx.moveTo(bx + bw * 0.15, by + bh * 0.5);
        ctx.lineTo(bx + bw * 0.85, by + bh * 0.85);
        ctx.stroke();
      } else if (style === 'pulse') {
        const pulseR = (0.4 + 0.35 * (Math.sin(elapsed * 4.5) * 0.5 + 0.5)) * Math.max(bw, bh);
        ctx.beginPath();
        ctx.arc(bx + bw * 0.5, by + bh * 0.5, pulseR, 0, Math.PI * 2);
        ctx.stroke();
      } else if (style === 'bono') {
        // Twin lens motif inside bat
        const r = Math.min(bw * 0.2, bh * 0.35);
        ctx.beginPath();
        ctx.arc(bx + bw * 0.3, by + bh * 0.5, r, 0, Math.PI * 2);
        ctx.arc(bx + bw * 0.7, by + bh * 0.5, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (style === 'bowie') {
        // Sharp diagonal geometric bolt
        ctx.beginPath();
        ctx.moveTo(bx + bw * 0.65, by);
        ctx.lineTo(bx + bw * 0.3, by + bh * 0.5);
        ctx.lineTo(bx + bw * 0.7, by + bh * 0.5);
        ctx.lineTo(bx + bw * 0.35, by + bh);
        ctx.stroke();
      } else if (style === 'quartet') {
        ctx.beginPath();
        ctx.moveTo(bx, by + bh * 0.5);
        ctx.lineTo(bx + bw, by + bh * 0.5);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  resize();
  return {
    resize,
    renderMatch,
    getSize: () => ({ width, height }),
  };
}
