import { Hono } from 'hono'
import { execa } from 'execa'
import { extractJson, extractPlainValue } from './utils'
import { TelegramGuide } from '../components/TelegramGuide'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const partialsRouter = new Hono()

/** 将对象序列化为纯 ASCII 的 JSON 字符串（非 ASCII 字符用 \uXXXX 转义），避免 HTTP header ByteString 报错 */
function asciiJson(obj: any): string {
  return JSON.stringify(obj).replace(/[\u0080-\uffff]/g, (ch) => {
    return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
  })
}

// ─── 模型列表片段 ───

type ModelInfo = { key: string; label: string; input: string[] }
type ProviderInfo = {
  key: string;
  label: string;
  baseUrl?: string;
  isEditable: boolean;
  isDeletable: boolean;
  models: ModelInfo[];
}

/** 将 input 字段统一为 string[]，兼容数组、"text+image" 字符串、纯字符串等格式 */
function parseInput(raw: any): string[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string' && raw) return raw.split('+').map((s: string) => s.trim()).filter(Boolean)
  return ['text']
}

async function fetchModels() {
  const providersMap = new Map<string, ProviderInfo>();
  
  // 1. 先尝试从 config models.providers 获取完整的 Provider 信息
  try {
    const { stdout: providersRaw } = await execa('openclaw', ['config', 'get', '--json', 'models.providers'])
    const providersJson = extractJson(providersRaw) || {}
    Object.entries(providersJson).forEach(([providerId, provider]: any) => {
      const modelsList: ModelInfo[] = []
      const list = Array.isArray(provider?.models) ? provider.models : []
      list.forEach((model: any) => {
        const id = model?.id || model?.name || 'unknown'
        modelsList.push({
          key: `${providerId}/${id}`,
          label: model?.name || model?.id || id,
          input: parseInput(model?.input),
        })
      })

      providersMap.set(providerId, {
        key: providerId,
        label: providerId, // 默认显示 Provider Key，后续可以优化显示名称
        baseUrl: provider?.baseUrl,
        isEditable: !AUTH_PROVIDERS.has(providerId),
        isDeletable: true,
        models: modelsList
      })
    })
  } catch {}

  // 2. 补充那些可能只在 models list 中出现但不在 config providers 中的模型（如果有的话，通常是内置的）
  try {
    const { stdout: modelsRaw } = await execa('openclaw', ['models', 'list', '--json'])
    const modelsJson = extractJson(modelsRaw)
    if (modelsJson && Array.isArray(modelsJson.models)) {
      modelsJson.models.forEach((m: any) => {
        const fullKey = m.key || 'unknown/unknown'
        const [providerId, modelId] = fullKey.split('/')
        
        // 如果这个 Provider 还没记录，或者虽然记录了但没有这个模型（不太可能发生，除非状态不一致），则补充
        if (!providersMap.has(providerId)) {
          providersMap.set(providerId, {
            key: providerId,
            label: providerId,
            isEditable: !AUTH_PROVIDERS.has(providerId),
            isDeletable: true,
            models: []
          })
        }
        
        const providerInfo = providersMap.get(providerId)!
        if (!providerInfo.models.find(xm => xm.key === fullKey)) {
          providerInfo.models.push({
            key: fullKey,
            label: m.name || m.key || modelId,
            input: parseInput(m.input),
          })
        }
      })
    }
  } catch {}

  let defaultModel: string | null = null
  try {
    const { stdout } = await execa('openclaw', ['config', 'get', 'agents.defaults.model.primary'])
    defaultModel = extractPlainValue(stdout) || null
  } catch {
    defaultModel = null
  }

  return { providers: Array.from(providersMap.values()), defaultModel }
}

/** OAuth 认证提供商（不支持编辑/删除） */
const AUTH_PROVIDERS = new Set(['qwen-portal', 'openai-codex'])

const INPUT_LABELS: Record<string, string> = {
  text: '文本',
  image: '图片',
  audio: '音频',
  video: '视频',
}

