# Установка на Mac

Инструкция рассчитана на macOS с Terminal или iTerm2.

## 1. Установить Homebrew

Если Homebrew уже установлен, этот шаг можно пропустить.

Проверка:

```bash
brew --version
```

Если команда не найдена, установите Homebrew с официального сайта:

```text
https://brew.sh/
```

## 2. Установить Node.js и npm

Рекомендуется Node.js 20 LTS или новее.

Через Homebrew:

```bash
brew install node
```

Проверка:

```bash
node --version
npm --version
```

## 3. Установить Python 3 и pip

Рекомендуется Python 3.10 или новее.

```bash
brew install python
```

Проверка:

```bash
python3 --version
python3 -m pip --version
```

## 4. Установить зависимости backend

Из корня проекта:

```bash
cd backend
npm ci
npm run playwright:install
python3 -m pip install -r requirements-fox.txt
```

Если `npm ci` завершился ошибкой, можно использовать:

```bash
npm install
```

## 5. Установить браузеры Playwright

В папке `backend`:

```bash
npm run playwright:install
```

Этот проект устанавливает Chromium для Playwright.

## 6. Установить Python-зависимости backend

В папке `backend`:

```bash
python3 -m pip install -r requirements-fox.txt
```

В `requirements-fox.txt` указаны:

```text
camoufox>=0.4.11
playwright>=1.40.0
```

Если Camoufox попросит скачать браузерные файлы, выполните:

```bash
python3 -m camoufox fetch
```

## 7. Установить зависимости admin-panel

Из корня проекта:

```bash
cd ..
cd admin-panel
npm ci
```

Если `npm ci` завершился ошибкой:

```bash
npm install
```

## 8. Проверить установку

Backend:

```bash
cd backend
npm run dev
```

Admin-panel в другом терминале:

```bash
cd admin-panel
npm run dev
```

