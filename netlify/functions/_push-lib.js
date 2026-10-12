// 推送共享工具：Netlify Blobs 存订阅快照 + web-push 发送
import { getStore } from '@netlify/blobs';

const env = (k) => (globalThis.Netlify && Netlify.env.get(k)) || '';

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export const store = () => getStore('putong-push');

export const subKey = (endpoint) => 'sub/' + hash(endpoint);

function hash(s) {
  let h = 5381;
  s = String(s);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + s.length.toString(36);
}

export async function readBody(request) {
  try {
    const b = await request.json();
    const sub = b && b.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return null;
    const followups = Array.isArray(b.followups)
      ? b.followups
          .filter((f) => f && typeof f.text === 'string')
          .slice(0, 10)
          .map((f) => ({ id: String(f.id || '').slice(0, 8), text: String(f.text).slice(0, 80), ask: String(f.ask || '').slice(0, 40), due: String(f.due || '').slice(0, 10) }))
      : [];
    return { subscription: { endpoint: sub.endpoint, keys: sub.keys }, followups };
  } catch { return null; }
}

export function vapidReady() {
  const pub = cleanKey(env('PUSH_VAPID_PUBLIC'));
  const priv = cleanKey(env('PUSH_VAPID_PRIVATE'));
  // 有效长度：公钥 87 字符（65 字节 base64url），私钥 43 字符（32 字节）
  return pub.length === 87 && priv.length === 43;
}

/* 环境变量里粘进来的 key 容易带上括号、引号或空格：只保留 base64url 字符 */
export function cleanKey(s) {
  return String(s || '').replace(/[^A-Za-z0-9_-]/g, '');
}

export async function sendTo(rec, payload, wp) {
  try {
    await wp.sendNotification(rec.subscription, JSON.stringify(payload));
    return true;
  } catch (e) {
    if (e && (e.statusCode === 404 || e.statusCode === 410)) return 'gone';
    return false;
  }
}

export async function lazyWebPush() {
  const mod = await import('web-push');
  const wp = mod.default || mod;
  wp.setVapidDetails(env('PUSH_CONTACT') || 'mailto:putong@example.com', cleanKey(env('PUSH_VAPID_PUBLIC')), cleanKey(env('PUSH_VAPID_PRIVATE')));
  return wp;
}
