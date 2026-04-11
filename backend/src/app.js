import express from 'express'
import accountsRouter from './routes/accounts.js'
import proxiesRouter from './routes/proxies.js'
import profilesRouter from './routes/profiles.js'
import logsRouter from './routes/logs.js'
import warmupRouter from './routes/warmup.js'
import warmupTestRunRouter from './routes/warmupTestRun.js'
import { sendJsonData, sendJsonError, sendJsonSuccess } from './sendJson.js'

const app = express()
const API_PREFIX = '/api'

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
}

mountApi('/accounts', accountsRouter)
mountApi('/proxies', proxiesRouter)
mountApi('/profiles', profilesRouter)
mountApi('/logs', logsRouter)
mountApi('/warmup', warmupRouter)
mountApi('/warmup/test-run', warmupTestRunRouter)

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

export default app
