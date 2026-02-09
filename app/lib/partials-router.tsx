import { Hono } from 'hono'
import { execa } from 'execa'
import { extractJson } from './utils'
import fs from 'node:fs'
import path from 'node:path'

export const partialsRouter = new Hono()

// ─── 模型列表片段 ───

async function fetchModels() {
  const { stdout: providersRaw } = await execa('openclaw', ['config', 'get', '--json', 'models.providers'])
  const providersJson = extractJson(providersRaw) || {}
  let defaultModel: string | null = null
  try {
    const { stdout } = await execa('openclaw', ['config', 'get', 'agents.defaults.model.primary'])
    defaultModel = stdout.trim() || null
  } catch {
    defaultModel = null
  }
  const models: Array<{ key: string; label: string }> = []
  Object.entries(providersJson).forEach(([providerId, provider]: any) => {
    const list = Array.isArray(provider?.models) ? provider.models : []
    list.forEach((model: any) => {
      const id = model?.id || model?.name || 'unknown'
      const name = model?.name || model?.id || id
      models.push({ key: `${providerId}/${id}`, label: `${name} (${providerId})` })
    })
  })
  return { models, defaultModel }
}

function ModelList(props: { models: Array<{ key: string; label: string }>; defaultModel: string | null }) {
  if (!props.models.length) {
    return <p class="text-sm text-slate-500">暂无已配置模型</p>
  }
  return (
    <>
      {props.models.map((model) => {
        const active = model.key === props.defaultModel
        return (
          <div class={`rounded-xl border ${active ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'} p-4`}>
            <strong class="text-sm text-slate-700">{model.label}</strong>
            <div class="mt-2 text-xs text-slate-500">{model.key}</div>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                class="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
                hx-post="/api/partials/models/default"
                hx-vals={JSON.stringify({ model: model.key })}
                hx-target="#model-list"
                hx-swap="innerHTML"
              >
                {active ? '✓ 当前默认' : '设为默认'}
              </button>
            </div>
          </div>
        )
      })}
    </>
  )
}

partialsRouter.get('/models', async (c) => {
  try {
    const { models, defaultModel } = await fetchModels()
    return c.html(<ModelList models={models} defaultModel={defaultModel} />)
  } catch {
    return c.html(<p class="text-sm text-red-500">无法读取模型配置</p>)
  }
})

partialsRouter.post('/models/default', async (c) => {
  const body = await c.req.parseBody()
  const model = body.model as string
  if (!model) return c.html(<p class="text-sm text-red-500">缺少模型参数</p>, 400)
  try {
    await execa('openclaw', ['config', 'set', '--json', 'agents.defaults.model', JSON.stringify({ primary: model })])
    // 返回更新后的列表
    const { models, defaultModel } = await fetchModels()
    c.header('HX-Trigger', JSON.stringify({ 'show-alert': { type: 'success', message: '已切换默认模型' } }))
    return c.html(<ModelList models={models} defaultModel={defaultModel} />)
  } catch (err: any) {
    c.header('HX-Trigger', JSON.stringify({ 'show-alert': { type: 'error', message: '切换失败: ' + err.message } }))
    try {
      const { models, defaultModel } = await fetchModels()
      return c.html(<ModelList models={models} defaultModel={defaultModel} />)
    } catch {
      return c.html(<p class="text-sm text-red-500">切换失败</p>, 500)
    }
  }
})

// ─── 渠道列表片段 ───

partialsRouter.get('/channels', async (c) => {
  try {
    const { stdout } = await execa('openclaw', ['config', 'get', '--json', 'channels'])
    const channelsJson = extractJson(stdout) || {}
    const channels = Object.entries(channelsJson).map(([id, value]: any) => ({
      id,
      label: id.toUpperCase(),
      enabled: value?.enabled !== false,
    }))
    if (!channels.length) {
      return c.html(<p class="text-sm text-slate-500">暂无已配置渠道</p>)
    }
    return c.html(
      <>
        {channels.map((ch) => (
          <div class="rounded-xl border border-slate-200 bg-white p-4">
            <strong class="text-sm text-slate-700">{ch.label}</strong>
            <div class="mt-2 text-xs text-slate-500">状态: {ch.enabled ? '已启用' : '未启用'}</div>
          </div>
        ))}
      </>
    )
  } catch {
    return c.html(<p class="text-sm text-red-500">无法读取渠道配置</p>)
  }
})

