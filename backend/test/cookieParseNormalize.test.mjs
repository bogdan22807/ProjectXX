import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCookiesForUrlStrict } from '../src/executor/cookieParse.js'

test('JSON cookies: backslash path and expirationDate map to Playwright cookie', () => {
  const raw = JSON.stringify([
    {
      domain: '.tiktok.com',
      name: 'msToken',
      value: 'abc',
      path: '\\/',
      expirationDate: 2147483647,
      secure: true,
      httpOnly: true,
      hostOnly: true,
    },
  ])
  const url = new URL('https://www.tiktok.com/foryou')
  const { cookies, invalid } = parseCookiesForUrlStrict(raw, url)
  assert.equal(invalid, undefined)
  assert.equal(cookies.length, 1)
  assert.equal(cookies[0].path, '/')
  assert.equal(cookies[0].expires, 2147483647)
  assert.equal(cookies[0].name, 'msToken')
})
