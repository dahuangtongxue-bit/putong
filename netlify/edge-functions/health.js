// GET /api/health —— 前端用它判断"有没有服务端模型可用"，不返回任何密钥。
// 带 ?code= 查询参数时，顺带校验访问码对不对（敲门功能用），只回 true/false。
const DEFAULT_MODEL = 'deepseek-v4-flash-0731';
const env = (k) => (globalThis.Netlify && Netlify.env.get(k)) || '';

export default async (request) => {
  const hasKey = !!env('LLM_API_KEY');
  const accessCode = env('ACCESS_CODE');
  let codeOk = null;
  if (accessCode) {
    const url = new URL(request.url);
    const given = url.searchParams.get('code') || '';
    codeOk = given === accessCode;
  }
  return new Response(JSON.stringify({
    ok: hasKey,
    app: 'putong',
    version: 'v2.0',
    model: env('LLM_MODEL') || DEFAULT_MODEL,
    fallback: env('LLM_MODEL_FALLBACK') || null,
    accessCode: !!accessCode,
    codeOk,
  }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
};

export const config = { path: '/api/health' };
