import { Hono } from 'hono'
import { execa } from 'execa'
import { execOpenClaw, extractJson, startGateway } from '../utils'
import { TelegramGuide } from '../../components/TelegramGuide'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const channelsRouter = new Hono()

/** 将对象序列化为纯 ASCII 的 JSON 字符串（非 ASCII 字符用 \uXXXX 转义），避免 HTTP header ByteString 报错 */
function asciiJson(obj: any): string {
  return JSON.stringify(obj).replace(/[\u0080-\uffff]/g, (ch) => {
    return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
  })
}

// ─── 渠道管理 ───

const ALL_CHANNELS = [
  { id: 'telegram', label: 'Telegram', description: '通过 Telegram 机器人接收和发送消息' },
  { id: 'whatsapp', label: 'WhatsApp', description: '通过 WhatsApp Business 接收和发送消息' },
]

/** 判断渠道是否启用（不同渠道 schema 不同） */
function isChannelEnabled(id: string, value: any): boolean {
  if (id === 'whatsapp') {
    // WhatsApp 用 accounts.<accountId>.enabled 控制
    const accounts = value?.accounts || {}
    const ids = Object.keys(accounts)
    if (ids.length === 0) return false
    return ids.some((aid) => accounts[aid]?.enabled !== false)
  }
  // 其他渠道（Telegram 等）直接用顶层 enabled
  return value?.enabled !== false
}

/** 检查 WhatsApp 是否已经通过 QR 码完成链接（凭据目录是否有文件） */
function isWhatsAppLinked(accountId = 'default'): boolean {
  try {
    const home = os.homedir()
    const credDir = path.join(home, '.openclaw', 'credentials', 'whatsapp', accountId)
    if (!fs.existsSync(credDir)) return false
    const files = fs.readdirSync(credDir).filter((f) => !f.startsWith('.'))
    return files.length > 0
  } catch {
    return false
  }
}

async function fetchChannels() {
  const { stdout } = await execOpenClaw( ['config', 'get', '--json', 'channels'])
  const channelsJson = extractJson(stdout as string) || {}
  return Object.entries(channelsJson).map(([id, value]: any) => {
    const enabled = isChannelEnabled(id, value)
    // WhatsApp 额外检查是否已完成扫码链接
    const linked = id === 'whatsapp' ? isWhatsAppLinked() : undefined
    return { id, label: id.toUpperCase(), enabled, linked, config: value }
  })
}

async function fetchChannelConfig(channelId: string) {
  try {
    const { stdout } = await execOpenClaw( ['config', 'get', '--json', `channels.${channelId}`])
    return extractJson(stdout as string) || {}
  } catch {
    return {}
  }
}

/** 获取渠道的显示状态信息 */
function getChannelStatus(ch: { id: string; enabled: boolean; linked?: boolean }) {
  if (ch.id === 'whatsapp') {
    if (!ch.linked) return { text: '未链接', badgeCls: 'bg-amber-100 text-amber-700', cardCls: 'border-amber-200 bg-amber-50/50' }
    if (ch.enabled) return { text: '已链接', badgeCls: 'bg-emerald-100 text-emerald-700', cardCls: 'border-emerald-200 bg-emerald-50' }
    return { text: '已关闭', badgeCls: 'bg-slate-100 text-slate-500', cardCls: 'border-slate-200 bg-white' }
  }
  if (ch.enabled) return { text: '已启用', badgeCls: 'bg-emerald-100 text-emerald-700', cardCls: 'border-emerald-200 bg-emerald-50' }
  return { text: '已关闭', badgeCls: 'bg-slate-100 text-slate-500', cardCls: 'border-slate-200 bg-white' }
}

