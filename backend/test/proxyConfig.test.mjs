import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPlaywrightProxyConfig, describeProxyForLog } from '../src/executor/proxyConfig.js'

test('plain host + port → http server and credentials', () => {
  const p = buildPlaywrightProxyConfig({
    provider: 'SOAX',
    host: '  91.246.222.146  ',
    port: '50100',
    username: ' takeit32 ',
    password: ' dont1 ',
  })
  assert.equal(p?.server, 'http://91.246.222.146:50100')
  assert.equal(p?.username, 'takeit32')
  assert.equal(p?.password, 'dont1')
})

test('host already includes http:// and port in separate field', () => {
  const p = buildPlaywrightProxyConfig({
    host: 'http://proxy.example.com',
    port: '9000',
    username: 'u',
    password: 'p',
  })
  assert.equal(p?.server, 'http://proxy.example.com:9000')
})

test('credentials only in URL host field', () => {
  const p = buildPlaywrightProxyConfig({
    host: 'http://user:secret@10.0.0.1:8080',
    port: '',
    username: '',
    password: '',
  })
  assert.equal(p?.server, 'http://10.0.0.1:8080')
  assert.equal(p?.username, 'user')
  assert.equal(p?.password, 'secret')
})

test('socks5 scheme preserved', () => {
  const p = buildPlaywrightProxyConfig({
    host: 'socks5://127.0.0.1:1080',
    port: '',
    username: '',
    password: '',
  })
  assert.equal(p?.server, 'socks5://127.0.0.1:1080')
})

test('PLAYWRIGHT_PROXY_SCHEME overrides default', () => {
  const prev = process.env.PLAYWRIGHT_PROXY_SCHEME
  process.env.PLAYWRIGHT_PROXY_SCHEME = 'socks5'
  try {
    const p = buildPlaywrightProxyConfig({
      host: '1.2.3.4',
      port: '55',
      username: '',
      password: '',
    })
    assert.equal(p?.server, 'socks5://1.2.3.4:55')
  } finally {
    if (prev === undefined) delete process.env.PLAYWRIGHT_PROXY_SCHEME
    else process.env.PLAYWRIGHT_PROXY_SCHEME = prev
  }
})

test('describeProxyForLog never includes password', () => {
  const cfg = buildPlaywrightProxyConfig({
    host: 'h',
    port: '1',
    username: 'u',
    password: 'secret',
  })
  const line = describeProxyForLog({ host: 'h', port: '1', username: 'u', password: 'secret' }, cfg)
  assert.ok(!line.includes('secret'))
  assert.ok(line.includes('password=***'))
})

test('empty host → undefined', () => {
  assert.equal(buildPlaywrightProxyConfig({ host: '   ', port: '1' }), undefined)
})