function ProviderCard(props: { provider: ProviderInfo; defaultModel: string | null }) {
  return (
    <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="flex items-start justify-between">
        <div>
          <h3 class="text-base font-semibold text-slate-800">{props.provider.label}</h3>
          {props.provider.baseUrl && (
             <p class="mt-0.5 text-xs text-slate-400 font-mono break-all">{props.provider.baseUrl}</p>
          )}
        </div>
        {props.provider.isDeletable && (
           <button
             class="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
             hx-post={`/api/partials/providers/${encodeURIComponent(props.provider.key)}/delete`}
             hx-target="#model-list"
             hx-swap="innerHTML"
             hx-confirm={`确定要删除整个 ${props.provider.key} 提供商吗？这将删除其下所有模型配置。`}
             hx-disabled-elt="this"
           >
             <span class="hx-ready">删除 Provider</span>
             <span class="hx-loading items-center gap-1">
               <svg class="animate-spin h-3 w-3 inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
               删除中…
             </span>
           </button>
        )}
      </div>

      <div class="mt-4 space-y-3">
        {props.provider.models.length === 0 ? (
          <p class="text-sm text-slate-400 italic">暂无模型配置</p>
        ) : (
          props.provider.models.map((model) => {
             const isDefault = model.key === props.defaultModel;
             // fix: 解析出 modelId
             const modelId = model.key.split('/').slice(1).join('/');
             
             return (
               <div class={`relative flex items-center justify-between rounded-lg border px-3 py-2.5 ${isDefault ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-100 bg-slate-50/50'}`}>
                 <div class="min-w-0 flex-1 pr-4">
                   <div class="flex items-center gap-2">
                     <span class="truncate text-sm font-medium text-slate-700" title={model.label}>{model.label}</span>
                     {isDefault && <span class="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">默认</span>}
                   </div>
                   <div class="mt-1 flex flex-wrap gap-1">
                     {model.input.map((t) => (
                       <span class="inline-flex items-center rounded text-[10px] text-slate-500">
                         {INPUT_LABELS[t] || t}
                       </span>
                     ))}
                   </div>
                 </div>
                 
                 <div class="flex shrink-0 items-center gap-2">
                    {!isDefault && (
                      <button
                        class="text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
                        hx-post="/api/partials/models/default"
                        hx-vals={JSON.stringify({ model: model.key })}
                        hx-target="#model-list"
                        hx-swap="innerHTML"
                        hx-disabled-elt="this"
                      >
                         <span class="hx-ready">设为默认</span>
                         <span class="hx-loading">设置中...</span>
                      </button>
                    )}
                    {props.provider.isEditable && (
                      <>
                        <span class="text-slate-300">|</span>
                        <button
                          class="text-xs text-slate-600 hover:text-indigo-600"
                          hx-get={`/api/partials/models/${encodeURIComponent(props.provider.key)}/${encodeURIComponent(modelId)}/edit`}
                          hx-target="#model-form-area"
                          hx-swap="innerHTML show:#model-form-area:top"
                          hx-disabled-elt="this"
                        >
                           <span class="hx-ready">编辑</span>
                           <span class="hx-loading">编辑中...</span>
                        </button>
                      </>
                    )}
                    {props.provider.isDeletable && (
                      <>
                        <span class="text-slate-300">|</span>
                        <button
                          class="text-xs text-red-500 hover:text-red-700"
                          hx-post={`/api/partials/models/${encodeURIComponent(props.provider.key)}/${encodeURIComponent(modelId)}/delete`}
                          hx-target="#model-list"
                          hx-swap="innerHTML"
                          hx-confirm="确定要删除此模型吗？"
                          hx-disabled-elt="this"
                        >
                           <span class="hx-ready">删除</span>
                           <span class="hx-loading">删除中...</span>
                        </button>
                      </>
                    )}
                 </div>
               </div>
             )
          })
        )}
      </div>
      
      {props.provider.isEditable && (
        <div class="mt-4 pt-3 border-t border-slate-100">
           <button
             class="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 py-2 text-sm text-slate-500 hover:border-indigo-300 hover:bg-indigo-50/30 hover:text-indigo-600 transition-colors"
             hx-get={`/api/partials/providers/${encodeURIComponent(props.provider.key)}/add-model`}
             hx-target="#model-form-area"
             hx-swap="innerHTML show:#model-form-area:top"
           >
             <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
             添加模型
           </button>
        </div>
      )}
    </div>
  )
}

function ModelList(props: { providers: ProviderInfo[]; defaultModel: string | null }) {
  if (!props.providers.length) {
    return <p class="text-sm text-slate-500">暂无已配置模型提供商</p>
  }
  
  // 找到默认模型对应的 Provider 名称和模型名称
  let defaultLabel = "未设置";
  if (props.defaultModel) {
      for (const p of props.providers) {
          const m = p.models.find(x => x.key === props.defaultModel);
          if (m) {
              defaultLabel = `${p.label} / ${m.label}`;
              break;
          }
      }
      if (defaultLabel === "未设置") {
          defaultLabel = props.defaultModel; // Fallback
      }
  }

  return (
    <>
      <div class="col-span-full mb-4 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 flex items-center justify-between">
        <div>
           <span class="text-sm text-slate-600">当前默认模型：</span>
           <strong class="text-sm text-indigo-700">{defaultLabel}</strong>
        </div>
      </div>
      
      <div class="col-span-full grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-2">
        {props.providers.map((provider) => (
          <ProviderCard provider={provider} defaultModel={props.defaultModel} />
        ))}
      </div>
    </>
  )
}

