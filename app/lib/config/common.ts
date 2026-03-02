import { execa } from 'execa';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execOpenClaw, extractJson, extractPlainValue, startGateway } from '../utils';
import { callGatewayMethod } from '../gateway-ws';

export const QWEN_OAUTH_BASE_URL = 'https://chat.qwen.ai';
export const QWEN_OAUTH_DEVICE_CODE_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/device/code`;
export const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`;
export const QWEN_OAUTH_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56';
export const QWEN_OAUTH_SCOPE = 'openid profile email model.completion';
export const QWEN_OAUTH_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
export const QWEN_DEFAULT_BASE_URL = 'https://portal.qwen.ai/v1';
export const QWEN_DEFAULT_MODEL = 'qwen-portal/coder-model';
export const OPENAI_CODEX_DEFAULT_MODEL = 'openai-codex/gpt-5.2';

// 动态导入 openclaw 内置的 loginOpenAICodex（来自 @mariozechner/pi-ai）
let _loginOpenAICodex: any = null;
const PI_AI_REL = 'node_modules/@mariozechner/pi-ai/dist/utils/oauth/openai-codex.js';

export async function resolveOpenclawRoot(): Promise<string | null> {
  const home = process.env.HOME || '';
  console.log('开始查找 OpenClaw 安装目录...');

  // 1. 通过 which openclaw 找到 bin，然后解析真实路径
  try {
    console.log('尝试通过 which openclaw 查找...');
    const { stdout: whichOut } = await execa('which', ['openclaw']);
    const binPath = whichOut.trim();
    console.log(`which openclaw 结果: ${binPath}`);

    // 如果是脚本包装器，解析其中的 exec 目标路径
    try {
      const content = fs.readFileSync(binPath, 'utf-8');
      const execMatch = content.match(/exec\s+(.+?)\/bin\/openclaw/);
      if (execMatch) {
        const nodePrefix = execMatch[1].trim();
        const root = path.join(nodePrefix, 'lib/node_modules/openclaw');
        console.log(`从 wrapper 解析出的路径: ${root}`);
        if (fs.existsSync(root)) {
          console.log('路径存在 (Wrapper)');
          return root;
        } else {
          console.log('路径不存在 (Wrapper)');
        }
      }
    } catch (e: any) {
      console.log(`解析 wrapper 失败: ${e.message}`);
    }

    // 如果是真实的 node 二进制 symlink
    try {
      const realBin = fs.realpathSync(binPath);
      const root = path.resolve(path.dirname(realBin), '..', 'lib/node_modules/openclaw');
      console.log(`从 realpath 解析出的路径: ${root}`);
      if (fs.existsSync(root)) {
        console.log('路径存在 (Realpath)');
        return root;
      } else {
        console.log('路径不存在 (Realpath)');
      }
    } catch (e: any) {
      console.log(`解析 realpath 失败: ${e.message}`);
    }
  } catch (e: any) {
    console.log(`which openclaw 失败: ${e.message}`);
  }

  // 2. 扫描 nvm 安装的各个 node 版本
  const nvmDir = path.join(home, '.nvm/versions/node');
  console.log(`尝试扫描 NVM 目录: ${nvmDir}`);
  try {
    if (fs.existsSync(nvmDir)) {
      const versions = fs.readdirSync(nvmDir).sort().reverse(); // 从新到旧
      console.log(`发现 Node 版本: ${versions.join(', ')}`);
      for (const v of versions) {
        const root = path.join(nvmDir, v, 'lib/node_modules/openclaw');
        if (fs.existsSync(root)) {
          console.log(`在 NVM 中找到: ${root}`);
          return root;
        }
      }
    } else {
      console.log('NVM 目录不存在');
    }
  } catch (e: any) {
    console.log(`扫描 NVM 失败: ${e.message}`);
  }

  // 3. 常见全局安装路径
  const fallbacks = [
    path.join(home, '.local/lib/node_modules/openclaw'),
    '/usr/local/lib/node_modules/openclaw',
    '/usr/lib/node_modules/openclaw',
  ];
  console.log('尝试检查常见全局路径...');
  for (const root of fallbacks) {
    console.log(`检查: ${root}`);
    if (fs.existsSync(root)) {
      console.log(`找到路径: ${root}`);
      return root;
    }
  }

  // 4. 尝试通过 npm root -g 获取
  try {
    console.log('尝试通过 npm root -g 查找...');
    const { stdout } = await execa('npm', ['root', '-g']);
    const npmRoot = stdout.trim();
    const root = path.join(npmRoot, 'openclaw');
    console.log(`npm root -g 结果: ${root}`);
    if (fs.existsSync(root)) {
      console.log('找到路径 (npm root)');
      return root;
    }
  } catch (e: any) {
    console.log(`npm root -g 失败: ${e.message}`);
  }

  // 5. 根据当前 Node 执行路径推断
  try {
    const binDir = path.dirname(process.execPath);
    const root = path.resolve(binDir, '..', 'lib/node_modules/openclaw');
    console.log(`尝试根据 Node 路径推断: ${root}`);
    if (fs.existsSync(root)) {
      console.log('找到路径 (process.execPath)');
      return root;
    }
  } catch (e: any) {
    console.log(`Node 路径推断失败: ${e.message}`);
  }

  console.log('未找到 OpenClaw 安装目录');
  return null;
}

