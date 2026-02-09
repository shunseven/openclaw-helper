import { WebSocketServer } from 'ws'
import fs from 'fs'
import path from 'path'

/**
 * 创建 WebSocket 服务器并绑定到 HTTP 服务器的 upgrade 事件
 */
export function setupWebSocket(server: import('http').Server) {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '', `http://${request.headers.host}`)

    if (pathname === '/ws/oauth-login') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
        handleOAuthLogin(ws)
      })
    } else {
      socket.destroy()
    }
  })

  return wss
}

function handleOAuthLogin(ws: import('ws').WebSocket) {
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString())
      const { provider, type } = data

      // 只处理第一条连接消息
      if (!type && provider) {
        if (!provider) {
          ws.send(JSON.stringify({ type: 'error', message: '请指定模型提供商' }))
          return
        }

        try {
          // 动态导入 node-pty
          const pty = await import('node-pty')

          // 确定命令
          let command: string
          if (provider === 'gpt') {
            command = 'openclaw models auth login --provider openai --set-default'
          } else if (provider === 'qwen') {
            command = 'openclaw models auth login --provider qwen-portal --set-default'
          } else {
            ws.send(JSON.stringify({ type: 'error', message: '不支持的提供商' }))
            return
          }

          // 创建伪终端
          const shPath = process.env.SHELL || '/bin/sh'
          const home = process.env.HOME || process.cwd()
          const env = {
            ...process.env,
            PATH:
              process.env.PATH ||
              `${home}/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
            TERM: process.env.TERM || 'xterm-256color',
          } as any

          let shell: ReturnType<typeof pty.spawn> | undefined

          try {
            const openclawPath = path.join(home, '.local/bin', 'openclaw')
            const directOpenclaw = fs.existsSync(openclawPath)
            const ptyFile = directOpenclaw ? openclawPath : shPath
            const ptyArgs = directOpenclaw
              ? ['models', 'auth', 'login', '--provider', provider, '--set-default']
              : ['-lc', command]

            shell = pty.spawn(ptyFile, ptyArgs, {
              name: 'xterm-color',
              cols: 80,
              rows: 30,
              cwd: home,
              env,
            })

            // 监听输出
            shell.onData((data) => {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'output', data }))
              }
            })

            // 监听退出
            shell.onExit(({ exitCode }) => {
              if (ws.readyState === ws.OPEN) {
                if (exitCode === 0) {
                  ws.send(JSON.stringify({ type: 'success', message: '登录成功！' }))
                } else {
                  ws.send(
                    JSON.stringify({
                      type: 'error',
                      message: `命令执行失败 (退出码: ${exitCode})`,
                    })
                  )
                }
                setTimeout(() => ws.close(), 1000)
              }
            })
          } catch (err: any) {
            // pty 失败则尝试用 script 分配伪终端
            const { spawn } = await import('child_process')
            const home = process.env.HOME || process.cwd()
            const shPath = process.env.SHELL || '/bin/sh'
            const env = {
              ...process.env,
              PATH:
                process.env.PATH ||
                `${home}/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
              TERM: process.env.TERM || 'xterm-256color',
            } as any

            const openclawPath = path.join(home, '.local/bin', 'openclaw')
            const directOpenclaw = fs.existsSync(openclawPath)
            const fallbackFile = directOpenclaw ? openclawPath : shPath
            const fallbackArgs = directOpenclaw
              ? ['models', 'auth', 'login', '--provider', provider, '--set-default']
              : ['-lc', command]

            const scriptPath = '/usr/bin/script'
            const child = spawn(scriptPath, ['-q', '/dev/null', fallbackFile, ...fallbackArgs], {
              cwd: home,
              env,
            })

            child.stdout.on('data', (data) => {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'output', data: data.toString() }))
              }
            })
            child.stderr.on('data', (data) => {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'output', data: data.toString() }))
              }
            })
            child.on('close', (code) => {
              if (ws.readyState === ws.OPEN) {
                if (code === 0) {
                  ws.send(JSON.stringify({ type: 'success', message: '登录成功！' }))
                } else {
                  const msg = err?.message ? `，pty 启动失败: ${err.message}` : ''
                  ws.send(
                    JSON.stringify({
                      type: 'error',
                      message: `命令执行失败 (退出码: ${code})${msg}`,
                    })
                  )
                }
                setTimeout(() => ws.close(), 1000)
              }
            })
          }

          // 接收用户输入
          ws.on('message', (msg) => {
            try {
              const inputData = JSON.parse(msg.toString())
              if (inputData.type === 'input' && shell) {
                shell.write(inputData.data)
              }
            } catch {
              // 忽略解析错误
            }
          })
        } catch (error: any) {
          ws.send(JSON.stringify({ type: 'error', message: '启动终端失败: ' + error.message }))
          ws.close()
        }
      }
    } catch (error: any) {
      console.error('WebSocket 消息处理错误:', error)
    }
  })

  ws.on('close', () => {
    console.log('WebSocket 连接已关闭')
  })

  ws.on('error', (error) => {
    console.error('WebSocket 错误:', error)
  })
}
