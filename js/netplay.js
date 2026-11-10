'use strict';

/* ============================================================
   联机对局：房主权威（host-authoritative）
   - 房主跑完整物理模拟，18Hz 广播快照
   - 客机只上传按键，按 110ms 延迟做位置插值
   ============================================================ */

const NET_ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const NET_SNAP_HZ = 18;
const NET_INPUT_HZ = 14;
const NET_INTERP_MS = 110;
const NET_TIMEOUT_MS = 7000;
const NET_PING_MS = 2500;

function netMakeCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += NET_ROOM_CHARS[Math.floor(Math.random() * NET_ROOM_CHARS.length)];
  return s;
}

function netLerp(a, b, t) { return a + (b - a) * t; }
function netAngleLerp(a, b, t) { return a + normAngle(b - a) * t; }
function netRound1(v) { return Math.round(v * 10) / 10; }
function netRoundAngle(a) { return Math.round(a * 100) / 100; }

class NetPlay {
  constructor(game) {
    this.game = game;
    this.role = null;      // 'host' | 'guest'
    this.room = '';
    this.client = null;
    this.phase = 'idle';   // idle | connecting | waiting | playing | ended
    this.handlers = {};

    this.remoteInput = { forward: 0, turn: 0, fire: false };
    this.lastLocal = { forward: 0, turn: 0, fire: false };

    this.snapBuf = [];
    this.tick = 0;
    this.prevAlive = [true, true];

    this.lastSnapAt = 0;
    this.lastInputAt = 0;
    this.lastRx = 0;
    this.lastHiAt = 0;
    this.lastPingAt = 0;
    this.pingMs = 0;
    this.remotePaused = false;
    this.lostReported = false;
  }

  on(name, fn) {
    this.handlers[name] = fn;
    return this;
  }

  emit(name, arg) {
    const fn = this.handlers[name];
    if (fn) fn(arg);
  }

  /* ---------------- 生命周期 ---------------- */

  connect(room, role) {
    this.leave(true);
    this.room = room;
    this.role = role;
    this.phase = 'connecting';
    this.tick = 0;
    this.pingMs = 0;
    this.snapBuf = [];
    this.prevAlive = [true, true];
    this.lostReported = false;
    this.remotePaused = false;
    this.lastSnapAt = 0;
    this.lastInputAt = 0;
    this.lastHiAt = 0;
    this.lastPingAt = 0;
    this.lastRx = performance.now();

    const self = this;
    const prefix = (window.TT_NET && window.TT_NET.channelPrefix) || 'tt';
    this.client = new RealtimeClient(prefix + '-' + room, {
      onStatus: function (s) { self.emit('status', s); },
      onEvent: function (e, d) { self.onMessage(e, d); }
    });
    this.client.connect();
  }

  host(room) {
    const code = (room || '').toUpperCase() || netMakeCode();
    this.connect(code, 'host');
    this.phase = 'waiting';
    return code;
  }

  join(room) {
    this.connect((room || '').toUpperCase(), 'guest');
  }

  leave(quiet) {
    if (this.client) {
      if (!quiet) this.client.emit('bye', {});
      this.client.close();
      this.client = null;
    }
    this.role = null;
    this.phase = 'idle';
    this.snapBuf = [];
    this.remotePaused = false;
  }

  send(e, d) {
    if (this.client) this.client.emit(e, d);
  }

  /* ---------------- 消息 ---------------- */

  onMessage(e, d) {
    const now = performance.now();
    if (e !== 'ping' && e !== 'pong') this.lastRx = now;

    if (e === 'hi') {
      if (this.role === 'host' && (this.phase === 'waiting' || this.phase === 'connecting')) {
        this.send('hi', { host: 1 });
        this.emit('guestReady', {});
      }
      return;
    }

    if (e === 'start') {
      if (this.role === 'guest') this.applyStart(d);
      return;
    }

    if (e === 'in') {
      if (this.role === 'host') {
        this.remoteInput = { forward: d.f | 0, turn: d.t | 0, fire: !!d.fire };
      }
      return;
    }

    if (e === 'snap') {
      if (this.role === 'guest') {
        this.snapBuf.push({ at: now, d: d });
        if (this.snapBuf.length > 12) this.snapBuf.shift();
      }
      return;
    }

    if (e === 'pz') {
      this.remotePaused = !!d.p;
      this.emit('remotePause', !!d.p);
      return;
    }

    if (e === 'over') {
      this.phase = 'ended';
      this.emit('over', d);
      return;
    }

    if (e === 'again') {
      if (this.role === 'host') this.emit('againRequest', {});
      return;
    }

    if (e === 'ping') {
      this.send('pong', { t: d.t });
      return;
    }

    if (e === 'pong') {
      this.pingMs = Math.max(0, Math.round(now - d.t));
      return;
    }

    if (e === 'bye') {
      this.emit('opponentLeft', {});
      this.leave(true);
    }
  }

