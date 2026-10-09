# Bunny VTuber

Marioneta **VTuber** de papel en el navegador. El dibujo de una chica conejo, recortado en láminas, copia tu cabeza, tus ojos, tu boca y tus brazos. Todo se dibuja con Canvas 2D, al estilo de las hojas planas de PaRappa the Rapper: giro de cartulina, rebote y aleteo de boca. La sombra es una sola, de toda la marioneta. La interfaz está en español.

## Qué puedes hacer

- Seguir la **cabeza** (giro, inclinación y rotación), el **parpadeo** (los dos ojos juntos; el guiño independiente es opcional), la **mirada**, la **boca** por visemas y los **brazos** (hombros y muñecas).
- Elegir **Ojos A** u **Ojos B** (dos estilos del dibujo, no pasos del parpadeo) y lanzar gestos con las mangas (teclas 1–6).
- Ajustar el pelo y las orejas en el panel **Rigging**, con pivote, **Sigue a** y un cuello opcional.
- Cargar **tu propio personaje** desde un PSD (botón **Personajes**). La conejita oficial sigue disponible.
- **Calibrar** la pose neutra con el botón Calibrar, o de forma automática durante el primer segundo y medio de cámara.
- Modo **espejo** (activo por defecto): el avatar se mueve como un espejo. La vista previa de la webcam también.
- **Modo demo** sin cámara: la marioneta respira, se balancea y parpadea sola. El ratón mueve la cabeza y la mirada; mantener pulsado abre la boca.
- Estilos de color (Original, Menta, Atardecer, Lavanda, Algodón, Papel, Neón), accesorios dibujados a rotulador y varios fondos, incluidos croma verde `#00ff00` y croma azul `#0000ff`.
- Sombra de papel, grosor de cartulina y rebote, cada uno con su interruptor. En **Escenario**: intensidad (0–1.5), color (por defecto azul `#2b4cc4`), fusión (multiplicar, superposición, luz suave, color subexpuesto) y **Color según el fondo**. El croma no lleva sombra. El grosor es solo el canto crema.
- Guardado en `localStorage` (`bunny-vtuber-settings-v1`), botones **Guardar**, **Restablecer**, **Aleatorio** y **Captura** (PNG del lienzo).
- **Modo stream**: oculta la interfaz para capturar el lienzo en OBS.

## Controles

- **H** oculta o muestra la interfaz.
- **Doble clic** en el escenario la devuelve cuando está oculta.
- **Espacio** hace un salto (aplastar, estirar y aterrizar).
- **Esc** sale del modo stream.
- **1–6** lanzan un gesto con las mangas (si el foco no está en un campo de texto).

## Parpadeo estable

Cada ojo tiene su propia línea base de «ojo abierto»: la de la calibración y, si aún no calibraste, un seguimiento lento que solo se mueve cuando el ojo se ve claramente abierto. Así una cara asimétrica (un ojo más cerrado en reposo) no se lee como parpadeo.

Por defecto los dos ojos van **enlazados**: se usa el promedio y los dos cierran a la vez. El interruptor **Guiño independiente**, en Expresión, deja que un ojo cierre solo si la diferencia se mantiene un instante. Hay una zona muerta y una histéresis para que no parpadee por ruido. Un guiño leve puede mostrar el ojo casi cerrado, pero el cierre completo solo llega con un parpadeo de verdad.

En el dibujo el parpadeo es una línea: el ojo abierto pasa al ojo cerrado y vuelve. No hay fotograma a medias.

## Ojos A / Ojos B

En Estilo, **Ojos A** y **Ojos B** eligen el dibujo del ojo abierto. El parpadeo sustituye ese dibujo por la línea de ojo cerrado.

`tools/psd/build_from_psd.py` reconoce capas opcionales (sin distinguir mayúsculas ni acentos, también dentro de grupos). El lado sale de la posición en el lienzo: la mitad izquierda es la izquierda de la pantalla (`izq`).

| Capa | Uso |
| --- | --- |
| `ojo izq A` / `ojo izq B` | Ojo completo de ese estilo |
| `ojo izq blanco A` o `B` | Blanco del ojo |
| `iris izq A` o `B` | Iris (se mueve con la mirada, recortado al blanco) |
| `pupila izq A` o `B` | Pupila (un poco más de movimiento) |
| `brillo izq A` o `B` | Brillo |
| `pestañas izq A` o `B` | Pestañas o párpado (`parpado`, `linea ojo`) |
| `ojo izq cerrado` | Línea de ojo cerrado (sustituye la generada) |

Lo mismo con `der`. Si solo está el ojo completo, se desplaza entero con la mirada. Si hay blanco, iris y pupila se recortan a su silueta.

## Acciones con las mangas

La ropa le tapa las manos: los gestos se leen en las mangas largas, sin dedos ni palmas. La barra **Acciones** flota abajo del escenario (se oculta con H y en modo stream).