partialsRouter.get('/models', async (c) => {
  try {
    const { providers, defaultModel } = await fetchModels()
    return c.html(<ModelList providers={providers} defaultModel={defaultModel} />)
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
    const { providers, defaultModel } = await fetchModels()
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'success', message: '已切换默认模型' } }))
    return c.html(<ModelList providers={providers} defaultModel={defaultModel} />)
  } catch (err: any) {
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: '切换失败: ' + err.message } }))
    try {
      const { providers, defaultModel } = await fetchModels()
      return c.html(<ModelList providers={providers} defaultModel={defaultModel} />)
    } catch {
      return c.html(<p class="text-sm text-red-500">切换失败</p>, 500)
    }
  }
})

// ─── 模型编辑 ───

partialsRouter.get('/models/:provider/:modelId/edit', async (c) => {
  const providerKey = c.req.param('provider')
  const targetModelId = c.req.param('modelId')

  if (AUTH_PROVIDERS.has(providerKey)) {
    return c.html(<p class="text-sm text-red-500">此模型使用 OAuth 认证，不支持手动编辑</p>, 400)
  }

  try {
    const { stdout } = await execa('openclaw', ['config', 'get', '--json', `models.providers.${providerKey}`])
    const config = extractJson(stdout) || {} as any
    const baseUrl = config.baseUrl || ''
    const apiKey = config.apiKey || ''
    
    const models = Array.isArray(config.models) ? config.models : []
    const model = models.find((m: any) => m.id === targetModelId) || {} as any
    const modelId = model.id || ''
    const inputTypes = parseInput(model.input)

    return c.html(
      <div class="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-6">
        <div class="flex items-center justify-between">
          <h4 class="text-lg font-semibold text-slate-800">编辑模型 — {providerKey}</h4>
          <button onclick="document.getElementById('model-form-area').innerHTML=''" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100">✕ 关闭</button>
        </div>
        <form class="mt-4 space-y-4" id={`model-edit-form-${providerKey}`}>
          <div>
            <label class="mb-2 block text-sm font-medium text-slate-600">API Base URL <span class="text-red-400">*</span></label>
            <input type="text" name="baseUrl" value={baseUrl} placeholder="例如：https://gptproto.com/v1" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-slate-600">API Key <span class="text-red-400">*</span></label>
            <input type="password" name="apiKey" value={apiKey} placeholder="请输入 API Key" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-slate-600">模型 ID <span class="text-red-400">*</span></label>
            <input type="text" name="modelId" value={modelId} placeholder="例如：gemini-3-pro-preview、deepseek-chat" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-slate-600">支持的输入类型</label>
            <div class="flex flex-wrap gap-4 mt-2">
              <label class="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" name="inputTypes" value="text" checked={inputTypes.includes('text')} class="rounded" /> 文本</label>
              <label class="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" name="inputTypes" value="image" checked={inputTypes.includes('image')} class="rounded" /> 图片</label>
              <label class="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" name="inputTypes" value="audio" checked={inputTypes.includes('audio')} class="rounded" /> 音频</label>
            </div>
          </div>
          <div class="mt-6 flex justify-end gap-3">
            <button type="button" onclick="document.getElementById('model-form-area').innerHTML=''" class="rounded-lg border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button>
            <button
              type="button"
              class="rounded-lg bg-indigo-500 px-5 py-2 text-sm text-white hover:bg-indigo-400 disabled:bg-slate-200 disabled:text-slate-400"
              hx-post={`/api/partials/models/${encodeURIComponent(providerKey)}/${encodeURIComponent(targetModelId)}/save`}
              hx-include={`#model-edit-form-${providerKey}`}
              hx-target="#model-list"
              hx-swap="innerHTML"
              hx-disabled-elt="this"
            >
              <span class="hx-ready">保存修改</span>
              <span class="hx-loading items-center gap-1">
                <svg class="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                保存中…
              </span>
            </button>
          </div>
        </form>
      </div>
    )
  } catch (err: any) {
    return c.html(<p class="text-sm text-red-500">无法读取模型配置: {err.message}</p>)
  }
})

