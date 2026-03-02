import { Hono } from 'hono';
import { execa } from 'execa';
import { execOpenClaw, extractJson, startGateway } from '../utils';

export const webSearchRouter = new Hono();

// 获取 Web 搜索配置状态
webSearchRouter.get('/web-search', async (c) => {
  try {
    let searchEnabled = false;
    let apiKey = '';
    let fetchEnabled = false;

    try {
      const result = await execOpenClaw(['config', 'get', '--json', 'tools.web.search']);
      const parsed = extractJson(String(result.stdout));
      if (parsed) {
        searchEnabled = parsed.enabled !== false;
        apiKey = parsed.apiKey || '';
      }
    } catch {}

    try {
      const result = await execOpenClaw(['config', 'get', '--json', 'tools.web.fetch']);
      const parsed = extractJson(String(result.stdout));
      if (parsed) {
        fetchEnabled = parsed.enabled !== false;
      }
    } catch {}

    // 判断是否已配置：有 apiKey 即视为已配置
    const configured = !!(apiKey && apiKey.trim());

    return c.json({
      success: true,
      data: {
        configured,
        searchEnabled,
        fetchEnabled,
        apiKey,
      },
    });
  } catch (error: any) {
    return c.json({
      success: true,
      data: { configured: false, searchEnabled: false, fetchEnabled: false, apiKey: '' },
    });
  }
});

// 配置 Web 搜索（Brave Search API）
webSearchRouter.post('/web-search', async (c) => {
  try {
    const { apiKey } = await c.req.json();

    if (!apiKey || !apiKey.trim()) {
      return c.json({ success: false, error: '请提供 Brave Search API Key' }, 400);
    }

    const trimmedKey = apiKey.trim();

    // 配置 tools.web.search（启用搜索 + 设置 Brave API Key）
    await execOpenClaw([
      'config',
      'set',
      '--json',
      'tools.web.search',
      JSON.stringify({
        enabled: true,
        apiKey: trimmedKey,
      }),
    ]);

    // 配置 tools.web.fetch（启用网页抓取）
    await execOpenClaw([
      'config',
      'set',
      '--json',
      'tools.web.fetch',
      JSON.stringify({
        enabled: true,
      }),
    ]);

    // 重启 gateway 使配置生效
    try {
      await execOpenClaw(['gateway', 'restart']);
    } catch (restartErr: any) {
      // 如果 gateway restart 命令不可用，尝试手动重启
      console.log('openclaw gateway restart 失败，尝试手动重启:', restartErr.message);
      try {
        await execa('pkill', ['-f', 'openclaw.*gateway']);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch {
        // 进程可能不存在，忽略
      }
      const logFile = `${process.env.HOME}/.openclaw/logs/gateway.log`;
      execa('sh', [
        '-c',
        `nohup openclaw gateway run --bind loopback --port 18789 > ${logFile} 2>&1 &`,
      ]);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    return c.json({ success: true, data: { message: 'Web 搜索配置成功，网关已重启' } });
  } catch (error: any) {
    console.error('配置 Web 搜索失败:', error);
    return c.json(
      {
        success: false,
        error: '配置失败: ' + (error.message || '未知错误'),
      },
      500
    );
  }
});
