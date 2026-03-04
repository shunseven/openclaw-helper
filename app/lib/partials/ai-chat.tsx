import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
  AIMessageChunk,
  type BaseMessage,
} from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { execOpenClaw, extractJson, extractPlainValue } from '../utils'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const aiChatRouter = new Hono()

// ─── Config ───

const CONFIG_DIR = path.join(os.homedir(), '.openclaw-helper')
const CONFIG_FILE = path.join(CONFIG_DIR, 'ai-chat-config.json')

interface AIChatConfig {
  apiKey: string
  model: string
  baseUrl: string
}

function loadConfig(): AIChatConfig | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
    }
  } catch {}
  return null
}

function saveConfig(config: AIChatConfig) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

async function resolveConfig(): Promise<AIChatConfig | null> {
  const local = loadConfig()
  if (local?.apiKey) return local

  try {
    const { stdout } = await execOpenClaw(['config', 'get', '--json', 'models.providers.minimax'])
    const oc = extractJson(stdout as string)
    if (oc?.apiKey) {
      const models = Array.isArray(oc.models) ? oc.models : []
      return {
        apiKey: oc.apiKey,
        model: models[0]?.id || 'MiniMax-Text-01',
        baseUrl: oc.baseUrl || 'https://api.minimax.chat/v1',
      }
    }
  } catch {}
  return null
}

// ─── Session ───

interface ChatSession {
  messages: BaseMessage[]
  createdAt: number
}

const sessions = new Map<string, ChatSession>()

function getOrCreateSession(id?: string): { session: ChatSession; sessionId: string } {
  if (id && sessions.has(id)) return { session: sessions.get(id)!, sessionId: id }
  const sessionId = id || crypto.randomUUID()
  const session: ChatSession = { messages: [], createdAt: Date.now() }
  sessions.set(sessionId, session)
  return { session, sessionId }
}

// ─── System Prompt ───

const SYSTEM_PROMPT = `你是 OpenClaw 智能修复助手，专门帮助用户诊断和修复 OpenClaw 系统的各种问题。请始终使用中文回复。

## 你的能力
你可以通过工具执行以下操作：
1. 执行 OpenClaw CLI 命令 (exec_openclaw) — 检查配置、状态、执行修复
2. 读取日志文件 (read_log_file) — 分析错误日志
3. 列出日志文件 (list_log_files) — 查看可用日志
4. 运行 Shell 命令 (run_shell_command) — 检查系统状态

## OpenClaw 架构概览
OpenClaw 是一个 AI 助手系统，核心组件包括：
- **Gateway**: HTTP/WebSocket 网关，默认端口 18789，处理消息路由和认证
- **Agent Runner**: 在容器中运行的 AI 代理，负责实际的任务执行
- **Config**: 配置系统，通过 \`openclaw config\` 命令管理
- **Channels**: 消息渠道（Telegram、WhatsApp 等）
- **Skills**: 技能模块，扩展 AI 能力

## 常用诊断命令
| 命令 | 用途 |
|------|------|
| \`openclaw config list --json\` | 查看所有配置 |
| \`openclaw config get --json models.providers\` | 查看模型提供商 |
| \`openclaw config get agents.defaults.model.primary\` | 查看默认模型 |
| \`openclaw config get --json gateway\` | 查看 Gateway 配置 |
| \`openclaw config get --json channels\` | 查看渠道配置 |

## 日志位置
- Gateway 日志: \`~/.openclaw/logs/gateway.log\`
- 系统日志目录: \`~/.openclaw/logs/\`
- macOS launchd 日志: \`~/Library/Logs/nanoclaw/\`
- 也可以通过 \`journalctl --user -u nanoclaw\` 查看 systemd 日志 (Linux)

## 常见问题排查

### Gateway 无法启动
1. 检查端口是否被占用: \`lsof -i :18789\`
2. 检查 Gateway Token 是否有效: \`openclaw config get gateway.auth.token\`
3. 查看 Gateway 日志中的错误
4. 尝试重启: 先停止进程再重新启动

### 模型配置问题
1. 检查 API Key 是否正确配置
2. 确认 Base URL 格式正确
3. 确认模型 ID 存在且拼写正确
4. 检查默认模型是否已设置

### 渠道连接问题
1. Telegram: 检查 Bot Token 有效性，确认 webhook 或 polling 正常
2. WhatsApp: 检查 session 文件状态，可能需要重新扫码
3. 查看对应渠道的日志输出

### 容器/Agent 问题
1. 检查 Docker/容器运行时是否正常
2. 查看容器日志
3. 确认环境变量和 secrets 正确传递

## 工作原则
1. **先诊断，后修复** — 不要盲目修改配置
2. **操作前告知** — 修复前明确告知用户即将执行的操作
3. **逐步修复** — 每次只做一个修改，验证后再继续
4. **验证结果** — 操作完成后检查是否生效
5. **简洁明了** — 用清晰的中文回复，附带具体的命令和说明`

