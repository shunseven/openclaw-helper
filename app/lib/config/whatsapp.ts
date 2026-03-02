import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import { execOpenClaw, extractJson, startGateway } from '../utils';
import { callGatewayMethod } from '../gateway-ws';
import { ensureWhatsAppPluginReady } from './common';

export const whatsappRouter = new Hono();

/** 检查 WhatsApp 是否已经通过 QR 码完成链接（凭据目录是否有文件） */
function isWhatsAppLinkedForConfig(accountId = 'default'): boolean {
  try {
    const home = process.env.HOME || '';
    const credDir = path.join(home, '.openclaw', 'credentials', 'whatsapp', accountId);
    if (!fs.existsSync(credDir)) return false;
    const files = fs.readdirSync(credDir).filter((f: string) => !f.startsWith('.'));
    return files.length > 0;
  } catch {
    return false;
  }
}

// 获取 WhatsApp 当前配置状态
whatsappRouter.get('/whatsapp', async (c) => {
  try {
    let config: any = {};
    try {
      const result = await execOpenClaw(['config', 'get', '--json', 'channels.whatsapp']);
      config = extractJson(String(result.stdout)) || {};
    } catch {}

    const linked = isWhatsAppLinkedForConfig();

    return c.json({
      success: true,
      data: {
        linked,
        dmPolicy: config.dmPolicy || 'pairing',
        selfChatMode: config.selfChatMode || false,
        allowFrom: config.allowFrom || [],
      },
    });
  } catch (error: any) {
    return c.json(
      { success: false, error: '获取 WhatsApp 配置失败: ' + (error.message || '未知错误') },
      500,
    );
  }
});

// WhatsApp QR 链接: 启动（先注销旧会话，再获取二维码）
whatsappRouter.post('/whatsapp/link/start', async (c) => {
  try {
    // 0. 启动前检查插件，未启用则自动开启
    await ensureWhatsAppPluginReady();

    // 1. 先注销旧的 WhatsApp 会话（清除凭据），忽略错误（可能本来就没有会话）
    try {
      console.log('WhatsApp: 正在注销旧会话...');
      const logoutResult = await callGatewayMethod(
        'channels.logout',
        { channel: 'whatsapp', accountId: 'default' },
        15000,
      );
      console.log('WhatsApp: 注销结果:', JSON.stringify(logoutResult));
    } catch (logoutErr: any) {
      // 没有已有会话时注销会失败，这是正常的
      console.log('WhatsApp: 注销跳过 (可能无旧会话):', logoutErr.message);
    }

    // 2. 生成新的 QR 码
    console.log('WhatsApp: 正在生成 QR 码...');
    const result = await callGatewayMethod(
      'web.login.start',
      {
        accountId: 'default',
        force: true,
        timeoutMs: 30000,
        verbose: false,
      },
      45000,
    );
    return c.json({
      success: true,
      data: {
        qrDataUrl: result.qrDataUrl,
        message: result.message || '请使用 WhatsApp 扫描二维码',
      },
    });
  } catch (error: any) {
    console.error('WhatsApp QR 链接启动失败:', error);
    return c.json(
      {
        success: false,
        error: 'WhatsApp 链接启动失败: ' + (error.message || '未知错误'),
      },
      500,
    );
  }
});

// WhatsApp QR 链接: 轮询（等待扫码完成，对应 openclaw 的 waitForWebLogin）
whatsappRouter.post('/whatsapp/link/poll', async (c) => {
  /** 检查凭据文件是否已存在（515 重启时凭据已保存） */
  const checkCredsExist = (): boolean => {
    try {
      const credPath = path.join(
        process.env.HOME || '',
        '.openclaw', 'credentials', 'whatsapp', 'default', 'creds.json',
      );
      return fs.existsSync(credPath);
    } catch {
      return false;
    }
  };

  /** 单次 poll 调用 */
  const doPoll = async (timeoutMs = 8000, rpcTimeout = 15000) => {
    const result = await callGatewayMethod(
      'web.login.wait',
      { accountId: 'default', timeoutMs },
      rpcTimeout,
    );
    return {
      connected: !!result.connected,
      message: String(result.message || ''),
    };
  };

  try {
    const { connected, message } = await doPoll();

    // ── 处理 515 重启（对应 openclaw login-qr.ts 的 restartLoginSocket 逻辑）──
    if (!connected && /515|restart required/i.test(message)) {
      console.log('WhatsApp: 检测到 515 重启请求，等待网关完成重连...');
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // 重试一次 poll
      try {
        const retryResult = await doPoll(15000, 20000);
        if (retryResult.connected) {
          return c.json({ success: true, data: { connected: true, message: retryResult.message || 'WhatsApp 已链接' } });
        }
      } catch (retryErr: any) {
        console.log('WhatsApp: 重试 poll 失败:', retryErr.message);
      }

      // 最后手段：检查凭据文件是否已存在
      if (checkCredsExist()) {
        console.log('WhatsApp: 凭据文件已存在，判定为链接成功（515 重启后）');
        return c.json({ success: true, data: { connected: true, message: 'WhatsApp 已链接（连接重启后自动恢复）' } });
      }

      return c.json({ success: false, error: 'WhatsApp 配对后需要重启连接，请稍等片刻后重试' }, 500);
    }

    // ── 其他硬性失败 ──
    if (!connected && /failed|error|timeout|time-out|unauthorized/i.test(message)) {
      if (checkCredsExist()) {
        console.log('WhatsApp: 网关报告失败但凭据已存在，判定为链接成功');
        return c.json({ success: true, data: { connected: true, message: 'WhatsApp 已链接' } });
      }
      return c.json({ success: false, error: message || 'WhatsApp 登录失败，请重试' }, 500);
    }

    return c.json({ success: true, data: { connected, message } });
  } catch (error: any) {
    const errMsg = String(error.message || '');

    if (/515|restart required/i.test(errMsg)) {
      console.log('WhatsApp: RPC 异常中检测到 515，等待后检查凭据...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (checkCredsExist()) {
        console.log('WhatsApp: 凭据文件已存在（RPC 515 异常后），判定为链接成功');
        return c.json({ success: true, data: { connected: true, message: 'WhatsApp 已链接（连接重启后自动恢复）' } });
      }
    }

    console.error('WhatsApp QR 链接轮询失败:', error);
    return c.json({ success: false, error: 'WhatsApp 链接状态查询失败: ' + (errMsg || '未知错误') }, 500);
  }
});

