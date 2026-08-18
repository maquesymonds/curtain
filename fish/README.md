# fish — aletas de código sobre un pez

Cuarta pieza. Mismo sistema de mechones que `horse/` y `willow/`, pero la fuerza
que manda es el agua, no el aire.

```
python3 serve.py 8000      # desde la raíz
# http://localhost:8000/fish/        y ?diag para el panel
```

## Qué cambia respecto a las otras dos

1. **No hay gravedad que valga.** Una aleta es casi neutra en flotabilidad, así
   que no tiene forma de reposo que colgar. `gravity` es el 6% del de `willow/`.
2. **El motor es una onda viajera**, no una brisa. `systems.wind` apagado,
   `systems.swell` encendido — ver `shared/js/swell.js`.
3. **Los mechones no cuelgan.** Cada raíz tiene su propia dirección de
   crecimiento alrededor del contorno del cuerpo, con el `angle` que se le añadió
   a `Strand` (identidad exacta en `angle: 0`, así que las otras piezas no se
   enteran).
4. **Las raíces viajan con el pez**, en coordenadas de cuerpo `(u, v)` —
   `u` +1 morro / −1 cola, `v` −1 lomo / +1 vientre. Ver `bodyTrack.js`.

## Medido

Todo sobre `fish video.mp4` y el clip de referencia, 121 frames a 24 fps.

| | base | referencia |
|---|---|---|
| periodo del batido | 2.52 s (0.40 Hz) | 2.52 s — el mismo |
| recorrido punta de cola | 6.1 px | 60.9 px — **×10** |
| basculación del cuerpo | 11.8° | 15.8° |

El velo no cambia el ritmo, **amplifica el mismo batido en un orden de
magnitud**.

> **Retirado:** aquí decía "alto de la silueta 108 → 233 px, ×2.15" y se usó un
> tiempo para dimensionar las aletas. **No vale como medida del tamaño de la
> aleta**: es el cociente entre los bbox de los *dos clips*, y los dos clips
> tienen poses distintas del cuerpo — cosa ya establecida al principio. Mide la
> diferencia de pose tanto como la aleta. Bajar el umbral de la máscara para
> coger las puntas translúcidas no cambia nada (×1.22 / ×2.23 permisivo contra
> ×1.21 / ×2.21 estricto), lo que confirma que el problema no era el umbral.

**Recorte del loop.** El clip original no cierra: 109 px y 4.19° de salto del
último frame al primero. Buscando todos los pares (inicio, largo) por diferencia
de píxel y de pose, el mejor es **frames 51–110, 60 frames, 2.50 s** → 30 px y
1.82°. Además es 0.99 de un batido, y por eso `windPeriod` puede ser 2.5 y la
onda cierra con el vídeo. Está en `fish-loop.mp4`; `fish video.mp4` se conserva
como fuente.

**Tracking.** `fish-tracking.json` es **generado**, no dibujado a mano: el pez es
rojo saturado sobre casi negro, así que la pose sale de una máscara de color.
Recorrido entre frames 4.87 px de media, 8.48 px el peor, 0.16°/frame — suave sin
suavizar. No hay editor de tracking y no hace falta.

**Loop boomerang.** Los 30 px / 1.82° de arriba eran el MEJOR corte posible
reproduciendo siempre hacia adelante — cualquier recorte deja algo de salto
porque la pose de cierre nunca es exactamente la de apertura. `fish-loop-
boomerang.mp4` lo elimina en vez de minimizarlo: es `fish-loop.mp4` (60 frames)
reproducido hacia adelante y luego invertido, pegado (120 frames, 5.0 s exactos
— sí repite un frame en cada costura, ~42ms, y eso es preferible: la
alternativa de recortar esos dos frames para evitarlo fue lo que rompió la
correspondencia de tiempo, ver abajo). El navegador lo decodifica siempre
hacia adelante (nativo, sin *seeking* manual por JS en cada frame).

`fish-tracking.json` **no se duplicó** para acompañarlo — sigue midiendo el
mismo paso único de 60 frames / 2.5 s. `boomerangTime()` en `bodyTrack.js`
pliega el tiempo crudo del archivo (que ahora dura el doble) de vuelta a ese
dominio de 60 frames — así que "frame 34" es la misma pose medida (y corregida
a mano si le tocó corrección) tanto a la ida como en su espejo de vuelta.
Consecuencia: **ninguna corrección hecha con `?track` o el modo `frame` de
`?anchors` hay que rehacerla** — están indexadas por ese mismo número de
frame, no por tiempo de archivo. Por la misma razón `swell.windPeriod`
tampoco se retocó: una onda periódica reproducida hacia atrás sobre
exactamente un período sigue siendo continua.

