'use strict';

/* ============================================================
   坦克动荡 Tank Trouble
   核心：常量 / 数学 / 碰撞 / 地图 / 粒子 / 音效
   ============================================================ */

const GAME_W = 960;
const GAME_H = 720;
const CELL = 80;
const COLS = 11;
const ROWS = 8;
const FIELD = { x: 40, y: 40, w: COLS * CELL, h: ROWS * CELL };

const ROUNDS_TO_WIN = 5;
const MAX_BOUNCES = 5;
const BULLET_SPEED = 430;
const BULLET_RADIUS = 6;
const TANK_RADIUS = 19;
const TANK_SPEED = 124;
const TANK_TURN = 3.0;
const FIRE_COOLDOWN = 0.62;

const PALETTE = {
  bg0: '#0a0f1a',
  bg1: '#141d31',
  wall: '#2c3757',
  wallTop: '#4a5b88',
  wallEdge: '#111726',
  p1: '#4cc9f0',
  p1d: '#1d7fa3',
  p2: '#ff6b5e',
  p2d: '#a5332b',
  ai: '#ffc451',
  aid: '#a97c22',
  bullet: '#ffe066'
};

/* ---------------- 数学 ---------------- */

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function angleDiff(a, b) { return normAngle(a - b); }
function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* ---------------- 碰撞 ---------------- */

// 圆 vs 轴对齐矩形，返回法线 + 穿透深度
function circleRect(cx, cy, r, rect) {
  const rx = rect.x, ry = rect.y, rw = rect.w, rh = rect.h;
  const nx0 = clamp(cx, rx, rx + rw);
  const ny0 = clamp(cy, ry, ry + rh);
  const dx = cx - nx0;
  const dy = cy - ny0;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return null;

  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, depth: r - d };
  }
  // 圆心落在矩形内部：向最近边推出
  const left = cx - rx;
  const right = rx + rw - cx;
  const top = cy - ry;
  const bottom = ry + rh - cy;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { nx: -1, ny: 0, depth: left + r };
  if (m === right) return { nx: 1, ny: 0, depth: right + r };
  if (m === top) return { nx: 0, ny: -1, depth: top + r };
  return { nx: 0, ny: 1, depth: bottom + r };
}

function circleHitsRects(cx, cy, r, rects) {
  for (let i = 0; i < rects.length; i++) {
    if (circleRect(cx, cy, r, rects[i])) return true;
  }
  return false;
}

