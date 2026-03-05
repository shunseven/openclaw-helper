import { Hono } from 'hono'
import { execOpenClaw, extractJson, extractPlainValue } from '../utils'
import { syncAuthProfile, removeAuthProfile } from '../config/common'

export const modelsRouter = new Hono()

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
  if (Array.isArray(raw)) return raw as string[]
  if (typeof raw === 'string' && raw) return raw.split('+').map((s: string) => s.trim()).filter(Boolean)
  return ['text']
}

async function fetchModels() {
  const providersMap = new Map<string, ProviderInfo>();
  
  // 1. 先尝试从 config models.providers 获取完整的 Provider 信息
  try {
    const { stdout: providersRaw } = await execOpenClaw( ['config', 'get', '--json', 'models.providers'])
    const providersJson = extractJson(providersRaw as string) || {}
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
    const { stdout: modelsRaw } = await execOpenClaw( ['models', 'list', '--json'])
    const modelsJson = extractJson(modelsRaw as string)
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
    const { stdout } = await execOpenClaw( ['config', 'get', 'agents.defaults.model.primary'])
    defaultModel = extractPlainValue(stdout as string) || null
  } catch {
    defaultModel = null
  }

  return { providers: Array.from(providersMap.values()), defaultModel }
}

/** OAuth 认证提供商（不支持编辑/删除） */
const AUTH_PROVIDERS = new Set(['qwen-portal', 'openai-codex'])