partialsRouter.post('/models/:provider/:modelId/save', async (c) => {
  const providerKey = c.req.param('provider')
  const originalModelId = c.req.param('modelId')

  try {
    const body = await c.req.parseBody({ all: true })
    const baseUrl = (body.baseUrl as string || '').trim()
    const apiKey = (body.apiKey as string || '').trim()
    const modelId = (body.modelId as string || '').trim()
    const inputTypesRaw = body['inputTypes']
    const inputTypes = Array.isArray(inputTypesRaw)
      ? inputTypesRaw as string[]
      : (inputTypesRaw ? [inputTypesRaw as string] : ['text'])

    if (!baseUrl || !apiKey || !modelId) {
      c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: '请填写 API Base URL、API Key 和模型 ID' } }))
      const { providers, defaultModel } = await fetchModels()
      return c.html(<ModelList providers={providers} defaultModel={defaultModel} />)
    }

    // 读取现有的 provider 配置
    let existingConfig: any = {}
    try {
      const { stdout } = await execa('openclaw', ['config', 'get', '--json', `models.providers.${providerKey}`])
      existingConfig = extractJson(stdout) || {}
    } catch {}

    const existingModels = Array.isArray(existingConfig.models) ? existingConfig.models : []
    const modelIndex = existingModels.findIndex((m: any) => m.id === originalModelId)

    if (modelIndex === -1) {
       c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: '找不到原始模型配置' } }))
       const { providers, defaultModel } = await fetchModels()
       return c.html(<ModelList providers={providers} defaultModel={defaultModel} />)
    }

    const existingModel = existingModels[modelIndex]

    // 更新模型信息
    existingModels[modelIndex] = {
      ...existingModel,
      id: modelId,
      name: modelId,
      input: inputTypes,
    }

    // 写回配置
    // 分别更新各个字段，避免覆盖可能被隐藏的敏感信息（如 apiKey）
    
    // 1. 更新 baseUrl
    if (baseUrl) {
      await execa('openclaw', ['config', 'set', '--json', `models.providers.${providerKey}.baseUrl`, JSON.stringify(baseUrl)])
    }

    // 2. 更新 apiKey (仅当不是 redacted 占位符时)
    if (apiKey && apiKey !== '__OPENCLAW_REDACTED__') {
      await execa('openclaw', ['config', 'set', '--json', `models.providers.${providerKey}.apiKey`, JSON.stringify(apiKey)])
    }

    // 3. 更新 models 列表
    await execa('openclaw', [
      'config', 'set', '--json', `models.providers.${providerKey}.models`,
      JSON.stringify(existingModels),
    ])

    // 如果模型 ID 发生变化，更新 agents.defaults.models 中的 key
    if (originalModelId && originalModelId !== modelId) {
      let defaultModels: Record<string, any> = {}
      try {
        const { stdout } = await execa('openclaw', ['config', 'get', '--json', 'agents.defaults.models'])
        defaultModels = extractJson(stdout) || {}
      } catch {}

      const oldKey = `${providerKey}/${originalModelId}`
      const newKey = `${providerKey}/${modelId}`
      if (defaultModels[oldKey] !== undefined) {
        defaultModels[newKey] = defaultModels[oldKey]
        delete defaultModels[oldKey]
        await execa('openclaw', ['config', 'set', '--json', 'agents.defaults.models', JSON.stringify(defaultModels)])
      }

      // 如果旧 key 是默认模型，更新默认模型指向新 key
      let currentDefault: string | null = null
      try {
        const { stdout } = await execa('openclaw', ['config', 'get', 'agents.defaults.model.primary'])
        currentDefault = extractPlainValue(stdout) || null
      } catch {}
      if (currentDefault === oldKey) {
        await execa('openclaw', ['config', 'set', '--json', 'agents.defaults.model', JSON.stringify({ primary: newKey })])
      }
    }

    const { providers, defaultModel } = await fetchModels()
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'success', message: '模型配置已更新' } }))
    return c.html(
      <>
        <ModelList providers={providers} defaultModel={defaultModel} />
        <div id="model-form-area" hx-swap-oob="innerHTML"></div>
      </>
    )
  } catch (err: any) {
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: '保存失败: ' + err.message } }))
    try {
      const { providers, defaultModel } = await fetchModels()
      return c.html(<ModelList providers={providers} defaultModel={defaultModel} />)
    } catch {
      return c.html(<p class="text-sm text-red-500">保存失败</p>, 500)
    }
  }
})

