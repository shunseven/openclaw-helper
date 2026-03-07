import { html } from 'hono/html'

export function tabSkills() {
  return html`
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
             hx-get="/api/partials/skills/group-xskillhub"
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

          <!-- 已配置状态 -->
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

          <!-- 编辑/首次配置模式 -->
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
  `
}
