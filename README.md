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

Abre `http://localhost:5000`. En una instalación nueva se crea el usuario administrador DIMOGARU con rol Admin, activo y sin participación en la competición. Para usar una contraseña inicial propia, configura `INITIAL_ADMIN_PASSWORD` antes del primer arranque. La base se guarda en `data/o-pachanga.sqlite` (o en `DATA_DIR`).

En el workspace de Replit, el primer inicio después de esta migración limpia una sola vez la actividad de pruebas (jugadores, partidos, convocatorias, movimientos, puntos, suscripciones y bote), conserva y configura la cuenta Admin y deja la base lista para una temporada nueva. El marcador de migración evita repetir el borrado en reinicios posteriores; la limpieza no se ejecuta en deployments publicados.

## Jugadores de prueba

Ejecuta `npm run seed` para crear o actualizar los 14 jugadores de prueba y confirmar su respuesta en la convocatoria abierta actual. El comando es manual y no forma parte de `npm start`; también se puede ejecutar directamente con `NODE_ENV=development node scripts/seed.js`. La semilla no borra otros registros: se detiene si detecta jugadores ajenos en las posiciones de ranking 1–14, respuestas de otros jugadores o una convocatoria que ya tenga draft, resultado o actividad financiera. Los cuatro suplentes conservan su rol base y se marcan promovidos en la convocatoria para dejar disponibles los 14 jugadores del draft.

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
- Los jugadores pueden responder «Sí voy» o «No voy». Los principales que confirman entran en Lista principal; los suplentes, en Lista de suplentes; y las bajas, en Lista NO VAN. Admin es un rol exclusivamente administrativo: no puede responder ni aparecer en las listas, los equipos, cobros, saldo de jugador, puntos o clasificación.
- El administrador puede promover a principal a una persona de la lista de suplentes mientras la convocatoria siga abierta. La interfaz indica como válida una lista principal de 14 a 16 personas.
- El panel Admin tiene navegación separada para Convocatoria, Avisos, Finanzas, Partidos y Jugadores. Puede abrir o cerrar la convocatoria; si hay 14–16 principales, al cerrarla designa a los capitanes A y B e inicia automáticamente la elección.
- Con VAPID configurado, se envía automáticamente el aviso de apertura el martes a las 00:05 y el recordatorio el viernes a las 10:00, hora de Madrid. El recordatorio solo incluye a jugadores activos sin respuesta. Desde el centro de avisos, Admin puede disparar apertura, recordatorio, alerta de saldo negativo y aviso individual a un jugador de la Lista Principal. Las campañas grupales excluyen a Admin.
- Promover a un suplente no envía push automáticamente; Admin puede disparar el aviso individual desde la lista principal o el centro de avisos. Las alertas de saldo negativo se limitan a jugadores convocados con saldo negativo.
- Cada dispositivo debe activar los avisos desde el botón de la app. El navegador exige permiso del usuario; instalar la PWA o iniciar sesión no concede ese permiso automáticamente. Las entregas requieren HTTPS y un navegador compatible con Web Push.

## Partidos, saldos y clasificación

- Al cerrarse la convocatoria con entre 14 y 16 principales, Admin designa a los capitanes A y B. El draft comienza automáticamente en el perfil del capitán B; solo el capitán que tiene el turno activo puede elegir desde su cuenta. Alternan hasta que quedan tres; entonces A elige dos seguidos y recibe automáticamente al último. Los capitanes ven la lista confirmada y las elecciones se actualizan mientras el draft está en curso.
- Los partidos se muestran con sus plantillas y resultados. El servidor valida que el draft no duplique jugadores y que cada elección respete el orden de turnos antes de guardar la alineación o permitir el resultado; el capitán A confirma la última elección. Si hay inconsistencias, se bloquea el draft y el cobro y se informa al grupo. Admin puede corregir un resultado ya guardado; al hacerlo, se recalculan los puntos del partido sin duplicarlos.
- En Finanzas, Admin configura el Precio por Partido (coste total de pista/reserva). Al registrar el primer resultado, el sistema divide el precio entre los integrantes de los equipos, redondea la cuota al céntimo superior, descuenta el saldo y registra los movimientos en `transactions`; el sobrante de ese redondeo se suma al bote. Corregir el resultado no vuelve a cobrar.
- Desde Finanzas, Admin ve los saldos de jugadores activos, registra ajustes positivos o negativos con concepto y consulta movimientos recientes. Los cargos de partido incluyen acciones para corregir la cuota individual o devolverla íntegramente: el movimiento original queda marcado como ajustado/devuelto, se crea un nuevo asiento vinculado y el saldo, el bote y el total del partido se actualizan en una transacción. Los cambios directos de saldo desde la ficha del jugador también generan un movimiento de ajuste.
- El día del partido se interpreta como el martes posterior al cierre de convocatoria. La alerta de saldo negativo se programa el lunes a las 10:00 (hora de Madrid), dirigida solo a dispositivos suscritos de usuarios con saldo negativo; el admin también puede enviarla manualmente.
- Al guardar el resultado (Equipo A, Equipo B o empate), cada jugador participante recibe automáticamente +1 por asistencia, +3 adicionales por victoria o +1 adicional por empate. La clasificación suma estos puntos entre partidos.
- La gestión de jugadores permite buscar, crear, editar, reiniciar contraseñas (el jugador debe cambiarlas al entrar) y retirar cuentas. Retirar conserva movimientos y resultados históricos y revoca el acceso.

La base incluye las tablas `users`, `matches`, `convocations`, `transactions`, `push_subscriptions`, `push_campaigns`, `match_finances`, `match_points`, `balance_alert_campaigns` y `app_settings`.
