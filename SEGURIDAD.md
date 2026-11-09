# Seguridad y protección de datos — RM Perfiles

## 1. Verificación en dos pasos (app autenticadora) — gratis

Es obligatoria para todos. La primera vez que alguien entra, la app le enseña un QR para darse de alta en Google Authenticator o Microsoft Authenticator. A partir de ahí, cada vez que inicie sesión le pide la contraseña y el código de 6 dígitos.

No usa Identity Platform ni el plan de pago de Firebase: el código lo comprueba la función gratuita de Vercel `api/mfa.js`.
- La clave secreta de cada usuario se guarda en la colección `mfa`, que nadie puede leer desde el navegador.
- Al acertar el código, la sesión queda marcada. Esa marca solo vale para esa sesión: un login nuevo, aunque alguien sepa la contraseña, vuelve a pedir código.
- Cada código sirve una sola vez.
- Tras 5 fallos seguidos, bloquea 15 minutos.

### Ponerla en marcha (una vez)

1. Firebase Console → ⚙️ **Configuración del proyecto** → **Cuentas de servicio** → **Generar nueva clave privada**. Se descarga un `.json`.
   > Esa clave da acceso total al proyecto: no la subas a GitHub ni la envíes por correo.
2. Vercel → tu proyecto → **Settings → Environment Variables** → añade `FIREBASE_SERVICE_ACCOUNT`, con todo el contenido del `.json` como valor, en el entorno **Production**.
3. **Deployments → ⋯ → Redeploy**.
4. Entra en la app: te pedirá escanear el QR. Hazlo y escribe el código.
5. **Después**, publica `firestore.rules` (Firestore → Reglas → Publicar). Esas reglas exigen la doble verificación para leer o escribir datos.

> Mientras falte el paso 2, la app deja entrar con "Continuar sin verificación (temporal)". Queda anotado en el registro de actividad.

La misma clave sirve también para "Redes del club" (apartado 2b).

### Si alguien pierde el móvil

En **Super admin → Usuarios y permisos**, pulsa 🔑 en su columna. Al entrar escaneará un QR nuevo.

Si el que lo pierde es el super admin: Firebase Console → Firestore → colección `mfa` → borra el documento cuyo campo `email` es el tuyo.

## 2. Registro de actividad y cierre por inactividad

- Se anota en la colección `auditoria` cada entrada y salida, cada pantalla o ficha de jugador que se abre y cada creación, modificación o borrado de datos.
- Solo el super admin puede leerlo: **Super admin → Registro de actividad**, con filtros por usuario y acción y exportación a CSV.
- Las reglas impiden modificar o borrar entradas.
- La sesión se cierra sola tras **15 minutos** sin actividad.

## 2b. Horario de acceso y red del club (por usuario)

En **Super admin → Usuarios y permisos**, la columna de cada usuario tiene dos opciones:

- **Limitar horario**: elige los días y la franja (hora de Madrid). Fuera de ella no puede entrar, y si está dentro cuando acaba la franja se le cierra la sesión.
  - Las reglas de Firestore también lo comprueban. No conocen el cambio de hora, así que dan un margen de 1 hora en los bordes.
- **Solo red del club**: solo puede entrar conectado a una red registrada en **Super admin → Redes del club**.

### Poner en marcha "Redes del club" (una vez)

El navegador no puede saber a qué WiFi estás conectado. Por eso se comprueba en un servidor (`api/red.js`, una función de Vercel): ve la IP pública desde la que llega la conexión, y esa IP no se puede falsear.

1–3. Igual que en el apartado 1: la clave `FIREBASE_SERVICE_ACCOUNT` en Vercel y Redeploy (si ya lo hiciste, no hace falta repetirlo).
4. Conéctate a la WiFi del club, entra en la app → **Super admin → Redes del club** → **Registrar la red desde la que estoy**. Repítelo con cada red (otra sede, red por cable…).
5. Marca **Solo red del club** a los usuarios que quieras y pulsa **Guardar cambios**.
6. Publica el `firestore.rules` nuevo.

> Si el club cambia de proveedor de internet o de IP, los usuarios marcados no podrán entrar hasta que vuelvas a registrar la red. Los datos móviles y las WiFi de casa no cuentan como red del club.

## 3. RGPD

- **Aviso de privacidad**: cada usuario lo acepta la primera vez que entra, y queda guardado en `usuarios/{email}.privacidadAceptada`. Se puede volver a leer desde el pie de página.
  - El texto está en `js/seguridad.js` (`AVISO_PRIVACIDAD_HTML`) y es un **borrador**: lo que va entre [corchetes] lo tiene que completar el Delegado de Protección de Datos.
  - Si se cambia, sube `PRIVACIDAD_VERSION` para que todos lo acepten de nuevo.
- **Derecho de acceso**: en la ficha del jugador, en Datos personales, el super admin tiene **⬇ Exportar sus datos**. Descarga un JSON con todo: ficha, histórico, evaluaciones y plantillas.
- **Derecho de supresión**: el botón **Borrar** de un jugador elimina todos sus datos: ficha, foto, histórico, registros de evaluaciones y su sitio en las plantillas.
- **Conservación**: **Super admin → Conservación de datos** lista los jugadores que no están en ninguna plantilla desde hace N temporadas. Se exportan o se borran a mano; nada se borra solo.

## 4. Lo que la app no puede resolver sola

- **Base legal y documentación RGPD**: consentimiento de los padres o tutores, contratos de encargado de tratamiento con Google y Vercel, evaluación de impacto y registro de actividades. Corresponde al DPD.
- **ISO 27001–27005**: es una certificación de la organización (políticas, gestión de riesgos, auditorías), no de una aplicación.
- **VPN**: restringir el acceso a la red del club requiere su infraestructura (alojamiento por IT o lista de IPs permitidas).
- **Cifrado**: ya está cifrado en tránsito (HTTPS) y en reposo (Google, AES-256). Las claves propias del club (CMEK) se configurarían en Google Cloud.