function ChannelList(props: { channels: Array<{ id: string; label: string; enabled: boolean; linked?: boolean }> }) {
  if (!props.channels.length) {
    return <p class="text-sm text-slate-500">暂无已配置渠道</p>
  }
  return (
    <>
      {props.channels.map((ch) => {
        const status = getChannelStatus(ch)
        const isWhatsAppUnlinked = ch.id === 'whatsapp' && !ch.linked
        return (
          <div class={`rounded-xl border p-4 ${status.cardCls}`}>
            <div class="flex items-center justify-between">
              <strong class="text-sm text-slate-700">{ch.label}</strong>
              <span class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${status.badgeCls}`}>
                {status.text}
              </span>
            </div>
            {isWhatsAppUnlinked && (
              <p class="mt-2 text-xs text-amber-600">尚未扫描二维码完成链接，请点击下方「添加 WhatsApp」开始配置。</p>
            )}
            <div class="mt-3 flex flex-wrap gap-2">
              {!isWhatsAppUnlinked && (
                <button
                  class="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
                  hx-get={`/api/partials/channels/${ch.id}/edit`}
                  hx-target="#channel-form-area"
                  hx-swap="innerHTML show:#channel-form-area:top"
                >
                  编辑
                </button>
              )}
              {isWhatsAppUnlinked ? (
                <button
                  class="rounded-lg border border-emerald-200 px-3 py-1 text-xs text-emerald-600 hover:bg-emerald-50"
                  hx-get="/api/partials/channels/add/whatsapp"
                  hx-target="#channel-form-area"
                  hx-swap="innerHTML show:#channel-form-area:top"
                >
                  扫码链接
                </button>
              ) : (
                <button
                  class={`rounded-lg border px-3 py-1 text-xs ${ch.enabled ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'}`}
                  hx-post={`/api/partials/channels/${ch.id}/toggle`}
                  hx-target="#channel-list"
                  hx-swap="innerHTML"
                  hx-disabled-elt="this"
                >
                  <span class="hx-ready">{ch.enabled ? '关闭' : '启用'}</span>
                  <span class="hx-loading items-center gap-1">
                    <svg class="animate-spin h-3 w-3 inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                    处理中…
                  </span>
                </button>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}

function AvailableChannelButtons(props: { available: Array<{ id: string; label: string; description: string }> }) {
  if (!props.available.length) {
    return <p class="mt-4 text-sm text-slate-500">所有支持的渠道均已配置</p>
  }
  return (
    <div class="mt-4 flex flex-wrap gap-3">
      {props.available.map((ch) => (
        <button
          class="rounded-lg bg-indigo-500 px-4 py-2 text-sm text-white hover:bg-indigo-400"
          hx-get={`/api/partials/channels/add/${ch.id}`}
          hx-target="#channel-form-area"
          hx-swap="innerHTML show:#channel-form-area:top"
        >
          添加 {ch.label}
        </button>
      ))}
    </div>
  )
}

// 已配置渠道列表
channelsRouter.get('/channels', async (c) => {
  try {
    const channels = await fetchChannels()
    return c.html(<ChannelList channels={channels} />)
  } catch {
    return c.html(<p class="text-sm text-red-500">无法读取渠道配置</p>)
  }
})

// 可用（未配置）渠道列表
channelsRouter.get('/channels/available', async (c) => {
  try {
    const configured = await fetchChannels()
    const configuredIds = new Set(configured.map((ch) => ch.id))
    const available = ALL_CHANNELS.filter((ch) => !configuredIds.has(ch.id))
    return c.html(<AvailableChannelButtons available={available} />)
  } catch {
    return c.html(<p class="text-sm text-red-500">无法获取可用渠道</p>)
  }
})

// 添加渠道表单
channelsRouter.get('/channels/add/:type', async (c) => {
  const type = c.req.param('type')
  if (type === 'telegram') {
    const tgGuide = TelegramGuide({ withTokenInput: true, inputName: 'botToken' })
    return c.html(
      <div class="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-6">
        <div class="flex items-center justify-between">
          <h4 class="text-lg font-semibold text-slate-800">添加 Telegram 渠道</h4>
          <button onclick="document.getElementById('channel-form-area').innerHTML=''" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100">✕ 关闭</button>
        </div>
        <form class="mt-4" hx-post="/api/partials/channels/add/telegram" hx-target="#channel-list" hx-swap="innerHTML">
          <div>{tgGuide}</div>
          <div class="mt-6">
            <label class="mb-2 block text-sm font-medium text-slate-600">Telegram 用户 ID</label>
            <input type="text" name="userId" placeholder="请输入用户 ID" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
          </div>
          <div class="mt-6 flex justify-end gap-3">
            <button type="button" onclick="document.getElementById('channel-form-area').innerHTML=''" class="rounded-lg border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button>
            <button type="submit" class="rounded-lg bg-indigo-500 px-5 py-2 text-sm text-white hover:bg-indigo-400">添加渠道</button>
          </div>
        </form>
      </div>
    )
  }
  if (type === 'whatsapp') {
    // 完整的 WhatsApp 添加流程（对应 openclaw onboarding/whatsapp.ts）：
    // QR 扫码 → 手机模式选择 → DM 策略配置 → 号码白名单 → 保存
    return c.html(
      <div class="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-6" x-data="whatsappLinker">
        <div class="flex items-center justify-between">
          <h4 class="text-lg font-semibold text-slate-800">添加 WhatsApp 渠道</h4>
          <button x-on:click="close()" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100">✕ 关闭</button>
        </div>

        {/* ── 步骤 1: 初始状态 - 显示说明和开始按钮 ── */}
        <div x-show="state === 'idle'" class="mt-4">
          <p class="text-sm text-slate-600">通过扫描二维码将 WhatsApp 连接到 OpenClaw，然后配置消息访问策略。</p>
          <div class="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p class="text-sm text-amber-700 font-medium">准备工作</p>
            <ul class="mt-1.5 text-sm text-amber-600 list-disc list-inside space-y-1">
              <li>确保 OpenClaw Gateway 已启动运行</li>
              <li>准备好你的手机，打开 WhatsApp</li>
              <li>建议使用备用手机号 + eSIM 注册 WhatsApp</li>
            </ul>
          </div>
          <div class="mt-6 flex justify-end gap-3">
            <button type="button" x-on:click="close()" class="rounded-lg border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button>
            <button type="button" x-on:click="startLinking()" class="rounded-lg bg-emerald-500 px-5 py-2 text-sm text-white hover:bg-emerald-400">开始连接 WhatsApp</button>
          </div>
        </div>

        {/* ── 步骤 2: 加载状态 - 注销旧会话 + 生成 QR ── */}
        <div x-show="state === 'loading'" x-cloak class="mt-6 flex flex-col items-center py-8">
          <div class="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-500"></div>
          <p class="mt-4 text-sm text-slate-600 font-medium" x-text="loadingStep"></p>
          <p class="mt-1 text-xs text-slate-400">整个过程可能需要 10-30 秒</p>
        </div>

        {/* ── 步骤 3: QR 码显示 - 等待扫码 ── */}
        <div x-show="state === 'qr'" x-cloak class="mt-4">
          <div class="flex flex-col items-center">
            <div class="rounded-2xl bg-white p-4 shadow-lg">
              <img x-bind:src="qrDataUrl" alt="WhatsApp QR Code" class="h-64 w-64" />
            </div>
            <div class="mt-4 text-center">
              <p class="text-sm font-medium text-slate-700">请使用手机扫描上方二维码</p>
              <p class="mt-1 text-xs text-slate-500">WhatsApp → 设置 → 已关联的设备 → 关联设备</p>
            </div>
            <div class="mt-4 flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-2.5">
              <div class="h-2 w-2 animate-pulse rounded-full bg-indigo-500"></div>
              <span class="text-sm text-indigo-600">等待扫码中...</span>
            </div>
          </div>
          <div class="mt-6 flex justify-center gap-3">
            <button type="button" x-on:click="startLinking()" class="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">刷新二维码</button>
            <button type="button" x-on:click="close()" class="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button>
          </div>
        </div>

        {/* ── 步骤 4: 手机模式选择（对应 openclaw onboarding 的 phoneMode 步骤）── */}
        <div x-show="state === 'phoneMode'" x-cloak class="mt-4">
          <div class="flex flex-col items-center py-4">
            <div class="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <svg class="h-8 w-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
            </div>
            <p class="mt-3 text-lg font-semibold text-emerald-700">WhatsApp 链接成功！</p>
            <p class="mt-1 text-sm text-slate-500">接下来配置消息访问策略</p>
          </div>

          <div class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <p class="text-sm font-medium text-slate-700">这个 WhatsApp 号码是？</p>
            <div class="mt-3 space-y-3">
              <button type="button" x-on:click="selectPhoneMode('personal')"
                class="w-full rounded-xl border border-slate-200 px-4 py-3 text-left hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors">
                <p class="text-sm font-medium text-slate-700">我的个人手机号</p>
                <p class="mt-0.5 text-xs text-slate-500">自动设为「白名单模式」，仅允许你自己的号码发消息</p>
              </button>
              <button type="button" x-on:click="selectPhoneMode('separate')"
                class="w-full rounded-xl border border-slate-200 px-4 py-3 text-left hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors">
                <p class="text-sm font-medium text-slate-700">OpenClaw 专用号码</p>
                <p class="mt-0.5 text-xs text-slate-500">独立备用号，可自定义消息策略（配对码/白名单/开放）</p>
              </button>
            </div>
          </div>

          <div class="mt-4 flex justify-end">
            <button type="button" x-on:click="skipConfig()" class="text-sm text-slate-500 hover:text-slate-700 underline">跳过，使用默认配置</button>
          </div>
        </div>

        {/* ── 步骤 5a: 个人手机配置（对应 openclaw 的 personal phone 流程）── */}
        <div x-show="state === 'personalConfig'" x-cloak class="mt-4">
          <div class="rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3">
            <p class="text-sm font-medium text-indigo-700">个人手机号模式</p>
            <p class="mt-1 text-xs text-indigo-600">OpenClaw 会将你的号码加入白名单，其他号码发来的消息将被忽略</p>
          </div>

          <div class="mt-4">
            <label class="mb-2 block text-sm font-medium text-slate-600">你的 WhatsApp 手机号码</label>
            <input type="tel" x-model="phoneNumber" placeholder="+8613800138000"
              class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
            <p class="mt-1 text-xs text-slate-400">请使用国际格式（E.164），如 +8613800138000、+15555550123</p>
          </div>

          <div x-show="errorMsg" class="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
            <p class="text-sm text-red-600" x-text="errorMsg"></p>
          </div>

          <div class="mt-6 flex justify-end gap-3">
            <button type="button" x-on:click="state='phoneMode'; errorMsg=''" class="rounded-lg border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-100">返回</button>
            <button type="button" x-on:click="saveConfig()" class="rounded-lg bg-indigo-500 px-5 py-2 text-sm text-white hover:bg-indigo-400">保存配置</button>
          </div>
        </div>

        {/* ── 步骤 5b: 专用号码配置（对应 openclaw 的 separate phone 流程）── */}
        <div x-show="state === 'separateConfig'" x-cloak class="mt-4">
          <div class="rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3">
            <p class="text-sm font-medium text-indigo-700">OpenClaw 专用号码模式</p>
            <p class="mt-1 text-xs text-indigo-600">选择消息策略来控制谁可以向 OpenClaw 发送 WhatsApp 消息</p>
          </div>

          <div class="mt-4">
            <label class="mb-2 block text-sm font-medium text-slate-600">DM 消息策略</label>
            <div class="space-y-2">
              <label class="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3 cursor-pointer hover:bg-slate-50">
                <input type="radio" x-model="dmPolicy" value="pairing" class="mt-0.5" />
                <div>
                  <p class="text-sm font-medium text-slate-700">配对码模式（推荐）</p>
                  <p class="text-xs text-slate-500">陌生号码发来消息时，需要提供配对码验证后才能通信</p>
                </div>
              </label>
              <label class="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3 cursor-pointer hover:bg-slate-50">
                <input type="radio" x-model="dmPolicy" value="allowlist" class="mt-0.5" />
                <div>
                  <p class="text-sm font-medium text-slate-700">白名单模式</p>
                  <p class="text-xs text-slate-500">仅允许指定号码发来的消息，其他号码将被忽略</p>
                </div>
              </label>
              <label class="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3 cursor-pointer hover:bg-slate-50">
                <input type="radio" x-model="dmPolicy" value="open" class="mt-0.5" />
                <div>
                  <p class="text-sm font-medium text-slate-700">开放模式</p>
                  <p class="text-xs text-slate-500">接受所有号码发来的消息（不推荐用于生产环境）</p>
                </div>
              </label>
              <label class="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3 cursor-pointer hover:bg-slate-50">
                <input type="radio" x-model="dmPolicy" value="disabled" class="mt-0.5" />
                <div>
                  <p class="text-sm font-medium text-slate-700">禁用 DM</p>
                  <p class="text-xs text-slate-500">忽略所有 WhatsApp DM 消息</p>
                </div>
              </label>
            </div>
          </div>

          <div x-show="dmPolicy === 'pairing' || dmPolicy === 'allowlist'" class="mt-4">
            <label class="mb-2 block text-sm font-medium text-slate-600">允许的手机号码（可选预设白名单）</label>
            <textarea x-model="allowFromText" rows={3} placeholder={"+8613800138000\n+15555550123"}
              class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none"></textarea>
            <p class="mt-1 text-xs text-slate-400">每行一个号码，使用国际格式（E.164）。留空则仅使用配对码验证。</p>
          </div>

          <div class="mt-6 flex justify-end gap-3">
            <button type="button" x-on:click="state='phoneMode'; errorMsg=''" class="rounded-lg border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-100">返回</button>
            <button type="button" x-on:click="saveConfig()" class="rounded-lg bg-indigo-500 px-5 py-2 text-sm text-white hover:bg-indigo-400">保存配置</button>
          </div>
        </div>

        {/* ── 保存中状态 ── */}
        <div x-show="state === 'saving'" x-cloak class="mt-6 flex flex-col items-center py-8">
          <div class="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-500"></div>
          <p class="mt-4 text-sm text-slate-600 font-medium">正在保存配置并重启网关...</p>
          <p class="mt-1 text-xs text-slate-400">可能需要几秒钟</p>
        </div>

        {/* ── 成功状态 ── */}
        <div x-show="state === 'success'" x-cloak class="mt-6 flex flex-col items-center py-8">
          <div class="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <svg class="h-8 w-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
          </div>
          <p class="mt-4 text-lg font-semibold text-emerald-700">WhatsApp 渠道配置完成！</p>
          <p class="mt-1 text-sm text-slate-500">你的 WhatsApp 已链接并配置好消息策略</p>
          <button type="button" x-on:click="close()" class="mt-6 rounded-lg bg-indigo-500 px-5 py-2 text-sm text-white hover:bg-indigo-400">完成</button>
        </div>

        {/* ── 错误状态 ── */}
        <div x-show="state === 'error'" x-cloak class="mt-4">
          <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p class="text-sm font-medium text-red-700">操作失败</p>
            <p class="mt-1 text-sm text-red-600" x-text="errorMsg"></p>
          </div>
          <div class="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p class="text-xs font-medium text-slate-600">排查建议</p>
            <ul class="mt-1 text-xs text-slate-500 list-disc list-inside space-y-0.5">
              <li>确认 Gateway 已启动：<code class="bg-slate-200 px-1 rounded">pgrep -f 'openclaw.*gateway'</code></li>
              <li>确认 WhatsApp 渠道插件已安装</li>
              <li>查看 Gateway 日志：<code class="bg-slate-200 px-1 rounded">tail -f ~/.openclaw/logs/gateway.log</code></li>
            </ul>
          </div>
          <div class="mt-6 flex justify-end gap-3">
            <button type="button" x-on:click="close()" class="rounded-lg border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button>
            <button type="button" x-on:click="startLinking()" class="rounded-lg bg-indigo-500 px-5 py-2 text-sm text-white hover:bg-indigo-400">重试</button>
          </div>
        </div>
      </div>
    )
  }
  return c.html(<p class="text-sm text-red-500">不支持的渠道类型</p>, 400)
})

// 提交添加 Telegram
channelsRouter.post('/channels/add/telegram', async (c) => {
  try {
    const body = await c.req.parseBody()
    const botToken = (body.botToken as string || '').trim()
    const userId = (body.userId as string || '').trim()
    if (!botToken || !userId) {
      c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: '请填写 Bot Token 和用户 ID' } }))
      const channels = await fetchChannels()
      return c.html(<ChannelList channels={channels} />)
    }
    await execOpenClaw( ['config', 'set', '--json', 'channels.telegram.botToken', JSON.stringify(botToken)])
    await execOpenClaw( ['config', 'set', '--json', 'channels.telegram.allowFrom', JSON.stringify([userId])])
    // 重启 gateway
    try { await execa('pkill', ['-f', 'openclaw.*gateway']); await new Promise((r) => setTimeout(r, 2000)) } catch {}
    const logFile = `${process.env.HOME}/.openclaw/logs/gateway.log`
    await startGateway(logFile)
    await new Promise((r) => setTimeout(r, 3000))

    const channels = await fetchChannels()
    const configuredIds = new Set(channels.map((ch) => ch.id))
    const available = ALL_CHANNELS.filter((ch) => !configuredIds.has(ch.id))
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'success', message: 'Telegram 渠道配置成功！' } }))
    return c.html(
      <>
        <ChannelList channels={channels} />
        <div id="channel-form-area" hx-swap-oob="innerHTML"></div>
        <div id="available-channels" hx-swap-oob="innerHTML"><AvailableChannelButtons available={available} /></div>
      </>
    )
  } catch (err: any) {
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: '配置失败: ' + err.message } }))
    try {
      const channels = await fetchChannels()
      return c.html(<ChannelList channels={channels} />)
    } catch {
      return c.html(<p class="text-sm text-red-500">配置失败</p>, 500)
    }
  }
})

