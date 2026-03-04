import { html } from 'hono/html'

export function configSidebar() {
  return html`
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
  `
}