| Tecla | Gesto | Qué hace |
| --- | --- | --- |
| 1 | Saludar | La manga derecha sube junto a la cara y el puño de tela ondea |
| 2 | Corazón | Las dos mangas se juntan en el pecho y forman un corazón |
| 3 | Paz | La manga derecha sube; la punta se abre en una V de tela y brilla una estrella |
| 4 | Aplaudir | Las mangas chocan delante del pecho, con un «pap» de papel |
| 5 | Señalar | La manga izquierda se estira y la punta se cierra en un cono |
| 6 | ¡Celebrar! | Las dos mangas suben, las puntas ondean y da un salto |

Si la cámara ve las muñecas altas y no hay un gesto pulsado, salen solas las mangas de celebrar, sin el salto.

## Editor de rigging

El botón **Rigging** de la barra superior abre un panel del mismo estilo que Personalizar. Solo uno de los dos está abierto.

Elige una pieza en la lista o haz clic en el dibujo. Verás su caja en trazo teal y el pivote (el asidero redondo). Arrastra el asidero para mover el pivote. Cada pieza tiene posición, escala, rotación base, visibilidad y botones **Subir** / **Bajar** para el orden de dibujo. La boca se queda pegada a la cara.

**Movimiento** (pelo y orejas de conejo):

- **Balanceo**: cuánto se mece el mechón en reposo, en grados.
- **Velocidad**: rapidez de ese balanceo, en hercios.
- **Rigidez del resorte**: qué tan pegado va a la cabeza. Bajo = flojo y con rebote.
- **Amortiguación**: frena el rebote. Baja = más oscilación.
- **Retraso / fase**: desfasa el balanceo entre mechones y retrasa un poco la respuesta a la cabeza.
- **Gravedad / caída**: un giro constante hacia abajo y una inclinación contraria al giro de la cabeza.
- **Seguir cabeza**: cuánto empujan el giro y la inclinación de la cabeza.
- **Límite de giro**: tope del ángulo, para que no dé la vuelta.

**Probar movimiento** mueve la cabeza sola (giro e inclinación) para ver cómo siguen los mechones. Se apaga al cerrar el panel.

**Exportar rig.json** descarga el manifiesto con tus ajustes ya escritos en cada pieza. **Importar** acepta ese archivo o un JSON de overrides. **Restablecer parte** y **Restablecer todo** vuelven a los valores del `rig.json` cargado (el total pide confirmación).

Si exportas y sustituyes `public/bunny/rig.json`, los ajustes quedan para todo el mundo. En ese navegador pulsa **Restablecer todo** después, para no sumar otra vez lo que ya iba en el archivo. Los retoques de la conejita oficial viven en `localStorage` (`bunny-vtuber-rig-v1`). Cada personaje cargado usa su propia clave (`bunny-vtuber-rig-v1:<id>`) y también guarda esos retoques en su ficha.

## Cargar tu propio personaje (PSD)

El botón **Personajes** abre la biblioteca. **Conejita (oficial)** es el personaje incluido: se puede usar, no se puede borrar. El resto tiene **Usar**, **Renombrar** y **Borrar**.

**Cargar personaje (PSD)** (o soltar un `.psd` en la zona, o sobre el escenario) lee el archivo en el navegador. Aparece **Asignar capas**: cada capa con su miniatura, el nombre y la ruta del grupo, y un rol. A la derecha, una vista previa que se actualiza al cambiar un rol. **Armar** construye la marioneta, la usa y la guarda. **Cancelar** vuelve sin cambiar el personaje en escena.

El último personaje usado se recuerda y se abre al recargar. Si esa ficha falla, vuelve la conejita.

Las fichas están en IndexedDB (`bunny-vtuber`, almacén `characters`): nombre, miniatura, capas en PNG, escala y los retoques de rigging.

### Nombres que se reconocen

Minúsculas, sin acentos, `_` como espacio. El lado izquierdo/derecho no se fía del nombre: lo decide el centro de la mancha respecto al centro del lienzo (izquierda de la pantalla = izq).

| Nombre | Rol |
| --- | --- |
| `pelo atras` | Pelo de atrás |
| `oreja` (+ izq/der) | Oreja de conejo |
| `orejas` | Orejas humanas |
| `mechon …` | Mechón que se mueve |
| `flequillo` o `cabeza flequillo` | Flequillo |
| `cabeza` o `cara` | Cara |
| `cuerpo` | Cuerpo |
| `cuello` | Cuello (capa) |
| `boca`, `boca abierta`, `boca o`, `boca sonrisa` | Bocas |
| `ojo izq/der A/B`, `blanco`, `iris`, `pupila`, `brillo`, `pestanas`, `ojo … cerrado` | Ojos |
| `brazo`, `antebrazo`, `manga`/`mano` + saludo, corazon, paz, aplauso, senala, arriba | Mangas |

Las capas ocultas llamadas `Capa …` dentro de un grupo oculto se saltan. Una capa oculta con un nombre conocido (por ejemplo el ojo B) se conserva.

