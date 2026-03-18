/* ─────────────────────────────────────────────
   Claude Code Pet — Renderer
   Animation states are 100% driven by Claude
   process detection from main.js (ps-list, 1s poll).

   Timeline when Claude is detected running:
     0s  → WORKING   (excited face, fast bounce)
     3s  → WAVING    (sweat face, anime wave + arm + speed lines)
     10s → FRUSTRATED (angry face, gentle tremble)
   When Claude stops → immediately back to IDLE
───────────────────────────────────────────── */

const canvas    = document.getElementById('pet');
const ctx       = canvas.getContext('2d');
const container = document.getElementById('pet-container');

// ── Timings ────────────────────────────────────────
const DEFAULT_TIMINGS = {
  workingToWaving:    3000,
  wavingToFrustrated: 10000,
  idleBubbleMin:      20000,
  idleBubbleRandom:   25000,
  idleBobDuration:    1500,
  workBounceDuration: 420,
  waveAnimDuration:   220,
  trembleAnimDuration:400,
};
let timings = { ...DEFAULT_TIMINGS };

function applyTimings(t) {
  if (!t) return;
  timings = { ...DEFAULT_TIMINGS, ...t };
  const r = document.documentElement;
  r.style.setProperty('--dur-idle-bob',    timings.idleBobDuration + 'ms');
  r.style.setProperty('--dur-work-bounce', timings.workBounceDuration + 'ms');
  r.style.setProperty('--dur-wave-anim',   timings.waveAnimDuration + 'ms');
  r.style.setProperty('--dur-tremble',     timings.trembleAnimDuration + 'ms');
}

function applySize(petSize) {
  const scale = (petSize ?? 100) / 100;
  document.body.style.zoom = scale;
  // Counter-scale speech bubble so text stays readable at any pet size
  const r = document.documentElement;
  r.style.setProperty('--bubble-font-size', (9  / scale).toFixed(1) + 'px');
  r.style.setProperty('--bubble-max-width', (130 / scale).toFixed(0) + 'px');
  r.style.setProperty('--bubble-padding',   `${(5 / scale).toFixed(1)}px ${(8 / scale).toFixed(1)}px`);
}

// ── Pet name ───────────────────────────────────────
let petName = 'Claude';
window.petAPI.getSettings().then(s => {
  petName = s.petName || 'Claude';
  applyTimings(s.timings);
  applySize(s.petSize);
}).catch(() => {});
window.petAPI.onPetNameUpdated(name => { petName = name || 'Claude'; });
window.petAPI.onSettingsUpdated(s => {
  petName = s.petName || 'Claude';
  applyTimings(s.timings);
  applySize(s.petSize);
});

// ── Message library ────────────────────────────────
const MSGS = {
  idle:          ['Pet me!', '...zzzz', '*yawns*', 'Watching over you!'],
  working_start: n => [`${n} is on it!`, `Claude & ${n} working...`, 'On your request!'],
  waving:        n => [`${n} thinks it'll take more time...`, 'Claude is thinking hard!', 'Hmm, still thinking...'],
  frustrated:    n => [`${n} is getting impatient!`, 'Come on Claude! 😤', 'Still waiting...'],
  done_quick:    ['Done!', 'That was quick!'],
  done_slow:     n => [`Finally! ${n} can relax 😅`, 'Phew! All done!', `${n} was patient!`],
  petting:       n => ['Hehe!', 'Thanks!', `${n} is happy!`, 'More pets please!'],
  feeding:       n => ['Nom nom!', 'Yum!', 'More fish!', `${n} loves it!`, '🐟!'],
};
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── Speech bubble ──────────────────────────────────
let bubbleHideTimer = null;

function showBubble(text, duration = 3500) {
  clearTimeout(bubbleHideTimer);
  const el = document.getElementById('speech-bubble');
  el.textContent = text;
  el.classList.add('visible');
  bubbleHideTimer = setTimeout(() => {
    el.classList.remove('visible');
  }, duration);
}

