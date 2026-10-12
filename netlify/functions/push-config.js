// GET /api/push/config —— 前端据此决定是否显示「每日扑通提醒」。只回 VAPID 公钥，私钥不出服务器。
import { json, vapidReady } from './_push-lib.js';

const env = (k) => (globalThis.Netlify && Netlify.env.get(k)) || '';

export default async () => {
  const vapidPublic = env('PUSH_VAPID_PUBLIC') || null;
  return json({ enabled: vapidReady(), vapidPublic });
};

export const config = { path: '/api/push/config' };
