import assert from 'node:assert/strict'
import test from 'node:test'

import { validateMobileProxyRowForBridge } from '../src/executor/mobile/mobileProxyValidation.js'

test('validateMobileProxyRowForBridge accepts split http proxy row', () => {
  const e = validateMobileProxyRowForBridge({
    id: 'px1',
    host: '77.47.147.216',
    port: '50101',
    username: 'dont1',
    password: 'takeit32',
    proxy_scheme: 'http',
  })
  assert.equal(e.scheme, 'http')
  assert.equal(e.host, '77.47.147.216')
  assert.equal(e.port, '50101')
  assert.equal(e.username, 'dont1')
  assert.equal(e.password, 'takeit32')
})

test('validateMobileProxyRowForBridge accepts user:pass@host:port in host field', () => {
  const e = validateMobileProxyRowForBridge({
    id: 'px2',
    host: 'dont1:takeit32@77.47.147.216',
    port: '50101',
    proxy_scheme: 'http',
  })
  assert.equal(e.scheme, 'http')
  assert.equal(e.host, '77.47.147.216')
  assert.equal(e.port, '50101')
})

test('validateMobileProxyRowForBridge rejects socks5', () => {
  assert.throws(
    () =>
      validateMobileProxyRowForBridge({
        id: 'px3',
        host: '1.2.3.4',
        port: '1080',
        proxy_scheme: 'socks5',
      }),
    /only http proxies \(got socks5\)/,
  )
})

test('validateMobileProxyRowForBridge rejects missing port', () => {
  assert.throws(
    () =>
      validateMobileProxyRowForBridge({
        id: 'px4',
        host: '1.2.3.4',
        port: '',
        proxy_scheme: 'http',
      }),
    /must include host and port/,
  )
})
