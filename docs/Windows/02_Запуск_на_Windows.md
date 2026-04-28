# Запуск на Windows

Команды ниже рассчитаны на PowerShell.

## 1. Запустить backend

Откройте первый терминал:

```powershell
cd backend
npm run dev
```

Backend по умолчанию запускается на:

```text
http://localhost:3000
```

Проверка:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

Если `Invoke-RestMethod` неудобен, откройте адрес в браузере:

```text
http://localhost:3000/api/health
```

## 2. Запустить admin-panel

Откройте второй терминал:

```powershell
cd admin-panel
npm run dev
```

Vite покажет адрес локального frontend, обычно:

```text
http://localhost:5173
```

## 3. Если backend использует другой порт

В первом терминале:

```powershell
cd backend
$env:PORT="3001"
npm run dev
```

Во втором терминале:

```powershell
cd admin-panel
$env:VITE_API_PROXY_TARGET="http://localhost:3001"
npm run dev
```

## 4. Production preview frontend

```powershell
cd admin-panel
npm run build
npm run preview
```

Для preview backend тоже должен быть запущен отдельно.

## 5. Как остановить

В каждом терминале нажмите:

```text
Ctrl + C
```
