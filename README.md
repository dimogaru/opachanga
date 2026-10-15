# O Pachanga

Aplicación web instalable para organizar partidos de fútbol entre amigos. Incluye Express, SQLite (Better-SQLite3), HTML, JavaScript y Tailwind CSS por CDN.

## Requisitos

- Node.js 20 o superior.
- HTTPS en producción para que el navegador permita instalar la PWA y registrar el service worker. Se recomienda terminar HTTPS en un proxy inverso delante de Node.
- Define `SESSION_SECRET` con un valor largo y aleatorio. La aplicación usa un valor de desarrollo solo si no está configurado; no lo uses en producción.

## Ejecución local

```sh
npm install
SESSION_SECRET="cambia-este-valor" npm start
```

Abre `http://localhost:5000`. En el primer inicio se crea el usuario de administración `Admin O Pachanga`; cambia el nombre inicial con `INITIAL_ADMIN_NAME` antes de crear la base de datos. La base se guarda en `data/o-pachanga.sqlite` (o en `DATA_DIR`).

## Docker

```sh
export SESSION_SECRET="$(openssl rand -hex 32)"
docker compose up --build -d
```

El servicio escucha en el puerto `3000`; el volumen `pachanga-data` mantiene la base SQLite al recrear el contenedor. Configura un proxy inverso con HTTPS y reenvío de `X-Forwarded-Proto` para uso público.

## PWA

El manifest declara iconos de 192 y 512 px y una variante maskable. El service worker conserva el shell de la aplicación para abrir la interfaz sin conexión; las llamadas a la API requieren conexión. La instalación se ofrece mediante el botón cuando el navegador admite `beforeinstallprompt`.

## Alcance y seguridad de acceso

La pantalla de entrada selecciona un usuario y mantiene su sesión en una cookie protegida; no solicita contraseña. Es una base de demostración: cualquier visitante podría seleccionar el usuario admin mientras no se integre autenticación real. No expongas el panel a Internet hasta añadir un método de autenticación apropiado.

La base de datos ya contiene las tablas `users`, `matches`, `convocations` y `transactions`. Esta primera entrega implementa la selección de usuario y el panel de administración de jugadores. Las convocatorias, partidos y transacciones aún no tienen pantallas ni endpoints de gestión.
