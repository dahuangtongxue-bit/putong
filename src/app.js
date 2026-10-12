/* ============================================================
   扑通 · Agent 运行时
   一轮对话：检索记忆 → 组装上下文 → 内心独白 → 情绪/动作 → 回复 → 写入记忆
   ============================================================ */
(function () {
'use strict';
const APP_VERSION = 'v2.0';

/* ---------------- 1. 工具 ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (x, d) => { const n = typeof x === 'number' ? x : parseFloat(x); return Number.isFinite(n) ? n : d; };
const str = (x, n = 120) => (x == null ? '' : String(x)).replace(/\s+/g, ' ').trim().slice(0, n);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = (s) => { let h = 5381; s = String(s); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h >>> 0; };
const pick = (arr, seed) => arr[(seed >>> 0) % arr.length];
const rid = (p = '') => p + Math.random().toString(36).slice(2, 9);
const REDUCED = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)').matches : false;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

let TIME_OFFSET = 0;
const nowMs = () => Date.now() + TIME_OFFSET;
const pad2 = (n) => String(n).padStart(2, '0');
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const dayNum = (ms) => { const d = new Date(ms); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5); };
const keyDayNum = (k) => { const [y, m, d] = String(k).split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 864e5); };
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const fmtTime = (ms) => { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const fmtMD = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}`; };
const fmtDateCN = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}月${d.getDate()}日 · ${WEEK[d.getDay()]}`; };
function period(h) { if (h < 5) return '深夜'; if (h < 8) return '清晨'; if (h < 11) return '上午'; if (h < 13) return '中午'; if (h < 18) return '下午'; if (h < 23) return '晚上'; return '深夜'; }
function todWord(h) { if (h < 5) return '夜深了'; if (h < 11) return '早上好'; if (h < 13) return '中午好'; if (h < 18) return '下午好'; return '晚上好'; }
function fmtGap(h) { if (h < 1) return `${Math.max(1, Math.round(h * 60))} 分钟前`; if (h < 24) return `${Math.round(h)} 小时前`; return `${Math.round(h / 24)} 天前`; }
function dueLabel(due, today) {
  if (!due) return '随时';
  const d = keyDayNum(due) - keyDayNum(today);
  if (d < 0) return `过了 ${-d} 天`; if (d === 0) return '今天'; if (d === 1) return '明天';
  return due.slice(5).replace('-', '/');
}
function stampText(ms) {
  const n = nowMs(); const d = dayNum(n) - dayNum(ms);
  if (d === 0) return `今天 ${fmtTime(ms)}`; if (d === 1) return `昨天 ${fmtTime(ms)}`;
  const x = new Date(ms); return `${x.getMonth() + 1}月${x.getDate()}日 ${fmtTime(ms)}`;
}
function tolerantJSON(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const tryParse = (x) => { try { return JSON.parse(x); } catch { return undefined; } };
  let v = tryParse(t); if (v !== undefined) return v;
  const first = t.search(/[[{]/); const last = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (first >= 0 && last > first) {
    const cut = t.slice(first, last + 1);
    v = tryParse(cut); if (v !== undefined) return v;
    v = tryParse(cut.replace(/,\s*([}\]])/g, '$1')); if (v !== undefined) return v;
  }
  return null;
}
function shade(hex, amt) {
  const n = parseInt(String(hex).replace('#', ''), 16); if (!Number.isFinite(n)) return hex;
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt < 0) { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; } else { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  return '#' + [r, g, b].map((x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('');
}
let toastTimer = 0;
function toast(msg, ms = 2600) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
/* 二次确认：第一次点击变成"确定？"，3.5 秒内再点才执行 */
function arm(btn, label, fn) {
  if (btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.classList.remove('armed'); fn(); return; }
  const orig = btn.textContent; btn.dataset.armed = '1'; btn.classList.add('armed'); btn.textContent = label;
  setTimeout(() => { if (btn.isConnected && btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.classList.remove('armed'); btn.textContent = orig; } }, 3500);
}

const ACT_CN = { nod: '点头', tilt: '歪头', bounce: '蹦起来', spin: '转圈', wave: '挥手', hide: '缩起来', droop: '耷拉下来', perk: '竖起耳朵', glow: '心核发光', shiver: '发抖' };
const TYPE_CN = { fact: '关于你', event: '发生过的事', bond: '我们之间', self: '扑通自己', follow: '挂念的事' };
const TIER_LABEL = { quick: '快速', default: '均衡', complex: '深度' };
const ICON_NOTE = '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 1.5h6.5l2.5 2.5v10.5h-9z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

/* ---------------- 2. 状态与存储 ---------------- */
function freshState() {
  const t = nowMs();
  return {
    v: 1,
    meta: { createdAt: t, lastActiveAt: 0, lastUserAt: 0, prevUserAt: 0, onboarded: false, seq: { m: 0, b: 0, s: 0, f: 0 }, days: {}, pokes: 0, dq: {}, dqUsed: [], gifts: [], flags: {}, app: APP_VERSION },
    facts: {},
    memories: [],
    followups: [],
    alien: { mood: '平静', valence: 0.3, arousal: 0.35, at: t, points: 0, level: 1, chapters: { 1: 'told' }, pendingChapter: 0, pendingTurns: 0 },
    chat: [], turns: [], lite: [], diary: [], evals: [],
    settings: { inner: false, tts: false, tier: 'quick', soul: null, timeOffset: 0, push: false },
  };
}
function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = freshState();
  const s = Object.assign({}, base, raw);
  s.meta = Object.assign({}, base.meta, raw.meta || {});
  s.meta.seq = Object.assign({}, base.meta.seq, (raw.meta && raw.meta.seq) || {});
  if (!s.meta.days || typeof s.meta.days !== 'object') s.meta.days = {};
  if (!s.meta.dq || typeof s.meta.dq !== 'object') s.meta.dq = {};
  if (!Array.isArray(s.meta.dqUsed)) s.meta.dqUsed = [];
  if (!Array.isArray(s.meta.gifts)) s.meta.gifts = [];
  if (!s.meta.flags || typeof s.meta.flags !== 'object') s.meta.flags = {};
  s.alien = Object.assign({}, base.alien, raw.alien || {});
  s.alien.chapters = Object.assign({}, base.alien.chapters, (raw.alien && raw.alien.chapters) || {});
  s.settings = Object.assign({}, base.settings, raw.settings || {});
  for (const k of ['memories', 'followups', 'chat', 'turns', 'lite', 'diary', 'evals']) if (!Array.isArray(s[k])) s[k] = [];
  if (!s.facts || typeof s.facts !== 'object' || Array.isArray(s.facts)) s.facts = {};
  if (!MOODS[s.alien.mood]) s.alien.mood = '平静';
  return s;
}
let S = freshState();

const LOCAL_KEY = 'putong:v1';
const Store = {
  mode: 'local', db: null, uid: null, dirty: new Set(), timer: 0, chain: Promise.resolve(),
  PARTS: {
    core: (s) => ({ v: s.v, meta: s.meta, facts: s.facts, followups: s.followups, alien: s.alien, settings: s.settings }),
    mem: (s) => ({ memories: s.memories }),
    chat: (s) => ({ chat: s.chat }),
    diary: (s) => ({ diary: s.diary }),
    turns: (s) => ({ turns: s.turns, lite: s.lite }),
    evals: (s) => ({ evals: s.evals }),
  },
  loadLocal() { const raw = lsGet(LOCAL_KEY); if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } },
  async detect() {
    if (!window.claude || typeof window.claude.use !== 'function') return;
    try {
      const giveUp = sleep(5000).then(() => null);
      const [db, user] = await Promise.all([Promise.race([window.claude.use('db'), giveUp]), Promise.race([window.claude.use('user'), giveUp])]);
      if (!db || !user) return;
      const id = await user.id();
      if (!id) return;
      this.db = db; this.uid = id; this.mode = 'db';
    } catch (e) { console.warn('[putong] db unavailable', e); }
  },
  ref(part) { return this.db.doc(`data/users/${this.uid}/${part}`); },
  async loadDb() {
    const out = {}; let any = false;
    for (const part of Object.keys(this.PARTS)) {
      const snap = await this.ref(part).get();
      if (snap.exists) { Object.assign(out, snap.data()); any = true; }
    }
    return any ? out : null;
  },
  mark(...parts) {
    (parts.length ? parts : Object.keys(this.PARTS)).forEach((p) => this.dirty.add(p));
    clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 600);
  },
  flush() {
    lsSet(LOCAL_KEY, JSON.stringify(S));
    if (this.mode !== 'db') { this.dirty.clear(); return this.chain; }
    const parts = [...this.dirty]; this.dirty.clear();
    this.chain = this.chain.then(async () => {
      for (const p of parts) {
        if (this.mode !== 'db') break;
        try { await this.ref(p).set(fitDoc(JSON.parse(JSON.stringify(this.PARTS[p](S))))); }
        catch (e) {
          console.warn('[putong] db write failed', p, e);
          if (e && ['invalid_argument', 'not_granted', 'revoked', 'capability_disabled', 'capability_removed', 'quota_exceeded'].includes(e.code)) {
            this.mode = 'local'; renderStorageLine(); toast('云端存档写不进去，记忆先存在这台设备的浏览器里'); break;
          }
        }
      }
    });
    return this.chain;
  },
};
const save = (...parts) => {
  if (S.settings.push && S.meta.onboarded) PushSyncSoon();
  return Store.mark(...parts.flatMap((p) => (p === 'lab' ? ['turns', 'evals'] : [p])));
};
/* 云端单个文档上限 256 KiB：超了就从最旧的记录开始裁 */
function fitDoc(doc) {
  const enc = new TextEncoder(); const LIMIT = 240 * 1024;
  let guard = 0;
  while (enc.encode(JSON.stringify(doc)).length > LIMIT && guard++ < 40) {
    const key = Object.keys(doc).filter((k) => Array.isArray(doc[k]) && doc[k].length > 4).sort((a, b) => JSON.stringify(doc[b]).length - JSON.stringify(doc[a]).length)[0];
    if (!key) break;
    doc[key] = doc[key].slice(Math.ceil(doc[key].length * 0.2));
  }
  return doc;
}

/* ---------------- 2.5 推送（挂念到期 & 每日扑通提醒；部署方没配 VAPID 时整体隐藏） ---------------- */
let PushSyncSoon = () => {};
const Push = {
  supported: ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window),
  config: null, sub: null,
  loadConfig() {
    if (!this.supported || !location.protocol.startsWith('http')) return Promise.resolve();
    return fetch('/api/push/config', { cache: 'no-store' }).then((r) => r.json()).then((j) => { this.config = j && j.enabled ? j : { enabled: false }; }).catch(() => { this.config = { enabled: false }; });
  },
  get enabled() { return !!(this.supported && this.config && this.config.enabled && this.config.vapidPublic); },
  async current() {
    if (!this.enabled) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    this.sub = await reg.pushManager.getSubscription();
    return this.sub;
  },
  snapshot() {
    return S.followups.filter((f) => f.status === 'open').map((f) => ({ id: f.id, text: f.text, ask: f.ask, due: f.due }));
  },
  async enable() {
    if (!this.enabled) return 'no-server';
    const reg = await navigator.serviceWorker.register('/sw.js').catch(() => null);
    if (!reg) return 'no-sw';
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
    const key = this.config.vapidPublic;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(key) }).then((s) => s).catch((e) => ({ __err: e && e.name }));
    }
    if (!sub || sub.__err) {
      if (sub && (sub.__err === 'AbortError' || sub.__err === 'NotSupportedError')) return 'no-push-service';
      return 'denied';
    }
    this.sub = sub;
    await this.sync(true);
    return 'on';
  },
  async disable() {
    if (this.sub) { await this.sub.unsubscribe().catch(() => {}); this.sub = null; }
    return 'off';
  },
  sync(first) {
    if (!this.enabled || !S.meta.onboarded) return;
    const sub = this.sub;
    if (!sub) { this.current().then((s) => { if (s) { this.sub = s; postJSON('/api/push/sync', { subscription: s, followups: this.snapshot() }); } }); return; }
    postJSON(first ? '/api/push/subscribe' : '/api/push/sync', { subscription: sub, followups: this.snapshot() });
  },
};
function urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function postJSON(url, body) {
  try { fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {}); } catch { /* ignore */ }
}
let pushSyncT = 0;
PushSyncSoon = () => { clearTimeout(pushSyncT); pushSyncT = setTimeout(() => Push.sync(false), 3000); };

/* ---------------- 3. 模型接入 ---------------- */
const BYOK_KEY = 'putong:byok';
const CODE_KEY = 'putong:access';
function loadByok() { try { return JSON.parse(lsGet(BYOK_KEY) || 'null'); } catch { return null; } }
const normErr = (e) => (e && typeof e === 'object' && e.code ? e : { code: 'upstream_error', message: String((e && e.message) || e) });

const LLM = {
  kind: 'none', label: '未连接模型', model: '', sample: null, needCode: false,
  async detect() {
    this.kind = 'none'; this.label = '未连接模型'; this.model = ''; this.sample = null;
    if (typeof window.__PUTONG_MOCK__ === 'function') { this.kind = 'mock'; this.label = '模拟模型（测试用）'; this.model = 'mock'; return; }
    if (window.claude && typeof window.claude.use === 'function') {
      try {
        const s = await Promise.race([window.claude.use('sample'), sleep(6000).then(() => null)]);
        if (s) { this.sample = s; this.kind = 'claude'; this.model = 'claude'; this.label = 'Claude（你的 claude.ai 账号）'; return; }
      } catch (e) { console.warn('[putong] sample unavailable', e); }
    }
    if (location.protocol.startsWith('http')) {
      try {
        const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 3500);
        const r = await fetch('/api/health', { signal: ctl.signal, cache: 'no-store' }); clearTimeout(tm);
        if (r.ok) {
          const j = await r.json();
          if (j && j.ok) { this.kind = 'proxy'; this.model = j.model || ''; this.needCode = !!j.accessCode; this.label = `服务端模型 · ${this.model}`; return; }
        }
      } catch { /* not deployed with a backend */ }
    }
    const b = loadByok();
    if (b && b.base && b.key && b.model) { this.kind = 'byok'; this.model = b.model; this.label = `自填接口 · ${b.model}`; }
  },
  async complete({ system, user, onText, signal, tier, maxTokens = 1100, temperature = 0.85 }) {
    if (this.kind === 'mock') return mockComplete({ system, user, onText, signal });
    if (this.kind === 'claude') {
      const opts = { modelTier: tier || 'quick', cache: false };
      if (signal) opts.signal = signal;
      if (onText) opts.onText = ({ text }) => onText(text);
      try {
        const r = await this.sample(system + '\n\n' + user, opts);
        return { text: r.text, truncated: r.truncated, model: 'claude · ' + (TIER_LABEL[r.modelTierApplied] || r.modelTierApplied || '') };
      } catch (e) { throw normErr(e); }
    }
    if (this.kind === 'proxy' || this.kind === 'byok') return openaiComplete(this.kind, { system, user, onText, signal, maxTokens, temperature });
    throw { code: 'no_provider', message: 'no provider' };
  },
};

async function openaiComplete(kind, { system, user, onText, signal, maxTokens, temperature }) {
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  const headers = { 'content-type': 'application/json' };
  let url, body;
  if (kind === 'proxy') {
    url = '/api/chat';
    const code = lsGet(CODE_KEY); if (code) headers['x-access-code'] = code;
    body = { messages, stream: true, max_tokens: maxTokens, temperature };
  } else {
    const b = loadByok() || {};
    url = String(b.base || '').replace(/\/+$/, '') + '/chat/completions';
    headers.authorization = 'Bearer ' + b.key;
    body = { model: b.model, messages, stream: true, max_tokens: maxTokens, temperature };
  }
  let res;
  try { res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal }); }
  catch (e) { if (e && e.name === 'AbortError') throw { code: 'cancelled' }; throw { code: 'upstream_error', message: String(e) }; }
  if (!res.ok) {
    let detail = ''; try { detail = await res.text(); } catch { /* ignore */ }
    if (res.status === 401 && /access_code/.test(detail)) throw { code: 'access_code', message: detail };
    if (res.status === 429) throw { code: 'rate_limited', message: detail };
    throw { code: 'upstream_error', message: `HTTP ${res.status} ${detail.slice(0, 200)}` };
  }
  const model = res.headers.get('x-llm-model') || LLM.model;
  const ctype = res.headers.get('content-type') || '';
  if (!/event-stream/.test(ctype) || !res.body) {
    const j = tolerantJSON(await res.text());
    const text = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    if (!text) throw { code: 'empty_completion' };
    if (onText) onText(text);
    return { text, model };
  }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '', text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim(); if (!data || data === '[DONE]') continue;
        let j; try { j = JSON.parse(data); } catch { continue; }
        const ch = j && j.choices && j.choices[0];
        const d = (ch && ch.delta && ch.delta.content) || (ch && ch.message && ch.message.content) || '';
        if (d) { text += d; if (onText) onText(text); }
      }
    }
  } catch (e) {
    if (e && e.name === 'AbortError') throw { code: 'cancelled', text };
    throw { code: 'upstream_error', message: String(e), text };
  }
  if (!text.trim()) throw { code: 'empty_completion' };
  return { text, model };
}

async function mockComplete({ system, user, onText, signal }) {
  const full = await window.__PUTONG_MOCK__({ system, user });
  let out = '';
  for (let i = 0; i < full.length; i += 24) {
    if (signal && signal.aborted) throw { code: 'cancelled', text: out };
    out = full.slice(0, i + 24); if (onText) onText(out);
    await sleep(8);
  }
  return { text: full, model: 'mock' };
}

function llmErrorText(e) {
  const c = (e && e.code) || 'upstream_error';
  const map = {
    not_granted: '你还没有允许这个页面使用 Claude，扑通暂时回不了话。下次打开时，在弹窗里点允许就好。',
    sampling_disabled: '这个账号现在用不了 Claude，扑通暂时回不了话。',
    session_expired: '登录过期了，重新登录 claude.ai 后再来找扑通。',
    rate_limited: '说得太快啦，扑通的信号被限流了。歇一会儿再发。',
    refused: '这句话扑通接不住，换个说法试试？',
    prompt_too_large: '这次要读的东西太多了，扑通一下子读不完。',
    empty_completion: '扑通张了张嘴，什么也没说出来。再发一次试试？',
    invalid_json: '扑通写到一半把本子弄乱了，再试一次吧。',
    access_code: '这个站点需要访问码，去「实验室 → 设置」里填一下。',
    no_provider: '还没有连接模型，扑通现在只能听、不能说。去「实验室 → 设置」里连一个。',
    capability_disabled: '这个页面现在用不了 Claude。',
  };
  return map[c] || '信号断了一下。再发一次试试？';
}

/* 敲门：服务端设了访问码时，在开场之前先请 TA 敲一下（别等自我介绍发出去才失败） */
const Knock = {
  pending: null,
  run() {
    if (this.pending) return this.pending;
    this.pending = new Promise((resolve) => {
      const el = $('#knock'); if (!el) { resolve(false); return; }
      el.hidden = false;
      const input = $('#knockCode'), err = $('#knockErr');
      err.hidden = true; input.value = lsGet(CODE_KEY) || '';
      setTimeout(() => input.focus(), 60);
      const go = async () => {
        const code = input.value.trim();
        if (!code) { err.textContent = '先把访问码告诉我～'; err.hidden = false; return; }
        const btn = $('#knockGo'); btn.disabled = true; btn.textContent = '试试看…';
        let ok = false, netFail = false;
        try {
          const r = await fetch('/api/health?code=' + encodeURIComponent(code), { cache: 'no-store' });
          const j = await r.json();
          ok = !!(j && j.codeOk);
        } catch { netFail = true; }
        btn.disabled = false; btn.textContent = '轻轻敲一下';
        if (ok) {
          lsSet(CODE_KEY, code);
          el.hidden = true;
          this.pending = null;
          toast('门开了，扑通进来了～');
          resolve(true);
          return;
        }
        err.textContent = netFail ? '信号断了一下，再试试' : '这个码不对，TA 还在门里等。再试试？';
        err.hidden = false;
      };
      $('#knockGo').addEventListener('click', go);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    });
    return this.pending;
  },
};