  /* ---------------- 开局 ---------------- */

  startMatch(mapBlocks, mapMode) {
    this.phase = 'playing';
    this.tick = 0;
    this.snapBuf = [];
    this.lostReported = false;
    this.prevAlive = [true, true];
    this.send('start', { map: mapBlocks, mm: mapMode || 'random' });
  }

  applyStart(d) {
    const game = this.game;
    game.localSide = 1;
    game.start('net', 'normal', d.mm === 'classic' ? 'classic' : 'random');
    if (d.map && d.map.length) game.applyMap(d.map);
    this.phase = 'playing';
    this.snapBuf = [];
    this.lostReported = false;
    this.prevAlive = [true, true];
    this.lastRx = performance.now();
    this.emit('started', {});
  }

  /* ---------------- 每帧 ---------------- */

  updateHost(dt) {
    const now = performance.now();
    if (this.phase === 'playing') {
      if (now - this.lastSnapAt >= 1000 / NET_SNAP_HZ) {
        this.lastSnapAt = now;
        this.send('snap', this.buildSnapshot());
      }
      this.checkLost(now);
    }
    this.tickPing(now);
  }

  updateGuest(dt, input) {
    const now = performance.now();

    // 还没开局就先敲门，房主收到后会回 hi 并直接开局
    if (this.phase === 'connecting' && now - this.lastHiAt >= 900) {
      this.lastHiAt = now;
      this.send('hi', { r: this.room });
    }

    if (this.phase === 'playing') {
      const changed = input.forward !== this.lastLocal.forward ||
        input.turn !== this.lastLocal.turn ||
        !!input.fire !== !!this.lastLocal.fire;
      if (changed || now - this.lastInputAt >= 1000 / NET_INPUT_HZ) {
        this.lastInputAt = now;
        this.lastLocal = { forward: input.forward, turn: input.turn, fire: !!input.fire };
        this.send('in', { f: input.forward, t: input.turn, fire: input.fire ? 1 : 0 });
      }
      this.interpolate(now, dt);
      this.checkLost(now);
    }
    this.tickPing(now);
  }

  tickPing(now) {
    if (now - this.lastPingAt >= NET_PING_MS) {
      this.lastPingAt = now;
      this.send('ping', { t: now });
    }
  }

  checkLost(now) {
    if (this.lostReported) return;
    if (now - this.lastRx > NET_TIMEOUT_MS) {
      this.lostReported = true;
      this.emit('lost', {});
    }
  }

  /* ---------------- 客机本地预测 ---------------- */

  // 自己那辆坦克先按本地输入动起来，消掉「按键 → 画面」的往返延迟；
  // 开火仍然由房主权威判定，这里只做位移与转向。
  predictLocal(dt, input) {
    const g = this.game;
    if (!g.tanks || g.tanks.length < 2) return;
    const t = g.tanks[1];
    if (!t || !t.alive) return;
    const cd = t.cooldown;
    t.update(dt, { forward: input.forward, turn: input.turn, fire: false }, g);
    t.cooldown = cd;
  }

  /* ---------------- 快照 ---------------- */

  buildSnapshot() {
    const g = this.game;
    const tk = [];
    for (let i = 0; i < g.tanks.length; i++) {
      const t = g.tanks[i];
      tk.push([
        netRound1(t.x), netRound1(t.y), netRoundAngle(t.angle),
        t.alive ? 1 : 0,
        t.shield > 0 ? 1 : 0,
        t.speedTimer > 0 ? 1 : 0,
        t.rapidTimer > 0 ? 1 : 0
      ]);
    }
    const bu = [];
    for (let i = 0; i < g.bullets.length; i++) {
      const b = g.bullets[i];
      bu.push([netRound1(b.x), netRound1(b.y), netRound1(b.px), netRound1(b.py)]);
    }
    const pw = [];
    for (let i = 0; i < g.powerups.length; i++) {
      const p = g.powerups[i];
      pw.push([netRound1(p.x), netRound1(p.y), p.type, netRound1(p.ttl)]);
    }
    return {
      n: ++this.tick,
      ph: g.state,
      sc: [g.score[0], g.score[1]],
      rd: g.round,
      tm: Math.max(0, netRound1(g.timer)),
      rw: g.roundOverWinner === null || g.roundOverWinner === undefined ? -1 : g.roundOverWinner,
      tk: tk,
      bu: bu,
      pw: pw
    };
  }

