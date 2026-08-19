# curtain

Tres piezas de tipografía animada sobre vídeo. Las letras no están pegadas
encima: son una cortina de código con física propia, colgada del sujeto de cada
clip y movida por viento o por agua.

**Ver en vivo → https://maquesymonds.github.io/curtain/**

Flechas **←** **→** para pasar de una pieza a otra.

| | | |
|---|---|---|
| **Pez** | aletas de código neón que salen del cuerpo y ondulan | la fuerza es una onda que viaja del nacimiento a la punta |
| **Sauce** | lianas de letras colgando de las ramas | la fuerza es el viento |
| **Caballo** | crin de letras sobre un caballo que se mueve | las raíces siguen al animal fotograma a fotograma |

---

## Cómo arrancarlo en tu ordenador

Necesitas Python (viene de serie en Mac). Desde la carpeta del proyecto:

```bash
python3 serve.py 8000
```

Y abre **http://localhost:8000**

### Dos cosas que te van a pasar si no lees esto

**No abras el `index.html` haciendo doble clic.** Se verá el vídeo pero sin
ninguna letra. Los navegadores bloquean los módulos de JavaScript cuando el
archivo se abre desde el disco (`file://`) en vez de por un servidor. Tiene que
ser `http://localhost:8000`.

**Usa `serve.py`, no otro servidor.** El servidor normal de Python cachea, y
Chrome te sirve el JavaScript viejo: cambias algo, recargas, y parece que no ha
hecho nada. `serve.py` manda `no-store` justamente para evitar eso. Si aun así
sospechas, recarga con **Cmd+Shift+R**.

---

## El botón de jugar (el que ve cualquiera)

