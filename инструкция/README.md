# Инструкция по установке, запуску и деплою проекта

Эта папка предназначена для GitHub и содержит простую инструкцию по установке, локальному запуску и деплою проекта.

Код проекта не нужно менять для выполнения шагов ниже.

## 1. Что есть в проекте

Проект состоит из двух основных частей:

```text
backend/
admin-panel/
vercel.json
```

- `backend/` - локальный API-сервер на Node.js.
- `admin-panel/` - frontend/admin-panel на React + Vite.
- `vercel.json` - настройки сборки frontend на Vercel.

Дополнительно backend может использовать Python-зависимости для Fox/Camoufox и Playwright.

## 2. Рекомендуемые версии

Если точная версия инструмента не указана в проекте, используйте рекомендованную:

- Node.js: рекомендуется Node.js 20 LTS или новее.
- npm: устанавливается вместе с Node.js.
- Python 3: рекомендуется Python 3.10 или новее.
- pip: устанавливается вместе с Python или отдельно через официальный установщик.

Зависимости backend из `backend/package.json`:

- `express` `^4.21.2`
- `better-sqlite3` `^11.7.0`
- `playwright` `^1.59.1`

Python-зависимости backend из `backend/requirements-fox.txt`:

```text
camoufox>=0.4.11
playwright>=1.40.0
```

Основные зависимости admin-panel из `admin-panel/package.json`:

- `react` `^19.2.4`
- `react-dom` `^19.2.4`
- `react-router-dom` `^7.14.0`
- `vite` `^8.0.4`
- `typescript` `~6.0.2`
- `tailwindcss` `^4.2.2`

## 3. Установка зависимостей backend

Из корня проекта:

```bash
cd backend
npm ci
npm run playwright:install
python3 -m pip install -r requirements-fox.txt
```

Если `npm ci` не подходит или завершается ошибкой:

```bash
npm install
```

Если Camoufox попросит скачать браузерные файлы:

```bash
python3 -m camoufox fetch
```

На Windows вместо `python3` часто используется:

```powershell
py -m pip install -r requirements-fox.txt
py -m camoufox fetch
```

## 4. Установка зависимостей admin-panel

Из корня проекта:

```bash
cd admin-panel
npm ci
```

Если `npm ci` не подходит или завершается ошибкой:

```bash
npm install
```

## 5. Запуск backend локально

Откройте первый терминал:

```bash
cd backend
npm run dev
```

По умолчанию backend слушает:

```text
http://localhost:3000
```

Проверка:

```text
http://localhost:3000/api/health
```

Через терминал на macOS/Linux:

```bash
curl http://localhost:3000/api/health
```

Через PowerShell на Windows:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

Обычный запуск без watch-режима:

```bash
cd backend
npm start
```

Если порт `3000` занят, можно указать другой порт.

macOS/Linux:

```bash
cd backend
PORT=3001 npm run dev
```

Windows PowerShell:

```powershell
cd backend
$env:PORT="3001"
npm run dev
```

## 6. Запуск admin-panel локально

Откройте второй терминал:

```bash
cd admin-panel
npm run dev
```

Vite покажет локальный адрес. Обычно это:

```text
http://localhost:5173
```

Если backend запущен на другом порту, укажите proxy target.

macOS/Linux:

```bash
cd admin-panel
VITE_API_PROXY_TARGET=http://localhost:3001 npm run dev
```

Windows PowerShell:

```powershell
cd admin-panel
$env:VITE_API_PROXY_TARGET="http://localhost:3001"
npm run dev
```

## 7. Сборка и preview admin-panel

Сборка:

```bash
cd admin-panel
npm run build
```

Результат сборки:

```text
admin-panel/dist
```

Локальный preview:

```bash
cd admin-panel
npm run preview
```

Важно: backend должен быть запущен отдельно, если admin-panel делает запросы к API.

## 8. Проверки проекта

Проверка frontend:

```bash
cd admin-panel
npm run lint
```

Тесты backend:

```bash
cd backend
npm test
```

Дополнительные диагностические команды backend:

```bash
cd backend
npm run proxy:diag
npm run proxy:scan-ports
npm run proxy:httpbin-test
npm run proxy:chromium-diagnostic
```

Для proxy-команд могут понадобиться ENV-переменные proxy. Не добавляйте реальные пароли и токены в документацию или публичный репозиторий.

## 9. ENV-переменные

Не добавляйте реальные значения секретов в GitHub.

Локально можно использовать:

```text
backend/.env
admin-panel/.env.local
```

Эти файлы нельзя загружать в публичный репозиторий.

### Backend

| Переменная | Описание | Пример без секрета |
|---|---|---|
| `PORT` | Порт backend API. Если не задан, используется `3000`. | `3000` |

