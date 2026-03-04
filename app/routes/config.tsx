import { createRoute } from 'honox/factory'
import { html, raw } from 'hono/html'
import { modelAdderAlpine } from '../lib/alpine/model-adder'
import { whatsappLinkerAlpine } from '../lib/alpine/whatsapp-linker'
import { aiChatAlpine } from '../lib/alpine/ai-chat'
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
    `,
    { title: 'OpenClaw 配置指引' }
  )
})