partialsRouter.post('/models/:provider/:modelId/delete', async (c) => {
  const providerKey = c.req.param('provider')
  const targetModelId = c.req.param('modelId')

  // 注意：不再检查 AUTH_PROVIDERS，允许删除所有类型的模型配置（如果配置存在的话）

  try {
    // 读取特定 provider 配置，而不是所有 providers
    let providerConfig: any = {}
    try {
      const { stdout } = await execa('openclaw', ['config', 'get', '--json', `models.providers.${providerKey}`])
      providerConfig = extractJson(stdout) || {}
    } catch {}

    if (providerConfig && Object.keys(providerConfig).length > 0) {
       const existingModels = Array.isArray(providerConfig.models) ? providerConfig.models : []
       const newModels = existingModels.filter((m: any) => m.id !== targetModelId)
       
       if (newModels.length === 0) {
         // 如果没有模型了，删除整个 provider
         await execa('openclaw', ['config', 'unset', `models.providers.${providerKey}`])
       } else {
         // 否则只更新 models 列表，避免覆盖可能被隐藏的敏感信息
         await execa('openclaw', ['config', 'set', '--json', `models.providers.${providerKey}.models`, JSON.stringify(newModels)])
       }
    }

    // 从 agents.defaults.models 中移除相关 key
    let defaultModels: Record<string, any> = {}
    try {
      const { stdout } = await execa('openclaw', ['config', 'get', '--json', 'agents.defaults.models'])
      defaultModels = extractJson(stdout) || {}
    } catch {}

    const targetKey = `${providerKey}/${targetModelId}`
    if (defaultModels[targetKey]) {
      delete defaultModels[targetKey]
      await execa('openclaw', ['config', 'set', '--json', 'agents.defaults.models', JSON.stringify(defaultModels)])
    }

    // 如果被删除的模型是默认模型，切换到第一个可用模型
    let currentDefault: string | null = null
    try {
      const { stdout } = await execa('openclaw', ['config', 'get', 'agents.defaults.model.primary'])
      currentDefault = extractPlainValue(stdout) || null
    } catch {}

    if (currentDefault === targetKey) {
      const { providers: newProviders } = await fetchModels()
      // 尝试找一个可用的模型
      let nextModelKey: string | null = null;
      for(const p of newProviders) {
        if(p.models.length > 0) {
          nextModelKey = p.models[0].key;
          break;
        }
      }

      if (nextModelKey) {
        await execa('openclaw', ['config', 'set', '--json', 'agents.defaults.model', JSON.stringify({ primary: nextModelKey })])
      }
    }

    const { providers, defaultModel } = await fetchModels()
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'success', message: `已删除模型 ${targetModelId}` } }))
    return c.html(
      <>
        <ModelList providers={providers} defaultModel={defaultModel} />
        <div id="model-form-area" hx-swap-oob="innerHTML"></div>
      </>
    )
  } catch (err: any) {
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: '删除失败: ' + err.message } }))
    try {
      const { providers, defaultModel } = await fetchModels()
      return c.html(<ModelList providers={providers} defaultModel={defaultModel} />)
    } catch {
      return c.html(<p class="text-sm text-red-500">删除失败</p>, 500)
    }
  }
})

// ─── Provider 管理 ───

partialsRouter.post('/providers/:provider/delete', async (c) => {
  const providerKey = c.req.param('provider')
  // 注意：不再检查 AUTH_PROVIDERS，允许删除所有类型的 Provider

  try {
    // 直接删除 provider 配置，无需读取所有配置
    try {
      await execa('openclaw', ['config', 'unset', `models.providers.${providerKey}`])
    } catch (e: any) {
      // 忽略可能的错误（如不存在）
      console.warn(`删除 provider ${providerKey} 失败 (可能不存在):`, e.message)
    }

    // 清理 agents.defaults.models
    let defaultModels: Record<string, any> = {}
    try {
      const { stdout } = await execa('openclaw', ['config', 'get', '--json', 'agents.defaults.models'])
      defaultModels = extractJson(stdout) || {}
    } catch {}

    let changed = false
    for (const key of Object.keys(defaultModels)) {
      if (key.startsWith(`${providerKey}/`)) {
        delete defaultModels[key]
        changed = true
      }
    }
    if (changed) {
      await execa('openclaw', ['config', 'set', '--json', 'agents.defaults.models', JSON.stringify(defaultModels)])
    }

    // 检查默认模型
    let currentDefault: string | null = null
    try {
      const { stdout } = await execa('openclaw', ['config', 'get', 'agents.defaults.model.primary'])
      currentDefault = extractPlainValue(stdout) || null
    } catch {}

    if (currentDefault && currentDefault.startsWith(`${providerKey}/`)) {
       const { providers: newProviders } = await fetchModels()
       // 尝试找一个可用的模型
       let nextModelKey: string | null = null;
       for(const p of newProviders) {
         if(p.models.length > 0) {
           nextModelKey = p.models[0].key;
           break;
         }
       }

       if (nextModelKey) {
         await execa('openclaw', ['config', 'set', '--json', 'agents.defaults.model', JSON.stringify({ primary: nextModelKey })])
       }
    }

    const { providers, defaultModel } = await fetchModels()
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'success', message: `已删除提供商 ${providerKey}` } }))
    return c.html(
      <>
        <ModelList providers={providers} defaultModel={defaultModel} />
        <div id="model-form-area" hx-swap-oob="innerHTML"></div>
      </>
    )
  } catch (err: any) {
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: '删除失败: ' + err.message } }))
    try {
      const { providers, defaultModel } = await fetchModels()
      return c.html(<ModelList providers={providers} defaultModel={defaultModel} />)
    } catch {
      return c.html(<p class="text-sm text-red-500">删除失败</p>, 500)
    }
  }
})

