import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { execOpenClaw, extractJson, extractPlainValue } from '../utils';
import {
  QWEN_OAUTH_CLIENT_ID,
  QWEN_OAUTH_SCOPE,
  QWEN_OAUTH_GRANT_TYPE,
  QWEN_OAUTH_DEVICE_CODE_ENDPOINT,
  QWEN_OAUTH_TOKEN_ENDPOINT,
  toFormUrlEncoded,
  generatePkce,
  syncAuthProfile,
  syncGatewayEnvVar,
  mergeDefaultModels,
  getLoginOpenAICodex,
  writeOpenAICodexCredentials,
  applyOpenAICodexConfig,
  writeQwenOAuthToken,
  applyQwenConfig,
} from './common';

export const modelsRouter = new Hono();

type QwenDeviceSession = {
  sessionId: string;
  deviceCode: string;
  verifier: string;
  expiresAt: number;
  intervalMs: number;
};

const qwenDeviceSessions = new Map<string, QwenDeviceSession>();

type GptOAuthSession = {
  sessionId: string;
  status: 'pending' | 'success' | 'error';
  error?: string;
  authUrl?: string;
  startedAt: number;
};

const gptOAuthSessions = new Map<string, GptOAuthSession>();

async function requestQwenDeviceCode(params: { challenge: string }) {
  const response = await fetch(QWEN_OAUTH_DEVICE_CODE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'x-request-id': randomUUID(),
    },
    body: toFormUrlEncoded({
      client_id: QWEN_OAUTH_CLIENT_ID,
      scope: QWEN_OAUTH_SCOPE,
      code_challenge: params.challenge,
      code_challenge_method: 'S256',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Qwen device authorization failed: ${text || response.statusText}`);
  }

  const payload = (await response.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    verification_uri_complete?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
  };

  if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
    throw new Error(
      payload.error ??
        'Qwen device authorization returned an incomplete payload (missing user_code or verification_uri).'
    );
  }

  return payload as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval?: number;
  };
}

async function pollQwenToken(params: { deviceCode: string; verifier: string }) {
  const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: toFormUrlEncoded({
      grant_type: QWEN_OAUTH_GRANT_TYPE,
      client_id: QWEN_OAUTH_CLIENT_ID,
      device_code: params.deviceCode,
      code_verifier: params.verifier,
    }),
  });

  if (!response.ok) {
    let payload: { error?: string; error_description?: string } | undefined;
    try {
      payload = (await response.json()) as { error?: string; error_description?: string };
    } catch {
      const text = await response.text();
      return { status: 'error', message: text || response.statusText } as const;
    }

    if (payload?.error === 'authorization_pending') {
      return { status: 'pending' } as const;
    }

    if (payload?.error === 'slow_down') {
      return { status: 'pending', slowDown: true } as const;
    }

    return {
      status: 'error',
      message: payload?.error_description || payload?.error || response.statusText,
    } as const;
  }

  const tokenPayload = (await response.json()) as {
    access_token?: string | null;
    refresh_token?: string | null;
    expires_in?: number | null;
    resource_url?: string;
  };

  if (!tokenPayload.access_token || !tokenPayload.refresh_token || !tokenPayload.expires_in) {
    return { status: 'error', message: 'Qwen OAuth returned incomplete token payload.' } as const;
  }

  return {
    status: 'success',
    token: {
      access: tokenPayload.access_token,
      refresh: tokenPayload.refresh_token,
      expires: Date.now() + tokenPayload.expires_in * 1000,
      resourceUrl: tokenPayload.resource_url,
    },
  } as const;
}

// 配置模型
modelsRouter.post('/model', async (c) => {
  try {
    const { provider, token, custom } = await c.req.json();

    if (!provider) {
      return c.json({ success: false, error: '请选择模型提供商' }, 400);
    }

    let result;

    switch (provider) {
      case 'minimax':
        if (!token) {
          return c.json({ success: false, error: '请提供 MiniMax API Key' }, 400);
        }
        
        // 同步 key 到所有存储位置，确保 gateway 和 CLI 都能正确读取
        syncAuthProfile('minimax', token);
        syncGatewayEnvVar('MINIMAX_API_KEY', token);

        await execOpenClaw([
          'config',
          'set',
          '--json',
          'models.providers.minimax',
          JSON.stringify({
            baseUrl: 'https://api.minimax.io/anthropic',
            api: 'anthropic-messages',
            apiKey: token,
            models: [
              {
                id: 'MiniMax-M2.5',
                name: 'MiniMax M2.5',
                reasoning: false,
                input: ['text'],
                cost: {
                  input: 15,
                  output: 60,
                  cacheRead: 2,
                  cacheWrite: 10,
                },
                contextWindow: 200000,
                maxTokens: 8192,
              },
            ],
          }),
        ]);

        // 将模型注册到 agents.defaults.models（合并，不丢失已有模型）
        await mergeDefaultModels({
          'minimax/MiniMax-M2.5': {},
        });

        // 设置为默认模型
        await execOpenClaw([
          'config',
          'set',
          '--json',
          'agents.defaults.model',
          JSON.stringify({ primary: 'minimax/MiniMax-M2.5' }),
        ]);

        result = { provider: 'minimax', model: 'MiniMax-M2.5' };
        break;

      case 'gpt':
        // OpenAI Codex 使用内置 ChatGPT OAuth，无需插件
        result = {
          provider: 'gpt',
          requiresOAuth: true,
          oauthMode: 'auto',
        };
        break;

      case 'qwen':
        // 启用千问插件
        await execOpenClaw(['plugins', 'enable', 'qwen-portal-auth']);
        // 使用设备码流程（无需 TTY）
        result = {
          provider: 'qwen',
          requiresOAuth: true,
          oauthMode: 'device',
        };
        break;

      case 'custom': {
        // 第三方模型（OpenAI 兼容 API）
        if (!custom || !custom.baseUrl || !custom.apiKey || !custom.modelId) {
          return c.json({ success: false, error: '请填写 API Base URL、API Key 和模型 ID' }, 400);
        }

        const {
          baseUrl,
          apiKey,
          modelId,
          inputTypes = ['text'],
          setDefault = false,
        } = custom;

        // 从 Base URL 自动提取提供商名称
        let providerName: string;
        try {
          const hostname = new URL(baseUrl).hostname;
          const parts = hostname.split('.');
          if (parts.length >= 2) {
            providerName = parts.length > 2 ? parts[parts.length - 2] : parts[0];
          } else {
            providerName = parts[0];
          }
          providerName = providerName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        } catch {
          return c.json({ success: false, error: 'API Base URL 格式不正确' }, 400);
        }

        if (!providerName) {
          return c.json({ success: false, error: '无法从 URL 中提取提供商名称，请检查 API Base URL' }, 400);
        }

        const modelKey = `${providerName}/${modelId}`;

        // 构造新模型配置
        const newModelConfig = {
          id: modelId,
          name: modelId,
          reasoning: false,
          input: Array.isArray(inputTypes) && inputTypes.length > 0 ? inputTypes : ['text'],
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
          },
          contextWindow: 200000,
          maxTokens: 8192,
        };

        // 读取现有配置以支持合并多个模型
        let existingConfig: any = {};
        try {
          const result = await execOpenClaw(['config', 'get', '--json', `models.providers.${providerName}`]);
          existingConfig = extractJson(String(result.stdout)) || {};
        } catch {}

        let models: any[] = [];
        if (existingConfig && Array.isArray(existingConfig.models)) {
             models = existingConfig.models;
        }

        // 如果模型ID已存在则更新，否则追加
        const existingIndex = models.findIndex((m: any) => m.id === modelId);
        if (existingIndex !== -1) {
            models[existingIndex] = newModelConfig;
        } else {
            models.push(newModelConfig);
        }

        // 配置第三方提供商（使用 OpenAI 兼容 API）
        await execOpenClaw([
          'config',
          'set',
          '--json',
          `models.providers.${providerName}`,
          JSON.stringify({
            baseUrl,
            apiKey,
            api: 'openai-completions',
            models: models,
          }),
        ]);

        // 将模型注册到 agents.defaults.models
        await mergeDefaultModels({
          [modelKey]: {},
        });

        // 如果勾选了设为默认，则更新默认模型
        if (setDefault) {
          await execOpenClaw([
            'config',
            'set',
            '--json',
            'agents.defaults.model',
            JSON.stringify({ primary: modelKey }),
          ]);
        }

        result = { provider: providerName, model: modelId };
        break;
      }

      default:
        return c.json({ success: false, error: '不支持的模型提供商' }, 400);
    }

    return c.json({ success: true, data: result });
  } catch (error: any) {
    console.error('配置模型失败:', error);
    return c.json(
      {
        success: false,
        error: '配置失败: ' + (error.message || '未知错误'),
      },
      500
    );
  }
});

// 千问 OAuth: 设备码流程
modelsRouter.post('/qwen-oauth/start', async (c) => {
  try {
    const { verifier, challenge } = generatePkce();
    const device = await requestQwenDeviceCode({ challenge });
    const sessionId = randomUUID();
    const expiresAt = Date.now() + device.expires_in * 1000;
    const intervalMs = (device.interval ?? 2) * 1000;
    qwenDeviceSessions.set(sessionId, {
      sessionId,
      deviceCode: device.device_code,
      verifier,
      expiresAt,
      intervalMs,
    });
    return c.json({
      success: true,
      data: {
        sessionId,
        verificationUrl: device.verification_uri_complete || device.verification_uri,
        userCode: device.user_code,
        expiresIn: device.expires_in,
        interval: device.interval ?? 2,
      },
    });
  } catch (error: any) {
    console.error('启动千问 OAuth 失败:', error);
    return c.json(
      {
        success: false,
        error: '启动千问 OAuth 失败: ' + (error.message || '未知错误'),
      },
      500
    );
  }
});

// GPT OAuth: 使用 loginOpenAICodex (ChatGPT OAuth) 启动授权流程
modelsRouter.post('/gpt-oauth/start', async (c) => {
  try {
    const loginOpenAICodex = await getLoginOpenAICodex();
    const sessionId = randomUUID();

    const session: GptOAuthSession = {
      sessionId,
      status: 'pending',
      startedAt: Date.now(),
    };
    gptOAuthSessions.set(sessionId, session);

    // 启动 ChatGPT OAuth 流程（异步，不 await）
    loginOpenAICodex({
      onAuth: (info: { url: string; instructions?: string }) => {
        // 捕获授权 URL
        const currentSession = gptOAuthSessions.get(sessionId);
        if (currentSession) {
          currentSession.authUrl = info.url;
        }
      },
      onPrompt: async (prompt: { message: string }) => {
        // 手动粘贴回调 URL 的 fallback（在浏览器回调失败时使用）
        // 在 web UI 中暂不支持，返回空字符串等待浏览器回调
        console.log('OpenAI OAuth prompt:', prompt.message);
        return '';
      },
      onProgress: (msg: string) => {
        console.log('OpenAI OAuth progress:', msg);
      },
    }).then(async (creds: any) => {
      const currentSession = gptOAuthSessions.get(sessionId);
      if (currentSession) {
        try {
          // 写入凭据到 auth-profiles.json
          writeOpenAICodexCredentials(creds);
          // 设置默认模型
          await applyOpenAICodexConfig();
          currentSession.status = 'success';
          console.log('OpenAI Codex OAuth 认证成功');
        } catch (err: any) {
          currentSession.status = 'error';
          currentSession.error = '保存凭据失败: ' + (err.message || '未知错误');
          console.error('保存 OpenAI Codex 凭据失败:', err);
        }
      }
    }).catch((err: any) => {
      const currentSession = gptOAuthSessions.get(sessionId);
      if (currentSession) {
        currentSession.status = 'error';
        currentSession.error = 'ChatGPT OAuth 失败: ' + (err.message || '未知错误');
      }
      console.error('OpenAI Codex OAuth 失败:', err);
    });

    // 等待 onAuth 回调获取授权 URL
    await new Promise(resolve => setTimeout(resolve, 3000));

    const authUrl = session.authUrl || '';
    if (!authUrl) {
      // 如果还没拿到 URL，再等一下
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return c.json({
      success: true,
      data: {
        sessionId,
        authUrl: session.authUrl || 'https://chatgpt.com',
        message: '请在浏览器中完成 ChatGPT 授权',
      },
    });
  } catch (error: any) {
    console.error('启动 GPT OAuth 失败:', error);
    return c.json(
      {
        success: false,
        error: '启动 GPT OAuth 失败: ' + (error.message || '未知错误'),
      },
      500
    );
  }
});

// GPT OAuth: 轮询状态
modelsRouter.post('/gpt-oauth/poll', async (c) => {
  try {
    const { sessionId } = await c.req.json();
    const session = gptOAuthSessions.get(sessionId);
    
    if (!session) {
      return c.json({ success: false, error: '无效的会话，请重新开始登录' }, 400);
    }

    // 检查超时（5分钟）
    if (Date.now() - session.startedAt > 5 * 60 * 1000) {
      gptOAuthSessions.delete(sessionId);
      return c.json({ success: false, error: '登录已超时，请重新开始' }, 400);
    }

    if (session.status === 'pending') {
      return c.json({ success: true, data: { status: 'pending' } });
    }

    if (session.status === 'error') {
      gptOAuthSessions.delete(sessionId);
      return c.json({ success: false, error: session.error || '认证失败' }, 500);
    }

    // 成功
    gptOAuthSessions.delete(sessionId);
    return c.json({ success: true, data: { status: 'success' } });
  } catch (error: any) {
    console.error('轮询 GPT OAuth 失败:', error);
    return c.json(
      {
        success: false,
        error: '轮询失败: ' + (error.message || '未知错误'),
      },
      500
    );
  }
});

modelsRouter.post('/qwen-oauth/poll', async (c) => {
  try {
    const { sessionId } = await c.req.json();
    const session = qwenDeviceSessions.get(sessionId);
    if (!session) {
      return c.json({ success: false, error: '无效的会话，请重新开始登录' }, 400);
    }
    if (Date.now() > session.expiresAt) {
      qwenDeviceSessions.delete(sessionId);
      return c.json({ success: false, error: '登录已过期，请重新开始' }, 400);
    }

    const result = await pollQwenToken({
      deviceCode: session.deviceCode,
      verifier: session.verifier,
    });

    if (result.status === 'pending') {
      return c.json({ success: true, data: { status: 'pending' } });
    }

    if (result.status === 'error') {
      return c.json({ success: false, error: result.message }, 500);
    }

    writeQwenOAuthToken(result.token);
    await applyQwenConfig(result.token.resourceUrl);
    qwenDeviceSessions.delete(sessionId);

    return c.json({ success: true, data: { status: 'success' } });
  } catch (error: any) {
    console.error('轮询千问 OAuth 失败:', error);
    return c.json(
      {
        success: false,
        error: '轮询千问 OAuth 失败: ' + (error.message || '未知错误'),
      },
      500
    );
  }
});

// 获取模型列表
modelsRouter.get('/models', async (c) => {
  try {
    const result = await execOpenClaw(['config', 'get', '--json', 'models.providers']);
    const providersJson = extractJson(String(result.stdout)) || {};

    let defaultModel: string | null = null;
    try {
      const res = await execOpenClaw(['config', 'get', 'agents.defaults.model.primary']);
      defaultModel = extractPlainValue(String(res.stdout)) || null;
    } catch {
      defaultModel = null;
    }

    const models: Array<{ key: string; label: string }> = [];
    Object.entries(providersJson).forEach(([providerId, provider]: any) => {
      const list = Array.isArray(provider?.models) ? provider.models : [];
      list.forEach((model: any) => {
        const id = model?.id || model?.name || 'unknown';
        const name = model?.name || model?.id || id;
        models.push({
          key: `${providerId}/${id}`,
          label: `${name} (${providerId})`,
        });
      });
    });

    return c.json({ success: true, data: { models, defaultModel } });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: '获取模型列表失败: ' + (error.message || '未知错误'),
      },
      500
    );
  }
});

// 切换默认模型
modelsRouter.post('/models/default', async (c) => {
  try {
    const { model } = await c.req.json();
    if (!model) {
      return c.json({ success: false, error: '缺少模型参数' }, 400);
    }
    await execOpenClaw([
      'config',
      'set',
      '--json',
      'agents.defaults.model',
      JSON.stringify({ primary: model }),
    ]);
    return c.json({ success: true });
  } catch (error: any) {
    return c.json(
      {
        success: false,
        error: '切换默认模型失败: ' + (error.message || '未知错误'),
      },
      500
    );
  }
});
