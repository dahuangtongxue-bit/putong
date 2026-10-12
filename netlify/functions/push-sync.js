// POST /api/push/sync —— 挂念快照更新（浏览器侧状态变了就同步一次，节流 3 秒）。
import { json, store, subKey, readBody, vapidReady } from './_push-lib.js';

export default async (request) => {
  if (!vapidReady()) return json({ error: 'push_not_configured' }, 501);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const body = await readBody(request);
  if (!body) return json({ error: 'bad_subscription' }, 400);
  const s = store();
  const key = subKey(body.subscription.endpoint);
  const prev = (await s.get(key, { type: 'json' }).catch(() => null));
  if (!prev) return json({ ok: false, reason: 'not_subscribed' }, 404);
  await s.setJSON(key, Object.assign({}, prev, { followups: body.followups, updatedAt: new Date().toISOString() }));
  return json({ ok: true });
};

export const config = { path: '/api/push/sync' };
