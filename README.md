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

Abre `http://localhost:5000`. En el primer inicio se crea el usuario administrador DIEGO, con rol de jugador principal y posición de ranking 1. El acceso inicial obliga a cambiar la contraseña. Para usar una contraseña inicial propia, configura `INITIAL_ADMIN_PASSWORD` antes del primer arranque. La base se guarda en `data/o-pachanga.sqlite` (o en `DATA_DIR`).

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

La pantalla de entrada usa alias y contraseña con hashes bcrypt y sesiones protegidas. El registro público crea cuentas pendientes; solo el admin puede activarlas y asignar rol base, posición de ranking y saldo inicial. Usa HTTPS y define `SESSION_SECRET` en producción. Las cuentas de jugadores antiguas sin contraseña quedan pendientes hasta que el titular se registre con el mismo nombre y apellidos y el admin apruebe la solicitud. Configura una contraseña inicial propia en el servidor antes de exponer la cuenta admin.

## Convocatorias y avisos

- El servidor crea una convocatoria semanal para el martes actual y la cierra el lunes siguiente a las 20:00, usando la zona horaria `Europe/Madrid`.
- Los jugadores pueden responder «Sí voy» o «No voy». Los principales que confirman entran en Lista principal; los suplentes, en Lista de suplentes; y las bajas, en Lista NO VAN. El administrador tiene también rol base configurable (principal/suplente), vota y aparece como participante.
- El administrador puede promover a principal a una persona de la lista de suplentes mientras la convocatoria siga abierta. La interfaz indica como válida una lista principal de 14 a 16 personas.
- Con VAPID configurado, se envía automáticamente el aviso de apertura el martes a las 00:05 y un recordatorio el viernes a las 10:00, hora de Madrid. El recordatorio se limita a las suscripciones cuyos usuarios aún no han respondido. El admin también puede disparar manualmente cada campaña.
- Al promocionar a un suplente, el servidor envía una notificación individual a sus dispositivos suscritos. Las campañas de apertura se limitan a cuentas activas; las alertas de saldo negativo se envían a jugadores activos con saldo negativo que hayan confirmado asistencia.
- Cada dispositivo debe activar los avisos desde el botón de la app. El navegador exige permiso del usuario; instalar la PWA o iniciar sesión no concede ese permiso automáticamente. Las entregas requieren HTTPS y un navegador compatible con Web Push.

## Partidos, saldos y clasificación

- Al cerrarse la convocatoria, el admin puede iniciar el draft si hay entre 14 y 16 principales confirmados. El ranking #1 queda en el Equipo A y el #2 en el B; empieza el #2 y se alternan las elecciones hasta tres disponibles. Entonces el #1 elige dos seguidos y recibe automáticamente al último.
- Los partidos se muestran con sus plantillas y resultados. Para administrar el draft, cobro y resultado se selecciona el partido en el panel.
- El admin introduce el coste de pista y el importe cobrado a cada jugador. Se debita ese importe a cada integrante de los equipos, se registra el movimiento en `transactions` y la diferencia entre el total cobrado y la pista se acumula en el bote. El cobro se registra una sola vez por partido y el total debe cubrir la pista.
- El día del partido se interpreta como el martes posterior al cierre de convocatoria. La alerta de saldo negativo se programa el lunes a las 10:00 (hora de Madrid), dirigida solo a dispositivos suscritos de usuarios con saldo negativo; el admin también puede enviarla manualmente.
- Al guardar el resultado (Equipo A, Equipo B o empate), cada jugador participante recibe automáticamente +1 por asistencia, +3 adicionales por victoria o +1 adicional por empate. La clasificación suma estos puntos entre partidos.

La base incluye las tablas `users`, `matches`, `convocations`, `transactions`, `push_subscriptions`, `push_campaigns`, `match_finances`, `match_points`, `balance_alert_campaigns` y `app_settings`.
