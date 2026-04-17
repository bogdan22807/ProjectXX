import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProxyFourPartLine } from '../src/proxyLineParse.js'

test('SOAX order: host:port:password:username', () => {
  const p = parseProxyFourPartLine('91.246.222.146:50100:dont1:takeit32', 'pass_user')
  assert.deepEqual(p, {
    host: '91.246.222.146',
    port: '50100',
    username: 'takeit32',
    password: 'dont1',
  })
})

test('standard order: host:port:username:password', () => {
  const p = parseProxyFourPartLine('1.2.3.4:8080:myuser:mypass', 'user_pass')
  assert.deepEqual(p, {
    host: '1.2.3.4',
    port: '8080',
    username: 'myuser',
    password: 'mypass',
  })
})

test('default order: 3rd=username 4th=password', () => {
  const p = parseProxyFourPartLine('91.246.222.146:50100:dont1:takeit32')
  assert.deepEqual(p, {
    host: '91.246.222.146',
    port: '50100',
    username: 'dont1',
    password: 'takeit32',
  })
})

test('first line only when multiline paste', () => {
  const p = parseProxyFourPartLine('95.134.185.60:50100:dont1:takeit32\n91.210.30.79:50100:dont1:takeit32')
  assert.equal(p?.host, '95.134.185.60')
  assert.equal(p?.username, 'dont1')
  assert.equal(p?.password, 'takeit32')
})

test('reject non-ipv4', () => {
  assert.equal(parseProxyFourPartLine('proxy.example.com:9000:a:b'), null)
})

test('reject wrong segment count', () => {
  assert.equal(parseProxyFourPartLine('1.2.3.4:80:user'), null)
})