const AUTH_PROVIDER_REAUTH_MAP: Record<string, string> = {
  'qwen-portal': 'qwen',
  'openai-codex': 'gpt',
}

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
      {AUTH_PROVIDER_REAUTH_MAP[props.provider.key] && (
        <div class="mt-4 pt-3 border-t border-slate-100">
           <button
             class="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-amber-300 py-2 text-sm text-amber-600 hover:border-amber-400 hover:bg-amber-50/50 hover:text-amber-700 transition-colors"
             onclick={`window.dispatchEvent(new CustomEvent('reauth-provider', {detail:{provider:'${AUTH_PROVIDER_REAUTH_MAP[props.provider.key]}'}}))`}
           >
             <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
             重新认证
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

modelsRouter.get('/models', async (c) => {
  try {
    const { providers, defaultModel } = await fetchModels()
    return c.html(<ModelList providers={providers} defaultModel={defaultModel} />)
  } catch {
    return c.html(<p class="text-sm text-red-500">无法读取模型配置</p>)
  }
})

modelsRouter.post('/models/default', async (c) => {
  const body = await c.req.parseBody()
  const model = body.model as string
  if (!model) return c.html(<p class="text-sm text-red-500">缺少模型参数</p>, 400)
  try {
    await execOpenClaw( ['config', 'set', '--json', 'agents.defaults.model', JSON.stringify({ primary: model })])
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

modelsRouter.get('/models/:provider/:modelId/edit', async (c) => {
  const providerKey = c.req.param('provider')
  const targetModelId = c.req.param('modelId')

  if (!providerKey || !targetModelId) {
    return c.html(<p class="text-sm text-red-500">缺少参数</p>, 400)
  }

  if (AUTH_PROVIDERS.has(providerKey as string)) {
    return c.html(<p class="text-sm text-red-500">此模型使用 OAuth 认证，不支持手动编辑</p>, 400)
  }

  try {
    const { stdout } = await execOpenClaw( ['config', 'get', '--json', `models.providers.${providerKey}`])
    const config = extractJson(stdout as string) || {} as any
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

modelsRouter.post('/models/:provider/:modelId/save', async (c) => {
  const providerKey = c.req.param('provider')
  const originalModelId = c.req.param('modelId')

  if (!providerKey || !originalModelId) {
    return c.html(<p class="text-sm text-red-500">缺少参数</p>, 400)
  }

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
      const { stdout } = await execOpenClaw( ['config', 'get', '--json', `models.providers.${providerKey}`])
      existingConfig = extractJson(stdout as string) || {}
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
      await execOpenClaw( ['config', 'set', '--json', `models.providers.${providerKey}.baseUrl`, JSON.stringify(baseUrl)])
    }

    // 2. 更新 apiKey (仅当不是 redacted 占位符时)
    if (apiKey && apiKey !== '__OPENCLAW_REDACTED__') {
      await execOpenClaw( ['config', 'set', '--json', `models.providers.${providerKey}.apiKey`, JSON.stringify(apiKey)])
      syncAuthProfile(providerKey, apiKey)
    }

    // 3. 更新 models 列表
    await execOpenClaw( [
      'config', 'set', '--json', `models.providers.${providerKey}.models`,
      JSON.stringify(existingModels),
    ])

    // 如果模型 ID 发生变化，更新 agents.defaults.models 中的 key
    if (originalModelId && originalModelId !== modelId) {
      let defaultModels: Record<string, any> = {}
      try {
        const { stdout } = await execOpenClaw( ['config', 'get', '--json', 'agents.defaults.models'])
        defaultModels = extractJson(stdout as string) || {}
      } catch {}

      const oldKey = `${providerKey}/${originalModelId}`
      const newKey = `${providerKey}/${modelId}`
      if (defaultModels[oldKey] !== undefined) {
        defaultModels[newKey] = defaultModels[oldKey]
        delete defaultModels[oldKey]
        await execOpenClaw( ['config', 'set', '--json', 'agents.defaults.models', JSON.stringify(defaultModels)])
      }

      // 如果旧 key 是默认模型，更新默认模型指向新 key
      let currentDefault: string | null = null
      try {
        const { stdout } = await execOpenClaw( ['config', 'get', 'agents.defaults.model.primary'])
        currentDefault = extractPlainValue(stdout as string) || null
      } catch {}
      if (currentDefault === oldKey) {
        await execOpenClaw( ['config', 'set', '--json', 'agents.defaults.model', JSON.stringify({ primary: newKey })])
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

modelsRouter.post('/models/:provider/:modelId/delete', async (c) => {
  const providerKey = c.req.param('provider')
  const targetModelId = c.req.param('modelId')

  // 注意：不再检查 AUTH_PROVIDERS，允许删除所有类型的模型配置（如果配置存在的话）

  try {
    // 读取特定 provider 配置，而不是所有 providers
    let providerConfig: any = {}
    try {
      const { stdout } = await execOpenClaw( ['config', 'get', '--json', `models.providers.${providerKey}`])
      providerConfig = extractJson(stdout as string) || {}
    } catch {}

    if (providerConfig && Object.keys(providerConfig).length > 0) {
       const existingModels = Array.isArray(providerConfig.models) ? providerConfig.models : []
       const newModels = existingModels.filter((m: any) => m.id !== targetModelId)
       
       if (newModels.length === 0) {
         await execOpenClaw( ['config', 'unset', `models.providers.${providerKey}`])
         removeAuthProfile(providerKey)
       } else {
         // 否则只更新 models 列表，避免覆盖可能被隐藏的敏感信息
         await execOpenClaw( ['config', 'set', '--json', `models.providers.${providerKey}.models`, JSON.stringify(newModels)])
       }
    }

    // 从 agents.defaults.models 中移除相关 key
    let defaultModels: Record<string, any> = {}
    try {
      const { stdout } = await execOpenClaw( ['config', 'get', '--json', 'agents.defaults.models'])
      defaultModels = extractJson(stdout as string) || {}
    } catch {}

    const targetKey = `${providerKey}/${targetModelId}`
    if (defaultModels[targetKey]) {
      delete defaultModels[targetKey]
      await execOpenClaw( ['config', 'set', '--json', 'agents.defaults.models', JSON.stringify(defaultModels)])
    }

    // 如果被删除的模型是默认模型，切换到第一个可用模型
    let currentDefault: string | null = null
    try {
      const { stdout } = await execOpenClaw( ['config', 'get', 'agents.defaults.model.primary'])
      currentDefault = extractPlainValue(stdout as string) || null
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
        await execOpenClaw( ['config', 'set', '--json', 'agents.defaults.model', JSON.stringify({ primary: nextModelKey })])
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

modelsRouter.post('/providers/:provider/delete', async (c) => {
  const providerKey = c.req.param('provider')
  // 注意：不再检查 AUTH_PROVIDERS，允许删除所有类型的 Provider

  try {
    try {
      await execOpenClaw( ['config', 'unset', `models.providers.${providerKey}`])
    } catch (e: any) {
      console.warn(`删除 provider ${providerKey} 失败 (可能不存在):`, e.message)
    }
    removeAuthProfile(providerKey)

    // 清理 agents.defaults.models
    let defaultModels: Record<string, any> = {}
    try {
      const { stdout } = await execOpenClaw( ['config', 'get', '--json', 'agents.defaults.models'])
      defaultModels = extractJson(stdout as string) || {}
    } catch {}

    let changed = false
    for (const key of Object.keys(defaultModels)) {
      if (key.startsWith(`${providerKey}/`)) {
        delete defaultModels[key]
        changed = true
      }
    }
    if (changed) {
      await execOpenClaw( ['config', 'set', '--json', 'agents.defaults.models', JSON.stringify(defaultModels)])
    }

    // 检查默认模型
    let currentDefault: string | null = null
    try {
      const { stdout } = await execOpenClaw( ['config', 'get', 'agents.defaults.model.primary'])
      currentDefault = extractPlainValue(stdout as string) || null
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
         await execOpenClaw( ['config', 'set', '--json', 'agents.defaults.model', JSON.stringify({ primary: nextModelKey })])
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

modelsRouter.get('/providers/:provider/add-model', async (c) => {
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

modelsRouter.post('/providers/:provider/add-model', async (c) => {
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
      const { stdout } = await execOpenClaw( ['config', 'get', '--json', `models.providers.${providerKey}`])
      existingConfig = extractJson(stdout as string) || {}
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
    await execOpenClaw( [
      'config', 'set', '--json', `models.providers.${providerKey}.models`,
      JSON.stringify(existingModels),
    ])

    // 注册到 agents.defaults.models（读取完整对象 → 合并 → 整体写回，避免 dot-path 解析问题）
    const modelKey = `${providerKey}/${modelId}`
    let defaultModels: Record<string, any> = {}
    try {
      const { stdout } = await execOpenClaw( ['config', 'get', '--json', 'agents.defaults.models'])
      defaultModels = extractJson(stdout as string) || {}
    } catch {}
    defaultModels[modelKey] = {}
    await execOpenClaw( ['config', 'set', '--json', 'agents.defaults.models', JSON.stringify(defaultModels)])


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
