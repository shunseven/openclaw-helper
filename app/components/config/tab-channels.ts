import { html } from 'hono/html'

export function tabChannels() {
  return html`
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
  `
}