partialsRouter.get('/providers/:provider/add-model', async (c) => {
  const providerKey = c.req.param('provider')
  if (AUTH_PROVIDERS.has(providerKey)) {
    return c.html(<p class="text-sm text-red-500">此提供商不支持手动添加模型</p>, 400)
  }

  return c.html(
    <div class="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-6">
      <div class="flex items-center justify-between">
        <h4 class="text-lg font-semibold text-slate-800">添加模型 — {providerKey}</h4>
        <button onclick="document.getElementById('model-form-area').innerHTML=''" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100">✕ 关闭</button>
      </div>
      <div class="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
        将使用该提供商已配置的 Base URL 和 API Key。
      </div>
      <form class="mt-4 space-y-4" id={`model-add-form-${providerKey}`}>
        <div>
          <label class="mb-2 block text-sm font-medium text-slate-600">模型 ID <span class="text-red-400">*</span></label>
          <input type="text" name="modelId" placeholder="例如：gemini-3-pro-preview、deepseek-chat" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
        </div>
        <div>
          <label class="mb-2 block text-sm font-medium text-slate-600">支持的输入类型</label>
          <div class="flex flex-wrap gap-4 mt-2">
            <label class="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" name="inputTypes" value="text" checked class="rounded" /> 文本</label>
            <label class="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" name="inputTypes" value="image" class="rounded" /> 图片</label>
            <label class="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" name="inputTypes" value="audio" class="rounded" /> 音频</label>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-3">
          <button type="button" onclick="document.getElementById('model-form-area').innerHTML=''" class="rounded-lg border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button>
          <button
            type="button"
            class="rounded-lg bg-indigo-500 px-5 py-2 text-sm text-white hover:bg-indigo-400 disabled:bg-slate-200 disabled:text-slate-400"
            hx-post={`/api/partials/providers/${encodeURIComponent(providerKey)}/add-model`}
            hx-include={`#model-add-form-${providerKey}`}
            hx-target="#model-list"
            hx-swap="innerHTML"
            hx-disabled-elt="this"
          >
            <span class="hx-ready">添加模型</span>
            <span class="hx-loading items-center gap-1">
              <svg class="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
              添加中…
            </span>
          </button>
        </div>
      </form>
    </div>
  )
})

