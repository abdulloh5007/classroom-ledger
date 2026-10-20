# Текущий демонстрационный запуск

HTTPS: https://therapeutic-buddy-sandwich-encryption.trycloudflare.com

Это временный Cloudflare Quick Tunnel к локальному production-серверу http://127.0.0.1:3107. Ссылка меняется при новом запуске tunnel. База остаётся в `data/app.db`, бот использует long polling.

Откройте `/login` и введите логин и пароль из локального `.env`, поля `WEB_USERNAME` и `WEB_PASSWORD`. Пароль и BOT_TOKEN не включены в Git, исходники или ZIP. Страницы `/login`, `/about`, их JS/CSS, состояние сессии и `/health` публичны. Ученики и оплаты закрыты серверной сессией. Системного окна Basic Auth больше нет; кнопка выхода временно скрыта, серверный POST /auth/logout по-прежнему отзывает сессию. Открытый доступ к исходникам на GitHub не открывает финансовые API и не публикует рабочую базу.

Проверить свои сервисы:

```bash
systemctl --user status ecomdev-ledger ecomdev-ledger-tunnel
journalctl --user -u ecomdev-ledger -n 30
journalctl --user -u ecomdev-ledger-tunnel -n 30
```

После изменений кода:

```bash
npm run build
systemctl --user restart ecomdev-ledger
```

Закрыть только внешний доступ:

```bash
systemctl --user stop ecomdev-ledger-tunnel
```

Остановить приложение и бота:

```bash
systemctl --user stop ecomdev-ledger
```

Это пользовательские transient services текущей машины. Они независимы от сессии команд Codex; установка постоянных unit-файлов и автоматический старт после перезагрузки не настраивались. Перед ручным `npm run dev` остановите свой сервис приложения, чтобы не запустить второй polling с тем же токеном.

## Проверка сообщения об ошибке 530

При проверке после сообщения пользователя локальный `/health` и публичный `/login` отвечали 200. В логах cloudflared обнаружены разрывы edge-соединения с последующей успешной регистрацией. Ошибка в этот момент не воспроизвелась, поэтому её точная причина не подтверждена; постоянная доступность Quick Tunnel не заявляется. По [документации Cloudflare](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-530/) 530 относится к проблеме разрешения origin; [диагностика Tunnel](https://developers.cloudflare.com/tunnel/troubleshooting/) отдельно описывает отсутствие доступного connector.

В клиент добавлены ограниченные повторы запросов чтения при 502/503/504/530 и сетевых ошибках. Запись оплаты не повторяется автоматически. Это помогает пережить краткий обрыв уже открытого приложения, но не исправляет DNS или недоступность самой страницы на стороне Cloudflare. Для постоянного размещения нужен управляемый tunnel/домен и мониторинг; текущая временная ссылка сохранена.
