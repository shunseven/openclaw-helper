import { createRoute } from 'honox/factory'
import { html, raw } from 'hono/html'
import { modelAdderAlpine } from '../lib/alpine/model-adder'
import { whatsappLinkerAlpine } from '../lib/alpine/whatsapp-linker'
import { aiChatAlpine } from '../lib/alpine/ai-chat'
import { getOpenClawStatus } from '../lib/status'

export default createRoute(async (c) => {
  const status = await getOpenClawStatus()
  let openClawUrl = 'http://127.0.0.1:18789'
  if (status.gatewayToken) {
    openClawUrl += `?token=${encodeURIComponent(status.gatewayToken)}`
  }
  const hasValidToken = !!status.gatewayToken

  return c.render(
    html`
    <div x-data="{ tab: 'models', alert: ${status.tokenRepaired ? `{type:'success',message:'Gateway Token 已自动修复并重启网关，现在可以正常使用了。'}` : 'null'}, _t: null }"
         @show-alert.window="alert = $event.detail; clearTimeout(_t); _t = setTimeout(() => alert = null, 5000)">

      <div class="h-screen w-full px-6 py-10 overflow-y-auto">
        <div class="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">

          <!-- 侧边栏 -->
          <aside class="sticky top-6 h-fit rounded-3xl border border-indigo-300/30 bg-gradient-to-b from-slate-900 via-slate-900 to-indigo-950 p-6 text-slate-200 shadow-2xl shadow-indigo-900/20">
            <div class="text-base font-semibold tracking-wide text-white">OpenClaw 控制台</div>
            <div class="mt-1 text-xs text-indigo-200/80">更多配置指引</div>
            <div class="mt-4 h-px bg-gradient-to-r from-indigo-400/50 to-transparent"></div>
            <div class="mt-6 flex flex-col gap-2">
              <button @click="tab='models'" :class="tab==='models' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 border-indigo-300/60 -translate-y-0.5' : 'text-slate-200/90 border-transparent hover:bg-slate-800/70 hover:text-white'" class="rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all">模型</button>
              <button @click="tab='channels'" :class="tab==='channels' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 border-indigo-300/60 -translate-y-0.5' : 'text-slate-200/90 border-transparent hover:bg-slate-800/70 hover:text-white'" class="rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all">渠道</button>
              <button @click="tab='skills'; $dispatch('refresh-group-skills')" :class="tab==='skills' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 border-indigo-300/60 -translate-y-0.5' : 'text-slate-200/90 border-transparent hover:bg-slate-800/70 hover:text-white'" class="rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all">技能</button>
              <button @click="tab='remote'" :class="tab==='remote' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 border-indigo-300/60 -translate-y-0.5' : 'text-slate-200/90 border-transparent hover:bg-slate-800/70 hover:text-white'" class="rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all">远程支持</button>
              <div class="mt-2 h-px bg-gradient-to-r from-indigo-400/30 to-transparent"></div>
              <button @click="tab='ai-chat'" :class="tab==='ai-chat' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 border-emerald-300/60 -translate-y-0.5' : 'text-slate-200/90 border-transparent hover:bg-slate-800/70 hover:text-white'" class="rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M10 1c-1.828 0-3.623.149-5.371.435a.75.75 0 00-.629.74v.659a18.46 18.46 0 01-2.131 2.131 7.477 7.477 0 00.59 2.543.75.75 0 01-.2.82A18.69 18.69 0 001 11.07a.75.75 0 00.187.72 18.93 18.93 0 006.295 4.418.75.75 0 00.618 0A18.93 18.93 0 0014.395 11.79a.75.75 0 00.187-.72A18.69 18.69 0 0013.341 8.327a.75.75 0 01-.2-.82 7.477 7.477 0 00.59-2.543 18.46 18.46 0 01-2.131-2.131v-.659a.75.75 0 00-.629-.74A25.688 25.688 0 0010 1z" clip-rule="evenodd" /></svg>
                AI 修复助手
              </button>
            </div>
          </aside>

          <!-- 主内容 -->
          <main class="rounded-2xl bg-white p-8 text-slate-700 shadow-2xl">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 class="text-2xl font-semibold text-slate-800">配置中心</h1>
                <p class="mt-1 text-sm text-slate-500">集中管理模型、渠道、技能与远程支持</p>
              </div>
              ${status.defaultModel && status.telegramConfigured ? (hasValidToken ? html`
                <a class="rounded-lg bg-indigo-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400 shadow-lg shadow-indigo-500/30 transition-all hover:-translate-y-0.5 flex items-center gap-2" href="${openClawUrl}" target="_blank">
                  <span>打开 OpenClaw 页面</span>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
                    <path fill-rule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clip-rule="evenodd" />
                    <path fill-rule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clip-rule="evenodd" />
                  </svg>
                </a>
              ` : html`
                <span class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-700" title="Gateway Token 无效或已损坏，请重新运行 install.sh 或手动执行: openclaw config set gateway.auth.token &quot;$(cat /dev/urandom | LC_ALL=C tr -dc a-zA-Z0-9 | head -c 48)&quot;">
                  Gateway Token 异常
                </span>
              `) : html`
                <a class="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100" href="/">返回配置助手</a>
              `}
            </div>

            <!-- 全局提示 -->
            <div x-show="alert && alert.type === 'error'" x-cloak x-text="alert?.message" class="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"></div>
            <div x-show="alert && alert.type === 'success'" x-cloak x-text="alert?.message" class="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"></div>

            <!-- ═══ 模型管理 ═══ -->
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

            <!-- ═══ 渠道管理 ═══ -->
            <div x-show="tab==='channels'" x-cloak>
              <div class="rounded-2xl border border-slate-200 bg-slate-50 p-6">
                <h4 class="text-lg font-semibold text-slate-800">已配置渠道</h4>
                <p class="mt-2 text-sm text-slate-500">管理已配置的消息渠道，支持编辑和启用/关闭。</p>
                <div class="mt-4 grid gap-3 md:grid-cols-2"
                     id="channel-list"
                     hx-get="/api/partials/channels"
                     hx-trigger="intersect once"
                     hx-swap="innerHTML">
                  <p class="text-sm text-slate-400">加载中...</p>
                </div>
              </div>
              <div class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
                <h4 class="text-lg font-semibold text-slate-800">新增渠道</h4>
                <p class="mt-2 text-sm text-slate-500">选择要添加的渠道类型，点击对应按钮开始配置。</p>
                <div id="available-channels"
                     hx-get="/api/partials/channels/available"
                     hx-trigger="intersect once"
                     hx-swap="innerHTML">
                  <p class="mt-4 text-sm text-slate-400">加载中...</p>
                </div>
              </div>
              <div id="channel-form-area" class="mt-6"></div>
            </div>

            <!-- ═══ 技能管理 ═══ -->
            <div x-show="tab==='skills'" x-cloak>
              <div class="rounded-2xl border border-slate-200 bg-slate-50 p-6">
                <h4 class="text-lg font-semibold text-slate-800">预装技能说明</h4>
                <p class="mt-2 text-sm text-slate-500">install.sh 默认安装以下技能，便于快速使用常见能力。</p>
                <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <div class="rounded-xl border border-slate-200 bg-white p-4"><strong>blogwatcher</strong><div class="mt-2 text-xs text-slate-500">监控博客更新并推送摘要</div></div>
                  <div class="rounded-xl border border-slate-200 bg-white p-4"><strong>nano-pdf</strong><div class="mt-2 text-xs text-slate-500">快速读取与处理 PDF 内容</div></div>
                  <div class="rounded-xl border border-slate-200 bg-white p-4"><strong>obsidian</strong><div class="mt-2 text-xs text-slate-500">Obsidian 笔记协作工具</div></div>
                  <div class="rounded-xl border border-slate-200 bg-white p-4"
                       x-data="{
                         authorized: null,
                         loading: false,
                         check() {
                           fetch('/api/partials/skills/apple-notes/status')
                             .then(r => r.json())
                             .then(d => this.authorized = d.authorized)
                         },
                         authorize() {
                           this.loading = true
                           fetch('/api/partials/skills/apple-notes/authorize', { method: 'POST' })
                             .then(r => r.json())
                             .then(d => {
                               if (d.success) {
                                 this.authorized = true
                                 $dispatch('show-alert', { type: 'success', message: '已获取 Apple Notes 权限' })
                               } else {
                                 $dispatch('show-alert', { type: 'error', message: '授权失败: ' + (d.error || '未知错误') })
                               }
                             })
                             .catch(() => {
                               $dispatch('show-alert', { type: 'error', message: '请求失败' })
                             })
                             .finally(() => this.loading = false)
                         }
                       }"
                       x-init="check()">
                    <div class="flex items-start justify-between">
                      <div>
                        <strong>apple-notes</strong>
                        <div class="mt-2 text-xs text-slate-500">Apple Notes 笔记管理</div>
                      </div>
                      <div class="flex flex-col items-end gap-1">
                        <template x-if="authorized === true">
                          <span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">已授权</span>
                        </template>
                        <template x-if="authorized === false">
                          <button 
                            @click="authorize()" 
                            :disabled="loading"
                            class="rounded bg-indigo-50 px-2 py-1 text-[10px] font-medium text-indigo-600 hover:bg-indigo-100 disabled:opacity-50 transition-colors">
                            <span x-show="!loading">获取权限</span>
                            <span x-show="loading">请求中...</span>
                          </button>
                        </template>
                      </div>
                    </div>
                   </div>
                   <div class="rounded-xl border border-slate-200 bg-white p-4"
                        x-data="{
                          authorized: null,
                          loading: false,
                          check() {
                            fetch('/api/partials/skills/apple-reminders/status')
                              .then(r => r.json())
                              .then(d => this.authorized = d.authorized)
                          },
                          authorize() {
                            this.loading = true
                            fetch('/api/partials/skills/apple-reminders/authorize', { method: 'POST' })
                              .then(r => r.json())
                              .then(d => {
                                if (d.success) {
                                  this.authorized = true
                                  $dispatch('show-alert', { type: 'success', message: '已获取 Apple Reminders 权限' })
                                } else {
                                  $dispatch('show-alert', { type: 'error', message: '授权失败: ' + (d.error || '未知错误') })
                                }
                              })
                              .catch(() => {
                                $dispatch('show-alert', { type: 'error', message: '请求失败' })
                              })
                              .finally(() => this.loading = false)
                          }
                        }"
                        x-init="check()">
                     <div class="flex items-start justify-between">
                       <div>
                         <strong>apple-reminders</strong>
                         <div class="mt-2 text-xs text-slate-500">Apple Reminders 提醒事项管理</div>
                       </div>
                       <div class="flex flex-col items-end gap-1">
                         <template x-if="authorized === true">
                           <span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">已授权</span>
                         </template>
                         <template x-if="authorized === false">
                           <button 
                             @click="authorize()" 
                             :disabled="loading"
                             class="rounded bg-indigo-50 px-2 py-1 text-[10px] font-medium text-indigo-600 hover:bg-indigo-100 disabled:opacity-50 transition-colors">
                             <span x-show="!loading">获取权限</span>
                             <span x-show="loading">请求中...</span>
                           </button>
                         </template>
                       </div>
                     </div>
                   </div>
                   <div class="rounded-xl border border-slate-200 bg-white p-4"><strong>gifgrep</strong><div class="mt-2 text-xs text-slate-500">快速检索 GIF 与短视频帧</div></div>
                  <div class="rounded-xl border border-slate-200 bg-white p-4"><strong>model-usage</strong><div class="mt-2 text-xs text-slate-500">统计模型调用与用量</div></div>
                  <div class="rounded-xl border border-slate-200 bg-white p-4"><strong>video-frames</strong><div class="mt-2 text-xs text-slate-500">提取视频关键帧</div></div>
                  <div class="rounded-xl border border-slate-200 bg-white p-4"><strong>peekaboo</strong><div class="mt-2 text-xs text-slate-500">快速预览内容与格式检查</div></div>
                </div>
              </div>

              <!-- 集团技能 -->
              <div class="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-6">
                <h4 class="text-lg font-semibold text-slate-800">安装集团技能</h4>
                <p class="mt-2 text-sm text-slate-500">从集团技能仓库中安装或删除技能，安装后的技能将放入 OpenClaw 的 skills 目录。</p>
                <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3"
                     id="group-skills-list"
                     hx-get="/api/partials/skills/group"
                     hx-trigger="load, refresh-group-skills from:body"
                     hx-swap="innerHTML">
                  <p class="text-sm text-slate-400">
                    <span class="inline-flex items-center gap-2">
                      <span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-500"></span>
                      正在拉取集团技能仓库...
                    </span>
                  </p>
                </div>
              </div>

              <!-- Web 搜索配置 -->
              <div class="mt-6 rounded-2xl border border-slate-200 bg-white p-6"
                x-data="{
                  braveApiKey: '',
                  loading: false,
                  guideOpen: false,
                  configured: false,
                  editing: false,
                  maskedKey: '',
                  fetching: true,
                  init() {
                    fetch('/api/config/web-search')
                      .then(r => r.json())
                      .then(data => {
                        if (data.success && data.data) {
                          this.configured = data.data.configured;
                          if (data.data.apiKey) {
                            this.braveApiKey = data.data.apiKey;
                            const k = data.data.apiKey;
                            this.maskedKey = k.length > 8 ? k.substring(0, 4) + '****' + k.substring(k.length - 4) : '****';
                          }
                        }
                      })
                      .catch(() => {})
                      .finally(() => { this.fetching = false });
                  },
                  submitKey() {
                    if (!this.braveApiKey.trim()) return;
                    this.loading = true;
                    fetch('/api/config/web-search', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ apiKey: this.braveApiKey.trim() })
                    })
                    .then(r => r.json())
                    .then(data => {
                      if (data.success) {
                        $dispatch('show-alert', { type: 'success', message: 'Web 搜索配置成功！网关已重启。' });
                        const k = this.braveApiKey.trim();
                        this.maskedKey = k.length > 8 ? k.substring(0, 4) + '****' + k.substring(k.length - 4) : '****';
                        this.configured = true;
                        this.editing = false;
                      } else {
                        $dispatch('show-alert', { type: 'error', message: data.error || '配置失败' });
                      }
                    })
                    .catch(() => {
                      $dispatch('show-alert', { type: 'error', message: '请求失败，请检查网络后重试' });
                    })
                    .finally(() => { this.loading = false });
                  }
                }">

                <!-- 加载中 -->
                <div x-show="fetching" class="flex items-center gap-2 text-sm text-slate-400">
                  <div class="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-500"></div>
                  加载配置中...
                </div>

                <div x-show="!fetching" x-cloak>
                  <!-- 标题区 -->
                  <div class="flex items-center gap-3">
                    <div class="flex h-10 w-10 items-center justify-center rounded-xl" :class="configured ? 'bg-emerald-100' : 'bg-indigo-100'">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5" :class="configured ? 'text-emerald-600' : 'text-indigo-600'">
                        <path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clip-rule="evenodd" />
                      </svg>
                    </div>
                    <div class="flex-1">
                      <h4 class="text-lg font-semibold text-slate-800">Web 搜索功能</h4>
                      <p class="mt-0.5 text-sm text-slate-500">配置 Brave Search API 以启用 Web 搜索和网页抓取能力</p>
                    </div>
                  </div>

                  <!-- ══ 已配置状态 ══ -->
                  <div x-show="configured && !editing" class="mt-5">
                    <div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5 text-emerald-600">
                            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.06l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
                          </svg>
                          <span class="text-sm font-medium text-emerald-700">Web 搜索功能已开启</span>
                        </div>
                        <button @click="editing = true" class="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 transition-colors">
                          编辑
                        </button>
                      </div>
                      <div class="mt-2 flex items-center gap-2 text-sm text-emerald-600">
                        <span class="text-slate-500">Brave Search API Key:</span>
                        <code class="rounded bg-emerald-100 px-2 py-0.5 text-xs font-mono" x-text="maskedKey"></code>
                      </div>
                    </div>
                  </div>

                  <!-- ══ 编辑/首次配置模式 ══ -->
                  <div x-show="!configured || editing">

                    <!-- 编辑模式返回按钮 -->
                    <div x-show="configured && editing" class="mt-4">
                      <button @click="editing = false" class="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                          <path fill-rule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clip-rule="evenodd" />
                        </svg>
                        取消编辑
                      </button>
                    </div>

                    <!-- 展开/收起指引 -->
                    <button @click="guideOpen = !guideOpen" class="mt-4 flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-500 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4 transition-transform" :class="guideOpen && 'rotate-90'">
                        <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
                      </svg>
                      <span x-text="guideOpen ? '收起配置指引' : '查看配置指引'"></span>
                    </button>

                    <!-- 配置指引内容 -->
                    <div x-show="guideOpen" x-cloak x-transition class="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-5">
                      <h5 class="text-base font-semibold text-slate-700">第一步：获取 Brave Search API Key</h5>
                      <ol class="mt-3 space-y-3 text-sm text-slate-600">
                        <li class="flex gap-2">
                          <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-600">1</span>
                          <div>
                            <strong>登录 Brave 官网</strong>
                            <p class="mt-0.5 text-slate-500">打开 <a href="https://brave.com/search/api/" target="_blank" class="text-indigo-600 underline hover:text-indigo-500">https://brave.com/search/api</a>，点击右上角登录。如果没有账号先注册，按网站流程提示注册/登录。</p>
                            <img src="/assets/brave-step1-login.png" alt="Brave Search API 登录页面" class="mt-2 w-full max-w-2xl rounded-lg border border-slate-200 shadow-sm" />
                          </div>
                        </li>
                        <li class="flex gap-2">
                          <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-600">2</span>
                          <div>
                            <strong>选择方案</strong>
                            <p class="mt-0.5 text-slate-500">登录后点击左侧菜单栏的 "Available plans"，按需选择方案。如果 Web 搜索不是很高频，免费方案就够用了。</p>
                            <img src="/assets/brave-step2-plans.png" alt="选择 Brave Search 方案" class="mt-2 w-full max-w-2xl rounded-lg border border-slate-200 shadow-sm" />
                          </div>
                        </li>
                        <li class="flex gap-2">
                          <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-600">3</span>
                          <div>
                            <strong>支付</strong>
                            <p class="mt-0.5 text-slate-500">填写支付信息，提交支付。（免费方案也需要填写支付信息）</p>
                            <img src="/assets/brave-step3-payment.png" alt="填写支付信息" class="mt-2 w-full max-w-md rounded-lg border border-slate-200 shadow-sm" />
                          </div>
                        </li>
                        <li class="flex gap-2">
                          <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-600">4</span>
                          <div>
                            <strong>创建 API Key</strong>
                            <p class="mt-0.5 text-slate-500">点击左侧菜单栏中的 "API keys"；点击 "Add API key"，在弹出的框中填写 name 后提交；点击创建的 key 后面的复制按钮。</p>
                            <img src="/assets/brave-step4-apikey.png" alt="创建并复制 API Key" class="mt-2 w-full max-w-2xl rounded-lg border border-slate-200 shadow-sm" />
                          </div>
                        </li>
                      </ol>

                      <div class="mt-5 border-t border-slate-200 pt-4">
                        <h5 class="text-base font-semibold text-slate-700">第二步：在下方输入 API Key 并确认</h5>
                        <p class="mt-1 text-sm text-slate-500">将复制的 API Key 粘贴到下方输入框中，点击"确认配置"即可自动完成 Web 搜索和网页抓取的配置，并重启网关使其生效。</p>
                      </div>
                    </div>

                    <!-- API Key 输入 -->
                    <div class="mt-5">
                      <label class="mb-2 block text-sm font-medium text-slate-600">Brave Search API Key <span class="text-red-400">*</span></label>
                      <input type="password" x-model="braveApiKey" placeholder="请输入 Brave Search API Key（以 BSA 开头）" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
                    </div>

                    <!-- 确认按钮 -->
                    <div class="mt-6 flex items-center justify-between">
                      <p class="text-xs text-slate-400" x-show="loading">正在配置中，网关将自动重启...</p>
                      <div class="ml-auto flex items-center gap-2">
                        <button x-show="configured && editing" @click="editing = false" class="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors">取消</button>
                        <button
                          @click="submitKey()"
                          :disabled="!braveApiKey.trim() || loading"
                          class="rounded-lg bg-indigo-500 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:bg-slate-200 disabled:text-slate-400 transition-colors"
                        >
                          <span x-show="!loading">确认配置</span>
                          <span x-show="loading" x-cloak class="flex items-center gap-2">
                            <svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            配置中...
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- ═══ 远程支持 ═══ -->
            <div x-show="tab==='remote'" x-cloak>
              <div class="rounded-2xl border border-slate-200 bg-slate-50 p-6">
                <h4 class="text-lg font-semibold text-slate-800">开启共享登录</h4>
                <p class="mt-2 text-sm text-slate-500">打开设置 → 通用 → 共享 → 打开"共享登录"。</p>
                <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[1.2fr_0.8fr]">
                  <img src="/assets/remote-login-1.png" alt="共享登录步骤 1" class="w-full rounded-2xl border border-slate-200" />
                  <img src="/assets/remote-login-2.png" alt="共享登录步骤 2" class="w-full rounded-2xl border border-slate-200" />
                </div>
              </div>
              <div class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
                <h4 class="text-lg font-semibold text-slate-800">远程支持配置</h4>
                <div id="remote-form-container"
                     hx-get="/api/partials/remote-support/form"
                     hx-trigger="intersect once, refresh-remote-form from:body"
                     hx-swap="innerHTML">
                  <p class="mt-4 text-sm text-slate-400">加载中...</p>
                </div>
              </div>
            </div>

            <!-- ═══ AI 修复助手 ═══ -->
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
                  <h3 class="text-lg font-semibold text-slate-800">配置 AI 修复助手</h3>
                  <p class="mt-2 text-sm text-slate-500">需要配置 MiniMax API Key 才能使用 AI 智能修复功能。AI 助手可以自动诊断和修复 OpenClaw 的各种问题。</p>
                  <button @click="showConfig = true" class="mt-4 rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 hover:bg-emerald-400 transition-all">开始配置</button>
                </div>
              </div>

              <!-- 配置表单 -->
              <div x-show="showConfig" x-cloak class="flex flex-1 items-center justify-center">
                <div class="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
                  <h3 class="text-lg font-semibold text-slate-800">AI 修复助手配置</h3>
                  <p class="mt-1 text-sm text-slate-500">配置 MiniMax 大模型，用于 AI 智能修复功能。</p>
                  <div class="mt-6 space-y-4">
                    <div>
                      <label class="mb-2 block text-sm font-medium text-slate-600">MiniMax API Key <span class="text-red-400">*</span></label>
                      <input type="password" x-model="configForm.apiKey" placeholder="请输入 MiniMax API Key" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none" />
                    </div>
                    <div>
                      <label class="mb-2 block text-sm font-medium text-slate-600">模型名称</label>
                      <input type="text" x-model="configForm.model" placeholder="MiniMax-Text-01" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none" />
                    </div>
                    <div>
                      <label class="mb-2 block text-sm font-medium text-slate-600">API Base URL</label>
                      <input type="text" x-model="configForm.baseUrl" placeholder="https://api.minimax.chat/v1" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none" />
                    </div>
                    <div class="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3">
                      <p class="text-xs text-blue-700">如果你已在「模型」页面配置了 MiniMax，AI 助手会自动读取该配置，无需重复填写。</p>
                    </div>
                  </div>
                  <div class="mt-6 flex justify-end gap-3">
                    <button @click="showConfig = false" class="rounded-lg border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button>
                    <button @click="saveConfig()" :disabled="!configForm.apiKey.trim()" class="rounded-lg bg-emerald-500 px-5 py-2 text-sm text-white hover:bg-emerald-400 disabled:bg-slate-200 disabled:text-slate-400">保存配置</button>
                  </div>
                </div>
              </div>

              <!-- 聊天界面 -->
              <div x-show="!configLoading && configured && !showConfig" x-cloak class="flex flex-1 flex-col min-h-0">

                <!-- 顶栏 -->
                <div class="flex items-center justify-between border-b border-slate-200 px-1 py-3">
                  <div>
                    <h4 class="text-lg font-semibold text-slate-800 flex items-center gap-2">
                      <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4 text-emerald-600"><path fill-rule="evenodd" d="M10 1c-1.828 0-3.623.149-5.371.435a.75.75 0 00-.629.74v.659a18.46 18.46 0 01-2.131 2.131 7.477 7.477 0 00.59 2.543.75.75 0 01-.2.82A18.69 18.69 0 001 11.07a.75.75 0 00.187.72 18.93 18.93 0 006.295 4.418.75.75 0 00.618 0A18.93 18.93 0 0014.395 11.79a.75.75 0 00.187-.72A18.69 18.69 0 0013.341 8.327a.75.75 0 01-.2-.82 7.477 7.477 0 00.59-2.543 18.46 18.46 0 01-2.131-2.131v-.659a.75.75 0 00-.629-.74A25.688 25.688 0 0010 1z" clip-rule="evenodd" /></svg></span>
                      OpenClaw AI 修复助手
                    </h4>
                    <p class="mt-0.5 text-xs text-slate-400">基于 MiniMax 大模型 · 支持自动诊断和修复 OpenClaw 问题</p>
                  </div>
                  <div class="flex items-center gap-2">
                    <button @click="showConfig = true" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 transition-colors" title="修改配置">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" /></svg>
                    </button>
                    <button @click="newSession()" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 transition-colors">新建会话</button>
                    <button @click="autoFix()" :disabled="streaming" class="rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-400 disabled:bg-slate-200 disabled:text-slate-400 shadow-sm transition-all">一键修复</button>
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
                    <p class="mt-2 max-w-md text-sm text-slate-500">我可以帮你诊断和修复 OpenClaw 的各种问题。你可以：</p>
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
                      <button @click="autoFix()" class="rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 text-left text-sm text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50 transition-colors">
                        <span class="font-medium">一键自动诊断</span>
                        <p class="mt-0.5 text-xs text-emerald-500">全面检查系统状态</p>
                      </button>
                    </div>
                  </div>

                  <!-- 消息气泡 -->
                  <template x-for="msg in messages" :key="msg.id">
                    <div>
                      <!-- 用户消息 -->
                      <div x-show="msg.role === 'user'" class="flex justify-end">
                        <div class="max-w-[75%] rounded-2xl rounded-tr-md bg-indigo-500 px-4 py-3 text-sm text-white shadow-sm">
                          <div x-html="formatContent(msg.content)"></div>
                        </div>
                      </div>
                      <!-- AI 消息 -->
                      <div x-show="msg.role === 'assistant'" class="flex justify-start">
                        <div class="max-w-[85%] space-y-2">
                          <!-- 工具执行卡片 -->
                          <template x-for="(t, ti) in msg.tools" :key="ti">
                            <div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                              <div class="flex items-center gap-2 text-xs font-medium text-slate-600">
                                <span x-show="t.status === 'running'" class="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-500"></span>
                                <svg x-show="t.status === 'done'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5 text-emerald-500"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.06l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" /></svg>
                                <svg x-show="t.status === 'error'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5 text-red-500"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" /></svg>
                                <span x-text="toolLabel(t.name)"></span>
                              </div>
                              <div x-show="t.args" class="mt-1 text-[10px] text-slate-400 font-mono truncate" x-text="JSON.stringify(t.args)"></div>
                              <div x-show="t.result" class="mt-1.5 max-h-32 overflow-y-auto rounded-lg bg-slate-800 p-2 text-[11px] text-green-300 font-mono whitespace-pre-wrap" x-text="t.result"></div>
                            </div>
                          </template>
                          <!-- AI 文本 -->
                          <div x-show="msg.content || (!msg.content && msg.tools.length === 0)" class="rounded-2xl rounded-tl-md bg-slate-100 px-4 py-3 text-sm text-slate-700 shadow-sm">
                            <div x-show="!msg.content && !streaming" class="text-slate-400 italic">（无回复内容）</div>
                            <div x-show="!msg.content && streaming && msg.tools.length === 0" class="flex items-center gap-2 text-slate-400">
                              <span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-500"></span>
                              正在思考...
                            </div>
                            <div x-show="msg.content" x-html="formatContent(msg.content)" class="prose-sm break-words"></div>
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
                      placeholder="描述你遇到的 OpenClaw 问题，或粘贴错误信息..."
                      class="flex-1 resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none placeholder:text-slate-400"
                      rows="2"
                      :disabled="streaming"
                    ></textarea>
                    <button
                      @click="sendMessage()"
                      :disabled="!input.trim() || streaming"
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

          </main>
        </div>
      </div>
    </div>
    <script>${raw(modelAdderAlpine)}</script>
    <script>${raw(whatsappLinkerAlpine)}</script>
    <script>${raw(aiChatAlpine)}</script>
    `,
    { title: 'OpenClaw 配置指引' }
  )
})
