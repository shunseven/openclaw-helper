import { execa } from 'execa';
import { extractPlainValue } from './utils';

export type OpenClawStatus = {
  defaultModel: string | null;
  telegramConfigured: boolean;
  gatewayRunning: boolean;
  gatewayToken: string | null;
};

export async function getOpenClawStatus(): Promise<OpenClawStatus> {
  const status: OpenClawStatus = {
    defaultModel: null,
    telegramConfigured: false,
    gatewayRunning: false,
    gatewayToken: null,
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

  // Check Gateway Token
  try {
    const { stdout } = await execa('openclaw', ['config', 'get', 'gateway.auth.token']);
    status.gatewayToken = extractPlainValue(stdout) || null;
  } catch {
    status.gatewayToken = null;
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
