import { Hono } from 'hono'
import { execa } from 'execa'
import { execOpenClaw, extractJson, extractPlainValue } from '../utils'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'

export const skillsRouter = new Hono()

/** 将对象序列化为纯 ASCII 的 JSON 字符串（非 ASCII 字符用 \uXXXX 转义），避免 HTTP header ByteString 报错 */
function asciiJson(obj: any): string {
  return JSON.stringify(obj).replace(/[\u0080-\uffff]/g, (ch) => {
    return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
  })
}

// ─── Skills 管理 ───

skillsRouter.get('/skills/apple-notes/status', async (c) => {
  try {
    // 尝试读取 Notes 文件夹列表，如果成功则表示有权限
    await execa('osascript', ['-e', 'tell application "Notes" to count folders'])
    return c.json({ authorized: true })
  } catch (e: any) {
    // 权限错误通常是 -1743 (not authorized) 或 -10004 (permission violation)
    // 但无论什么错误，只要不是成功，都认为未授权或无法访问
    return c.json({ authorized: false, error: e.message })
  }
})

// ─── Skills 管理 ───

skillsRouter.get('/skills/apple-notes/status', async (c) => {
  try {
    // 尝试读取 Notes 文件夹列表，如果成功则表示有权限
    await execa('osascript', ['-e', 'tell application "Notes" to count folders'])
    return c.json({ authorized: true })
  } catch (e: any) {
    // 权限错误通常是 -1743 (not authorized) 或 -10004 (permission violation)
    // 但无论什么错误，只要不是成功，都认为未授权或无法访问
    return c.json({ authorized: false, error: e.message })
  }
})

skillsRouter.post('/skills/apple-notes/authorize', async (c) => {
  try {
    // 触发权限弹窗。这里使用 count folders 因为它明确需要数据访问权限。
    // 我们不需要等待它完成（因为用户可能需要时间点击），或者我们可以设置一个短超时。
    // 但为了简单，我们让它在后台跑，或者等待它失败（如果用户还没点）。
    // 实际上，osascript 会阻塞直到用户点击弹窗（允许或拒绝）。
    // 我们可以设置一个较长的超时，让用户有时间点击。
    await execa('osascript', ['-e', 'tell application "Notes" to count folders'], { timeout: 30000 })
    return c.json({ success: true })
  } catch (e: any) {
    // 如果用户拒绝，或者超时，都会抛出错误
    return c.json({ success: false, error: e.message }, 400)
  }
})

skillsRouter.get('/skills/apple-reminders/status', async (c) => {
  try {
    // 尝试读取 Reminders 列表，如果成功则表示有权限
    await execa('osascript', ['-e', 'tell application "Reminders" to count lists'])
    return c.json({ authorized: true })
  } catch (e: any) {
    return c.json({ authorized: false, error: e.message })
  }
})

skillsRouter.post('/skills/apple-reminders/authorize', async (c) => {
  try {
    // 触发权限弹窗
    await execa('osascript', ['-e', 'tell application "Reminders" to count lists'], { timeout: 30000 })
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 400)
  }
})

// ─── 集团技能管理 ───

const GROUP_SKILLS_REPO = 'https://github.com/shunseven/sprout-skills.git'

function getGroupSkillsCacheDir() {
  return path.join(os.homedir(), '.openclaw-helper', 'sprout-skills')
}

async function getTargetSkillDirs(): Promise<string[]> {
  const dirs = new Set<string>()
  const defaultDir = path.join(os.homedir(), '.openclaw', 'skills')
  
  // 1. 尝试获取配置
  let configDir: string | null = null
  try {
    const { stdout } = await execOpenClaw( ['config', 'get', '--json', 'agents.defaults.workspace'])
    const workspace = extractPlainValue(stdout as string)
    if (workspace && workspace.trim()) {
      const expanded = workspace.trim().replace(/^~/, os.homedir())
      configDir = path.join(expanded, 'skills')
      dirs.add(configDir)
    }
  } catch {}

  // 2. 扫描已知目录，如果存在则加入 (实现"如果存在就都安装")
  const candidates = [
    defaultDir,
    path.join(os.homedir(), 'clawd', 'skills')
  ]
  
  for (const d of candidates) {
    // 避免重复添加配置目录
    if (d === configDir) continue
    if (fs.existsSync(d)) {
      dirs.add(d)
    }
  }

  // 3. 兜底：如果没有配置目录，且集合为空（说明没有任何已知目录存在），则强制使用默认目录
  if (!configDir && dirs.size === 0) {
    dirs.add(defaultDir)
  }

  return Array.from(dirs)
}