Пример:

```bash
PORT=3000 npm run dev
```

### Admin-panel / Vite

| Переменная | Описание | Пример без секрета |
|---|---|---|
| `VITE_API_URL` | URL backend API для frontend. Если не задан, frontend использует `/api`. | `http://localhost:3000` |
| `VITE_API_PROXY_TARGET` | Куда Vite proxy отправляет `/api` в dev/preview. По умолчанию `http://localhost:3000`. | `http://localhost:3000` |
| `VITE_BASE` | Base path для сборки Vite. По умолчанию `/`. | `/` |

Пример `admin-panel/.env.local` без секретов:

```env
VITE_API_URL=http://localhost:3000
VITE_API_PROXY_TARGET=http://localhost:3000
VITE_BASE=/
```

Если frontend и backend запускаются локально вместе, часто достаточно не задавать `VITE_API_URL`: Vite proxy будет отправлять `/api` на backend.

### Playwright

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

Установка Chromium для Playwright:

```bash
cd backend
npm run playwright:install
```

На Linux иногда нужны системные зависимости Playwright:

```bash
npx playwright install --with-deps chromium
```

### Proxy

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

### Python / Fox / Camoufox

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

### Сценарии и тестовые URL

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

### Vercel ENV

Для Vercel обычно нужны только frontend-переменные с префиксом `VITE_`.

Пример без реального значения:

```text
VITE_API_URL=https://your-backend.example.com
VITE_BASE=/
```

Не добавляйте секреты в frontend-переменные. Все переменные с префиксом `VITE_` могут попасть в клиентскую сборку.

## 10. GitHub: какие файлы нельзя загружать

Не загружайте в публичный репозиторий:

- `.env`;
- `.env.local`;
- `.env.production`;
- любые другие `.env*` файлы с реальными значениями;
- `node_modules/`;
- локальные профили браузера;
- локальные базы данных с приватной информацией;
- `backend/data/app.db`;
- `backend/data/app.db-journal`;
- `backend/data/app.db-wal`;
- `backend/data/app.db-shm`;
- временные debug-файлы;
- `playwright-debug/`;
- `screenshots/`;
- любые секреты и токены;
- логины, пароли, API-ключи;
- proxy credentials;
- дампы баз данных с приватными данными.

Перед commit проверьте:

```bash
git status
```

Если секрет уже попал в GitHub:

1. Сразу замените секрет в сервисе, где он был создан.
2. Удалите секрет из репозитория.
3. Проверьте историю Git.
4. При необходимости пересоздайте ключи, токены и пароли.

## 11. Деплой frontend на Vercel

На Vercel деплоится frontend из папки:

```text
admin-panel/
```

В корне проекта есть `vercel.json`.

Он указывает Vercel:

```json
{
  "installCommand": "cd admin-panel && npm ci",
  "buildCommand": "cd admin-panel && npm run build",
  "outputDirectory": "admin-panel/dist"
}
```

То есть Vercel должен:

1. перейти в `admin-panel`;
2. установить зависимости через `npm ci`;
3. собрать frontend через `npm run build`;
4. взять результат из `admin-panel/dist`.

### Как подключить GitHub к Vercel

1. Зайдите в Vercel.
2. Нажмите `Add New...` -> `Project`.
3. Выберите подключение GitHub.
4. Разрешите Vercel доступ к нужному репозиторию.
5. Импортируйте репозиторий проекта.

### Настройки проекта в Vercel

Если Vercel видит корень репозитория, можно оставить команды из `vercel.json`.

Проверьте:

- Framework Preset: `Vite` или автоопределение.
- Install Command:

```bash
cd admin-panel && npm ci
```

- Build Command:

```bash
cd admin-panel && npm run build
```

- Output Directory:

```text
admin-panel/dist
```

### ENV на Vercel

Для frontend обычно нужна переменная:

```text
VITE_API_URL
```

Она должна указывать на backend API.

Пример без реального значения:

```text
VITE_API_URL=https://your-backend-domain.example.com
```

Если значение уже заканчивается на `/api`, frontend использует его как есть.
Если значение без `/api`, frontend добавит `/api` автоматически.

Не используйте `localhost` в Vercel для публичного backend. Для Vercel `localhost` означает сервер Vercel, а не ваш компьютер.

### Проверка после деплоя

Откройте frontend на Vercel и проверьте, что он видит backend.

Если frontend открывается, но данные не загружаются:

1. проверьте `VITE_API_URL` в настройках Vercel;
2. проверьте, что backend запущен и доступен из интернета;
3. проверьте, что backend отвечает по `/api/health`;
4. сделайте redeploy после изменения ENV.

## 12. Частые ошибки

### `command not found: node`

