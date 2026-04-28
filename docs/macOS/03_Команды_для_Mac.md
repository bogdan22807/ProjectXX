# Команды для Mac

Все команды ниже выполняются из терминала macOS.

## Проверить версии

```bash
node -v
npm -v
python3 --version
python3 -m pip --version
```

## Установить зависимости backend

```bash
cd backend
npm ci
npm run playwright:install
python3 -m pip install -r requirements-fox.txt
```

## Установить зависимости admin-panel

```bash
cd admin-panel
npm ci
```

## Запустить backend

```bash
cd backend
npm run dev
```

## Запустить admin-panel

```bash
cd admin-panel
npm run dev
```

## Собрать admin-panel

```bash
cd admin-panel
npm run build
```

## Посмотреть preview-сборку admin-panel

```bash
cd admin-panel
npm run preview
```

## Запустить тесты backend

```bash
cd backend
npm test
```

## Установить Playwright Chromium заново

```bash
cd backend
npm run playwright:install
```

## Установить Python-зависимости заново

```bash
cd backend
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements-fox.txt
```

## Проверить backend

Откройте в браузере:

```text
http://localhost:3000/api/health
```

Или используйте:

```bash
curl http://localhost:3000/api/health
```

## Очистить npm-зависимости и поставить заново

Backend:

```bash
cd backend
rm -rf node_modules
npm ci
```

Admin-panel:

```bash
cd admin-panel
rm -rf node_modules
npm ci
```

## Переменные окружения на один запуск

Backend на другом порту:

```bash
cd backend
PORT=3001 npm run dev
```

Admin-panel с явным API:

```bash
cd admin-panel
VITE_API_URL=http://localhost:3000 npm run dev
```
