import { createRoute } from 'honox/factory'
import { html, raw } from 'hono/html'
import { modelAdderAlpine } from '../lib/alpine/model-adder'
import { whatsappLinkerAlpine } from '../lib/alpine/whatsapp-linker'
import { aiChatAlpine } from '../lib/alpine/ai-chat'
import { updateCheckerAlpine } from '../lib/alpine/update-checker'
import { getOpenClawStatus } from '../lib/status'
import { configSidebar } from '../components/config/sidebar'
import { tabModels } from '../components/config/tab-models'
import { tabChannels } from '../components/config/tab-channels'
import { tabSkills } from '../components/config/tab-skills'
import { tabRemote } from '../components/config/tab-remote'
import { tabAiChat } from '../components/config/tab-ai-chat'

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

          ${configSidebar()}

          <!-- 主内容 -->
          <main class="rounded-2xl bg-white p-8 text-slate-700 shadow-2xl">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div x-data="updateChecker">
                <div class="flex items-center gap-3">
                  <h1 class="text-2xl font-semibold text-slate-800">配置中心</h1>
                  <button 
                      x-show="hasUpdate" 
                      x-cloak
                      @click="update"
                      :disabled="loading"
                      class="relative group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-rose-500 to-orange-500 px-4 py-1.5 text-sm font-bold text-white shadow-lg shadow-rose-500/30 hover:shadow-orange-500/40 hover:-translate-y-0.5 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                      <span class="absolute -top-1 -right-1 flex h-3 w-3">
                        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                        <span class="relative inline-flex rounded-full h-3 w-3 bg-rose-500 border border-white"></span>
                      </span>
                      
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5" :class="loading ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'">
                        <path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0v2.43l-.31-.31a7 7 0 00-11.712 3.138.75.75 0 001.449.39 5.5 5.5 0 019.201-2.466l.312.311h-2.433a.75.75 0 000 1.5h4.242z" clip-rule="evenodd" />
                      </svg>
                      
                      <span x-text="loading ? '正在升级中...' : '升级: v' + localVersion + ' → v' + remoteVersion"></span>
                  </button>
                </div>
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

            ${tabModels()}
            ${tabChannels()}
            ${tabSkills()}
            ${tabRemote()}
            ${tabAiChat()}

          </main>
        </div>
      </div>
    </div>
    <script>${raw(modelAdderAlpine)}</script>
    <script>${raw(whatsappLinkerAlpine)}</script>
    <script>${raw(aiChatAlpine)}</script>
    <script>${raw(updateCheckerAlpine)}</script>
    `,
    { title: 'OpenClaw 配置指引' }
  )
})