**Bug de la primera versión, y por qué no era un triángulo simple.** El primer
intento usaba `logical = 2×loopDuration − rawTime` para el pase reverso —
parece razonable, y estaba mal en **un frame completo, sostenido durante TODO
el pase reverso**, no solo en la costura: el frame `n` (primer frame del medio
invertido) no existe, el último es `n-1`. El punto de espejo correcto es
`(2n-1)/fps`, no `2n/fps`. Verificado por SSIM (no por checksum — la
recompresión con pérdida cambia bytes aunque el contenido sea idéntico, así
que MD5 entre el archivo fuente y el generado no sirve de verificación): el
frame 90 del archivo boomerang da SSIM 0.975 contra el frame 29 original y
0.922 contra el 30 — la fórmula vieja predecía 30. Esa desalineación sostenida
es lo que hacía que las raíces de las aletas se movieran con un cuerpo
trackeado que no correspondía al frame real durante medio loop, y la física
reaccionaba a ese desfase constante metiendo energía en la cadena de
partículas — se leía como que las aletas colapsaban hacia adentro.

Segundo bug, independiente del primero: `BodyTrack.frameAt`/`poseAt` hacían
wrap (`% n`) en vez de clamp. Con el tiempo ya plegado por `boomerangTime`,
tocar exactamente `loopDuration` (pasa una vez por ciclo, en el pico) hacía
`60 % 60 = 0` — mezclaba el último frame hacia el primero en vez de sostenerse
en el último. Ahora `frameAt` sostiene (clamp) en vez de envolver.

## Verificado en el navegador, no a ojo

- **Legibilidad.** Detalle de alta frecuencia en la zona de la caudal: 10.07 con
  el primer `lightWash` (alpha 0.05 / radio 26) → **15.52** con el actual. El wash
  estaba convirtiendo las aletas en manchas de niebla sin caracteres dentro.
- **Onda viajera.** Desfase del desplazamiento con signo a lo largo del mechón,
  por ajuste de mínimos cuadrados a la frecuencia del batido. Con
  `envelope: 1.6` la pectoral salía **plana** (−38°, −32.8°, −32.1°, −39.6°):
  pivotaba como un palo. El centro del mechón recibía solo 0.33× de la fuerza de
  la punta, y es justo ahí donde tiene que formarse la curva. Con `envelope: 1.15`
  y `strength: 0.22`:

  | aleta | desfase total raíz→punta | amp punta/medio |
  |---|---|---|
  | caudal | −339° | 4.95 |
  | pectoral | −91° | 1.5 |
  | dorsal | −56° | 2.0 |

  La caudal ondula de verdad. Las cortas siguen bastante rígidas — en parte es
  físico (un radio corto y tieso se mueve más en bloque), en parte que tienen
  pocas partículas. **Pendiente.**
- **Colisión.** Glifos dentro del cuerpo pasado el arranque: **33.9 sin
  colisionador → 0.2 con él**. Los ~49 que quedan contando todo son las
  partículas de la raíz, que deben estar en la piel.

## Lo que hace que se lea como aleta y no como confeti

Tres cosas, en orden de impacto, todas descubiertas comparando contra la
referencia y no razonando a priori:

1. **`segmentLength` por debajo del cuerpo de letra.** Con 15 px y glifos de
   17 px los caracteres quedaban más separados que anchos y cada mechón se leía
   como una fila de puntos. Un radio de aleta real es una **línea continua**. A
   11 px los caracteres se tocan y el mechón pasa a ser una cinta de texto.
2. **La caudal nace en el pedúnculo, no en la punta de la cola.** `halfLen` mide
   hasta el borde de la aleta real del pez, así que unas raíces en `u = -1.0`
   nacían una aleta entera por detrás del cuerpo: se veía la cola naranja, un
   hueco, y luego el código empezando por su cuenta. En `u = -0.74` el código se
   monta sobre la cola real y sale de ella.
3. **`collisionFromDepth`.** El primer 18% de cada mechón está exento de colisión
   porque es la *inserción* de la aleta y le toca estar sobre la piel. Sin eso el
   colisionador echaba la base de la caudal fuera del pedúnculo y reabría justo el
   hueco que las raíces nuevas venían a cerrar.

## Editor de anclas de aleta (`?anchors`, o la tecla `e`)

Los puntos de `arc` en `fins.js` — dónde nace el abanico de cada aleta, en
coordenadas de cuerpo `(u, v)` — se pueden arrastrar en vivo, sobre el vídeo,
en vez de editarse a mano en el código. `finAnchorEditor.js` dibuja cada punto
en su posición real de pantalla para el frame que está corriendo y, al
soltarlo, `finAnchorStore.js` lo convierte de vuelta a `(u, v)` con la pose de
ese instante (`bodyTrack.normToLocal`) y lo escribe en `FINS` — mismo array
que lee `buildFinRoots`, así que el cambio se ve al próximo rebuild (la tecla
`e` cierra el editor, que autoguarda en `localStorage` y también exporta a
`fish-fin-anchors.json` para comprometerlo).

Es la forma de sacarlos de fase con el cuerpo: si al ver `?diag` los roots no
caen sobre la silueta del pez, es porque el `arc` de esa aleta está puesto a
ojo y desactualizado — se arrastra ahí, no se adivina un número nuevo en el
código.

No confundir con lo que ya dibuja `?diag`: eso muestra los ~82 roots
construidos (uno por rayo, ya repartidos e interpolados sobre el arco); el
editor muestra solo los 2 a 5 puntos de control del `arc` de cada aleta, que
es lo que de verdad se autoriza a mano.

