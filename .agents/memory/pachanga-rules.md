---
name: Reglas de O Pachanga
description: Reglas de negocio semanales para convocatorias, equipos, cobros y clasificación.
---

**Regla:** Admin abre y cierra cada convocatoria manualmente; no hay procesos automáticos que cambien esos estados. Al abrir una jornada, Admin debe elegir la fecha exacta y opcionalmente la hora del partido (20:00 por defecto), guardadas en `match_date` y `match_time`; los jugadores ven la fecha y hora en español y reciben el aviso de responder antes de las 20:00 del día del partido. Si la lista principal tiene menos de 14 personas, Admin puede cancelar la convocatoria abierta o cerrada antes del draft; el evento queda en estado `cancelled`, se avisa a todos los jugadores en la PWA/Web Push y no genera cargos ni puntos. Admin es exclusivamente administrativo: no vota, no aparece en las listas, no entra en el draft, no tiene saldo de jugador ni participa en cobros, puntos o clasificación. El draft solo admite 14 o 16 principales para formar equipos iguales. Al cerrar, Admin designa manualmente los capitanes A y B; empieza B y se alternan hasta que queden tres, entonces A elige dos seguidos y el último se asigna automáticamente a B. Solo los capitanes designados eligen desde sus cuentas; el backend valida turnos, roster, asignación automática y equilibrio antes de confirmar. En listas de convocatoria, draft, equipos y clasificación, identifica jugadores únicamente por alias. Las jornadas pasadas se consultan sin modificar sus listas, equipos, capitanes, resultados ni cobros; al finalizar una jornada jugada o cancelada, Admin puede abrir otra convocatoria y sus respuestas empiezan vacías. Admin fija el precio total por partido; al guardar el primer resultado se divide entre los jugadores de los equipos, se redondea la cuota hacia arriba al céntimo y el sobrante va al bote. Cada partido se cobra una sola vez. Corregir o devolver cargos conserva el asiento original, añade un asiento de ajuste y actualiza saldo y bote. Asistencia da +1, victoria suma +3, empate +1 y derrota no suma extra. Retirar un jugador es una baja lógica: deja de aparecer en listas activas, pero conserva su historial financiero y deportivo.

**Why:** el usuario especificó que la apertura y el cierre son manuales, que Admin elige fecha/hora y que una convocatoria con menos de 14 principales puede cancelarse sin actividad financiera ni deportiva. El reparto equilibrado, la conservación del historial y el uso de alias también responden a reglas explícitas del producto.

**How to apply:** exigir acciones de Admin para abrir/cerrar, requerir fecha y usar la hora por defecto a menos que Admin indique otra; mostrar los valores en PWA y avisos. Permitir cancelación solo bajo el umbral de 14, impedir cobros/resultados/puntos y conservar el evento para el historial. No inferir ni cambiar estados por cron. Exigir 14 o 16 participantes para un draft equilibrado, asignar automáticamente al último a B y recalcular puntos si se corrige una alineación histórica. Al crear una jornada, no copiar respuestas ni alterar el historial anterior. Preservar estas condiciones en convocatorias, cobros, notificaciones y clasificación; no habilitar picks para Admin ni duplicar cobros, y no mostrar nombres reales en las vistas públicas indicadas.

**Clasificación manual:** Admin puede definir totales nuevos de puntos, partidos jugados, victorias, empates y derrotas, con un motivo obligatorio. El sistema registra las diferencias como ajustes auditables, recalcula el orden público y conserva sin cambios los resultados y puntos asociados a partidos finalizados. Partidos jugados debe ser igual a victorias + empates + derrotas.

**Why:** el usuario pidió corregir manualmente la clasificación sin alterar historiales individuales de partidos.

**How to apply:** tratar los valores del formulario como totales deseados, calcular y guardar diferencias acumuladas, identificar jugadores por alias y proteger lectura de auditoría/escritura según rol Admin; las nuevas puntuaciones de partidos deben seguir sumándose sobre esos ajustes.

**Arranque de SQLite:** crear las tablas e índices requeridos con `IF NOT EXISTS`, localizar la base mediante `DB_PATH` y no ejecutar limpiezas automáticas ni restablecer saldos o cuentas al iniciar una base existente. Las migraciones pueden completar columnas nuevas vacías, pero deben preservar las filas y valores existentes.

**Why:** el usuario pidió un arranque idempotente que nunca borre ni sobrescriba los datos del archivo SQLite existente.

**How to apply:** mantener los reinicios de pruebas fuera del arranque de producción y de Replit; limitar la inicialización a crear el esquema, añadir columnas necesarias y crear el Admin solo si falta.

**Alta y retirada de suplentes:** cualquier jugador activo puede añadir a la convocatoria abierta una cuenta de suplente sin respuesta o crear una cuenta activa nueva de rol suplente; se conserva quién lo invitó y su alias se muestra junto al suplente en las listas activas e históricas. En una convocatoria abierta, quien añadió al suplente puede retirarlo; Admin puede retirar cualquier suplente. Solo Admin puede promover de suplente a principal. Las cuentas nuevas usan la contraseña inicial compartida y deben cambiarla en su primer acceso.

**Why:** el usuario definió los permisos de alta, retirada y promoción para convocatorias; exigir el cambio de la contraseña compartida reduce el riesgo de que la credencial inicial siga en uso.

**How to apply:** validar en backend el estado abierto, la disponibilidad y unicidad del alias; crear/inscribir la cuenta en una transacción, asignar ranking al final y guardar el ID del invitador. Para retirar, autorizar por ID de usuario invitador o rol Admin, mostrar el control solo a quien pueda usarlo y mantener la promoción detrás de `requireAdmin`.

## Fotos de perfil

**Regla:** Las fotos de perfil se comprimen en el navegador y se guardan como data URL en la base activa, con un límite de 256 KB por imagen; el selector acepta archivos de galería/dispositivo y no fuerza la cámara. Las respuestas de listas no incluyen estos datos; se consultan al abrir la ficha. Cada jugador puede editar su propia foto y sus datos técnicos (puntos fuertes, puntos débiles, posición y otros datos), pero no su alias. Solo Admin puede editar los datos técnicos y el alias de cualquier jugador.

**Why:** La app está pensada para un grupo pequeño en un servidor propio. Guardar imágenes pequeñas en la misma base evita añadir un directorio de medios y dependencias de almacenamiento que también habría que respaldar.

**How to apply:** Mantener la compresión y validación estricta de tipo y tamaño; limitar las escrituras del jugador a su propio perfil y campos permitidos tanto en la UI como en el backend. Proteger cambios de alias y perfiles ajenos con rol Admin; si el tamaño de la plantilla crece de forma sustancial, migrar las fotos a un almacenamiento persistente y mantener solo la URL/ruta en PostgreSQL.

## Caché de la PWA

**Regla:** Los recursos y páginas del mismo origen se consultan primero en la red y usan caché solo como respaldo offline. Las rutas `/api/` quedan fuera de caché para no conservar respuestas autenticadas del usuario.

**Why:** El usuario quiere que los despliegues actualicen la PWA automáticamente; mantener datos de cuenta o convocatoria en caché podría exponer información obsoleta en un dispositivo compartido.

**How to apply:** Versionar la caché al cambiar el shell, borrar cachés antiguas en `activate`, activar el nuevo Service Worker con `skipWaiting`/`clients.claim` y recargar al cambiar el controlador. Conservar Network First para contenido estático y navegación; no cachear respuestas privadas de API.
