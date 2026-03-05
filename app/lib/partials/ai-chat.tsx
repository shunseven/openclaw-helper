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
import { execOpenClaw } from '../utils'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const aiChatRouter = new Hono()

// ─── Config ───

const CONFIG_DIR = path.join(os.homedir(), '.openclaw-helper')
const CONFIG_FILE = path.join(CONFIG_DIR, 'ai-chat-config.json')

type KeySource = 'local' | 'openclaw' | ''

interface AIChatConfig {
  apiKey: string
  model: string
  baseUrl: string
}

interface ResolvedConfig extends AIChatConfig {
  keySource: KeySource
}

function loadConfig(): AIChatConfig | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
    }
  } catch {}
  return null
}

function loadOpenClawConfig(): AIChatConfig | null {
  const homeDir = os.homedir()
  const OPENCLAW_CONFIG = path.join(homeDir, '.openclaw', 'openclaw.json')
  try {
    if (!fs.existsSync(OPENCLAW_CONFIG)) return null
    const data = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'))
    const minimax = data?.models?.providers?.minimax
    if (!minimax) return null
    const models = Array.isArray(minimax.models) ? minimax.models : []

    // Prefer the real key from auth-profiles.json over the (possibly stale) value in openclaw.json
    let apiKey = minimax.apiKey || ''
    const authProfilePaths = [
      path.join(homeDir, '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json'),
      path.join(homeDir, '.openclaw', 'agents', 'main', 'auth-profiles.json'),
    ]
    for (const ap of authProfilePaths) {
      try {
        if (!fs.existsSync(ap)) continue
        const apData = JSON.parse(fs.readFileSync(ap, 'utf-8'))
        const profile = apData?.profiles?.['minimax:default']
        if (profile?.type === 'api_key' && profile.key) { apiKey = profile.key; break }
      } catch {}
    }

    if (!apiKey) return null
    return {
      apiKey,
      model: models[0]?.id || 'MiniMax-M2.5',
      baseUrl: minimax.baseUrl || 'https://api.minimax.io/anthropic',
    }
  } catch {}
  return null
}

function saveConfig(config: AIChatConfig) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

function resolveConfig(): ResolvedConfig | null {
  const local = loadConfig()
  if (local?.apiKey) return { ...local, keySource: 'local' }

  const oc = loadOpenClawConfig()
  if (oc?.apiKey) return { ...oc, keySource: 'openclaw' }

  return null
}

// ─── File-based Session Storage ───

const SESSIONS_DIR = path.join(CONFIG_DIR, 'ai-chat-sessions')
const CURRENT_SESSION_FILE = path.join(CONFIG_DIR, 'ai-chat-current-session')

interface DisplayTool {
  name: string
  args: any
  result: string | null
  status: string
}

interface DisplayMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  tools: DisplayTool[]
}

interface SerializedMsg {
  type: 'human' | 'ai' | 'tool'
  content: any
  tool_calls?: any[]
  tool_call_id?: string
}

interface SessionData {
  id: string
  createdAt: number
  updatedAt: number
  processing: boolean
  displayMessages: DisplayMessage[]
  lcMessages: SerializedMsg[]
}

function sessionFilePath(id: string): string {
  return path.join(SESSIONS_DIR, `${id}.json`)
}

function loadSessionData(id: string): SessionData | null {
  try {
    const fp = sessionFilePath(id)
    if (fs.existsSync(fp)) {
      return JSON.parse(fs.readFileSync(fp, 'utf-8'))
    }
  } catch {}
  return null
}

function saveSessionData(data: SessionData) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true })
  data.updatedAt = Date.now()
  fs.writeFileSync(sessionFilePath(data.id), JSON.stringify(data))
}

function getCurrentSessionId(): string | null {
  try {
    if (fs.existsSync(CURRENT_SESSION_FILE)) {
      return fs.readFileSync(CURRENT_SESSION_FILE, 'utf-8').trim()
    }
  } catch {}
  return null
}

function setCurrentSessionId(id: string) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CURRENT_SESSION_FILE, id)
}

