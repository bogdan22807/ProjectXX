# Инструкция

Коротко, что нужно сделать, чтобы запустить проект локально и задеплоить frontend.

## Что внутри проекта

```text
backend/       - сервер/API
admin-panel/   - админка на React + Vite
vercel.json    - настройки деплоя на Vercel
```

Backend запускается отдельно.  
Admin-panel запускается отдельно и ходит в backend через `/api`.

## Что нужно установить

Нужно поставить:

- Node.js 20 LTS или новее
- npm
- Python 3.10 или новее
- pip
- Git

npm ставится вместе с Node.js.

## Установка на Mac

Если есть Homebrew:

```bash
brew install node
brew install python
```

Проверить:

```bash
node -v
npm -v
python3 --version
python3 -m pip --version
git --version
```

## Установка на Windows

Скачать и установить:

```text
https://nodejs.org/
https://www.python.org/downloads/windows/
https://git-scm.com/download/win
```

При установке Python лучше включить галочку:

```text
Add python.exe to PATH
```

Проверить в PowerShell:

```powershell
node -v
npm -v
py --version
py -m pip --version
git --version
```

Если `py` не работает, попробуй:

```powershell
python --version
python -m pip --version
```

## Установить backend

Из корня проекта:

```bash
cd backend
npm ci
npm run playwright:install
python3 -m pip install -r requirements-fox.txt
```

На Windows:

```powershell
cd backend
npm ci
npm run playwright:install
py -m pip install -r requirements-fox.txt
```

Если `npm ci` не сработал:

```bash
npm install
```

Если нужна загрузка Camoufox:

```bash
python3 -m camoufox fetch
```

На Windows:

```powershell
py -m camoufox fetch
```

## Установить admin-panel

Открыть новый терминал или вернуться в корень проекта:

```bash
cd admin-panel
npm ci
```

Если `npm ci` не сработал:

```bash
npm install
```

## Запустить backend

Первый терминал:

```bash
cd backend
npm run dev
```

Backend обычно запускается тут:

```text
http://localhost:3000
```

Проверка в браузере:

```text
http://localhost:3000/api/health
```

Проверка на Mac:

```bash
curl http://localhost:3000/api/health
```

Проверка на Windows:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

Если порт `3000` занят, можно запустить на другом порту.

Mac:

```bash
cd backend
PORT=3001 npm run dev
```

Windows:

```powershell
cd backend
$env:PORT="3001"
npm run dev
```

## Запустить admin-panel

Второй терминал:

```bash
cd admin-panel
npm run dev
```

Обычно адрес будет такой:

```text
http://localhost:5173
```

Если Vite покажет другой адрес, открыть нужно тот адрес, который написан в терминале.

Если backend запущен не на `3000`, тогда admin-panel запускать так.

Mac:

```bash
cd admin-panel
VITE_API_PROXY_TARGET=http://localhost:3001 npm run dev
```

Windows:

```powershell
cd admin-panel
$env:VITE_API_PROXY_TARGET="http://localhost:3001"
npm run dev
```

## Как это работает локально

1. Backend запускается на `http://localhost:3000`.
2. Admin-panel запускается на `http://localhost:5173`.
3. Admin-panel делает запросы на `/api`.
4. Vite перекидывает `/api` на backend.

То есть локально обычно не нужно руками прописывать API URL, если backend работает на порту `3000`.

## ENV переменные

Реальные значения в GitHub не добавлять.

Для backend:

```env
PORT=3000
```

Для admin-panel:

```env
VITE_API_URL=http://localhost:3000
VITE_API_PROXY_TARGET=http://localhost:3000
VITE_BASE=/
```

Обычно локально можно вообще не создавать `.env`, если запускаешь все по стандартным портам.

Для proxy и Playwright в проекте могут использоваться такие переменные:

```env
PLAYWRIGHT_PROXY_SERVER=
PLAYWRIGHT_PROXY_USERNAME=
PLAYWRIGHT_PROXY_PASSWORD=
PLAYWRIGHT_PROXY_SCHEME=
PLAYWRIGHT_HEADLESS=
PLAYWRIGHT_HEADED=
PLAYWRIGHT_GOTO_TIMEOUT_MS=
FOX_PYTHON=
FOX_HEADLESS=
FOX_USERNAME=
```

## Что не загружать в GitHub

Коротко:

```text
.env
.env.local
node_modules/
локальные базы данных
локальные профили браузера
screenshots/
токены
пароли
```

## Сборка admin-panel

```bash
cd admin-panel
npm run build
```

После сборки файлы будут тут:

```text
admin-panel/dist
```

Локально посмотреть production-сборку:

```bash
cd admin-panel
npm run preview
```

## Деплой на Vercel

На Vercel деплоится только `admin-panel`.

В проекте уже есть `vercel.json`:

```json
{
  "installCommand": "cd admin-panel && npm ci",
  "buildCommand": "cd admin-panel && npm run build",
  "outputDirectory": "admin-panel/dist"
}
```

Что сделать:

1. Зайти в Vercel.
2. Нажать `Add New...` -> `Project`.
3. Подключить GitHub.
4. Выбрать репозиторий.
5. Проверить настройки:

```text
Install Command: cd admin-panel && npm ci
Build Command: cd admin-panel && npm run build
Output Directory: admin-panel/dist
```

6. Нажать `Deploy`.

Если frontend на Vercel должен ходить в backend, в Vercel добавить ENV:

```text
VITE_API_URL=https://your-backend-domain.example.com
```

Тут нужен реальный адрес backend, не `localhost`.

## Частые проблемы

### `node` или `npm` не найден

Переустановить Node.js и открыть новый терминал.

Проверка:

```bash
node -v
npm -v
```

### Python или pip не найден

Mac:

```bash
python3 --version
python3 -m pip --version
```

Windows:

```powershell
py --version
py -m pip --version
```

### Ошибка при `npm ci`

Попробовать:

```bash
npm install
```

Если мешает старая папка `node_modules`, удалить ее и поставить заново.

Mac:

```bash
rm -rf node_modules
npm install
```

Windows:

```powershell
Remove-Item -Recurse -Force node_modules
npm install
```

### Playwright не установился

В папке `backend`:

```bash
npm run playwright:install
```

### Backend не запускается

Проверить, что ты в папке `backend`:

```bash
cd backend
npm install
npm run dev
```

Если занят порт:

Mac:

```bash
PORT=3001 npm run dev
```

Windows:

```powershell
$env:PORT="3001"
npm run dev
```

### Admin-panel не видит backend

Проверить:

1. Backend запущен.
2. Открывается `http://localhost:3000/api/health`.
3. Admin-panel запущена через `npm run dev`.
4. Если backend на другом порту, указать `VITE_API_PROXY_TARGET`.

Mac:

```bash
VITE_API_PROXY_TARGET=http://localhost:3001 npm run dev
```

Windows:

```powershell
$env:VITE_API_PROXY_TARGET="http://localhost:3001"
npm run dev
```

### Vercel не деплоит

Проверить команды:

```text
cd admin-panel && npm ci
cd admin-panel && npm run build
admin-panel/dist
```

Если пишет про лимит деплоев, просто подождать и запустить деплой позже.

## Самые нужные команды

Backend:

```bash
cd backend
npm install
npm run playwright:install
python3 -m pip install -r requirements-fox.txt
npm run dev
```

Admin-panel:

```bash
cd admin-panel
npm install
npm run dev
```

Build:

```bash
cd admin-panel
npm run build
```

Остановить сервер:

```text
Ctrl + C
```
