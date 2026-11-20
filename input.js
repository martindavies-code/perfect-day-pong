/**
 * Unified input handler: Mouse (pointer lock + fallback), Gamepad API, Keyboard.
 * Last-used input wins; exposes edge-triggered menu/action events and bat axes.
 */

export function createInputManager(canvas, getSettings) {
  const keys = new Set();
  let lastInputMethod = 'mouse';
  let pointerLocked = false;
  let pointerNormX = 0; // [-1, 1] in fallback mode
  let pointerNormY = 0;
  let virtualMouseX = 0; // [-1, 1] accumulated in pointer-lock mode
  let virtualMouseY = 0;
  let mouseDeltaMoved = false;

  // Gamepad state
  let activePadIndex = null;
  let prevButtons = [];
  let padDisconnectedMidMatch = false;
  let stickNavLatchX = 0;
  let stickNavLatchY = 0;

  // Action edge queue
  const pendingActions = new Set();
  const listeners = {
    mute: [],
    pause: [],
    confirm: [],
    back: [],
    ability: [],
    nav: [],
    padDisconnect: [],
    gesture: [],
  };

  function emit(type, payload) {
    for (const fn of listeners[type] || []) {
      fn(payload);
    }
  }

  function applyDeadzone(val, dz = 0.15) {
    const abs = Math.abs(val);
    if (abs <= dz) return 0;
    const norm = (abs - dz) / (1 - dz);
    // Smooth curve for precision near centre
    const curved = Math.pow(norm, 1.35);
    return Math.sign(val) * Math.min(1, curved);
  }

  function onKeyDown(e) {
    emit('gesture');
    const code = e.code;
    if (
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code) ||
      (code === 'Enter' && e.target?.tagName !== 'INPUT' && e.target?.tagName !== 'SELECT')
    ) {
      e.preventDefault();
    }
    const firstPress = !keys.has(code);
    keys.add(code);

    if (
      code.startsWith('Arrow') ||
      code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD'
    ) {
      lastInputMethod = 'keyboard';
    }

    if (!firstPress) return;

    if (code === 'KeyM') {
      emit('mute');
    } else if (code === 'Escape' || code === 'KeyP') {
      lastInputMethod = 'keyboard';
      emit('pause');
      emit('back');
    } else if (code === 'Enter' || code === 'Space') {
      lastInputMethod = 'keyboard';
      emit('confirm');
      pendingActions.add('confirm');
    } else if (code === 'ArrowUp' || code === 'KeyW') {
      emit('nav', 'up');
    } else if (code === 'ArrowDown' || code === 'KeyS') {
      emit('nav', 'down');
    } else if (code === 'ArrowLeft' || code === 'KeyA') {
      emit('nav', 'left');
    } else if (code === 'ArrowRight' || code === 'KeyD') {
      emit('nav', 'right');
    } else if (code === 'KeyQ' || code === 'KeyE' || code === 'ShiftLeft' || code === 'ShiftRight') {
      lastInputMethod = 'keyboard';
      emit('ability');
      pendingActions.add('ability');
    }
  }

  function onKeyUp(e) {
    keys.delete(e.code);
  }

  // Layout is stable between resizes/scrolls. Do not force layout on every
  // high-frequency mouse event, especially immediately before a paddle hit.
  let canvasRect = canvas.getBoundingClientRect();
  function refreshCanvasRect() { canvasRect = canvas.getBoundingClientRect(); }
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refreshCanvasRect) : null;
  resizeObserver?.observe(canvas);
  window.addEventListener('resize', refreshCanvasRect);
  window.addEventListener('scroll', refreshCanvasRect, true);

  function onMouseMove(e) {
    lastInputMethod = 'mouse';
    mouseDeltaMoved = true;
    const sens = (getSettings?.().mouseSensitivity ?? 1.0);
    if (pointerLocked) {
      const scale = 0.0028 * sens;
      virtualMouseX = Math.max(-1, Math.min(1, virtualMouseX + e.movementX * scale));
      virtualMouseY = Math.max(-1, Math.min(1, virtualMouseY - e.movementY * scale));
    } else {
      const rect = canvasRect;
      if (rect.width > 0 && rect.height > 0) {
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        pointerNormX = Math.max(-1, Math.min(1, nx * (0.95 + sens * 0.2)));
        pointerNormY = Math.max(-1, Math.min(1, ny * (0.95 + sens * 0.2)));
      }
    }
  }

  function onMouseDown(e) {
    emit('gesture');
    if (e.button === 0) {
      lastInputMethod = 'mouse';
      emit('confirm');
      pendingActions.add('confirm');
    } else if (e.button === 2) {
      lastInputMethod = 'mouse';
      emit('ability');
      pendingActions.add('ability');
    }
  }

  function onPointerLockChange() {
    pointerLocked = document.pointerLockElement === canvas;
    if (pointerLocked) {
      // Seed virtual cursor from current fallback norm
      virtualMouseX = pointerNormX;
      virtualMouseY = pointerNormY;
    }
  }

  function onPointerLockError() {
    pointerLocked = false;
  }

  function onGamepadConnected() {
    // First-pressed pad wins (do not claim activePadIndex until a button/axis is pressed)
  }

  function onGamepadDisconnected(e) {
    if (e.gamepad.index === activePadIndex) {
      activePadIndex = null;
      prevButtons = [];
      stickNavLatchX = 0;
      stickNavLatchY = 0;
      padDisconnectedMidMatch = true;
      emit('padDisconnect');
    }
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('pointerlockerror', onPointerLockError);
  window.addEventListener('gamepadconnected', onGamepadConnected);
  window.addEventListener('gamepaddisconnected', onGamepadDisconnected);

  function requestPointerLock() {
    try {
      if (canvas.requestPointerLock && document.pointerLockElement !== canvas) {
        const res = canvas.requestPointerLock();
        if (res && typeof res.catch === 'function') {
          res.catch(() => { pointerLocked = false; });
        }
      }
    } catch {
      pointerLocked = false;
    }
  }

  function exitPointerLock() {
    try {
      if (document.pointerLockElement === canvas && document.exitPointerLock) {
        document.exitPointerLock();
      }
    } catch {
      // ignore
    }
  }

  function pollGamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (!pads) return null;

    // If no active pad yet, or another pad has a fresh press when active is idle, pick first pressed
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p || !p.connected) continue;
      const anyBtn = p.buttons && p.buttons.some((b) => b && b.pressed);
      const anyAxis = p.axes && p.axes.some((a) => Math.abs(a) > 0.35);
      if (anyBtn || anyAxis) {
        if (activePadIndex === null) {
          activePadIndex = p.index;
          prevButtons = [];
        }
        break;
      }
    }

    const pad = activePadIndex !== null ? pads[activePadIndex] : null;
    if (!pad || !pad.connected) return null;

    const btns = pad.buttons || [];
    const pressedNow = btns.map((b) => Boolean(b && b.pressed));
    const justPressed = (idx) => Boolean(pressedNow[idx] && !prevButtons[idx]);

    const anyJustPressed = pressedNow.some((v, idx) => v && !prevButtons[idx]);
    if (anyJustPressed) {
      emit('gesture');
      lastInputMethod = 'gamepad';
    }

    // Standard mapping + fallback indices (0=A, 1=B, 9=Start, 4/5/6/7=bumpers/triggers)
    if (justPressed(0)) {
      emit('confirm');
      pendingActions.add('confirm');
    }
    if (justPressed(1)) {
      emit('back');
    }
    if (justPressed(9)) {
      emit('pause');
    }
    if (justPressed(4) || justPressed(5) || justPressed(6) || justPressed(7)) {
      emit('ability');
      pendingActions.add('ability');
    }

    // D-pad up/down/left/right (12, 13, 14, 15) + Left stick (axes 0, 1)
    let ax = applyDeadzone(pad.axes?.[0] ?? 0);
    let ay = -applyDeadzone(pad.axes?.[1] ?? 0);

    if (pressedNow[14]) ax = -1;
    if (pressedNow[15]) ax = 1;
    if (pressedNow[12]) ay = 1;
    if (pressedNow[13]) ay = -1;

    if (Math.abs(ax) > 0 || Math.abs(ay) > 0) {
      lastInputMethod = 'gamepad';
    }

    // Menu navigation edge triggers on d-pad and left stick
    const navUp = justPressed(12);
    const navDown = justPressed(13);
    const navLeft = justPressed(14);
    const navRight = justPressed(15);

    const sxRaw = pad.axes?.[0] ?? 0;
    const syRaw = pad.axes?.[1] ?? 0;
    const sxDir = sxRaw > 0.55 ? 1 : sxRaw < -0.55 ? -1 : 0;
    const syDir = syRaw > 0.55 ? 1 : syRaw < -0.55 ? -1 : 0;

    if (navUp || (syDir === -1 && stickNavLatchY !== -1)) emit('nav', 'up');
    if (navDown || (syDir === 1 && stickNavLatchY !== 1)) emit('nav', 'down');
    if (navLeft || (sxDir === -1 && stickNavLatchX !== -1)) emit('nav', 'left');
    if (navRight || (sxDir === 1 && stickNavLatchX !== 1)) emit('nav', 'right');
    stickNavLatchX = sxDir;
    stickNavLatchY = syDir;

    prevButtons = pressedNow;
    return { ax, ay, navUp, navDown, navLeft, navRight, id: pad.id };
  }

  function update(dt) {
    const padState = pollGamepad();

    let kx = 0;
    let ky = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) kx -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) kx += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) ky += 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) ky -= 1;

    const result = {
      method: lastInputMethod,
      pointerLocked,
      mode: 'velocity', // 'absolute' | 'velocity'
      targetNormX: 0,
      targetNormY: 0,
      velX: 0,
      velY: 0,
      padConnected: Boolean(padState),
      padId: padState?.id || null,
      padNav: padState
        ? { up: padState.navUp, down: padState.navDown, left: padState.navLeft, right: padState.navRight }
        : null,
      confirmPressed: pendingActions.has('confirm'),
      abilityPressed: pendingActions.has('ability'),
    };
    pendingActions.clear();

    if (lastInputMethod === 'mouse') {
      result.mode = 'absolute';
      result.targetNormX = pointerLocked ? virtualMouseX : pointerNormX;
      result.targetNormY = pointerLocked ? virtualMouseY : pointerNormY;
    } else if (lastInputMethod === 'gamepad' && padState) {
      result.mode = 'velocity';
      result.velX = padState.ax;
      result.velY = padState.ay;
    } else {
      result.mode = 'velocity';
      result.velX = kx;
      result.velY = ky;
    }

    // Sync virtual mouse when returning from non-mouse
    if (mouseDeltaMoved) {
      mouseDeltaMoved = false;
    }
    void dt;
    return result;
  }

  function on(type, fn) {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(fn);
    return () => {
      listeners[type] = listeners[type].filter((f) => f !== fn);
    };
  }

  function setVirtualCursor(nx, ny) {
    virtualMouseX = Math.max(-1, Math.min(1, nx));
    virtualMouseY = Math.max(-1, Math.min(1, ny));
    pointerNormX = virtualMouseX;
    pointerNormY = virtualMouseY;
  }

  function destroy() {
    resizeObserver?.disconnect();
    window.removeEventListener('resize', refreshCanvasRect);
    window.removeEventListener('scroll', refreshCanvasRect, true);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('pointerlockchange', onPointerLockChange);
    document.removeEventListener('pointerlockerror', onPointerLockError);
    window.removeEventListener('gamepadconnected', onGamepadConnected);
    window.removeEventListener('gamepaddisconnected', onGamepadDisconnected);
  }

  return {
    update,
    on,
    requestPointerLock,
    exitPointerLock,
    setVirtualCursor,
    getLastInputMethod: () => lastInputMethod,
    isPointerLocked: () => pointerLocked,
    wasPadDisconnected: () => {
      const v = padDisconnectedMidMatch;
      padDisconnectedMidMatch = false;
      return v;
    },
    destroy,
  };
}