// ── Idle bubble scheduler ──────────────────────────
let idleBubbleTimer = null;

function scheduleIdleBubble() {
  clearTimeout(idleBubbleTimer);
  idleBubbleTimer = setTimeout(() => {
    if (currentState === STATES.IDLE) {
      showBubble(pick(MSGS.idle), 3000);
    }
    scheduleIdleBubble();
  }, timings.idleBubbleMin + Math.random() * timings.idleBubbleRandom);
}

// ── Palette ────────────────────────────────────────
const PAL = [
  null,       // 0  transparent
  '#DA7756',  // 1  orange
  '#C4614A',  // 2  dark orange (outline)
  '#FAF7F0',  // 3  cream (belly / eye whites)
  '#2D1B4E',  // 4  dark (pupils / nose)
  '#F9A8A0',  // 5  pink (inner ear / tongue)
  '#7C3AED',  // 6  purple (pupils)
  '#93C5FD',  // 7  light blue (sweat)
];

const _ = 0, O = 1, D = 2, C = 3, B = 4, K = 5, V = 6, W = 7;

// ── Pixel frames (16 × 16) ─────────────────────────
const FRAMES = {
  // Idle — eyes open
  open: [
    [_,_,_,D,D,_,_,_,_,_,_,D,D,_,_,_],
    [_,_,D,O,O,D,_,_,_,_,D,O,O,D,_,_],
    [_,_,D,K,O,D,_,_,_,_,D,K,O,D,_,_],
    [_,D,D,D,D,D,D,D,D,D,D,D,D,D,D,_],
    [_,D,O,O,O,O,O,O,O,O,O,O,O,O,D,_],
    [_,D,O,C,C,O,O,O,O,O,C,C,O,O,D,_],
    [_,D,O,V,C,O,O,O,O,O,V,C,O,O,D,_],
    [_,D,O,C,C,O,O,B,O,O,C,C,O,O,D,_],
    [_,D,O,O,O,O,O,O,O,O,O,O,O,O,D,_],
    [_,D,O,C,C,C,C,C,C,C,C,C,C,O,D,_],
    [_,D,O,C,C,C,C,C,C,C,C,C,C,O,D,_],
    [_,D,O,O,O,O,O,O,O,O,O,O,O,O,D,_],
    [_,D,O,D,_,_,O,O,O,O,_,_,D,O,D,_],
    [_,D,O,D,_,_,O,O,O,O,_,_,D,O,D,_],
    [_,_,D,D,_,_,D,D,D,D,_,_,D,D,_,_],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  ],

  // Blink
  blink: [
    [_,_,_,D,D,_,_,_,_,_,_,D,D,_,_,_],
    [_,_,D,O,O,D,_,_,_,_,D,O,O,D,_,_],
    [_,_,D,K,O,D,_,_,_,_,D,K,O,D,_,_],
    [_,D,D,D,D,D,D,D,D,D,D,D,D,D,D,_],
    [_,D,O,O,O,O,O,O,O,O,O,O,O,O,D,_],
    [_,D,O,O,O,O,O,O,O,O,O,O,O,O,D,_],
    [_,D,O,B,B,O,O,O,O,O,B,B,O,O,D,_],
    [_,D,O,O,O,O,O,B,O,O,O,O,O,O,D,_],
    [_,D,O,O,O,O,O,O,O,O,O,O,O,O,D,_],
    [_,D,O,C,C,C,C,C,C,C,C,C,C,O,D,_],
    [_,D,O,C,C,C,C,C,C,C,C,C,C,O,D,_],
    [_,D,O,O,O,O,O,O,O,O,O,O,O,O,D,_],
    [_,D,O,D,_,_,O,O,O,O,_,_,D,O,D,_],
    [_,D,O,D,_,_,O,O,O,O,_,_,D,O,D,_],
    [_,_,D,D,_,_,D,D,D,D,_,_,D,D,_,_],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  ],

  // Petting — happy squint + blush + smile
  happy: [
    [_,_,_,D,D,_,_,_,_,_,_,D,D,_,_,_],
    [_,_,D,O,O,D,_,_,_,_,D,O,O,D,_,_],
    [_,_,D,K,O,D,_,_,_,_,D,K,O,D,_,_],
    [_,D,D,D,D,D,D,D,D,D,D,D,D,D,D,_],
    [_,D,O,O,O,O,O,O,O,O,O,O,O,O,D,_],
    [_,D,K,O,O,O,O,O,O,O,O,O,O,K,D,_],
    [_,D,O,B,B,O,O,O,O,O,B,B,O,O,D,_],
    [_,D,O,O,O,O,O,B,O,O,O,O,O,O,D,_],
    [_,D,O,O,O,B,B,O,B,B,O,O,O,O,D,_],
    [_,D,O,C,C,C,C,C,C,C,C,C,C,O,D,_],
    [_,D,O,C,C,C,C,C,C,C,C,C,C,O,D,_],
    [_,D,O,O,O,O,O,O,O,O,O,O,O,O,D,_],
    [_,D,O,D,_,_,O,O,O,O,_,_,D,O,D,_],
    [_,D,O,D,_,_,O,O,O,O,_,_,D,O,D,_],
    [_,_,D,D,_,_,D,D,D,D,_,_,D,D,_,_],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  ],

  // Excited — Claude just started (wide eyes + open mouth)
  excited: [
    [_,_,_,D,D,_,_,_,_,_,_,D,D,_,_,_],
    [_,_,D,O,O,D,_,_,_,_,D,O,O,D,_,_],
    [_,_,D,K,O,D,_,_,_,_,D,K,O,D,_,_],
    [_,D,D,D,D,D,D,D,D,D,D,D,D,D,D,_],
    [_,D,O,C,C,O,O,O,O,O,C,C,O,O,D,_],
    [_,D,O,C,V,O,O,O,O,O,C,V,O,O,D,_],
    [_,D,O,V,C,O,O,O,O,O,V,C,O,O,D,_],
    [_,D,O,C,C,O,O,B,O,O,C,C,O,O,D,_],
    [_,D,O,O,O,B,O,O,O,B,O,O,O,O,D,_],
    [_,D,O,C,C,C,C,C,C,C,C,C,C,O,D,_],
    [_,D,O,C,C,C,C,C,C,C,C,C,C,O,D,_],
    [_,D,O,O,O,O,O,O,O,O,O,O,O,O,D,_],
    [_,D,O,D,_,_,O,O,O,O,_,_,D,O,D,_],
    [_,D,O,D,_,_,O,O,O,O,_,_,D,O,D,_],
    [_,_,D,D,_,_,D,D,D,D,_,_,D,D,_,_],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  ],

  // Sweat — Claude working 3-10s (sweat drop, still trying)
  sweat: [
    [_,_,_,D,D,_,_,_,_,_,_,D,D,_,W,_],  // sweat drop tip at col 14
    [_,_,D,O,O,D,_,_,_,_,D,O,O,D,W,W],  // sweat widens
    [_,_,D,K,O,D,_,_,_,_,D,K,O,D,W,_],  // sweat base
    [_,D,D,D,D,D,D,D,D,D,D,D,D,D,D,_],
    [_,D,O,C,C,O,O,O,O,O,C,C,O,O,D,_],
    [_,D,O,C,V,O,O,O,O,O,C,V,O,O,D,_],
    [_,D,O,V,C,O,O,O,O,O,V,C,O,O,D,_],
    [_,D,O,C,C,O,O,B,O,O,C,C,O,O,D,_],
    [_,D,O,O,O,B,O,O,O,B,O,O,O,O,D,_],
    [_,D,O,C,C,C,C,C,C,C,C,C,C,O,D,_],
    [_,D,O,C,C,C,C,C,C,C,C,C,C,O,D,_],
    [_,D,O,O,O,O,O,O,O,O,O,O,O,O,D,_],
    [_,D,O,D,_,_,O,O,O,O,_,_,D,O,D,_],
    [_,D,O,D,_,_,O,O,O,O,_,_,D,O,D,_],
    [_,_,D,D,_,_,D,D,D,D,_,_,D,D,_,_],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  ],

  // Angry — Claude taking >10s (furrowed brows, frown, anger marks)
  angry: [
    [_,_,_,D,D,_,_,B,B,_,_,D,D,_,_,_],  // anger mark between ears
    [_,_,D,O,O,D,B,_,_,B,D,O,O,D,_,_],  // anger mark arms
    [_,_,D,K,O,D,_,_,_,_,D,K,O,D,_,_],
    [_,D,D,D,D,D,D,D,D,D,D,D,D,D,D,_],
    [_,D,O,O,B,O,O,O,O,O,B,O,O,O,D,_],  // inner brows down-center
    [_,D,O,B,O,O,O,O,O,O,O,B,O,O,D,_],  // outer brows (\ /)
    [_,D,O,B,B,O,O,O,O,O,B,B,O,O,D,_],  // narrow angry eyes
    [_,D,O,O,O,O,O,B,O,O,O,O,O,O,D,_],  // nose
    [_,D,O,O,B,B,O,O,O,B,B,O,O,O,D,_],  // frown corners (down)
    [_,D,O,C,C,C,C,C,C,C,C,C,C,O,D,_],
    [_,D,O,C,C,C,C,C,C,C,C,C,C,O,D,_],
    [_,D,O,O,O,O,O,O,O,O,O,O,O,O,D,_],
    [_,D,O,D,_,_,O,O,O,O,_,_,D,O,D,_],
    [_,D,O,D,_,_,O,O,O,O,_,_,D,O,D,_],
    [_,_,D,D,_,_,D,D,D,D,_,_,D,D,_,_],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  ],
};

