// POST /api/push/subscribe —— 记下订阅和挂念快照（打平存储，服务器不存任何对话原文）。
import { json, store, subKey, readBody, vapidReady } from './_push-lib.js';

export default async (request) => {
  if (!vapidReady()) return json({ error: 'push_not_configured' }, 501);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const body = await readBody(request);
  if (!body) return json({ error: 'bad_subscription' }, 400);
  const s = store();
  const key = subKey(body.subscription.endpoint);
  const prev = (await s.get(key, { type: 'json' }).catch(() => null)) || {};
  await s.setJSON(key, {
    subscription: body.subscription,
    followups: body.followups,
    sent: prev.sent || [],
    lastDaily: prev.lastDaily || null,
    updatedAt: new Date().toISOString(),
  });
  return json({ ok: true });
};

export const config = { path: '/api/push/subscribe' };
