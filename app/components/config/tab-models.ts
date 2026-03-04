import { html } from 'hono/html'

export function tabModels() {
  return html`
    <div x-show="tab==='models'">
      <div class="rounded-2xl border border-slate-200 bg-slate-50 p-6">
        <h4 class="text-lg font-semibold text-slate-800">已配置模型</h4>
        <p class="mt-2 text-sm text-slate-500">下方显示当前 OpenClaw 配置的模型及其支持的输入类型，点击可快速切换默认模型。</p>
        <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3"
             id="model-list"
             hx-get="/api/partials/models"
             hx-trigger="load"
             hx-swap="innerHTML">
          <p class="text-sm text-slate-400">加载中...</p>
        </div>
      </div>

      <!-- 模型编辑区域 -->
      <div id="model-form-area" class="mt-6"></div>

      <!-- 新增模型 -->
      <div class="mt-6 rounded-2xl border border-slate-200 bg-white p-6" x-data="modelAdder">

        <!-- OAuth 弹窗 -->
        <div x-show="oauth.show" x-cloak class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70">
          <div class="w-full max-w-2xl rounded-2xl bg-slate-900 text-slate-100 shadow-2xl">
            <div class="flex items-center justify-between border-b border-slate-700 px-5 py-3">
              <div class="text-sm" x-text="oauth.title"></div>
              <button class="text-xl text-slate-400 hover:text-white" @click="closeOAuth()">×</button>
            </div>
            <div class="max-h-[520px] overflow-y-auto px-5 py-4 font-mono text-sm">
              <div class="whitespace-pre-wrap" x-html="oauth.output"></div>
              <div class="mt-4 flex justify-end gap-2">
                <button x-show="oauth.showOpen" @click="window.open(oauth.openUrl,'_blank')" class="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">打开授权页面</button>
                <button x-show="oauth.showDone" @click="manualOAuthDone()" class="rounded-lg bg-indigo-500 px-4 py-2 text-sm text-white hover:bg-indigo-400">已完成登录</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Loading -->
        <div x-show="loading" x-cloak class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40">
          <div class="rounded-2xl bg-white px-6 py-5 text-center shadow-xl">
            <div class="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-500"></div>
            <p class="text-sm text-slate-600">正在配置中，请稍候...</p>
          </div>
        </div>

        <h4 class="text-lg font-semibold text-slate-800">新增模型</h4>
        <p class="mt-2 text-sm text-slate-500">选择提供商，通过 OAuth 登录或填写 API Key 添加模型。</p>

        <div class="mt-4">
          <label class="mb-2 block text-sm font-medium text-slate-600">选择模型提供商</label>
          <select x-model="provider" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none">
            <option value="">-- 请选择 --</option>
            <option value="minimax">MiniMax (需要 API Key)</option>
            <option value="gpt">GPT (通过 ChatGPT OAuth 登录)</option>
            <option value="qwen">千问 (通过 OAuth 登录)</option>
            <option value="custom">第三方模型 (OpenAI 兼容 API)</option>
          </select>
        </div>

        <div x-show="provider === 'minimax'" x-cloak class="mt-4">
          <label class="mb-2 block text-sm font-medium text-slate-600">MiniMax API Key</label>
          <input type="text" x-model="minimaxToken" placeholder="请输入 MiniMax API Key" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
        </div>

        <!-- 第三方模型表单 -->
        <div x-show="provider === 'custom'" x-cloak class="mt-4 space-y-4">
          <div class="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3">
            <p class="text-sm text-blue-700">支持任何兼容 OpenAI Chat Completions API 的第三方服务，例如 Gemini、Moonshot、DeepSeek 等。</p>
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-slate-600">API Base URL <span class="text-red-400">*</span></label>
            <input type="text" x-model="customBaseUrl" placeholder="例如：https://gptproto.com/v1" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-slate-600">API Key <span class="text-red-400">*</span></label>
            <input type="password" x-model="customApiKey" placeholder="请输入 API Key" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-slate-600">模型 ID <span class="text-red-400">*</span></label>
            <input type="text" x-model="customModelId" placeholder="例如：gemini-3-pro-preview、deepseek-chat" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-slate-600">支持的输入类型</label>
            <div class="flex flex-wrap gap-4 mt-2">
              <label class="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" value="text" x-model="customInputTypes" class="rounded" /> 文本</label>
              <label class="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" value="image" x-model="customInputTypes" class="rounded" /> 图片</label>
              <label class="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" value="audio" x-model="customInputTypes" class="rounded" /> 音频</label>
            </div>
          </div>
          <div>
            <label class="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" x-model="customSetDefault" class="rounded" />
              设为默认模型
            </label>
          </div>

          <!-- Claude 模型切换提示 -->
          <div x-show="customModelId && customModelId.toLowerCase().includes('claude')" x-cloak x-transition
               class="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-4">
            <div class="flex items-start gap-2.5">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="mt-0.5 h-5 w-5 shrink-0 text-amber-500">
                <path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
              </svg>
              <div class="flex-1">
                <p class="text-sm font-semibold text-amber-800">Claude 模型切换提醒</p>
                <p class="mt-1.5 text-sm text-amber-700">第一次切换到 Claude 模型后，需要在 OpenClaw 聊天界面中点击 <strong class="font-semibold">"New Session"</strong> 按钮才能正常运行。</p>
                <div class="mt-2 rounded-lg border border-amber-300/60 bg-amber-100/60 px-3 py-2">
                  <p class="text-xs text-amber-600"><strong>注意：</strong>点击 New Session 会创建新的会话，之前的聊天记录将不会在新会话中显示。如有重要信息，请提前保存。</p>
                </div>
                <img src="/assets/claude-new-session-tip.png" alt="点击 New Session 按钮示意图" class="mt-3 w-full max-w-2xl rounded-lg border border-amber-200 shadow-sm" />
              </div>
            </div>
          </div>
        </div>

        <div class="mt-6 flex justify-end">
          <button @click="submitModel()" :disabled="!canSubmit" class="rounded-lg bg-indigo-500 px-5 py-2 text-sm text-white hover:bg-indigo-400 disabled:bg-slate-200 disabled:text-slate-400">添加模型</button>
        </div>
      </div>
    </div>
  `
}
