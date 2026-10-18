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

Abre `http://localhost:3000` (Replit configura el puerto 5000 para su vista previa). En una instalación nueva se crea el usuario administrador DIMOGARU con rol Admin, activo y sin participación en la competición. Para usar una contraseña inicial propia, configura `INITIAL_ADMIN_PASSWORD` antes del primer arranque. La base se guarda en `data/o-pachanga.sqlite`; `DB_PATH` permite indicar una ruta de archivo completa y tiene prioridad sobre `DATA_DIR`. El directorio padre se crea automáticamente.

Al arrancar, el servidor crea las tablas e índices que falten con `IF NOT EXISTS`; no elimina ni reinicia registros existentes. Las migraciones de esquema conservan las filas y solo completan columnas nuevas que estaban vacías.

## Jugadores de prueba

Ejecuta `npm run seed` para crear o actualizar los 14 jugadores de prueba. El comando es manual y no forma parte de `npm start`; también se puede ejecutar directamente con `NODE_ENV=development node scripts/seed.js`. La semilla no abre convocatorias ni registra respuestas: Admin debe abrirlas manualmente y asignar la fecha del partido. No borra otros registros y se detiene si las posiciones de ranking 1–14 ya pertenecen a otros jugadores activos.

## Docker

```sh
cp .env.example .env
export SESSION_SECRET="$(openssl rand -hex 32)"
# Edita .env para usar las claves VAPID generadas con npm run generate:vapid.
docker compose up --build -d
```

La imagen usa Node.js 20; compila `better-sqlite3` en una etapa separada y mantiene el contenedor final sin herramientas de compilación. El servicio escucha en `PORT` (3000 por defecto); el volumen `pachanga-data` mantiene `/app/data` al recrear el contenedor. Para Coolify, monta un volumen persistente en `/app/data` y expón el mismo puerto configurado en `PORT`. Configura un proxy inverso con HTTPS y reenvío de `X-Forwarded-Proto` para uso público.

Puedes copiar `.env.example` a `.env` y sustituir los valores localmente. `.env` está excluido de Git; no compartas ni subas la clave privada.

Para crear claves VAPID una sola vez, ejecuta `npm run generate:vapid` y guarda los valores de forma segura en el gestor de secretos del servidor (o en un `.env` local no versionado):

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (por ejemplo, `mailto:admin@tu-dominio`)

También se aceptan los alias `PUBLIC_VAPID_KEY`, `PRIVATE_VAPID_KEY` y `VAPID_EMAIL`.

El servidor no arranca el envío push si faltan las claves; la interfaz muestra ese estado. La clave privada nunca se envía al navegador. En Replit, configura `VAPID_PRIVATE_KEY` en Secrets y las otras variables en el entorno del proyecto.

## PWA

El manifest declara iconos de 192 y 512 px y una variante maskable. El service worker conserva el shell de la aplicación para abrir la interfaz sin conexión; las llamadas a la API requieren conexión. La instalación se ofrece mediante el botón cuando el navegador admite `beforeinstallprompt`.

## Alcance y seguridad de acceso

La pantalla de entrada usa alias y contraseña con hashes bcrypt y sesiones protegidas. El registro público crea cuentas pendientes; solo el admin puede activarlas y asignar rol base, posición de ranking y saldo inicial. Usa HTTPS y define `SESSION_SECRET` en producción. Las cuentas de jugadores antiguas sin contraseña quedan pendientes hasta que el titular se registre con el mismo nombre y apellidos y el admin apruebe la solicitud. Configura una contraseña inicial propia en el servidor antes de exponer la cuenta admin.

## Convocatorias y avisos