const AUTO_FIX_PROMPT = `请自动诊断当前 OpenClaw 系统的健康状态。按照以下步骤进行：

1. 先执行 \`openclaw config list --json\` 检查整体配置
2. 检查 Gateway 状态和配置
3. 检查默认模型是否配置正确
4. 检查渠道配置
5. 查看最近的日志文件，寻找错误信息
6. 汇总发现的问题，并给出具体的修复建议

如果发现问题，请逐一列出并给出修复命令。对于可以安全自动修复的问题，直接执行修复。`

// ─── Tools ───

function createTools(): DynamicStructuredTool[] {
  return [
    new DynamicStructuredTool({
      name: 'exec_openclaw',
      description:
        '执行 OpenClaw CLI 命令。用于检查配置、查看状态、修改配置等。' +
        '参数是传给 openclaw 命令的参数列表，例如 ["config","get","--json","models.providers"]',
      schema: z.object({
        args: z.array(z.string()).describe('传给 openclaw CLI 的参数列表'),
      }),
      func: async ({ args }) => {
        try {
          const { stdout, stderr } = await execOpenClaw(args)
          const out = (stdout || '').toString().slice(0, 8000)
          const err = (stderr || '').toString().slice(0, 2000)
          return err ? `stdout:\n${out}\nstderr:\n${err}` : out
        } catch (e: any) {
          return `命令执行失败: ${e.message}\nstdout: ${e.stdout || ''}\nstderr: ${e.stderr || ''}`
        }
      },
    }),
    new DynamicStructuredTool({
      name: 'read_log_file',
      description:
        '读取 OpenClaw 日志文件。可以指定文件名（在 ~/.openclaw/logs/ 下查找）或绝对路径。可选指定尾部行数。',
      schema: z.object({
        filePath: z.string().describe('日志文件名或绝对路径'),
        tailLines: z.number().optional().describe('只读取最后 N 行，默认读取全部（最多 10000 字符）'),
      }),
      func: async ({ filePath, tailLines }) => {
        try {
          const fullPath = filePath.startsWith('/')
            ? filePath
            : path.join(os.homedir(), '.openclaw/logs', filePath)
          if (!fs.existsSync(fullPath)) return `文件不存在: ${fullPath}`
          const content = fs.readFileSync(fullPath, 'utf-8')
          if (tailLines) {
            return content.split('\n').slice(-tailLines).join('\n')
          }
          return content.length > 10000 ? '...(前面内容省略)\n' + content.slice(-10000) : content
        } catch (e: any) {
          return `读取失败: ${e.message}`
        }
      },
    }),
    new DynamicStructuredTool({
      name: 'list_log_files',
      description: '列出 OpenClaw 日志目录中的所有文件。',
      schema: z.object({}),
      func: async () => {
        const dirs = [
          path.join(os.homedir(), '.openclaw/logs'),
          path.join(os.homedir(), 'Library/Logs/nanoclaw'),
        ]
        const results: string[] = []
        for (const dir of dirs) {
          try {
            if (!fs.existsSync(dir)) continue
            const files = fs.readdirSync(dir).map((f) => {
              const stat = fs.statSync(path.join(dir, f))
              return `${f}  (${stat.size} bytes, ${stat.mtime.toISOString()})`
            })
            results.push(`📂 ${dir}\n${files.join('\n')}`)
          } catch {}
        }
        return results.length > 0 ? results.join('\n\n') : '未找到日志目录'
      },
    }),
    new DynamicStructuredTool({
      name: 'run_shell_command',
      description:
        '运行 Shell 命令来检查系统状态。仅用于只读诊断命令，如 ps、lsof、systemctl status 等。',
      schema: z.object({
        command: z.string().describe('要执行的 Shell 命令'),
      }),
      func: async ({ command }) => {
        try {
          const { execa: ex } = await import('execa')
          const { stdout, stderr } = await ex('sh', ['-c', command], { timeout: 30000 })
          const out = (stdout || '').slice(0, 8000)
          const err = (stderr || '').slice(0, 2000)
          return err ? `stdout:\n${out}\nstderr:\n${err}` : out || '(无输出)'
        } catch (e: any) {
          return `命令执行失败: ${e.message}`
        }
      },
    }),
  ]
}