// ─── 远程支持表单片段 ───

function resolveRemoteSupportPath() {
  const home = process.env.HOME || process.cwd()
  return path.join(home, '.openclaw-helper', 'remote-support.json')
}

partialsRouter.get('/remote-support/form', async (c) => {
  let data = { sshKey: '', cpolarToken: '', region: 'en' }
  try {
    const filePath = resolveRemoteSupportPath()
    if (fs.existsSync(filePath)) {
      data = { ...data, ...JSON.parse(fs.readFileSync(filePath, 'utf-8')) }
    }
  } catch {}
  const alpineInit = JSON.stringify({ sshKey: data.sshKey || '', cpolarToken: data.cpolarToken || '', region: data.region || 'en' })
  return c.html(
    <form x-data={alpineInit} id="remote-form-inner">
      <div class="mt-4">
        <label for="ssh-key" class="mb-2 block text-sm font-medium text-slate-600">SSH Key</label>
        <textarea id="ssh-key" name="sshKey" rows={4} x-model="sshKey" placeholder="粘贴 SSH 公钥" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none"></textarea>
      </div>
      <div class="mt-4">
        <label for="cpolar-token" class="mb-2 block text-sm font-medium text-slate-600">cpolar AuthToken</label>
        <input type="text" id="cpolar-token" name="cpolarToken" x-model="cpolarToken" placeholder="输入 cpolar Authtoken" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
      </div>
      <div class="mt-4">
        <label for="region-select" class="mb-2 block text-sm font-medium text-slate-600">区域</label>
        <select id="region-select" name="region" x-model="region" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none">
          <option value="cn">中国 (cn)</option>
          <option value="uk">美国 (uk)</option>
          <option value="en">欧洲 (en)</option>
        </select>
      </div>
      <div class="mt-6 flex flex-wrap gap-3" id="remote-alert"></div>
      <div class="mt-4 flex flex-wrap gap-3">
        <button type="button" hx-post="/api/partials/remote-support/save" hx-include="#remote-form-inner" hx-target="#remote-alert" hx-swap="innerHTML" class="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">保存配置</button>
        <button type="button" hx-post="/api/partials/remote-support/start" hx-include="#remote-form-inner" hx-target="#remote-alert" hx-swap="innerHTML" x-bind="{ disabled: !sshKey.trim() || !cpolarToken.trim() }" class="rounded-lg bg-indigo-500 px-4 py-2 text-sm text-white hover:bg-indigo-400 disabled:bg-slate-200 disabled:text-slate-400">打开远程支持</button>
      </div>
    </form>
  )
})

partialsRouter.post('/remote-support/save', async (c) => {
  try {
    const body = await c.req.parseBody()
    const filePath = resolveRemoteSupportPath()
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify({ sshKey: body.sshKey || '', cpolarToken: body.cpolarToken || '', region: body.region || 'en' }, null, 2))
    return c.html(<div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">已保存远程支持配置</div>)
  } catch (err: any) {
    return c.html(<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">保存失败: {err.message}</div>)
  }
})

partialsRouter.post('/remote-support/start', async (c) => {
  try {
    const body = await c.req.parseBody()
    const sshKey = (body.sshKey as string || '').trim()
    const cpolarToken = (body.cpolarToken as string || '').trim()
    const region = (body.region as string || 'en')
    if (!sshKey || !cpolarToken) {
      return c.html(<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">请填写 SSH Key 和 cpolar AuthToken</div>)
    }
    // 先保存
    const filePath = resolveRemoteSupportPath()
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify({ sshKey, cpolarToken, region }, null, 2))
    // 启动
    const mappedRegion = region === 'en' ? 'eu' : region
    await execa('cpolar', ['authtoken', cpolarToken])
    await execa('sh', ['-c', `nohup cpolar tcp -region=${mappedRegion} 22 > ${process.env.HOME}/.openclaw/logs/cpolar.log 2>&1 &`])
    return c.html(<div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">远程支持已启动</div>)
  } catch (err: any) {
    return c.html(<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">启动失败: {err.message}</div>)
  }
})
