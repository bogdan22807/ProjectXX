import assert from 'node:assert/strict'
import test from 'node:test'
import { proxyCreatePayload } from '../src/requestFields.js'

test('POST body with proxy_line SOAX order fills host port user pass', () => {
  const p = proxyCreatePayload({
    provider: 'SOAX',
    proxy_line: '91.246.222.146:50100:dont1:takeit32',
    credential_order: 'pass_user',
  })
  assert.equal(p.host, '91.246.222.146')
  assert.equal(p.port, '50100')
  assert.equal(p.username, 'takeit32')
  assert.equal(p.password, 'dont1')
})

test('four-part string only in host field', () => {
  const p = proxyCreatePayload({
    host: '95.134.185.60:50100:dont1:takeit32',
    credential_order: 'pass_user',
  })
  assert.equal(p.host, '95.134.185.60')
  assert.equal(p.username, 'takeit32')
})
