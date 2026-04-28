# Команды для Windows

Ниже собраны основные команды для PowerShell.

## Проверка инструментов

```powershell
node -v
npm -v
py --version
py -m pip --version
git --version
```

Если команда `py` не работает, попробуйте:

```powershell
python --version
python -m pip --version
```

## Backend

Перейти в папку:

```powershell
cd backend
```

Установить зависимости:

```powershell
npm ci
```

Если нужно:

```powershell
npm install
```

Установить Playwright Chromium:

```powershell
npm run playwright:install
```

Установить Python-зависимости:

```powershell
py -m pip install -r requirements-fox.txt
```

Запустить backend:

```powershell
npm run dev
```

Запустить backend без watch-режима:

```powershell
npm start
```

Проверить API:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

## Admin-panel

Перейти в папку:

```powershell
cd admin-panel
```

Установить зависимости:

```powershell
npm ci
```

Если нужно:

```powershell
npm install
```

Запустить dev-сервер:

```powershell
npm run dev
```

Собрать production-версию:

```powershell
npm run build
```

Посмотреть production-сборку локально:

```powershell
npm run preview
```

Проверить lint:

```powershell
npm run lint
```

## Переменные окружения

Временно задать переменную в текущем окне PowerShell:

```powershell
$env:PORT="3000"
$env:VITE_API_URL="http://localhost:3000"
```

После этого в том же окне можно запускать команды:

```powershell
npm run dev
```

## Очистка зависимостей

Удалить `node_modules` в PowerShell:

```powershell
Remove-Item -Recurse -Force node_modules
```

Переустановить:

```powershell
npm ci
```

## Полезные команды Git

```powershell
git status
git add .
git commit -m "docs: update setup docs"
git push
```

Не добавляйте в commit:

- `.env`
- `node_modules`
- локальные базы данных
- screenshots
- токены и секреты
