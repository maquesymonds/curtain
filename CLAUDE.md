# curtain — reglas del proyecto

Piezas de tipografía animada sobre foto/vídeo. Web estática, vanilla JS con ES
modules, sin build. Se sirve por HTTP (los módulos no funcionan con `file://`).

- `horse/` — crin de letras sobre un vídeo de un caballo.
- `willow/` — sauce llorón: lianas de código que cuelgan de las ramas.
- `fish/` — aletas de código sobre un pez. Misma cortina, pero **ondulada y en
  movimiento**: no cuelga, y la fuerza que manda es el agua (`shared/js/swell.js`)
  en vez del viento. Ver `fish/README.md`.
- `shared/` — física, render, config base y utilidades comunes a las tres piezas.

El `index.html` de la raíz las pasa las tres en iframes. **Una pieza no se
enseña nunca sin letras:** asienta los mechones, pinta un primer fotograma y solo
entonces avisa al shell (`shared/js/stage.js`, `curtain:ready`); hasta ese aviso
la pieza anterior sigue en pantalla. Las tres se precargan de fondo, una detrás
de otra, así que a partir del primer pase el cambio es inmediato. Medido con la
flecha derecha en Chrome headless: la escena entrante ya tiene tinta en su canvas
en el primer fotograma visible (sauce 9695 px, caballo 2303, pez 3309).

Las reglas de abajo se escribieron para `willow/`. La 3 y la 4 valen para todas
las piezas. La 2 es específica del sauce. La 1 hay que leerla con cuidado — ver
justo debajo.

---

## REGLA 1 — Los brillos NUNCA se anclan a una altura

**El brillo es una propiedad de CÓMO EMPIEZA UNA LIANA, no de dónde está en el
árbol.**

Toda liana, nazca en el contorno de arriba o en una rama baja, arranca intensa
(blanca, con glow) en sus primeros caracteres y se va apagando hacia abajo. Al
mirar el árbol se tiene que leer así: un brillo arriba que se degrada hacia
abajo, y donde empieza una liana nueva más abajo, otra vez brillo en su arranque
degradándose hacia abajo. Tantas veces como lianas haya, a cualquier altura.

**Prohibido:** restringir la capa de brillo a una banda de altura. Nada de
`rootNy`, `rootFrom`, ni ningún filtro por `ny` sobre los destacados. Eso produce
el efecto contrario — el brillo se lee como propiedad de la copa y las lianas de
abajo quedan apagadas. Ya se hizo dos veces; no se vuelve a hacer.

Si los brillos se ven mal, el problema está en la FORMA de la rampa a lo largo
del mechón (`CONFIG.depth.rampCurve` y `rampSpan`) o en la DOSIS
(`spacingPx` de la capa), nunca en la altura de nacimiento.

Corolario: una liana necesita caracteres suficientes para que la rampa sea una
rampa. Una liana de 2 o 3 caracteres no puede mostrar un degradado — se lee como
una letra brillante suelta. Las lianas que nacen abajo tienen que ser lo bastante
largas, no recortes de relleno.

### Qué parte de la REGLA 1 es universal y cuál no

Hay que separar dos cosas que esta regla dice a la vez:

- **La PROHIBICIÓN es universal.** Nunca anclar el brillo a una altura, ni filtrar
  destacados por `ny`, ni `rootNy`/`rootFrom`. En ninguna pieza.
- **La PRESCRIPCIÓN ("arranca intensa y se apaga") es del sauce.** Describe cómo
  se ilumina una liana colgando, no cómo se ilumina cualquier cosa.

En `fish/` el brillo funciona distinto, y está medido sobre la referencia: dentro
de una aleta la luminancia varía **×2.14 más de radio a radio que a lo largo**
(std 17.05 contra 7.97). Una aleta se lee como estructura de costillas —
radios claros con membrana oscura entre ellos, cada uno parejo en su longitud —
no como una rampa desde la raíz. Aplicarle la prescripción del sauce fue un error;
la referencia manda, igual que en la REGLA 2.

Lo que sí se respeta en las dos piezas: el brillo de un mechón depende de **qué
mechón es**, nunca de dónde cae en la pantalla.

## REGLA 2 — Las lianas salen de las ramas, a todas las alturas

No todas cuelgan del contorno superior de la copa. Salen del contorno de arriba
**y también** de las ramas intermedias y bajas, siguiendo la estructura real del
árbol, que es lo que deja ver los arcos oscuros de las ramas entre las masas de
letras. La referencia manda: `willow/` se compara con la imagen de referencia,
no con lo que parezca razonable.

## REGLA 3 — Medir antes de afirmar

Los parámetros de estas piezas interactúan de formas que no se adivinan (el peso
pelea con el viento; el brillo no es lineal en `z`; subir la gravedad casi no
cambia cuánto cuelgan). Antes de decir que algo mejoró, medirlo: contar mechones,
luminancia por zonas, recorrido de las puntas, tiempo de asentamiento. Y dejar el
número en el comentario del parámetro, con la fecha implícita del cambio.

## REGLA 4 — El servidor de desarrollo no debe cachear

`python3 -m http.server` no manda `Cache-Control`, y Chrome sirve el JS y los
JSON viejos: se han perdido varias iteraciones creyendo que un cambio no había
hecho nada. Usar `serve.py` (en la raíz), que manda `no-store`.

```
python3 serve.py 8000      # y abrir http://localhost:8000/willow/
```
