---
name: Reglas de O Pachanga
description: Reglas de negocio semanales para convocatorias, equipos, cobros y clasificación.
---

**Regla:** La convocatoria empieza el martes y cierra el lunes siguiente a las 20:00 (Europe/Madrid). Admin es exclusivamente administrativo: no vota, no aparece en las listas, no entra en el draft, no tiene saldo de jugador ni participa en cobros, puntos o clasificación. Solo se considera apta para jugar con 14–16 principales. Al cerrar, Admin designa manualmente los capitanes A y B; empieza B y se alternan hasta que queden tres, entonces A elige dos seguidos y recibe al último. Solo los capitanes designados eligen desde sus cuentas; el backend valida turnos, lista y alineación antes de confirmar. En listas de convocatoria, draft, equipos y clasificación, identifica jugadores únicamente por alias. Admin fija el precio total por partido; al guardar el primer resultado se divide entre los jugadores de los equipos, se redondea la cuota hacia arriba al céntimo y el sobrante va al bote. Cada partido se cobra una sola vez. Corregir o devolver cargos conserva el asiento original, añade un asiento de ajuste y actualiza saldo y bote. Asistencia da +1, victoria suma +3, empate +1 y derrota no suma extra. Retirar un jugador es una baja lógica: deja de aparecer en listas activas, pero conserva su historial financiero y deportivo.

**Why:** el usuario definió y después actualizó las reglas de negocio; la baja lógica mantiene trazabilidad financiera y deportiva sin mantener el acceso del jugador. También pidió que las vistas públicas identifiquen jugadores solo con su alias.

**How to apply:** preservar estas condiciones al modificar convocatorias, elección de capitanes, cobro automático, notificaciones o clasificación; no habilitar picks para el Admin ni duplicar el cobro al corregir un resultado. No mostrar nombres reales en las vistas públicas indicadas.
