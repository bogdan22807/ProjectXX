# ENV переменные

В проекте используются переменные окружения для настройки backend, Playwright, Python/Fox и admin-panel.

Не добавляйте реальные значения секретов в GitHub. В документации ниже указаны только имена переменных и примерный смысл.

## Где хранить ENV локально

Можно создать локальные файлы:

```text
backend/.env
admin-panel/.env.local
```

Эти файлы нельзя загружать в публичный репозиторий.

Проект сейчас не содержит готового `.env.example`, поэтому при необходимости создайте локальные файлы вручную.

## Backend

### Основной порт

| Переменная | Описание | Пример без секрета |
|---|---|---|
| `PORT` | Порт backend API. Если не задан, используется `3000`. | `3000` |

Пример запуска с портом:

```bash
PORT=3000 npm run dev
```

## Admin-panel / Vite

| Переменная | Описание | Пример без секрета |
|---|---|---|
| `VITE_API_URL` | URL backend API для frontend. Если не задан, frontend использует `/api`. | `http://localhost:3000` |
| `VITE_API_PROXY_TARGET` | Куда Vite proxy отправляет `/api` в dev/preview. По умолчанию `http://localhost:3000`. | `http://localhost:3000` |
| `VITE_BASE` | Base path для сборки Vite. По умолчанию `/`. | `/` |

Пример локального `admin-panel/.env.local`:

```env
VITE_API_URL=http://localhost:3000
VITE_API_PROXY_TARGET=http://localhost:3000
VITE_BASE=/
```

Если frontend и backend запускаются локально вместе, часто достаточно не задавать `VITE_API_URL`: Vite proxy будет отправлять `/api` на backend.

## Playwright

| Переменная | Описание |
|---|---|
| `PLAYWRIGHT_BROWSERS_PATH` | Путь к установленным браузерам Playwright. |
| `PLAYWRIGHT_CHROMIUM_ARGS` | Дополнительные аргументы запуска Chromium. |
| `PLAYWRIGHT_GOTO_TIMEOUT_MS` | Таймаут перехода на страницу. |
| `PLAYWRIGHT_GOTO_WAIT_UNTIL` | Событие ожидания загрузки страницы. |
| `PLAYWRIGHT_HEADED` | `1` для запуска браузера с окном. |
| `PLAYWRIGHT_HEADLESS` | `1` или `0` для управления headless-режимом в отдельных сценариях. |
| `PLAYWRIGHT_IGNORE_HTTPS_ERRORS` | `1`, чтобы игнорировать HTTPS-ошибки. |
| `PLAYWRIGHT_LAUNCH_TIMEOUT_MS` | Таймаут запуска браузера. |
| `PLAYWRIGHT_MAX_DURATION_MS` | Максимальная длительность запуска сценария. |
| `PLAYWRIGHT_SELECTOR_TIMEOUT_MS` | Таймаут ожидания selector. |
| `PLAYWRIGHT_DEBUG_PROXY_IP_CHECK` | Включает дополнительную проверку proxy IP. |
| `PLAYWRIGHT_DEBUG_SCREENSHOTS` | `1` для debug-скриншотов. Не загружайте screenshots в публичный репозиторий. |

Установка браузера Chromium:

```bash
cd backend
npm run playwright:install
```

На Linux иногда нужны системные зависимости Playwright:

```bash
npx playwright install --with-deps chromium
```

## Proxy

Эти переменные могут содержать приватные данные. Не публикуйте реальные значения.

