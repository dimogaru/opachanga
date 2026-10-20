---
name: Publicación en GitHub
description: Verificación de commits locales y publicación en la rama remota de O Pachanga.
---

No afirmar que un cambio está publicado hasta comprobar que `origin/main` o el SHA remoto avanzó al commit enviado. Un `git commit` puede completarse aunque `git push` sea rechazado por falta de autorización; una integración que aparezca como no conectada no debe tratarse como una alternativa ya funcional.

**Why:** en este entorno el commit local se creó, pero GitHub rechazó la autenticación y la conexión de integración no llegó a estar disponible.

**How to apply:** tras publicar, confirmar el SHA remoto. Si no hay autorización, conservar el commit local y comunicar claramente que el push sigue pendiente, sin pedir ni exponer credenciales.
