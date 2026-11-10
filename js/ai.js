'use strict';

/* ============================================================
   电脑对手 AI：视线判定 → 瞄准/开火 / 无视线 → 巡逻绕行
   ============================================================ */

const AI_LEVELS = {
  easy: { react: 0.62, aimErr: 0.17, turn: 2.2, fireMul: 1.8, lead: 0, dodge: false },
  normal: { react: 0.34, aimErr: 0.085, turn: 2.9, fireMul: 1.15, lead: 0.55, dodge: true },
  hard: { react: 0.15, aimErr: 0.03, turn: 3.5, fireMul: 0.8, lead: 1.0, dodge: true }
};

class AIController {
  constructor(tank, level) {
    this.tank = tank;
    this.level = level || 'normal';
    this.cfg = AI_LEVELS[this.level] || AI_LEVELS.normal;
    this.aimNoise = 0;
    this.aimNoiseTimer = 0;
    this.fireDelay = 0;
    this.repath = 0;
    this.waypoint = null;
    this.dodgeTimer = 0;
    this.dodgeCd = 0;
  }

  update(dt, game) {
    const t = this.tank;
    const input = { forward: 0, turn: 0, fire: false };
    if (!t.alive) return input;

    this.fireDelay = Math.max(0, this.fireDelay - dt);
    this.repath -= dt;
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);

    this.aimNoiseTimer -= dt;
    if (this.aimNoiseTimer <= 0) {
      this.aimNoise = rand(-this.cfg.aimErr, this.cfg.aimErr);
      this.aimNoiseTimer = rand(0.35, 0.9);
    }

    const enemy = game.enemyOf(t);
    if (!enemy) return input;

    if (this.cfg.dodge && this.dodgeCd <= 0) {
      const danger = game.incomingBullet(t, 0.42);
      if (danger) {
        this.dodgeTimer = 0.32;
        this.dodgeCd = 1.1;
        this.dodgeVec = danger;
      }
    }
    if (this.dodgeTimer > 0) {
      this.dodgeTimer -= dt;
      return this.dodge(dt, game);
    }

    if (game.hasLineOfSight(t.x, t.y, enemy.x, enemy.y)) {
      return this.engage(enemy, dt, game, input);
    }
    return this.roam(dt, game, input);
  }

  engage(enemy, dt, game, input) {
    const t = this.tank;
    let tx = enemy.x;
    let ty = enemy.y;

    if (this.cfg.lead > 0) {
      const d = dist(t.x, t.y, tx, ty);
      const tof = (d / BULLET_SPEED) * this.cfg.lead;
      tx += (enemy.vx || 0) * tof;
      ty += (enemy.vy || 0) * tof;
    }

    const desired = Math.atan2(ty - t.y, tx - t.x) + this.aimNoise;
    const diff = angleDiff(desired, t.angle);

    input.turn = clamp(diff * 3, -1, 1);

    if (Math.abs(diff) < 0.1 && this.fireDelay <= 0) {
      input.fire = true;
      this.fireDelay = this.cfg.react;
    }

    const d = dist(t.x, t.y, enemy.x, enemy.y);
    if (d > 300 && Math.abs(diff) < 0.5) input.forward = 1;
    else if (d < 130) input.forward = -0.7;
    else if (Math.abs(diff) < 0.12) input.forward = 0.5;

    if (game.probeBlocked(t, 30)) {
      input.forward = -0.6;
      if (Math.abs(diff) < 0.3) input.turn = 1;
    }
    return input;
  }

  roam(dt, game, input) {
    const t = this.tank;
    if (!this.waypoint || this.repath <= 0 ||
      dist(t.x, t.y, this.waypoint.x, this.waypoint.y) < 52) {
      this.waypoint = game.randomFreePoint(t);
      this.repath = rand(1.8, 3.4);
    }

    const desired = Math.atan2(this.waypoint.y - t.y, this.waypoint.x - t.x);
    const diff = angleDiff(desired, t.angle);

    input.turn = clamp(diff * 2.8, -1, 1);
    input.forward = Math.abs(diff) < 0.85 ? 1 : 0.12;

    if (game.probeBlocked(t, 26)) {
      this.repath = 0;
      input.forward = -0.45;
      input.turn = 1;
    }
    return input;
  }

  dodge(dt, game) {
    const t = this.tank;
    const input = { forward: 1, turn: 0, fire: false };
    const b = this.dodgeVec;
    if (!b) return { forward: 0, turn: 1, fire: false };

    const a = Math.atan2(b.vy, b.vx) + Math.PI / 2;
    const a2 = a + Math.PI;
    const target = Math.abs(angleDiff(a, t.angle)) < Math.abs(angleDiff(a2, t.angle)) ? a : a2;

    input.turn = clamp(angleDiff(target, t.angle) * 3.2, -1, 1);
    input.forward = Math.abs(angleDiff(target, t.angle)) < 1.2 ? 1 : 0.2;
    if (game.probeBlocked(t, 24)) input.forward = 0;
    return input;
  }
}
