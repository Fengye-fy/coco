const { normalizeBaseUrl } = require('./config.cjs');

async function requestResponse(settings, input, { tools = [], signal, fetchImpl = fetch } = {}) {
  if (!settings.apiKey) throw new Error('请先在模型设置中保存 API Key。');
  const timeout = AbortSignal.timeout(settings.requestTimeout * 1000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetchImpl(`${normalizeBaseUrl(settings.baseUrl)}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: settings.model, input, ...(tools.length ? { tools, parallel_tool_calls: false } : {}), store: false }),
      signal: combinedSignal,
    });
  } catch (error) {
    if (signal?.aborted) throw new Error('任务已停止。');
    if (timeout.aborted) throw new Error(`模型请求超过 ${settings.requestTimeout} 秒，请检查网络或调整超时。`);
    throw new Error(`无法连接模型服务：${error.message}`);
  }
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch { throw new Error(`模型服务返回非 JSON 数据（HTTP ${response.status}）。请检查 API 地址是否支持 Responses API。`); }
  if (!response.ok) {
    let detail = String(body.error?.message || body.message || '请求失败').slice(0, 600);
    if (settings.apiKey) detail = detail.split(settings.apiKey).join('[REDACTED]');
    throw new Error(`模型服务错误 ${response.status}：${detail}`);
  }
  if (body.error) throw new Error(String(body.error.message || '模型请求失败。').slice(0, 600));
  if (!Array.isArray(body.output)) throw new Error('此接口未返回 Responses API 的 output 数组。');
  if (body.status && body.status !== 'completed') throw new Error(`模型响应未完成：${body.incomplete_details?.reason || body.status}`);
  return body;
}

function responseText(response) {
  return response.output.filter(x => x.type === 'message').flatMap(x => x.content || [])
    .filter(x => x.type === 'output_text' || x.type === 'refusal').map(x => x.text || x.refusal || '').join('\n').trim();
}

module.exports = { requestResponse, responseText };