export async function getLoginOpenAICodex() {
  if (_loginOpenAICodex) return _loginOpenAICodex;

  const openclawRoot = await resolveOpenclawRoot();
  if (!openclawRoot) {
    throw new Error('无法找到 openclaw 安装目录，请确认 openclaw 已正确安装');
  }

  const modulePath = path.join(openclawRoot, PI_AI_REL);
  if (!fs.existsSync(modulePath)) {
    throw new Error(`找到 openclaw 目录 (${openclawRoot}) 但缺少 pi-ai 模块: ${modulePath}`);
  }

  try {
    const mod = await import(/* @vite-ignore */ `file://${modulePath}`);
    _loginOpenAICodex = mod.loginOpenAICodex;
    console.log(`已加载 loginOpenAICodex from: ${modulePath}`);
    return _loginOpenAICodex;
  } catch (err: any) {
    throw new Error(`加载 loginOpenAICodex 失败: ${err.message}`);
  }
}

export function writeOpenAICodexCredentials(creds: { access: string; refresh: string; expires: number; email?: string; [key: string]: unknown }) {
  const home = process.env.HOME || process.cwd();
  const agentDir = (process.env.OPENCLAW_AGENT_DIR || '').trim() || path.join(home, '.openclaw', 'agents', 'main', 'agent');
  const authProfilePath = path.join(agentDir, 'auth-profiles.json');

  let store: any = { version: 1, profiles: {} };
  try {
    if (fs.existsSync(authProfilePath)) {
      store = JSON.parse(fs.readFileSync(authProfilePath, 'utf-8'));
    }
  } catch {}

  const profileId = `openai-codex:${creds.email?.trim() || 'default'}`;
  store.profiles[profileId] = {
    type: 'oauth',
    provider: 'openai-codex',
    ...creds,
  };

  const dir = path.dirname(authProfilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(authProfilePath, JSON.stringify(store, null, 2));
  console.log(`OpenAI Codex 凭据已写入 ${authProfilePath} (profile: ${profileId})`);
}

export async function mergeDefaultModels(newEntries: Record<string, any>) {
  let existing: Record<string, any> = {};
  try {
    const result = await execOpenClaw(['config', 'get', '--json', 'agents.defaults.models']);
    existing = extractJson(String(result.stdout)) || {};
  } catch {
    existing = {};
  }
  const merged = { ...existing, ...newEntries };
  await execOpenClaw([
    'config',
    'set',
    '--json',
    'agents.defaults.models',
    JSON.stringify(merged),
  ]);
}

export async function applyOpenAICodexConfig() {
  await mergeDefaultModels({
    [OPENAI_CODEX_DEFAULT_MODEL]: {},
  });
  await execOpenClaw([
    'config',
    'set',
    '--json',
    'agents.defaults.model',
    JSON.stringify({ primary: OPENAI_CODEX_DEFAULT_MODEL }),
  ]);
}

export function toFormUrlEncoded(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function normalizeBaseUrl(value: string | undefined): string {
  const raw = value?.trim() || QWEN_DEFAULT_BASE_URL;
  const withProtocol = raw.startsWith('http') ? raw : `https://${raw}`;
  return withProtocol.endsWith('/v1') ? withProtocol : `${withProtocol.replace(/\/+$/, '')}/v1`;
}

export function resolveOAuthPath() {
  const home = process.env.HOME || process.cwd();
  const dir = (process.env.OPENCLAW_OAUTH_DIR || '').trim() || path.join(home, '.openclaw', 'credentials');
  return path.join(dir, 'oauth.json');
}

export function resolveRemoteSupportPath() {
  const home = process.env.HOME || process.cwd();
  return path.join(home, '.openclaw-helper', 'remote-support.json');
}

export async function isWhatsAppPluginEnabled(): Promise<boolean> {
  try {
    const result = await execOpenClaw(['plugins', 'list']);
    return /\|\s*@openclaw\/whatsapp\s*\|\s*whatsapp\s*\|\s*(loaded|enabled)\s*\|/i.test(String(result.stdout));
  } catch {
    return false;
  }
}

export async function ensureWhatsAppPluginReady() {
  const enabled = await isWhatsAppPluginEnabled();
  if (enabled) return;

  console.log('WhatsApp: 插件未启用，正在自动启用...');
  await execOpenClaw(['plugins', 'enable', 'whatsapp']);

  // 启用插件后重启网关，让 web login provider 立即生效
  try {
    await execOpenClaw(['gateway', 'restart']);
    await new Promise((resolve) => setTimeout(resolve, 2500));
  } catch {
    // 如果 gateway restart 不可用，回退到手动重启
    try {
      await execa('pkill', ['-f', 'openclaw.*gateway']);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch {
      // 进程可能不存在，忽略
    }

    const logFile = `${process.env.HOME}/.openclaw/logs/gateway.log`;
    await startGateway(logFile);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

export function syncAuthProfile(provider: string, apiKey: string) {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const profilePaths = [
    path.join(homeDir, '.openclaw', 'agents', 'main', 'auth-profiles.json'),
    path.join(homeDir, '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json'),
  ];
  for (const filePath of profilePaths) {
    try {
      let data: Record<string, any> = {};
      if (fs.existsSync(filePath)) {
        data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
      if (!data.profiles) data.profiles = {};
      data.profiles[`${provider}:default`] = {
        type: 'api_key',
        provider,
        key: apiKey,
      };
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch {
      // best-effort
    }
  }
}

export function syncGatewayEnvVar(envName: string, envValue: string) {
  if (process.platform !== 'darwin') return;
  const homeDir = process.env.HOME || '';
  const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', 'ai.openclaw.gateway.plist');
  try {
    if (!fs.existsSync(plistPath)) return;
    let content = fs.readFileSync(plistPath, 'utf-8');
    const keyTag = `<key>${envName}</key>`;
    if (content.includes(keyTag)) {
      // 替换已有的值
      const re = new RegExp(
        `(${keyTag}\\s*\\n\\s*<string>)[^<]*(</string>)`,
      );
      content = content.replace(re, `$1${envValue}$2`);
    } else {
      // 在 </dict> 前插入（EnvironmentVariables dict 内）
      const insertBefore = '    </dict>';
      const envEntry = `    <key>${envName}</key>\n    <string>${envValue}</string>\n`;
      const idx = content.lastIndexOf(insertBefore);
      if (idx !== -1) {
        content = content.slice(0, idx) + envEntry + content.slice(idx);
      }
    }
    fs.writeFileSync(plistPath, content);
  } catch {
    // best-effort
  }
}

export function writeQwenOAuthToken(token: { access: string; refresh: string; expires: number; resourceUrl?: string }) {
  const oauthPath = resolveOAuthPath();
  const dir = path.dirname(oauthPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  let data: Record<string, any> = {};
  try {
    data = JSON.parse(fs.readFileSync(oauthPath, 'utf-8'));
  } catch {
    data = {};
  }
  data['qwen-portal'] = {
    access: token.access,
    refresh: token.refresh,
    expires: token.expires,
    ...(token.resourceUrl ? { resourceUrl: token.resourceUrl } : {}),
  };
  fs.writeFileSync(oauthPath, JSON.stringify(data, null, 2));
}

export async function applyQwenConfig(resourceUrl?: string) {
  const baseUrl = normalizeBaseUrl(resourceUrl);
  await execOpenClaw([
    'config',
    'set',
    '--json',
    'models.providers.qwen-portal',
    JSON.stringify({
      baseUrl,
      apiKey: 'qwen-oauth',
      api: 'openai-completions',
      models: [
        {
          id: 'coder-model',
          name: 'Qwen Coder',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 8192,
        },
        {
          id: 'vision-model',
          name: 'Qwen Vision',
          reasoning: false,
          input: ['text', 'image'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 8192,
        },
      ],
    }),
  ]);

  // 将千问模型合并到 agents.defaults.models（不丢失已有模型）
  await mergeDefaultModels({
    'qwen-portal/coder-model': { alias: 'qwen' },
    'qwen-portal/vision-model': {},
  });

  await execOpenClaw([
    'config',
    'set',
    '--json',
    'agents.defaults.model',
    JSON.stringify({ primary: QWEN_DEFAULT_MODEL }),
  ]);
}
