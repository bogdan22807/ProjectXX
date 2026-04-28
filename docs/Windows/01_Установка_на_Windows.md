# Установка на Windows

Инструкция подходит для Windows 10/11.

Рекомендуется использовать PowerShell.

## 1. Установить Node.js и npm

Скачайте Node.js LTS с официального сайта:

```text
https://nodejs.org/
```

Рекомендуется Node.js 20 LTS или новее.

После установки откройте новый PowerShell и проверьте:

```powershell
node -v
npm -v
```

## 2. Установить Python 3 и pip

Скачайте Python с официального сайта:

```text
https://www.python.org/downloads/windows/
```

Во время установки включите опцию:

```text
Add python.exe to PATH
```

Проверка:

```powershell
python --version
python -m pip --version
```

Если команда `python` не работает, попробуйте:

```powershell
py --version
py -m pip --version
```

## 3. Установить зависимости backend

Из корня проекта:

```powershell
cd backend
npm ci
```

Если `npm ci` не работает:

```powershell
npm install
```

## 4. Установить Playwright browser dependencies

В папке `backend`:

```powershell
npm run playwright:install
```

Скрипт устанавливает Chromium для Playwright.

Если Playwright просит установить системные зависимости, выполните команду из текста ошибки. На Windows обычно достаточно установки браузера через `playwright install`.

## 5. Установить Python-зависимости backend

В папке `backend`:

```powershell
python -m pip install -r requirements-fox.txt
```

Если используется команда `py`:

```powershell
py -m pip install -r requirements-fox.txt
```

В `requirements-fox.txt` указано:

```text
camoufox>=0.4.11
playwright>=1.40.0
```

Если нужен Camoufox browser fetch:

```powershell
camoufox fetch
```

## 6. Установить зависимости admin-panel

Из корня проекта:

```powershell
cd ..
cd admin-panel
npm ci
```

Если `npm ci` не работает:

```powershell
npm install
```

## 7. Проверить установку

Backend:

```powershell
cd backend
npm run dev
```

Admin-panel:

```powershell
cd ..
cd admin-panel
npm run dev
```

