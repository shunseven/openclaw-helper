import { Hono } from 'hono';
import { execOpenClaw, extractJson } from '../utils';

export const channelsRouter = new Hono();

// 获取渠道配置
channelsRouter.get('/channels', async (c) => {
  try {
    const result = await execOpenClaw(['config', 'get', '--json', 'channels']);
    const channelsJson = extractJson(String(result.stdout)) || {};
    const channels = Object.entries(channelsJson).map(([id, value]: any) => ({
      id,
      label: id.toUpperCase(),
      enabled: value?.enabled !== false,
    }));
    return c.json({ success: true, data: { channels } });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: '获取渠道配置失败: ' + (error.message || '未知错误'),
      },
      500
    );
  }
});
