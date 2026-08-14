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

## Jugar con los parámetros sin tocar código

Añade `?controls` a la URL de cualquier pieza:

```
http://localhost:8000/fish/?controls
http://localhost:8000/willow/?controls
http://localhost:8000/horse/?controls
```

Se abre un panel con los valores en vivo — color, brillo, tamaño de letra,
fuerza del agua, longitud de las aletas — y se ve el cambio al momento. Es la
forma de trastear sin miedo: **nada de lo que toques ahí se guarda**, recargas y
vuelve a estar como estaba.

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
index.html    la galería: pasa entre las tres piezas con las flechas
fish/         pez  — aletas de código
willow/       sauce — lianas
horse/        caballo — crin
shared/       la física, el dibujado y la configuración base de las tres
serve.py      el servidor local
```

Cada pieza vive en su propio iframe y sólo la que estás viendo consume CPU: un
iframe oculto no ejecuta animación, y eso importa porque el sauce solo tiene
20.000 partículas.

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
