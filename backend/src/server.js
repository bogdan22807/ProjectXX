import express from 'express'
import accountsRouter from './routes/accounts.js'
import proxiesRouter from './routes/proxies.js'
import profilesRouter from './routes/profiles.js'
import logsRouter from './routes/logs.js'
import warmupRouter from './routes/warmup.js'
import warmupTestRunRouter from './routes/warmupTestRun.js'

const app = express()
const PORT = Number(process.env.PORT) || 3000

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  next()
})

app.use(express.json({ limit: '1mb' }))

app.use('/accounts', accountsRouter)
app.use('/proxies', proxiesRouter)
app.use('/profiles', profilesRouter)
app.use('/logs', logsRouter)
app.use('/warmup', warmupRouter)
app.use('/warmup/test-run', warmupTestRunRouter)

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`)
})
