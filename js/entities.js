'use strict';

/* ============================================================
   实体：坦克 / 子弹 / 道具
   ============================================================ */

class Tank {
  constructor(opts) {
    this.id = opts.id;
    this.label = opts.label || '';
    this.color = opts.color;
    this.dark = opts.dark;
    this.isAI = !!opts.isAI;
    this.spawn = { x: opts.x, y: opts.y, angle: opts.angle || 0 };
    this.reset();
  }

  reset() {
    this.x = this.spawn.x;
    this.y = this.spawn.y;
    this.angle = this.spawn.angle;
    this.alive = true;
    this.cooldown = 0;
    this.speedTimer = 0;
    this.rapidTimer = 0;
    this.triple = 0;
    this.shield = 0;
    this.recoil = 0;
    this.muzzle = 0;
    this.track = 0;
    this.vx = 0;
    this.vy = 0;
    this.stuckTimer = 0;
  }

  get speed() { return TANK_SPEED * (this.speedTimer > 0 ? 1.55 : 1); }
  get fireCooldown() { return FIRE_COOLDOWN * (this.rapidTimer > 0 ? 0.5 : 1); }

  update(dt, input, game) {
    if (!this.alive) return;

    this.cooldown = Math.max(0, this.cooldown - dt);
    this.speedTimer = Math.max(0, this.speedTimer - dt);
    this.rapidTimer = Math.max(0, this.rapidTimer - dt);
    this.recoil = Math.max(0, this.recoil - dt * 4);
    this.muzzle = Math.max(0, this.muzzle - dt * 6);

    const turn = clamp(input.turn || 0, -1, 1);
    if (turn) this.angle = normAngle(this.angle + turn * TANK_TURN * dt);

    const fwd = clamp(input.forward || 0, -1, 1);
    if (fwd) {
      const v = fwd * this.speed;
      const dx = Math.cos(this.angle) * v * dt;
      const dy = Math.sin(this.angle) * v * dt;
      const px = this.x, py = this.y;
      this.tryMove(dx, dy, game);
      const moved = Math.hypot(this.x - px, this.y - py);
      this.track += moved * 0.08;
      if (moved < Math.abs(v * dt) * 0.25) this.stuckTimer += dt;
      else this.stuckTimer = 0;
      this.vx = (this.x - px) / dt;
      this.vy = (this.y - py) / dt;
    } else {
      this.vx = 0;
      this.vy = 0;
    }

    if (input.fire && this.cooldown <= 0) this.fire(game);
  }

  tryMove(dx, dy, game) {
    const walls = game.walls;
    const nx = this.x + dx;
    if (!circleHitsRects(nx, this.y, TANK_RADIUS, walls) && !this.tankBlocked(nx, this.y, game)) {
      this.x = nx;
    }
    const ny = this.y + dy;
    if (!circleHitsRects(this.x, ny, TANK_RADIUS, walls) && !this.tankBlocked(this.x, ny, game)) {
      this.y = ny;
    }
  }

  tankBlocked(x, y, game) {
    for (let i = 0; i < game.tanks.length; i++) {
      const o = game.tanks[i];
      if (o === this || !o.alive) continue;
      if (dist(x, y, o.x, o.y) < TANK_RADIUS * 1.9) return true;
    }
    return false;
  }

  fire(game) {
    this.cooldown = this.fireCooldown;
    this.recoil = 1;
    this.muzzle = 1;
    const nose = TANK_RADIUS + 10;
    const angles = this.triple > 0
      ? [this.angle - 0.20, this.angle, this.angle + 0.20]
      : [this.angle];
    for (let i = 0; i < angles.length; i++) {
      const a = angles[i];
      game.bullets.push(new Bullet(
        this.x + Math.cos(a) * nose,
        this.y + Math.sin(a) * nose,
        a,
        this
      ));
    }
    if (this.triple > 0) this.triple--;
    game.addParticles(this.x + Math.cos(this.angle) * nose, this.y + Math.sin(this.angle) * nose,
      5, '#ffe9a3', 90, 0.25, 2, this.angle);
    Sfx.fire();
  }

  // 返回 true 表示被击毁
  hit() {
    if (!this.alive) return false;
    if (this.shield > 0) {
      this.shield--;
      return false;
    }
    this.alive = false;
    return true;
  }

  draw(ctx) {
    const x = this.x, y = this.y, a = this.angle;

    // 影子
    ctx.save();
    ctx.translate(x + 3, y + 5);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);

    // 履带
    ctx.fillStyle = '#1b2233';
    roundRectPath(ctx, -22, -20, 44, 12, 5);
    ctx.fill();
    roundRectPath(ctx, -22, 8, 44, 12, 5);
    ctx.fill();

    // 履带纹路
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    const off = this.track % 10;
    for (let i = -20 + off; i < 20; i += 10) {
      if (i > -21) ctx.fillRect(i, -19, 3, 10);
      if (i > -21) ctx.fillRect(i, 9, 3, 10);
    }

