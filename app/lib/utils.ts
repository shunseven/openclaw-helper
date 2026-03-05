import { execa, type Options } from 'execa'
import fs from 'fs'
import path from 'path'

/**
 * 剥离 ANSI 转义码（颜色、样式等）
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

/**
 * 从 CLI stdout 中提取纯文本值（剥离 ANSI + 取最后一行非空内容）
 */
export function extractPlainValue(stdout: string): string {
  const clean = stripAnsi(stdout)
  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.length ? lines[lines.length - 1] : ''
}

/**
 * 从 CLI stdout 中提取 JSON 对象
 */
export function extractJson(stdout: string) {
  const clean = stripAnsi(stdout)
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(clean.slice(start, end + 1))
  } catch {
    return null
  }
}

let openclawBin: string | null = null

export async function findOpenClawBin() {
  if (openclawBin) return openclawBin

  // 1. 优先使用环境变量
  if (process.env.OPENCLAW_BIN) {
    openclawBin = process.env.OPENCLAW_BIN
    return openclawBin
  }

  // 2. 尝试从常见位置查找
  const commonPaths = [
    '/usr/local/bin/openclaw',
    '/opt/homebrew/bin/openclaw',
    path.join(process.env.HOME || '', '.local/bin/openclaw'),
    path.join(process.env.HOME || '', '.npm-global/bin/openclaw'),
    path.join(process.env.HOME || '', '.cargo/bin/openclaw'),
  ]

  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      openclawBin = p
      return openclawBin
    }
  }

  // 3. 默认尝试直接执行 openclaw (假设在 PATH 中)
  // 为了更稳健，我们可以尝试通过 `which openclaw` 查找
  try {
    const { stdout } = await execa('which', ['openclaw'])
    if (stdout.trim()) {
      openclawBin = stdout.trim()
      return openclawBin
    }
  } catch {}

  openclawBin = 'openclaw'
  return openclawBin
}

export async function execOpenClaw(args: string[], options?: Options) {
  const bin = await findOpenClawBin()
  const env = { ...process.env, ...options?.env }

  // nvm 安装的 node 可能不在非交互式 shell 的 PATH 中，
  // 确保当前 node 所在目录和 openclaw 所在目录都在子进程 PATH 中
  const nodeBinDir = path.dirname(process.execPath)
  const openclawBinDir = path.dirname(path.resolve(bin))
  const extraPaths = [nodeBinDir, openclawBinDir].filter(Boolean)
  if (extraPaths.length) {
    const currentPath = env.PATH || env.Path || ''
    env.PATH = [...extraPaths, currentPath].filter(Boolean).join(path.delimiter)
  }

  return execa(bin, args, { ...options, env })
}

export async function startGateway(logFile: string) {
  const bin = await findOpenClawBin()
  const nodeBinDir = path.dirname(process.execPath)
  const openclawBinDir = path.dirname(path.resolve(bin))
  const extraPaths = [nodeBinDir, openclawBinDir].filter(Boolean)
  const currentPath = process.env.PATH || ''
  const newPath = [...extraPaths, currentPath].filter(Boolean).join(path.delimiter)

  return execa('sh', ['-c', `nohup ${bin} gateway run --bind loopback --port 18789 > ${logFile} 2>&1 &`], {
    env: { ...process.env, PATH: newPath },
  })
}