## Editor de corrección de tracking (`?track`, o la tecla `r`)

Distinto del editor de anclas de arriba, y para un problema distinto: no es
que un `arc` esté mal puesto (eso es constante, viaja con el cuerpo en todos
los frames por igual), es que el tracking generado en `fish-tracking.json` se
resbala en frames puntuales — el `arc` está bien pero la elipse del cuerpo que
lo carga, en ESE frame, no.

`trackCorrectionStore.js` guarda un set disperso de keyframes de corrección
— deltas `{dcx, dcy, dangle, dHalfLen, dHalfDepth}` sobre `cx/cy/angle/
halfLen/halfDepth` — que se suman al pose crudo de `bodyTrack.js`. Fuera del
rango de frames donde pusiste keyframes la corrección es exactamente cero: al
revés que el `TrackingStore` de `horse/` (que sostiene un keyframe hasta el
borde del clip), acá una corrección puesta en un frame malo no se filtra al
resto del loop. `trackCorrectionEditor.js` la dibuja como dos elipses — la
trackeada cruda punteada, la corregida (la que realmente se renderiza) sólida
— y se usa pausado (`espacio`, `,`/`.` para pisar frame a frame): arrastrar
mueve `dcx/dcy`, `[`/`]` rota, `-`/`=` escala.

Solo uno de los dos editores (`?anchors` / `?track`) tiene el canvas a la vez.

### Un tercer caso: puntos sueltos, en frames sueltos

Ninguno de los dos de arriba sirve cuando lo que está mal no es ni el arco
completo (constante, para todo el clip) ni el cuerpo entero (todos los roots
juntos): es que un punto de una aleta se desfasa en un momento puntual, y
otro punto de otra aleta se desfasa en un momento distinto — no hay un solo
offset ni una sola corrección de pose que arregle los dos a la vez.

Por eso el editor de anclas (`e`) tiene dos modos, tecla `f` para cambiar:

- **global** (el de siempre) — arrastrar mueve el punto para todo el clip.
- **frame** — arrastrar solo afecta el frame actual (pausa sola si hace
  falta), con la misma regla de siempre: cero fuera del rango de keyframes
  puestos para ESE punto puntual (`finAnchorFrameStore.js`). Un fantasma
  blanco muestra la posición base sin corregir, para ver la distancia del
  ajuste.

Las tres capas se apilan: `arc` base (editor global) → corrección de pose del
cuerpo (`?track`) → corrección de este punto en este frame (modo `frame`).
Cada una vive en su propio slot de `localStorage` y no se pisan entre sí.

## Lo que no se ha podido medir

**El tamaño de las aletas.** Tres intentos y ninguno sirve — el bbox comparado
entre clips (mide la pose), el bbox con umbral permisivo (idéntico), y el alcance
contra el propio cuerpo por erosión, que da ×1.15 del semieje, o sea 21 px más
allá de la punta del cuerpo, cosa que la referencia contradice a simple vista. Una
aleta translúcida sobre agua oscura no se segmenta. Así que **los `lenFrac` están
puestos a ojo contra la referencia**, y está dicho así en `fins.js`. Un número que
no concuerda con la imagen no es una medida.

Lo que sí está acotado por medida es el límite superior: el pez nada con su centro
entre 0.46 y 0.53 del ancho del cuadro, así que la cola queda sobre 0.27 y un
radio de más de ~1.3 semiejes se sale de la imagen. Con `[1.0, 1.42]` sale de
cuadro el 3.2% de la caudal — el punto justo para que se lea que el velo continúa.

El desfase de la onda por unidad de longitud **en el vídeo de referencia**. Dos
intentos fallidos:

1. Correlación cruzada cuerpo↔punta: plana, r≈0.50 de lag 0 a 7. La domina el
   drift lento común a las dos señales.
2. Línea central por longitud de arco: solo resuelve 3 radios (10–30 px), porque
   el velo caudal barre **hacia arriba y adelante pegado al cuerpo**, así que
   cualquier filtro "por detrás de la raíz" lo descarta, y sin el filtro las
   pectorales contaminan los anillos.

Por eso `swell.wavelengths` es una **elección, no una medida**, y está marcado
como tal en el config y en el panel de `?diag`. El desfase real de la simulación
sí está medido (la tabla de arriba) — lo que falta es el valor de la referencia
contra el que compararlo.

## REGLA 1

Vive en `fins.js`. El brillo de cada mechón sale de `zRoot → zTip` **sobre el
mechón**: arranca brillante en sus primeros caracteres y se apaga a lo largo de
su propia longitud. No hay filtro por `ny`, ni banda de altura, ni "solo brilla la
parte de arriba de la aleta". Un mechón de la pectoral que nace abajo del vientre
está autorizado a ser exactamente igual de brillante en su raíz que uno de la
dorsal. Lo único que varía `zRoot` es un hash por mechón, nunca su posición.

El corolario también se cumple: el mechón más corto de la tabla (la anal, 0.40)
construye ~132 px, unos 11 caracteres. Nada aquí es un tocón de 3 letras usado de
relleno.
