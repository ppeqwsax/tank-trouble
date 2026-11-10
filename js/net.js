'use strict';

/* ============================================================
   Supabase Realtime 通道（直接说 Phoenix 协议，不依赖任何 SDK）
   - 每个房间 = 一个 public broadcast 频道
   - 只用到 broadcast，不碰数据库，也不建表
   ============================================================ */

class RealtimeClient {
  constructor(channel, handlers) {
    this.channel = channel;
    this.topic = 'realtime:' + channel;
    this.onEvent = (handlers && handlers.onEvent) || function () {};
    this.onStatus = (handlers && handlers.onStatus) || function () {};

    this.ws = null;
    this.joined = false;
    this.ref = 0;
    this.pending = [];
    this.closed = false;
    this.retries = 0;
    this.heartbeat = 0;
    this.reconnectTimer = 0;
  }

  connect() {
    const cfg = window.TT_NET || {};
    if (!cfg.url || !cfg.key) {
      this.onStatus('config');
      return;
    }

    this.closed = false;
    const base = String(cfg.url).replace(/^http/, 'ws');
    const url = base + '/realtime/v1/websocket?apikey=' + encodeURIComponent(cfg.key) + '&vsn=1.0.0';

    this.onStatus(this.retries ? 'reconnecting' : 'connecting');

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.onStatus('error');
      return;
    }

    const self = this;
    this.ws = ws;
    ws.onopen = function () { self.join(); };
    ws.onmessage = function (ev) { self.handle(ev.data); };
    ws.onerror = function () {};
    ws.onclose = function () {
      self.joined = false;
      clearInterval(self.heartbeat);
      if (self.closed) return;
      self.onStatus('reconnecting');
      const delay = Math.min(5000, 400 * Math.pow(1.7, self.retries++));
      clearTimeout(self.reconnectTimer);
      self.reconnectTimer = setTimeout(function () {
        if (!self.closed) self.connect();
      }, delay);
    };
  }

  join() {
    this.joined = false;
    this.sendRaw({
      topic: this.topic,
      event: 'phx_join',
      ref: String(++this.ref),
      payload: {
        config: {
          broadcast: { ack: false, self: false },
          presence: { key: '' },
          postgres_changes: [],
          private: false
        }
      }
    });
  }

  sendRaw(msg) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(msg)); } catch (e) { /* 忽略发送失败，等重连 */ }
    }
  }

  handle(raw) {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }

    if (m.event === 'phx_reply') {
      const status = m.payload && m.payload.status;
      if (status === 'ok' && !this.joined) {
        this.joined = true;
        this.retries = 0;
        this.startHeartbeat();
        this.onStatus('online');
        const queued = this.pending;
        this.pending = [];
        for (let i = 0; i < queued.length; i++) this.emit(queued[i].e, queued[i].d);
      } else if (status === 'error') {
        this.onStatus('denied');
      }
      return;
    }

    if (m.event === 'broadcast' && m.payload && m.payload.payload) {
      const inner = m.payload.payload;
      this.onEvent(inner.e, inner.d);
    }
  }

  startHeartbeat() {
    const self = this;
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(function () {
      self.sendRaw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++self.ref) });
    }, 20000);
  }

  emit(e, d) {
    if (this.joined) {
      this.sendRaw({
        topic: this.topic,
        event: 'broadcast',
        ref: '',
        payload: { type: 'broadcast', event: 'msg', payload: { e: e, d: d } }
      });
    } else if (this.pending.length < 60) {
      // 只在还没连上时缓存控制类消息，快照没必要排队
      if (e === 'hi' || e === 'start' || e === 'in' || e === 'again' || e === 'bye') {
        this.pending.push({ e: e, d: d });
      }
    }
  }

  close() {
    this.closed = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.reconnectTimer);
    this.pending = [];
    if (this.ws) {
      try { this.ws.close(); } catch (e) { /* ignore */ }
      this.ws = null;
    }
  }
}
