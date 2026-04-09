import type { AccountStatus } from '../types/domain'

/** Russian labels for account status badges and selects */
export const accountStatusLabelRu: Record<AccountStatus, string> = {
  New: 'Новая',
  Ready: 'Готово',
  Running: 'Работает',
  Error: 'Ошибка',
}
