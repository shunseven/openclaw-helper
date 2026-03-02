import { Hono } from 'hono'
import { execa } from 'execa'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const remoteSupportRouter = new Hono()

/** 将对象序列化为纯 ASCII 的 JSON 字符串（非 ASCII 字符用 \uXXXX 转义），避免 HTTP header ByteString 报错 */
function asciiJson(obj: any): string {
  return JSON.stringify(obj).replace(/[\u0080-\uffff]/g, (ch) => {
    return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
  })
}

// ─── 远程支持表单片段 ───

function resolveRemoteSupportPath() {
  const home = process.env.HOME || process.cwd()
  return path.join(home, '.openclaw-helper', 'remote-support.json')
}

remoteSupportRouter.get('/remote-support/form', async (c) => {
  let data = { sshKey: '', cpolarToken: '', region: 'eu' }
  try {
    const filePath = resolveRemoteSupportPath()
    if (fs.existsSync(filePath)) {
      data = { ...data, ...JSON.parse(fs.readFileSync(filePath, 'utf-8')) }
    }
  } catch {}

  // 检测 cpolar 是否正在运行
  let cpolarRunning = false
  let forwarding = ''
  // 1) 通过 cpolar Web Interface 检测（默认端口 4040）
  try {
    const resp = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: AbortSignal.timeout(2000) })
    if (resp.ok) {
      cpolarRunning = true
      const text = await resp.text()
      if (text) {
        try {
          const json = JSON.parse(text) as any
          const tunnels = json?.tunnels || []
          for (const t of tunnels) {
            if (t.public_url && t.public_url.startsWith('tcp://')) {
              forwarding = t.public_url
              break
            }
          }
        } catch {}
      }
    }
  } catch {}
  // 2) 如果 API 没检测到，用 pgrep 检查进程
  if (!cpolarRunning) {
    try {
      await execa('pgrep', ['cpolar'])
      cpolarRunning = true
    } catch {}
  }
  // 3) 已确认 cpolar 在运行但还没拿到 forwarding，从日志补充读取
  if (cpolarRunning && !forwarding) {
    const logFile = `${process.env.HOME}/.openclaw/logs/cpolar.log`
    if (fs.existsSync(logFile)) {
      const log = fs.readFileSync(logFile, 'utf-8')
      const match = log.match(/Tunnel established at (tcp:\/\/\S+)/)
      if (match) forwarding = match[1]
      if (!forwarding) {
        const m2 = log.match(/Forwarding\s+(tcp:\/\/\S+)/)
        if (m2) forwarding = m2[1]
      }
    }
  }

  const alpineInit = JSON.stringify({ sshKey: data.sshKey || '', cpolarToken: data.cpolarToken || '', region: data.region || 'eu' })
  return c.html(
    <form x-data={alpineInit} id="remote-form-inner">
      {cpolarRunning && (
        <div class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
          <div class="flex items-center gap-2">
            <span class="relative flex h-2.5 w-2.5">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
            </span>
            <p class="text-sm font-medium text-emerald-800">远程支持运行中</p>
          </div>
          {forwarding ? (
            <div class="mt-3">
              <p class="text-xs font-medium text-emerald-700">Forwarding 地址</p>
              <code class="mt-1 block rounded-lg bg-white px-3 py-2 text-sm font-mono text-emerald-700 border border-emerald-100 select-all">{forwarding}</code>
              {(() => {
                const urlMatch = forwarding.match(/tcp:\/\/([^:]+):(\d+)/)
                if (!urlMatch) return null
                const currentUser = os.userInfo().username
                const sshCmd = `ssh -p ${urlMatch[2]} ${currentUser}@${urlMatch[1]}`
                return (
                  <div class="mt-2">
                    <p class="text-xs font-medium text-emerald-700">SSH 连接命令</p>
                    <code class="mt-1 block rounded-lg bg-white px-3 py-2 text-sm font-mono text-slate-700 border border-emerald-100 select-all">{sshCmd}</code>
                  </div>
                )
              })()}
            </div>
          ) : (
            <p class="mt-2 text-xs text-emerald-600">cpolar 正在运行，但未能读取到 Forwarding 地址</p>
          )}
        </div>
      )}
      {!cpolarRunning && (
        <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div class="flex items-center gap-2">
            <span class="inline-flex h-2.5 w-2.5 rounded-full bg-slate-300"></span>
            <p class="text-sm text-slate-500">远程支持未运行</p>
          </div>
        </div>
      )}
      <div class="mt-4">
        <label for="ssh-key" class="mb-2 block text-sm font-medium text-slate-600">SSH Key</label>
        <textarea id="ssh-key" name="sshKey" rows={4} x-model="sshKey" placeholder="粘贴 SSH 公钥" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none"></textarea>
      </div>
      <div class="mt-4">
        <label for="cpolar-token" class="mb-2 block text-sm font-medium text-slate-600">cpolar AuthToken <span class="font-normal text-slate-400">(可选)</span></label>
        <input type="text" id="cpolar-token" name="cpolarToken" x-model="cpolarToken" placeholder="已认证可留空，填写则会重新设置" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
        <p class="mt-1 text-xs text-slate-400">如果 cpolar 已在终端认证过，可以留空直接启动</p>
      </div>
      <div class="mt-4">
        <label for="region-select" class="mb-2 block text-sm font-medium text-slate-600">区域</label>
        <select id="region-select" name="region" x-model="region" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none">
          <option value="cn">中国 (cn)</option>
          <option value="en">美国 (en)</option>
          <option value="eu">欧洲 (eu)</option>
        </select>
      </div>
      <div class="mt-6 flex flex-wrap gap-3" id="remote-alert"></div>
      <div class="mt-4 flex flex-wrap gap-3">
        <button type="button" hx-post="/api/partials/remote-support/start" hx-include="#remote-form-inner" hx-target="#remote-alert" hx-swap="innerHTML" hx-disabled-elt="this" x-effect="if(!$el.classList.contains('htmx-request')) $el.disabled = !sshKey.trim()" class="rounded-lg bg-indigo-500 px-4 py-2 text-sm text-white hover:bg-indigo-400 disabled:bg-slate-200 disabled:text-slate-400">
          <span class="hx-ready">打开远程支持</span>
          <span class="hx-loading items-center gap-1">
            <svg class="animate-spin h-3.5 w-3.5 inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
            正在连接…
          </span>
        </button>
        <button type="button" hx-post="/api/partials/remote-support/stop" hx-target="#remote-alert" hx-swap="innerHTML" hx-disabled-elt="this" class="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-transparent">
          <span class="hx-ready">关闭远程支持</span>
          <span class="hx-loading items-center gap-1">
            <svg class="animate-spin h-3.5 w-3.5 inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
            正在关闭…
          </span>
        </button>
      </div>
    </form>
  )
})

