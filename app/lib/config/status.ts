import { Hono } from 'hono';
import { getOpenClawStatus } from '../status';

export const statusRouter = new Hono();

// 获取当前配置
statusRouter.get('/status', async (c) => {
  try {
    const config = await getOpenClawStatus();
    return c.json({ success: true, data: config });
  } catch (error: any) {
    console.error('获取状态失败:', error);
    return c.json(
      {
        success: false,
        error: '获取状态失败: ' + (error.message || '未知错误'),
      },
      500
    );
  }
});