// 编辑渠道表单
channelsRouter.get('/channels/:id/edit', async (c) => {
  const channelId = c.req.param('id')
  if (channelId === 'telegram') {
    const config = await fetchChannelConfig('telegram')
    const botToken = config.botToken || ''
    const userId = Array.isArray(config.allowFrom) ? config.allowFrom[0] || '' : ''
    const tgGuide = TelegramGuide({ withTokenInput: false })
    return c.html(
      <div class="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-6">
        <div class="flex items-center justify-between">
          <h4 class="text-lg font-semibold text-slate-800">编辑 Telegram 渠道</h4>
          <button onclick="document.getElementById('channel-form-area').innerHTML=''" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100">✕ 关闭</button>
        </div>
        <form class="mt-4" hx-post="/api/partials/channels/telegram/save" hx-target="#channel-list" hx-swap="innerHTML">
          <details class="mt-2">
            <summary class="cursor-pointer text-sm font-medium text-indigo-600 hover:text-indigo-500">查看配置指南</summary>
            <div class="mt-2">{tgGuide}</div>
          </details>
          <div class="mt-6">
            <label class="mb-2 block text-sm font-medium text-slate-600">Telegram Bot Token</label>
            <input type="text" name="botToken" value={botToken} placeholder="请输入 Bot Token" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
          </div>
          <div class="mt-4">
            <label class="mb-2 block text-sm font-medium text-slate-600">Telegram 用户 ID</label>
            <input type="text" name="userId" value={userId} placeholder="请输入用户 ID" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
          </div>
          <div class="mt-6 flex justify-end gap-3">
            <button type="button" onclick="document.getElementById('channel-form-area').innerHTML=''" class="rounded-lg border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button>
            <button type="submit" class="rounded-lg bg-indigo-500 px-5 py-2 text-sm text-white hover:bg-indigo-400">保存修改</button>
          </div>
        </form>
      </div>
    )
  }
  if (channelId === 'whatsapp') {
    const config = await fetchChannelConfig('whatsapp')
    const linked = isWhatsAppLinked()
    const dmPolicyLabels: Record<string, string> = {
      pairing: '配对码模式',
      allowlist: '白名单模式',
      open: '开放模式',
      disabled: '已禁用',
    }
    const currentPolicy = config.dmPolicy || 'pairing'
    const currentAllowFrom = Array.isArray(config.allowFrom) ? config.allowFrom : []
    const isSelfChat = config.selfChatMode === true

    return c.html(
      <div class="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-6" x-data="whatsappLinker">
        <div class="flex items-center justify-between">
          <h4 class="text-lg font-semibold text-slate-800">WhatsApp 渠道管理</h4>
          <button x-on:click="close()" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100">✕ 关闭</button>
        </div>

        {/* 当前状态信息 */}
        <div class="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div class="flex items-center justify-between">
            <span class="text-sm text-slate-600">链接状态</span>
            <span class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${linked ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {linked ? '已链接' : '未链接'}
            </span>
          </div>
          <div class="mt-2 flex items-center justify-between">
            <span class="text-sm text-slate-600">手机模式</span>
            <span class="text-sm text-slate-800">{isSelfChat ? '个人手机号' : '专用号码'}</span>
          </div>
          <div class="mt-2 flex items-center justify-between">
            <span class="text-sm text-slate-600">DM 策略</span>
            <span class="text-sm text-slate-800">{dmPolicyLabels[currentPolicy] || currentPolicy}</span>
          </div>
          {currentAllowFrom.length > 0 && (
            <div class="mt-2 flex items-center justify-between">
              <span class="text-sm text-slate-600">白名单号码</span>
              <span class="text-sm text-slate-800">{currentAllowFrom.join(', ')}</span>
            </div>
          )}
        </div>

        {/* ── 初始状态：编辑配置 + 重新链接 ── */}
        <div x-show="state === 'idle'" class="mt-4">
          {/* 编辑 DM 策略表单 */}
          <form hx-post="/api/partials/channels/whatsapp/save" hx-target="#channel-list" hx-swap="innerHTML">
            <div class="mt-2">
              <label class="mb-2 block text-sm font-medium text-slate-600">DM 消息策略</label>
              <select name="dmPolicy" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none">
                <option value="pairing" selected={currentPolicy === 'pairing'}>配对码模式（推荐）</option>
                <option value="allowlist" selected={currentPolicy === 'allowlist'}>白名单模式</option>
                <option value="open" selected={currentPolicy === 'open'}>开放模式</option>
                <option value="disabled" selected={currentPolicy === 'disabled'}>禁用 DM</option>
              </select>
            </div>
            <div class="mt-4">
              <label class="mb-2 block text-sm font-medium text-slate-600">白名单号码（逗号分隔，E.164 格式）</label>
              <input type="text" name="allowFrom" value={currentAllowFrom.join(', ')} placeholder="+8613800138000, +15555550123"
                class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
            </div>
            <div class="mt-4">
              <label class="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" name="selfChatMode" value="true" checked={isSelfChat} class="rounded" />
                个人手机号模式（selfChatMode）
              </label>
            </div>

            <div class="mt-6 flex justify-between">
              <button type="button" x-on:click="startLinking()" class="rounded-lg border border-emerald-200 px-4 py-2 text-sm text-emerald-600 hover:bg-emerald-50">
                {linked ? '重新扫码链接' : '扫码链接'}
              </button>
              <div class="flex gap-3">
                <button type="button" x-on:click="close()" class="rounded-lg border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button>
                <button type="submit" class="rounded-lg bg-indigo-500 px-5 py-2 text-sm text-white hover:bg-indigo-400">保存修改</button>
              </div>
            </div>
          </form>
        </div>

        {/* ── QR 链接流程的各状态（与添加表单共享） ── */}
        <div x-show="state === 'loading'" x-cloak class="mt-6 flex flex-col items-center py-8">
          <div class="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-500"></div>
          <p class="mt-4 text-sm text-slate-600 font-medium" x-text="loadingStep"></p>
          <p class="mt-1 text-xs text-slate-400">整个过程可能需要 10-30 秒</p>
        </div>

        <div x-show="state === 'qr'" x-cloak class="mt-4">
          <div class="flex flex-col items-center">
            <div class="rounded-2xl bg-white p-4 shadow-lg">
              <img x-bind:src="qrDataUrl" alt="WhatsApp QR Code" class="h-64 w-64" />
            </div>
            <div class="mt-4 text-center">
              <p class="text-sm font-medium text-slate-700">请使用手机扫描上方二维码</p>
              <p class="mt-1 text-xs text-slate-500">WhatsApp → 设置 → 已关联的设备 → 关联设备</p>
            </div>
            <div class="mt-4 flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-2.5">
              <div class="h-2 w-2 animate-pulse rounded-full bg-indigo-500"></div>
              <span class="text-sm text-indigo-600">等待扫码中...</span>
            </div>
          </div>
          <div class="mt-6 flex justify-center gap-3">
            <button type="button" x-on:click="startLinking()" class="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">刷新二维码</button>
            <button type="button" x-on:click="close()" class="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button>
          </div>
        </div>

        {/* ── 手机模式选择 ── */}
        <div x-show="state === 'phoneMode'" x-cloak class="mt-4">
          <div class="flex flex-col items-center py-4">
            <div class="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <svg class="h-8 w-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
            </div>
            <p class="mt-3 text-lg font-semibold text-emerald-700">WhatsApp 重新链接成功！</p>
            <p class="mt-1 text-sm text-slate-500">可以重新配置消息策略</p>
          </div>
          <div class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <p class="text-sm font-medium text-slate-700">这个 WhatsApp 号码是？</p>
            <div class="mt-3 space-y-3">
              <button type="button" x-on:click="selectPhoneMode('personal')"
                class="w-full rounded-xl border border-slate-200 px-4 py-3 text-left hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors">
                <p class="text-sm font-medium text-slate-700">我的个人手机号</p>
                <p class="mt-0.5 text-xs text-slate-500">自动设为「白名单模式」</p>
              </button>
              <button type="button" x-on:click="selectPhoneMode('separate')"
                class="w-full rounded-xl border border-slate-200 px-4 py-3 text-left hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors">
                <p class="text-sm font-medium text-slate-700">OpenClaw 专用号码</p>
                <p class="mt-0.5 text-xs text-slate-500">自定义消息策略</p>
              </button>
            </div>
          </div>
          <div class="mt-4 flex justify-end">
            <button type="button" x-on:click="skipConfig()" class="text-sm text-slate-500 hover:text-slate-700 underline">跳过，保持当前配置</button>
          </div>
        </div>

        {/* ── 个人手机配置 ── */}
        <div x-show="state === 'personalConfig'" x-cloak class="mt-4">
          <div class="rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3">
            <p class="text-sm font-medium text-indigo-700">个人手机号模式</p>
            <p class="mt-1 text-xs text-indigo-600">仅允许你自己的号码发消息</p>
          </div>
          <div class="mt-4">
            <label class="mb-2 block text-sm font-medium text-slate-600">你的 WhatsApp 手机号码</label>
            <input type="tel" x-model="phoneNumber" placeholder="+8613800138000"
              class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
          </div>
          <div x-show="errorMsg" class="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
            <p class="text-sm text-red-600" x-text="errorMsg"></p>
          </div>
          <div class="mt-6 flex justify-end gap-3">
            <button type="button" x-on:click="state='phoneMode'; errorMsg=''" class="rounded-lg border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-100">返回</button>
            <button type="button" x-on:click="saveConfig()" class="rounded-lg bg-indigo-500 px-5 py-2 text-sm text-white hover:bg-indigo-400">保存</button>
          </div>
        </div>

        {/* ── 专用号码配置 ── */}
        <div x-show="state === 'separateConfig'" x-cloak class="mt-4">
          <div class="rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3">
            <p class="text-sm font-medium text-indigo-700">OpenClaw 专用号码模式</p>
          </div>
          <div class="mt-4">
            <label class="mb-2 block text-sm font-medium text-slate-600">DM 消息策略</label>
            <div class="space-y-2">
              <label class="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3 cursor-pointer hover:bg-slate-50">
                <input type="radio" x-model="dmPolicy" value="pairing" class="mt-0.5" />
                <div>
                  <p class="text-sm font-medium text-slate-700">配对码模式（推荐）</p>
                  <p class="text-xs text-slate-500">陌生号码需提供配对码验证</p>
                </div>
              </label>
              <label class="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3 cursor-pointer hover:bg-slate-50">
                <input type="radio" x-model="dmPolicy" value="allowlist" class="mt-0.5" />
                <div>
                  <p class="text-sm font-medium text-slate-700">白名单模式</p>
                  <p class="text-xs text-slate-500">仅允许指定号码</p>
                </div>
              </label>
              <label class="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3 cursor-pointer hover:bg-slate-50">
                <input type="radio" x-model="dmPolicy" value="open" class="mt-0.5" />
                <div>
                  <p class="text-sm font-medium text-slate-700">开放模式</p>
                  <p class="text-xs text-slate-500">接受所有消息</p>
                </div>
              </label>
              <label class="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3 cursor-pointer hover:bg-slate-50">
                <input type="radio" x-model="dmPolicy" value="disabled" class="mt-0.5" />
                <div>
                  <p class="text-sm font-medium text-slate-700">禁用 DM</p>
                </div>
              </label>
            </div>
          </div>
          <div x-show="dmPolicy === 'pairing' || dmPolicy === 'allowlist'" class="mt-4">
            <label class="mb-2 block text-sm font-medium text-slate-600">允许的手机号码（可选）</label>
            <textarea x-model="allowFromText" rows={3} placeholder={"+8613800138000\n+15555550123"}
              class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none"></textarea>
          </div>
          <div class="mt-6 flex justify-end gap-3">
            <button type="button" x-on:click="state='phoneMode'; errorMsg=''" class="rounded-lg border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-100">返回</button>
            <button type="button" x-on:click="saveConfig()" class="rounded-lg bg-indigo-500 px-5 py-2 text-sm text-white hover:bg-indigo-400">保存</button>
          </div>
        </div>

        <div x-show="state === 'saving'" x-cloak class="mt-6 flex flex-col items-center py-8">
          <div class="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-500"></div>
          <p class="mt-4 text-sm text-slate-600 font-medium">正在保存配置...</p>
        </div>

        <div x-show="state === 'success'" x-cloak class="mt-6 flex flex-col items-center py-8">
          <div class="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <svg class="h-8 w-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
          </div>
          <p class="mt-4 text-lg font-semibold text-emerald-700">配置已更新！</p>
          <button type="button" x-on:click="close()" class="mt-6 rounded-lg bg-indigo-500 px-5 py-2 text-sm text-white hover:bg-indigo-400">完成</button>
        </div>

        <div x-show="state === 'error'" x-cloak class="mt-4">
          <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p class="text-sm font-medium text-red-700">操作失败</p>
            <p class="mt-1 text-sm text-red-600" x-text="errorMsg"></p>
          </div>
          <div class="mt-6 flex justify-end gap-3">
            <button type="button" x-on:click="close()" class="rounded-lg border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button>
            <button type="button" x-on:click="startLinking()" class="rounded-lg bg-indigo-500 px-5 py-2 text-sm text-white hover:bg-indigo-400">重试</button>
          </div>
        </div>
      </div>
    )
  }
  return c.html(<p class="text-sm text-red-500">不支持编辑此渠道</p>, 400)
})

// 保存 WhatsApp 渠道编辑（DM 策略 + 白名单）
channelsRouter.post('/channels/whatsapp/save', async (c) => {
  try {
    const body = await c.req.parseBody({ all: true })
    const dmPolicy = (body.dmPolicy as string || 'pairing').trim()
    const allowFromRaw = (body.allowFrom as string || '').trim()
    const selfChatMode = body.selfChatMode === 'true'

    // 设置 DM 策略
    await execOpenClaw( ['config', 'set', '--json', 'channels.whatsapp.dmPolicy', JSON.stringify(dmPolicy)])
    await execOpenClaw( ['config', 'set', '--json', 'channels.whatsapp.selfChatMode', String(selfChatMode)])

    // 设置白名单
    if (dmPolicy === 'open') {
      await execOpenClaw( ['config', 'set', '--json', 'channels.whatsapp.allowFrom', JSON.stringify(['*'])])
    } else if (allowFromRaw) {
      const numbers = allowFromRaw
        .split(/[,;\n]+/)
        .map((n: string) => n.trim().replace(/[\s\-()]/g, ''))
        .filter(Boolean)
        .map((n: string) => (n === '*' ? '*' : n.startsWith('+') ? n : `+${n}`))
      await execOpenClaw( ['config', 'set', '--json', 'channels.whatsapp.allowFrom', JSON.stringify(numbers)])
    }

    // 确保账户启用
    await execOpenClaw( ['config', 'set', '--json', 'channels.whatsapp.accounts.default.enabled', 'true'])

    // 重启 gateway
    try { await execa('pkill', ['-f', 'openclaw.*gateway']); await new Promise((r) => setTimeout(r, 2000)) } catch {}
    const logFile = `${process.env.HOME}/.openclaw/logs/gateway.log`
    await startGateway(logFile)
    await new Promise((r) => setTimeout(r, 3000))

    const channels = await fetchChannels()
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'success', message: 'WhatsApp 配置已更新' } }))
    return c.html(
      <>
        <ChannelList channels={channels} />
        <div id="channel-form-area" hx-swap-oob="innerHTML"></div>
      </>
    )
  } catch (err: any) {
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: '保存失败: ' + err.message } }))
    try {
      const channels = await fetchChannels()
      return c.html(<ChannelList channels={channels} />)
    } catch {
      return c.html(<p class="text-sm text-red-500">保存失败</p>, 500)
    }
  }
})