- Admin abre y cierra cada convocatoria manualmente; no hay cron ni proceso que cambie esos estados. Al abrirla, selecciona la fecha exacta del partido y, opcionalmente, la hora (por defecto, 20:00). La fecha y hora se guardan en `matches.match_date` y `matches.match_time`; la respuesta se solicita hasta las 20:00 de ese día.
- Los jugadores pueden responder «Sí voy» o «No voy». Los principales que confirman entran en Lista principal; los suplentes, en Lista de suplentes; y las bajas, en Lista NO VAN. Mientras esté abierta, cualquier jugador activo puede añadir un suplente registrado que aún no haya respondido o crear una cuenta activa nueva con rol Suplente; su contraseña inicial compartida debe cambiarse al iniciar sesión. La lista muestra entre paréntesis el alias de quien lo añadió.
- Solo Admin puede promover a principal a alguien de la lista de suplentes mientras la convocatoria siga abierta. La interfaz indica como válida una lista principal de exactamente 14 o 16 personas.
- Si hay menos de 14 principales, Admin puede cancelar la convocatoria abierta o cerrada. Queda registrada como `cancelled`, se muestra un aviso destacado a los jugadores y se envía Web Push a sus dispositivos suscritos cuando VAPID está activo. Un evento cancelado no admite resultado, cobro ni puntos.
- El panel Admin tiene navegación separada para Convocatoria, Avisos, Finanzas, Partidos y Jugadores. Puede abrir o cerrar la convocatoria; con 14 o 16 principales, al cerrarla designa a los capitanes A y B e inicia automáticamente la elección. Con 15 no se inicia el draft porque no se pueden repartir en partes iguales.
- La pestaña Convocatoria permite consultar jornadas anteriores por fecha. El historial conserva listas respondidas, equipos, capitanes, resultado y cobro; las jornadas anteriores son de solo lectura. Tras finalizar el partido, Admin puede abrir la siguiente convocatoria y elegir su fecha. La creación es idempotente para evitar jornadas duplicadas.
- Al abrir una jornada nueva, el grupo recibe un aviso de apertura Web Push cuando VAPID está configurado. Los jugadores empiezan con la respuesta pendiente y el registro de la nueva jornada no modifica respuestas, equipos ni finanzas de partidos anteriores.
- Al abrir o reabrir manualmente una convocatoria, se envía el aviso de apertura a los dispositivos suscritos si VAPID está configurado. El recordatorio de respuestas sigue programado para el viernes a las 10:00, hora de Madrid, y solo incluye a jugadores activos sin respuesta. La alerta de saldo negativo se programa diariamente a las 10:00 para partidos que se disputan al día siguiente. Desde el centro de avisos, Admin puede disparar manualmente el recordatorio, la alerta de saldo negativo y el aviso individual a un jugador de la Lista Principal. Las campañas grupales excluyen a Admin.
- Promover a un suplente no envía push automáticamente; Admin puede disparar el aviso individual desde la lista principal o el centro de avisos. Las alertas de saldo negativo se limitan a jugadores convocados con saldo negativo.
- Cada dispositivo debe activar los avisos desde el botón de la app. El navegador exige permiso del usuario; instalar la PWA o iniciar sesión no concede ese permiso automáticamente. Las entregas requieren HTTPS y un navegador compatible con Web Push.

## Partidos, saldos y clasificación

- Al cerrarse la convocatoria con 14 o 16 principales, Admin designa a los capitanes A y B. El draft comienza automáticamente en el perfil del capitán B; solo el capitán que tiene el turno activo puede elegir desde su cuenta. Alternan hasta que quedan tres; entonces A elige dos seguidos y el último se asigna automáticamente a B. Así se completan 7 contra 7 o 8 contra 8. Los capitanes ven la lista confirmada y las elecciones se actualizan mientras el draft está en curso.
- Los partidos se muestran con sus plantillas y resultados. El servidor valida que el draft no duplique jugadores, respete los turnos y no exceda la mitad del roster en ningún equipo; el capitán A confirma la última elección manual. Si hay inconsistencias, se bloquea el draft y el cobro y se informa al grupo. Admin puede corregir un resultado ya guardado; al hacerlo, se recalculan los puntos del partido sin duplicarlos.
- En Finanzas, Admin configura el Precio por Partido (coste total de pista/reserva). Al registrar el primer resultado, el sistema divide el precio entre los integrantes de los equipos, redondea la cuota al céntimo superior, descuenta el saldo y registra los movimientos en `transactions`; el sobrante de ese redondeo se suma al bote. Corregir el resultado no vuelve a cobrar.
- Desde Finanzas, Admin ve los saldos de jugadores activos, registra ajustes positivos o negativos con concepto y consulta movimientos recientes. Los cargos de partido incluyen acciones para corregir la cuota individual o devolverla íntegramente: el movimiento original queda marcado como ajustado/devuelto, se crea un nuevo asiento vinculado y el saldo, el bote y el total del partido se actualizan en una transacción. Los cambios directos de saldo desde la ficha del jugador también generan un movimiento de ajuste.
- La fecha del partido es la seleccionada por Admin, no una fecha calculada desde el cierre. La alerta de saldo negativo se dirige solo a dispositivos suscritos de jugadores convocados con saldo negativo.
- Al guardar el resultado (Equipo A, Equipo B o empate), cada jugador participante recibe automáticamente +1 por asistencia, +3 adicionales por victoria o +1 adicional por empate. La clasificación suma estos puntos entre partidos.
- En «Partidos», Admin puede modificar los totales de clasificación por alias y debe indicar el motivo. El servidor guarda únicamente las diferencias en `standing_adjustments`, recalcula y ordena la tabla al instante y no modifica `match_points` ni los historiales de partidos. Las sesiones de jugadores actualizan la clasificación mediante consulta periódica.
- La gestión de jugadores permite buscar, crear, editar, reiniciar contraseñas (el jugador debe cambiarlas al entrar) y retirar cuentas. Retirar conserva movimientos y resultados históricos y revoca el acceso.

La base incluye las tablas `users`, `matches`, `convocations`, `transactions`, `push_subscriptions`, `push_campaigns`, `match_finances`, `match_points`, `balance_alert_campaigns` y `app_settings`.
