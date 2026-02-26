import { readFile } from 'fs/promises';
import { randomBytes } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import { execa } from 'execa';
import { extractPlainValue } from './utils';

export type OpenClawStatus = {
  defaultModel: string | null;
  telegramConfigured: boolean;
  gatewayRunning: boolean;
  gatewayToken: string | null;
  tokenRepaired: boolean;
};

/**
 * Gateway token 必须是纯字母数字、长度合理、且不是 OpenClaw 的脱敏占位符。
 */
function isValidGatewayToken(val: unknown): val is string {
  if (typeof val !== 'string' || !val) return false;
  if (val === '__OPENCLAW_REDACTED__') return false;
  if (val.length < 8 || val.length > 256) return false;
  if (/[\n\r\x00-\x1f]/.test(val)) return false;
  return true;
}

async function readGatewayTokenFromFile(): Promise<string | null> {
  try {
    const stateDir = process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw');
    const raw = await readFile(join(stateDir, 'openclaw.json'), 'utf-8');
    const cfg = JSON.parse(raw);
    const token = cfg?.gateway?.auth?.token;
    return isValidGatewayToken(token) ? token : null;
  } catch {
    return null;
  }
}

async function repairGatewayToken(): Promise<string | null> {
  try {
    const newToken = randomBytes(24).toString('hex');
    await execa('openclaw', ['config', 'set', 'gateway.auth.token', newToken]);
    console.log('[status] Gateway Token 已自动修复');

    // 重启 gateway 使新 token 生效
    try {
      await execa('openclaw', ['gateway', 'restart']);
      await new Promise((r) => setTimeout(r, 2500));
    } catch {
      try { await execa('pkill', ['-f', 'openclaw.*gateway']); } catch {}
      await new Promise((r) => setTimeout(r, 2000));
      const logFile = join(
        process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw'),
        'logs', 'gateway.log',
      );
      execa('sh', ['-c', `nohup openclaw gateway run --bind loopback --port 18789 > ${logFile} 2>&1 &`]);
      await new Promise((r) => setTimeout(r, 3000));
    }

    return newToken;
  } catch (err) {
    console.error('[status] Gateway Token 自动修复失败:', err);
    return null;
  }
}

export async function getOpenClawStatus(): Promise<OpenClawStatus> {
  const status: OpenClawStatus = {
    defaultModel: null,
    telegramConfigured: false,
    gatewayRunning: false,
    gatewayToken: null,
    tokenRepaired: false,
  };

  // Check default model
  try {
    const { stdout } = await execa('openclaw', ['config', 'get', 'agents.defaults.model.primary']);
    status.defaultModel = extractPlainValue(stdout);
  } catch {
    status.defaultModel = null;
  }

  // Check Telegram config
  try {
    const { stdout } = await execa('openclaw', ['config', 'get', 'channels.telegram.botToken']);
    status.telegramConfigured = !!extractPlainValue(stdout);
  } catch {
    status.telegramConfigured = false;
  }

  // Gateway Token: prefer reading from config file to avoid CLI stdout pollution
  status.gatewayToken = await readGatewayTokenFromFile();

  if (!status.gatewayToken) {
    const envToken = process.env.OPENCLAW_GATEWAY_TOKEN;
    if (isValidGatewayToken(envToken)) {
      status.gatewayToken = envToken;
    }
  }

  if (!status.gatewayToken) {
    try {
      const { stdout } = await execa('openclaw', ['config', 'get', 'gateway.auth.token']);
      const cliToken = extractPlainValue(stdout);
      if (isValidGatewayToken(cliToken)) {
        status.gatewayToken = cliToken;
      }
    } catch {
      // ignore
    }
  }

  // Auto-repair: token 无效时自动生成新 token 并重启 gateway
  if (!status.gatewayToken) {
    const repaired = await repairGatewayToken();
    if (repaired) {
      status.gatewayToken = repaired;
      status.tokenRepaired = true;
    }
  }

  // Check Gateway Status
  try {
    await execa('pgrep', ['-f', 'openclaw.*gateway']);
    status.gatewayRunning = true;
  } catch {
    status.gatewayRunning = false;
  }

  return status;
}
