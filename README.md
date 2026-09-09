# DocuViewer — локальный просмотрщик документов

Полностью клиентский веб-просмотрщик документов. **Все файлы обрабатываются прямо в
браузере — ничего не отправляется на сервер.** Сайт можно разместить как статический
(например, на GitHub Pages).

## Возможности

- 🖱️ **Drag-and-drop** крупная зона по центру + кнопка «Выбрать файл».
- 📑 **Несколько файлов во вкладках** — открывайте сколько угодно документов одновременно.
- 🔍 **Поддержка форматов:**
  | Формат | Библиотека | Что умеет |
  |---|---|---|
  | **PDF** | pdf.js | постраничный рендер, зум, поиск по тексту, **панель миниатюр слева**, переход к странице, **полноэкранный режим** |
  | **DOCX** | docx-preview | близкий к оригиналу рендер (стили, заголовки, таблицы, изображения, разрывы страниц), **постраничная навигация**, полноэкранный режим |
  | **XLSX / XLS / CSV** | SheetJS | таблица, переключение листов, копирование CSV |
  | **PPTX** | JSZip | **постраничный просмотр по слайдам** (один слайд на экран), навигация ←/→, клавиатура, **лента миниатюр**, полноэкранный режим |
  | **TXT** | — | текст, перенос строк, нумерация строк, статистика |
  | **Markdown** | markdown-it + highlight.js | рендер с подсветкой кода, режим «Источник/Превью» |
  | **JSON** | — | форматирование с подсветкой синтаксиса, поддержка JSONL |
  | **Изображения** | — | JPG/PNG/GIF/WebP/SVG/BMP, зум, поворот |
  | **RTF** | — | упрощённый парсер с базовым форматированием |
- 🌗 **Светлая/тёмная тема** (авто/ручная).
- 🖥️ **Полноэкранный режим** (Fullscreen API) для PDF, DOCX, PPTX.
- 🧾 **Метаданные файла**: имя, размер, тип (MIME), дата изменения, расширение.
- 📜 **История последних файлов** в localStorage (только в вашем браузере).
- 📱 **Адаптивный дизайн** для мобильных и десктопа.

## ⚠️ Ограничения (важно)

- **Большие файлы** могут обрабатываться медленно — весь парсинг происходит на
  стороне клиента (в потоке браузера).
- **PPTX**: анимации, переходы и точное форматирование не воспроизводятся —
  показывается текст и изображения по слайдам.
- **DOCX**: docx-preview воспроизводит документ близко к MS Word, но отдельные
  сложные элементы (например, оглавление как кликабельные якоря) могут
  отображаться упрощённо. Если при рендере возникли отклонения, показывается
  ненавязчивый значок «Документ отрендерен с возможными отклонениями», а
  подробности логируются в консоль браузера (сырые предупреждения в UI не выводятся).
- **Файлы не сохраняются** после закрытия вкладки (история хранит только метаданные,
  не содержимое).
- Старые бинарные форматы **.doc / .ppt** не поддерживаются — сохраните файл в
  современном OOXML-формате (.docx / .pptx).

---

## Локальный запуск (разработка)

```bash
bun install        # или npm install / yarn
bun run dev        # http://localhost:3000
bun run lint       # проверка качества кода
```