// ─── LangChain Model ───

function isAnthropicEndpoint(baseUrl: string): boolean {
  return /anthropic/i.test(baseUrl)
}

function createModel(config: AIChatConfig): BaseChatModel {
  if (isAnthropicEndpoint(config.baseUrl)) {
    return new ChatAnthropic({
      anthropicApiKey: config.apiKey,
      clientOptions: { baseURL: config.baseUrl },
      model: config.model,
      maxTokens: 8192,
      temperature: 0.7,
      streaming: true,
    })
  }
  return new ChatOpenAI({
    apiKey: config.apiKey,
    configuration: { baseURL: config.baseUrl },
    model: config.model,
    temperature: 0.7,
    streaming: true,
  })
}

// ─── Streaming Chat Loop ───

const MAX_TOOL_TURNS = 8

type SseWriter = {
  writeSSE: (msg: { data: string; event?: string; id?: string }) => Promise<void>
}

/**
 * Extract incremental text from a stream chunk.
 * OpenAI format: chunk.content is a string.
 * Anthropic format: chunk.content is an array of content blocks like
 *   [{index, type:"text", text:"..."}, {index, type:"thinking", thinking:"..."}]
 */
function extractChunkText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text' && b.text)
      .map((b: any) => b.text)
      .join('')
  }
  return ''
}

/** Extract the full text from a completed message's content (same dual format). */
function extractFullText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text' && b.text)
      .map((b: any) => b.text)
      .join('')
  }
  return ''
}