  interpolate(now, dt) {
    const g = this.game;
    const buf = this.snapBuf;
    if (!buf.length) return;

    const at = now - NET_INTERP_MS;
    let a = null;
    let b = null;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i].at <= at) a = buf[i];
      else if (!b) b = buf[i];
    }
    if (!a) {
      a = buf[0];
      b = buf.length > 1 ? buf[1] : null;
    }

    const sa = a.d;
    const sb = b ? b.d : a.d;
    const alpha = (b && b.at > a.at) ? clamp((at - a.at) / (b.at - a.at), 0, 1) : 1;

    // 坦克
    for (let i = 0; i < g.tanks.length; i++) {
      const ta = sa.tk[i];
      const tb = sb.tk[i] || ta;
      if (!ta) continue;
      const t = g.tanks[i];
      const tx = netLerp(ta[0], tb[0], alpha);
      const ty = netLerp(ta[1], tb[1], alpha);
      const tang = netAngleLerp(ta[2], tb[2], alpha);
      if (this.role === 'guest' && i === 1) {
        // 自己的坦克已经在本地预测，这里只做柔和纠偏，避免「抽回去」
        const err = Math.hypot(t.x - tx, t.y - ty);
        if (err > 120) {
          t.x = tx; t.y = ty; t.angle = tang;
        } else {
          t.x = netLerp(t.x, tx, 0.24);
          t.y = netLerp(t.y, ty, 0.24);
          t.angle = netAngleLerp(t.angle, tang, 0.35);
        }
      } else {
        t.x = tx;
        t.y = ty;
        t.angle = tang;
      }
      const aliveNow = !!tb[3];
      if (this.prevAlive[i] && !aliveNow) {
        t.shield = 0;
        g.explosion(t.x, t.y, t.color);
      }
      this.prevAlive[i] = aliveNow;
      t.alive = aliveNow;
      t.shield = tb[4] ? 1 : 0;
      t.speedTimer = tb[5] ? 0.2 : 0;
      t.rapidTimer = tb[6] ? 0.2 : 0;
    }

    // 子弹（索引对齐 + 插值）
    const bullets = [];
    const nb = sb.bu || [];
    const ab = sa.bu || [];
    for (let i = 0; i < nb.length; i++) {
      const nbv = nb[i];
      const abv = ab[i];
      const b = Object.create(Bullet.prototype);
      b.x = abv ? netLerp(abv[0], nbv[0], alpha) : nbv[0];
      b.y = abv ? netLerp(abv[1], nbv[1], alpha) : nbv[1];
      b.px = abv ? netLerp(abv[2], nbv[2], alpha) : nbv[2];
      b.py = abv ? netLerp(abv[3], nbv[3], alpha) : nbv[3];
      b.dead = false;
      b.radius = BULLET_RADIUS;
      b.bounces = 1;
      bullets.push(b);
    }
    g.bullets = bullets;

    // 道具
    const pws = [];
    const np = sb.pw || [];
    for (let i = 0; i < np.length; i++) {
      const pv = np[i];
      const p = Object.create(Powerup.prototype);
      p.x = pv[0];
      p.y = pv[1];
      p.type = pv[2];
      p.ttl = pv[3];
      p.born = performance.now() - 1000;
      p.dead = false;
      pws.push(p);
    }
    g.powerups = pws;

    // 状态同步
    if (sb.ph) g.state = sb.ph;
    if (sb.sc) { g.score[0] = sb.sc[0]; g.score[1] = sb.sc[1]; }
    if (sb.rd) g.round = sb.rd;
    if (typeof sb.tm === 'number') g.timer = sb.tm;
    g.roundOverWinner = (sb.rw === -1 || sb.rw === undefined) ? null : sb.rw;

    // 本地粒子与震屏继续衰减
    for (let i = g.particles.length - 1; i >= 0; i--) {
      if (!g.particles[i].update(dt)) g.particles.splice(i, 1);
    }
    g.shake *= Math.pow(0.02, dt);

    // 丢掉已经用不到的旧快照，保留当前 a 与 b
    while (buf.length > 3 && buf[1].at <= at) buf.shift();
  }
}
