import { html } from 'hono/html'

export function tabAiChat() {
  return html`
    <div x-show="tab==='ai-chat'" x-cloak x-data="aiChat" class="flex flex-col" style="height: calc(100vh - 14rem);">

      <!-- 加载中 -->
      <div x-show="configLoading" class="flex flex-1 items-center justify-center">
        <div class="text-center">
          <div class="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-500"></div>
          <p class="text-sm text-slate-500">加载配置中...</p>
        </div>
      </div>

      <!-- 未配置提示 -->
      <div x-show="!configLoading && !configured && !showConfig" x-cloak class="flex flex-1 items-center justify-center">
        <div class="max-w-md text-center">
          <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-8 w-8 text-emerald-600"><path d="M16.5 7.5h-9v9h9v-9z" /><path fill-rule="evenodd" d="M8.25 2.25A.75.75 0 019 3v.75h2.25V3a.75.75 0 011.5 0v.75H15V3a.75.75 0 011.5 0v.75h.75a3 3 0 013 3v.75H21A.75.75 0 0121 9h-.75v2.25H21a.75.75 0 010 1.5h-.75V15H21a.75.75 0 010 1.5h-.75v.75a3 3 0 01-3 3h-.75V21a.75.75 0 01-1.5 0v-.75h-2.25V21a.75.75 0 01-1.5 0v-.75H9V21a.75.75 0 01-1.5 0v-.75h-.75a3 3 0 01-3-3v-.75H3A.75.75 0 013 15h.75v-2.25H3a.75.75 0 010-1.5h.75V9H3a.75.75 0 010-1.5h.75v-.75a3 3 0 013-3h.75V3a.75.75 0 01.75-.75zM6 6.75A.75.75 0 016.75 6h10.5a.75.75 0 01.75.75v10.5a.75.75 0 01-.75.75H6.75a.75.75 0 01-.75-.75V6.75z" clip-rule="evenodd" /></svg>
          </div>
          <h3 class="text-lg font-semibold text-slate-800">配置 AI 助手</h3>
          <p class="mt-2 text-sm text-slate-500" x-show="configForm.mode !== 'auto'">
            需要配置模型 API Key 才能使用 AI 智能助手功能。
          </p>
          <button @click="showConfig = true" class="mt-4 rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 hover:bg-emerald-400 transition-all">开始配置</button>
        </div>
      </div>

      <!-- 配置表单 -->
      <div x-show="showConfig" x-cloak class="flex flex-1 items-center justify-center">
        <div class="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-lg max-h-[90vh] overflow-y-auto">
          <h3 class="text-lg font-semibold text-slate-800">AI 修复助手配置</h3>
          <p class="mt-1 text-sm text-slate-500">配置大模型，用于 AI 智能修复功能。</p>

          <!-- 模式选择 -->
          <div class="mt-6 space-y-3">
            <label class="block text-sm font-medium text-slate-700">配置模式</label>
            <div class="grid grid-cols-1 gap-3">
              <!-- 自动模式 -->
              <div 
                @click="configForm.mode = 'auto'"
                class="cursor-pointer rounded-xl border p-3 flex flex-col gap-3 transition-colors"
                :class="configForm.mode === 'auto' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'"
              >
                <div class="flex items-start gap-3">
                  <div class="mt-0.5 relative flex h-4 w-4 items-center justify-center rounded-full border"
                    :class="configForm.mode === 'auto' ? 'border-emerald-500' : 'border-slate-300'"
                  >
                    <div x-show="configForm.mode === 'auto'" class="h-2 w-2 rounded-full bg-emerald-500"></div>
                  </div>
                  <div>
                    <span class="block text-sm font-medium text-slate-800">自动选择 (推荐)</span>
                    <span class="block text-xs text-slate-500 mt-0.5">优先使用 Claude > Codex > 默认模型 > MiniMax，并在不可用时自动切换。</span>
                  </div>
                </div>

                <!-- 自动模式下的兜底配置 -->
                <div x-show="configForm.mode === 'auto'" @click.stop class="ml-7 mt-1 border-t border-emerald-200/50 pt-3 w-[calc(100%-1.75rem)]">
                  <div x-data="{ expanded: false }">
                    <button @click="expanded = !expanded" class="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700">
                      <span x-text="expanded ? '收起兜底配置' : '设置兜底配置'"></span>
                      <svg class="h-3 w-3 transition-transform" :class="expanded ? 'rotate-180' : ''" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" /></svg>
                    </button>
                    <p class="mt-1 text-[10px] text-emerald-600/80">当所有自动检测的模型都不可用时，将尝试使用此配置。</p>
                    
                    <div x-show="expanded" x-cloak class="mt-3 space-y-3">
                      <div>
                        <label class="mb-1 block text-xs font-medium text-slate-600">API Key (兜底)</label>
                        <input type="password" x-model="configForm.apiKey" placeholder="可选: 兜底 API Key" class="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-emerald-400 focus:outline-none" />
                      </div>
                      <div class="grid grid-cols-2 gap-3">
                        <div>
                          <label class="mb-1 block text-xs font-medium text-slate-600">模型名称</label>
                          <input type="text" x-model="configForm.model" placeholder="MiniMax-M2.5" class="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-emerald-400 focus:outline-none" />
                        </div>
                        <div>
                          <label class="mb-1 block text-xs font-medium text-slate-600">API Base URL</label>
                          <input type="text" x-model="configForm.baseUrl" placeholder="https://api.minimax.io/anthropic" class="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-emerald-400 focus:outline-none" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 指定 OpenClaw 模型 -->
              <div 
                @click="configForm.mode = 'provider'"
                class="cursor-pointer rounded-xl border p-3 flex items-start gap-3 transition-colors"
                :class="configForm.mode === 'provider' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'"
              >
                <div class="mt-0.5 relative flex h-4 w-4 items-center justify-center rounded-full border"
                  :class="configForm.mode === 'provider' ? 'border-emerald-500' : 'border-slate-300'"
                >
                  <div x-show="configForm.mode === 'provider'" class="h-2 w-2 rounded-full bg-emerald-500"></div>
                </div>
                <div>
                  <span class="block text-sm font-medium text-slate-800">指定 OpenClaw 模型</span>
                  <span class="block text-xs text-slate-500 mt-0.5">强制使用 OpenClaw 已配置的特定模型。</span>
                </div>
              </div>

              <!-- 自定义配置 -->
              <div 
                @click="configForm.mode = 'custom'"
                class="cursor-pointer rounded-xl border p-3 flex items-start gap-3 transition-colors"
                :class="configForm.mode === 'custom' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'"
              >
                <div class="mt-0.5 relative flex h-4 w-4 items-center justify-center rounded-full border"
                  :class="configForm.mode === 'custom' ? 'border-emerald-500' : 'border-slate-300'"
                >
                  <div x-show="configForm.mode === 'custom'" class="h-2 w-2 rounded-full bg-emerald-500"></div>
                </div>
                <div>
                  <span class="block text-sm font-medium text-slate-800">自定义配置</span>
                  <span class="block text-xs text-slate-500 mt-0.5">手动输入 API Key 和 Base URL。</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 指定模型选择 -->
          <div x-show="configForm.mode === 'provider'" class="mt-4 pl-1">
             <label class="mb-2 block text-sm font-medium text-slate-600">选择模型</label>
             <select x-model="configForm.provider" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none">
               <option value="">-- 请选择 --</option>
               <template x-for="m in availableModels" :key="m.provider">
                 <option :value="m.provider" x-text="m.provider + ' (' + m.model + ')'"></option>
               </template>
             </select>
             <p x-show="availableModels.length === 0" class="mt-1 text-xs text-amber-600">未检测到 OpenClaw 模型，请先在“模型配置”页面添加。</p>
          </div>

          <!-- 自定义配置表单 -->
          <div x-show="configForm.mode === 'custom'" class="mt-6 space-y-4 border-t border-slate-100 pt-4">
            <div>
              <label class="mb-2 block text-sm font-medium text-slate-600">API Key <span class="text-red-400">*</span></label>
              <input type="password" x-model="configForm.apiKey" :placeholder="configured && keySource === 'local' ? '留空则保持原 Key 不变，填写则覆盖' : '请输入 API Key'" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none" />
            </div>
            <div>
              <label class="mb-2 block text-sm font-medium text-slate-600">模型名称</label>
              <input type="text" x-model="configForm.model" placeholder="MiniMax-M2.5" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none" />
            </div>
            <div>
              <label class="mb-2 block text-sm font-medium text-slate-600">API Base URL</label>
              <input type="text" x-model="configForm.baseUrl" placeholder="https://api.minimax.io/anthropic" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none" />
            </div>
          </div>

          <!-- 底部按钮 -->
          <div class="mt-8 flex justify-end gap-3 pt-4 border-t border-slate-100">
            <button @click="showConfig = false" class="rounded-lg border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button>
            <button @click="saveConfig()" 
              :disabled="configForm.mode === 'provider' && !configForm.provider || configForm.mode === 'custom' && (!configured || keySource !== 'local') && !configForm.apiKey.trim()" 
              class="rounded-lg bg-emerald-500 px-5 py-2 text-sm text-white hover:bg-emerald-400 disabled:bg-slate-200 disabled:text-slate-400 transition-colors">
              保存配置
            </button>
          </div>
        </div>
      </div>

      <!-- 聊天界面 -->
      <div x-show="!configLoading && !showConfig" x-cloak class="flex flex-1 flex-col min-h-0">

        <!-- 顶栏 -->
        <div class="flex items-center justify-between border-b border-slate-200 px-1 py-3">
          <div>
            <h4 class="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4 text-emerald-600"><path fill-rule="evenodd" d="M10 1c-1.828 0-3.623.149-5.371.435a.75.75 0 00-.629.74v.659a18.46 18.46 0 01-2.131 2.131 7.477 7.477 0 00.59 2.543.75.75 0 01-.2.82A18.69 18.69 0 001 11.07a.75.75 0 00.187.72 18.93 18.93 0 006.295 4.418.75.75 0 00.618 0A18.93 18.93 0 0014.395 11.79a.75.75 0 00.187-.72A18.69 18.69 0 0013.341 8.327a.75.75 0 01-.2-.82 7.477 7.477 0 00.59-2.543 18.46 18.46 0 01-2.131-2.131v-.659a.75.75 0 00-.629-.74A25.688 25.688 0 0010 1z" clip-rule="evenodd" /></svg></span>
              OpenClaw AI 修复助手
            </h4>
            <p class="mt-0.5 text-xs text-slate-400">模型: <span x-text="configModel || '未配置'" class="font-medium text-slate-500"></span></p>
          </div>
          <div class="flex items-center gap-2">
            <span x-show="!configured" x-cloak @click="showConfig = true" class="cursor-pointer rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-100 transition-colors">请先配置模型 API Key</span>
            <button @click="showConfig = true" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 transition-colors" title="修改配置">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" /></svg>
            </button>
            <button @click="newSession()" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 transition-colors">新建会话</button>
          </div>
        </div>

        <!-- 消息列表 -->
        <div class="flex-1 overflow-y-auto px-2 py-4 space-y-4" x-ref="messagesContainer">

          <!-- 欢迎消息 -->
          <div x-show="messages.length === 0" class="flex flex-col items-center justify-center h-full text-center">
            <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg shadow-emerald-500/30">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-8 w-8 text-white"><path fill-rule="evenodd" d="M4.848 2.771A49.144 49.144 0 0112 2.25c2.43 0 4.817.178 7.152.52a1.595 1.595 0 011.348 1.578v7.284c0 3.042-1.135 5.824-3 7.938l-3.636 4.116a1.5 1.5 0 01-2.228.003L8.5 19.57A11.95 11.95 0 015.5 11.632V4.349a1.595 1.595 0 011.348-1.578z" clip-rule="evenodd" /></svg>
            </div>
            <h3 class="text-lg font-semibold text-slate-700">你好，我是 OpenClaw AI 修复助手</h3>
            <p class="mt-2 max-w-md text-sm text-slate-500">我可以帮你诊断和修复 OpenClaw 的各种问题。</p>
            <div class="mt-3 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-700 border border-amber-100">
              💡 <strong>小贴士：</strong>如果有错误信息，请直接发给我，让我能更快的定位问题。
            </div>
            <p class="mt-4 text-sm text-slate-500">你可以尝试：</p>
            <div class="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 max-w-lg w-full">
              <button @click="input='Gateway 启动不了，请帮我检查一下'; sendMessage()" class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-600 hover:border-emerald-300 hover:bg-emerald-50/50 transition-colors">
                <span class="font-medium text-slate-700">Gateway 无法启动</span>
                <p class="mt-0.5 text-xs text-slate-400">检查端口、配置和日志</p>
              </button>
              <button @click="input='帮我检查一下模型配置是否正确'; sendMessage()" class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-600 hover:border-emerald-300 hover:bg-emerald-50/50 transition-colors">
                <span class="font-medium text-slate-700">模型配置问题</span>
                <p class="mt-0.5 text-xs text-slate-400">检查 API Key 和模型设置</p>
              </button>
              <button @click="input='Telegram 渠道连接不上，请帮我排查'; sendMessage()" class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-600 hover:border-emerald-300 hover:bg-emerald-50/50 transition-colors">
                <span class="font-medium text-slate-700">渠道连接异常</span>
                <p class="mt-0.5 text-xs text-slate-400">排查 Telegram/WhatsApp 问题</p>
              </button>
            </div>
          </div>

          <!-- 消息气泡 -->
          <template x-for="msg in messages" :key="msg.id">
            <div>
              <!-- 用户消息 -->
              <div x-show="msg.role === 'user'" class="flex justify-end">
                <div class="max-w-[75%] lg:max-w-[600px] break-words rounded-2xl rounded-tr-md bg-indigo-500 px-4 py-3 text-sm text-white shadow-sm">
                  <div x-html="formatContent(msg.content)"></div>
                </div>
              </div>
              <!-- AI 消息 -->
              <div x-show="msg.role === 'assistant'" class="flex justify-start min-w-0">
                <div class="max-w-[75%] lg:max-w-[600px] space-y-2 min-w-0">
                  <!-- 工具执行卡片 -->
                  <template x-for="(t, ti) in msg.tools" :key="ti">
                    <div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 min-w-0 overflow-hidden">
                      <div class="flex items-center gap-2 text-xs font-medium text-slate-600">
                        <span x-show="t.status === 'running'" class="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-500"></span>
                        <svg x-show="t.status === 'done'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5 text-emerald-500"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.06l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" /></svg>
                        <svg x-show="t.status === 'error'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5 text-red-500"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" /></svg>
                        <span x-text="toolLabel(t.name)"></span>
                      </div>
                      <div x-show="t.args" class="mt-1 text-[10px] text-slate-400 font-mono truncate max-w-full overflow-hidden" x-text="JSON.stringify(t.args)"></div>
                      <div x-show="t.result" class="mt-1.5 max-h-32 overflow-y-auto rounded-lg bg-slate-800 p-2 text-[11px] text-green-300 font-mono whitespace-pre-wrap break-all" x-text="t.result"></div>
                    </div>
                  </template>
                  <!-- AI 文本 -->
                  <div x-show="msg.content || (!msg.content && msg.tools.length === 0)" class="rounded-2xl rounded-tl-md bg-slate-100 px-4 py-3 text-sm text-slate-700 shadow-sm overflow-hidden">
                    <div x-show="!msg.content && !streaming" class="text-slate-400 italic">（无回复内容）</div>
                    <div x-show="!msg.content && streaming && msg.tools.length === 0" class="flex items-center gap-2 text-slate-400">
                      <span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-500"></span>
                      正在思考...
                    </div>
                    <div x-show="msg.content" x-html="formatContent(msg.content)" class="prose-sm break-words max-w-none"></div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- 输入栏 -->
        <div class="border-t border-slate-200 px-2 py-3">
          <div class="flex gap-2">
            <textarea
              x-model="input"
              @keydown.enter.prevent="if (!$event.shiftKey) sendMessage()"
              :placeholder="configured ? '描述你遇到的 OpenClaw 问题，或粘贴错误信息...' : '请先点击右上角设置图标配置模型 API Key'"
              class="flex-1 resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none placeholder:text-slate-400"
              rows="2"
              :disabled="streaming || !configured"
            ></textarea>
            <button
              @click="sendMessage()"
              :disabled="!input.trim() || streaming || !configured"
              class="self-end rounded-xl bg-emerald-500 px-5 py-3 text-sm font-medium text-white shadow-sm hover:bg-emerald-400 disabled:bg-slate-200 disabled:text-slate-400 transition-colors"
            >
              <span x-show="!streaming">发送</span>
              <span x-show="streaming" class="flex items-center gap-1.5">
                <span class="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white"></span>
                处理中
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `
}
