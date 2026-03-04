import { html } from 'hono/html'

export function tabRemote() {
  return html`
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
  `
}
