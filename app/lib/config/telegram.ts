import { Hono } from 'hono';
import { execa } from 'execa';
import { execOpenClaw, extractJson, extractPlainValue, startGateway } from '../utils';

export const telegramRouter = new Hono();

// 获取 Telegram 已有配置
telegramRouter.get('/telegram', async (c) => {
  try {
    let botToken = '';
    let userId = '';

    try {
      const result = await execOpenClaw(['config', 'get', 'channels.telegram.botToken']);
      botToken = extractPlainValue(String(result.stdout)).replace(/^"|"$/g, '');
    } catch {}

    try {
      const result = await execOpenClaw(['config', 'get', '--json', 'channels.telegram.allowFrom']);
      const parsed = extractJson(String(result.stdout));
      if (Array.isArray(parsed) && parsed.length > 0) {
        userId = String(parsed[0]);
      }
    } catch {}

    return c.json({
      success: true,
      data: {
        configured: !!(botToken && userId),
        botToken,
        userId,
      },
    });
  } catch (error: any) {
    return c.json({ success: true, data: { configured: false, botToken: '', userId: '' } });
  }
});

// 配置 Telegram
telegramRouter.post('/telegram', async (c) => {
  try {
    const { token, userId, skip } = await c.req.json();

    if (skip) {
      return c.json({ success: true, skipped: true });
    }

    if (!token || !userId) {
      return c.json({ success: false, error: '请提供 Telegram Bot Token 和用户 ID' }, 400);
    }

    // 配置 Telegram (新路径 channels.telegram)
    await execOpenClaw(['config', 'set', '--json', 'channels.telegram.botToken', JSON.stringify(token)]);
    await execOpenClaw([
      'config',
      'set',
      '--json',
      'channels.telegram.allowFrom',
      JSON.stringify([userId]),
    ]);

    // 重启 gateway
    try {
      await execa('pkill', ['-f', 'openclaw.*gateway']);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch {
      // 进程可能不存在,忽略错误
    }

    // 启动 gateway
    const logFile = `${process.env.HOME}/.openclaw/logs/gateway.log`;
    await startGateway(logFile);

    await new Promise((resolve) => setTimeout(resolve, 3000));

    return c.json({
      success: true,
      data: {
        token: token.substring(0, 10) + '...',
        userId,
      },
    });
  } catch (error: any) {
    console.error('配置 Telegram 失败:', error);
    return c.json(
      {
        success: false,
        error: '配置失败: ' + (error.message || '未知错误'),
      },
      500
    );
  }
});
