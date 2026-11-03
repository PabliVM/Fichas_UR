# Seguridad y protección de datos — RM Perfiles

## 1. Verificación en dos pasos (app autenticadora)

Es obligatoria para todos. La primera vez que alguien entra, la app le enseña un QR para darse de alta en Google Authenticator o Microsoft Authenticator. A partir de ahí, cada vez que entre le pide la contraseña y el código de 6 dígitos.

### Activarla en Firebase (una sola vez)

1. Firebase Console → **Authentication** → **Settings** → **Upgrade** a *Firebase Authentication with Identity Platform*. Puede pedir activar la facturación (plan Blaze); con pocos usuarios no tiene coste.
2. Abre **Google Cloud Shell** (https://shell.cloud.google.com) con tu cuenta y pega este comando:

```bash
curl -X PATCH "https://identitytoolkit.googleapis.com/admin/v2/projects/fichasur-f9d61/config?updateMask=mfa" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -H "X-Goog-User-Project: fichasur-f9d61" \
  -d '{"mfa":{"state":"ENABLED","providerConfigs":[{"state":"ENABLED","totpProviderConfig":{"adjacentIntervals":5}}]}}'
```

3. Entra en la app: te pedirá dar de alta el autenticador.
4. **Después**, publica `firestore.rules` (Firestore → Reglas → Publicar). Esas reglas exigen la doble verificación para leer o escribir datos.

> Mientras no esté activada en Firebase, la app deja entrar con el botón "Continuar sin verificación (temporal)". Queda anotado en el registro de actividad como `entrada sin doble factor`.

### Si alguien pierde el móvil

Firebase Console → Authentication → Users → borra su cuenta y vuelve a crearla con el mismo email (Add user). Después, en Super admin, pulsa ✉ en su columna para que ponga una contraseña nueva. Sus permisos se conservan, porque van por email. Al entrar dará de alta el autenticador otra vez.

## 2. Registro de actividad y cierre por inactividad

- Se anota en la colección `auditoria` cada entrada y salida, cada pantalla o ficha de jugador que se abre y cada creación, modificación o borrado de datos.
- Solo el super admin puede leerlo: **Super admin → Registro de actividad**, con filtros por usuario y acción y exportación a CSV.
- Las reglas impiden modificar o borrar entradas.
- La sesión se cierra sola tras **15 minutos** sin actividad.

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
