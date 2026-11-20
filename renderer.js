import { ROOM, VIEW_INSET } from './logic.js';

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
    // Focal length scaled to viewport so the front plane fills ~76% of the frame cleanly
    const focal = Math.min(width * 0.62, height * 0.92) * VIEW_INSET;
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

      // 7. Ball in 3D perspective
      const bp = project(ball.x, ball.y, ball.z, sx, sy);
      const bRad = Math.max(4, ball.radius * bp.scale);
      ctx.save();
      ctx.fillStyle = '#f4f2eb';
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

      if (style === 'lou') {
        ctx.fillStyle = i % 2 === 0 ? 'rgba(244,242,235,0.88)' : 'rgba(18,19,21,0.94)';
      } else if (style === 'piano') {
        ctx.fillStyle = i % 2 === 0 ? 'rgba(244,242,235,0.92)' : 'rgba(20,21,24,0.95)';
      } else if (style === 'horn') {
        ctx.fillStyle = 'rgba(212, 168, 79, 0.25)';
      } else {
        ctx.fillStyle = 'rgba(224, 83, 60, 0.22)';
      }

      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);

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