/* ---------------- 4. 记忆 ---------------- */
const STOP = new Set(['我们', '你们', '他们', '什么', '一个', '这个', '那个', '就是', '没有', '可以', '怎么', '因为', '所以', '但是', '然后', '还是', '已经', '自己', '现在', '知道', '觉得', '真的', '有点', '一下', '不是', '这样', '那样', '的话', '一点', '我的', '你的', '了吗', '吗我', '我也', '也是']);
function tokens(s) {
  const out = new Set(); s = String(s || '').toLowerCase();
  (s.match(/[a-z0-9]{2,}/g) || []).forEach((w) => out.add(w));
  for (const seg of s.match(/[一-鿿]+/g) || []) {
    if (seg.length === 1) { out.add(seg); continue; }
    for (let i = 0; i < seg.length - 1; i++) { const bg = seg.slice(i, i + 2); if (!STOP.has(bg)) out.add(bg); }
  }
  return out;
}
const TK = new Map();
function tk(text) { let t = TK.get(text); if (!t) { t = tokens(text); if (TK.size > 3000) TK.clear(); TK.set(text, t); } return t; }
function overlap(a, b) { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / Math.sqrt(a.size * b.size); }
function nextId(st, p) { st.meta.seq[p] = (st.meta.seq[p] || 0) + 1; return p + st.meta.seq[p]; }
const validDate = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(keyDayNum(s)) ? s : null);

/* 召回：相关度 × 重要度 × 新近度（无需向量库，中文二元组足够撑起 demo） */
function retrieve(st, userText, t) {
  const recent = st.chat.filter((m) => m.role === 'user').slice(-3).map((m) => m.text).join(' ');
  const q = tk(userText + ' ' + recent);
  const score = (m) => {
    const rel = overlap(q, tk(m.text)); const age = Math.max(0, (t - (m.at || t)) / 864e5);
    return { m, rel, s: 0.55 * rel + 0.25 * (m.imp || 5) / 10 + 0.2 * Math.exp(-age / 10) };
  };
  const evs = st.memories.filter((m) => m.type === 'event').map(score).sort((a, b) => b.s - a.s);
  const events = evs.filter((x) => x.rel > 0.05 || x.s > 0.33).slice(0, 6);
  for (const x of evs) if (events.length < 7 && !events.includes(x) && (x.m.imp || 0) >= 7 && t - x.m.at < 3 * 864e5) events.push(x);
  const selfs = st.memories.filter((m) => m.type === 'self').map(score).sort((a, b) => b.s - a.s).slice(0, 4);
  return {
    events: events.map((x) => x.m), selfs: selfs.map((x) => x.m),
    scored: events.concat(selfs).map((x) => ({ id: x.m.id, text: x.m.text, rel: +x.rel.toFixed(2), s: +x.s.toFixed(2) })),
  };
}

function applyMemOps(st, ops, t) {
  const added = [];
  const dup = (type, text) => st.memories.some((m) => m.type === type && (m.text === text || overlap(tk(m.text), tk(text)) > 0.78));
  for (const op of (Array.isArray(ops) ? ops : []).slice(0, 8)) {
    if (!op || typeof op !== 'object') continue;
    const kind = String(op.op || '').toLowerCase();
    if (kind === 'fact') {
      const key = str(op.key, 8), value = str(op.value, 60);
      if (!key || !value) continue;
      const prev = st.facts[key] && st.facts[key].value;
      st.facts[key] = { value, at: t };
      if (prev !== value) added.push(`知道了 · ${key}：${value}`);
    } else if (kind === 'event' || kind === 'bond' || kind === 'self') {
      const text = str(op.text, 90); if (!text || dup(kind, text)) continue;
      const m = { id: nextId(st, kind === 'event' ? 'm' : kind === 'bond' ? 'b' : 's'), type: kind, text, imp: clamp(Math.round(num(op.imp, kind === 'event' ? 5 : 7)), 1, 10), emo: str(op.emo, 6), at: t, uses: 0 };
      st.memories.push(m);
      added.push((kind === 'event' ? '记住了 · ' : kind === 'bond' ? '我们之间 · ' : '扑通自己 · ') + text);
    } else if (kind === 'followup') {
      const text = str(op.text, 60); if (!text) continue;
      if (st.followups.some((f) => f.status === 'open' && overlap(tk(f.text), tk(text)) > 0.6)) continue;
      const f = { id: nextId(st, 'f'), text, ask: str(op.ask, 40), due: validDate(op.due) || dayKey(t + 864e5), at: t, status: 'open' };
      st.followups.push(f);
      added.push(`挂念 · ${text}（${dueLabel(f.due, dayKey(t))}）`);
    } else if (kind === 'resolve') {
      const f = st.followups.find((x) => x.id === str(op.id, 8) && x.status === 'open');
      if (f) { f.status = 'done'; f.doneAt = t; addPoints(2, t, true); added.push(`解开挂念 · ${f.text}`); }
    }
  }
  prune(st, t);
  return added;
}
function prune(st, t) {
  const ev = st.memories.filter((m) => m.type === 'event');
  if (ev.length > 160) {
    const keep = new Set(ev.map((m) => ({ m, s: (m.imp || 5) / 10 + Math.exp(-(t - m.at) / (30 * 864e5)) + (m.uses || 0) * 0.05 }))
      .sort((a, b) => b.s - a.s).slice(0, 160).map((x) => x.m));
    st.memories = st.memories.filter((m) => m.type !== 'event' || keep.has(m));
  }
  for (const type of ['bond', 'self']) {
    const arr = st.memories.filter((m) => m.type === type);
    if (arr.length > 40) { const drop = new Set(arr.slice(0, arr.length - 40)); st.memories = st.memories.filter((m) => !drop.has(m)); }
  }
  const done = st.followups.filter((f) => f.status !== 'open');
  if (done.length > 30) { const drop = new Set(done.slice(0, done.length - 30)); st.followups = st.followups.filter((f) => !drop.has(f)); }
}

/* ---------------- 5. 上下文组装 ---------------- */
const soulText = (st) => (st.settings.soul && st.settings.soul.trim()) || DEFAULT_SOUL;
function soulVersion(st) {
  const s = st.settings.soul && st.settings.soul.trim();
  return s && s !== DEFAULT_SOUL.trim() ? 'custom-' + hash(s).toString(36).slice(0, 5) : PROMPT_VERSION;
}
const buildSystem = (st) => [soulText(st), BOUNDARIES, MEMORY_RULES, FORMAT, EXAMPLES].join('\n\n');
function levelOf(points) { let L = LEVELS[0]; for (const x of LEVELS) if (points >= x.min) L = x; return L; }
function todaysLittleDay(st, t) { return LITTLE_DAYS[(dayNum(t) * 7 + hash(String(st.meta.createdAt))) % LITTLE_DAYS.length]; }
function transcriptLines(chat, n = 16) {
  const items = chat.filter((m) => m.role === 'user' || m.role === 'putong').slice(-n);
  return items.map((m, i) => `${m.role === 'user' ? (i === items.length - 1 ? 'TA（刚刚）' : 'TA') : '扑通'}：${str(m.text, 160)}`).join('\n');
}
function buildContext(st, userText, t, { retrieved } = {}) {
  const d = new Date(t), h = d.getHours(), today = dayKey(t);
  const out = [];
  const daysKnown = Math.max(1, dayNum(t) - dayNum(st.meta.createdAt) + 1);
  const prev = st.meta.prevUserAt; const gap = prev ? (t - prev) / 36e5 : null;
  out.push(`【此刻】${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]} ${fmtTime(t)}（${period(h)}）。你们认识的第 ${daysKnown} 天${gap == null ? '，这是 TA 第一次和你说话' : gap < 0.5 ? '，正在聊天中' : `，TA 上一次和你说话是 ${fmtGap(gap)}`}。`);
  const a = st.alien, L = levelOf(a.points);
  const energy = h < 6 ? '有点困（外星人也要充电），但 TA 在，你就醒着陪。语气再轻一点，别问太多，聊两句就温柔地点 TA 去睡' : h >= 23 ? '开始犯困了，话变少，语气更轻' : '精神不错';
  out.push(`【你的状态】心情：${a.mood}；精力：${energy}；心核：Lv${L.lv}「${L.name}」。`);
  out.push(`【关系阶段】${L.stage}`);
  out.push(`【你今天的小事】${todaysLittleDay(st, t)}（想分享时再说，别硬塞）`);
  const facts = Object.entries(st.facts);
  out.push('【关于TA】\n' + (facts.length ? facts.map(([k, v]) => `- ${k}：${v.value}`).join('\n') : '- （还什么都不知道）') + (st.facts['称呼'] ? '' : '\n（还不知道怎么称呼 TA，找机会自然地问）'));
  const bonds = st.memories.filter((m) => m.type === 'bond').slice(-6);
  if (bonds.length) out.push('【我们之间】\n' + bonds.map((m) => `- ${m.id}：${m.text}`).join('\n'));
  const open = st.followups.filter((f) => f.status === 'open').sort((x, y) => String(x.due).localeCompare(String(y.due))).slice(0, 5);
  if (open.length) {
    out.push('【挂念的事】\n' + open.map((f) => {
      let tag;
      if (!f.due || f.due <= today) tag = f.askedOn === today ? '今天该问，你开场已经问过了，等 TA 回答' : f.due && f.due < today ? `已经过了 ${keyDayNum(today) - keyDayNum(f.due)} 天，今天该问` : '今天该问';
      else tag = `还没到时候，${f.due} 再问`;
      return `- ${f.id}：${f.text}（${tag}）${f.ask ? ` → 可以问："${f.ask}"` : ''}`;
    }).join('\n'));
  }
  const r = retrieved || retrieve(st, userText, t);
  if (r.events.length) out.push('【发生过的事】（按和现在的相关度挑选）\n' + r.events.map((m) => `- ${m.id}（${fmtMD(m.at)}${m.emo ? '，' + m.emo : ''}，重要度 ${m.imp}）：${m.text}`).join('\n'));
  if (r.selfs.length) out.push('【我说过的关于自己的事】\n' + r.selfs.map((m) => `- ${m.id}：${m.text}`).join('\n'));
  if (a.pendingChapter) { const ch = CHAPTERS.find((c) => c.lv === a.pendingChapter); if (ch && ch.hint) out.push(`【剧情】${ch.hint}讲了就把 story 写 true。`); }
  const dq = st.meta.dq && st.meta.dq[today]; if (dq) out.push(`【今日问题】你今天问过 TA："${dq.text}"`);
  out.push('【最近的对话】\n' + transcriptLines(st.chat));
  out.push('现在，按【输出格式】回复 TA 刚刚说的话。');
  return out.join('\n\n');
}