partialsRouter.post('/providers/:provider/add-model', async (c) => {
  const providerKey = c.req.param('provider')
  try {
    const body = await c.req.parseBody({ all: true })
    const modelId = (body.modelId as string || '').trim()
    const inputTypesRaw = body['inputTypes']
    const inputTypes = Array.isArray(inputTypesRaw)
      ? inputTypesRaw as string[]
      : (inputTypesRaw ? [inputTypesRaw as string] : ['text'])

    if (!modelId) {
      c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: '请填写模型 ID' } }))
      const { providers, defaultModel } = await fetchModels()
      return c.html(<ModelList providers={providers} defaultModel={defaultModel} />)
    }

    // 读取现有的 provider 配置
    let existingConfig: any = {}
    try {
      const { stdout } = await execa('openclaw', ['config', 'get', '--json', `models.providers.${providerKey}`])
      existingConfig = extractJson(stdout) || {}
    } catch {}

    if (!existingConfig || Object.keys(existingConfig).length === 0) {
       c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: '提供商配置不存在' } }))
       const { providers, defaultModel } = await fetchModels()
       return c.html(<ModelList providers={providers} defaultModel={defaultModel} />)
    }

    const existingModels = Array.isArray(existingConfig.models) ? existingConfig.models : []
    const existingIndex = existingModels.findIndex((m: any) => m.id === modelId)

    const newModelConfig = {
      id: modelId,
      name: modelId,
      reasoning: false,
      input: inputTypes,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192,
    }

    if (existingIndex !== -1) {
       // 更新
       existingModels[existingIndex] = newModelConfig
    } else {
       // 追加
       existingModels.push(newModelConfig)
    }

    // 写回配置
    // 仅更新 models 列表，避免覆盖可能被隐藏的敏感信息（如 apiKey）
    await execa('openclaw', [
      'config', 'set', '--json', `models.providers.${providerKey}.models`,
      JSON.stringify(existingModels),
    ])

    // 注册到 agents.defaults.models
    const modelKey = `${providerKey}/${modelId}`
    await execa('openclaw', [
       'config', 'set', '--json', `agents.defaults.models.${modelKey.replace(/\//g, '.')}`, // 注意：openclaw config set key 需要转义吗？通常不需要，json key 是字符串
       '{}' // 注册为空对象即可
    ])
    // 上面那个 config set key 可能会有问题如果 key 包含 /，使用 mergeDefaultModels 风格的逻辑更稳妥
    // 这里简单起见，直接用 json set agents.defaults.models
    let defaultModels: Record<string, any> = {}
    try {
      const { stdout } = await execa('openclaw', ['config', 'get', '--json', 'agents.defaults.models'])
      defaultModels = extractJson(stdout) || {}
    } catch {}
    defaultModels[modelKey] = {}
    await execa('openclaw', ['config', 'set', '--json', 'agents.defaults.models', JSON.stringify(defaultModels)])


    const { providers, defaultModel } = await fetchModels()
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'success', message: '模型已添加' } }))
    return c.html(
      <>
        <ModelList providers={providers} defaultModel={defaultModel} />
        <div id="model-form-area" hx-swap-oob="innerHTML"></div>
      </>
    )
  } catch (err: any) {
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: '添加失败: ' + err.message } }))
    try {
      const { providers, defaultModel } = await fetchModels()
      return c.html(<ModelList providers={providers} defaultModel={defaultModel} />)
    } catch {
      return c.html(<p class="text-sm text-red-500">添加失败</p>, 500)
    }
  }
})

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
  const { stdout } = await execa('openclaw', ['config', 'get', '--json', 'channels'])
  const channelsJson = extractJson(stdout) || {}
  return Object.entries(channelsJson).map(([id, value]: any) => {
    const enabled = isChannelEnabled(id, value)
    // WhatsApp 额外检查是否已完成扫码链接
    const linked = id === 'whatsapp' ? isWhatsAppLinked() : undefined
    return { id, label: id.toUpperCase(), enabled, linked, config: value }
  })
}

