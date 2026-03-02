import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import { spawn } from 'node:child_process';
import { resolveRemoteSupportPath } from './common';

export const remoteSupportRouter = new Hono();

// 远程支持配置读取
remoteSupportRouter.get('/remote-support', async (c) => {
  try {
    const filePath = resolveRemoteSupportPath();
    if (!fs.existsSync(filePath)) {
      return c.json({ success: true, data: { sshKey: '', cpolarToken: '', region: 'eu' } });
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return c.json({
      success: true,
      data: {
        sshKey: data.sshKey || '',
        cpolarToken: data.cpolarToken || '',
        region: data.region || 'eu',
      },
    });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: '读取远程支持配置失败: ' + (error.message || '未知错误'),
      },
      500
    );
  }
});

// 远程支持配置保存
remoteSupportRouter.post('/remote-support', async (c) => {
  try {
    const { sshKey, cpolarToken, region } = await c.req.json();
    const filePath = resolveRemoteSupportPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          sshKey: sshKey || '',
          cpolarToken: cpolarToken || '',
          region: region || 'eu',
        },
        null,
        2
      )
    );
    return c.json({ success: true });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: '保存远程支持配置失败: ' + (error.message || '未知错误'),
      },
      500
    );
  }
});

// 启动远程支持
remoteSupportRouter.post('/remote-support/start', async (c) => {
  try {
    const { sshKey, cpolarToken, region } = await c.req.json();
    if (!sshKey) {
      return c.json({ success: false, error: '请填写 SSH Key' }, 400);
    }

    // ── 先终止所有已有 cpolar 进程，避免多实例冲突 ──
    try { await execa('pkill', ['cpolar']); } catch {}
    for (let w = 0; w < 10; w++) {
      await new Promise(r => setTimeout(r, 300));
      try {
        await execa('pgrep', ['cpolar']);
      } catch { break; }
    }
    try { await execa('pkill', ['-9', 'cpolar']); } catch {}
    await new Promise(r => setTimeout(r, 500));

    const logFile = `${process.env.HOME}/.openclaw/logs/cpolar.log`;
    const logDir = path.dirname(logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    // 清空旧日志
    fs.writeFileSync(logFile, '');

    // 只有填了 AuthToken 才重新设置，否则用 cpolar 已有的认证
    if (cpolarToken) {
      await execa('cpolar', ['authtoken', cpolarToken]);
    }
    // 用 spawn 以 detached 模式启动 cpolar，避免 execa await 阻塞
    const cpolarChild = spawn('cpolar', ['tcp', `-region=${region}`, `-log=${logFile}`, '-log-level=INFO', '-daemon=on', '22'], {
      detached: true,
      stdio: 'ignore',
    });
    cpolarChild.unref();

    // 轮询等待 Tunnel established（最多 30 秒，从日志读取 + API 备选）
    let forwarding = '';
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      // 从日志读取
      try {
        const log = fs.readFileSync(logFile, 'utf-8');
        const match = log.match(/Tunnel established at (tcp:\/\/\S+)/);
        if (match) {
          forwarding = match[1];
          break;
        }
        if (log.includes('auth failed') || log.includes('authentication failed')) {
          return c.json({ success: false, error: 'cpolar 认证失败，请检查 AuthToken' }, 400);
        }
      } catch {}
      // 备选：通过 API 获取
      try {
        const resp = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: AbortSignal.timeout(1000) });
        if (resp.ok) {
          const text = await resp.text();
          if (text) {
            const json = JSON.parse(text) as any;
            const tunnels = json?.tunnels || [];
            for (const t of tunnels) {
              if (t.public_url && t.public_url.startsWith('tcp://')) {
                forwarding = t.public_url;
                break;
              }
            }
          }
        }
      } catch {}
      if (forwarding) break;
    }

    return c.json({ success: true, forwarding });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: '启动远程支持失败: ' + (error.message || '未知错误'),
      },
      500
    );
  }
});

// 关闭远程支持
remoteSupportRouter.post('/remote-support/stop', async (c) => {
  try {
    try {
      await execa('pkill', ['cpolar']);
    } catch {
      // pkill 在没找到进程时会返回非 0 退出码，忽略
    }
    await new Promise((r) => setTimeout(r, 1000));
    // 检查是否还在运行
    let stillRunning = false;
    try {
      await execa('pgrep', ['cpolar']);
      stillRunning = true;
    } catch {}
    if (stillRunning) {
      try {
        await execa('pkill', ['-9', 'cpolar']);
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    return c.json({ success: true });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: '关闭远程支持失败: ' + (error.message || '未知错误'),
      },
      500
    );
  }
});
