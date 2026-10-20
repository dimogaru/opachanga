---
name: Sesión y notificaciones Push
description: Decisiones duraderas sobre persistencia de sesión y reasociación de Push en O Pachanga.
---

La sesión web debe persistir en PostgreSQL y renovarse con actividad para que volver a abrir la PWA no obligue a iniciar sesión. El permiso y la suscripción Push del navegador sobreviven al cierre de sesión; el cierre explícito elimina la asociación en el servidor. Al recuperar una sesión válida, la suscripción existente se vuelve a asociar al usuario actual, sin pedir permiso otra vez.

**Why:** O Pachanga debe reabrirse con la sesión activa, y un dispositivo compartido debe poder cambiar de cuenta sin perder el permiso Push del navegador ni dejar avisos asociados al usuario anterior.

**How to apply:** Mantén el almacén de sesiones persistente, sincroniza Push después de restaurar la sesión y solo solicites permiso en una acción explícita del usuario. En logout borra la fila asociada en PostgreSQL, pero no llames a `PushSubscription.unsubscribe()`.