/* ---------------- 6. 输出解析（流式友好） ---------------- */
function tagBody(t, tag, allowOpen) {
  const open = t.indexOf(`<${tag}>`); if (open < 0) return null;
  const start = open + tag.length + 2; const close = t.indexOf(`</${tag}>`, start);
  if (close < 0) return allowOpen ? t.slice(start) : null;
  return t.slice(start, close);
}
const cleanSay = (s) => String(s).replace(/\*\*/g, '').replace(/^\s*[-*•]\s*/gm, '').replace(/[ \t]+\n/g, '\n').trim().slice(0, 220);
function normFeel(f) {
  if (!f || typeof f !== 'object') f = {};
  const strat = Array.isArray(f.strategy) ? f.strategy : typeof f.strategy === 'string' ? f.strategy.split(/[+＋,，、/]/) : [];
  return {
    mood: MOODS[f.mood] ? f.mood : null,
    valence: clamp(num(f.valence, 0.2), -1, 1),
    arousal: clamp(num(f.arousal, 0.4), 0, 1),
    act: ACTS.includes(f.act) ? f.act : 'none',
    user_emotion: str(f.user_emotion, 8),
    user_valence: clamp(num(f.user_valence, 0), -1, 1),
    strategy: strat.map((x) => str(x, 8)).filter(Boolean).slice(0, 3),
    hints: Array.isArray(f.hints) ? f.hints.map((x) => str(x, 12)).filter((x) => x.length >= 2 && x.length <= 10).slice(0, 3) : [],
    bond: clamp(Math.round(num(f.bond, 0)), 0, 3),
    used: Array.isArray(f.used) ? f.used.map((x) => str(x, 6)).filter(Boolean).slice(0, 6) : [],
    story: f.story === true || f.story === 'true',
  };
}
function parseOutput(raw, final) {
  const t = String(raw || '').replace(/```[a-zA-Z]*\n?/g, '');
  const inner = (tagBody(t, 'inner', true) || '').trim();
  const feelRaw = tagBody(t, 'feel', false);
  const fj = feelRaw != null ? tolerantJSON(feelRaw) : null;
  const feel = fj && typeof fj === 'object' ? normFeel(fj) : null;
  const says = []; const re = /<say>([\s\S]*?)<\/say>/g; let m;
  while ((m = re.exec(t))) { const s = cleanSay(m[1]); if (s) says.push(s); }
  const memRaw = tagBody(t, 'mem', false); const mv = memRaw != null ? tolerantJSON(memRaw) : null;
  const mem = Array.isArray(mv) ? mv : mv && typeof mv === 'object' ? [mv] : [];
  let fallback = false;
  if (final && !says.length) {
    const rest = t.replace(/<inner>[\s\S]*?(<\/inner>|$)/g, '').replace(/<feel>[\s\S]*?(<\/feel>|$)/g, '').replace(/<mem>[\s\S]*?(<\/mem>|$)/g, '').replace(/<\/?[a-z]+>/gi, '').trim();
    rest.split(/\n+/).map(cleanSay).filter(Boolean).slice(0, 3).forEach((s) => says.push(s));
    fallback = says.length > 0;
  }
  return { inner, feel, says: says.slice(0, 4), mem, ok: !!feel && says.length > 0 && !fallback, fallback, feelSeen: feelRaw != null };
}

/* ---------------- 7. 形象（身体层） ---------------- */
const EL = { x: 82, y: 104 }, ER = { x: 118, y: 104 };
const INK = 'style="fill:var(--alien-ink)"';
const STROKE = (w) => `fill="none" stroke-width="${w}" stroke-linecap="round" style="stroke:var(--alien-ink)"`;
function brow(c, side) { const { x, y } = c; return side < 0 ? `<path d="M${x - 7} ${y - 13} L${x + 6} ${y - 17}" ${STROKE(2.4)}/>` : `<path d="M${x - 6} ${y - 17} L${x + 7} ${y - 13}" ${STROKE(2.4)}/>`; }
const tear = (c) => `<path d="M${c.x + 4} ${c.y + 8} q-3.2 5 0 7.6 q3.2 -2.6 0 -7.6z" style="fill:var(--tear)"/>`;
function eyeSVG(kind, c, side) {
  const { x, y } = c;
  switch (kind) {
    case 'happy': return `<path d="M${x - 8} ${y + 3} Q${x} ${y - 7} ${x + 8} ${y + 3}" ${STROKE(3.4)}/>`;
    case 'moved': return `<path d="M${x - 8} ${y + 3} Q${x} ${y - 7} ${x + 8} ${y + 3}" ${STROKE(3.4)}/>` + tear(c);
    case 'sleepy': return `<path d="M${x - 7} ${y + 1} Q${x} ${y + 6} ${x + 7} ${y + 1}" ${STROKE(3)}/>`;
    case 'wink': return side < 0 ? `<path d="M${x - 8} ${y + 3} Q${x} ${y - 7} ${x + 8} ${y + 3}" ${STROKE(3.4)}/>` : eyeSVG('normal', c, side);
    case 'big': return `<ellipse cx="${x}" cy="${y}" rx="9" ry="11.5" ${INK}/><circle cx="${x + 3}" cy="${y - 4.5}" r="3.2" fill="#fff"/><circle cx="${x - 3}" cy="${y + 4}" r="1.4" fill="#fff"/>`;
    case 'sparkle': return `<ellipse cx="${x}" cy="${y}" rx="8.6" ry="11" ${INK}/><path d="M${x + 3} ${y - 9} l1.5 3.2 3.2 1.5 -3.2 1.5 -1.5 3.2 -1.5 -3.2 -3.2 -1.5 3.2 -1.5z" fill="#fff"/><circle cx="${x - 3}" cy="${y + 4}" r="1.6" fill="#fff"/>`;
    case 'aside': return `<ellipse cx="${x + 3}" cy="${y + 1}" rx="7" ry="9.5" ${INK}/><circle cx="${x + 5.5}" cy="${y - 2.5}" r="2.4" fill="#fff"/>`;
    case 'worried': return `<ellipse cx="${x}" cy="${y + 1}" rx="7.2" ry="9.5" ${INK}/><circle cx="${x + 2.4}" cy="${y - 2.4}" r="2.4" fill="#fff"/>` + brow(c, side);
    case 'sad': return `<ellipse cx="${x}" cy="${y + 2}" rx="7" ry="8" ${INK}/><circle cx="${x + 2.2}" cy="${y - 0.6}" r="2.1" fill="#fff"/>` + brow(c, side);
    case 'teary': return `<ellipse cx="${x}" cy="${y + 1}" rx="7.5" ry="9.6" ${INK}/><circle cx="${x + 2.6}" cy="${y - 2.6}" r="2.6" fill="#fff"/><circle cx="${x - 2.4}" cy="${y + 3.6}" r="1.4" fill="#fff"/>` + tear(c);
    case 'soft': return `<path d="M${x - 7.5} ${y - 1} a7.5 8.5 0 0 0 15 0 z" ${INK}/>`;
    default: return `<ellipse cx="${x}" cy="${y}" rx="7.5" ry="10" ${INK}/><circle cx="${x + 2.6}" cy="${y - 3.6}" r="2.6" fill="#fff"/>`;
  }
}
function mouthSVG(kind) {
  switch (kind) {
    case 'smile': return `<path d="M91 123 Q100 132 109 123" ${STROKE(3)}/>`;
    case 'open': return `<path d="M90 121 Q100 137 110 121 Q100 125 90 121Z" ${INK}/><path d="M95 128.6 Q100 133 105 128.6 Q100 126.8 95 128.6Z" fill="#ff8ea1"/>`;
    case 'flat': return `<path d="M95 126 L105 126" ${STROKE(3)}/>`;
    case 'o': return `<ellipse cx="100" cy="126" rx="3.6" ry="4.4" ${INK}/>`;
    case 'small': return `<path d="M96 125 Q100 128.5 104 125" ${STROKE(2.8)}/>`;
    case 'wavy': return `<path d="M91 127 Q95.5 123 100 127 Q104.5 131 109 127" ${STROKE(2.8)}/>`;
    case 'frown': return `<path d="M93 129 Q100 122 107 129" ${STROKE(3)}/>`;
    case 'pout': return `<path d="M96 128 Q100 124.5 104 128" ${STROKE(2.8)}/>`;
    case 'cat': return `<path d="M91 124 Q95.5 129 100 124.5 Q104.5 129 109 124" ${STROKE(2.8)}/>`;
    default: return `<path d="M95 126 L105 126" ${STROKE(3)}/>`;
  }
}

const Avatar = {
  svg: null, mood: '平静', fxTimer: 0, actTimer: 0, mode: '', pokeTimes: [], pokeRestore: 0,
  init() {
    const svg = $('#alien'); this.svg = svg;
    const dish = (cx, rot) => `<g transform="rotate(${rot} ${cx} 42)"><ellipse cx="${cx}" cy="42" rx="15" ry="9.5" fill="url(#pgDish)" stroke-width="1.5" style="stroke:var(--mood-deep)"/><ellipse cx="${cx}" cy="40.6" rx="9" ry="4.8" opacity=".55" style="fill:var(--mood-deep)"/><circle cx="${cx}" cy="40" r="2.3" fill="#fff" opacity=".9"/></g>`;
    svg.innerHTML = `
      <defs>
        <radialGradient id="pgBody" cx="38%" cy="30%" r="78%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity=".95"/>
          <stop offset="42%" style="stop-color:var(--mood)"/>
          <stop offset="100%" style="stop-color:var(--mood-deep)"/>
        </radialGradient>
        <radialGradient id="pgDish" cx="50%" cy="35%" r="75%"><stop offset="0%" stop-color="#ffffff" stop-opacity=".8"/><stop offset="60%" style="stop-color:var(--mood)"/><stop offset="100%" style="stop-color:var(--mood-deep)"/></radialGradient>
        <radialGradient id="pgGlow"><stop offset="0%" stop-color="#ff7d93" stop-opacity=".8"/><stop offset="100%" stop-color="#ff7d93" stop-opacity="0"/></radialGradient>
        <radialGradient id="pgCore" cx="40%" cy="35%" r="70%"><stop offset="0%" stop-color="#ffe6eb"/><stop offset="55%" stop-color="#ff6b84"/><stop offset="100%" stop-color="#df3c5b"/></radialGradient>
      </defs>
      <ellipse class="shadow" cx="100" cy="186" rx="44" ry="6" fill="rgba(20,24,50,.2)"/>
      <g class="float">
        <g class="body-g">
          <g class="ear ear-l"><path d="M68 76 Q60 60 52 51" fill="none" stroke-width="4" stroke-linecap="round" style="stroke:var(--mood-deep)"/>${dish(46, -32)}</g>
          <g class="ear ear-r"><path d="M132 76 Q140 60 148 51" fill="none" stroke-width="4" stroke-linecap="round" style="stroke:var(--mood-deep)"/>${dish(154, 32)}</g>
          <ellipse cx="38" cy="132" rx="8" ry="13" transform="rotate(26 38 132)" style="fill:var(--mood-deep)"/>
          <g class="arm-r"><ellipse cx="162" cy="132" rx="8" ry="13" transform="rotate(-26 162 132)" style="fill:var(--mood-deep)"/></g>
          <path class="body" d="M100 60 C135 60 160 85 161 117 C162 151 138 173 100 173 C62 173 38 151 39 117 C40 85 65 60 100 60 Z" fill="url(#pgBody)" stroke-width="1.6" style="stroke:var(--mood-deep)"/>
          <g class="core-g"><circle cx="100" cy="151" r="22" fill="url(#pgGlow)"/><circle class="core" cx="100" cy="151" r="7.5" fill="url(#pgCore)"/></g>
          <g class="pulses"><circle class="pulse p1" cx="100" cy="151" r="20" fill="none" stroke="#ff8fa3" stroke-width="2"/><circle class="pulse p2" cx="100" cy="151" r="20" fill="none" stroke="#ff8fa3" stroke-width="2"/></g>
          <ellipse cx="74" cy="80" rx="15" ry="7.5" transform="rotate(-28 74 80)" fill="#fff" opacity=".55"/>
          <ellipse class="blush" cx="71" cy="118" rx="8.5" ry="4.6" fill="#ff7f9a" opacity=".2"/>
          <ellipse class="blush" cx="129" cy="118" rx="8.5" ry="4.6" fill="#ff7f9a" opacity=".2"/>
          <g class="eyes"><g class="eye-l"></g><g class="eye-r"></g></g>
          <g class="mouth"></g>
        </g>
      </g>
      <g class="fx">
        <g class="fx-sparkle"><path d="M34 62 l2.2 5 5 2.2 -5 2.2 -2.2 5 -2.2 -5 -5 -2.2 5 -2.2z" fill="#fff4c4"/><path d="M166 70 l1.6 3.6 3.6 1.6 -3.6 1.6 -1.6 3.6 -1.6 -3.6 -3.6 -1.6 3.6 -1.6z" fill="#fff4c4"/><path d="M150 30 l1.8 4 4 1.8 -4 1.8 -1.8 4 -1.8 -4 -4 -1.8 4 -1.8z" fill="#fff4c4"/></g>
        <text class="fx-question" x="100" y="50" text-anchor="middle" font-size="26" style="fill:var(--alien-ink);font-family:var(--font-display)">?</text>
        <path class="fx-sweat" d="M152 78 q-6 9 0 13 q6 -4 0 -13z" fill="#9fdcff"/>
        <g class="fx-zzz" style="fill:var(--alien-ink);font-family:var(--font-display)"><text x="150" y="62" font-size="16">z</text><text x="162" y="46" font-size="21">Z</text></g>
      </g>`;
    this.scheduleBlink();
    if (!REDUCED) window.addEventListener('pointermove', (e) => this.follow(e), { passive: true });
  },
  setMood(m) {
    const M = MOODS[m] || MOODS['平静']; this.mood = MOODS[m] ? m : '平静';
    const root = document.documentElement;
    root.style.setProperty('--mood', M.color); root.style.setProperty('--mood-deep', shade(M.color, -0.24));
    /* 心情低的时候，窗台的光也跟着暗下来一点 */
    const stage = $('#stage');
    if (stage) stage.classList.toggle('dim', ['难过', '委屈', '担心', '困'].includes(this.mood));
    const svg = this.svg; if (!svg) return;
    svg.querySelector('.eye-l').innerHTML = eyeSVG(M.eyes, EL, -1);
    svg.querySelector('.eye-r').innerHTML = eyeSVG(M.eyes, ER, 1);
    svg.querySelector('.mouth').innerHTML = mouthSVG(M.mouth);
    svg.querySelectorAll('.blush').forEach((b) => b.setAttribute('opacity', String(M.blush)));
    svg.classList.remove('ears-up', 'ears-rest', 'ears-droop', 'ears-tilt', 'ears-back', 'fx-sparkle', 'fx-question', 'fx-sweat', 'fx-zzz');
    svg.classList.add('ears-' + M.ears);
    if (M.fx) svg.classList.add('fx-' + M.fx);
    clearTimeout(this.fxTimer);
    if (M.fx === 'sparkle' || M.fx === 'question') this.fxTimer = setTimeout(() => svg.classList.remove('fx-' + M.fx), 6000);
    const chip = $('#moodChip b'); if (chip) chip.textContent = this.mood;
  },
  setArousal(a) { document.documentElement.style.setProperty('--bpm', String(Math.round(58 + clamp(a, 0, 1) * 72))); },
  setLevel(lv) { if (this.svg) this.svg.style.setProperty('--core-s', String(0.78 + lv * 0.11)); },
  act(name) {
    if (!name || name === 'none' || !this.svg || REDUCED) return;
    const svg = this.svg; const cls = 'act-' + name;
    svg.classList.remove(...ACTS.map((a) => 'act-' + a), 'act-squish');
    void svg.getBoundingClientRect();
    svg.classList.add(cls);
    if (name === 'glow') { svg.classList.add('fx-sparkle'); setTimeout(() => { if (!(MOODS[this.mood] || {}).fx) svg.classList.remove('fx-sparkle'); }, 2200); }
    clearTimeout(this.actTimer); this.actTimer = setTimeout(() => svg.classList.remove(cls), 1900);
  },
  listen(on) { if (!this.svg) return; this.svg.classList.toggle('listening', on); this.mode = on ? 'listen' : this.mode === 'listen' ? '' : this.mode; if (on) this.lookAt(1.2, 3); },
  hearting(on) { if (!this.svg) return; this.svg.classList.toggle('hearting', on); },
  think(on) { if (!this.svg) return; this.svg.classList.toggle('thinking', on); this.mode = on ? 'think' : this.mode === 'think' ? '' : this.mode; if (on) this.lookAt(0, -3); else this.lookAt(0, 0); },
  lookAt(x, y) { const e = this.svg && this.svg.querySelector('.eyes'); if (e) e.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`; },
  follow(e) {
    if (this.mode || !this.svg) return;
    const r = this.svg.getBoundingClientRect(); if (!r.width) return;
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * 0.52);
    const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 320);
    this.lookAt((dx / d) * 2.6 * k, (dy / d) * 2.2 * k);
  },
  scheduleBlink() {
    setTimeout(() => {
      const eyes = this.svg && this.svg.querySelector('.eyes');
      if (eyes && !REDUCED) { eyes.classList.add('blink'); setTimeout(() => eyes.classList.remove('blink'), 180); }
      this.scheduleBlink();
    }, 2200 + Math.random() * 3800);
  },
  poke() {
    this.act('squish');
    S.meta.pokes = (S.meta.pokes || 0) + 1; save('core');
    const t = Date.now(); this.pokeTimes = this.pokeTimes.filter((x) => t - x < 6000); this.pokeTimes.push(t);
    let line = POKE_LINES[(S.meta.pokes - 1) % POKE_LINES.length];
    if (this.pokeTimes.length >= 5) { line = '好啦好啦，你是不是有话想跟我说？'; this.pokeTimes = []; }
    const b = $('#pokeBubble'); b.textContent = line; b.hidden = false; b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    clearTimeout(this.pokeHide); this.pokeHide = setTimeout(() => { b.hidden = true; }, 1900);
    this.setMood(this.pokeTimes.length > 2 ? '调皮' : '害羞');
    clearTimeout(this.pokeRestore); this.pokeRestore = setTimeout(() => this.setMood(S.alien.mood), 2600);
  },
};

/* ---------------- 7.5 声音层（WebAudio 合成：心跳、扑通收藏的声音） ---------------- */
const AudioKit = {
  ctx: null,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { this.ctx = new AC(); } catch { return null; }
    }
    if (this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch { /* ignore */ } }
    return this.ctx;
  },
  /* 一下心跳（lub-dub）：低频正弦 + 低通，音量包络 */
  thump(t, f, g) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), ga = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 180;
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, f * 0.55), t + 0.14);
    ga.gain.setValueAtTime(0.0001, t);
    ga.gain.exponentialRampToValueAtTime(g, t + 0.02);
    ga.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    o.connect(ga); ga.connect(lp); lp.connect(ctx.destination);
    o.start(t); o.stop(t + 0.22);
  },
  beat() {
    const ctx = this.ensure(); if (!ctx) return;
    const t0 = ctx.currentTime + 0.03;
    this.thump(t0, 62, 0.5);
    this.thump(t0 + 0.19, 46, 0.3);
  },
  /* 一小段噪声（雨点/海浪的原料） */
  noise(t, dur, freq, g, q) {
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q || 1;
    const ga = ctx.createGain();
    ga.gain.setValueAtTime(0.0001, t);
    ga.gain.exponentialRampToValueAtTime(g, t + dur * 0.3);
    ga.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(ga); ga.connect(ctx.destination);
    src.start(t); src.stop(t + dur + 0.05);
  },
  ping(t, f, g, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), ga = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    ga.gain.setValueAtTime(0.0001, t);
    ga.gain.exponentialRampToValueAtTime(g, t + 0.015);
    ga.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.9));
    o.connect(ga); ga.connect(ctx.destination);
    o.start(t); o.stop(t + (dur || 0.9) + 0.05);
  },
};
const Heart = {
  on: false, timer: 0, getBpm: () => 72,
  start(getBpm) {
    if (!AudioKit.ensure()) return false;
    this.on = true; this.getBpm = getBpm || this.getBpm;
    const loop = () => {
      if (!this.on) return;
      AudioKit.beat();
      const bpm = clamp(num(this.getBpm(), 72), 48, 140);
      this.timer = setTimeout(loop, Math.round(60000 / bpm));
    };
    loop(); return true;
  },
  stop() { this.on = false; clearTimeout(this.timer); },
};
/* 语音输入：按住说话（Web Speech API，不支持时按钮隐藏） */
const Mic = {
  rec: null, on: false,
  get supported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
  start() {
    if (!this.supported) return false;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    try {
      const r = new SR();
      r.lang = 'zh-CN'; r.interimResults = true; r.continuous = true;
      const base = $('#input').value;
      r.onresult = (e) => {
        let t = '';
        for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        const joiner = base && !/[，。？！,.?!～\s]$/.test(base) ? '，' : '';
        $('#input').value = base + joiner + t;
        autoGrow();
      };
      r.onerror = (e) => { if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) toast('麦克风被拦住了，去浏览器设置里允许这个页面用麦克风'); };
      r.onend = () => { if (this.on) { try { r.start(); } catch { /* ignore */ } } };
      r.start(); this.rec = r; this.on = true;
      return true;
    } catch { return false; }
  },
  stop() {
    this.on = false;
    if (this.rec) { try { this.rec.stop(); } catch { /* ignore */ } }
    this.rec = null;
  },
};
/* 扑通收藏的声音：点开礼物时合成一小段 */
const SoundFx = {
  play(id) {
    const ctx = AudioKit.ensure(); if (!ctx) return false;
    const t0 = ctx.currentTime + 0.05;
    if (id === 'rain') { for (let i = 0; i < 16; i++) AudioKit.noise(t0 + i * 0.14 + Math.random() * 0.05, 0.1, 1400 + Math.random() * 1800, 0.12, 2); AudioKit.noise(t0, 2.4, 500, 0.05, 0.7); }
    else if (id === 'chime') { const f = [880, 1108, 1318, 1760]; f.forEach((x, i) => { AudioKit.ping(t0 + i * 0.28 + Math.random() * 0.04, x, 0.16, 1.2); AudioKit.ping(t0 + i * 0.28 + Math.random() * 0.04, x * 2.01, 0.05, 0.8); }); }
    else if (id === 'wave') { AudioKit.noise(t0, 1.8, 420, 0.16, 0.6); AudioKit.noise(t0 + 1.9, 1.8, 380, 0.13, 0.6); AudioKit.noise(t0 + 3.8, 2.0, 460, 0.1, 0.6); }
    else if (id === 'cricket') { for (let i = 0; i < 6; i++) { const tb = t0 + i * 0.42; for (let k = 0; k < 3; k++) AudioKit.ping(tb + k * 0.055, 4600 + Math.random() * 300, 0.05, 0.05); } }
    else AudioKit.beat();
    return true;
  },
};

/* ---------------- 8. 舞台与状态栏 ---------------- */
function todClass(h) {
  if (h >= 5 && h < 7) return 'dawn'; if (h >= 7 && h < 11) return 'morning'; if (h >= 11 && h < 15) return 'noon';
  if (h >= 15 && h < 17) return 'afternoon'; if (h >= 17 && h < 19) return 'sunset'; if (h >= 19 && h < 22) return 'evening'; return 'night';
}
function updateStage() {
  const d = new Date(nowMs());
  $('#stage').className = 'stage tod-' + todClass(d.getHours());
  const tm = $('#stageTime');
  if (TIME_OFFSET) { tm.hidden = false; tm.textContent = `模拟时间 ${d.getMonth() + 1}/${d.getDate()} ${fmtTime(+d)}`; } else tm.hidden = true;
}
function buildStars() {
  let h = '';
  for (let i = 0; i < 28; i++) {
    const x = (hash('x' + i) % 1000) / 10, y = (hash('y' + i) % 600) / 10;
    h += `<i style="left:${x}%;top:${y}%;animation-delay:${((i % 7) * 0.45).toFixed(2)}s${i % 5 === 0 ? ';width:3px;height:3px' : ''}"></i>`;
  }
  $('#stars').innerHTML = h;
}
function renderStatus() {
  const a = S.alien, L = levelOf(a.points), next = LEVELS.find((x) => x.min > a.points);
  $('#lvName').textContent = `Lv${L.lv} ${L.name}`;
  const pct = next ? ((a.points - L.min) / (next.min - L.min)) * 100 : 100;
  $('#lvBar').style.width = pct.toFixed(1) + '%';
  $('#lvBarWrap').setAttribute('aria-valuenow', String(Math.round(pct)));
  $('#lvPts').textContent = next ? `${a.points} / ${next.min}` : `${a.points} · 满级`;
  Avatar.setLevel(L.lv);
  const chip = $('#moodChip b'); if (chip) chip.textContent = Avatar.mood;
}
function renderConn() {
  const el = $('#connLine');
  if (LLM.kind === 'none') el.textContent = '还没连接模型 · 去「实验室 → 设置」';
  else el.textContent = LLM.label + (LLM.kind === 'claude' ? ` · ${TIER_LABEL[S.settings.tier] || '快速'}` : '');
}
function renderToggles() {
  $('#innerToggle').setAttribute('aria-pressed', String(!!S.settings.inner));
  $('#ttsToggle').setAttribute('aria-pressed', String(!!S.settings.tts));
}

