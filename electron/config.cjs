const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULTS = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-6-astra',
  maxSteps: 60,
  requestTimeout: 120,
};

function normalizeBaseUrl(value) {
  const url = new URL(String(value).trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('请输入有效的 HTTP(S) API 地址，不包含密钥、查询参数或片段。');
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('远程 API 地址请使用 HTTPS；本地服务可以使用 HTTP。');
  }
  return url.toString().replace(/\/+$/, '').replace(/\/responses$/, '');
}

function validateSettings(input) {
  const maxSteps = Number(input.maxSteps);
  const requestTimeout = Number(input.requestTimeout);
  if (!String(input.model || '').trim()) throw new Error('请填写模型名称。');
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 500) throw new Error('最大轮次应为 1–500 的整数。');
  if (!Number.isInteger(requestTimeout) || requestTimeout < 10 || requestTimeout > 600) throw new Error('请求超时应为 10–600 秒。');
  return { baseUrl: normalizeBaseUrl(input.baseUrl), model: input.model.trim(), maxSteps, requestTimeout };
}

class ConfigStore {
  constructor(directory, safeStorage) {
    this.directory = directory;
    this.safeStorage = safeStorage;
    this.file = path.join(directory, 'settings.json');
    this.state = { ...DEFAULTS };
    this.key = '';
    this.writeQueue = Promise.resolve();
  }
  async load() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.state = validateSettings({ ...DEFAULTS, ...saved });
      if (saved.encryptedKey && this.safeStorage.isEncryptionAvailable()) {
        this.key = this.safeStorage.decryptString(Buffer.from(saved.encryptedKey, 'base64'));
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Settings could not be loaded:', error.message);
    }
    return this.public();
  }
  public() { return { ...this.state, hasApiKey: Boolean(this.key), encryptionAvailable: this.safeStorage.isEncryptionAvailable() }; }
  secret() { return { ...this.state, apiKey: this.key }; }
  save(input) {
    const job = this.writeQueue.then(async () => {
      const next = validateSettings(input);
      let key = this.key;
      if (input.clearApiKey) key = '';
      else if (String(input.apiKey || '').trim()) key = input.apiKey.trim();
      if (key && !this.safeStorage.isEncryptionAvailable()) throw new Error('系统加密存储不可用，无法保存 API Key。');
      const data = { ...next, encryptedKey: key ? this.safeStorage.encryptString(key).toString('base64') : '' };
      const temp = `${this.file}.tmp`;
      await fs.writeFile(temp, JSON.stringify(data, null, 2), 'utf8');
      await fs.rename(temp, this.file);
      this.state = next;
      this.key = key;
      return this.public();
    });
    this.writeQueue = job.catch(() => {});
    return job;
  }
}

module.exports = { ConfigStore, DEFAULTS, normalizeBaseUrl, validateSettings };