async function ensureGroupSkillsRepo(): Promise<{ success: boolean; error?: string }> {
  const cacheDir = getGroupSkillsCacheDir()
  try {
    if (fs.existsSync(path.join(cacheDir, '.git'))) {
      await execa('git', ['pull', '--ff-only'], { cwd: cacheDir, timeout: 60000 })
    } else {
      const parentDir = path.dirname(cacheDir)
      if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true })
      if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true })
      await execa('git', ['clone', '--depth', '1', GROUP_SKILLS_REPO, cacheDir], { timeout: 120000 })
    }
    return { success: true }
  } catch (err: any) {
    console.error('Failed to sync group skills repo:', err)
    return { success: false, error: err.message }
  }
}

function listGroupSkills(): string[] {
  const cacheDir = getGroupSkillsCacheDir()
  if (!fs.existsSync(cacheDir)) return []
  return fs.readdirSync(cacheDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name)
    .sort()
}

function isSkillInstalled(name: string, targetDirs: string[]): boolean {
  // 只要任意一个目标目录安装了该技能，就认为已安装
  return targetDirs.some(dir => fs.existsSync(path.join(dir, name)))
}

function readMetaVersion(skillDir: string): string | null {
  const metaPath = path.join(skillDir, '_meta.json')
  if (!fs.existsSync(metaPath)) return null
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    return typeof meta.version === 'string' ? meta.version : null
  } catch {
    return null
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na - nb
  }
  return 0
}

function checkNeedsUpdate(repoVersion: string | null, installedVersion: string | null): boolean {
  if (!repoVersion) return false
  if (!installedVersion) return true
  return compareVersions(repoVersion, installedVersion) > 0
}

function readSkillDescription(skillDir: string): string {
  const mdPath = path.join(skillDir, 'SKILL.md')
  if (!fs.existsSync(mdPath)) return ''
  try {
    const content = fs.readFileSync(mdPath, 'utf-8')
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
    if (fmMatch) {
      const descMatch = fmMatch[1].match(/^description:\s*(.+)$/m)
      if (descMatch) return descMatch[1].trim()
    }
    const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('---') && !l.startsWith('#'))
    return firstLine?.trim() || ''
  } catch {
    return ''
  }
}

function copyDirSync(src: string, dest: string) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

type GroupSkillInfo = {
  name: string
  installed: boolean
  description: string
  repoVersion: string | null
  installedVersion: string | null
  needsUpdate: boolean
  downloadUrl?: string
}