remoteSupportRouter.post('/remote-support/start', async (c) => {
  try {
    const body = await c.req.parseBody()
    const sshKey = (body.sshKey as string || '').trim()
    const cpolarToken = (body.cpolarToken as string || '').trim()
    const region = (body.region as string || 'eu')
    if (!sshKey) {
      return c.html(<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">请填写 SSH Key</div>)
    }
    // 先保存
    const filePath = resolveRemoteSupportPath()
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify({ sshKey, cpolarToken, region }, null, 2))

    // ── 先终止所有已有 cpolar 进程，避免多实例冲突 ──
    // 注意：不能用 -x，cpolar 进程名为 "cpolar: master process" / "cpolar: worker process"
    try { await execa('pkill', ['cpolar']) } catch {}
    // 等待进程完全退出，确保端口 4040 释放
    for (let w = 0; w < 10; w++) {
      await new Promise(r => setTimeout(r, 300))
      try {
        await execa('pgrep', ['cpolar'])
        // 进程仍在，继续等待
      } catch {
        break // pgrep 找不到 = 进程已退出
      }
    }
    // 再强制杀一次以防万一
    try { await execa('pkill', ['-9', 'cpolar']) } catch {}
    await new Promise(r => setTimeout(r, 500))

    // 启动
    const logFile = `${process.env.HOME}/.openclaw/logs/cpolar.log`
    const logDir = path.dirname(logFile)
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
    // 清空旧日志
    fs.writeFileSync(logFile, '')
    // 只有填了 AuthToken 才重新设置，否则用 cpolar 已有的认证
    if (cpolarToken) {
      await execa('cpolar', ['authtoken', cpolarToken])
    }
    // 用 spawn 以 detached 模式启动 cpolar，避免 execa await 阻塞（execa 会等 stdio 管道关闭，daemon 子进程继承管道导致永远不返回）
    const cpolarChild = spawn('cpolar', ['tcp', `-region=${region}`, `-log=${logFile}`, '-log-level=INFO', '-daemon=on', '22'], {
      detached: true,
      stdio: 'ignore',
    })
    cpolarChild.unref()
    // 轮询等待 Tunnel established（最多 30 秒，从日志读取 + API 备选）
    let forwarding = ''
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 500))
      // 从日志读取（cpolar -log 格式: Tunnel established at tcp://...）
      try {
        const log = fs.readFileSync(logFile, 'utf-8')
        const match = log.match(/Tunnel established at (tcp:\/\/\S+)/)
        if (match) {
          forwarding = match[1]
          break
        }
        // 检查是否有认证错误
        if (log.includes('auth failed') || log.includes('authentication failed')) {
          return c.html(<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">cpolar 认证失败，请检查 AuthToken 是否正确</div>)
        }
      } catch {}
      // 备选：通过 API 获取
      try {
        const resp = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: AbortSignal.timeout(1000) })
        if (resp.ok) {
          const text = await resp.text()
          if (text) {
            const json = JSON.parse(text) as any
            const tunnels = json?.tunnels || []
            for (const t of tunnels) {
              if (t.public_url && t.public_url.startsWith('tcp://')) {
                forwarding = t.public_url
                break
              }
            }
          }
        }
      } catch {}
      if (forwarding) break
    }
    if (forwarding) {
      // 从 tcp://host:port 中提取 host 和 port，生成 SSH 命令
      const urlMatch = forwarding.match(/tcp:\/\/([^:]+):(\d+)/)
      const currentUser = os.userInfo().username
      const sshCmd = urlMatch ? `ssh -p ${urlMatch[2]} ${currentUser}@${urlMatch[1]}` : ''
      // 触发表单容器刷新，更新顶部状态显示
      c.header('HX-Trigger', asciiJson({ 'refresh-remote-form': true }))
      return c.html(
        <div class="space-y-3">
          <div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">远程支持已启动</div>
          <div class="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-4">
            <p class="text-sm font-medium text-indigo-800">Forwarding 地址</p>
            <code class="mt-2 block rounded-lg bg-white px-3 py-2 text-sm font-mono text-indigo-700 border border-indigo-100 select-all">{forwarding}</code>
            {sshCmd && (
              <div class="mt-3">
                <p class="text-sm font-medium text-indigo-800">SSH 连接命令</p>
                <code class="mt-1 block rounded-lg bg-white px-3 py-2 text-sm font-mono text-slate-700 border border-indigo-100 select-all">{sshCmd}</code>
              </div>
            )}
          </div>
        </div>
      )
    }
    // 触发表单容器刷新
    c.header('HX-Trigger', asciiJson({ 'refresh-remote-form': true }))
    return c.html(<div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">远程支持已启动，但未能获取 Forwarding 地址。请检查日志: {logFile}</div>)
  } catch (err: any) {
    return c.html(<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">启动失败: {err.message}</div>)
  }
})

remoteSupportRouter.post('/remote-support/stop', async (c) => {
  try {
    // 终止所有 cpolar 进程
    try {
      await execa('pkill', ['cpolar'])
    } catch {
      // pkill 在没找到进程时会返回非 0 退出码，忽略
    }
    // 等待进程退出
    await new Promise(r => setTimeout(r, 1000))
    // 检查是否还在运行
    let stillRunning = false
    try {
      await execa('pgrep', ['cpolar'])
      stillRunning = true
    } catch {}
    if (stillRunning) {
      // 强制杀掉
      try { await execa('pkill', ['-9', 'cpolar']) } catch {}
      await new Promise(r => setTimeout(r, 500))
    }
    // 触发表单容器刷新，更新状态显示
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'success', message: '远程支持已关闭' }, 'refresh-remote-form': true }))
    return c.html(<div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">远程支持已关闭</div>)
  } catch (err: any) {
    return c.html(<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">关闭失败: {err.message}</div>)
  }
})