Arriba a la izquierda está la marca **FILAMENTO**, que lleva al
[Instagram](https://www.instagram.com/filamento____/?hl=en). Arriba a la derecha
hay un botón de **play**: abre un panel con una docena de mandos sobre la pieza
que estás viendo — los tres colores con los que se hornea cada letra, la fuerza
que la mueve (viento en el caballo, corriente en el pez), el tamaño y el brillo
del tipo, el texto mismo, y el sonido. **volver al original** deshace todo. La
tecla **P** lo abre y lo cierra, **Esc** lo cierra.

El mando `alphabet` cambia el repertorio entero: **filamento** (la palabra, que es
lo que la pieza dice por defecto), **numbers** y **chinese** — 24 caracteres que son
el vocabulario de las piezas mismas (絲 filamento, 線 hilo, 文 escritura, 光 luz,
水 agua, 風 viento, 馬 caballo, 魚 pez…). El pez añade **code**, su pool autorado.
El campo de texto de al lado edita siempre **lo que la pieza está dibujando de
verdad** — el pool cuando hay pool, las palabras cuando no.

Nada de esto se guarda: recargas y la pieza vuelve a estar como la escribió su
`config.js`.

Cómo está montado, por si hay que añadir un mando: **la pieza decide qué se puede
tocar, el shell sólo lo dibuja**. Cada pieza declara su lista en
`horse/js/tune.js` / `fish/js/tune.js` y la ofrece por `postMessage`
(`shared/js/tune.js`); el `index.html` de la raíz no conoce ni un solo nombre de
parámetro. Por eso el mismo slider puede ser `windStrength` en el caballo y
`swell.strength` en el pez, y por eso añadir un mando no toca el shell.

Cada entrada declara lo que cuesta el cambio, con las mismas tres palabras que
usa el panel de autor: `live` (se lee cada fotograma), `atlas` (hay que
rehornear los bitmaps de las letras, ~6 ms) y `rebuild` (se lee mientras se
construyen los mechones, así que hay que reconstruirlos).

---

## Jugar con TODOS los parámetros (para trabajar la pieza)

Añade `?controls` a la URL de cualquier pieza:

```
http://localhost:8000/fish/?controls
http://localhost:8000/willow/?controls
http://localhost:8000/horse/?controls
```

Se abre un panel con **todos** los valores en vivo — no la docena del botón de
jugar, sino los cien y pico parámetros de la pieza: color, brillo, tamaño de
letra, fuerza del agua, longitud de las aletas, la rampa de profundidad — y se ve
el cambio al momento. Es la forma de trastear sin miedo: **nada de lo que toques
ahí se guarda**, recargas y vuelve a estar como estaba (el botón "copiar cambios"
imprime sólo lo que moviste, listo para pegar en `config.js`).

Pesa 2,6 MB y sólo se descarga con el flag puesto: quien entra a mirar la pieza
no lo pide nunca.

Con `?diag` (o la tecla **D**) sale un panel de diagnóstico: cuántos mechones hay,
cuántas letras se están dibujando, si el vídeo va, etc. Sirve para entender por
qué algo no se ve.

Desde la consola del navegador también se puede:

```js
__fish.cfg.swell.strength = 0.4    // más fuerza de agua en las aletas
__fish.cfg.color = "#00ffcc"       // (hace falta __fish.rebuild() después)
```

---

## Cómo está montado

Sin instalación, sin compilar, sin dependencias. HTML, CSS y JavaScript a pelo.

```
index.html    la galería: marca, botón de jugar y paso entre piezas
fish/         pez  — aletas de código
willow/       sauce — lianas
horse/        caballo — crin
shared/       la física, el dibujado y la configuración base de las tres
              (shared/js/tune.js = el canal del botón de jugar)
shared/fonts/ Chakra Petch autoalojada — la tipografía de todo, obra y UI
              (shared/js/alphabets.js = los repertorios del mando alphabet)
serve.py      el servidor local
```

Cada pieza vive en su propio iframe y sólo la que estás viendo consume CPU: un
iframe oculto no ejecuta animación, y eso importa porque el sauce solo tiene
20.000 partículas.

**La crin dice FILAMENTO.** `words: ["FILAMENTO"]` más `textFromRoot`, que hace que
cada mechón empiece en la primera letra en vez de seguir donde terminó el anterior:
así la palabra se lee verticalmente, de la raíz a la punta, una y otra vez, en cada
mechón. Antes las ocho palabras se unían en una sola cadena y cada mechón tomaba una
tajada desde donde quedó el previo — por eso no decía nada, un mechón arrancaba en
"AMENTO MEMORY MOT". Medido: 82 de los 84 mechones leen la palabra completa; los
otros dos tienen 8 partículas y en 8 no cabe una palabra de 9 letras.

**La tipografía es Chakra Petch, autoalojada** (`shared/fonts/`, 96 kB de latin +
latin-ext; nada de `fonts.googleapis.com`). Es un **input del build**, no un
estilo: cada carácter se hornea una vez en un atlas de canvas, y `ctx.font` cae a
la familia de reserva sin avisar, así que una fuente que llega tarde deja la pieza
en la reserva toda la sesión. Por eso `shared/js/fonts.js` la espera antes del
primer `build()`, con un límite de 2,5 s — una pieza con letras en la cara de
reserva vale infinitamente más que una pieza sin letras.

Al ser proporcional en vez de monoespaciada hubo que reajustar el paso del pez
(`segmentLength` 8.95 → 7.15): con este charPool, casi todo puntuación, la media
de ancho cae de 6,62 px a 5,28 px y los radios se leían como una fila de puntos en
vez de una línea continua. El número y su medida están en `fish/js/config.js`.

Los ajustes de cada pieza están en su `js/config.js`, con un comentario en cada
parámetro explicando qué hace y, cuando se midió, con el número medido. Ese es el
mejor sitio por donde empezar a leer.

---

## Si quieres cambiar algo de verdad

Los archivos por los que empezar, en orden de "cuánto se nota":

1. **`fish/js/config.js`** — colores, tamaño de letra, brillo, física del agua.
2. **`fish/js/fins.js`** — la forma de cada aleta: dónde nace, hacia dónde crece,
   cuántos rayos tiene y cuánto miden.
3. **`willow/js/config.js`** y **`horse/js/config.js`** — lo mismo para las otras dos.

Los cambios en `shared/` afectan a las tres piezas a la vez, así que cuidado ahí.