function GroupSkillCard(props: { skill: GroupSkillInfo }) {

  const { name, installed, repoVersion, installedVersion, needsUpdate, downloadUrl } = props.skill
  
  const installUrl = downloadUrl 
    ? `/api/partials/skills/xskillhub/${encodeURIComponent(name)}/install?url=${encodeURIComponent(downloadUrl)}`
    : `/api/partials/skills/group/${encodeURIComponent(name)}/install`
    
  const updateUrl = downloadUrl
    ? `/api/partials/skills/xskillhub/${encodeURIComponent(name)}/update?url=${encodeURIComponent(downloadUrl)}`
    : `/api/partials/skills/group/${encodeURIComponent(name)}/update`

  const uninstallUrl = downloadUrl
    ? `/api/partials/skills/xskillhub/${encodeURIComponent(name)}/uninstall?url=${encodeURIComponent(downloadUrl)}`
    : `/api/partials/skills/group/${encodeURIComponent(name)}/uninstall`

  return (
    <div class="rounded-xl border border-slate-200 bg-white p-4" id={`group-skill-${name}`}>
      <div class="flex items-center gap-3 mb-2 flex-wrap">
        <strong class="text-sm text-slate-800 break-all">{name}</strong>
        {repoVersion && (
          <span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
            v{repoVersion}
          </span>
        )}
        {repoVersion && installed && installedVersion && installedVersion !== repoVersion && (
          <span class="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
            已装 v{installedVersion}
          </span>
        )}
        <div class="flex items-center gap-2">
          {installed ? (
            <>
              {needsUpdate && (
                <button
                  class="peer rounded-lg border border-blue-200 px-3 py-1 text-xs text-blue-600 hover:bg-blue-50 transition-colors"
                  hx-post={updateUrl}
                  hx-target="#group-skills-list"
                  hx-swap="innerHTML"
                  hx-disabled-elt="this"
                >
                  更新
                </button>
              )}
              <button
                class={`${needsUpdate ? '' : 'peer '}rounded-lg border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50 transition-colors`}
                hx-post={uninstallUrl}
                hx-target="#group-skills-list"
                hx-swap="innerHTML"
                hx-disabled-elt="this"
                hx-confirm={`确定要删除技能 ${name} 吗？`}
              >
                删除
              </button>
            </>
          ) : (
            <button
              class="peer rounded-lg border border-emerald-200 px-3 py-1 text-xs text-emerald-600 hover:bg-emerald-50 transition-colors"
              hx-post={installUrl}
              hx-target="#group-skills-list"
              hx-swap="innerHTML"
              hx-disabled-elt="this"
            >
              安装
            </button>
          )}
          <span class="hidden peer-[.htmx-request]:inline-flex items-center gap-1 text-slate-400">
            <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
          </span>
        </div>
      </div>
      <div class="text-xs text-slate-500 break-words line-clamp-3" title={props.skill.description || name}>
        {props.skill.description || name}
      </div>
    </div>
  )
}

function buildGroupSkillInfoList(names: string[], targetDirs: string[]): GroupSkillInfo[] {
  const cacheDir = getGroupSkillsCacheDir()
  return names.map(name => {
    const repoDir = path.join(cacheDir, name)
    const repoVersion = readMetaVersion(repoDir)
    const installed = isSkillInstalled(name, targetDirs)

    let installedVersion: string | null = null
    if (installed) {
      for (const dir of targetDirs) {
        const v = readMetaVersion(path.join(dir, name))
        if (v) { installedVersion = v; break }
      }
    }

    return {
      name,
      installed,
      description: readSkillDescription(repoDir),
      repoVersion,
      installedVersion,
      needsUpdate: installed && checkNeedsUpdate(repoVersion, installedVersion),
    }
  })
}

function GroupSkillList(props: { skills: GroupSkillInfo[] }) {
  if (!props.skills.length) {
    return <p class="text-sm text-slate-500">暂无可用的集团技能</p>
  }
  return (
    <>
      {props.skills.map(skill => <GroupSkillCard skill={skill} />)}
    </>
  )
}

