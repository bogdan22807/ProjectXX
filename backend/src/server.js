import { registerProcessGlobalErrorHandlers } from './executor/processGlobalErrorHandlers.js'

registerProcessGlobalErrorHandlers()

import express from 'express'
import accountsRouter from './routes/accounts.js'
import proxiesRouter from './routes/proxies.js'
import profilesRouter from './routes/profiles.js'
import logsRouter from './routes/logs.js'
import warmupRouter from './routes/warmup.js'
import warmupTestRunRouter from './routes/warmupTestRun.js'
import mobileRouter from './routes/mobile.js'
import { sendJsonData, sendJsonError, sendJsonSuccess } from './sendJson.js'

const app = express()
const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'
const API_PREFIX = '/api'
const mountedRoutes = []

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return sendJsonSuccess(res)
  next()
})

app.use(express.json({ limit: '1mb' }))

function mountApi(path, router) {
  app.use(path, router)
  app.use(`${API_PREFIX}${path}`, router)
  mountedRoutes.push(path)
}

mountApi('/accounts', accountsRouter)
mountApi('/proxies', proxiesRouter)
mountApi('/profiles', profilesRouter)
mountApi('/logs', logsRouter)
mountApi('/warmup', warmupRouter)
mountApi('/warmup/test-run', warmupTestRunRouter)
mountApi('/mobile', mobileRouter)

app.get('/health', (_req, res) => {
  return sendJsonData(res, 200, { ok: true })
})

app.get(`${API_PREFIX}/health`, (_req, res) => {
  return sendJsonData(res, 200, { ok: true })
})

app.use((err, _req, res, _next) => {
  console.error(err)
  return sendJsonError(res, 500, 'Internal server error')
})

const server = app.listen(PORT, HOST, () => {
  const publicHost = HOST === '0.0.0.0' ? 'localhost' : HOST
  console.log('[startup] backend API started')
  console.log(`[startup] env=${process.env.NODE_ENV || 'development'} node=${process.version}`)
  console.log(`[startup] listening=http://${publicHost}:${PORT}`)
  console.log(`[startup] routes=${mountedRoutes.join(', ')}`)
})

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`[startup] failed: port ${PORT} is already in use`)
    return
  }

  console.error('[startup] failed:', error)
})