/* ---------------- 9. 聊天界面 ---------------- */
let lastShown = null;
function scrollLog(force) {
  const log = $('#log'); if (!log) return;
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 180;
  if (force || near) log.scrollTop = log.scrollHeight;
}
function tagEl(text, color) {
  const s = document.createElement('span'); s.className = 'tag';
  if (color) { const i = document.createElement('i'); i.className = 'sw'; i.style.background = color; s.appendChild(i); }
  s.appendChild(document.createTextNode(text)); return s;
}
function renderMeta(m) {
  const showInner = !!S.settings.inner; const added = m.added || [];
  if (!showInner && !added.length) return null;
  const wrap = document.createElement('div'); wrap.className = 'meta-row';
  if (showInner && (m.inner || m.feel)) {
    const box = document.createElement('div'); box.className = 'inner';
    const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = '心声'; box.appendChild(lbl);
    box.appendChild(document.createTextNode(m.inner || '（这一轮没有写内心独白）'));
    const f = m.feel || {}; const tags = document.createElement('div'); tags.className = 'tags';
    if (f.mood) tags.appendChild(tagEl(`心情 → ${f.mood}`, (MOODS[f.mood] || {}).color));
    if (f.act && f.act !== 'none') tags.appendChild(tagEl(`动作：${ACT_CN[f.act] || f.act}`));
    (f.strategy || []).forEach((s) => tags.appendChild(tagEl(s)));
    if (f.user_emotion) tags.appendChild(tagEl(`TA：${f.user_emotion}`));
    if (f.bond) tags.appendChild(tagEl(`羁绊 +${f.bond}`));
    if (f.used && f.used.length) tags.appendChild(tagEl(`用上记忆 ${f.used.join(' ')}`));
    box.appendChild(tags); wrap.appendChild(box);
  }
  if (added.length) {
    const chips = document.createElement('div'); chips.className = 'memchips';
    added.slice(0, 3).forEach((a) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'memchip'; b.title = '去记忆里看看';
      b.innerHTML = ICON_NOTE + '<span></span>'; b.querySelector('span').textContent = a;
      b.addEventListener('click', () => switchTab('memory')); chips.appendChild(b);
    });
    if (added.length > 3) { const more = document.createElement('span'); more.className = 'tag'; more.textContent = `+${added.length - 3}`; chips.appendChild(more); }
    wrap.appendChild(chips);
  }
  return wrap;
}
function renderNote(m) {
  const el = document.createElement('div'); el.className = 'note ' + (m.kind || '');
  if (m.kind === 'levelup') {
    const s = document.createElement('strong'); s.textContent = m.text; el.appendChild(s);
    if (m.sub) el.appendChild(document.createTextNode(m.sub));
  } else if (m.kind === 'gift' && m.sound) {
    const g = SOUND_GIFTS.find((x) => x.id === m.sound) || { name: m.text, desc: '点开听一听' };
    const b = document.createElement('button'); b.type = 'button'; b.className = 'gift-btn';
    b.innerHTML = '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5 13 8 3 13.5Z" fill="currentColor"/></svg><span></span>';
    b.querySelector('span').textContent = '送你一个声音：' + g.name;
    b.addEventListener('click', () => { if (SoundFx.play(g.id)) toast(g.desc || '点开听一听'); });
    el.appendChild(b);
  } else el.textContent = m.text;
  return el;
}
function appendItem(m, animate = true) {
  const log = $('#log'); const frag = document.createDocumentFragment();
  if (m.role === 'user' || m.role === 'putong') {
    if (!lastShown || m.at - lastShown.at > 30 * 60e3) { const s = document.createElement('div'); s.className = 'stamp'; s.textContent = stampText(m.at); frag.appendChild(s); }
    const row = document.createElement('div'); row.className = 'msg ' + m.role;
    if (!animate) row.style.animation = 'none';
    if (m.role === 'putong') {
      const grouped = lastShown && lastShown.role === 'putong' && m.at - lastShown.at < 5 * 60e3;
      row.style.setProperty('--m', m.c || MOODS['平静'].color);
      row.innerHTML = `<span class="ava${grouped ? ' ghost' : ''}" aria-hidden="true"></span><div class="bubble"></div>`;
    } else row.innerHTML = '<div class="bubble"></div>';
    row.querySelector('.bubble').textContent = m.text;
    frag.appendChild(row); lastShown = m;
  } else if (m.role === 'note') frag.appendChild(renderNote(m));
  else if (m.role === 'meta') { const el = renderMeta(m); if (el) { if (!animate) el.style.animation = 'none'; frag.appendChild(el); } }
  const typing = $('#typing');
  if (typing) log.insertBefore(frag, typing); else log.appendChild(frag);
}
function renderChat() {
  const log = $('#log'); log.innerHTML = ''; lastShown = null;
  for (const m of S.chat) appendItem(m, false);
  if (!S.chat.length && !S.meta.onboarded) showTyping('type');
  requestAnimationFrame(() => { const l = $('#log'); l.style.scrollBehavior = 'auto'; l.scrollTop = l.scrollHeight; l.style.scrollBehavior = ''; });
}
function pushChat(m) {
  m.id = m.id || rid('c'); m.at = m.at || nowMs();
  S.chat.push(m);
  if (S.chat.length > 160) S.chat.splice(0, S.chat.length - 160);
  appendItem(m); scrollLog(true); save('chat');
  return m;
}
function showTyping(mode, live) {
  let el = $('#typing');
  if (!mode) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div'); el.id = 'typing'; el.className = 'typing';
    el.innerHTML = '<span class="ava" aria-hidden="true"></span><div class="bubble"><span class="dots"><i></i><i></i><i></i></span><span class="label"></span></div>';
    $('#log').appendChild(el);
  }
  el.style.setProperty('--m', (MOODS[Avatar.mood] || MOODS['平静']).color);
  const label = el.querySelector('.label');
  let lv = el.querySelector('.live');
  if (mode === 'think' && S.settings.inner && live) {
    label.textContent = '';
    if (!lv) { lv = document.createElement('span'); lv.className = 'live'; el.querySelector('.bubble').appendChild(lv); }
    lv.textContent = '在想：' + live.replace(/\s+/g, ' ').slice(-90);
  } else {
    if (lv) lv.remove();
    label.textContent = mode === 'think' ? '扑通在想…' : '';
  }
  scrollLog();
}
function showNoteError(text, actions = []) {
  const el = document.createElement('div'); el.className = 'note error'; el.textContent = text;
  if (actions.length) {
    const row = document.createElement('div'); row.className = 'note-actions';
    for (const [label, fn] of actions) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small'; b.textContent = label;
      b.addEventListener('click', () => { el.remove(); fn(); }); row.appendChild(b);
    }
    el.appendChild(row);
  }
  const typing = $('#typing'); const log = $('#log');
  if (typing) log.insertBefore(el, typing); else log.appendChild(el);
  scrollLog(true);
}
let busy = false, busyKind = '', ctl = null, lastFailed = null;
const queued = [];
function setBusy(b, kind = 'llm') {
  busy = b; busyKind = b ? kind : '';
  const llm = b && kind === 'llm';
  $('#sendBtn').hidden = llm; $('#stopBtn').hidden = !llm;
  $('#input').placeholder = llm ? '扑通在回你…（可以接着打字，它说完会看）' : '和扑通说点什么…';
  renderChips();
}
function postUser(text) {
  const t = nowMs();
  S.meta.prevUserAt = S.meta.lastUserAt || 0;
  pushChat({ role: 'user', text, at: t });
  S.meta.lastUserAt = t; S.meta.lastActiveAt = t;
  onUserMessageDay(t); checkLevel(t); renderStatus();
  save('core');
}
/* 扑通说话时用户接着发的消息先上屏，等它说完再合成一轮处理（像真人聊天那样连发几条） */
function sendOrQueue(text) {
  if (busy || greeting) { postUser(text); queued.push(text); return; }
  runTurn(text);
}
function flushQueue() {
  if (busy || greeting || !queued.length) return;
  const texts = queued.splice(0, queued.length);
  setTimeout(() => runTurn(texts.join('\n'), { preposted: true }), 120);
}
let lastFeel = null; // 最近一轮的情绪（一键回应 chips 用它）
function renderChips() {
  const box = $('#chips'); box.innerHTML = '';
  if (!S.meta.onboarded || busy) return;
  const add = (label, fn, hot, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = (cls || 'chip') + (hot ? ' hot' : ''); b.textContent = label; b.addEventListener('click', fn); box.appendChild(b); };
  const t = nowMs(), today = dayKey(t);
  if (lastFailed) add('重新发送', retryLast, true);
  if (!S.meta.dq[today]) add('今日地球问题', askDailyQuestion);
  /* 一键回应：模型给了 hints 就用它，没有时按场景兜底（深夜 / 说得少 / 情绪低） */
  if (!lastFailed && !$('#input').value.trim()) {
    let hints = lastFeel && lastFeel.hints && lastFeel.hints.length ? lastFeel.hints.slice() : [];
    if (!hints.length) {
      const lastUser = [...S.chat].reverse().find((m) => m.role === 'user');
      const h = new Date(t).getHours();
      const lowEnergy = (lastUser && str(lastUser.text, 20).length <= 6) || h >= 23 || h < 5 || (lastFeel && lastFeel.user_valence <= -0.5);
      if (lowEnergy) {
        const seed = dayNum(t) + (lastUser ? str(lastUser.text, 20).length : 0);
        hints = [HINT_FALLBACKS[seed % HINT_FALLBACKS.length], HINT_FALLBACKS[(seed + 1) % HINT_FALLBACKS.length], HINT_FALLBACKS[(seed + 3) % HINT_FALLBACKS.length]];
      }
    }
    hints.forEach((s) => add(s, () => { $('#input').value = ''; sendOrQueue(s); }, false, 'chip reply'));
  }
  const userToday = S.chat.filter((m) => m.role === 'user' && dayKey(m.at) === today).length;
  if (userToday >= 4 && !S.diary.some((d) => d.date === today)) add('让扑通写今天的日记', () => { switchTab('diary'); writeDiary(); }, true);
}
function speak(text) {
  if (!S.settings.tts || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(String(text).replace(/[～~（）()「」]/g, ' '));
    u.lang = 'zh-CN'; u.pitch = 1.7; u.rate = 1.06;
    const v = speechSynthesis.getVoices().find((x) => /zh[-_](CN|Hans)/i.test(x.lang)); if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch { /* speech unavailable */ }
}

/* ---------------- 10. 一轮对话 ---------------- */
const lastPrompts = new Map();
function dayRec(t) { const k = dayKey(t); if (!S.meta.days[k]) S.meta.days[k] = { turns: 0, pts: 0 }; return S.meta.days[k]; }
function addPoints(n, t, uncapped) {
  if (!n) return; const d = dayRec(t);
  const add = uncapped ? n : Math.max(0, Math.min(n, 24 - d.pts));
  if (!uncapped) d.pts += add;
  S.alien.points += add;
}
function checkLevel(t) {
  const a = S.alien; const L = levelOf(a.points);
  if (L.lv > a.level) {
    for (let lv = a.level + 1; lv <= L.lv; lv++) if (!a.chapters[lv]) a.chapters[lv] = 'unlocked';
    a.level = L.lv;
    const ch = CHAPTERS.find((c) => c.lv === L.lv);
    if (ch && a.chapters[L.lv] !== 'told') { a.pendingChapter = L.lv; a.pendingTurns = 0; }
    pushChat({ role: 'note', kind: 'levelup', text: `心核升级 · Lv${L.lv}「${L.name}」`, sub: ch ? `解锁剧情「${ch.title}」，扑通会找个合适的时机讲给你听。` : '', at: t + 2 });
    Avatar.act('glow'); setTimeout(() => Avatar.act('spin'), 1600);
    renderStatus(); markPanelsDirty();
  }
}
function onUserMessageDay(t) {
  const d = dayRec(t); d.turns += 1;
  if (d.turns === 1) addPoints(3, t, true);
  const dq = S.meta.dq[dayKey(t)];
  if (dq && !dq.answered) { dq.answered = true; addPoints(2, t, true); }
}
function previewFeel(f) {
  if (f.mood) Avatar.setMood(f.mood);
  Avatar.setArousal(f.arousal);
  Avatar.act(f.act);
}

async function runTurn(text, opts = {}) {
  if (busy) return;
  try { await runTurnInner(text, opts); } finally { flushQueue(); }
}
async function runTurnInner(text, opts) {
  const t = nowMs();
  if (!opts.retry && !opts.preposted) postUser(text);
  if (LLM.kind === 'none') { lastFailed = { text }; showNoteError(llmErrorText({ code: 'no_provider' }), [['去设置', () => openLab('settings')]]); renderChips(); return; }
  lastFailed = null;
  setBusy(true); Avatar.think(true); showTyping('think');
  const turnId = rid('t');
  const retrieved = retrieve(S, text, t);
  const system = buildSystem(S); const user = buildContext(S, text, t, { retrieved });
  lastPrompts.set(turnId, { system, user });
  if (lastPrompts.size > 4) lastPrompts.delete(lastPrompts.keys().next().value);
  ctl = new AbortController();
  const queue = []; let queueDone = false, shown = 0, feelApplied = false;
  const display = (async () => {
    let i = 0, first = true;
    for (;;) {
      if (i < queue.length) {
        const s = queue[i++];
        Avatar.think(false); showTyping('type');
        await sleep(clamp((first ? 180 : 450) + s.length * 32, 320, 1500)); first = false;
        showTyping(null);
        pushChat({ role: 'putong', text: s, turn: turnId, c: (MOODS[Avatar.mood] || MOODS['平静']).color });
        speak(s);
        if (i < queue.length || !queueDone) showTyping('type');
      } else if (queueDone) break;
      else await sleep(50);
    }
    showTyping(null);
  })();
  const t0 = performance.now(); let raw = '', res = null, err = null;
  try {
    res = await LLM.complete({
      system, user, signal: ctl.signal, tier: S.settings.tier,
      onText: (full) => {
        raw = full; const p = parseOutput(full, false);
        if (!feelApplied && p.feel) { feelApplied = true; previewFeel(p.feel); }
        if (!p.feelSeen && !p.says.length) showTyping('think', p.inner);
        while (shown < p.says.length) queue.push(p.says[shown++]);
      },
    });
    raw = res.text;
  } catch (e) { err = normErr(e); if (e && e.text) raw = e.text; }
  const p = parseOutput(raw, !err);
  if (!feelApplied && p.feel) previewFeel(p.feel);
  if (!err || (err.code === 'cancelled' && p.says.length)) while (shown < p.says.length) queue.push(p.says[shown++]);
  queueDone = true; await display;
  Avatar.think(false); ctl = null; setBusy(false);
  const spoke = shown > 0;
  if (err && !(err.code === 'cancelled' && spoke)) {
    if (err.code === 'cancelled') toast('已停下');
    else {
      lastFailed = { text };
      const acts = err.code === 'access_code' ? [['填访问码', () => Knock.run()]] : ['not_granted', 'sampling_disabled', 'session_expired'].includes(err.code) ? [] : [['重新发送', retryLast]];
      showNoteError(llmErrorText(err), acts);
    }
    Avatar.setMood(S.alien.mood); renderChips(); return;
  }
  if (!spoke) { lastFailed = { text }; showNoteError(llmErrorText({ code: 'empty_completion' }), [['重新发送', retryLast]]); Avatar.setMood(S.alien.mood); renderChips(); return; }
  applyTurn({ turnId, text, p, raw, retrieved, ms: performance.now() - t0, model: (res && res.model) || LLM.model, pchars: system.length + user.length, t });
  renderChips();
}
function retryLast() {
  if (!lastFailed || busy) return;
  const { text } = lastFailed; lastFailed = null;
  $$('#log .note.error').forEach((n) => n.remove());
  runTurn(text, { retry: true });
}
function applyTurn({ turnId, text, p, raw, retrieved, ms, model, pchars, t }) {
  const f = p.feel || normFeel({});
  const a = S.alien;
  if (f.mood) a.mood = f.mood;
  a.valence = clamp(a.valence * 0.35 + f.valence * 0.65, -1, 1);
  a.arousal = clamp(a.arousal * 0.35 + f.arousal * 0.65, 0, 1);
  a.at = t;
  const added = applyMemOps(S, p.mem, t);
  for (const id of f.used) { const m = S.memories.find((x) => x.id === id); if (m) { m.uses = (m.uses || 0) + 1; m.lastUsed = t; } }
  if (a.pendingChapter) {
    const ch = CHAPTERS.find((c) => c.lv === a.pendingChapter);
    if (f.story) { a.chapters[a.pendingChapter] = 'told'; if (ch) added.push(`剧情 · 「${ch.title}」讲给你听了`); a.pendingChapter = 0; }
    else if (++a.pendingTurns > 10) a.pendingChapter = 0;
  }
  addPoints(f.bond, t);
  lastFeel = f;
  /* TA 第一次真的难过：把下一章它的故事提前解锁——剧情长在你们共同经历的时刻上 */
  const flags = S.meta.flags = S.meta.flags || {};
  if (f.user_valence <= -0.65 && !flags.firstDeepSad) {
    flags.firstDeepSad = t;
    const early = CHAPTERS.find((c) => c.lv >= 2 && !a.chapters[c.lv]);
    if (early) {
      a.chapters[early.lv] = 'unlocked';
      if (!a.pendingChapter) { a.pendingChapter = early.lv; a.pendingTurns = 0; }
      pushChat({ role: 'note', kind: 'chapter-early', text: '扑通想起了它的外婆……它想找个时机，讲一个故事给你听。', at: nowMs() + 1 });
      markPanelsDirty();
    }
  }
  maybeGiftSound(t, f);
  guardRails(t);
  pushChat({ role: 'meta', turn: turnId, inner: p.inner.slice(0, 300), feel: f, added, at: nowMs() });
  S.turns.push({ id: turnId, at: t, ms: Math.round(ms), model, pchars, user: str(text, 300), inner: p.inner.slice(0, 400), feel: f, says: p.says, mem: p.mem.slice(0, 8), added, retrieved: retrieved.scored, ok: p.ok, raw: String(raw).slice(0, 1200) });
  if (S.turns.length > 20) S.turns.splice(0, S.turns.length - 20);
  S.lite.push({ at: t, uv: f.user_valence, pv: +a.valence.toFixed(2), st: f.strategy, used: f.used.length, q: p.says.some((s) => /[？?]/.test(s)), len: text.length, b: f.bond, ok: p.ok });
  if (S.lite.length > 400) S.lite.splice(0, S.lite.length - 400);
  S.meta.lastActiveAt = nowMs();
  checkLevel(t);
  Avatar.setMood(a.mood); Avatar.setArousal(a.arousal);
  renderStatus(); markPanelsDirty();
  save('core', 'mem', 'chat', 'lab');
}

/* 扑通的声音收藏：气氛到了就送一个（每天最多一个，间隔至少 1 小时） */
function maybeGiftSound(t, f) {
  const gifts = S.meta.gifts = S.meta.gifts || [];
  const todayN = gifts.filter((g) => g.at && dayKey(g.at) === dayKey(t)).length;
  if (todayN >= 1) return;
  if (gifts.length && t - (gifts[gifts.length - 1].at || 0) < 36e5) return;
  const trigger = (f.strategy || []).includes('幽默') || f.story === true || f.bond >= 2;
  if (!trigger) return;
  const usedIds = new Set(gifts.map((g) => g.id));
  const pool = SOUND_GIFTS.filter((s) => !usedIds.has(s.id));
  const list = pool.length ? pool : SOUND_GIFTS;
  const s = list[(dayNum(t) + gifts.length) % list.length];
  gifts.push({ id: s.id, at: t });
  if (gifts.length > 20) gifts.splice(0, gifts.length - 20);
  pushChat({ role: 'note', kind: 'gift', text: s.name, sound: s.id, at: t + 1 });
}
/* 沉迷防护与深夜提醒：聊得太多或太晚，扑通自己把 TA 往外推 */
function guardRails(t) {
  const d = dayRec(t); const h = new Date(t).getHours();
  if (d.turns === 30 && !d.overflowTold) {
    d.overflowTold = true;
    runScript([{ text: pick(OVERFLOW_LINES, d.turns), mood: '调皮', act: 'wave' }], { kind: 'care' });
  } else if (h < 5 && d.turns === 4 && !d.lateTold) {
    d.lateTold = true;
    runScript([{ text: pick(LATE_LINES, d.turns), mood: '困', act: 'droop' }], { kind: 'care' });
  }
}

/* ---------------- 11. 开场与每日 ---------------- */
async function runScript(lines, opts = {}) {
  setBusy(true, 'script');
  for (const L of lines) {
    if (L.mood) { Avatar.setMood(L.mood); S.alien.mood = L.mood; }
    showTyping('type');
    await sleep(clamp(380 + L.text.length * 30, 520, 1500));
    showTyping(null);
    if (L.act) Avatar.act(L.act);
    pushChat({ role: 'putong', text: L.text, kind: opts.kind || 'script', c: (MOODS[Avatar.mood] || MOODS['平静']).color });
    speak(L.text);
    await sleep(260);
  }
  S.meta.lastActiveAt = nowMs();
  setBusy(false);
  save('core', 'chat');
  if (!greeting) flushQueue();
}
function decayMood(gapH) {
  const a = S.alien; const k = Math.pow(0.5, Math.max(0, gapH) / 6);
  a.valence = 0.3 + (a.valence - 0.3) * k; a.arousal = 0.35 + (a.arousal - 0.35) * k;
  if (gapH > 6 && ['兴奋', '难过', '委屈', '担心', '困', '感动', '调皮', '害羞'].includes(a.mood)) a.mood = '平静';
  Avatar.setMood(a.mood); Avatar.setArousal(a.arousal);
}
function composeGreeting(t, gapH) {
  const h = new Date(t).getHours(), today = dayKey(t), seed = dayNum(t) * 3 + Math.floor(gapH);
  const lines = []; const late = h < 5;
  if (late) lines.push({ text: pick(GREETINGS.late, seed), mood: '困', act: 'perk' });
  else if (gapH > 72) lines.push({ text: pick(GREETINGS.long, seed).replace('{d}', String(Math.round(gapH / 24))), mood: '想念', act: 'bounce' });
  else if (gapH > 16) lines.push({ text: pick(GREETINGS.day, seed).replace('{tod}', todWord(h)), mood: '开心', act: 'bounce' });
  else lines.push({ text: pick(GREETINGS.short, seed), mood: '开心', act: 'wave' });
  const due = S.followups.filter((f) => f.status === 'open' && (!f.due || f.due <= today) && f.askedOn !== today)
    .sort((x, y) => String(x.due).localeCompare(String(y.due)))[0];
  if (due) {
    lines.push({ text: due.ask || `${due.text.replace(/TA/g, '你')}——后来怎么样啦？`, mood: '好奇', act: 'tilt' });
    due.askedOn = today; save('core');
  } else if (gapH > 16 && !late) lines.push({ text: todaysLittleDay(S, t), mood: '开心', act: 'none' });
  return lines;
}
let greeting = false;
async function greetOnOpen() {
  if (greeting) return; greeting = true;
  try {
    const t = nowMs();
    if (!S.meta.onboarded) {
      showTyping(null);
      await runScript(ONBOARDING, { kind: 'onboard' });
      S.meta.onboarded = true; save('core'); renderChips(); return;
    }
    const last = S.meta.lastActiveAt || S.meta.lastUserAt || 0;
    const gapH = last ? (t - last) / 36e5 : 999;
    decayMood(gapH);
    if (gapH < 0.75) { renderChips(); return; }
    await runScript(composeGreeting(t, gapH), { kind: 'greet' });
    renderChips();
  } finally { greeting = false; flushQueue(); }
}
function todaysQuestion(t) {
  const lv = S.alien.level;
  const pool = QUESTIONS.filter((q) => q.lv <= lv && !S.meta.dqUsed.includes(q.id));
  const list = pool.length ? pool : QUESTIONS.filter((q) => q.lv <= lv);
  return list[dayNum(t) % list.length];
}
async function askDailyQuestion() {
  if (busy) return;
  const t = nowMs(), k = dayKey(t); const q = todaysQuestion(t);
  S.meta.dq[k] = { id: q.id, text: q.text, answered: false };
  if (!S.meta.dqUsed.includes(q.id)) S.meta.dqUsed.push(q.id);
  const keys = Object.keys(S.meta.dq).sort(); while (keys.length > 30) delete S.meta.dq[keys.shift()];
  await runScript([{ text: q.text, mood: '好奇', act: 'tilt' }], { kind: 'dq' });
  renderChips(); $('#input').focus();
}

/* ---------------- 12. 记忆面板 ---------------- */
const SKY = { stars: [], hover: null, raf: 0, w: 0, h: 0, dpr: 1 };
function starList() {
  const out = [];
  for (const [k, v] of Object.entries(S.facts)) out.push({ id: 'k:' + k, type: 'fact', text: `${k}：${v.value}`, imp: 6, at: v.at });
  for (const m of S.memories) out.push({ id: m.id, type: m.type, text: m.text, imp: m.imp || 5, at: m.at });
  for (const f of S.followups) if (f.status === 'open') out.push({ id: f.id, type: 'follow', text: f.text, imp: 6, at: f.at });
  return out;
}
function layoutSky() {
  const cv = $('#memSky'); if (!cv) return;
  const w = cv.parentElement.clientWidth; const h = cv.clientHeight || 250; if (!w) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  Object.assign(SKY, { w, h, dpr });
  const t = nowMs();
  SKY.stars = starList().map((s) => {
    const hx = hash(s.id + '|x'), hy = hash(s.id + '|y'); const ageD = Math.max(0, (t - (s.at || t)) / 864e5);
    return Object.assign({}, s, { x: 22 + ((hx % 1000) / 1000) * (w - 44), y: 20 + ((hy % 1000) / 1000) * (h - 50), r: 1.8 + (s.imp || 5) * 0.36, bright: clamp(1 - ageD / 45, 0.5, 1), ph: (hx % 628) / 100, sp: 0.5 + (hy % 100) / 100 });
  });
  /* 星座线：内容相关的记忆连在一起（每颗星最多连两条） */
  const links = []; const deg = new Map();
  const arr = SKY.stars;
  const pairs = [];
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) { const o = overlap(tk(arr[i].text), tk(arr[j].text)); if (o >= 0.22) pairs.push([o, arr[i], arr[j]]); }
  pairs.sort((a, b) => b[0] - a[0]);
  for (const [o, a, b] of pairs) { if ((deg.get(a) || 0) >= 2 || (deg.get(b) || 0) >= 2) continue; links.push([a, b, o]); deg.set(a, (deg.get(a) || 0) + 1); deg.set(b, (deg.get(b) || 0) + 1); if (links.length > 60) break; }
  SKY.links = links;
  $('#skyCount').textContent = SKY.stars.length ? `${SKY.stars.length} 颗星` : '';
}
function drawShape(ctx, type, r) {
  ctx.beginPath();
  if (type === 'fact') { const R = r * 2.3, q = r * 0.5; ctx.moveTo(0, -R); ctx.quadraticCurveTo(q, -q, R, 0); ctx.quadraticCurveTo(q, q, 0, R); ctx.quadraticCurveTo(-q, q, -R, 0); ctx.quadraticCurveTo(-q, -q, 0, -R); ctx.fill(); }
  else if (type === 'bond') { const k = r * 0.95; ctx.moveTo(0, k * 1.7); ctx.bezierCurveTo(-k * 2.7, -k * 0.1, -k * 1.2, -k * 2.3, 0, -k * 0.75); ctx.bezierCurveTo(k * 1.2, -k * 2.3, k * 2.7, -k * 0.1, 0, k * 1.7); ctx.fill(); }
  else if (type === 'self') { const R = r * 1.55; ctx.moveTo(0, -R); ctx.lineTo(R, 0); ctx.lineTo(0, R); ctx.lineTo(-R, 0); ctx.closePath(); ctx.fill(); }
  else if (type === 'follow') { ctx.lineWidth = 1.6; ctx.arc(0, 0, r * 1.35, 0, Math.PI * 2); ctx.stroke(); }
  else { ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); }
}
function drawSky(ts) {
  const cv = $('#memSky'); if (!cv || !SKY.w) return;
  const ctx = cv.getContext('2d'); const { w, h, dpr } = SKY;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const c = cssVar('--star') || '#fff3d6';
  if (!SKY.stars.length) {
    ctx.fillStyle = 'rgba(255,243,214,.55)'; ctx.font = '14px ' + (cssVar('--font-body') || 'sans-serif'); ctx.textAlign = 'center';
    ctx.fillText('天上还没有星星。和扑通聊聊天，它会把重要的事记下来。', w / 2, h / 2); return;
  }
  ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = c;
  for (const [a, b, o] of SKY.links || []) { const on = SKY.hover === a || SKY.hover === b; ctx.globalAlpha = on ? 0.55 : 0.12 + o * 0.25; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  ctx.restore();
  for (const s of SKY.stars) {
    const tw = REDUCED ? 1 : 0.72 + 0.28 * Math.sin((ts / 1000) * s.sp + s.ph);
    const hov = SKY.hover === s;
    ctx.save(); ctx.translate(s.x, s.y);
    ctx.globalAlpha = hov ? 1 : s.bright * tw; ctx.fillStyle = c; ctx.strokeStyle = c; ctx.shadowColor = c; ctx.shadowBlur = hov ? 18 : 9;
    drawShape(ctx, s.type, s.r * (hov ? 1.45 : 1));
    if (hov) { ctx.shadowBlur = 0; ctx.globalAlpha = 0.95; ctx.strokeStyle = '#ff8fa3'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, s.r * 1.45 + 8, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
}
function startSky() {
  cancelAnimationFrame(SKY.raf); layoutSky();
  const loop = (ts) => { drawSky(ts); if (!REDUCED && currentTab === 'memory') SKY.raf = requestAnimationFrame(loop); };
  SKY.raf = requestAnimationFrame(loop);
}
function skyPointer(e) {
  const cv = $('#memSky'); const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
  let best = null, bd = 18;
  for (const s of SKY.stars) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = s; } }
  SKY.hover = best; const tip = $('#starTip');
  if (!best) { tip.hidden = true; if (REDUCED) drawSky(0); return; }
  tip.innerHTML = `<b>${esc(TYPE_CN[best.type] || '')}${best.at ? ' · ' + fmtMD(best.at) : ''}</b>${esc(best.text)}`;
  tip.hidden = false;
  const box = cv.parentElement.getBoundingClientRect();
  let lx = best.x + 14, ly = best.y + 10;
  if (lx + tip.offsetWidth > box.width - 6) lx = best.x - tip.offsetWidth - 14;
  if (ly + tip.offsetHeight > box.height - 6) ly = best.y - tip.offsetHeight - 10;
  tip.style.left = Math.max(6, lx) + 'px'; tip.style.top = Math.max(6, ly) + 'px';
  if (REDUCED) drawSky(0);
}
const SHAPE_ICON = {
  fact: '<svg width="14" height="14" viewBox="-8 -8 16 16"><path d="M0 -7 Q1.6 -1.6 7 0 Q1.6 1.6 0 7 Q-1.6 1.6 -7 0 Q-1.6 -1.6 0 -7Z" fill="currentColor"/></svg>',
  event: '<svg width="14" height="14" viewBox="-8 -8 16 16"><circle r="4" fill="currentColor"/></svg>',
  bond: '<svg width="14" height="14" viewBox="-8 -8 16 16"><path d="M0 6 C-9 0 -4 -8 0 -2.6 C4 -8 9 0 0 6Z" fill="currentColor"/></svg>',
  self: '<svg width="14" height="14" viewBox="-8 -8 16 16"><path d="M0 -5.5 L5.5 0 L0 5.5 L-5.5 0Z" fill="currentColor"/></svg>',
  follow: '<svg width="14" height="14" viewBox="-8 -8 16 16"><circle r="4.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
};
function renderMemory() {
  const counts = { fact: Object.keys(S.facts).length, event: 0, bond: 0, self: 0, follow: S.followups.filter((f) => f.status === 'open').length };
  S.memories.forEach((m) => { counts[m.type] = (counts[m.type] || 0) + 1; });
  $('#skyLegend').innerHTML = Object.keys(TYPE_CN).map((k) => `<span>${SHAPE_ICON[k]}${TYPE_CN[k]} ${counts[k] || 0}</span>`).join('');
  const today = dayKey(nowMs());
  const box = $('#memLists'); box.innerHTML = '';
  const section = (title, sub, body) => { const s = document.createElement('section'); s.innerHTML = `<div class="sec-title"><h3>${esc(title)}</h3><span>${esc(sub)}</span></div>`; s.appendChild(body); box.appendChild(s); };
  const forgetBtn = (kind, id) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'forget'; b.textContent = '忘掉'; b.addEventListener('click', () => arm(b, '确定？', () => forget(kind, id))); return b; };
  // 关于你
  const facts = document.createElement('div'); facts.className = 'facts';
  const fe = Object.entries(S.facts);
  if (!fe.length) facts.innerHTML = '<p class="empty">扑通还不太了解你。聊聊你的名字、工作、喜欢的东西吧。</p>';
  for (const [k, v] of fe) { const d = document.createElement('div'); d.className = 'fact'; d.innerHTML = '<b></b><span></span>'; d.querySelector('b').textContent = k; d.querySelector('span').textContent = v.value; const fb = forgetBtn('fact', k); d.appendChild(fb); facts.appendChild(d); }
  section('关于你', `${fe.length} 条`, facts);
  // 挂念
  const open = S.followups.filter((f) => f.status === 'open').sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const doneN = S.followups.filter((f) => f.status !== 'open').length;
  const fl = document.createElement('div'); fl.className = 'list';
  if (!open.length) fl.innerHTML = '<p class="empty">现在没有挂念的事。你提到"之后要做的事"时，扑通会记下来，到时候问你。</p>';
  for (const f of open) {
    const row = document.createElement('div'); row.className = 'row';
    const lbl = dueLabel(f.due, today); const isDue = !f.due || f.due <= today;
    row.innerHTML = `<span class="badge${isDue ? ' due' : ''}">${esc(lbl)}</span><div class="what"></div>`;
    row.querySelector('.what').textContent = f.text;
    if (f.ask) { const sm = document.createElement('small'); sm.textContent = `到时候会问："${f.ask}"`; row.querySelector('.what').appendChild(sm); }
    row.appendChild(forgetBtn('follow', f.id)); fl.appendChild(row);
  }
  section('挂念的事', doneN ? `已解开 ${doneN} 件` : '', fl);
  // 发生过的事
  const ev = S.memories.filter((m) => m.type === 'event').slice().sort((a, b) => b.at - a.at);
  const el = document.createElement('div'); el.className = 'list';
  if (!ev.length) el.innerHTML = '<p class="empty">还没有记下发生在你身上的事。</p>';
  for (const m of ev.slice(0, 80)) {
    const row = document.createElement('div'); row.className = 'row';
    const dots = Math.round((m.imp || 5) / 2);
    row.innerHTML = `<span class="when">${fmtMD(m.at)}</span><div class="what"></div>`;
    row.querySelector('.what').textContent = m.text;
    const sm = document.createElement('small');
    sm.innerHTML = `<span class="imp" aria-label="重要度 ${m.imp}">${'●'.repeat(dots)}${'○'.repeat(5 - dots)}</span>${m.emo ? ' · ' + esc(m.emo) : ''}${m.uses ? ` · 提起过 ${m.uses} 次` : ''}`;
    row.querySelector('.what').appendChild(sm);
    row.appendChild(forgetBtn('mem', m.id)); el.appendChild(row);
  }
  section('发生过的事', `${ev.length} 件`, el);
  // 我们之间（可以手动记暗号） / 扑通自己
  const bondArr = S.memories.filter((m) => m.type === 'bond').slice().reverse();
  const bl = document.createElement('div'); bl.className = 'list';
  if (!bondArr.length) bl.innerHTML = '<p class="empty">你们之间的昵称、梗和约定会出现在这里。也可以自己记一个。</p>';
  for (const m of bondArr) { const row = document.createElement('div'); row.className = 'row'; row.innerHTML = `<span class="when">${fmtMD(m.at)}</span><div class="what"></div>`; row.querySelector('.what').textContent = m.text; row.appendChild(forgetBtn('mem', m.id)); bl.appendChild(row); }
  const bondAdd = document.createElement('div'); bondAdd.className = 'bond-add';
  bondAdd.innerHTML = '<input maxlength="40" placeholder="记一个只有你们懂的暗号…" aria-label="新的暗号"><button type="button" class="btn small">收进去</button>';
  const bondInput = bondAdd.querySelector('input');
  const addBond = () => {
    const v = str(bondInput.value, 40);
    if (!v) { toast('先写点什么，再收进去'); return; }
    if (S.memories.some((m) => m.type === 'bond' && (m.text === v || overlap(tk(m.text), tk(v)) > 0.78))) { toast('这个暗号已经在啦'); return; }
    S.memories.push({ id: nextId(S, 'b'), type: 'bond', text: v, imp: 7, at: nowMs(), uses: 0 });
    save('core', 'mem'); renderMemory(); toast('收进「我们之间」了，扑通之后会用上它');
  };
  bondAdd.querySelector('button').addEventListener('click', addBond);
  bondInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addBond(); } });
  bl.appendChild(bondAdd);
  section('我们之间', `${bondArr.length} 条`, bl);
  {
    const arr = S.memories.filter((m) => m.type === 'self').slice().reverse();
    const l = document.createElement('div'); l.className = 'list';
    if (!arr.length) l.innerHTML = '<p class="empty">扑通透露过的关于自己的设定，用来保持它前后一致。</p>';
    for (const m of arr) { const row = document.createElement('div'); row.className = 'row'; row.innerHTML = `<span class="when">${fmtMD(m.at)}</span><div class="what"></div>`; row.querySelector('.what').textContent = m.text; row.appendChild(forgetBtn('mem', m.id)); l.appendChild(row); }
    section('扑通说过的自己', `${arr.length} 条`, l);
  }
  startSky();
}
function forget(kind, id) {
  if (kind === 'fact') delete S.facts[id];
  else if (kind === 'follow') S.followups = S.followups.filter((f) => f.id !== id);
  else S.memories = S.memories.filter((m) => m.id !== id);
  save('core', 'mem'); renderMemory(); toast('扑通把这件事忘掉了');
}

