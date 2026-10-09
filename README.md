# Bunny VTuber

Marioneta **VTuber** de papel en el navegador. El dibujo de una chica conejo, recortado en láminas, copia tu cabeza, tus ojos, tu boca y tus brazos. Todo se dibuja con Canvas 2D, al estilo de las hojas planas de PaRappa the Rapper: giro de cartulina, rebote, aleteo de boca y una sombra bajo cada recorte. La interfaz está en español.

## Qué puedes hacer

- Seguir la **cabeza** (giro, inclinación y rotación), el **parpadeo** (también guiños), la **mirada**, la **boca** por visemas y los **brazos** (hombros y muñecas).
- **Calibrar** la pose neutra con el botón Calibrar, o de forma automática durante el primer segundo y medio de cámara.
- Modo **espejo** (activo por defecto): el avatar se mueve como un espejo. La vista previa de la webcam también.
- **Modo demo** sin cámara: la marioneta respira, se balancea y parpadea sola. El ratón mueve la cabeza y la mirada; mantener pulsado abre la boca.
- Estilos de color (Original, Menta, Atardecer, Lavanda, Algodón, Papel, Neón), accesorios dibujados a rotulador y varios fondos, incluidos croma verde `#00ff00` y croma azul `#0000ff`.
- Sombra de papel, grosor de cartulina y rebote, cada uno con su interruptor.
- Guardado en `localStorage` (`bunny-vtuber-settings-v1`), botones **Guardar**, **Restablecer**, **Aleatorio** y **Captura** (PNG del lienzo).
- **Modo stream**: oculta la interfaz para capturar el lienzo en OBS.

## Controles

- **H** oculta o muestra la interfaz.
- **Doble clic** en el escenario la devuelve cuando está oculta.
- **Espacio** hace un salto (aplastar, estirar y aterrizar).
- **Esc** sale del modo stream.

## Privacidad

El vídeo de la cámara **no se envía a ningún servidor** y no sale de este dispositivo. El seguimiento corre en el navegador. Los modelos de MediaPipe se descargan de Google y el runtime WASM, de jsDelivr, la primera vez que se prepara la cámara.

## Requisitos

- Node.js reciente
- Un navegador con `getUserMedia` en un contexto seguro (`https` o `localhost`) para usar la cámara

## Uso

```bash
npm install
npm run dev
```

Abre la dirección que muestra Vite. Pulsa **Activar cámara** y acepta el permiso, o entra con **Continuar en modo demo**.

Para generar el sitio estático en `dist/`:

```bash
npm run build
npm run preview
```

## Seguimiento

Se usa `@mediapipe/tasks-vision` (versión 1.1.0):

- `FaceLandmarker` (modelo float16) con blendshapes y matriz de transformación facial, cada fotograma
- `PoseLandmarker` lite para hombros y muñecas, cada dos fotogramas
- WASM desde `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm`
- Si el delegado GPU falla al crear los modelos, se reintenta en CPU

La cabeza, la mirada y los puntos del cuerpo pasan por un filtro One Euro. Los saltos imposibles de la pose se descartan. El parpadeo y la boca suben rápido y bajan más despacio. Los puntos con visibilidad menor a 0,5 se ignoran y los brazos vuelven con suavidad al reposo.

## Créditos

Arte original de Katherine Sánchez Carrasco.

Ideas de seguimiento (filtro One Euro, rechazo de saltos, visemas, ocultar UI con H) inspiradas en luloxi/vtuber (https://github.com/luloxi/vtuber); código propio.

Las láminas de `public/bunny/` salen del PSD de la artista con `tools/psd/build_from_psd.py` (Python, [psd-tools](https://pypi.org/project/psd-tools/)). Cada capa se recorta a su contenido y se describe en `public/bunny/rig.json` (espacio de 600×600 unidades, 2 píxeles por unidad). La marioneta carga solo ese manifiesto: el orden de dibujo, el padre (`head` o `body`), el rol y el pivote de cada recorte.

La boca `neutral` es la sonrisa original de la ilustración. El resto de visemas (`small`, `a`, `o`, `smile`) y los arcos de pestaña de los ojos cerrados (`eye_l_closed`, `eye_r_closed`) se generan en el mismo script.

```bash
python3 tools/psd/build_from_psd.py ruta/al/dibujo.psd
# o, con la salida en public/bunny:
OUT=public/bunny python3 tools/psd/build_from_psd.py ruta/al/dibujo.psd
```

Requiere Python 3, `psd-tools`, Pillow, numpy y opencv-python.

## Aviso

El nombre PaRappa se usa solo para describir el estilo de animación en papel. Esta aplicación no está afiliada con ese juego ni con sus titulares.
