const { normalizeBaseUrl } = require('./config.cjs');

class ModelRequestError extends Error {
  constructor(message, { retryable = false, status, retryAfterMs = 0 } = {}) {
    super(message);
    this.name = 'ModelRequestError';
    Object.assign(this, { retryable, status, retryAfterMs });
  }
}

function retryAfter(value) {
  if (!value) return 0;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.min(ms, 3600000)) : 0;
}

async function requestResponse(settings, input, { tools = [], signal, fetchImpl = fetch, toolChoice } = {}) {
  if (!settings.apiKey) throw new ModelRequestError('请先在模型设置中保存 API Key。');
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const timeout = AbortSignal.timeout(settings.requestTimeout * 1000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const clean = value => String(value).split(settings.apiKey).join('[REDACTED]');
  let response, raw;
  try {
    response = await fetchImpl(`${baseUrl}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: settings.model, input, ...(tools.length ? { tools, parallel_tool_calls: false, ...(toolChoice ? { tool_choice: toolChoice } : {}) } : {}), store: false }),
      signal: combinedSignal,
    });
    // A stalled or truncated response body belongs to the same timeout/retry boundary.
    raw = await response.text();
  } catch (error) {
    if (signal?.aborted) throw new ModelRequestError('任务已停止。');
    if (timeout.aborted) throw new ModelRequestError(`模型请求超过 ${settings.requestTimeout} 秒。`, { retryable: true });
    throw new ModelRequestError(`无法连接模型服务：${clean(error.message)}`, { retryable: true });
  }
  const metadata = { retryable: [408, 409, 425, 429].includes(response.status) || response.status >= 500, status: response.status, retryAfterMs: retryAfter(response.headers?.get?.('retry-after')) };
  let body;
  try { body = JSON.parse(raw); } catch { throw new ModelRequestError(`模型服务返回非 JSON 数据（HTTP ${response.status}）。请检查 API 地址是否支持 Responses API。`, metadata); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ModelRequestError(`模型服务返回无效响应（HTTP ${response.status}）。`, metadata);
  if (!response.ok) {
    if (['insufficient_quota', 'billing_hard_limit_reached', 'invalid_api_key'].includes(body.error?.code)) metadata.retryable = false;
    throw new ModelRequestError(`模型服务错误 ${response.status}：${clean(body.error?.message || body.message || '请求失败').slice(0, 600)}`, metadata);
  }
  if (body.error) throw new ModelRequestError(clean(body.error.message || '模型请求失败。').slice(0, 600), { retryable: ['server_error', 'rate_limit_exceeded'].includes(body.error.code) });
  if (!Array.isArray(body.output)) throw new ModelRequestError('此接口未返回 Responses API 的 output 数组。');
  if (body.status && body.status !== 'completed') throw new ModelRequestError(`模型响应未完成：${clean(body.incomplete_details?.reason || body.status)}`);
  return body;
}

function responseText(response) {
  return response.output.filter(x => x.type === 'message').flatMap(x => x.content || [])
    .filter(x => x.type === 'output_text' || x.type === 'refusal').map(x => x.text || x.refusal || '').join('\n').trim();
}

module.exports = { requestResponse, responseText, ModelRequestError, retryAfter };
