const webPush = require("web-push");

const keys = webPush.generateVAPIDKeys();
console.log("Guarda estas variables en el entorno del servidor. No las subas al repositorio.");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:admin@opachanga.example");
