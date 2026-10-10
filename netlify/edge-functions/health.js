// GET /api/health —— 前端用它判断"有没有服务端模型可用"，不返回任何密钥。
const DEFAULT_MODEL = 'deepseek-v4-flash-0731';
const env = (k) => (globalThis.Netlify && Netlify.env.get(k)) || '';

export default async () => {
  const hasKey = !!env('LLM_API_KEY');
  return new Response(JSON.stringify({
    ok: hasKey,
    app: 'putong',
    version: 'v1.0',
    model: env('LLM_MODEL') || DEFAULT_MODEL,
    fallback: env('LLM_MODEL_FALLBACK') || null,
    accessCode: !!env('ACCESS_CODE'),
  }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
};

export const config = { path: '/api/health' };