function createNewSession(): SessionData {
  const data: SessionData = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    processing: false,
    displayMessages: [],
    lcMessages: [],
  }
  saveSessionData(data)
  setCurrentSessionId(data.id)
  return data
}

function getOrCreateCurrentSession(): SessionData {
  const currentId = getCurrentSessionId()
  if (currentId) {
    const data = loadSessionData(currentId)
    if (data) return data
  }
  return createNewSession()
}

// ─── Message Serialization ───

function deserializeLcMessages(msgs: SerializedMsg[]): BaseMessage[] {
  return msgs.map((m) => {
    switch (m.type) {
      case 'human':
        return new HumanMessage(m.content)
      case 'ai':
        if (m.tool_calls?.length) {
          return new AIMessage({ content: m.content, tool_calls: m.tool_calls })
        }
        return new AIMessage(typeof m.content === 'string' ? m.content : extractFullText(m.content))
      case 'tool':
        return new ToolMessage({ content: m.content as string, tool_call_id: m.tool_call_id! })
      default:
        return new HumanMessage(m.content)
    }
  })
}

// ─── Event Bus (bridges background processing ↔ SSE) ───

class ChatEventBus {
  private events: any[] = []
  private listeners = new Set<(evt: any) => void>()
  private _done = false

  emit(evt: any) {
    this.events.push(evt)
    for (const fn of this.listeners) fn(evt)
  }

  finish(sessionId: string) {
    this._done = true
    const doneEvt = { type: 'done', sessionId }
    this.events.push(doneEvt)
    for (const fn of this.listeners) fn(doneEvt)
  }

  /** Subscribe with replay of buffered events; returns unsubscribe fn */
  subscribe(handler: (evt: any) => void): () => void {
    for (const evt of this.events) handler(evt)
    if (this._done) return () => {}
    this.listeners.add(handler)
    return () => {
      this.listeners.delete(handler)
    }
  }

  get isDone() {
    return this._done
  }
}

const activeBuses = new Map<string, ChatEventBus>()

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