| Переменная | Описание |
|---|---|
| `PLAYWRIGHT_PROXY_SERVER` | Адрес proxy-сервера. |
| `PLAYWRIGHT_PROXY_USERNAME` | Имя пользователя proxy. |
| `PLAYWRIGHT_PROXY_PASSWORD` | Пароль proxy. |
| `PLAYWRIGHT_PROXY_SCHEME` | Схема proxy, например `http` или `socks5`. |
| `PLAYWRIGHT_PROXY_EMBED_AUTH_IN_URL` | Тестовая настройка для auth в proxy URL. |
| `PROXY_CHECK_GOTO_MS` | Таймаут проверки proxy. |
| `PROXY_DIAG_HOST` | Host для диагностики proxy. |
| `PROXY_DIAG_PORT` | Port для диагностики proxy. |
| `PROXY_DIAG_USER` | Пользователь для диагностики proxy. |
| `PROXY_DIAG_PASS` | Пароль для диагностики proxy. |
| `PROXY_DIAG_TIMEOUT_MS` | Таймаут диагностики proxy. |
| `PROXY_DIAG_WAIT_UNTIL` | Режим ожидания для диагностики. |
| `PROXY_SCAN_HOST` | Host для сканирования proxy. |
| `PROXY_SCAN_USER` | Пользователь для сканирования proxy. |
| `PROXY_SCAN_PASS` | Пароль для сканирования proxy. |
| `PROXY_SCAN_PORTS` | Список портов для проверки. |
| `PROXY_SCAN_TIMEOUT_MS` | Таймаут сканирования. |
| `PROXY_SCAN_URL` | URL для проверки соединения. |

## Python / Fox / Camoufox

| Переменная | Описание |
|---|---|
| `FOX_PYTHON` | Путь к Python, который запускает Fox/Camoufox. |
| `PYTHON` | Альтернативный путь к Python. |
| `FOX_USERNAME` | Локальное имя профиля/пользователя для Fox. |
| `FOX_HEADLESS` | Управляет headless-режимом Fox. |
| `FOX_ACTIONS_JSON` | JSON действий для Fox. Не храните приватные данные внутри публично. |
| `FOX_VIEWPORT_PRESET` | Пресет viewport, например `1366x768`. |
| `FOX_WINDOW_WIDTH` | Ширина окна. |
| `FOX_WINDOW_HEIGHT` | Высота окна. |
| `FOX_WS_CONNECT_TIMEOUT_MS` | Таймаут подключения к browser websocket. |

Python-зависимости указаны в:

```text
backend/requirements-fox.txt
```

Там используются:

```text
camoufox>=0.4.11
playwright>=1.40.0
```

Установка:

```bash
cd backend
python3 -m pip install -r requirements-fox.txt
```

Если Camoufox требует загрузить браузерные компоненты:

```bash
python3 -m camoufox fetch
```

## Сценарии и тестовые URL

| Переменная | Описание |
|---|---|
| `SOCIAL_TEST_URL` | URL для тестового сценария. |
| `TEST_SOCIAL_URL` | Альтернативное имя URL для тестового сценария. |
| `SOCIAL_TEST_READY_SELECTOR` | Selector готовности страницы. |
| `TEST_SOCIAL_READY_SELECTOR` | Альтернативное имя selector готовности. |
| `WARMUP_FAKE_ONLY` | `1` для fake-only warmup. |
| `WARMUP_PLAYWRIGHT_AFTER_FAKE` | `1` для Playwright после fake warmup. |
| `TIKTOK_EMERGENCY_GOTO` | Аварийный режим перехода. |
| `TIKTOK_CHALLENGE_WAIT_MS` | Ожидание challenge. |
| `TIKTOK_PROFILE_PEEK_PERCENT` | Процент для profile peek. |
| `TIKTOK_LIKE_PERCENT` | Процент лайков. |
| `TIKTOK_LEGACY_HUMAN_FEED` | Включает legacy-режим feed. |

## Vercel ENV

Для Vercel обычно нужны только frontend-переменные с префиксом `VITE_`.

Пример:

```text
VITE_API_URL=https://your-backend.example.com
VITE_BASE=/
```

Не добавляйте секреты в frontend-переменные. Все переменные с префиксом `VITE_` могут попасть в клиентскую сборку.