    // 车身
    const g = ctx.createLinearGradient(0, -16, 0, 16);
    g.addColorStop(0, this.color);
    g.addColorStop(1, this.dark);
    ctx.fillStyle = g;
    roundRectPath(ctx, -17, -15, 34, 30, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 炮管
    const rec = this.recoil * 5;
    ctx.fillStyle = this.dark;
    roundRectPath(ctx, 6 - rec, -4, 22, 8, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(8 - rec, -3, 18, 2);

    // 炮塔
    ctx.beginPath();
    ctx.arc(0, 0, 11.5, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-2, -2, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fill();

    // 炮口火光
    if (this.muzzle > 0) {
      const m = this.muzzle;
      ctx.globalAlpha = m;
      ctx.fillStyle = '#fff3b0';
      ctx.beginPath();
      ctx.arc(29, 0, 4 + m * 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // 护盾
    if (this.shield > 0) {
      const t = performance.now() / 300;
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = 'rgba(140,220,255,' + (0.55 + 0.25 * Math.sin(t)) + ')';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, TANK_RADIUS + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 加速尾迹
    if (this.speedTimer > 0 && (this.vx || this.vy)) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(x - Math.cos(a) * 16, y - Math.sin(a) * 16, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

/* ---------------- 子弹 ---------------- */

class Bullet {
  constructor(x, y, angle, owner) {
    this.x = x;
    this.y = y;
    this.px = x;
    this.py = y;
    this.vx = Math.cos(angle) * BULLET_SPEED;
    this.vy = Math.sin(angle) * BULLET_SPEED;
    this.owner = owner;
    this.ownerId = owner ? owner.id : -1;
    this.bounces = 0;
    this.dead = false;
    this.radius = BULLET_RADIUS;
    this.age = 0;
  }

  get canHurtOwner() { return this.bounces > 0; }

  update(dt, game) {
    if (this.dead) return;
    this.age += dt;
    const speed = Math.hypot(this.vx, this.vy);
    const steps = Math.max(1, Math.ceil((speed * dt) / 5));
    const sdt = dt / steps;

    for (let s = 0; s < steps; s++) {
      this.px = this.x;
      this.py = this.y;
      this.x += this.vx * sdt;
      this.y += this.vy * sdt;

      for (let i = 0; i < game.walls.length; i++) {
        const hit = circleRect(this.x, this.y, this.radius, game.walls[i]);
        if (!hit) continue;

        this.x += hit.nx * (hit.depth + 0.5);
        this.y += hit.ny * (hit.depth + 0.5);

        const dot = this.vx * hit.nx + this.vy * hit.ny;
        this.vx -= 2 * dot * hit.nx;
        this.vy -= 2 * dot * hit.ny;

        this.bounces++;
        game.onBounce(this, hit);
        if (this.bounces >= MAX_BOUNCES) {
          this.dead = true;
          game.addParticles(this.x, this.y, 6, PALETTE.bullet, 110, 0.2, 2, Math.atan2(-hit.ny, -hit.nx));
          return;
        }
      }
    }
  }

  draw(ctx) {
    const head = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, 14);
    head.addColorStop(0, 'rgba(255,240,170,0.95)');
    head.addColorStop(0.45, 'rgba(255,200,60,0.35)');
    head.addColorStop(1, 'rgba(255,180,40,0)');
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,235,150,0.55)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(this.px, this.py);
    ctx.lineTo(this.x, this.y);
    ctx.stroke();

    ctx.fillStyle = '#fffbe0';
    ctx.beginPath();
    ctx.arc(this.x, this.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ---------------- 道具 ---------------- */

const POWERUPS = {
  shield: { color: '#7fd8ff', label: '盾' },
  rapid: { color: '#ffd166', label: '连' },
  speed: { color: '#8ef58e', label: '速' },
  triple: { color: '#ff8fd8', label: '三' }
};

class Powerup {
  constructor(x, y, type) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.ttl = 12;
    this.born = performance.now();
    this.dead = false;
  }

  update(dt) {
    this.ttl -= dt;
    if (this.ttl <= 0) this.dead = true;
  }

  draw(ctx) {
    const info = POWERUPS[this.type];
    const t = (performance.now() - this.born) / 1000;
    const bob = Math.sin(t * 3) * 3;
    const pulse = 0.6 + 0.4 * Math.sin(t * 5);

    ctx.save();
    ctx.translate(this.x, this.y + bob);

    ctx.globalAlpha = this.ttl < 3 ? (Math.floor(t * 6) % 2 ? 0.35 : 1) : 1;

    ctx.shadowColor = info.color;
    ctx.shadowBlur = 14 * pulse;
    ctx.fillStyle = 'rgba(12,18,30,0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = info.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = info.color;
    ctx.font = 'bold 15px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(info.label, 0, 1);
    ctx.restore();
  }
}