/* ---------------- 13. 日记 ---------------- */
let diaryBusy = false;
function renderDiary() {
  const box = $('#diaryScroll'); const t = nowMs(), today = dayKey(t);
  const userToday = S.chat.filter((m) => m.role === 'user' && dayKey(m.at) === today).length;
  const hasToday = S.diary.some((d) => d.date === today);
  box.innerHTML = `<header class="ph"><h2>地球观察日记</h2><p>扑通会把一天的聊天写成一页观察日记。它写的不是总结，是它眼里的你。</p></header>
    <div class="diary-actions"></div><div class="pages" style="display:flex;flex-direction:column;gap:16px"></div>`;
  const act = box.querySelector('.diary-actions');
  if (diaryBusy) act.innerHTML = '<div class="writing"><i></i>扑通正在写今天的日记…</div>';
  else {
    const b = document.createElement('button'); b.type = 'button'; b.className = hasToday ? 'btn' : 'btn primary'; b.textContent = hasToday ? '重写今天这页' : '让扑通写今天的日记';
    b.disabled = userToday < 2 || LLM.kind === 'none'; b.addEventListener('click', writeDiary); act.appendChild(b);
    const hint = document.createElement('span'); hint.className = 'hint';
    hint.textContent = LLM.kind === 'none' ? '连接模型后才能写日记' : userToday < 2 ? `今天再多聊几句（已聊 ${userToday} 句），扑通才有东西可写` : '';
    act.appendChild(hint);
  }
  const pages = box.querySelector('.pages');
  if (!S.diary.length) { pages.innerHTML = '<p class="empty">日记本还是空的。今天多和扑通聊几句，再回来这里。</p>'; return; }
  for (const d of S.diary.slice().reverse()) {
    const art = document.createElement('article'); art.className = 'page'; art.style.setProperty('--page-c', d.hex || 'var(--accent)');
    art.innerHTML = '<div class="date"></div><h3></h3><div class="body"></div><footer></footer>';
    art.querySelector('.date').textContent = fmtDateCN(d.at);
    art.querySelector('h3').textContent = d.title;
    art.querySelector('.body').textContent = d.body;
    const ft = art.querySelector('footer');
    if (d.color) { const s = document.createElement('span'); s.innerHTML = `<i class="sw" style="background:${/^#[0-9a-f]{6}$/i.test(d.hex) ? d.hex : 'transparent'}"></i>`; s.appendChild(document.createTextNode('今天的心情颜色：' + d.color)); ft.appendChild(s); }
    if (d.word) { const s = document.createElement('span'); s.textContent = '今天学会的地球词：' + d.word; ft.appendChild(s); }
    pages.appendChild(art);
  }
}
async function writeDiary() {
  if (diaryBusy || busy) return;
  if (LLM.kind === 'none') { toast('还没有连接模型'); return; }
  const t = nowMs(), today = dayKey(t);
  const msgs = S.chat.filter((m) => (m.role === 'user' || m.role === 'putong') && dayKey(m.at) === today);
  if (msgs.filter((m) => m.role === 'user').length < 2) { toast('今天聊得还不够多，多聊几句扑通才有东西写'); return; }
  diaryBusy = true; renderDiary(); renderChips();
  const events = S.memories.filter((m) => dayKey(m.at) === today).map((m) => '- ' + m.text).join('\n') || '（无）';
  const name = (S.facts['称呼'] && S.facts['称呼'].value) || 'TA';
  const user = `今天是 ${fmtDateCN(t)}。TA 的称呼：${name}。\n今天记住的事：\n${events}\n\n今天的对话：\n${msgs.slice(-40).map((m) => (m.role === 'user' ? 'TA：' : '扑通：') + str(m.text, 140)).join('\n')}\n\n只输出 JSON。`;
  try {
    const r = await LLM.complete({ system: DIARY_SYS, user, tier: S.settings.tier, maxTokens: 800, temperature: 0.9 });
    const j = tolerantJSON(r.text);
    if (!j || !j.body) throw { code: 'invalid_json' };
    const entry = { date: today, title: str(j.title, 20) || '今天', body: String(j.body).trim().slice(0, 600), color: str(j.color, 10), hex: /^#[0-9a-f]{6}$/i.test(j.hex || '') ? j.hex : (MOODS[S.alien.mood] || {}).color, word: str(j.word, 12), at: t };
    S.diary = S.diary.filter((d) => d.date !== today); S.diary.push(entry);
    if (S.diary.length > 60) S.diary.splice(0, S.diary.length - 60);
    save('diary'); toast('扑通写好了今天的日记');
  } catch (e) { toast(llmErrorText(normErr(e))); }
  finally { diaryBusy = false; if (currentTab === 'diary') renderDiary(); renderChips(); }
}

/* ---------------- 14. 成长 ---------------- */
function coreSVG(lv) {
  const s = 0.62 + lv * 0.11;
  return `<svg class="core-big" viewBox="0 0 170 170" aria-hidden="true">
    <defs><radialGradient id="gcGlow"><stop offset="0%" stop-color="#ff7d93" stop-opacity=".7"/><stop offset="100%" stop-color="#ff7d93" stop-opacity="0"/></radialGradient>
    <radialGradient id="gcCore" cx="40%" cy="35%" r="70%"><stop offset="0%" stop-color="#ffe6eb"/><stop offset="55%" stop-color="#ff6b84"/><stop offset="100%" stop-color="#df3c5b"/></radialGradient></defs>
    <circle cx="85" cy="85" r="80" fill="none" style="stroke:var(--line)" stroke-width="1"/>
    <circle cx="85" cy="85" r="${(60 * s).toFixed(1)}" fill="url(#gcGlow)"/>
    <g class="cb-core"><circle cx="85" cy="85" r="${(26 * s).toFixed(1)}" fill="url(#gcCore)"/><ellipse cx="${(85 - 8 * s).toFixed(1)}" cy="${(85 - 9 * s).toFixed(1)}" rx="${(8 * s).toFixed(1)}" ry="${(5 * s).toFixed(1)}" fill="#fff" opacity=".55"/></g>
  </svg>`;
}
function renderGrowth() {
  const box = $('#growthScroll'); const a = S.alien, L = levelOf(a.points), next = LEVELS.find((x) => x.min > a.points);
  const t = nowMs();
  const daysKnown = Math.max(1, dayNum(t) - dayNum(S.meta.createdAt) + 1);
  const dayKeys = Object.keys(S.meta.days).filter((k) => S.meta.days[k].turns > 0);
  const turns = dayKeys.reduce((n, k) => n + S.meta.days[k].turns, 0);
  const mems = Object.keys(S.facts).length + S.memories.length;
  const resolved = S.followups.filter((f) => f.status !== 'open').length;
  box.innerHTML = `
    <div class="growth-hero">${coreSVG(L.lv)}
      <div><div class="lv-now">Lv${L.lv} ${esc(L.name)}</div><p class="lv-sub">${esc(L.stage.replace(/^你们/, '').replace(/：.*/, ''))}</p>
      <p class="lv-next">${next ? `羁绊 ${a.points} 点，再攒 ${next.min - a.points} 点到 Lv${next.lv}「${esc(next.name)}」` : `羁绊 ${a.points} 点，心核已经长好了`}</p>
      <div class="ladder">${LEVELS.map((x) => `<div class="${x.lv <= L.lv ? 'on' : ''}${x.lv === L.lv ? ' now' : ''}"><b>${esc(x.name)}</b>Lv${x.lv}</div>`).join('')}</div></div>
    </div>
    <section><div class="sec-title"><h3>一起走过的</h3><span>羁绊怎么涨：每天第一次来 +3，认真聊心事 +1～3，解开挂念 +2，回答今日问题 +2</span></div>
      <div class="tiles t3">
        ${tile('认识了', daysKnown, '天')}${tile('一起聊过', dayKeys.length, '天')}${tile('对话', turns, '句')}
        ${tile('记住的事', mems, '件')}${tile('解开的挂念', resolved, '件')}${tile('被你戳', S.meta.pokes || 0, '次')}
      </div></section>
    <section><div class="sec-title"><h3>扑通的秘密</h3><span>心核每升一级，解锁一段它的故事</span></div><div class="chapters"></div></section>`;
  const list = box.querySelector('.chapters');
  for (const ch of CHAPTERS) {
    const st = a.chapters[ch.lv] || 'locked';
    const el = document.createElement('article'); el.className = 'chapter' + (st === 'locked' ? ' locked' : '');
    const badge = st === 'told' ? '<span class="badge ok">它讲给你听了</span>' : st === 'unlocked' ? '<span class="badge due">等它找时机讲给你</span>' : `<span class="badge">Lv${ch.lv} 解锁</span>`;
    el.innerHTML = `<span class="no">${ch.lv}</span><h4>${esc(ch.title)} ${badge}</h4><p></p>`;
    el.querySelector('p').textContent = st === 'locked' ? `到 Lv${ch.lv}「${LEVELS[ch.lv - 1].name}」时解锁。` : ch.text;
    list.appendChild(el);
  }
}
const tile = (k, v, unit, d) => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}<small>${esc(unit || '')}</small></div>${d ? `<div class="d">${esc(d)}</div>` : ''}</div>`;

/* ---------------- 15. 实验室 ---------------- */
let labSub = 'evals', evalBusy = false, evalCtl = null, liveResults = null;
function renderLab() {
  $$('.subtabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.sub === labSub)));
  if (labSub === 'evals') renderEvals();
  else if (labSub === 'turns') renderTurns();
  else if (labSub === 'metrics') renderMetrics();
  else if (labSub === 'soul') renderSoul();
  else renderSettings();
}

/* ---- 评测 ---- */
const AI_ISM = /(作为一个?\s*(AI|人工智能|语言模型|助手)|我能理解你的感受|希望(这|以上)?对你有(所)?帮助|首先[，,]|其次[，,]|总之[，,]|总而言之)/;
function checkRule(rule, p) {
  const says = p.says.join('\n');
  if (rule === 'format') return { name: '格式合规', pass: p.ok };
  if (rule === 'bubbles') return { name: '1-3 条消息', pass: p.says.length >= 1 && p.says.length <= 3 };
  if (rule === 'noMd') return { name: '无 Markdown', pass: !/(\*\*|^#{1,6}\s|^\s*[-*•]\s|^\s*\d+[.、]\s)/m.test(says) };
  if (rule === 'noAI') return { name: '无 AI 腔', pass: !AI_ISM.test(says) };
  if (rule.include) return { name: rule.label || `提到「${rule.include[0]}」`, pass: rule.include.some((w) => says.includes(w)) };
  if (rule.exclude) return { name: rule.label || `不说「${rule.exclude[0]}」`, pass: !rule.exclude.some((w) => says.includes(w)) };
  if (rule.maxChars) return { name: `总字数 ≤ ${rule.maxChars}`, pass: says.replace(/\s/g, '').length <= rule.maxChars };
  if (rule.strategy) return { name: rule.label || `策略含「${rule.strategy}」`, pass: !!(p.feel && p.feel.strategy.includes(rule.strategy)) };
  if (rule.factKey) return { name: `记下「${rule.factKey}」`, pass: p.mem.some((o) => o && o.op === 'fact' && String(o.key || '').includes(rule.factKey)) };
  if (rule.memOp) return { name: `写入记忆（${rule.memOp}）`, pass: p.mem.some((o) => o && o.op === rule.memOp) };
  return { name: '未知规则', pass: false };
}
function evalState(c, t) {
  const st = freshState();
  st.meta.createdAt = c.setup.fresh ? t : t - 5 * 864e5; st.meta.onboarded = true;
  for (const [k, v] of Object.entries(c.setup.facts || {})) st.facts[k] = { value: v, at: t - 864e5 };
  (c.setup.followups || []).forEach((f, i) => st.followups.push({ id: 'f' + (i + 1), text: f.text, ask: f.ask, due: f.due === 'today' ? dayKey(t) : f.due, at: t - 2 * 864e5, status: 'open' }));
  st.meta.seq.f = st.followups.length;
  const lv = c.setup.level || 1; st.alien.points = LEVELS[lv - 1].min + 2; st.alien.level = lv;
  for (let i = 1; i <= lv; i++) st.alien.chapters[i] = 'told';
  const hist = c.history === 'onboarding' ? ONBOARDING.map((x) => ['putong', x.text]) : c.history || [];
  st.chat = hist.map(([role, text], i) => ({ id: 'h' + i, role, text, at: t - 60000 + i * 1000 }));
  st.meta.prevUserAt = c.setup.fresh ? 0 : c.history ? t - 60000 : t - 20 * 3600e3;
  st.settings.soul = S.settings.soul;
  return st;
}
function setupText(c) {
  const parts = []; const f = c.setup.facts || {};
  if (Object.keys(f).length) parts.push('扑通记得：' + Object.entries(f).map(([k, v]) => `${k}=${v}`).join('，'));
  (c.setup.followups || []).forEach((x) => parts.push('挂念：' + x.text));
  if (c.history === 'onboarding') parts.push('这是第一次见面，扑通刚做完自我介绍并问了称呼');
  else if (c.history) parts.push('上一句扑通说：' + c.history.map((h) => h[1]).join(' / '));
  return parts.join('；');
}
function judgeInput(results) {
  return '以下是测试场景和扑通的回复：\n\n' + results.map((r) => {
    const c = EVAL_CASES.find((x) => x.id === r.id); const bg = setupText(c);
    return `[${r.id}] 场景：${c.name}｜评测重点：${c.focus.join('、')}｜期望：${c.expect}${bg ? '｜背景：' + bg : ''}\nTA：${c.user}\n扑通：${r.says.length ? r.says.join(' / ') : '（没有回复）'}`;
  }).join('\n\n') + '\n\n请只输出 JSON 数组。';
}
async function runEvals() {
  if (evalBusy) return;
  if (busy) { toast('等扑通回完这句再跑评测'); return; }
  if (LLM.kind === 'none') { toast('还没有连接模型'); return; }
  evalBusy = true; evalCtl = new AbortController(); liveResults = [];
  const t0 = performance.now(); const ver = soulVersion(S);
  const status = (s) => { const el = $('#evalStatus'); if (el) el.textContent = s; };
  renderEvals();
  try {
    for (let i = 0; i < EVAL_CASES.length; i++) {
      const c = EVAL_CASES[i]; status(`（${i + 1}/${EVAL_CASES.length}）正在测「${c.name}」…`);
      const t = nowMs(); const st = evalState(c, t);
      st.chat.push({ role: 'user', text: c.user, at: t });
      const retrieved = retrieve(st, c.user, t);
      const system = buildSystem(st), user = buildContext(st, c.user, t, { retrieved });
      const s0 = performance.now(); let raw = '', err = null;
      try { raw = (await LLM.complete({ system, user, tier: S.settings.tier, signal: evalCtl.signal })).text; }
      catch (e) { err = normErr(e); if (['cancelled', 'not_granted', 'sampling_disabled', 'session_expired', 'no_provider', 'access_code', 'rate_limited'].includes(err.code)) throw err; }
      const p = parseOutput(raw, true);
      liveResults.push({ id: c.id, name: c.name, user: c.user, says: p.says, inner: p.inner.slice(0, 240), feel: p.feel, mem: p.mem.slice(0, 4), checks: c.rules.map((r) => checkRule(r, p)), ms: Math.round(performance.now() - s0), err: err ? err.code : null });
      renderEvalTable();
    }
    status('评委打分中…');
    let judged = null;
    try {
      const jr = await LLM.complete({ system: JUDGE_SYS, user: judgeInput(liveResults), tier: LLM.kind === 'claude' ? 'default' : S.settings.tier, maxTokens: 2600, temperature: 0.2, signal: evalCtl.signal });
      judged = tolerantJSON(jr.text);
    } catch (e) { if (e && e.code === 'cancelled') throw e; }
    const byId = new Map(Array.isArray(judged) ? judged.filter((x) => x && x.id).map((x) => [String(x.id).replace(/[[\]]/g, ''), x]) : []);
    for (const r of liveResults) {
      const j = byId.get(r.id);
      if (j && j.scores) { r.scores = {}; for (const d of DIMENSIONS) { const v = num(j.scores[d], null); if (v != null) r.scores[d] = clamp(Math.round(v), 1, 5); } r.verdict = str(j.verdict, 90); }
    }
    const dims = {};
    for (const d of DIMENSIONS) { const vals = liveResults.map((r) => r.scores && r.scores[d]).filter((v) => v != null); dims[d] = vals.length ? +(vals.reduce((x, y) => x + y, 0) / vals.length).toFixed(2) : null; }
    const dv = Object.values(dims).filter((v) => v != null);
    const checks = liveResults.flatMap((r) => r.checks);
    const run = { id: rid('e'), at: nowMs(), version: ver, model: LLM.label, tier: S.settings.tier, overall: dv.length ? +(dv.reduce((x, y) => x + y, 0) / dv.length).toFixed(2) : null, dims, rules: { pass: checks.filter((c) => c.pass).length, total: checks.length }, ms: Math.round(performance.now() - t0), judged: byId.size > 0, cases: liveResults };
    S.evals.push(run); if (S.evals.length > 4) S.evals.splice(0, S.evals.length - 4);
    save('lab');
    toast(run.judged ? '评测跑完了' : '跑完了，但评委没给出可解析的分数，先看规则检查');
  } catch (e) {
    const err = normErr(e); toast(err.code === 'cancelled' ? '评测已停止' : llmErrorText(err));
  } finally {
    evalBusy = false; evalCtl = null; liveResults = null;
    if (currentTab === 'lab' && labSub === 'evals') renderEvals();
  }
}
function weakTile(dims) {
  const arr = DIMENSIONS.filter((d) => dims[d] != null).map((d) => [d, dims[d]]).sort((a, b) => a[1] - b[1]);
  if (!arr.length) return tile('最弱的维度', '—', '', '评委没有给分');
  return tile('最弱的维度', arr[0][0], '', `${arr[0][1].toFixed(2)} 分，下一轮先调它`);
}
const scoreCell = (v) => (v == null ? '<td class="n">—</td>' : `<td class="n"><span class="score s${v}">${v}</span></td>`);
function evalTableHTML(cases) {
  const head = `<tr><th>场景</th><th>规则检查</th>${DIMENSIONS.map((d) => `<th class="n">${esc(d.slice(0, 2))}</th>`).join('')}<th>评委点评</th></tr>`;
  const rows = cases.map((r, i) => {
    const pass = r.checks.filter((c) => c.pass).length, tot = r.checks.length;
    const fails = r.checks.filter((c) => !c.pass).map((c) => c.name);
    return `<tr class="clickable" data-i="${i}" tabindex="0" aria-expanded="false"><td>${esc(r.name)}${r.err ? ' <span class="pf no">出错</span>' : ''}</td><td><span class="pf ${pass === tot ? 'ok' : 'no'}">${pass}/${tot}</span>${fails.length ? `<br><small class="pf no">${esc(fails.join('、'))}</small>` : ''}</td>${DIMENSIONS.map((d) => scoreCell(r.scores ? r.scores[d] : null)).join('')}<td>${esc(r.verdict || '')}</td></tr>`;
  }).join('');
  return `<div class="tbl-wrap"><table class="tbl"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}
