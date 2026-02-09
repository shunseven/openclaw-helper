import { Hono } from 'hono'
import { createApp } from 'honox/server'
import { cors } from 'hono/cors'
import { configRouter } from './lib/config-router'
import { partialsRouter } from './lib/partials-router'

const base = new Hono()

// CORS 支持
base.use('/*', cors())

// API 路由
base.route('/api/config', configRouter)

// HTMX 片段路由（返回 HTML 片段供 HTMX 交换）
base.route('/api/partials', partialsRouter)

// 健康检查
base.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

const app = createApp({ app: base })

export default app