// 射线 vs 矩形（slab 法），返回命中距离或 Infinity
function rayRect(ox, oy, dx, dy, rect) {
  let tmin = -Infinity, tmax = Infinity;

  if (Math.abs(dx) < 1e-8) {
    if (ox < rect.x || ox > rect.x + rect.w) return Infinity;
  } else {
    let t1 = (rect.x - ox) / dx;
    let t2 = (rect.x + rect.w - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
  }

  if (Math.abs(dy) < 1e-8) {
    if (oy < rect.y || oy > rect.y + rect.h) return Infinity;
  } else {
    let t1 = (rect.y - oy) / dy;
    let t2 = (rect.y + rect.h - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
  }

  if (tmax < Math.max(tmin, 0)) return Infinity;
  return Math.max(tmin, 0);
}

/* ---------------- 地图 ---------------- */

// 经典固定地图，[列, 行, 宽(格), 高(格)]
const MAP_BLOCKS = [
  [2, 1, 1, 2], [8, 5, 1, 2],
  [4, 2, 2, 1], [5, 5, 2, 1],
  [1, 4, 2, 1], [8, 3, 2, 1],
  [5, 3, 1, 1], [5, 4, 1, 1],
  [3, 3, 1, 1], [7, 4, 1, 1],
  [7, 1, 1, 1], [3, 6, 1, 1],
  [4, 6, 2, 1], [5, 1, 2, 1]
];

const SPAWN_CELLS = [[1, 1], [COLS - 2, ROWS - 2]];

const SPAWN_P1 = { x: FIELD.x + 1.5 * CELL, y: FIELD.y + 1.5 * CELL };
const SPAWN_P2 = { x: FIELD.x + 9.5 * CELL, y: FIELD.y + 6.5 * CELL };

/* ---------- 随机地图 ---------- */

// 出生点周围 3x3 保留为空地
function isSpawnZone(c, r) {
  for (let i = 0; i < SPAWN_CELLS.length; i++) {
    const s = SPAWN_CELLS[i];
    if (Math.abs(c - s[0]) <= 1 && Math.abs(r - s[1]) <= 1) return true;
  }
  return false;
}

// [宽, 高, 权重]
const MAP_SHAPES = [
  [1, 1, 8], [1, 2, 5], [2, 1, 5], [2, 2, 3], [1, 3, 2], [3, 1, 2]
];

function pickShape() {
  let total = 0;
  for (let i = 0; i < MAP_SHAPES.length; i++) total += MAP_SHAPES[i][2];
  let x = Math.random() * total;
  for (let i = 0; i < MAP_SHAPES.length; i++) {
    x -= MAP_SHAPES[i][2];
    if (x <= 0) return MAP_SHAPES[i];
  }
  return MAP_SHAPES[0];
}

// 180° 旋转对称地放置一块：成功返回 true，并把占用格与方块一并写入
function placeSymmetric(occ, blocks, c, r, w, h) {
  if (c < 0 || r < 0 || c + w > COLS || r + h > ROWS) return false;

  const mc = COLS - c - w;
  const mr = ROWS - r - h;
  const selfMirror = (mc === c && mr === r);

  // 与自己的镜像部分重叠的摆法直接抛弃（否则同一格会被两块墙重复占用）
  if (!selfMirror && c < mc + w && mc < c + w && r < mr + h && mr < r + h) return false;

  for (let y = r; y < r + h; y++) {
    for (let x = c; x < c + w; x++) {
      if (occ[y * COLS + x] || isSpawnZone(x, y)) return false;
    }
  }
  if (!selfMirror) {
    for (let y = mr; y < mr + h; y++) {
      for (let x = mc; x < mc + w; x++) {
        if (occ[y * COLS + x] || isSpawnZone(x, y)) return false;
      }
    }
  }

  for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) occ[y * COLS + x] = 1;
  blocks.push([c, r, w, h]);
  if (!selfMirror) {
    for (let y = mr; y < mr + h; y++) for (let x = mc; x < mc + w; x++) occ[y * COLS + x] = 1;
    blocks.push([mc, mr, w, h]);
  }
  return true;
}

// 所有空地必须连成一片（否则会出现打不到的封闭口袋）
function mapConnected(occ) {
  const sc = SPAWN_CELLS[0];
  const start = sc[1] * COLS + sc[0];
  if (occ[start]) return false;

  const seen = new Uint8Array(COLS * ROWS);
  const stack = [start];
  seen[start] = 1;
  let reached = 0;

  while (stack.length) {
    const idx = stack.pop();
    reached++;
    const c = idx % COLS;
    const r = (idx - c) / COLS;
    const nb = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
    for (let k = 0; k < 4; k++) {
      const nc = nb[k][0], nr = nb[k][1];
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      const ni = nr * COLS + nc;
      if (seen[ni] || occ[ni]) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }

  let free = 0;
  for (let i = 0; i < occ.length; i++) if (!occ[i]) free++;
  return reached === free && free >= 34;
}

// 生成一张 180° 对称、出生点留空、全图连通的随机地图
function generateMap() {
  for (let attempt = 0; attempt < 80; attempt++) {
    const occ = new Uint8Array(COLS * ROWS);
    const blocks = [];
    const target = randInt(24, 34); // 目标阻挡格子数（共 88 格）
    let blocked = 0;

    for (let step = 0; step < 240 && blocked < target; step++) {
      const s = pickShape();
      const w = s[0], h = s[1];
      const c = randInt(0, COLS - w);
      const r = randInt(0, ROWS - h);
      const before = blocks.length;
      if (placeSymmetric(occ, blocks, c, r, w, h)) {
        blocked += (blocks.length - before) * w * h;
      }
    }

    if (blocked < 20) continue;
    if (!mapConnected(occ)) continue;
    return blocks;
  }
  return MAP_BLOCKS.slice();
}

function buildWalls(blocks) {
  const list = blocks && blocks.length ? blocks : MAP_BLOCKS;
  const t = FIELD.x;
  const walls = [
    { x: 0, y: 0, w: GAME_W, h: t },
    { x: 0, y: GAME_H - t, w: GAME_W, h: t },
    { x: 0, y: t, w: t, h: GAME_H - t * 2 },
    { x: GAME_W - t, y: t, w: t, h: GAME_H - t * 2 }
  ];
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    walls.push({
      x: FIELD.x + b[0] * CELL,
      y: FIELD.y + b[1] * CELL,
      w: b[2] * CELL,
      h: b[3] * CELL
    });
  }
  return walls;
}

function cellRect(c, r) {
  return { x: FIELD.x + c * CELL, y: FIELD.y + r * CELL, w: CELL, h: CELL };
}

function cellCenter(c, r) {
  return { x: FIELD.x + (c + 0.5) * CELL, y: FIELD.y + (r + 0.5) * CELL };
}

// 所有可站立格子的中心点
function freeCellCenters(walls) {
  const out = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const rc = cellRect(c, r);
      if (!circleHitsRects(rc.x + CELL / 2, rc.y + CELL / 2, TANK_RADIUS + 4, walls)) {
        out.push(cellCenter(c, r));
      }
    }
  }
  return out;
}