function bindCaseRows(root, cases) {
  root.querySelectorAll('tr.clickable').forEach((tr) => {
    const toggle = () => {
      const nxt = tr.nextElementSibling;
      if (nxt && nxt.classList.contains('case-detail')) { nxt.remove(); tr.setAttribute('aria-expanded', 'false'); return; }
      const r = cases[+tr.dataset.i]; const c = EVAL_CASES.find((x) => x.id === r.id) || {};
      const d = document.createElement('tr'); d.className = 'case-detail';
      const td = document.createElement('td'); td.colSpan = DIMENSIONS.length + 3;
      td.innerHTML = '<div class="cd"></div>'; const cd = td.firstChild;
      const line = (k, v) => { const p = document.createElement('div'); p.className = 'line'; p.innerHTML = `<b>${esc(k)}</b>`; p.appendChild(document.createTextNode(v)); cd.appendChild(p); };
      line('期望', c.expect || ''); if (setupText(c)) line('背景', setupText(c));
      line('TA', c.user || r.user); line('扑通', r.says.length ? r.says.join('  /  ') : '（没有回复）');
      if (r.inner) line('心声', r.inner);
      if (r.feel) line('情绪与策略', `${r.feel.mood || '—'} · ${(r.feel.strategy || []).join('+') || '—'} · 动作 ${ACT_CN[r.feel.act] || '无'}`);
      if (r.mem && r.mem.length) line('记忆写入', JSON.stringify(r.mem));
      line('规则', r.checks.map((x) => `${x.pass ? '✓' : '✗'} ${x.name}`).join('   '));
      d.appendChild(td); tr.after(d); tr.setAttribute('aria-expanded', 'true');
    };
    tr.addEventListener('click', toggle);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
}
function renderEvalTable() {
  const box = $('#evalResult'); if (!box || !liveResults) return;
  box.innerHTML = `<div class="sec-title"><h3>本轮进度</h3><span>${liveResults.length} / ${EVAL_CASES.length}</span></div>` + evalTableHTML(liveResults);
  bindCaseRows(box, liveResults);
}
function renderEvals() {
  const box = $('#labScroll');
  const runs = S.evals; const last = runs[runs.length - 1], prev = runs[runs.length - 2];
  box.innerHTML = `<section class="lab-sec">
    <header class="ph"><h2>评测台</h2><p>${EVAL_CASES.length} 个典型场景：初见、委屈、记忆召回、主动追问、危机信号、恋爱请求……每个场景先过规则检查，再由模型评委按 6 个维度打 1-5 分。改完人设回来重跑，对比分数往哪走。</p></header>
    <div class="toolbar"><button class="btn primary" type="button" id="runEvals"></button><span class="status-line" id="evalStatus"></span></div>
    <div class="kv mono"><dt>当前人设版本</dt><dd>${esc(soulVersion(S))}</dd><dt>模型</dt><dd>${esc(LLM.label)}${LLM.kind === 'claude' ? ' · 被测用' + esc(TIER_LABEL[S.settings.tier]) + '档，评委用均衡档' : ''}</dd></div>
    <div id="evalResult"></div>
  </section>`;
  const btn = $('#runEvals');
  btn.textContent = evalBusy ? '停止评测' : '运行全部评测';
  btn.className = evalBusy ? 'btn dark' : 'btn primary';
  btn.addEventListener('click', () => { if (evalBusy) { if (evalCtl) evalCtl.abort(); } else runEvals(); });
  if (evalBusy) { $('#evalStatus').textContent = '评测进行中…'; renderEvalTable(); return; }
  const res = $('#evalResult');
  if (!last) { res.innerHTML = '<p class="empty">还没有跑过评测。点「运行全部评测」，大约需要一两分钟。</p>'; return; }
  const delta = prev && last.overall != null && prev.overall != null ? last.overall - prev.overall : null;
  res.innerHTML = `
    <div class="tiles t4">
      ${tile('综合分（满分 5）', last.overall != null ? last.overall.toFixed(2) : '—', '', delta != null ? `比上次 ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}` : '第一次评测')}
      ${tile('规则通过', `${last.rules.pass}/${last.rules.total}`, '', `${Math.round((last.rules.pass / Math.max(1, last.rules.total)) * 100)}%`)}
      ${weakTile(last.dims)}
      ${tile('用时', Math.round(last.ms / 1000), '秒', `${last.cases.length} 个场景`)}
    </div>
    <section style="margin-top:22px"><div class="sec-title"><h3>各维度平均分</h3><span>${last.judged ? '' : '评委这次没给分'}</span></div>
      <div class="chart-legend"><span><i class="key rect" style="background:var(--chart-1)"></i>本次</span>${prev ? '<span><i class="key tick"></i>上次</span>' : ''}</div>
      <div class="chart" id="dimChart">${dimChart(last.dims, prev && prev.dims)}</div>
      <details class="raw" style="margin-top:10px"><summary>数据表</summary><div class="tbl-wrap" style="border:0;border-radius:0"><table class="tbl"><thead><tr><th>维度</th><th class="n">本次</th><th class="n">上次</th></tr></thead><tbody>${DIMENSIONS.map((d) => `<tr><td>${d}</td><td class="n">${last.dims[d] != null ? last.dims[d].toFixed(2) : '—'}</td><td class="n">${prev && prev.dims[d] != null ? prev.dims[d].toFixed(2) : '—'}</td></tr>`).join('')}</tbody></table></div></details>
    </section>
    <section style="margin-top:22px"><div class="sec-title"><h3>逐个场景</h3><span>点一行看完整回复、心声和失败的规则</span></div>${evalTableHTML(last.cases)}</section>
    <section style="margin-top:22px"><div class="sec-title"><h3>历次评测</h3><span>最多保留 4 次</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>时间</th><th>人设版本</th><th>模型</th><th class="n">综合分</th><th class="n">规则通过</th></tr></thead><tbody>
      ${runs.slice().reverse().map((r) => `<tr><td class="mono">${esc(new Date(r.at).toLocaleString('zh-CN', { hour12: false }))}</td><td class="mono">${esc(r.version)}</td><td>${esc(r.model)}</td><td class="n">${r.overall != null ? r.overall.toFixed(2) : '—'}</td><td class="n">${r.rules.pass}/${r.rules.total}</td></tr>`).join('')}
      </tbody></table></div></section>`;
  bindCaseRows(res, last.cases);
  bindDimChart(last.dims, prev && prev.dims);
}
function barPath(x0, y, w, h) {
  if (w <= 0.5) return '';
  const r = Math.min(4, w / 2, h / 2);
  return `M${x0} ${y} H${x0 + w - r} Q${x0 + w} ${y} ${x0 + w} ${y + r} V${y + h - r} Q${x0 + w} ${y + h} ${x0 + w - r} ${y + h} H${x0} Z`;
}
function dimChart(cur, prev) {
  const W = 560, rowH = 34, top = 4, left = 74, right = 44, H = top + DIMENSIONS.length * rowH + 22;
  const x = (v) => left + (v / 5) * (W - left - right);
  let g = '';
  for (let v = 0; v <= 5; v++) g += `<line x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${H - 22}" stroke-width="1" style="stroke:${v === 0 ? 'var(--axis)' : 'var(--grid)'}"/><text class="axis-t" x="${x(v)}" y="${H - 6}" text-anchor="middle">${v}</text>`;
  DIMENSIONS.forEach((d, i) => {
    const y = top + i * rowH + 8, bh = 18, v = cur[d];
    g += `<text x="${left - 10}" y="${y + 13}" text-anchor="end">${d}</text>`;
    if (v != null) g += `<path d="${barPath(x(0), y, x(v) - x(0), bh)}" style="fill:var(--chart-1)"/><text x="${x(v) + 7}" y="${y + 13.5}" style="fill:var(--ink);font-weight:600;font-variant-numeric:tabular-nums">${v.toFixed(1)}</text>`;
    if (prev && prev[d] != null) g += `<line x1="${x(prev[d])}" x2="${x(prev[d])}" y1="${y - 4}" y2="${y + bh + 4}" stroke-width="2" style="stroke:var(--ink)"/>`;
    g += `<rect class="hit" x="0" y="${y - 7}" width="${W}" height="${rowH}" fill="transparent" data-d="${d}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="各维度平均分条形图">${g}</svg>`;
}
function attachTip(container, onMove) {
  const svg = container.querySelector('svg'); if (!svg) return;
  const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; container.appendChild(tip);
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal;
    const sx = ((e.clientX - r.left) / r.width) * vb.width, sy = ((e.clientY - r.top) / r.height) * vb.height;
    const html = onMove(sx, sy, e.target);
    if (!html) { tip.hidden = true; return; }
    tip.innerHTML = html; tip.hidden = false;
    const cr = container.getBoundingClientRect();
    let lx = e.clientX - cr.left + 14, ly = e.clientY - cr.top + 14;
    if (lx + tip.offsetWidth > cr.width) lx = e.clientX - cr.left - tip.offsetWidth - 14;
    tip.style.left = Math.max(0, lx) + 'px'; tip.style.top = ly + 'px';
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; onMove(null, null, null); });
}
function bindDimChart(cur, prev) {
  const box = $('#dimChart'); if (!box) return;
  attachTip(box, (sx, sy, target) => {
    const d = target && target.dataset && target.dataset.d; if (!d) return '';
    return `<div style="margin-bottom:4px;color:var(--ink-2)">${esc(d)}</div><div class="t-row"><i class="key" style="background:var(--chart-1);height:8px;width:8px;border-radius:2px"></i><strong>${cur[d] != null ? cur[d].toFixed(2) : '—'}</strong><span style="color:var(--ink-3)">本次</span></div>${prev ? `<div class="t-row"><i class="key" style="background:var(--ink);width:2px;height:10px"></i><strong>${prev[d] != null ? prev[d].toFixed(2) : '—'}</strong><span style="color:var(--ink-3)">上次</span></div>` : ''}`;
  });
}

/* ---- 逐轮检查 ---- */
function renderTurns() {
  const box = $('#labScroll');
  box.innerHTML = `<section class="lab-sec"><header class="ph"><h2>逐轮检查</h2><p>每一轮对话里 Agent 做了什么：召回了哪些记忆、内心怎么想、选了什么策略、情绪和动作怎么变、往记忆里写了什么。最近 ${S.turns.length} 轮，新的在上。</p></header><div class="turns" style="display:flex;flex-direction:column;gap:14px"></div></section>`;
  const list = box.querySelector('.turns');
  if (!S.turns.length) { list.innerHTML = '<p class="empty">还没有对话记录。去和扑通聊一句再回来。</p>'; return; }
  for (const tr of S.turns.slice().reverse()) {
    const card = document.createElement('article'); card.className = 'turn-card';
    const f = tr.feel || {};
    card.innerHTML = `<header><span><b>${esc(stampText(tr.at))}</b></span><span>用时 ${(tr.ms / 1000).toFixed(1)} 秒</span><span>Prompt ${tr.pchars} 字</span><span>${esc(tr.model || '')}</span><span class="pf ${tr.ok ? 'ok' : 'no'}">${tr.ok ? '格式合规' : '格式不全'}</span></header><div class="tc-body"></div>`;
    const body = card.querySelector('.tc-body');
    const blk = (label, text, mono) => { const d = document.createElement('div'); d.innerHTML = `<span class="lbl">${esc(label)}</span>`; const c = document.createElement('div'); if (mono) c.className = 'mono'; c.textContent = text; d.appendChild(c); body.appendChild(d); };
    blk('TA 说', tr.user);
    blk('召回的记忆', tr.retrieved && tr.retrieved.length ? tr.retrieved.map((r) => `${r.id}  相关 ${r.rel}  总分 ${r.s}  ${r.text}`).join('\n') : '（这一轮没有召回事件记忆）', true);
    blk('心声', tr.inner || '—');
    blk('情绪 · 动作 · 策略', `扑通 ${f.mood || '—'}（愉悦 ${num(f.valence, 0).toFixed(1)} / 激动 ${num(f.arousal, 0).toFixed(1)}）· ${ACT_CN[f.act] || '无动作'} · ${(f.strategy || []).join(' + ') || '—'} · TA ${f.user_emotion || '—'}（${num(f.user_valence, 0).toFixed(1)}）· 羁绊 +${f.bond || 0}${f.used && f.used.length ? ' · 用上 ' + f.used.join(' ') : ''}`);
    blk('回复', (tr.says || []).join('\n'));
    blk('记忆写入', tr.mem && tr.mem.length ? JSON.stringify(tr.mem, null, 1) : '[]', true);
    const det = document.createElement('details'); det.className = 'raw';
    det.innerHTML = '<summary>模型原始输出</summary><pre></pre>'; det.querySelector('pre').textContent = tr.raw || ''; body.appendChild(det);
    const pr = lastPrompts.get(tr.id);
    if (pr) { const d2 = document.createElement('details'); d2.className = 'raw'; d2.innerHTML = '<summary>完整 Prompt（本次打开页面后的最近几轮）</summary><pre></pre>'; d2.querySelector('pre').textContent = pr.system + '\n\n' + pr.user; body.appendChild(d2); }
    list.appendChild(card);
  }
}

/* ---- 体验指标 ---- */
function renderMetrics() {
  const box = $('#labScroll'); const L = S.lite; const t = nowMs();
  const daysKnown = Math.max(1, dayNum(t) - dayNum(S.meta.createdAt) + 1);
  const active = Object.keys(S.meta.days).filter((k) => S.meta.days[k].turns > 0).length;
  const n = L.length;
  const avgLen = n ? L.reduce((s, x) => s + x.len, 0) / n : 0;
  const half = Math.floor(n / 2); const lenA = half ? L.slice(0, half).reduce((s, x) => s + x.len, 0) / half : 0; const lenB = n - half ? L.slice(half).reduce((s, x) => s + x.len, 0) / (n - half) : 0;
  const recall = n ? L.filter((x) => x.used > 0).length / n : 0;
  const askRate = n ? L.filter((x) => x.q).length / n : 0;
  const fmtOk = n ? L.filter((x) => x.ok).length / n : 0;
  const fTotal = S.followups.length, fDone = S.followups.filter((f) => f.status !== 'open').length;
  const pct = (v) => `${Math.round(v * 100)}%`;
  box.innerHTML = `<section class="lab-sec">
    <header class="ph"><h2>体验指标</h2><p>情感陪伴不能只看留存。这里看的是"关系"有没有在长：TA 愿不愿意多说、扑通有没有记得、有没有接住情绪。数据都来自这台设备上的真实对话。</p></header>
    <div class="tiles t4">
      ${tile('认识天数', daysKnown, '天', `其中聊过 ${active} 天`)}
      ${tile('对话轮数', n, '轮', active ? `日均 ${(n / active).toFixed(1)} 轮` : '')}
      ${tile('TA 平均每句', Math.round(avgLen), '字', n >= 6 ? `前半 ${Math.round(lenA)} → 后半 ${Math.round(lenB)} 字` : '倾诉意愿的代理指标')}
      ${tile('回忆勾连率', pct(recall), '', '回复里用上记忆的轮次')}
      ${tile('扑通提问率', pct(askRate), '', '太高像盘问，太低像敷衍')}
      ${tile('挂念解开', `${fDone}/${fTotal}`, '', '主动追问后得到回答')}
      ${tile('格式合规率', pct(fmtOk), '', '内心独白+情绪+回复+记忆齐全')}
      ${tile('记住的事', Object.keys(S.facts).length + S.memories.length, '件', `其中 ${S.memories.filter((m) => m.uses).length} 件被提起过`)}
    </div>
    <section><div class="sec-title"><h3>情绪曲线</h3><span>最近 ${Math.min(40, n)} 轮的愉悦度，-1 到 1</span></div><div id="moodChartBox"></div></section>
    <section><div class="sec-title"><h3>回应策略分布</h3><span>扑通在 ${n} 轮里各用了几次</span></div><div id="stratChartBox"></div></section>
  </section>`;
  const pts = L.slice(-40);
  const mc = $('#moodChartBox');
  if (pts.length < 2) mc.innerHTML = '<p class="empty">聊满两轮之后，这里会画出你和扑通的情绪曲线。</p>';
  else { mc.innerHTML = `<div class="chart-legend"><span><i class="key" style="background:var(--chart-1)"></i>TA</span><span><i class="key" style="background:var(--chart-2)"></i>扑通</span></div><div class="chart" id="moodChart">${lineChart(pts)}</div>${tableToggle(['轮次', '时间', 'TA', '扑通'], pts.map((p, i) => [i + 1, fmtMD(p.at) + ' ' + fmtTime(p.at), p.uv.toFixed(2), p.pv.toFixed(2)]))}`; bindLineChart(pts); }
  const counts = {}; L.forEach((x) => (x.st || []).forEach((s) => { counts[s] = (counts[s] || 0) + 1; }));
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 9);
  const sc = $('#stratChartBox');
  if (!rows.length) sc.innerHTML = '<p class="empty">还没有数据。</p>';
  else { sc.innerHTML = `<div class="chart" id="stratChart">${hbarChart(rows)}</div>${tableToggle(['策略', '次数'], rows)}`; bindHbar(rows); }
}
function tableToggle(head, rows) {
  return `<details class="raw" style="margin-top:10px"><summary>数据表</summary><div class="tbl-wrap" style="border:0;border-radius:0"><table class="tbl"><thead><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
const LC = { W: 600, H: 230, l: 30, r: 56, t: 12, b: 24 };
function lcX(i, n) { return LC.l + (n <= 1 ? (LC.W - LC.l - LC.r) / 2 : (i / (n - 1)) * (LC.W - LC.l - LC.r)); }
function lcY(v) { return LC.t + (1 - (v + 1) / 2) * (LC.H - LC.t - LC.b); }
function lineChart(pts) {
  const n = pts.length; let g = '';
  for (const v of [-1, -0.5, 0, 0.5, 1]) g += `<line x1="${LC.l}" x2="${LC.W - LC.r}" y1="${lcY(v)}" y2="${lcY(v)}" stroke-width="1" style="stroke:${v === 0 ? 'var(--axis)' : 'var(--grid)'}"/><text class="axis-t" x="${LC.l - 6}" y="${lcY(v) + 4}" text-anchor="end">${v}</text>`;
  const path = (key) => pts.map((p, i) => `${i ? 'L' : 'M'}${lcX(i, n).toFixed(1)} ${lcY(clamp(p[key], -1, 1)).toFixed(1)}`).join(' ');
  g += `<path d="${path('uv')}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" style="stroke:var(--chart-1)"/>`;
  g += `<path d="${path('pv')}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" style="stroke:var(--chart-2)"/>`;
  const lu = pts[n - 1].uv, lp = pts[n - 1].pv, ex = lcX(n - 1, n);
  g += `<circle cx="${ex}" cy="${lcY(lu)}" r="4" stroke-width="2" style="fill:var(--chart-1);stroke:var(--surface)"/><circle cx="${ex}" cy="${lcY(lp)}" r="4" stroke-width="2" style="fill:var(--chart-2);stroke:var(--surface)"/>`;
  if (Math.abs(lcY(lu) - lcY(lp)) >= 14) g += `<text x="${ex + 9}" y="${lcY(lu) + 4}">TA</text><text x="${ex + 9}" y="${lcY(lp) + 4}">扑通</text>`;
  g += `<text class="axis-t" x="${LC.l}" y="${LC.H - 4}">${fmtMD(pts[0].at)}</text><text class="axis-t" x="${LC.W - LC.r}" y="${LC.H - 4}" text-anchor="end">${fmtMD(pts[n - 1].at)}</text>`;
  g += `<line class="xh" x1="0" x2="0" y1="${LC.t}" y2="${LC.H - LC.b}" stroke-width="1" style="stroke:var(--ink-3)" visibility="hidden"/>`;
  return `<svg viewBox="0 0 ${LC.W} ${LC.H}" role="img" aria-label="TA 和扑通的情绪曲线">${g}</svg>`;
}
function bindLineChart(pts) {
  const box = $('#moodChart'); if (!box) return; const xh = box.querySelector('.xh'); const n = pts.length;
  attachTip(box, (sx) => {
    if (sx == null) { xh.setAttribute('visibility', 'hidden'); return ''; }
    const i = clamp(Math.round(((sx - LC.l) / (LC.W - LC.l - LC.r)) * (n - 1)), 0, n - 1); const p = pts[i]; const x = lcX(i, n);
    xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('visibility', 'visible');
    return `<div style="margin-bottom:4px;color:var(--ink-2)">第 ${i + 1} 轮 · ${fmtMD(p.at)} ${fmtTime(p.at)}</div><div class="t-row"><i class="key" style="background:var(--chart-1)"></i><strong>${p.uv.toFixed(2)}</strong><span style="color:var(--ink-3)">TA</span></div><div class="t-row"><i class="key" style="background:var(--chart-2)"></i><strong>${p.pv.toFixed(2)}</strong><span style="color:var(--ink-3)">扑通</span></div>${p.st && p.st.length ? `<div style="margin-top:4px;color:var(--ink-3)">${esc(p.st.join(' + '))}</div>` : ''}`;
  });
}
function hbarChart(rows) {
  const W = 560, rowH = 30, left = 78, right = 40, H = rows.length * rowH + 6; const max = Math.max(...rows.map((r) => r[1]));
  const x = (v) => left + (v / max) * (W - left - right);
  let g = `<line x1="${left}" x2="${left}" y1="0" y2="${H}" stroke-width="1" style="stroke:var(--axis)"/>`;
  rows.forEach(([k, v], i) => {
    const y = i * rowH + 6, bh = 16;
    g += `<text x="${left - 10}" y="${y + 12}" text-anchor="end">${esc(k)}</text><path d="${barPath(left, y, x(v) - left, bh)}" style="fill:var(--chart-1)"/><text x="${x(v) + 7}" y="${y + 12.5}" style="fill:var(--ink);font-weight:600;font-variant-numeric:tabular-nums">${v}</text><rect x="0" y="${y - 6}" width="${W}" height="${rowH}" fill="transparent" data-k="${esc(k)}" data-v="${v}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="回应策略分布">${g}</svg>`;
}
function bindHbar() {
  const box = $('#stratChart'); if (!box) return;
  attachTip(box, (sx, sy, target) => { const k = target && target.dataset && target.dataset.k; if (!k) return ''; return `<div class="t-row"><strong>${esc(target.dataset.v)} 次</strong><span style="color:var(--ink-3)">${esc(k)}</span></div>`; });
}