Si el nombre no dice nada, la posición respecto al personaje decide: arriba y estrecho → oreja; par pequeño y simétrico → ojos; mancha pequeña bajo los ojos → boca; abajo y grande → cuerpo; grande, ancha y detrás de la cara → pelo atrás; mitad superior → mechón; si no, estático.

El personaje cabe en un rig de 600×600 (alto 546, centrado, tope a 25). Cada capa se recorta al alfa. Si el PSD es muy grande, se reduce para no pasar de 2,5 px por unidad.

Si no hay capas de boca, se busca la boca pintada en la cara, se recorta y se generan las demás formas. Si no aparece, las bocas generadas van al 62 % de la altura de la cara. Si falta el ojo cerrado, se dibuja un arco de pestaña.

## Puntos de giro y "Sigue a"

En **Rigging**, la pieza elegida tiene un solo **punto de giro** (el asidero que ya se arrastra). **Sigue a** elige de quién cuelga: **Cuerpo**, **Cabeza** u otra pieza (un mechón puede seguir a una oreja o a otro mechón). No se permiten ciclos.

El balanceo de la pieza se aplica alrededor de su pivote, dentro del movimiento completo del padre (incluido el balanceo del padre). Lo que cuelga de la cabeza —cara, flequillo, ojos, boca, orejas, mechones, accesorios de cabeza— sigue a **Cabeza** por defecto. El cuerpo y lo que va con él siguen a **Cuerpo**. El padre se guarda con el personaje y viaja en el `rig.json` exportado.

## Cuello

En **Rigging**, la sección **Cuello** tiene:

- **Tiene cuello**: apagado por defecto. La conejita oficial no cambia hasta que lo actives.
- **Largo del cuello** (0–30): sube todo el grupo de la cabeza.
- **Estirar al moverse** (0–1): el cuello crece cuando la cabeza sube o va hacia delante y se aplasta al caer el rebote.
- **Punto del cuello**: el asidero naranja. Es el pivote de giro de la cabeza.

Con el cuello activo, la cabeza gira sobre ese punto. Si el PSD trae una capa `cuello`, se estira para tapar el hueco. Si no, se dibuja un cuello del color de la cara (un poco más estrecho que la cara, con sombra bajo la barbilla y perfil azul). Al girar, la parte de arriba acompaña a la cabeza y la de abajo se queda en el cuerpo. Queda detrás del cuello de la ropa: justo antes del cuerpo, o antes de la cara si el cuerpo se pinta después. El ajuste se guarda con el personaje.

## Capas de brazos y mangas en el PSD

El mismo script recoge las mangas por nombre, sin distinguir mayúsculas ni acentos, también dentro de grupos. Dibújalas colgando del hombro, en reposo. El lado `izq` / `der` se corrige si la posición en el lienzo lo desmiente. La mano va **dentro** de la manga: no hace falta una capa de dedos. `mano` se acepta como alias de `manga`.

| Capa | Pieza |
| --- | --- |
| `brazo izq`, `brazo der` | Manga superior (pivote = hombro) |
| `antebrazo izq`, `antebrazo der` | Manga del antebrazo (pivote = codo, el extremo más cercano al hombro) |
| `manga izq`, `manga der` | Punta o puño en reposo (pivote = extremo cercano al hombro) |
| `manga izq saludo`, `manga der saludo` | Punta del saludo |
| `manga corazon` | Las dos puntas del corazón en una sola capa |
| `manga izq corazon`, `manga der corazon` | Punta del corazón por lado |
| `manga izq paz`, `manga der paz` | Punta de la paz |
| `manga izq aplauso`, `manga der aplauso` | Punta del aplauso |
| `manga izq señala`, `manga der señala` | Punta de señalar |
| `manga izq arriba`, `manga der arriba` | Punta de celebrar |

Opcional: `tools/psd/pivots.json` con `{"nombre de capa": [x, y]}` en píxeles del PSD para forzar un pivote. Cuando separes los brazos del cuerpo, la capa `cuerpo` debe ser el cuerpo sin brazos.

```bash
OUT=public/bunny python tools/psd/build_from_psd.py ruta/vtuber1.psd
```

Hacen falta `psd-tools`, `opencv-python-headless`, `numpy` y `pillow`.

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

La boca `neutral` es la sonrisa original de la ilustración. El resto de visemas (`small`, `a`, `o`, `smile`) se generan en el mismo script. La línea de ojo cerrado también, salvo que el PSD traiga `ojo … cerrado`.

```bash
python3 tools/psd/build_from_psd.py ruta/al/dibujo.psd
# o, con la salida en public/bunny:
OUT=public/bunny python3 tools/psd/build_from_psd.py ruta/al/dibujo.psd
```

Requiere Python 3, `psd-tools`, Pillow, numpy y opencv-python.

## Aviso

El nombre PaRappa se usa solo para describir el estilo de animación en papel. Esta aplicación no está afiliada con ese juego ni con sus titulares.
