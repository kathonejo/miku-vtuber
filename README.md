# Miku VTuber

Avatar **VTuber** en el navegador: una idol anime **original**, dibujada con Canvas 2D y animada con tu cámara. La interfaz está en español.

El personaje es un diseño propio inspirado en el estilo de las idols virtuales (coleta teal, auriculares, escenario). **No** usa modelos, texturas ni ilustraciones con copyright: todo el cuerpo se dibuja por código.

## Qué puedes hacer

- Seguir la **cabeza** (giro, inclinación y rotación), el **parpadeo**, la **mirada**, la **boca**, las **cejas** y los **brazos**.
- Modo **espejo**: si levantas la mano derecha, se mueve el brazo del mismo lado de la pantalla. La vista previa de la webcam también va en espejo.
- **Modo demo** sin cámara: el avatar respira, se balancea, parpadea solo y la cabeza sigue al ratón.
- Cinco atuendos distintos (clásico, casual, idol, invierno y marinera), cinco paletas, peinados y accesorios.
- Fondos de escenario, habitación, noche, croma verde `#00FF00`, croma azul `#0000FF` y fondo transparente para la captura PNG.
- Guardado automático en `localStorage`, botón **Guardar**, **Restablecer**, **Aleatorio** y **Captura**.
- **Pantalla completa / Modo stream**: oculta la interfaz y deja solo el lienzo, útil para capturarlo en OBS.

El vídeo de la cámara **no se envía a ningún servidor**. El seguimiento corre en tu navegador. Los modelos de MediaPipe se descargan de Google y el runtime WASM, de jsDelivr, la primera vez que activas la cámara.

## Requisitos

- Node.js reciente
- Un navegador con `getUserMedia` en un contexto seguro (`https` o `localhost`) para usar la cámara

## Uso

```bash
npm install
npm run dev
```

Abre la dirección que muestra Vite. Pulsa **Activar cámara** y acepta el permiso. Si no hay cámara, entra en **Continuar en modo demo**.

Para generar el sitio estático en `dist/`:

```bash
npm run build
npm run preview
```

## Seguimiento

Se usa `@mediapipe/tasks-vision` (versión 1.1.0):

- `FaceLandmarker` (modelo float16) con blendshapes y matriz de transformación facial
- `PoseLandmarker` lite para hombros, codos y muñecas
- WASM desde `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm`
- Si el delegado GPU falla al crear los modelos, se reintenta en CPU

Los puntos con visibilidad menor a 0,5 se ignoran y el brazo vuelve con suavidad a la pose de reposo. Todos los valores se suavizan con una interpolación exponencial para evitar el temblor.

## Atajos

- **Esc** sale del modo stream
- El panel **Personalizar** se puede cerrar; en pantallas estrechas aparece como hoja inferior

## Aviso

Proyecto de fan, sin afiliación con Hatsune Miku, Crypton Future Media ni otros titulares. El personaje de esta app es un diseño original.
