import { expect, test } from '@playwright/test'

test.describe('Admin panel UI', () => {
  test('sidebar, dashboard, accounts, modals', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('complementary')).toBeVisible()
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
    await expect(page.getByText('Total Accounts')).toBeVisible()

    await page.screenshot({ path: 'test-results/screenshots/01-dashboard.png', fullPage: true })

    await page.getByRole('link', { name: 'Accounts' }).click()
    await expect(page.getByRole('heading', { name: 'Accounts', level: 1 })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Account Name' })).toBeVisible()

    await page.screenshot({ path: 'test-results/screenshots/02-accounts.png', fullPage: true })

    await page.getByRole('button', { name: 'Add Account' }).click()
    const addAccountDialog = page.getByRole('dialog', { name: 'Add Account' })
    await expect(addAccountDialog).toBeVisible()
    await expect(addAccountDialog.getByLabel('Account Name')).toBeVisible()
    await page.screenshot({ path: 'test-results/screenshots/03-add-account-modal.png', fullPage: true })
    await addAccountDialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(addAccountDialog).toBeHidden()

    await page.getByRole('link', { name: 'Proxies' }).click()
    await expect(page.getByRole('heading', { name: 'Proxies', level: 1 })).toBeVisible()

    await page.getByRole('button', { name: 'Add Proxy' }).click()
    const addProxyDialog = page.getByRole('dialog', { name: 'Add Proxy' })
    await expect(addProxyDialog).toBeVisible()
    await expect(addProxyDialog.getByLabel('Host')).toBeVisible()
    await page.screenshot({ path: 'test-results/screenshots/04-add-proxy-modal.png', fullPage: true })

    await addProxyDialog.getByLabel('Host').fill('e2e-verify.example.com')
    await addProxyDialog.getByRole('button', { name: 'Add Proxy' }).click()
    await expect(addProxyDialog).toBeHidden()
    await expect(page.getByRole('cell', { name: 'e2e-verify.example.com', exact: true })).toBeVisible()

    await page.screenshot({ path: 'test-results/screenshots/05-proxies-after-add.png', fullPage: true })
  })
})