// 保存渠道编辑
channelsRouter.post('/channels/:id/save', async (c) => {
  const channelId = c.req.param('id')
  if (channelId !== 'telegram') {
    return c.html(<p class="text-sm text-red-500">不支持编辑此渠道</p>, 400)
  }
  try {
    const body = await c.req.parseBody()
    const botToken = (body.botToken as string || '').trim()
    const userId = (body.userId as string || '').trim()
    if (!botToken || !userId) {
      c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: '请填写 Bot Token 和用户 ID' } }))
      const channels = await fetchChannels()
      return c.html(<ChannelList channels={channels} />)
    }
    await execOpenClaw( ['config', 'set', '--json', 'channels.telegram.botToken', JSON.stringify(botToken)])
    await execOpenClaw( ['config', 'set', '--json', 'channels.telegram.allowFrom', JSON.stringify([userId])])
    // 重启 gateway
    try { await execa('pkill', ['-f', 'openclaw.*gateway']); await new Promise((r) => setTimeout(r, 2000)) } catch {}
    const logFile = `${process.env.HOME}/.openclaw/logs/gateway.log`
    await startGateway(logFile)
    await new Promise((r) => setTimeout(r, 3000))

    const channels = await fetchChannels()
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'success', message: 'Telegram 渠道已更新' } }))
    return c.html(
      <>
        <ChannelList channels={channels} />
        <div id="channel-form-area" hx-swap-oob="innerHTML"></div>
      </>
    )
  } catch (err: any) {
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: '保存失败: ' + err.message } }))
    try {
      const channels = await fetchChannels()
      return c.html(<ChannelList channels={channels} />)
    } catch {
      return c.html(<p class="text-sm text-red-500">保存失败</p>, 500)
    }
  }
})

