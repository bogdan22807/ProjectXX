import assert from 'node:assert/strict'
import test from 'node:test'
import { proxyCreatePayload } from '../src/requestFields.js'

test('manual host port user password scheme', () => {
  const p = proxyCreatePayload({
    provider: 'SOAX',
    host: '91.246.222.146',
    port: '50100',
    username: 'u1',
    password: 'p1',
    proxy_scheme: 'http',
  })
  assert.equal(p.host, '91.246.222.146')
  assert.equal(p.port, '50100')
  assert.equal(p.username, 'u1')
  assert.equal(p.password, 'p1')
  assert.equal(p.proxy_scheme, 'http')
})

test('proxy_line in body is ignored (no parsing)', () => {
  const p = proxyCreatePayload({
    host: '1.2.3.4',
    port: '80',
    proxy_line: '91.246.222.146:50100:dont1:takeit32',
  })
  assert.equal(p.host, '1.2.3.4')
  assert.equal(p.port, '80')
  assert.equal(p.username, '')
  assert.equal(p.password, '')
})

test('four-colon host string is not split (literal host)', () => {
  const p = proxyCreatePayload({
    host: '95.134.185.60:50100:dont1:takeit32',
    port: '80',
  })
  assert.equal(p.host, '95.134.185.60:50100:dont1:takeit32')
  assert.equal(p.port, '80')
})
