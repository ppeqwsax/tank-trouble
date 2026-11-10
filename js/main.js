'use strict';

/* ============================================================
   入口：画布缩放 / 键盘输入 / 菜单与结算
   ============================================================ */

(function () {
  const canvas = document.getElementById('game');
  const overlay = document.getElementById('overlay');
  const score1El = document.getElementById('score1');
  const score2El = document.getElementById('score2');
  const p2NameEl = document.getElementById('p2name');
  const roundEl = document.getElementById('roundLabel');
  const modeEl = document.getElementById('modeLabel');
  const pauseEl = document.getElementById('pauseLayer');
  const pauseBtn = document.getElementById('pauseBtn');
  const toastEl = document.getElementById('toast');

  const game = new Game(canvas);
  window.__game = game; // 调试钩子（自动化测试用）
  const keys = Object.create(null);

  let selMode = 'single';
  let selDiff = 'normal';
  let selMap = 'random';
  let paused = false;
  let last = 0;
  let lastHud = '';

  /* ---------------- 画布适配 ---------------- */

  function fitCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(GAME_W * dpr);
    canvas.height = Math.round(GAME_H * dpr);
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    game.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    game.wallLayer = game.renderWalls();
  }

  /* ---------------- 输入 ---------------- */

  const BLOCK = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

  window.addEventListener('keydown', function (e) {
    if (BLOCK.indexOf(e.code) >= 0) e.preventDefault();
    if (e.repeat) return;
    keys[e.code] = true;

    if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
    if (e.code === 'KeyM') {
      Sfx.enabled = !Sfx.enabled;
      flashHint(Sfx.enabled ? '音效已开启' : '音效已关闭');
    }
    Sfx.init();
  });

  window.addEventListener('keyup', function (e) {
    keys[e.code] = false;
  });

  window.addEventListener('blur', function () {
    for (const k in keys) keys[k] = false;
  });

  function readInputs() {
    game.inputs[0] = {
      forward: (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0),
      turn: (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
      fire: !!keys.KeyF
    };
    if (game.mode === 'duel') {
      game.inputs[1] = {
        forward: (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0),
        turn: (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0),
        fire: !!keys.Space
      };
    }
  }

  /* ---------------- 暂停 / 提示 ---------------- */

  function canPause() {
    return game.state === 'countdown' || game.state === 'playing' || game.state === 'roundover';
  }

  function setPaused(value) {
    if (value && !canPause()) return;
    paused = value;
    pauseBtn.textContent = paused ? '继续' : '暂停';
    pauseBtn.classList.toggle('on', paused);

    if (paused) {
      renderPausePanel();
      pauseEl.classList.remove('hidden');
    } else {
      pauseEl.classList.add('hidden');
      for (const k in keys) keys[k] = false;
    }
  }

  function togglePause() {
    setPaused(!paused);
  }

  function resetPauseUI() {
    paused = false;
    pauseBtn.textContent = '暂停';
    pauseBtn.classList.remove('on');
    pauseEl.classList.add('hidden');
  }

  function renderPausePanel() {
    const score = '第 ' + game.round + ' 回合 · ' + game.score[0] + ' : ' + game.score[1];
    pauseEl.innerHTML = [
      '<div class="panel compact">',
      '  <h2 class="panel-title">已暂停</h2>',
      '  <p class="panel-sub">' + score + '</p>',
      '  <div class="row center">',
      '    <button class="btn primary" id="resumeBtn">继续游戏</button>',
      '  </div>',
      '  <div class="row center">',
      '    <button class="btn" id="restartBtn">重新开始</button>',
      '    <button class="btn" id="quitBtn">退出到主菜单</button>',
      '  </div>',
      '  <div class="panel-tip">按 <kbd>P</kbd> 或 <kbd>Esc</kbd> 也可以继续</div>',
      '</div>'
    ].join('');

    document.getElementById('resumeBtn').addEventListener('click', function () { setPaused(false); });
    document.getElementById('restartBtn').addEventListener('click', function () {
      setPaused(false);
      startGame();
    });
    document.getElementById('quitBtn').addEventListener('click', function () {
      setPaused(false);
      showMenu();
    });
  }

  let hintTimer = 0;
  function flashHint(text) {
    toastEl.textContent = text;
    toastEl.classList.remove('hidden');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      toastEl.classList.add('hidden');
    }, 1000);
  }

  /* ---------------- 菜单 ---------------- */

  function showMenu() {
    resetPauseUI();
    game.state = 'idle';
    overlay.classList.remove('hidden');
    overlay.innerHTML = [
      '<div class="panel">',
      '  <h2 class="panel-title">坦克动荡</h2>',
      '  <p class="panel-sub">炮弹撞墙反弹 · 一炮定生死</p>',
      '  <div class="group">',
      '    <div class="group-label">对战模式</div>',
      '    <div class="row" id="modeRow">',
      '      <button class="btn' + (selMode === 'single' ? ' on' : '') + '" data-mode="single">单人挑战</button>',
      '      <button class="btn' + (selMode === 'duel' ? ' on' : '') + '" data-mode="duel">双人对战</button>',
      '    </div>',
      '  </div>',
      '  <div class="group" id="diffGroup">',
      '    <div class="group-label">电脑难度</div>',
      '    <div class="row" id="diffRow">',
      '      <button class="btn' + (selDiff === 'easy' ? ' on' : '') + '" data-diff="easy">简单</button>',
      '      <button class="btn' + (selDiff === 'normal' ? ' on' : '') + '" data-diff="normal">普通</button>',
      '      <button class="btn' + (selDiff === 'hard' ? ' on' : '') + '" data-diff="hard">困难</button>',
      '    </div>',
      '  </div>',
      '  <div class="group">',
      '    <div class="group-label">地图</div>',
      '    <div class="row" id="mapRow">',
      '      <button class="btn' + (selMap === 'random' ? ' on' : '') + '" data-map="random">随机生成</button>',
      '      <button class="btn' + (selMap === 'classic' ? ' on' : '') + '" data-map="classic">经典地图</button>',
      '    </div>',
      '  </div>',
      '  <button class="btn primary big" id="startBtn">开始游戏</button>',
      '  <div class="rules">',
      '    <div><b>操作</b>：玩家 1 <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动，<kbd>F</kbd> 开火；',
      '    玩家 2 <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> 移动，<kbd>空格</kbd> 开火。</div>',
      '    <div><b>规则</b>：炮弹撞墙会反弹，最多 5 次；一击即毁，误伤自己同样算对手得分；先赢 5 回合者获胜。</div>',
      '    <div><b>地图</b>：每局开始时随机生成一张 180° 对称迷宫，同一局内各回合共用同一张图。</div>',
      '    <div><b>道具</b>：盾（挡一发）、连（射速翻倍）、速（移速提升）、三（三连发）。</div>',
      '    <div><b>快捷键</b>：<kbd>P</kbd> / <kbd>Esc</kbd> 暂停，<kbd>M</kbd> 静音；游戏中也可点右上角「暂停」随时停或退出。</div>',
      '  </div>',
      '</div>'
    ].join('');

    const diffGroup = document.getElementById('diffGroup');
    diffGroup.style.display = selMode === 'single' ? '' : 'none';

    overlay.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        selMode = b.getAttribute('data-mode');
        overlay.querySelectorAll('[data-mode]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        diffGroup.style.display = selMode === 'single' ? '' : 'none';
      });
    });

    overlay.querySelectorAll('[data-map]').forEach(function (b) {
      b.addEventListener('click', function () {
        selMap = b.getAttribute('data-map');
        overlay.querySelectorAll('[data-map]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      });
    });

    overlay.querySelectorAll('[data-diff]').forEach(function (b) {
      b.addEventListener('click', function () {
        selDiff = b.getAttribute('data-diff');
        overlay.querySelectorAll('[data-diff]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      });
    });

    document.getElementById('startBtn').addEventListener('click', startGame);
  }

  function startGame() {
    Sfx.init();
    overlay.classList.add('hidden');
    resetPauseUI();
    game.onMatchEnd = showMatchEnd;
    game.start(selMode, selDiff, selMap);
  }

  function showMatchEnd(result) {
    const winnerLabel = result.winner === 0
      ? '玩家 1 获胜'
      : (result.mode === 'single' ? '电脑获胜' : '玩家 2 获胜');
    const color = result.winner === 0 ? PALETTE.p1 : (result.mode === 'single' ? PALETTE.ai : PALETTE.p2);

    overlay.classList.remove('hidden');
    overlay.innerHTML = [
      '<div class="panel">',
      '  <h2 class="panel-title" style="color:' + color + '">' + winnerLabel + '</h2>',
      '  <p class="panel-sub">最终比分 ' + result.score[0] + ' : ' + result.score[1] + '</p>',
      '  <div class="row center">',
      '    <button class="btn primary" id="againBtn">再来一局</button>',
      '    <button class="btn" id="menuBtn">返回菜单</button>',
      '  </div>',
      '</div>'
    ].join('');

    document.getElementById('againBtn').addEventListener('click', startGame);
    document.getElementById('menuBtn').addEventListener('click', showMenu);
  }

  /* ---------------- HUD ---------------- */

  function updateHud() {
    const label = (game.mode === 'single' ? '单人挑战' : '双人对战') +
      (game.mapMode === 'classic' ? ' · 经典图' : ' · 随机图');
    const key = game.score[0] + '|' + game.score[1] + '|' + game.round + '|' + label + '|' + game.state;
    if (key === lastHud) return;
    lastHud = key;

    score1El.textContent = game.score[0];
    score2El.textContent = game.score[1];
    roundEl.textContent = game.state === 'matchover'
      ? '比赛结束'
      : (game.tanks.length ? '第 ' + game.round + ' 回合' : '准备中');
    modeEl.textContent = label;
    p2NameEl.textContent = game.mode === 'single' ? '电脑' : '玩家 2';
  }

  /* ---------------- 主循环 ---------------- */

  function frame(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;

    if (!paused && game.state !== 'idle' && game.state !== 'matchover') {
      readInputs();
    }
    if (!paused) game.update(dt);

    game.ctx.clearRect(0, 0, GAME_W, GAME_H);
    game.draw();
    updateHud();

    requestAnimationFrame(frame);
  }

  /* ---------------- 启动 ---------------- */

  fitCanvas();
  window.addEventListener('resize', fitCanvas);
  showMenu();

  // 顶栏暂停按钮：随时可以暂停 / 继续
  pauseBtn.addEventListener('click', function () {
    if (paused) setPaused(false);
    else if (canPause()) setPaused(true);
  });

  // 切到别的标签页 / 最小化时自动暂停，回来不会突然被 AI 打
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && !paused && canPause()) setPaused(true);
  });

  // 便于自动化验证：?autostart=single|duel
  const auto = new URLSearchParams(location.search).get('autostart');
  if (auto) {
    selMode = auto === 'duel' ? 'duel' : 'single';
    startGame();
  }

  window.addEventListener('error', function (e) {
    document.title = 'ERR: ' + (e.message || 'unknown');
  });

  requestAnimationFrame(frame);
})();
