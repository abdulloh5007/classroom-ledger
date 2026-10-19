# Текущий демонстрационный запуск

HTTPS: https://therapeutic-buddy-sandwich-encryption.trycloudflare.com

Это временный Cloudflare Quick Tunnel к локальному production-серверу http://127.0.0.1:3107. Ссылка меняется при новом запуске tunnel. База остаётся в `data/app.db`, бот использует long polling.

Откройте `/login` и введите логин `owner` и пароль из локального `.env`, поле `WEB_PASSWORD`. Пароль и BOT_TOKEN не включены в Git, исходники или ZIP. Публичны только страница входа, её JS/CSS, состояние сессии и `/health`. Ученики и оплаты закрыты серверной сессией. Системного окна Basic Auth больше нет; для выхода используйте кнопку в шапке приложения.

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
