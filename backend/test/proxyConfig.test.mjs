import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPlaywrightProxyConfig,
  describeProxyForLog,
  formatProxyDiagnosticDetail,
} from '../src/executor/proxyConfig.js'

test('plain host + port + credentials → server without auth, separate username/password', () => {
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

test('PLAYWRIGHT_PROXY_EMBED_AUTH_IN_URL is ignored (credentials never in server URL)', () => {
  const prev = process.env.PLAYWRIGHT_PROXY_EMBED_AUTH_IN_URL
  process.env.PLAYWRIGHT_PROXY_EMBED_AUTH_IN_URL = '1'
  try {
    const p = buildPlaywrightProxyConfig({
      host: '91.246.222.146',
      port: '50100',
      username: 'takeit32',
      password: 'dont1',
    })
    assert.equal(p?.server, 'http://91.246.222.146:50100')
    assert.equal(p?.username, 'takeit32')
    assert.equal(p?.password, 'dont1')
  } finally {
    if (prev === undefined) delete process.env.PLAYWRIGHT_PROXY_EMBED_AUTH_IN_URL
    else process.env.PLAYWRIGHT_PROXY_EMBED_AUTH_IN_URL = prev
  }
})

test('host already includes http:// and port in separate field', () => {
  const p = buildPlaywrightProxyConfig({
    host: 'http://proxy.example.com',
    port: '9000',
    username: 'u',
    password: 'p',
  })
  assert.equal(p?.server, 'http://proxy.example.com:9000')
  assert.equal(p?.username, 'u')
  assert.equal(p?.password, 'p')
})

test('credentials only in URL host field → split to server + username/password', () => {
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

test('proxy_scheme socks5 uses separate username/password (not in server URL)', () => {
  const p = buildPlaywrightProxyConfig({
    proxy_scheme: 'socks5',
    host: '91.246.222.146',
    port: '50100',
    username: 'takeit32',
    password: 'dont1',
  })
  assert.equal(p?.server, 'socks5://91.246.222.146:50100')
  assert.equal(p?.username, 'takeit32')
  assert.equal(p?.password, 'dont1')
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
  assert.ok(!line.includes('u:secret'))
})

test('formatProxyDiagnosticDetail masks username, never password', () => {
  const cfg = buildPlaywrightProxyConfig({
    host: '1.2.3.4',
    port: '80',
    username: 'alice',
    password: 'secret',
  })
  const d = formatProxyDiagnosticDetail(cfg)
  assert.ok(d.includes('server=http://1.2.3.4:80'))
  assert.ok(d.includes('user='))
  assert.ok(!d.includes('secret'))
  assert.ok(!d.includes('alice'))
})

test('empty host → undefined', () => {
  assert.equal(buildPlaywrightProxyConfig({ host: '   ', port: '1' }), undefined)
})