// ── Draw ───────────────────────────────────────────
function drawFrame(frame) {
  ctx.clearRect(0, 0, 16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const c = frame[y][x];
      if (c === 0) continue;
      ctx.fillStyle = PAL[c];
      ctx.fillRect(x, y, 1, 1);
    }
}

// ── State machine ──────────────────────────────────
const STATES = {
  IDLE:       'idle',
  WORKING:    'working',   // Claude detected, 0–3s
  WAVING:     'waving',    // Claude detected, 3–10s
  FRUSTRATED: 'frustrated',// Claude detected, >10s
  HOVER:      'hover',
  PETTING:    'petting',
  FEEDING:    'feeding',
  DRAGGING:   'dragging',
  DANCING:    'dancing',
};

let currentState = STATES.IDLE;
let claudeActive = false;

function setState(next) {
  const prev = currentState;
  container.classList.remove(...Object.values(STATES));
  container.classList.add(next);
  currentState = next;

  if      (next === STATES.PETTING)    drawFrame(FRAMES.happy);
  else if (next === STATES.DANCING)    drawFrame(FRAMES.happy);
  else if (next === STATES.FEEDING)    drawFrame(FRAMES.happy);
  else if (next === STATES.WORKING)    drawFrame(FRAMES.excited);
  else if (next === STATES.WAVING)     drawFrame(FRAMES.sweat);
  else if (next === STATES.FRUSTRATED) drawFrame(FRAMES.angry);
  else                                 drawFrame(FRAMES.open);

  if (next === STATES.WORKING && (prev === STATES.IDLE || prev === STATES.HOVER)) {
    showBubble(pick(MSGS.working_start(petName)));
  } else if (next === STATES.WAVING) {
    showBubble(pick(MSGS.waving(petName)));
  } else if (next === STATES.FRUSTRATED) {
    showBubble(pick(MSGS.frustrated(petName)));
  }
}