// 切换渠道启用/关闭
channelsRouter.post('/channels/:id/toggle', async (c) => {
  const channelId = c.req.param('id')
  try {
    const channels = await fetchChannels()
    const channel = channels.find((ch) => ch.id === channelId)
    if (!channel) {
      c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: '渠道不存在' } }))
      return c.html(<ChannelList channels={channels} />)
    }
    const newEnabled = !channel.enabled
    if (channelId === 'whatsapp') {
      // WhatsApp 用 accounts.<accountId>.enabled 控制
      const accounts = channel.config?.accounts || {}
      const accountIds = Object.keys(accounts)
      const targetAccount = accountIds.length > 0 ? accountIds[0] : 'default'
      await execOpenClaw( ['config', 'set', '--json', `channels.whatsapp.accounts.${targetAccount}.enabled`, String(newEnabled)])
    } else {
      await execOpenClaw( ['config', 'set', `channels.${channelId}.enabled`, String(newEnabled)])
    }
    // 重启 gateway
    try { await execa('pkill', ['-f', 'openclaw.*gateway']); await new Promise((r) => setTimeout(r, 2000)) } catch {}
    const logFile = `${process.env.HOME}/.openclaw/logs/gateway.log`
    await startGateway(logFile)
    await new Promise((r) => setTimeout(r, 3000))

    const updatedChannels = await fetchChannels()
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'success', message: `${channel.label} 已${newEnabled ? '启用' : '关闭'}` } }))
    return c.html(<ChannelList channels={updatedChannels} />)
  } catch (err: any) {
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: '操作失败: ' + err.message } }))
    try {
      const channels = await fetchChannels()
      return c.html(<ChannelList channels={channels} />)
    } catch {
      return c.html(<p class="text-sm text-red-500">操作失败</p>, 500)
    }
  }
})
