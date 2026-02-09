/**
 * 生产环境 Node.js 服务器入口
 * 在 HonoX 应用基础上添加 WebSocket 支持
 */
import { createServer } from 'http'
import { serveStatic } from '@hono/node-server/serve-static'
import { setupWebSocket } from './app/lib/ws-handler'
import app from './app/server'

// 生产环境添加静态文件服务
app.use('/assets/*', serveStatic({ root: './public' }))
app.use('/tailwind.css', serveStatic({ path: './public/tailwind.css' }))

const PORT = 17543

console.log(`🚀 OpenClaw Helper 服务启动中...`)
console.log(`📍 监听端口: ${PORT}`)
console.log(`🌐 访问地址: http://127.0.0.1:${PORT}`)

// 创建 HTTP 服务器
const server = createServer(async (req, res) => {
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const response = await app.fetch(
    new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers as any,
      body: hasBody ? (req as any) : undefined,
      ...(hasBody ? { duplex: 'half' } : {}),
    } as RequestInit)
  )

  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })

  if (response.body) {
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
    }
  }
  res.end()
})

// 设置 WebSocket 支持
setupWebSocket(server)

server.listen(PORT, () => {
  console.log('✅ 服务已启动 (WebSocket 支持已启用)')
})