Node.js не установлен или не добавлен в `PATH`.

Проверка:

```bash
node -v
npm -v
```

Решение:

- установите Node.js 20 LTS или новее;
- закройте и откройте терминал заново;
- на Windows проверьте, что Node.js добавлен в `PATH`.

### `command not found: npm`

npm обычно устанавливается вместе с Node.js.

Проверка:

```bash
npm -v
```

Решение:

- переустановите Node.js с официального сайта;
- на macOS при установке через Homebrew выполните:

```bash
brew install node
```

### Ошибки `npm install` или `npm ci`

Частые причины:

- старая версия Node.js;
- поврежденный `node_modules`;
- поврежденный npm-кеш;
- запуск команды не из той папки.

Проверьте папку:

```bash
pwd
```

Для backend команда должна запускаться из `backend/`.

Для admin-panel команда должна запускаться из `admin-panel/`.

Попробуйте:

```bash
npm cache verify
npm install
```

Если есть старые зависимости, удалите локальную папку `node_modules` и установите заново.

macOS/Linux:

```bash
rm -rf node_modules
npm install
```

Windows PowerShell:

```powershell
Remove-Item -Recurse -Force node_modules
npm install
```

### Ошибки Python или pip

Проверка на macOS/Linux:

```bash
python3 --version
python3 -m pip --version
```

Проверка на Windows:

```powershell
py --version
py -m pip --version
```

Если pip не найден:

```bash
python3 -m ensurepip --upgrade
```

На Windows:

```powershell
py -m ensurepip --upgrade
```

Если установка Python-зависимостей падает, обновите pip:

```bash
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements-fox.txt
```

На Windows:

```powershell
py -m pip install --upgrade pip
py -m pip install -r requirements-fox.txt
```

### Ошибки Playwright install

Установка браузера Chromium:

```bash
cd backend
npm run playwright:install
```

Если Playwright просит системные зависимости на Linux:

```bash
npx playwright install --with-deps chromium
```

Если ошибка связана с сетью, повторите команду позже или проверьте proxy/VPN.

### Vercel deployment rate limit

Что сделать:

1. Подождать и запустить деплой позже.
2. Проверить лимиты аккаунта Vercel.
3. Не запускать много деплоев подряд.
4. Проверить, что в GitHub не создается много лишних push-событий.

### Backend не запускается

Проверьте зависимости:

```bash
cd backend
npm ci
```

Запуск:

```bash
npm run dev
```

Если порт `3000` занят:

```bash
PORT=3001 npm run dev
```

На Windows PowerShell:

```powershell
$env:PORT="3001"
npm run dev
```

Проверьте health endpoint:

```text
http://localhost:3000/api/health
```

### Frontend не видит backend

Проверьте:

1. Backend запущен.
2. Backend доступен по адресу:

```text
http://localhost:3000/api/health
```

3. Admin-panel запущена:

```bash
cd admin-panel
npm run dev
```

4. Если backend не на `3000`, укажите proxy target:

```bash
VITE_API_PROXY_TARGET=http://localhost:3001 npm run dev
```

На Windows PowerShell:

```powershell
$env:VITE_API_PROXY_TARGET="http://localhost:3001"
npm run dev
```

5. Если frontend задеплоен отдельно, укажите публичный API:

```text
VITE_API_URL=https://example-api-host.com
```

### Vite показывает HTML вместо JSON

Это значит, что запрос `/api` попал в frontend, а не в backend.

Проверьте:

- backend запущен;
- `VITE_API_PROXY_TARGET` указывает на backend;
- `VITE_API_URL` указывает на API, если frontend открыт без локального proxy.

## 13. Команды для macOS

Проверить версии:

```bash
node -v
npm -v
python3 --version
python3 -m pip --version
```

Установить зависимости backend:

```bash
cd backend
npm ci
npm run playwright:install
python3 -m pip install -r requirements-fox.txt
```

Установить зависимости admin-panel:

```bash
cd admin-panel
npm ci
```

Запустить backend:

```bash
cd backend
npm run dev
```

Запустить admin-panel:

```bash
cd admin-panel
npm run dev
```

Остановить процесс:

```text
Control + C
```

## 14. Команды для Windows

Проверить версии:

```powershell
node -v
npm -v
py --version
py -m pip --version
git --version
```

Установить зависимости backend:

```powershell
cd backend
npm ci
npm run playwright:install
py -m pip install -r requirements-fox.txt
```

Установить зависимости admin-panel:

```powershell
cd admin-panel
npm ci
```

Запустить backend:

```powershell
cd backend
npm run dev
```

Запустить admin-panel:

```powershell
cd admin-panel
npm run dev
```

Остановить процесс:

```text
Ctrl + C
```