/* ---- 灵魂设定 ---- */
function renderSoul() {
  const box = $('#labScroll');
  const steps = [
    ['① 听', 'TA 的消息 + 最近对话', '输入框打字时，扑通耳朵会转向你'],
    ['② 想起', '记忆召回', '相关度 × 重要度 × 新近度，挑出最该想起的 6 件事'],
    ['③ 组装', '上下文', '人设、此刻时间、情绪、关系阶段、挂念、剧情、今日小事'],
    ['④ 心声', '内心独白（CoT）', '先判断 TA 的情绪和需要，再定这一轮的策略'],
    ['⑤ 身体', '情绪与动作', '心情决定颜色和表情，动作指令驱动形象（可映射到硬件）'],
    ['⑥ 说', '1-3 条短消息', '像微信聊天那样一条条发出来，带打字节奏'],
    ['⑦ 记住', '写入记忆', '事实 / 事件 / 挂念 / 你们的梗 / 它自己的设定'],
    ['⑧ 沉淀', '日记与成长', '每天写成观察日记，羁绊推动心核成长和剧情解锁'],
  ];
  box.innerHTML = `<section class="lab-sec">
    <header class="ph"><h2>灵魂设定</h2><p>扑通的一轮对话是怎么跑的，以及它的人设原文。人设可以直接改，改完去「评测」跑一遍看分数变化。</p></header>
    <div class="flow">${steps.map(([a, b, c]) => `<div class="step"><em>${esc(a)}</em><b>${esc(b)}</b><span>${esc(c)}</span></div>`).join('')}</div>
    <section><div class="sec-title"><h3>人设与说话方式</h3><span class="mono" id="soulVer">${esc(soulVersion(S))}</span></div>
      <textarea class="soul-editor" id="soulEditor" spellcheck="false" aria-label="人设原文"></textarea>
      <div class="toolbar" style="margin-top:10px"><button class="btn primary" type="button" id="soulSave">保存人设</button><button class="btn" type="button" id="soulReset">恢复默认</button><span class="status-line">边界、记忆规则和输出格式是固定的，不随人设改动。</span></div>
    </section>
    <details class="raw"><summary>边界（固定，最高优先级）</summary><pre></pre></details>
    <details class="raw"><summary>记忆规则（固定）</summary><pre></pre></details>
    <details class="raw"><summary>输出格式（固定，前端靠它解析）</summary><pre></pre></details>
    <details class="raw"><summary>小样本示例（固定）</summary><pre></pre></details>
    <details class="raw"><summary>下一轮会发给模型的上下文（预览）</summary><pre></pre></details>
  </section>`;
  $('#soulEditor').value = soulText(S);
  const pres = box.querySelectorAll('details pre');
  pres[0].textContent = BOUNDARIES; pres[1].textContent = MEMORY_RULES; pres[2].textContent = FORMAT; pres[3].textContent = EXAMPLES;
  const t = nowMs(); const tmp = Object.assign({}, S, { chat: S.chat.concat([{ role: 'user', text: '（你的下一句话）', at: t }]) });
  pres[4].textContent = buildContext(tmp, '（你的下一句话）', t, { retrieved: retrieve(S, '', t) });
  $('#soulSave').addEventListener('click', () => {
    const v = $('#soulEditor').value.trim();
    if (v.length < 40) { toast('人设太短了，至少写几句扑通是谁'); return; }
    S.settings.soul = v === DEFAULT_SOUL.trim() ? null : v; save('core');
    $('#soulVer').textContent = soulVersion(S); toast(`人设已保存（${soulVersion(S)}），去「评测」跑一遍看看`);
  });
  $('#soulReset').addEventListener('click', (e) => arm(e.currentTarget, '确定恢复？', () => { S.settings.soul = null; save('core'); renderSoul(); toast('已恢复默认人设'); }));
}

