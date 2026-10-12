// 定时推送（每天 13:30 UTC ≈ 北京 21:30）：遍历订阅，发每日一句 + 到期的挂念追问。
// 每天每条最多发一次；订阅失效（404/410）自动清理。没配 VAPID 时静默跳过。
import { getStore } from '@netlify/blobs';
import { subKey, sendTo, vapidReady, lazyWebPush } from './_push-lib.js';

const DAILY_LINES = [
  '扑通在窗台捡到一个新问题，回来看看？',
  '扑通今天数了 17 只鸟，有 3 只好像是同一只。想讲给你听。',
  '扑通给今天的云取了名字。回来问问它叫什么。',
  '扑通把今天的声音收进了瓶子。回来看看是哪一段。',
  '窗台的灯给你留着呢。回来聊两句～',
];

const todayKey = () => new Date().toISOString().slice(0, 10);

export default async () => {
  if (!vapidReady()) return { statusCode: 200, body: JSON.stringify({ ok: false, reason: 'push_not_configured' }) };
  const wp = await lazyWebPush();
  const s = getStore('putong-push');
  const list = await s.list({ prefix: 'sub/' }).catch(() => ({ blobs: [] }));
  const today = todayKey();
  const dailyBody = DAILY_LINES[Math.floor(Date.now() / 864e5) % DAILY_LINES.length];
  let sent = 0, pruned = 0;
  for (const b of list.blobs || []) {
    const rec = await s.get(b.key, { type: 'json' }).catch(() => null);
    if (!rec) continue;
    if (rec.lastDaily === today) continue;
    const sentSet = new Set(rec.sent || []);
    const due = (rec.followups || []).filter((f) => f.due && f.due <= today && !sentSet.has(f.id));
    const first = due[0];
    const body = first ? (first.ask || first.text + '——后来怎么样啦？') : dailyBody;
    const r = await sendTo(rec, { title: '扑通', body, tag: first ? 'f-' + first.id : 'daily-' + today }, wp);
    if (r === 'gone') { await s.delete(b.key).catch(() => {}); pruned++; continue; }
    if (r === true) {
      sent++;
      sentSet.add(first ? first.id : 'daily');
      const sentArr = [...sentSet].slice(-20);
      await s.setJSON(b.key, Object.assign({}, rec, { sent: sentArr, lastDaily: today, updatedAt: new Date().toISOString() })).catch(() => {});
    }
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, sent, pruned }) };
};

export const config = { schedule: '30 13 * * *' };
