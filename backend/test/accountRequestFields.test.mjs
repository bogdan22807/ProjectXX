import assert from 'node:assert/strict'
import test from 'node:test'

import { accountCreatePayload, accountPatchPayload } from '../src/requestFields.js'

test('accountCreatePayload keeps proxy_id and browser_profile_id nullable when omitted', () => {
  const payload = accountCreatePayload({
    name: 'Manual mobile',
    login: '@mobile',
    account_type: 'mobile',
    mobile_mode: 'manual',
    device_id: 'emulator-5554',
  })

  assert.equal(payload.proxy_id, null)
  assert.equal(payload.browser_profile_id, null)
  assert.equal(payload.mobile_device_id, 'emulator-5554')
  assert.equal(payload.mobile_emulator_name, '')
  assert.equal(payload.mobile_vm_index, '')
  assert.equal(payload.account_type, 'mobile')
  assert.equal(payload.mobile_mode, 'manual')
})

test('accountCreatePayload normalizes blank proxy/profile selections to null', () => {
  const payload = accountCreatePayload({
    name: 'Browser account',
    proxy_id: '   ',
    browser_profile_id: '',
  })

  assert.equal(payload.proxy_id, null)
  assert.equal(payload.browser_profile_id, null)
})

test('accountPatchPayload normalizes blank camelCase proxy/profile selections to null', () => {
  const payload = accountPatchPayload({
    proxyId: '   ',
    browserProfileId: '',
  })

  assert.equal(payload.proxy_id, null)
  assert.equal(payload.browser_profile_id, null)
})

test('accountPatchPayload coerces null NOT NULL text columns to empty string', () => {
  const payload = accountPatchPayload({
    mobile_emulator_name: null,
    mobile_vm_index: null,
    login: null,
  })

  assert.equal(payload.mobile_emulator_name, '')
  assert.equal(payload.mobile_vm_index, '')
  assert.equal(payload.login, '')
})