async function fetchChannelConfig(channelId: string) {
  try {
    const { stdout } = await execa('openclaw', ['config', 'get', '--json', `channels.${channelId}`])
    return extractJson(stdout) || {}
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
partialsRouter.get('/channels', async (c) => {
  try {
    const channels = await fetchChannels()
    return c.html(<ChannelList channels={channels} />)
  } catch {
    return c.html(<p class="text-sm text-red-500">无法读取渠道配置</p>)
  }
})

// 可用（未配置）渠道列表
partialsRouter.get('/channels/available', async (c) => {
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
partialsRouter.get('/channels/add/:type', async (c) => {
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
partialsRouter.post('/channels/add/telegram', async (c) => {
  try {
    const body = await c.req.parseBody()
    const botToken = (body.botToken as string || '').trim()
    const userId = (body.userId as string || '').trim()
    if (!botToken || !userId) {
      c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: '请填写 Bot Token 和用户 ID' } }))
      const channels = await fetchChannels()
      return c.html(<ChannelList channels={channels} />)
    }
    await execa('openclaw', ['config', 'set', '--json', 'channels.telegram.botToken', JSON.stringify(botToken)])
    await execa('openclaw', ['config', 'set', '--json', 'channels.telegram.allowFrom', JSON.stringify([userId])])
    // 重启 gateway
    try { await execa('pkill', ['-f', 'openclaw.*gateway']); await new Promise((r) => setTimeout(r, 2000)) } catch {}
    const logFile = `${process.env.HOME}/.openclaw/logs/gateway.log`
    execa('sh', ['-c', `nohup openclaw gateway run --bind loopback --port 18789 > ${logFile} 2>&1 &`])
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
partialsRouter.get('/channels/:id/edit', async (c) => {
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
partialsRouter.post('/channels/whatsapp/save', async (c) => {
  try {
    const body = await c.req.parseBody({ all: true })
    const dmPolicy = (body.dmPolicy as string || 'pairing').trim()
    const allowFromRaw = (body.allowFrom as string || '').trim()
    const selfChatMode = body.selfChatMode === 'true'

    // 设置 DM 策略
    await execa('openclaw', ['config', 'set', '--json', 'channels.whatsapp.dmPolicy', JSON.stringify(dmPolicy)])
    await execa('openclaw', ['config', 'set', '--json', 'channels.whatsapp.selfChatMode', String(selfChatMode)])

    // 设置白名单
    if (dmPolicy === 'open') {
      await execa('openclaw', ['config', 'set', '--json', 'channels.whatsapp.allowFrom', JSON.stringify(['*'])])
    } else if (allowFromRaw) {
      const numbers = allowFromRaw
        .split(/[,;\n]+/)
        .map((n: string) => n.trim().replace(/[\s\-()]/g, ''))
        .filter(Boolean)
        .map((n: string) => (n === '*' ? '*' : n.startsWith('+') ? n : `+${n}`))
      await execa('openclaw', ['config', 'set', '--json', 'channels.whatsapp.allowFrom', JSON.stringify(numbers)])
    }

    // 确保账户启用
    await execa('openclaw', ['config', 'set', '--json', 'channels.whatsapp.accounts.default.enabled', 'true'])

    // 重启 gateway
    try { await execa('pkill', ['-f', 'openclaw.*gateway']); await new Promise((r) => setTimeout(r, 2000)) } catch {}
    const logFile = `${process.env.HOME}/.openclaw/logs/gateway.log`
    execa('sh', ['-c', `nohup openclaw gateway run --bind loopback --port 18789 > ${logFile} 2>&1 &`])
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
partialsRouter.post('/channels/:id/save', async (c) => {
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
    await execa('openclaw', ['config', 'set', '--json', 'channels.telegram.botToken', JSON.stringify(botToken)])
    await execa('openclaw', ['config', 'set', '--json', 'channels.telegram.allowFrom', JSON.stringify([userId])])
    // 重启 gateway
    try { await execa('pkill', ['-f', 'openclaw.*gateway']); await new Promise((r) => setTimeout(r, 2000)) } catch {}
    const logFile = `${process.env.HOME}/.openclaw/logs/gateway.log`
    execa('sh', ['-c', `nohup openclaw gateway run --bind loopback --port 18789 > ${logFile} 2>&1 &`])
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
partialsRouter.post('/channels/:id/toggle', async (c) => {
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
      await execa('openclaw', ['config', 'set', '--json', `channels.whatsapp.accounts.${targetAccount}.enabled`, String(newEnabled)])
    } else {
      await execa('openclaw', ['config', 'set', `channels.${channelId}.enabled`, String(newEnabled)])
    }
    // 重启 gateway
    try { await execa('pkill', ['-f', 'openclaw.*gateway']); await new Promise((r) => setTimeout(r, 2000)) } catch {}
    const logFile = `${process.env.HOME}/.openclaw/logs/gateway.log`
    execa('sh', ['-c', `nohup openclaw gateway run --bind loopback --port 18789 > ${logFile} 2>&1 &`])
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

// ─── Skills 管理 ───

partialsRouter.get('/skills/apple-notes/status', async (c) => {
  try {
    // 尝试读取 Notes 文件夹列表，如果成功则表示有权限
    await execa('osascript', ['-e', 'tell application "Notes" to count folders'])
    return c.json({ authorized: true })
  } catch (e: any) {
    // 权限错误通常是 -1743 (not authorized) 或 -10004 (permission violation)
    // 但无论什么错误，只要不是成功，都认为未授权或无法访问
    return c.json({ authorized: false, error: e.message })
  }
})

partialsRouter.post('/skills/apple-notes/authorize', async (c) => {
  try {
    // 触发权限弹窗。这里使用 count folders 因为它明确需要数据访问权限。
    // 我们不需要等待它完成（因为用户可能需要时间点击），或者我们可以设置一个短超时。
    // 但为了简单，我们让它在后台跑，或者等待它失败（如果用户还没点）。
    // 实际上，osascript 会阻塞直到用户点击弹窗（允许或拒绝）。
    // 我们可以设置一个较长的超时，让用户有时间点击。
    await execa('osascript', ['-e', 'tell application "Notes" to count folders'], { timeout: 30000 })
    return c.json({ success: true })
  } catch (e: any) {
    // 如果用户拒绝，或者超时，都会抛出错误
    return c.json({ success: false, error: e.message }, 400)
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