function resolveBaseState() {
  return claudeActive ? STATES.WORKING : STATES.IDLE;
}

// ── Escalation timers (driven by Claude detection) ─
// These only run when claudeActive=true. They are cancelled
// the moment Claude stops, resetting to IDLE cleanly.
let waveTimer  = null;
let frustTimer = null;

function startWorkTimers() {
  clearTimeout(waveTimer);
  clearTimeout(frustTimer);
  waveTimer  = setTimeout(() => { if (claudeActive) setState(STATES.WAVING);     }, timings.workingToWaving);
  frustTimer = setTimeout(() => { if (claudeActive) setState(STATES.FRUSTRATED); }, timings.wavingToFrustrated);
}

function stopWorkTimers() {
  clearTimeout(waveTimer);
  clearTimeout(frustTimer);
}

// ── Claude state (from main process ps-list poll) ──
let claudeStartTime = null;

window.petAPI.onClaudeState(state => {
  claudeActive = (state === 'working');

  if (claudeActive) {
    // Only start timers when transitioning from a non-working state
    if (currentState === STATES.IDLE || currentState === STATES.HOVER) {
      claudeStartTime = Date.now();
      setState(STATES.WORKING);
      startWorkTimers();
    }
  } else {
    // Claude finished — reset everything immediately
    const elapsed = claudeStartTime ? Date.now() - claudeStartTime : 0;
    claudeStartTime = null;
    stopWorkTimers();
    if ([STATES.WORKING, STATES.WAVING, STATES.FRUSTRATED].includes(currentState)) {
      setState(STATES.IDLE);
      if (elapsed >= 10000) {
        showBubble(pick(MSGS.done_slow(petName)), 4000);
      } else if (elapsed >= 3000) {
        showBubble(pick(MSGS.done_quick), 2500);
      }
    }
  }
});

