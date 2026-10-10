// POST /api/chat —— 把前端的对话请求转发给 OpenAI 兼容接口（默认零克云网关），流式透传。
// 密钥只放在 Netlify 环境变量里，浏览器拿不到。
const DEFAULT_BASE = 'https://api-model.gpulink.cc/v1';
const DEFAULT_MODEL = 'deepseek-v4-flash-0731';

const env = (k) => (globalThis.Netlify && Netlify.env.get(k)) || '';
// 响应头只能放 ASCII
const ascii = (s) => String(s || '').replace(/[^\x20-\x7e]/g, '?').slice(0, 120);
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const code = env('ACCESS_CODE');
  if (code && request.headers.get('x-access-code') !== code) return json({ error: 'access_code_required' }, 401);

  const key = env('LLM_API_KEY');
  if (!key) return json({ error: 'missing_api_key' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const messages = (Array.isArray(body && body.messages) ? body.messages : [])
    .filter((m) => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .slice(-8);
  if (!messages.length) return json({ error: 'no_messages' }, 400);
  if (JSON.stringify(messages).length > 200000) return json({ error: 'too_large' }, 413);

  const base = (env('LLM_API_BASE') || DEFAULT_BASE).replace(/\/+$/, '');
  const models = [env('LLM_MODEL') || DEFAULT_MODEL, env('LLM_MODEL_FALLBACK')].filter(Boolean);
  const stream = body.stream !== false;
  const max_tokens = Math.min(Math.max(Number(body.max_tokens) || 1100, 64), 3000);
  const temperature = Number.isFinite(body.temperature) ? Math.min(Math.max(body.temperature, 0), 1.3) : 0.85;

  let last = '';
  for (const model of models) {
    let res;
    try {
      res = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({ model, messages, stream, max_tokens, temperature }),
      });
    } catch (e) { last = String(e); continue; }
    if (res.ok) {
      return new Response(res.body, {
        status: 200,
        headers: {
          'content-type': stream ? 'text/event-stream; charset=utf-8' : 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-llm-model': ascii(model),
        },
      });
    }
    last = (await res.text().catch(() => '')).slice(0, 400);
    // 主模型挂了（5xx / 限流 / 模型不存在 / 无可用渠道）才切备用模型
    const retryable = res.status >= 500 || res.status === 404 || res.status === 429 || /model_not_found|无可用渠道|not.?found/i.test(last);
    if (!retryable) return json({ error: 'upstream_error', status: res.status, detail: last }, 502);
  }
  return json({ error: 'upstream_error', detail: last }, 502);
};

export const config = { path: '/api/chat' };
