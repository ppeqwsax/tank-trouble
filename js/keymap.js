'use strict';

/* ============================================================
   键位映射：默认键 + localStorage 持久化 + 冲突检测
   ============================================================ */

(function () {
  const STORE_KEY = 'tt-keymap-v1';

  const ACTIONS = [
    { id: 'up', name: '前进' },
    { id: 'down', name: '后退' },
    { id: 'left', name: '左转' },
    { id: 'right', name: '右转' },
    { id: 'fire', name: '开火' }
  ];

  const DEFAULTS = {
    p1: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', fire: 'KeyJ' },
    p2: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', fire: 'Space' }
  };

  // 这几个是全局快捷键，不参与改键
  const RESERVED = {
    Escape: 'Esc（取消 / 暂停）',
    KeyP: 'P（暂停）',
    KeyM: 'M（静音）'
  };

  const LABELS = {
    Space: '空格',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'Shift', ShiftRight: 'Shift',
    ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
    AltLeft: 'Alt', AltRight: 'Alt',
    Enter: 'Enter', Backspace: '退格', Tab: 'Tab',
    Semicolon: ';', Comma: ',', Period: '.', Slash: '/',
    Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Minus: '-', Equal: '=', Backquote: '`',
    NumpadAdd: '小键盘+', NumpadSubtract: '小键盘-', NumpadDecimal: '小键盘.',
    NumpadMultiply: '小键盘*', NumpadDivide: '小键盘/'
  };

  function label(code) {
    if (!code) return '未设置';
    if (LABELS[code]) return LABELS[code];
    let m = /^Key([A-Z])$/.exec(code);
    if (m) return m[1];
    m = /^Digit([0-9])$/.exec(code);
    if (m) return m[1];
    m = /^Numpad([0-9])$/.exec(code);
    if (m) return '小键盘' + m[1];
    m = /^F([0-9]{1,2})$/.exec(code);
    if (m) return 'F' + m[1];
    return code;
  }

  function clone(map) {
    return { p1: Object.assign({}, map.p1), p2: Object.assign({}, map.p2) };
  }

  function load() {
    const map = clone(DEFAULTS);
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        ['p1', 'p2'].forEach(function (side) {
          if (!saved || !saved[side]) return;
          ACTIONS.forEach(function (a) {
            const v = saved[side][a.id];
            if (typeof v === 'string' && v) map[side][a.id] = v;
          });
        });
      }
    } catch (e) {
      /* 本地配置损坏就用默认值 */
    }
    return map;
  }

  function save(map) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ p1: map.p1, p2: map.p2 }));
    } catch (e) {
      /* 隐私模式下无法写入，忽略 */
    }
  }

  // 这个键还被谁占着？没有冲突返回 null
  function conflict(map, side, action, code) {
    const sides = ['p1', 'p2'];
    for (let i = 0; i < sides.length; i++) {
      const s = sides[i];
      for (let j = 0; j < ACTIONS.length; j++) {
        const a = ACTIONS[j];
        if (s === side && a.id === action) continue;
        if (map[s][a.id] === code) {
          return (s === 'p1' ? '玩家 1' : '玩家 2') + ' · ' + a.name;
        }
      }
    }
    return null;
  }

  function reservedReason(code) {
    return RESERVED[code] || null;
  }

  window.KeyMap = {
    ACTIONS: ACTIONS,
    DEFAULTS: DEFAULTS,
    label: label,
    load: load,
    save: save,
    clone: clone,
    conflict: conflict,
    reservedReason: reservedReason
  };
})();