async function runChatStream(
  session: ChatSession,
  model: BaseChatModel,
  tools: DynamicStructuredTool[],
  stream: SseWriter,
  userMessage: string,
) {
  session.messages.push(new HumanMessage(userMessage))

  const allMessages: BaseMessage[] = [new SystemMessage(SYSTEM_PROMPT), ...session.messages]

  let useTools = true

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    let fullMessage: AIMessageChunk | undefined
    let textContent = ''

    try {
      const activeModel = useTools && tools.length > 0 ? model.bindTools(tools) : model
      const responseStream = await activeModel.stream(allMessages)

      for await (const chunk of responseStream) {
        fullMessage = fullMessage ? fullMessage.concat(chunk) : chunk
        const text = extractChunkText(chunk.content)
        if (text) {
          textContent += text
          await stream.writeSSE({ data: JSON.stringify({ type: 'text', content: text }) })
        }
      }
    } catch (err: any) {
      if (useTools && turn === 0) {
        useTools = false
        const fallbackStream = await model.stream(allMessages)
        for await (const chunk of fallbackStream) {
          const text = extractChunkText(chunk.content)
          if (text) {
            textContent += text
            await stream.writeSSE({ data: JSON.stringify({ type: 'text', content: text }) })
          }
        }
        session.messages.push(new AIMessage(textContent))
        allMessages.push(new AIMessage(textContent))
        break
      }
      throw err
    }

    if (!fullMessage) break

    // For Anthropic, textContent from chunks may be incomplete; re-extract from concatenated message
    if (!textContent && fullMessage.content) {
      textContent = extractFullText(fullMessage.content)
      if (textContent) {
        await stream.writeSSE({ data: JSON.stringify({ type: 'text', content: textContent }) })
      }
    }

    const toolCalls = fullMessage.tool_calls || []

    if (toolCalls.length === 0) {
      const aiMsg = new AIMessage(textContent)
      session.messages.push(aiMsg)
      allMessages.push(aiMsg)
      break
    }

    const aiMsg = new AIMessage({ content: fullMessage.content, tool_calls: toolCalls })
    session.messages.push(aiMsg)
    allMessages.push(aiMsg)

    for (const tc of toolCalls) {
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'tool_start',
          name: tc.name,
          args: tc.args,
        }),
      })

      let resultStr: string
      try {
        const matchedTool = tools.find((t) => t.name === tc.name)
        if (!matchedTool) throw new Error(`未知工具: ${tc.name}`)
        const result = await matchedTool.invoke(tc.args)
        resultStr = typeof result === 'string' ? result : JSON.stringify(result)
      } catch (toolErr: any) {
        resultStr = `执行失败: ${toolErr.message}`
      }

      const display = resultStr.length > 1500 ? resultStr.slice(0, 1500) + '…(已截断)' : resultStr
      await stream.writeSSE({
        data: JSON.stringify({ type: 'tool_end', name: tc.name, result: display }),
      })

      const toolMsg = new ToolMessage({ content: resultStr, tool_call_id: tc.id! })
      session.messages.push(toolMsg)
      allMessages.push(toolMsg)
    }
  }
}

// ─── Routes ───

aiChatRouter.get('/ai-chat/config', async (c) => {
  const config = await resolveConfig()
  return c.json({
    configured: !!config?.apiKey,
    model: config?.model || '',
    baseUrl: config?.baseUrl || 'https://api.minimax.chat/v1',
  })
})

aiChatRouter.post('/ai-chat/config', async (c) => {
  const body = await c.req.json()
  const config: AIChatConfig = {
    apiKey: (body.apiKey || '').trim(),
    model: (body.model || 'MiniMax-Text-01').trim(),
    baseUrl: (body.baseUrl || 'https://api.minimax.chat/v1').trim(),
  }
  if (!config.apiKey) return c.json({ success: false, error: '请填写 API Key' }, 400)
  saveConfig(config)
  return c.json({ success: true })
})

aiChatRouter.post('/ai-chat/session/new', async (c) => {
  const sessionId = crypto.randomUUID()
  sessions.set(sessionId, { messages: [], createdAt: Date.now() })
  return c.json({ sessionId })
})

aiChatRouter.post('/ai-chat/send', async (c) => {
  const body = await c.req.json()
  const { message, sessionId: reqSessionId, autoFix } = body as {
    message?: string
    sessionId?: string
    autoFix?: boolean
  }

  const config = await resolveConfig()
  if (!config?.apiKey) {
    return c.json({ error: '请先配置 MiniMax API Key' }, 400)
  }

  const prompt = autoFix ? AUTO_FIX_PROMPT : (message || '').trim()
  if (!prompt) return c.json({ error: '消息不能为空' }, 400)

  const { session, sessionId } = getOrCreateSession(reqSessionId)
  const model = createModel(config)
  const tools = createTools()

  return streamSSE(c, async (sseStream) => {
    try {
      await runChatStream(session, model, tools, sseStream, prompt)
      await sseStream.writeSSE({ data: JSON.stringify({ type: 'done', sessionId }) })
    } catch (err: any) {
      await sseStream.writeSSE({
        data: JSON.stringify({ type: 'error', message: err.message || '未知错误' }),
      })
    }
  })
})
