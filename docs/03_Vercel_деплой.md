# Vercel деплой

Эта инструкция описывает деплой frontend/admin-panel через GitHub и Vercel.

## Что деплоится

На Vercel деплоится frontend из папки:

```text
admin-panel/
```

В корне проекта уже есть файл:

```text
vercel.json
```

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

## Подключение GitHub к Vercel

1. Зайдите в Vercel.
2. Нажмите `Add New...` -> `Project`.
3. Выберите подключение GitHub.
4. Разрешите Vercel доступ к нужному репозиторию.
5. Импортируйте репозиторий проекта.

## Настройки проекта в Vercel

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

## ENV-переменные на Vercel

Для frontend обычно нужна переменная:

```text
VITE_API_URL
```

Она должна указывать на backend API.

Пример формата без реального значения:

```text
VITE_API_URL=https://your-backend-domain.example.com
```

Если значение уже заканчивается на `/api`, frontend использует его как есть.
Если значение без `/api`, frontend добавит `/api` автоматически.

Не добавляйте реальные секреты в документацию или публичный репозиторий.

## Деплой

После импорта проекта:

1. Нажмите `Deploy`.
2. Дождитесь установки зависимостей.
3. Дождитесь команды сборки.
4. Откройте выданный Vercel URL.

## Проверка после деплоя

Откройте frontend на Vercel и проверьте, что он видит backend.

Если frontend открывается, но данные не загружаются:

1. проверьте `VITE_API_URL` в настройках Vercel;
2. проверьте, что backend запущен и доступен из интернета;
3. проверьте, что backend отвечает по `/api/health`;
4. сделайте redeploy после изменения ENV.

## Vercel deployment rate limit

Если Vercel показывает ошибку лимитов:

- подождите и повторите деплой позже;
- не запускайте много деплоев подряд;
- проверьте лимиты вашего аккаунта Vercel;
- отключите лишние автоматические деплои для временных веток, если они не нужны.