// WhatsApp DM 策略配置
whatsappRouter.post('/whatsapp/configure', async (c) => {
  try {
    const { phoneMode, phoneNumber, dmPolicy, allowFrom } = await c.req.json();

    if (phoneMode === 'personal') {
      if (!phoneNumber || !phoneNumber.trim()) {
        return c.json({ success: false, error: '请提供你的 WhatsApp 手机号码' }, 400);
      }
      const trimmed = phoneNumber.trim().replace(/[\s\-()]/g, '');
      if (!/^\+?\d{7,15}$/.test(trimmed)) {
        return c.json(
          { success: false, error: '手机号码格式不正确，请使用国际格式如 +8613800138000' },
          400,
        );
      }
      const normalized = trimmed.startsWith('+') ? trimmed : `+${trimmed}`;

      await execOpenClaw(['config', 'set', '--json', 'channels.whatsapp.selfChatMode', 'true']);
      await execOpenClaw(['config', 'set', '--json', 'channels.whatsapp.dmPolicy', JSON.stringify('allowlist')]);
      await execOpenClaw(['config', 'set', '--json', 'channels.whatsapp.allowFrom', JSON.stringify([normalized])]);
      console.log(`WhatsApp: 个人手机模式 - selfChatMode=true, dmPolicy=allowlist, allowFrom=[${normalized}]`);
    } else {
      await execOpenClaw(['config', 'set', '--json', 'channels.whatsapp.selfChatMode', 'false']);

      const policy = dmPolicy || 'pairing';
      await execOpenClaw(['config', 'set', '--json', 'channels.whatsapp.dmPolicy', JSON.stringify(policy)]);

      if (policy === 'open') {
        await execOpenClaw(['config', 'set', '--json', 'channels.whatsapp.allowFrom', JSON.stringify(['*'])]);
      } else if (policy === 'disabled') {
        // 禁用模式：无需设置 allowFrom
      } else if (Array.isArray(allowFrom) && allowFrom.length > 0) {
        const normalized = allowFrom
          .map((n: string) => n.trim().replace(/[\s\-()]/g, ''))
          .filter(Boolean)
          .map((n: string) => (n === '*' ? '*' : n.startsWith('+') ? n : `+${n}`));
        if (normalized.length > 0) {
          await execOpenClaw(['config', 'set', '--json', 'channels.whatsapp.allowFrom', JSON.stringify(normalized)]);
        }
      }
      console.log(`WhatsApp: 专用号码模式 - selfChatMode=false, dmPolicy=${dmPolicy || 'pairing'}`);
    }

    // 启用默认 WhatsApp 账户
    await execOpenClaw(['config', 'set', '--json', 'channels.whatsapp.accounts.default.enabled', 'true']);

    // 重启网关使配置生效
    try {
      await execOpenClaw(['gateway', 'restart']);
      await new Promise((resolve) => setTimeout(resolve, 2500));
    } catch {
      try {
        await execa('pkill', ['-f', 'openclaw.*gateway']);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch {}
      const logFile = `${process.env.HOME}/.openclaw/logs/gateway.log`;
      execa('sh', [
        '-c',
        `nohup openclaw gateway run --bind loopback --port 18789 > ${logFile} 2>&1 &`,
      ]);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    return c.json({ success: true });
  } catch (error: any) {
    console.error('WhatsApp 配置失败:', error);
    return c.json(
      {
        success: false,
        error: '配置失败: ' + (error.message || '未知错误'),
      },
      500,
    );
  }
});
