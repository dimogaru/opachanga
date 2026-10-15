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
# Genera una pareja VAPID y configura las tres variables VAPID_* en tu entorno.
docker compose up --build -d
```

El servicio escucha en el puerto `3000`; el volumen `pachanga-data` mantiene la base SQLite al recrear el contenedor. Configura un proxy inverso con HTTPS y reenvío de `X-Forwarded-Proto` para uso público.

Puedes copiar `.env.example` a `.env` y sustituir los valores localmente. `.env` está excluido de Git; no compartas ni subas la clave privada.

Para crear claves VAPID una sola vez, ejecuta `npm run generate:vapid` y guarda los valores de forma segura en el gestor de secretos del servidor (o en un `.env` local no versionado):

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (por ejemplo, `mailto:admin@tu-dominio`)

El servidor no arranca el envío push si faltan las claves; la interfaz muestra ese estado. La clave privada nunca se envía al navegador. En Replit, configura `VAPID_PRIVATE_KEY` en Secrets y las otras variables en el entorno del proyecto.

## PWA

El manifest declara iconos de 192 y 512 px y una variante maskable. El service worker conserva el shell de la aplicación para abrir la interfaz sin conexión; las llamadas a la API requieren conexión. La instalación se ofrece mediante el botón cuando el navegador admite `beforeinstallprompt`.

## Alcance y seguridad de acceso

La pantalla de entrada selecciona un usuario y mantiene su sesión en una cookie protegida; no solicita contraseña. Es una base de demostración: cualquier visitante podría seleccionar el usuario admin mientras no se integre autenticación real. No expongas el panel a Internet hasta añadir un método de autenticación apropiado.

## Convocatorias y avisos

- El servidor crea una convocatoria semanal para el martes actual y la cierra el lunes siguiente a las 20:00, usando la zona horaria `Europe/Madrid`.
- Los jugadores pueden responder «Sí voy» o «No voy». Los principales que confirman entran en Lista principal; los suplentes, en Lista de suplentes; y las bajas, en Lista NO VAN. El administrador tiene también rol base configurable (principal/suplente), vota y aparece como participante.
- El administrador puede promover a principal a una persona de la lista de suplentes mientras la convocatoria siga abierta. La interfaz indica como válida una lista principal de 14 a 16 personas.
- Con VAPID configurado, se envía automáticamente el aviso de apertura el martes a las 00:05 y un recordatorio el viernes a las 10:00, hora de Madrid. El recordatorio se limita a las suscripciones cuyos usuarios aún no han respondido. El admin también puede disparar manualmente cada campaña.
- Cada dispositivo debe activar los avisos desde el botón de la app. El navegador exige permiso del usuario; instalar la PWA o iniciar sesión no concede ese permiso automáticamente. Las entregas requieren HTTPS y un navegador compatible con Web Push.

La base incluye las tablas `users`, `matches`, `convocations`, `transactions`, `push_subscriptions` y `push_campaigns`. Los módulos de partidos y transacciones siguen sin pantallas propias.