### ⚠️ API Key 双重存储机制（重要）
OpenClaw 的 API Key 存储在两个位置，修改时必须同时更新：
1. **配置文件** \`~/.openclaw/openclaw.json\` 中的 \`models.providers.<provider>.apiKey\`（通过 \`openclaw config set\` 操作）
2. **运行时凭据** \`~/.openclaw/agents/main/agent/auth-profiles.json\` 中的 \`profiles.<provider>:default.key\`（Gateway 实际读取此文件）
- \`openclaw config get\` 读取 API Key 时始终返回 \`__OPENCLAW_REDACTED__\`（脱敏占位符），这是正常的安全行为，不代表 Key 丢失。
- 如果只修改了 openclaw.json 而没有更新 auth-profiles.json，Gateway 仍会使用 auth-profiles.json 中的旧 Key。
- 修改 API Key 后必须执行 \`openclaw gateway restart\` 重启 Gateway 才能生效。

### ⚠️ 切换模型的关键规则（必须遵守）
1. **模型 ID 格式必须是 \`provider/model-id\`**，例如 \`openai-codex/gpt-5.2\`、\`minimax/MiniMax-M2.5\`。绝对不能只写 provider 名称（如 \`openai-codex\`）或只写 model-id（如 \`gpt-5.2\`）。
2. **切换前必须先查询可用模型列表**：执行 \`openclaw config get --json agents.defaults\` 查看 \`models\` 字段中已注册的模型。只有列表中存在的模型才能设置为默认模型。
3. **用户说的模型名可能不完整**：当用户说"切换到 xxx"时，需要在可用模型列表中找到匹配项。例如用户说"切换 openai-codex"，应匹配到 \`openai-codex/gpt-5.2\`。如果找不到匹配项，告知用户可用的模型列表。
4. **设置命令格式**：\`openclaw config set agents.defaults.model.primary <provider/model-id>\`
5. **设置后必须重启 Gateway** 才能生效。

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

// ─── Content extraction ───

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

// ─── Background Processing ───

const MAX_TOOL_TURNS = 8

async function processInBackground(
  sessionId: string,
  prompt: string,
  displayText: string,
  bus: ChatEventBus,
) {
  const data = loadSessionData(sessionId)
  if (!data) {
    bus.emit({ type: 'error', message: '会话不存在' })
    bus.finish(sessionId)
    activeBuses.delete(sessionId)
    return
  }

  const config = resolveConfig()
  if (!config) {
    bus.emit({ type: 'error', message: '未配置 AI 模型' })
    bus.finish(sessionId)
    data.processing = false
    saveSessionData(data)
    activeBuses.delete(sessionId)
    return
  }

  data.processing = true
  data.displayMessages.push({ id: Date.now(), role: 'user', content: displayText, tools: [] })
  data.displayMessages.push({ id: Date.now() + 1, role: 'assistant', content: '', tools: [] })
  const aiIdx = data.displayMessages.length - 1
  data.lcMessages.push({ type: 'human', content: prompt })
  saveSessionData(data)

  const lcMessages: BaseMessage[] = [
    new SystemMessage(SYSTEM_PROMPT),
    ...deserializeLcMessages(data.lcMessages),
  ]

  const model = createModel(config)
  const tools = createTools()
  let useTools = true
  let lastSaveTime = Date.now()

  function throttledSave() {
    const now = Date.now()
    if (now - lastSaveTime >= 1000) {
      saveSessionData(data)
      lastSaveTime = now
    }
  }

  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      let fullMessage: AIMessageChunk | undefined
      let turnText = ''

      try {
        const activeModel = useTools && tools.length > 0 ? model.bindTools(tools) : model
        const responseStream = await activeModel.stream(lcMessages)

        for await (const chunk of responseStream) {
          fullMessage = fullMessage ? fullMessage.concat(chunk) : chunk
          const text = extractChunkText(chunk.content)
          if (text) {
            turnText += text
            data.displayMessages[aiIdx].content += text
            bus.emit({ type: 'text', content: text })
            throttledSave()
          }
        }

        saveSessionData(data)
      } catch (err: any) {
        if (useTools && turn === 0) {
          useTools = false
          const fallbackStream = await model.stream(lcMessages)
          for await (const chunk of fallbackStream) {
            const text = extractChunkText(chunk.content)
            if (text) {
              turnText += text
              data.displayMessages[aiIdx].content += text
              bus.emit({ type: 'text', content: text })
              throttledSave()
            }
          }
          data.lcMessages.push({ type: 'ai', content: turnText })
          lcMessages.push(new AIMessage(turnText))
          saveSessionData(data)
          break
        }
        throw err
      }

      if (!fullMessage) break

      if (!turnText && fullMessage.content) {
        turnText = extractFullText(fullMessage.content)
        if (turnText) {
          data.displayMessages[aiIdx].content += turnText
          bus.emit({ type: 'text', content: turnText })
          saveSessionData(data)
        }
      }

      const toolCalls = fullMessage.tool_calls || []

      if (toolCalls.length === 0) {
        data.lcMessages.push({ type: 'ai', content: turnText })
        lcMessages.push(new AIMessage(turnText))
        saveSessionData(data)
        break
      }

      data.lcMessages.push({ type: 'ai', content: fullMessage.content, tool_calls: toolCalls })
      lcMessages.push(new AIMessage({ content: fullMessage.content, tool_calls: toolCalls }))

      for (const tc of toolCalls) {
        data.displayMessages[aiIdx].tools.push({
          name: tc.name,
          args: tc.args,
          result: null,
          status: 'running',
        })
        bus.emit({ type: 'tool_start', name: tc.name, args: tc.args })
        saveSessionData(data)

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
        const toolInfo = data.displayMessages[aiIdx].tools.findLast(
          (x) => x.name === tc.name && x.status === 'running',
        )
        if (toolInfo) {
          toolInfo.result = display
          toolInfo.status = 'done'
        }
        bus.emit({ type: 'tool_end', name: tc.name, result: display })

        data.lcMessages.push({ type: 'tool', content: resultStr, tool_call_id: tc.id! })
        lcMessages.push(new ToolMessage({ content: resultStr, tool_call_id: tc.id! }))
        saveSessionData(data)
      }
    }
  } catch (err: any) {
    data.displayMessages[aiIdx].content += '\n\n❌ 错误: ' + (err.message || '未知错误')
    bus.emit({ type: 'error', message: err.message || '未知错误' })
  } finally {
    data.processing = false
    saveSessionData(data)
    bus.finish(sessionId)
    activeBuses.delete(sessionId)
  }
}

// ─── Routes ───

aiChatRouter.get('/ai-chat/config', async (c) => {
  const config = resolveConfig()
  let maskedKey = ''
  if (config?.apiKey) {
    const k = config.apiKey
    maskedKey = k.length > 10
      ? k.substring(0, 6) + '****' + k.substring(k.length - 4)
      : '****'
  }
  return c.json({
    configured: !!config?.apiKey,
    model: config?.model || '',
    baseUrl: config?.baseUrl || 'https://api.minimax.chat/v1',
    maskedKey,
    keySource: config?.keySource || '',
  })
})

aiChatRouter.post('/ai-chat/config', async (c) => {
  const body = await c.req.json()
  const existing = loadConfig()
  const newApiKey = (body.apiKey || '').trim()
  const apiKey = newApiKey || existing?.apiKey || ''
  if (!apiKey) return c.json({ success: false, error: '请填写 API Key' }, 400)

  const config: AIChatConfig = {
    apiKey,
    model: (body.model || existing?.model || 'MiniMax-Text-01').trim(),
    baseUrl: (body.baseUrl || existing?.baseUrl || 'https://api.minimax.chat/v1').trim(),
  }
  saveConfig(config)
  return c.json({ success: true })
})

aiChatRouter.get('/ai-chat/session/current', async (c) => {
  const data = getOrCreateCurrentSession()
  if (data.processing && !activeBuses.has(data.id)) {
    data.processing = false
    saveSessionData(data)
  }
  return c.json({
    sessionId: data.id,
    processing: data.processing,
    displayMessages: data.displayMessages,
  })
})

aiChatRouter.get('/ai-chat/session/:id/poll', async (c) => {
  const id = c.req.param('id')
  const data = loadSessionData(id)
  if (!data) return c.json({ error: 'Session not found' }, 404)

  const isProcessing = activeBuses.has(id) && !activeBuses.get(id)!.isDone
  if (data.processing && !isProcessing) {
    data.processing = false
    saveSessionData(data)
  }

  return c.json({
    processing: isProcessing,
    displayMessages: data.displayMessages,
  })
})

aiChatRouter.post('/ai-chat/session/new', async (c) => {
  const data = createNewSession()
  return c.json({ sessionId: data.id })
})

aiChatRouter.post('/ai-chat/send', async (c) => {
  const body = await c.req.json()
  const { message, sessionId: reqSessionId, autoFix } = body as {
    message?: string
    sessionId?: string
    autoFix?: boolean
  }

  const config = resolveConfig()
  if (!config?.apiKey) {
    return c.json({ error: '请先配置 API Key' }, 400)
  }

  const prompt = autoFix ? AUTO_FIX_PROMPT : (message || '').trim()
  if (!prompt) return c.json({ error: '消息不能为空' }, 400)
  const displayText = autoFix ? '🔧 一键自动诊断修复' : prompt

  let sessionId = reqSessionId
  let sessionData: SessionData | null = null
  if (sessionId) {
    sessionData = loadSessionData(sessionId)
  }
  if (!sessionData) {
    sessionData = getOrCreateCurrentSession()
    sessionId = sessionData.id
  }

  if (activeBuses.has(sessionId!)) {
    return c.json({ error: '该会话正在处理中，请等待完成' }, 409)
  }

  const bus = new ChatEventBus()
  activeBuses.set(sessionId!, bus)

  processInBackground(sessionId!, prompt, displayText, bus).catch((err) => {
    console.error('AI chat background processing error:', err)
  })

  return streamSSE(c, async (sseStream) => {
    await new Promise<void>((resolve) => {
      const unsubscribe = bus.subscribe((evt: any) => {
        sseStream.writeSSE({ data: JSON.stringify(evt) }).catch(() => {
          unsubscribe()
          resolve()
        })
        if (evt.type === 'done' || evt.type === 'error') {
          resolve()
        }
      })
    })
  })
})