// ── Auto-blink (idle only) ─────────────────────────
let blinkTimer = null;
function scheduleBlink() {
  clearTimeout(blinkTimer);
  blinkTimer = setTimeout(() => {
    if (currentState === STATES.IDLE || currentState === STATES.HOVER) {
      drawFrame(FRAMES.blink);
      setTimeout(() => {
        if (currentState === STATES.IDLE || currentState === STATES.HOVER) drawFrame(FRAMES.open);
        scheduleBlink();
      }, 140);
    } else {
      scheduleBlink();
    }
  }, 3000 + Math.random() * 4000);
}

// ── Drag ───────────────────────────────────────────
let dragActive = false;
let dragStartX = 0, dragStartY = 0, lastMouseX = 0, lastMouseY = 0;
const DRAG_THRESHOLD = 3;

canvas.addEventListener('mouseenter', () => {
  window.petAPI.setIgnoreMouse(false);
  if (![STATES.PETTING, STATES.DRAGGING].includes(currentState)) setState(STATES.HOVER);
});

canvas.addEventListener('mouseleave', () => {
  if (!dragActive) {
    window.petAPI.setIgnoreMouse(true);
    if (currentState === STATES.HOVER) setState(resolveBaseState());
  }
});

canvas.addEventListener('contextmenu', e => { e.preventDefault(); feed(); });

canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  dragActive = true;
  dragStartX = lastMouseX = e.screenX;
  dragStartY = lastMouseY = e.screenY;
  window.petAPI.dragStart();
  e.preventDefault();
});

window.addEventListener('mousemove', e => {
  if (!dragActive) return;
  const dx = e.screenX - lastMouseX, dy = e.screenY - lastMouseY;
  lastMouseX = e.screenX; lastMouseY = e.screenY;
  if (Math.hypot(e.screenX - dragStartX, e.screenY - dragStartY) > DRAG_THRESHOLD && currentState !== STATES.DRAGGING)
    setState(STATES.DRAGGING);
  if (currentState === STATES.DRAGGING)
    window.petAPI.moveWindow({ deltaX: dx, deltaY: dy });
});