async function downloadAndUnzip(url: string, name: string): Promise<{ srcDir: string, tmpRoot: string }> {
  const tmpRoot = path.join(os.tmpdir(), `xskillhub-${name}-${Date.now()}`)
  if (!fs.existsSync(tmpRoot)) fs.mkdirSync(tmpRoot, { recursive: true })
  const zipPath = path.join(tmpRoot, 'skill.zip')
  
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.statusText}`)
  if (!res.body) throw new Error('No body')
  
  // @ts-ignore
  await pipeline(res.body, createWriteStream(zipPath))
  
  await execa('unzip', ['-o', zipPath, '-d', tmpRoot])
  fs.rmSync(zipPath)
  
  const entries = fs.readdirSync(tmpRoot).filter(n => !n.startsWith('.'))
  let srcDir = tmpRoot
  if (entries.length === 1 && fs.statSync(path.join(tmpRoot, entries[0])).isDirectory()) {
      srcDir = path.join(tmpRoot, entries[0])
  }
  return { srcDir, tmpRoot }
}

async function buildXSkillHubList(): Promise<GroupSkillInfo[]> {
    const response = await fetch('https://xskillhub.com/api/public/skill-packages?page=1&pageSize=999')
    if (!response.ok) throw new Error(`Failed to fetch skills: ${response.statusText}`)
    const data: any = await response.json()
    const packages = data.packages || []
    const targetDirs = await getTargetSkillDirs()
    
    return packages.map((pkg: any) => {
      const name = pkg.slug
      const installed = isSkillInstalled(name, targetDirs)
      let installedVersion: string | null = null
      if (installed) {
        for (const dir of targetDirs) {
          const v = readMetaVersion(path.join(dir, name))
          if (v) { installedVersion = v; break }
        }
      }
      return {
        name,
        installed,
        description: pkg.description || '',
        repoVersion: pkg.skillVersion,
        installedVersion,
        needsUpdate: installed && checkNeedsUpdate(pkg.skillVersion, installedVersion),
        downloadUrl: pkg.filePath
      }
    })
}

skillsRouter.get('/skills/group-xskillhub', async (c) => {
  try {
    const skills = await buildXSkillHubList()
    return c.html(<GroupSkillList skills={skills} />)
  } catch (err: any) {
    return c.html(
      <div class="col-span-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        <p class="font-medium">加载技能广场失败</p>
        <p class="mt-1 opacity-80">{err.message}</p>
      </div>
    )
  }
})

skillsRouter.get('/skills/group', async (c) => {
  try {
    const { success, error } = await ensureGroupSkillsRepo()
    const names = listGroupSkills()
    const targetDirs = await getTargetSkillDirs()
    const skills = buildGroupSkillInfoList(names, targetDirs)

    if (!success) {
      if (skills.length > 0) {
        return c.html(
          <>
            <div class="col-span-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 mb-2">
              <p class="font-medium">同步技能仓库失败，显示本地缓存列表。</p>
              <p class="mt-0.5 opacity-80">{error}</p>
            </div>
            <GroupSkillList skills={skills} />
          </>
        )
      } else {
        return c.html(
          <div class="col-span-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p class="font-medium">加载集团技能失败</p>
            <p class="mt-1 opacity-80">{error}</p>
          </div>
        )
      }
    }

    return c.html(<GroupSkillList skills={skills} />)
  } catch (err: any) {
    return c.html(<p class="text-sm text-red-500">加载集团技能失败: {err.message}</p>)
  }
})

skillsRouter.post('/skills/group/:name/install', async (c) => {
  const name = c.req.param('name')
  try {
    const srcDir = path.join(getGroupSkillsCacheDir(), name)
    const targetDirs = await getTargetSkillDirs()

    if (!fs.existsSync(srcDir)) {
      c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: `技能 ${name} 不存在` } }))
      return c.html(<GroupSkillList skills={buildGroupSkillInfoList(listGroupSkills(), targetDirs)} />)
    }

    if (targetDirs.length === 0) {
       c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: `未找到有效的技能安装目录 (.openclaw/skills 或 clawd/skills)` } }))
       return c.html(<GroupSkillList skills={buildGroupSkillInfoList(listGroupSkills(), targetDirs)} />)
    }

    let installedCount = 0
    for (const dir of targetDirs) {
      copyDirSync(srcDir, path.join(dir, name))
      installedCount++
    }

    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'success', message: `技能 ${name} 已安装到 ${installedCount} 个目录` } }))
    return c.html(<GroupSkillList skills={buildGroupSkillInfoList(listGroupSkills(), targetDirs)} />)
  } catch (err: any) {
    const targetDirs = await getTargetSkillDirs()
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: `安装失败: ${err.message}` } }))
    return c.html(<GroupSkillList skills={buildGroupSkillInfoList(listGroupSkills(), targetDirs)} />)
  }
})

skillsRouter.post('/skills/group/:name/update', async (c) => {
  const name = c.req.param('name')
  try {
    const srcDir = path.join(getGroupSkillsCacheDir(), name)
    const targetDirs = await getTargetSkillDirs()

    if (!fs.existsSync(srcDir)) {
      c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: `技能 ${name} 不存在` } }))
      return c.html(<GroupSkillList skills={buildGroupSkillInfoList(listGroupSkills(), targetDirs)} />)
    }

    let updatedCount = 0
    for (const dir of targetDirs) {
      const destDir = path.join(dir, name)
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true })
        copyDirSync(srcDir, destDir)
        updatedCount++
      }
    }

    const repoVersion = readMetaVersion(srcDir)
    const versionHint = repoVersion ? ` (v${repoVersion})` : ''
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'success', message: `技能 ${name} 已更新到最新版本${versionHint}，共 ${updatedCount} 个目录` } }))
    return c.html(<GroupSkillList skills={buildGroupSkillInfoList(listGroupSkills(), targetDirs)} />)
  } catch (err: any) {
    const targetDirs = await getTargetSkillDirs()
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: `更新失败: ${err.message}` } }))
    return c.html(<GroupSkillList skills={buildGroupSkillInfoList(listGroupSkills(), targetDirs)} />)
  }
})

skillsRouter.post('/skills/xskillhub/:name/install', async (c) => {
  const name = c.req.param('name')
  const url = c.req.query('url')

  try {
    if (!url) throw new Error('Missing download URL')
    const targetDirs = await getTargetSkillDirs()
    if (targetDirs.length === 0) throw new Error('未找到有效的技能安装目录')

    const { srcDir, tmpRoot } = await downloadAndUnzip(url, name)
    
    let installedCount = 0
    for (const dir of targetDirs) {
      copyDirSync(srcDir, path.join(dir, name))
      installedCount++
    }
    
    fs.rmSync(tmpRoot, { recursive: true, force: true })

    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'success', message: `技能 ${name} 已安装到 ${installedCount} 个目录` } }))
    const skills = await buildXSkillHubList()
    return c.html(<GroupSkillList skills={skills} />)
  } catch (err: any) {
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: `安装失败: ${err.message}` } }))
    const skills = await buildXSkillHubList().catch(() => []) 
    return c.html(<GroupSkillList skills={skills} />)
  }
})

skillsRouter.post('/skills/xskillhub/:name/update', async (c) => {
  const name = c.req.param('name')
  const url = c.req.query('url')

  try {
    if (!url) throw new Error('Missing download URL')
    const targetDirs = await getTargetSkillDirs()

    const { srcDir, tmpRoot } = await downloadAndUnzip(url, name)
    
    let updatedCount = 0
    for (const dir of targetDirs) {
      const destDir = path.join(dir, name)
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true })
        copyDirSync(srcDir, destDir)
        updatedCount++
      }
    }
    
    fs.rmSync(tmpRoot, { recursive: true, force: true })

    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'success', message: `技能 ${name} 已更新到最新版本，共 ${updatedCount} 个目录` } }))
    const skills = await buildXSkillHubList()
    return c.html(<GroupSkillList skills={skills} />)
  } catch (err: any) {
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: `更新失败: ${err.message}` } }))
    const skills = await buildXSkillHubList().catch(() => [])
    return c.html(<GroupSkillList skills={skills} />)
  }
})

skillsRouter.post('/skills/xskillhub/:name/uninstall', async (c) => {
    const name = c.req.param('name')
    try {
      const targetDirs = await getTargetSkillDirs()
      let removedCount = 0
  
      for (const dir of targetDirs) {
        const destDir = path.join(dir, name)
        if (fs.existsSync(destDir)) {
          fs.rmSync(destDir, { recursive: true, force: true })
          removedCount++
        }
      }
  
      c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'success', message: `技能 ${name} 已从 ${removedCount} 个目录删除` } }))
      const skills = await buildXSkillHubList()
      return c.html(<GroupSkillList skills={skills} />)
    } catch (err: any) {
      c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: `删除失败: ${err.message}` } }))
      const skills = await buildXSkillHubList().catch(() => [])
      return c.html(<GroupSkillList skills={skills} />)
    }
})

skillsRouter.post('/skills/group/:name/uninstall', async (c) => {
  const name = c.req.param('name')
  try {
    const targetDirs = await getTargetSkillDirs()
    let removedCount = 0

    for (const dir of targetDirs) {
      const destDir = path.join(dir, name)
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true })
        removedCount++
      }
    }

    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'success', message: `技能 ${name} 已从 ${removedCount} 个目录删除` } }))
    return c.html(<GroupSkillList skills={buildGroupSkillInfoList(listGroupSkills(), targetDirs)} />)
  } catch (err: any) {
    const targetDirs = await getTargetSkillDirs()
    c.header('HX-Trigger', asciiJson({ 'show-alert': { type: 'error', message: `删除失败: ${err.message}` } }))
    return c.html(<GroupSkillList skills={buildGroupSkillInfoList(listGroupSkills(), targetDirs)} />)
  }
})
