# Запуск на Mac

Команды ниже выполняются из корня проекта.

## Запустить backend

```bash
cd backend
npm run dev
```

Backend по умолчанию доступен здесь:

```text
http://localhost:3000
```

Проверка health endpoint:

```bash
curl http://localhost:3000/api/health
```

Если порт `3000` занят, можно указать другой порт:

```bash
cd backend
PORT=3001 npm run dev
```

Тогда для admin-panel нужно также поменять proxy target:

```bash
cd admin-panel
VITE_API_PROXY_TARGET=http://localhost:3001 npm run dev
```

## Запустить admin-panel

Откройте второй терминал:

```bash
cd admin-panel
npm run dev
```

Vite покажет адрес в терминале. Обычно это:

```text
http://localhost:5173
```

## Локальная проверка production-сборки

```bash
cd admin-panel
npm run build
npm run preview
```

Если preview должен обращаться к локальному backend:

```bash
cd admin-panel
VITE_API_PROXY_TARGET=http://localhost:3000 npm run preview
```

## Остановить процессы

В терминале с запущенным backend или admin-panel нажмите:

```text
Control + C
```