> Проект использует [Bun](https://bun.sh) как пакетный менеджер и раннер, но
> работает и с `npm`/`yarn` — достаточно заменить `bun` на соответствующую команду.

## Сборка статической версии для GitHub Pages

Проект собран на Next.js 16 со статическим экспортом (`output: 'export'`).
Скрипт `build:static` (или `build`) собирает проект в папку `out/`.

```bash
# Пример сборки для репозитория github.com/<user>/my-doc-viewer
STATIC_EXPORT=1 NEXT_PUBLIC_BASE_PATH=/my-doc-viewer bun run build:static
# Результат — папка ./out/, которую можно открыть статически.
```

`NEXT_PUBLIC_BASE_PATH` должен совпадать с именем репозитория на GitHub Pages
(путь вида `/<repo-name>/`).

---

## Развертывание на GitHub Pages (автоматически)

В репозитории уже есть workflow `.github/workflows/deploy.yml`, который:

1. Срабатывает при пуше в ветку `main`.
2. Устанавливает зависимости (`bun install --frozen-lockfile`), вычисляет
   `basePath` по имени репозитория.
3. Собирает статический экспорт (`output: 'export'` → папка `out/`) с правильным
   `NEXT_PUBLIC_BASE_PATH`.
4. Публикует содержимое `out/` в ветку `gh-pages` через
   `peaceiris/actions-gh-pages`.

### Как включить GitHub Pages

1. Запушьте проект в репозиторий на GitHub (ветка `main`).
2. Дождитесь выполнения Actions (вкладка **Actions** — должен загореться зелёным).
   В репозитории автоматически появится ветка `gh-pages`.
3. Откройте **Settings → Pages** в настройках репозитория.
4. В блоке **Build and deployment → Source** выберите **Deploy from a branch**.
5. Выберите ветку **`gh-pages`** и папку **`/ (root)`**, нажмите **Save**.
6. Через минуту сайт будет доступен по адресу:
   `https://<username>.github.io/<repo-name>/`

> Если вы используете кастомный домен, оставьте `NEXT_PUBLIC_BASE_PATH` пустым
> (basePath в `next.config.ts` не нужен).

---

## Папка `release-for-github/` — готовый к загрузке репозиторий

В корне проекта есть папка **`release-for-github/`** — это чистая копия проекта,
готовая к загрузке в новый GitHub-репозиторий. В неё входят только нужные файлы:

```
release-for-github/
├── .github/workflows/deploy.yml   # авто-деплой на GitHub Pages
├── .gitignore                     # исключает node_modules, .next, out, .env и т.д.
├── src/                           # исходный код
├── public/                        # статика (logo, robots)
├── package.json                   # name: docuviewer
├── bun.lock                       # зафиксированные версии зависимостей
├── next.config.ts                 # поддержка output:'export' + basePath
├── tsconfig.json
├── eslint.config.mjs
├── postcss.config.mjs
├── tailwind.config.ts
├── components.json                 # конфиг shadcn/ui
└── README.md                       # этот файл
```

**Что НЕ входит в `release-for-github/`** (создаётся автоматически или является
локальным мусором):
- `node_modules/` — ставится через `bun install`
- `.next/` и `out/` — собираются через `bun run build:static`
- `.env`, `*.log`, `dev.log` — локальные конфиги и логи
- `prisma/`, `db/` — не используются (приложение полностью клиентское)

### Как использовать

```bash
# Вариант 1: новый репозиторий из папки
cd release-for-github
git init
git add .
git commit -m "DocuViewer — client-side document viewer"
git branch -M main
git remote add origin https://github.com/<username>/<repo-name>.git
git push -u origin main

# Вариант 2: скопировать содержимое папки в существующий пустой репозиторий
cp -r release-for-github/. /path/to/your-repo/
cd /path/to/your-repo
git add . && git commit -m "init" && git push
```

После пуша workflow автоматически соберёт и опубликует сайт (см. раздел
«Развертывание на GitHub Pages»).

---

## Технологии

- **Next.js 16** (App Router) + **TypeScript 5** + статический экспорт
- **Tailwind CSS 4** + **shadcn/ui** (New York) + **lucide-react** иконки
- **next-themes** для тёмной/светлой темы
- **zustand** для истории (localStorage)
- Клиентские библиотеки парсинга: `pdfjs-dist`, `docx-preview`, `xlsx`,
  `markdown-it`, `highlight.js`, `jszip`

## Структура

```
src/
  app/
    layout.tsx          # провайдер темы + тоасты + метаданные
    page.tsx             # вся логика: dropzone, вкладки, метаданные, история
    globals.css          # тема + стили prose/markdown/json/pdf/thumbnails
  components/
    drop-zone.tsx        # drag-and-drop + кнопка «Выбрать файл»
    document-tabs.tsx
    file-metadata.tsx
    history-panel.tsx
    url-load-dialog.tsx
    viewer-frame.tsx     # выбор просмотрщика по категории + ErrorBoundary
    theme-provider.tsx
    theme-toggle.tsx
    fullscreen-button.tsx  # кнопка Fullscreen API (общая для всех просмотрщиков)
    viewers/
      pdf-viewer.tsx      # pdf.js + миниатюры + fullscreen
      docx-viewer.tsx     # docx-preview + постраничная навигация + fullscreen
      xlsx-viewer.tsx
      pptx-viewer.tsx     # постраничный просмотр слайдов + лента миниатюр + fullscreen
      text-viewer.tsx
      markdown-viewer.tsx
      json-viewer.tsx
      image-viewer.tsx    # зум + поворот
      rtf-viewer.tsx
  lib/
    viewers/
      types.ts            # FileCategory, LoadedFile, CATEGORY_*
      registry.ts         # lazy dynamic import по категории
    file-utils.ts         # определение формата, formatBytes, object URL
    history.ts            # zustand + localStorage
    use-fullscreen.ts     # хук Fullscreen API (с webkit-фолбэками)
.github/workflows/
  deploy.yml            # сборка + публикация в ветку gh-pages
```

## Приватность

DocuViewer не делает ни одного сетевого запроса с содержимым ваших файлов
(единственный внешний запрос — загрузка воркера pdf.js с CDN для рендеринга
PDF; передаются только код воркера, не данные файла). Все парсинг и рендеринг
происходят локально в браузере.