window.addEventListener('mouseup', e => {
  if (!dragActive || e.button !== 0) return;
  dragActive = false;
  const moved = Math.hypot(e.screenX - dragStartX, e.screenY - dragStartY);
  window.petAPI.dragEnd();
  if (moved < DRAG_THRESHOLD) {
    pet();
  } else {
    window.petAPI.setIgnoreMouse(true);
    setState(resolveBaseState());
  }
});

// ── Petting & Feeding ──────────────────────────────
const PARTICLES      = ['♥', '✦', '★', '✿', '♥', '✦'];
const PET_COLORS     = ['#DA7756', '#C4614A', '#7C3AED', '#f9a8d4', '#fbbf24', '#a78bfa'];
const FOOD_PARTICLES = ['🐟', '🍣', '🐠', '🐟', '🍣'];
let pettingTimer = null;
let feedingTimer = null;

function spawnParticles() {
  PARTICLES.forEach((sym, i) => setTimeout(() => {
    const el = document.createElement('div');
    el.className   = 'particle';
    el.textContent = sym;
    el.style.color     = PET_COLORS[Math.floor(Math.random() * PET_COLORS.length)];
    el.style.left      = (25 + Math.random() * 90) + 'px';
    el.style.top       = (10 + Math.random() * 55) + 'px';
    el.style.fontSize  = (12 + Math.random() * 9) + 'px';
    container.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }, i * 90));
}

function pet() {
  clearTimeout(pettingTimer);
  clearTimeout(feedingTimer);
  stopWorkTimers();
  setState(STATES.PETTING);
  spawnParticles();
  showBubble(pick(MSGS.petting(petName)), 2000);
  pettingTimer = setTimeout(() => {
    setState(resolveBaseState());
    if (claudeActive) startWorkTimers();
    window.petAPI.setIgnoreMouse(true);
  }, 950);
}

function spawnFoodParticles() {
  FOOD_PARTICLES.forEach((sym, i) => setTimeout(() => {
    const el = document.createElement('div');
    el.className   = 'particle';
    el.textContent = sym;
    el.style.left     = (20 + Math.random() * 100) + 'px';
    el.style.top      = (20 + Math.random() * 50)  + 'px';
    el.style.fontSize = (14 + Math.random() * 8)   + 'px';
    container.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }, i * 110));
}

function feed() {
  clearTimeout(feedingTimer);
  clearTimeout(pettingTimer);
  stopWorkTimers();
  setState(STATES.FEEDING);
  spawnFoodParticles();
  showBubble(pick(MSGS.feeding(petName)), 2000);
  feedingTimer = setTimeout(() => {
    setState(resolveBaseState());
    if (claudeActive) startWorkTimers();
    window.petAPI.setIgnoreMouse(true);
  }, 950);
}

// ── Music / dancing ────────────────────────────────
const DANCE_MSGS = ['♪ vibing!', '♫ bop bop!', '🎵', 'feel the beat!', '♪♫♪', 'let\'s dance!'];
let musicPlaying = false;
let danceTimer   = null;

function dance() {
  clearTimeout(pettingTimer);
  clearTimeout(feedingTimer);
  stopWorkTimers();
  setState(STATES.DANCING);
  showBubble(pick(DANCE_MSGS), 2200);
  setTimeout(() => {
    setState(resolveBaseState());
    if (claudeActive) startWorkTimers();
    window.petAPI.setIgnoreMouse(true);
  }, 2600);
}

function scheduleDance() {
  clearTimeout(danceTimer);
  danceTimer = setTimeout(() => {
    if (!musicPlaying) return;
    if ([STATES.IDLE, STATES.HOVER].includes(currentState)) {
      dance();
    }
    scheduleDance(); // reschedule regardless (skip if busy, try again next window)
  }, 15000 + Math.random() * 30000);
}

window.petAPI.onMusicState(playing => {
  musicPlaying = playing;
  if (playing) {
    scheduleDance();
  } else {
    clearTimeout(danceTimer);
  }
});

// ── Boot ───────────────────────────────────────────
drawFrame(FRAMES.open);
setState(STATES.IDLE);
scheduleBlink();
scheduleIdleBubble();