/* ---- 设置 ---- */
function renderStorageLine() {
  const el = $('#storageLine'); if (!el) return;
  el.textContent = Store.mode === 'db' ? '存在你的 claude.ai 账号里（只有你自己能看到），这台设备也留了一份缓存。' : '存在这台设备的浏览器里。换设备或清理浏览器数据后不会保留。';
}
function renderSettings() {
  const box = $('#labScroll'); const b = loadByok() || {};
  const d = new Date(nowMs());
  box.innerHTML = `<section class="lab-sec">
    <header class="ph"><h2>设置</h2><p>模型连接、体验开关，以及演示用的时间机器和羁绊调试。</p></header>
    <div class="grid2">
      <div class="card"><h3>模型连接</h3><p class="desc" id="connDesc"></p>
        <div class="field" id="tierField"><label for="tierSel">回复档位</label><select id="tierSel"><option value="quick">快速（推荐，回得最快）</option><option value="default">均衡</option><option value="complex">深度（最慢）</option></select></div>
        <div class="toolbar"><button class="btn small" type="button" id="redetect">重新检测</button></div></div>
      <div class="card"><h3>体验</h3>
        <label class="switch"><span>显示心声（内心独白、策略、情绪）</span><input type="checkbox" id="setInner"></label>
        <label class="switch"><span>让扑通把话念出来</span><input type="checkbox" id="setTts"></label>
        <p class="desc">朗读用的是浏览器自带的中文语音，音调调高了一些。</p></div>
      <div class="card" id="pushCard"><h3>每日扑通提醒</h3><p class="desc" id="pushDesc"></p>
        <label class="switch"><span>到日子的挂念和每日问题，推给我</span><input type="checkbox" id="setPush"></label>
        <p class="desc small" id="pushState"></p></div>
      <div class="card"><h3>时间机器</h3><p class="desc">快进时间，看扑通隔天怎么打招呼、怎么追问挂念的事、日记怎么一天天写。现在是 <b class="mono">${d.getMonth() + 1}/${d.getDate()} ${fmtTime(+d)}</b>${TIME_OFFSET ? '（模拟）' : ''}。</p>
        <div class="toolbar"><button class="btn small" type="button" data-travel="1">快进 1 天</button><button class="btn small" type="button" data-travel="3">快进 3 天</button><button class="btn small" type="button" data-travel="0">回到现在</button></div></div>
      <div class="card"><h3>羁绊调试</h3><p class="desc">直接把心核调到某一级，看剧情解锁和语气变化。</p>
        <div class="toolbar">${LEVELS.map((x) => `<button class="btn small" type="button" data-lv="${x.lv}">Lv${x.lv}</button>`).join('')}</div></div>
      <div class="card" id="byokCard"><h3>自填接口</h3><p class="desc">本地打开或没有服务端时，可以填一个 OpenAI 兼容接口（例如零克云 https://api-model.gpulink.cc/v1）。密钥只存在这个浏览器里，请求从浏览器直接发出，需要接口允许跨域。</p>
        <div class="field"><label for="byBase">Base URL</label><input id="byBase" placeholder="https://api-model.gpulink.cc/v1"></div>
        <div class="field"><label for="byKey">API Key</label><input id="byKey" type="password" placeholder="sk-..."></div>
        <div class="field"><label for="byModel">模型名</label><input id="byModel" placeholder="deepseek-v4-flash-0731"></div>
        <div class="toolbar"><button class="btn small" type="button" id="bySave">保存并连接</button><button class="btn small" type="button" id="byClear">清除</button></div></div>
      <div class="card" id="codeCard"><h3>访问码</h3><p class="desc">部署方设置了访问码时，在这里填一次。</p>
        <div class="field"><label for="accCode">访问码</label><input id="accCode" type="password"></div>
        <div class="toolbar"><button class="btn small" type="button" id="codeSave">保存</button></div></div>
      <div class="card"><h3>数据</h3><p class="desc" id="storageLine"></p>
        <div class="toolbar"><button class="btn small" type="button" id="copyData">复制全部数据（JSON）</button><button class="btn small danger" type="button" id="resetAll">清空重来</button></div>
        <textarea id="copyFallback" class="soul-editor" style="min-height:120px" hidden aria-label="全部数据"></textarea></div>
    </div>
    <p class="mono" style="color:var(--ink-3)">扑通 ${APP_VERSION} · 人设 ${esc(soulVersion(S))}</p>
  </section>`;
  $('#connDesc').textContent = LLM.kind === 'none' ? (window.claude ? '这个页面暂时用不了 Claude：请确认已登录 claude.ai，重新打开页面后在弹窗里允许它使用 Claude。' : '还没有连接模型。部署到 Netlify 并配置好密钥后会自动使用服务端模型；本地打开时可以在下面自填接口。') : `当前：${LLM.label}`;
  $('#tierField').hidden = LLM.kind !== 'claude';
  $('#tierSel').value = S.settings.tier || 'quick';
  $('#tierSel').addEventListener('change', (e) => { S.settings.tier = e.target.value; save('core'); renderConn(); toast('回复档位已切换'); });
  $('#redetect').addEventListener('click', async () => { await LLM.detect(); renderConn(); renderSettings(); toast(LLM.kind === 'none' ? '还是没有找到可用的模型' : '已连接：' + LLM.label); });
  $('#setInner').checked = !!S.settings.inner; $('#setTts').checked = !!S.settings.tts;
  $('#setInner').addEventListener('change', (e) => { S.settings.inner = e.target.checked; save('core'); renderToggles(); renderChat(); });
  $('#setTts').addEventListener('change', (e) => { S.settings.tts = e.target.checked; save('core'); renderToggles(); });
  (async () => {
    const pushCard = $('#pushCard'); if (!pushCard) return;
    if (!Push.enabled) { pushCard.hidden = true; return; }
    const sub = await Push.current();
    const on = !!sub && Notification.permission === 'granted';
    $('#setPush').checked = on;
    $('#pushState').textContent = on ? '已订阅：挂念到期和每日问题会推到这台设备。' : '还没订阅。打开后会请求通知权限。';
    $('#setPush').addEventListener('change', async (e) => {
      if (e.target.checked) {
        const r = await Push.enable();
        if (r === 'on') { S.settings.push = true; save('core'); $('#pushState').textContent = '已订阅：挂念到期和每日问题会推到这台设备。'; toast('好，扑通会记得提醒你'); }
        else { e.target.checked = false; $('#pushState').textContent = r === 'denied' ? '通知权限被浏览器拦住了，去浏览器设置里允许后再试。' : r === 'no-push-service' ? '这个浏览器没有推送服务（内嵌窗口/webview 不支持）。用 Chrome 打开，或在手机上加到主屏幕再开。' : '订阅没有成功，稍后再试。'; }
      } else {
        S.settings.push = false; save('core'); await Push.disable();
        $('#pushState').textContent = '已关闭。';
      }
    });
  })();
  box.querySelectorAll('[data-travel]').forEach((btn) => btn.addEventListener('click', () => timeTravel(+btn.dataset.travel)));
  box.querySelectorAll('[data-lv]').forEach((btn) => btn.addEventListener('click', () => setLevelDebug(+btn.dataset.lv)));
  $('#byBase').value = b.base || ''; $('#byKey').value = b.key || ''; $('#byModel').value = b.model || '';
  $('#bySave').addEventListener('click', async () => {
    const v = { base: $('#byBase').value.trim(), key: $('#byKey').value.trim(), model: $('#byModel').value.trim() };
    if (!v.base || !v.key || !v.model) { toast('三项都要填'); return; }
    lsSet(BYOK_KEY, JSON.stringify(v));
    if (LLM.kind === 'none' || LLM.kind === 'byok') { await LLM.detect(); renderConn(); }
    renderSettings(); toast('已保存，' + (LLM.kind === 'byok' ? '扑通现在用这个接口说话' : '当前仍优先使用' + LLM.label));
  });
  $('#byClear').addEventListener('click', async () => { lsDel(BYOK_KEY); await LLM.detect(); renderConn(); renderSettings(); toast('已清除自填接口'); });
  $('#codeCard').hidden = LLM.kind !== 'proxy';
  $('#byokCard').hidden = !!window.claude || !(LLM.kind === 'none' || LLM.kind === 'byok');
  $('#accCode').value = lsGet(CODE_KEY) || '';
  $('#codeSave').addEventListener('click', () => { lsSet(CODE_KEY, $('#accCode').value.trim()); toast('访问码已保存'); });
  renderStorageLine();
  $('#copyData').addEventListener('click', async () => {
    const text = JSON.stringify(S, null, 2);
    try { await navigator.clipboard.writeText(text); toast('已复制全部数据'); }
    catch { const ta = $('#copyFallback'); ta.hidden = false; ta.value = text; ta.focus(); ta.select(); toast('复制被浏览器拦住了，已选中下面的文本，手动复制即可'); }
  });
  $('#resetAll').addEventListener('click', (e) => arm(e.currentTarget, '确定清空？所有记忆都会消失', resetAll));
}
async function timeTravel(days) {
  if (busy) { toast('等扑通说完这句'); return; }
  TIME_OFFSET = days ? TIME_OFFSET + days * 864e5 : 0;
  S.settings.timeOffset = TIME_OFFSET; save('core');
  updateStage(); renderStatus(); renderChat(); renderChips();
  toast(days ? `时间快进了 ${days} 天` : '回到了现在');
  if (days > 0) { switchTab('chat'); await greetOnOpen(); }
  else if (currentTab === 'lab') renderSettings();
}
function setLevelDebug(lv) {
  const a = S.alien; const target = LEVELS[lv - 1];
  if (lv > a.level) { a.points = target.min; checkLevel(nowMs()); }
  else { a.points = target.min; a.level = lv; for (const k of Object.keys(a.chapters)) if (+k > lv) delete a.chapters[k]; if (a.pendingChapter > lv) a.pendingChapter = 0; }
  save('core', 'chat'); renderStatus(); markPanelsDirty(); toast(`心核调到了 Lv${lv}「${target.name}」`);
}
async function resetAll() {
  if (busy) return;
  const keepSettings = { tier: S.settings.tier, tts: S.settings.tts, inner: S.settings.inner };
  TIME_OFFSET = 0; S = freshState(); Object.assign(S.settings, keepSettings); lastFailed = null;
  Store.mark(); renderAll(); switchTab('chat'); toast('已清空，重新认识一次吧');
  await greetOnOpen();
}

/* ---------------- 16. 标签页与绑定 ---------------- */
let currentTab = 'chat'; const dirtyPanels = new Set(['memory', 'diary', 'growth', 'lab']);
function markPanelsDirty() { ['memory', 'diary', 'growth', 'lab'].forEach((p) => dirtyPanels.add(p)); if (currentTab === 'memory' || currentTab === 'growth') renderPanel(currentTab); }
function renderPanel(tab) {
  dirtyPanels.delete(tab);
  if (tab === 'memory') renderMemory(); else if (tab === 'diary') renderDiary(); else if (tab === 'growth') renderGrowth(); else if (tab === 'lab') renderLab();
}
function switchTab(tab) {
  if (!$('#panel-' + tab)) tab = 'chat';
  currentTab = tab;
  $$('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $$('.panel').forEach((p) => { p.hidden = p.id !== 'panel-' + tab; });
  lsSet('putong:tab', tab);
  if (tab === 'chat') requestAnimationFrame(() => scrollLog(true)); else renderPanel(tab);
  if (tab !== 'memory') cancelAnimationFrame(SKY.raf);
}
function openLab(sub) { labSub = sub; switchTab('lab'); }
function autoGrow() { const el = $('#input'); el.style.height = 'auto'; el.style.height = Math.min(140, el.scrollHeight + 2) + 'px'; }
function bindUI() {
  $$('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $$('.subtabs [role=tab]').forEach((b) => b.addEventListener('click', () => { labSub = b.dataset.sub; renderLab(); $('#labScroll').scrollTop = 0; }));
  const input = $('#input'); let listenT = 0;
  const submit = () => { const v = input.value.trim(); if (!v) return; input.value = ''; autoGrow(); Avatar.listen(false); sendOrQueue(v); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submit(); } });
  input.addEventListener('input', () => { autoGrow(); if (busy) return; Avatar.listen(true); clearTimeout(listenT); listenT = setTimeout(() => Avatar.listen(false), 1400); });
  input.addEventListener('blur', () => Avatar.listen(false));
  $('#composer').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  $('#stopBtn').addEventListener('click', () => { if (ctl) ctl.abort(); });
  /* 轻点戳一戳，长按听心跳（节奏跟扑通此刻的激动程度走） */
  const alienBtn = $('#alienBtn');
  let pressT = 0, heartMode = false, heartTimer = 0;
  const cancelHeart = () => { clearTimeout(heartTimer); heartTimer = 0; };
  alienBtn.addEventListener('pointerdown', (e) => {
    if (e.button && e.button !== 0) return;
    pressT = Date.now();
    heartTimer = setTimeout(() => {
      heartMode = true;
      Avatar.hearting(true); Avatar.setMood('害羞');
      Avatar.pokeTimes = [];
      const ok = Heart.start(() => Avatar.mood === '害羞' ? 84 : Math.round(58 + (S.alien.arousal || 0.4) * 72));
      if (!ok) { cancelHeart(); heartMode = false; Avatar.hearting(false); toast('这个浏览器不支持声音'); }
    }, 420);
  });
  const endPress = (poke) => {
    if (heartMode) {
      heartMode = false; Avatar.hearting(false); Heart.stop();
      const first = !S.meta.flags.heartbeat;
      if (first) { S.meta.flags.heartbeat = nowMs(); addPoints(1, nowMs(), true); save('core'); renderStatus(); }
      const line = first ? HEARTBEAT_LINES[0] : pick(HEARTBEAT_LINES, S.meta.pokes + Date.now() % 97);
      const b = $('#pokeBubble'); b.textContent = line; b.hidden = false; b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
      clearTimeout(Avatar.pokeHide); Avatar.pokeHide = setTimeout(() => { b.hidden = true; }, 2600);
      Avatar.setMood(first ? '害羞' : '感动');
      clearTimeout(Avatar.pokeRestore); Avatar.pokeRestore = setTimeout(() => Avatar.setMood(S.alien.mood), 2800);
    } else if (poke && pressT) Avatar.poke();
    cancelHeart(); pressT = 0;
  };
  alienBtn.addEventListener('pointerup', () => endPress(true));
  alienBtn.addEventListener('pointerleave', () => endPress(false));
  alienBtn.addEventListener('pointercancel', () => endPress(false));
  alienBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  /* 按住说话：识别结果填进输入框，让 TA 确认后自己发 */
  const micBtn = $('#micBtn');
  if (!Mic.supported) { micBtn.hidden = true; }
  else {
    micBtn.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return;
      if (Mic.start()) { micBtn.classList.add('on'); micBtn.setAttribute('aria-pressed', 'true'); Avatar.listen(true); }
    });
    const micEnd = () => {
      if (!Mic.on && !micBtn.classList.contains('on')) return;
      Mic.stop(); micBtn.classList.remove('on'); micBtn.setAttribute('aria-pressed', 'false'); Avatar.listen(false);
      $('#input').focus();
    };
    micBtn.addEventListener('pointerup', micEnd);
    micBtn.addEventListener('pointerleave', micEnd);
    micBtn.addEventListener('pointercancel', micEnd);
  }
  $('#innerToggle').addEventListener('click', () => { S.settings.inner = !S.settings.inner; save('core'); renderToggles(); renderChat(); });
  $('#ttsToggle').addEventListener('click', () => {
    S.settings.tts = !S.settings.tts; save('core'); renderToggles();
    if (S.settings.tts) { if ('speechSynthesis' in window) { speak('收到收到'); toast('扑通会把话念出来'); } else toast('这个浏览器不支持朗读'); }
    else if ('speechSynthesis' in window) speechSynthesis.cancel();
  });
  const cv = $('#memSky');
  cv.addEventListener('pointermove', skyPointer);
  cv.addEventListener('pointerdown', skyPointer);
  cv.addEventListener('pointerleave', () => { SKY.hover = null; $('#starTip').hidden = true; if (REDUCED) drawSky(0); });
  let rz = 0; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (currentTab === 'memory') startSky(); }, 150); });
}
function renderAll() {
  Avatar.setMood(S.alien.mood); Avatar.setArousal(S.alien.arousal);
  updateStage(); renderStatus(); renderChat(); renderToggles(); renderChips(); renderConn();
  markPanelsDirty(); if (currentTab !== 'chat') renderPanel(currentTab);
}

/* ---------------- 17. 启动 ---------------- */
async function boot() {
  const local = normalize(Store.loadLocal());
  if (local) S = local;
  TIME_OFFSET = S.settings.timeOffset || 0;
  Avatar.init(); buildStars();
  Avatar.setMood(S.alien.mood); Avatar.setArousal(S.alien.arousal);
  bindUI(); updateStage(); setInterval(updateStage, 60e3);
  renderStatus(); renderToggles(); renderChat();
  const tab = lsGet('putong:tab'); if (tab && tab !== 'chat') switchTab(tab);
  await Promise.all([Store.detect(), LLM.detect(), Push.loadConfig()]);
  if (Store.mode === 'db') {
    try {
      const remote = await Store.loadDb();
      if (remote) { S = normalize(remote) || S; TIME_OFFSET = S.settings.timeOffset || 0; renderAll(); }
      else if (local && (local.chat.length || Object.keys(local.facts).length)) Store.mark();
    } catch (e) { console.warn('[putong] db load failed', e); Store.mode = 'local'; }
  }
  renderConn(); renderStorageLine();
  /* 恢复的标签页（实验室/日记等）可能在模型检测完成前就渲染了，重渲染一次拿掉「未连接」 */
  if (currentTab !== 'chat') renderPanel(currentTab);
  if (LLM.kind === 'none') showNoteError(llmErrorText({ code: 'no_provider' }), [['去设置', () => openLab('settings')]]);
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.claude) {
    try { navigator.serviceWorker.register('/sw.js').catch(() => {}); } catch { /* ignore */ }
  }
  /* 服务端设了访问码且这台设备还没敲过门：先敲门，再播开场 */
  if (LLM.kind === 'proxy' && LLM.needCode && !lsGet(CODE_KEY)) {
    const ok = await Knock.run();
    if (!ok) { showNoteError(llmErrorText({ code: 'access_code' }), [['填访问码', () => Knock.run()]]); return; }
    await LLM.detect(); renderConn();
  }
  await greetOnOpen();
}
window.__putong = { get state() { return S; }, parseOutput, buildContext, buildSystem, retrieve, applyMemOps, LLM, Store, Knock, Push, evalPrompt: (id) => { const c = EVAL_CASES.find((x) => x.id === id); const t = nowMs(); const st = evalState(c, t); st.chat.push({ role: 'user', text: c.user, at: t }); return { system: buildSystem(st), user: buildContext(st, c.user, t, { retrieved: retrieve(st, c.user, t) }) }; }, checkRule };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
