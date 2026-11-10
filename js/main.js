'use strict';

/* ============================================================
   入口：画布缩放 / 键盘输入 / 菜单、结算、联机
   ============================================================ */

(function () {
  const canvas = document.getElementById('game');
  const overlay = document.getElementById('overlay');
  const score1El = document.getElementById('score1');
  const score2El = document.getElementById('score2');
  const p1NameEl = document.getElementById('p1tag');
  const p2NameEl = document.getElementById('p2name');
  const roundEl = document.getElementById('roundLabel');
  const modeEl = document.getElementById('modeLabel');
  const pauseEl = document.getElementById('pauseLayer');
  const pauseBtn = document.getElementById('pauseBtn');
  const toastEl = document.getElementById('toast');

  const game = new Game(canvas);
  window.__game = game; // 调试钩子（自动化测试用）

  const net = new NetPlay(game);
  window.__net = net;

  const keys = Object.create(null);

  let selMode = 'single';
  let selDiff = 'normal';
  let selMap = 'random';
  let paused = false;
  let last = 0;
  let lastHud = '';
  let statusText = '';

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

  // 单人 / 双人本机：玩家 1 用 WASD，玩家 2 用方向键
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

  // 联机：每人一台电脑，两套按键都能用
  function netLocalInput() {
    return {
      forward: ((keys.KeyW || keys.ArrowUp) ? 1 : 0) - ((keys.KeyS || keys.ArrowDown) ? 1 : 0),
      turn: ((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0),
      fire: !!(keys.KeyF || keys.Space)
    };
  }

  /* ---------------- 暂停 / 提示 ---------------- */

  function canPause() {
    return game.state === 'countdown' || game.state === 'playing' || game.state === 'roundover';
  }

  function setPaused(value, remote) {
    if (value && canPause() === false && !remote) return;
    if (value && !remote && net.role === 'guest') {
      flashHint('联机中由房主暂停');
      return;
    }
    paused = value;
    pauseBtn.textContent = paused ? '继续' : '暂停';
    pauseBtn.classList.toggle('on', paused);

    if (paused) {
      renderPausePanel(remote);
      pauseEl.classList.remove('hidden');
    } else {
      pauseEl.classList.add('hidden');
      for (const k in keys) keys[k] = false;
    }

    if (net.role === 'host' && net.phase === 'playing' && !remote) {
      net.send('pz', { p: value ? 1 : 0 });
    }
  }

  function togglePause() {
    if (net.role === 'guest') {
      flashHint('联机中由房主暂停');
      return;
    }
    setPaused(!paused);
  }

  function resetPauseUI() {
    paused = false;
    pauseBtn.textContent = '暂停';
    pauseBtn.classList.remove('on');
    pauseEl.classList.add('hidden');
  }

  function renderPausePanel(remote) {
    const score = '第 ' + game.round + ' 回合 · ' + game.score[0] + ' : ' + game.score[1];
    if (remote) {
      pauseEl.innerHTML = [
        '<div class="panel compact">',
        '  <h2 class="panel-title">房主暂停了</h2>',
        '  <p class="panel-sub">' + score + '</p>',
        '  <div class="panel-tip">等房主点击继续，会自动恢复</div>',
        '  <div class="row center">',
        '    <button class="btn" id="quitBtn">退出到主菜单</button>',
        '  </div>',
        '</div>'
      ].join('');
    } else {
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

      const resume = document.getElementById('resumeBtn');
      const restart = document.getElementById('restartBtn');
      if (resume) resume.addEventListener('click', function () { setPaused(false); });
      if (restart) restart.addEventListener('click', function () { setPaused(false); startGame(); });
    }

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
    }, 1600);
  }

  /* ---------------- 菜单 ---------------- */

  function showMenu() {
    net.leave();
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
      '      <button class="btn' + (selMode === 'net' ? ' on' : '') + '" data-mode="net">联机对战</button>',
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
      '  <div class="group" id="netGroup" style="display:none">',
      '    <div class="group-label">联机房间</div>',
      '    <div class="row" id="roomRow">',
      '      <input id="roomInput" class="room-input" maxlength="6" autocomplete="off" spellcheck="false" placeholder="房间码">',
      '      <button class="btn" id="hostBtn">创建房间</button>',
      '      <button class="btn" id="joinBtn">加入房间</button>',
      '    </div>',
      '    <div class="net-tip">房主用蓝方、客机用红方；地图由房主生成后下发。</div>',
      '  </div>',
      '  <button class="btn primary big" id="startBtn">开始游戏</button>',
      '  <div class="rules">',
      '    <div><b>操作</b>：<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>（或方向键）移动，<kbd>F</kbd>（或空格）开火。</div>',
      '    <div><b>规则</b>：炮弹撞墙会反弹，最多 5 次；一击即毁，误伤自己同样算对手得分；先赢 5 回合者获胜。</div>',
      '    <div><b>地图</b>：每局开始时随机生成一张 180° 对称迷宫，同一局内各回合共用同一张图。</div>',
      '    <div><b>道具</b>：盾（挡一发）、连（射速翻倍）、速（移速提升）、三（三连发）。</div>',
      '    <div><b>联机</b>：创建房间后把 6 位房间码或邀请链接发给朋友，对方点「加入房间」即可。</div>',
      '  </div>',
      '</div>'
    ].join('');

    const diffGroup = document.getElementById('diffGroup');
    const netGroup = document.getElementById('netGroup');
    const startBtn = document.getElementById('startBtn');

    function syncGroups() {
      diffGroup.style.display = selMode === 'single' ? '' : 'none';
      netGroup.style.display = selMode === 'net' ? '' : 'none';
      startBtn.style.display = selMode === 'net' ? 'none' : '';
    }
    syncGroups();

    overlay.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        selMode = b.getAttribute('data-mode');
        overlay.querySelectorAll('[data-mode]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        syncGroups();
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

    const roomInput = document.getElementById('roomInput');
    roomInput.addEventListener('input', function () {
      roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    });

    document.getElementById('hostBtn').addEventListener('click', function () {
      hostRoom(roomInput.value.trim());
    });
    document.getElementById('joinBtn').addEventListener('click', function () {
      joinRoom(roomInput.value.trim());
    });
  }

  /* ---------------- 联机界面 ---------------- */

  function statusLabel(s) {
    if (s === 'connecting') return '正在连接房间…';
    if (s === 'reconnecting') return '连接中断，正在重连…';
    if (s === 'denied') return '通道被拒绝：请在 Supabase 后台确认 Realtime 已启用';
    if (s === 'config') return '联机服务未配置';
    if (s === 'online') {
      if (net.role === 'host') return '房间就绪，等待对手加入…';
      return '已进入房间，等待房主开始…';
    }
    return '';
  }

  function updateStatusDom() {
    const el = document.getElementById('netStatus');
    if (el && statusText) el.textContent = statusText;
  }

  function hostRoom(code) {
    const room = net.host(code);
    overlay.innerHTML = [
      '<div class="panel compact">',
      '  <h2 class="panel-title">房间已创建</h2>',
      '  <p class="panel-sub">把这串房间码发给朋友</p>',
      '  <div class="room-code">' + room + '</div>',
      '  <div class="row center">',
      '    <button class="btn primary" id="copyBtn">复制邀请链接</button>',
      '  </div>',
      '  <div class="net-status" id="netStatus">' + (statusText || '正在连接房间…') + '</div>',
      '  <div class="row center">',
      '    <button class="btn" id="cancelBtn">取消</button>',
      '  </div>',
      '</div>'
    ].join('');

    document.getElementById('copyBtn').addEventListener('click', function () {
      const url = location.origin + location.pathname + '?room=' + room;
      copyText(url);
    });
    document.getElementById('cancelBtn').addEventListener('click', function () {
      net.leave();
      showMenu();
    });
  }

  function joinRoom(code) {
    if (!code || code.length !== 6) {
      flashHint('房间码是 6 位字母数字');
      return;
    }
    net.join(code);
    overlay.innerHTML = [
      '<div class="panel compact">',
      '  <h2 class="panel-title">正在加入房间</h2>',
      '  <div class="room-code">' + code.toUpperCase() + '</div>',
      '  <div class="net-status" id="netStatus">正在连接房间…</div>',
      '  <div class="row center">',
      '    <button class="btn" id="cancelBtn">取消</button>',
      '  </div>',
      '</div>'
    ].join('');
    document.getElementById('cancelBtn').addEventListener('click', function () {
      net.leave();
      showMenu();
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        flashHint('邀请链接已复制');
      }).catch(function () {
        flashHint('复制失败，请手动分享链接');
      });
    } else {
      flashHint('复制失败，请手动分享链接');
    }
  }

  /* ---------------- 开局 / 结算 ---------------- */

  function startGame() {
    Sfx.init();
    overlay.classList.add('hidden');
    resetPauseUI();
    game.onMatchEnd = showMatchEnd;
    const mode = net.role === 'host' ? 'net' : selMode;
    game.localSide = net.role === 'guest' ? 1 : 0;
    game.start(mode, selDiff, selMap);
    if (net.role === 'host') net.startMatch(game.mapBlocks, game.mapMode);
  }

  function resultPanel(title, color, score, buttons) {
    overlay.classList.remove('hidden');
    overlay.innerHTML = [
      '<div class="panel">',
      '  <h2 class="panel-title" style="color:' + color + '">' + title + '</h2>',
      '  <p class="panel-sub">' + score + '</p>',
      '  <div class="row center" id="resultBtns"></div>',
      '</div>'
    ].join('');

    const box = document.getElementById('resultBtns');
    buttons.forEach(function (b) {
      const el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' primary' : '');
      el.textContent = b.text;
      el.addEventListener('click', b.action);
      box.appendChild(el);
    });
  }

  function showMatchEnd(result) {
    if (net.role === 'host') {
      net.phase = 'ended';
      net.send('over', { w: result.winner, sc: result.score });
      const youWin = result.winner === 0;
      resultPanel(
        youWin ? '你赢了' : '对手获胜',
        youWin ? PALETTE.p1 : PALETTE.p2,
        '最终比分 ' + result.score[0] + ' : ' + result.score[1],
        [
          { text: '再来一局', primary: true, action: startGame },
          { text: '返回菜单', action: showMenu }
        ]
      );
      return;
    }

    const winnerLabel = result.winner === 0
      ? '玩家 1 获胜'
      : (result.mode === 'single' ? '电脑获胜' : '玩家 2 获胜');
    const color = result.winner === 0 ? PALETTE.p1 : (result.mode === 'single' ? PALETTE.ai : PALETTE.p2);

    resultPanel(
      winnerLabel,
      color,
      '最终比分 ' + result.score[0] + ' : ' + result.score[1],
      [
        { text: '再来一局', primary: true, action: startGame },
        { text: '返回菜单', action: showMenu }
      ]
    );
  }

  function showNetEnd(winner, score) {
    const youWin = winner === 1;
    resultPanel(
      youWin ? '你赢了' : '对手获胜',
      youWin ? PALETTE.p2 : PALETTE.p1,
      '最终比分 ' + score[0] + ' : ' + score[1],
      [
        {
          text: '再来一局',
          primary: true,
          action: function () {
            net.send('again', {});
            flashHint('已请求房主再来一局');
          }
        },
        { text: '返回菜单', action: showMenu }
      ]
    );
  }

  function showNetLost(title, sub) {
    resultPanel(title, '#ffc451', sub, [
      { text: '返回菜单', primary: true, action: showMenu }
    ]);
  }

  /* ---------------- 联机事件 ---------------- */

  net.on('status', function (s) {
    statusText = statusLabel(s);
    updateStatusDom();
  });

  net.on('guestReady', function () {
    // 房主：有人进房间了，直接开局
    startGame();
  });

  net.on('started', function () {
    overlay.classList.add('hidden');
    resetPauseUI();
    flashHint('对手已加入，开打！');
  });

  net.on('remotePause', function (v) {
    setPaused(v, true);
  });

  net.on('over', function (d) {
    showNetEnd(d.w, d.sc);
  });

  net.on('againRequest', function () {
    startGame();
  });

  net.on('opponentLeft', function () {
    if (!net.role) return;
    net.leave();
    showNetLost('对手已离开房间', '这局就这么算了');
  });

  net.on('lost', function () {
    const role = net.role;
    net.leave();
    showNetLost('连接中断', role === 'host' ? '对手掉线了，或者网络不稳定' : '和房主的连接断了');
  });

  /* ---------------- HUD ---------------- */

  function updateHud() {
    let label;
    if (net.role === 'host') {
      label = '联机 · 房主' + (net.pingMs ? ' · ' + net.pingMs + 'ms' : '');
    } else if (net.role === 'guest') {
      label = '联机 · 客机' + (net.pingMs ? ' · ' + net.pingMs + 'ms' : '');
    } else if (game.mode === 'net') {
      label = '联机对战';
    } else {
      label = (game.mode === 'single' ? '单人挑战' : '双人对战');
    }
    label += (game.mapMode === 'classic' ? ' · 经典图' : ' · 随机图');

    const key = game.score[0] + '|' + game.score[1] + '|' + game.round + '|' + label + '|' + game.state;
    if (key === lastHud) return;
    lastHud = key;

    score1El.textContent = game.score[0];
    score2El.textContent = game.score[1];
    roundEl.textContent = game.state === 'matchover'
      ? '比赛结束'
      : (game.tanks.length ? '第 ' + game.round + ' 回合' : '准备中');
    modeEl.textContent = label;

    if (net.role === 'host') {
      p1NameEl.textContent = '你';
      p2NameEl.textContent = '对手';
    } else if (net.role === 'guest') {
      p1NameEl.textContent = '对手';
      p2NameEl.textContent = '你';
    } else {
      p1NameEl.textContent = '玩家 1';
      p2NameEl.textContent = game.mode === 'single' ? '电脑' : '玩家 2';
    }
  }

  /* ---------------- 主循环 ---------------- */

  function frame(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;

    if (!paused) {
      if (net.role === 'host' && net.phase === 'playing') {
        readInputs();
        game.inputs[1] = net.remoteInput;
        game.update(dt);
        net.updateHost(dt);
      } else if (net.role === 'guest') {
        const input = netLocalInput();
        if (net.phase === 'playing') net.predictLocal(dt, input);
        net.updateGuest(net.phase === 'playing' ? dt : 0, input);
      } else {
        if (game.state !== 'idle' && game.state !== 'matchover') readInputs();
        game.update(dt);
      }
    }

    game.ctx.clearRect(0, 0, GAME_W, GAME_H);
    game.draw();
    updateHud();

    requestAnimationFrame(frame);
  }

  /* ---------------- 启动 ---------------- */

  fitCanvas();
  window.addEventListener('resize', fitCanvas);
  showMenu();

  pauseBtn.addEventListener('click', function () {
    if (net.role === 'guest') {
      flashHint('联机中由房主暂停');
      return;
    }
    if (paused) setPaused(false);
    else if (canPause()) setPaused(true);
  });

  document.addEventListener('visibilitychange', function () {
    // 联机时不自动暂停：暂停会把对手一起冻住
    if (document.hidden && !paused && !net.role && canPause()) setPaused(true);
  });

  const params = new URLSearchParams(location.search);
  const roomParam = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const online = params.get('online');
  const auto = params.get('autostart');

  if (online === 'host' || online === 'join') {
    selMode = 'net';
    showMenu();
    if (online === 'host') hostRoom(roomParam);
    else joinRoom(roomParam);
  } else if (roomParam) {
    selMode = 'net';
    showMenu();
    const input = document.getElementById('roomInput');
    if (input) input.value = roomParam;
    joinRoom(roomParam);
  } else if (auto) {
    selMode = auto === 'duel' ? 'duel' : 'single';
    startGame();
  }

  window.addEventListener('error', function (e) {
    document.title = 'ERR: ' + (e.message || 'unknown');
  });

  requestAnimationFrame(frame);
})();