/* ---------------- 粒子 ---------------- */

class Particle {
  constructor(x, y, vx, vy, life, size, color, gravity, fade) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.maxLife = life;
    this.size = size;
    this.color = color;
    this.gravity = gravity || 0;
    this.drag = 0.98;
    this.spin = rand(-6, 6);
    this.angle = rand(0, Math.PI * 2);
    this.fade = fade !== false;
  }

  update(dt) {
    this.life -= dt;
    this.vy += this.gravity * dt;
    this.vx *= this.drag;
    this.vy *= this.drag;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle += this.spin * dt;
    return this.life > 0;
  }

  draw(ctx) {
    const a = clamp(this.life / this.maxLife, 0, 1);
    ctx.globalAlpha = this.fade ? a : 1;
    ctx.fillStyle = this.color;
    const s = this.size * (0.4 + a * 0.6);
    ctx.fillRect(this.x - s / 2, this.y - s / 2, s, s);
    ctx.globalAlpha = 1;
  }
}

/* ---------------- 音效 ---------------- */

const Sfx = {
  ctx: null,
  enabled: true,
  noiseBuf: null,

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      const len = Math.floor(this.ctx.sampleRate * 0.4);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      this.noiseBuf = buf;
    } catch (e) {
      this.ctx = null;
    }
  },

  tone(freq, dur, type, gain, slideTo) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(gain || 0.04, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  },

  noise(dur, gain, freq) {
    if (!this.enabled || !this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq || 1200, t);
    f.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain || 0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.ctx.destination);
    src.start(t);
    src.stop(t + dur + 0.02);
  },

  fire() { this.tone(320, 0.09, 'square', 0.05, 90); },
  bounce() { this.tone(820, 0.035, 'triangle', 0.025, 700); },
  boom() { this.noise(0.45, 0.22, 1400); this.tone(120, 0.3, 'sawtooth', 0.06, 40); },
  pick() { this.tone(660, 0.06, 'sine', 0.05); this.tone(990, 0.09, 'sine', 0.04); },
  win() { this.tone(523, 0.12, 'square', 0.05); setTimeout(() => this.tone(784, 0.16, 'square', 0.05), 120); }
};
