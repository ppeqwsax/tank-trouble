'use strict';

/* ============================================================
   游戏主体：回合制、碰撞、道具、渲染
   ============================================================ */

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mapMode = 'random';
    this.mapBlocks = generateMap();
    this.walls = buildWalls(this.mapBlocks);
    this.freeCells = freeCellCenters(this.walls);
    this.wallLayer = this.renderWalls();

    this.mode = 'single';
    this.difficulty = 'normal';
    this.state = 'idle';
    this.score = [0, 0];
    this.round = 1;
    this.timer = 0;
    this.shake = 0;
    this.elapsed = 0;

    this.tanks = [];
    this.controllers = [];
    this.bullets = [];
    this.powerups = [];
    this.particles = [];
    this.powerupTimer = 8;
    this.inputs = [
      { forward: 0, turn: 0, fire: false },
      { forward: 0, turn: 0, fire: false }
    ];

    this.onMatchEnd = null;
  }

  /* ---------- 生命周期 ---------- */

  start(mode, difficulty, mapMode) {
    this.mode = mode || 'single';
    this.difficulty = difficulty || 'normal';
    this.mapMode = mapMode || 'random';

    // 每局重新生成地图；同一局内所有回合共用同一张图，保证公平
    this.mapBlocks = this.mapMode === 'classic' ? MAP_BLOCKS.slice() : generateMap();
    this.walls = buildWalls(this.mapBlocks);
    this.freeCells = freeCellCenters(this.walls);
    this.wallLayer = this.renderWalls();

    this.score = [0, 0];
    this.round = 1;
    this.elapsed = 0;
    this.buildTanks();
    this.resetRound();
  }

  buildTanks() {
    const a1 = Math.atan2(SPAWN_P2.y - SPAWN_P1.y, SPAWN_P2.x - SPAWN_P1.x);
    const a2 = Math.atan2(SPAWN_P1.y - SPAWN_P2.y, SPAWN_P1.x - SPAWN_P2.x);

    const p1 = new Tank({
      id: 0, label: '玩家 1', color: PALETTE.p1, dark: PALETTE.p1d,
      x: SPAWN_P1.x, y: SPAWN_P1.y, angle: a1
    });
    const p2 = new Tank({
      id: 1, label: this.mode === 'single' ? '电脑' : '玩家 2',
      color: this.mode === 'single' ? PALETTE.ai : PALETTE.p2,
      dark: this.mode === 'single' ? PALETTE.aid : PALETTE.p2d,
      x: SPAWN_P2.x, y: SPAWN_P2.y, angle: a2, isAI: this.mode === 'single'
    });

    this.tanks = [p1, p2];
    this.controllers = [
      null,
      this.mode === 'single' ? new AIController(p2, this.difficulty) : null
    ];
  }

  resetRound() {
    for (let i = 0; i < this.tanks.length; i++) {
      const t = this.tanks[i];
      t.reset();
    }
    this.bullets = [];
    this.powerups = [];
    this.particles = [];
    this.powerupTimer = rand(6, 9);
    this.inputs[0] = { forward: 0, turn: 0, fire: false };
    this.inputs[1] = { forward: 0, turn: 0, fire: false };
    this.state = 'countdown';
    this.timer = 1.7;
    this.roundOverWinner = null;
  }

  /* ---------- 查询 ---------- */

  enemyOf(tank) {
    for (let i = 0; i < this.tanks.length; i++) {
      const t = this.tanks[i];
      if (t !== tank && t.alive) return t;
    }
    return this.tanks[0] === tank ? this.tanks[1] : this.tanks[0];
  }

  hasLineOfSight(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const d = Math.hypot(dx, dy);
    if (d < 1) return true;
    const ux = dx / d, uy = dy / d;
    for (let i = 0; i < this.walls.length; i++) {
      if (rayRect(x1, y1, ux, uy, this.walls[i]) < d) return false;
    }
    return true;
  }

  probeBlocked(tank, d) {
    for (let k = 1; k <= 2; k++) {
      const x = tank.x + Math.cos(tank.angle) * d * (k / 2);
      const y = tank.y + Math.sin(tank.angle) * d * (k / 2);
      if (circleHitsRects(x, y, TANK_RADIUS, this.walls)) return true;
    }
    return false;
  }

  incomingBullet(tank, horizon) {
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      if (b.dead) continue;
      if (b.owner === tank && !b.canHurtOwner) continue;
      const dx = tank.x - b.x;
      const dy = tank.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d > 240) continue;
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const dot = (dx * b.vx + dy * b.vy) / (d * sp);
      if (dot < 0.7) continue;
      if (d / sp < horizon) return b;
    }
    return null;
  }

  randomFreePoint(excludeTank, minDist) {
    const md = minDist === undefined ? 110 : minDist;
    const pool = [];
    for (let i = 0; i < this.freeCells.length; i++) {
      const p = this.freeCells[i];
      let ok = true;
      for (let j = 0; j < this.tanks.length; j++) {
        const t = this.tanks[j];
        if (!t.alive) continue;
        if (t === excludeTank) continue;
        if (dist(p.x, p.y, t.x, t.y) < md) { ok = false; break; }
      }
      if (ok) pool.push(p);
    }
    if (!pool.length) return this.freeCells[randInt(0, this.freeCells.length - 1)];
    return pool[randInt(0, pool.length - 1)];
  }

  /* ---------- 特效 ---------- */

  addParticles(x, y, count, color, speed, life, size, dir) {
    for (let i = 0; i < count; i++) {
      const a = dir === undefined ? rand(0, Math.PI * 2) : dir + rand(-0.6, 0.6);
      const sp = rand(speed * 0.25, speed);
      this.particles.push(new Particle(
        x, y,
        Math.cos(a) * sp, Math.sin(a) * sp,
        life * rand(0.6, 1.2),
        size * rand(0.7, 1.5),
        color
      ));
    }
  }

  explosion(x, y, color) {
    this.addParticles(x, y, 46, color, 320, 0.85, 4);
    this.addParticles(x, y, 26, '#ffd166', 240, 0.7, 5);
    this.addParticles(x, y, 18, '#ff8c42', 180, 1.0, 3);
    this.addParticles(x, y, 20, 'rgba(255,255,255,0.85)', 140, 0.5, 2);
    this.shake = 14;
    Sfx.boom();
  }

  onBounce(bullet, hit) {
    this.addParticles(bullet.x, bullet.y, 4, '#ffe9a3', 120, 0.22, 2, Math.atan2(-hit.ny, -hit.nx));
    Sfx.bounce();
  }

  /* ---------- 主更新 ---------- */

  update(dt) {
    this.elapsed += dt;
    this.shake *= Math.pow(0.02, dt);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      if (!this.particles[i].update(dt)) this.particles.splice(i, 1);
    }

    if (this.state === 'countdown') {
      this.timer -= dt;
      if (this.timer <= 0) this.state = 'playing';
      return;
    }

    if (this.state === 'roundover') {
      this.timer -= dt;
      this.updateBullets(dt, true);
      if (this.timer <= 0) this.nextRound();
      return;
    }

    if (this.state !== 'playing') return;

    // AI 决策
    for (let i = 0; i < this.tanks.length; i++) {
      const ctl = this.controllers[i];
      if (ctl) this.inputs[i] = ctl.update(dt, this);
    }

    // 坦克
    for (let i = 0; i < this.tanks.length; i++) {
      this.tanks[i].update(dt, this.inputs[i] || { forward: 0, turn: 0, fire: false }, this);
    }

    // 子弹
    this.updateBullets(dt, false);

    // 道具
    this.updatePowerups(dt);

    // 回合结束判定
    const alive = this.tanks.filter(t => t.alive);
    if (alive.length <= 1) this.endRound(alive[0] || null);
  }

  updateBullets(dt, onlyFly) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.update(dt, this);
      if (b.dead) { this.bullets.splice(i, 1); continue; }
      if (onlyFly) continue;

      // 子弹互撞
      for (let j = i - 1; j >= 0; j--) {
        const o = this.bullets[j];
        if (o.dead) continue;
        if (dist(b.x, b.y, o.x, o.y) < 12) {
          b.dead = true;
          o.dead = true;
          this.addParticles((b.x + o.x) / 2, (b.y + o.y) / 2, 10, '#fff3b0', 150, 0.3, 2);
          Sfx.bounce();
          break;
        }
      }

      // 命中坦克
      for (let k = 0; k < this.tanks.length; k++) {
        const t = this.tanks[k];
        if (!t.alive) continue;
        if (t === b.owner && !b.canHurtOwner) continue;
        if (dist(b.x, b.y, t.x, t.y) < TANK_RADIUS + b.radius) {
          b.dead = true;
          const killed = t.hit();
          if (killed) {
            this.explosion(t.x, t.y, t.color);
            this.onTankKilled(t, b.owner);
          } else {
            this.addParticles(t.x, t.y, 12, '#7fd8ff', 160, 0.35, 3);
          }
          break;
        }
      }

      if (b.dead) {
        this.bullets.splice(i, 1);
      }
    }
  }

  updatePowerups(dt) {
    this.powerupTimer -= dt;
    if (this.powerupTimer <= 0 && this.powerups.length < 2) {
      this.powerupTimer = rand(6.5, 10);
      const types = ['shield', 'rapid', 'speed', 'triple'];
      const p = this.randomFreePoint(null, 130);
      this.powerups.push(new Powerup(p.x, p.y, types[randInt(0, types.length - 1)]));
    }

    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      p.update(dt);
      let taken = false;
      for (let j = 0; j < this.tanks.length; j++) {
        const t = this.tanks[j];
        if (!t.alive) continue;
        if (dist(p.x, p.y, t.x, t.y) < TANK_RADIUS + 18) {
          this.applyPowerup(t, p.type);
          taken = true;
          break;
        }
      }
      if (taken || p.dead) this.powerups.splice(i, 1);
    }
  }

  applyPowerup(tank, type) {
    if (type === 'shield') tank.shield = 1;
    else if (type === 'rapid') tank.rapidTimer = 8;
    else if (type === 'speed') tank.speedTimer = 8;
    else if (type === 'triple') tank.triple = 3;
    this.addParticles(tank.x, tank.y, 14, POWERUPS[type].color, 170, 0.4, 3);
    Sfx.pick();
  }

  onTankKilled(victim, killer) {
    const winnerIndex = (killer && killer !== victim) ? killer.id : (1 - victim.id);
    this.score[winnerIndex]++;
    this.roundOverWinner = winnerIndex;
  }

  endRound(alive) {
    if (this.state !== 'playing') return;
    this.state = 'roundover';
    this.timer = 1.9;
    if (alive) {
      this.roundOverWinner = alive.id;
    }
  }

  nextRound() {
    if (this.score[0] >= ROUNDS_TO_WIN || this.score[1] >= ROUNDS_TO_WIN) {
      this.state = 'matchover';
      Sfx.win();
      if (this.onMatchEnd) {
        this.onMatchEnd({
          winner: this.score[0] > this.score[1] ? 0 : 1,
          score: this.score.slice(),
          mode: this.mode
        });
      }
      return;
    }
    this.round++;
    this.resetRound();
  }

  /* ---------- 渲染 ---------- */

  renderWalls() {
    const c = document.createElement('canvas');
    c.width = GAME_W;
    c.height = GAME_H;
    const g = c.getContext('2d');

    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i];

      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(w.x + 4, w.y + 6, w.w, w.h);

      const grad = g.createLinearGradient(0, w.y, 0, w.y + w.h);
      grad.addColorStop(0, PALETTE.wallTop);
      grad.addColorStop(0.18, PALETTE.wall);
      grad.addColorStop(1, '#1d2439');
      g.fillStyle = grad;
      g.fillRect(w.x, w.y, w.w, w.h);

      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(w.x, w.y, w.w, 3);
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(w.x, w.y + w.h - 3, w.w, 3);
      g.fillRect(w.x + w.w - 3, w.y, 3, w.h);

      g.strokeStyle = 'rgba(120,150,210,0.18)';
      g.lineWidth = 1;
      g.strokeRect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);
    }
    return c;
  }

  draw() {
    const ctx = this.ctx;
    ctx.save();

    if (this.shake > 0.4) {
      ctx.translate(rand(-this.shake, this.shake), rand(-this.shake, this.shake));
    }

    // 背景
    const bg = ctx.createRadialGradient(GAME_W / 2, GAME_H / 2, 80, GAME_W / 2, GAME_H / 2, 640);
    bg.addColorStop(0, PALETTE.bg1);
    bg.addColorStop(1, PALETTE.bg0);
    ctx.fillStyle = bg;
    ctx.fillRect(-40, -40, GAME_W + 80, GAME_H + 80);

    // 场地网格
    ctx.strokeStyle = 'rgba(110,150,220,0.06)';
    ctx.lineWidth = 1;
    for (let x = FIELD.x; x <= FIELD.x + FIELD.w; x += CELL) {
      ctx.beginPath();
      ctx.moveTo(x, FIELD.y);
      ctx.lineTo(x, FIELD.y + FIELD.h);
      ctx.stroke();
    }
    for (let y = FIELD.y; y <= FIELD.y + FIELD.h; y += CELL) {
      ctx.beginPath();
      ctx.moveTo(FIELD.x, y);
      ctx.lineTo(FIELD.x + FIELD.w, y);
      ctx.stroke();
    }

    // 地图
    ctx.drawImage(this.wallLayer, 0, 0);

    // 出生点标记
    this.drawSpawnMark(ctx, SPAWN_P1, PALETTE.p1);
    this.drawSpawnMark(ctx, SPAWN_P2, this.mode === 'single' ? PALETTE.ai : PALETTE.p2);

    // 道具
    for (let i = 0; i < this.powerups.length; i++) this.powerups[i].draw(ctx);

    // 子弹轨迹
    for (let i = 0; i < this.bullets.length; i++) this.bullets[i].draw(ctx);

    // 坦克
    for (let i = 0; i < this.tanks.length; i++) this.tanks[i].draw(ctx);

    // 粒子
    for (let i = 0; i < this.particles.length; i++) this.particles[i].draw(ctx);

    // 倒计时 / 回合结束
    if (this.state === 'countdown') this.drawCountdown(ctx);
    if (this.state === 'roundover') this.drawRoundOver(ctx);

    ctx.restore();
  }

  drawSpawnMark(ctx, p, color) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawCountdown(ctx) {
    const n = Math.ceil(this.timer);
    ctx.save();
    ctx.fillStyle = 'rgba(6,10,18,0.45)';
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = 'rgba(230,240,255,0.92)';
    ctx.font = 'bold 34px "Microsoft YaHei", sans-serif';
    ctx.fillText('第 ' + this.round + ' 回合', GAME_W / 2, GAME_H / 2 - 70);

    const scale = 1 + (1 - (this.timer % 1)) * 0.25;
    ctx.save();
    ctx.translate(GAME_W / 2, GAME_H / 2 + 25);
    ctx.scale(scale, scale);
    ctx.font = 'bold 96px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#ffe066';
    ctx.fillText(String(Math.max(1, n)), 0, 0);
    ctx.restore();

    ctx.font = '16px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(180,200,230,0.7)';
    ctx.fillText(this.mode === 'single' ? '击毁电脑坦克' : '击毁对手坦克', GAME_W / 2, GAME_H / 2 + 110);
    ctx.restore();
  }

  drawRoundOver(ctx) {
    const w = this.roundOverWinner;
    if (w === null || w === undefined) return;
    const name = this.tanks[w] ? this.tanks[w].label : '';
    const color = this.tanks[w] ? this.tanks[w].color : '#fff';

    ctx.save();
    ctx.fillStyle = 'rgba(6,10,18,0.4)';
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 52px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(name + ' 得分', GAME_W / 2, GAME_H / 2 - 20);
    ctx.font = 'bold 30px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(220,230,245,0.85)';
    ctx.fillText(this.score[0] + ' : ' + this.score[1], GAME_W / 2, GAME_H / 2 + 45);
    ctx.restore();
  }
}
