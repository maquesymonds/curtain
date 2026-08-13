# Neon Mane — Typographic Horse · cómo está construida la lógica

Web estática, vanilla JS con ES modules, sin build ni dependencias. Un vídeo de un
caballo a pantalla completa y, encima, un `<canvas>` transparente donde se simula
una **crin hecha de letras** (glifos de neón rosa) que cuelga de la línea de la
crin del caballo y se mueve con física.

Se sirve por HTTP (`python3 -m http.server`), no funciona con `file://` porque usa
`type="module"`.

---

## 1. Estructura del DOM

```html
<video id="bg-video" muted playsinline loop autoplay preload="auto"></video>
<img   id="bg-image" alt="" />        <!-- solo para el modo static -->
<canvas id="mane"></canvas>
<script type="module" src="js/main.js"></script>
```

CSS: los tres elementos son `position: fixed; inset: 0; width/height: 100%`.
El vídeo y la imagen usan `object-fit: cover; object-position: center`.
El canvas tiene `z-index: 1` y **`pointer-events: none`**.

---

## 2. Los dos modos

`CONFIG.mode` (o `?mode=video` / `?mode=static` en la URL):

- **`video`** (el activo): fondo = `Caballo.mp4`. Las raíces de la crin siguen un
  spline animado construido a partir de keyframes escritos a mano en
  `tracking.js`. La colisión con el cuerpo del caballo usa primitivas geométricas
  animadas (un círculo para el cráneo + 3 cápsulas para el cuello).
- **`static`**: fondo = `Caballo1.png`. Las raíces se detectan escaneando los
  píxeles de una línea blanca pintada sobre la foto, y la colisión usa un PNG de
  máscara (`horse-collision-mask.png`) rasterizado a una rejilla.

Todo lo que sigue describe el modo **video**.

---

## 3. Archivos y responsabilidades

| Archivo | Qué hace |
|---|---|
| `config.js` | Todos los parámetros en un solo objeto `CONFIG`. Nada de magia repartida. |
| `cover.js` | Matemática de `object-fit: cover`. Convierte coords normalizadas (0..1) del frame de vídeo ↔ píxeles de pantalla. |
| `tracking.js` | Keyframes del movimiento del caballo, interpolación, spline Catmull-Rom de la crin, y las primitivas de colisión. |
| `strand.js` | Un mechón: cadena de partículas ancladas arriba, con una letra por partícula. |
| `particle.js` | Partícula Verlet (`pos`, `oldPos`, `rest`, `acc`). |
| `hairSystem.js` | El sistema completo: construcción, paso de física, atlas de glifos, render. |
| `wind.js` | Viento procedural periódico sobre la duración del loop. |
| `imageSampler.js` | Solo modo static: carga de imágenes, detección de raíces, `CollisionField`. |
| `main.js` | Bootstrap, elección de modo, bucle de sincronía con el vídeo, resize, overlay de calibración. |
| `utils.js` | `clamp`, `lerp`, `smoothstep`, `hash` determinista, `sampleProfile`. |

---

## 4. El sistema de coordenadas (clave)

Todo lo que describe la posición del caballo se guarda **normalizado 0..1 en el
frame del vídeo**. En cada frame se mapea a pantalla con:

```js
// cover.js
export function computeCover(imgW, imgH, viewW, viewH) {
  const scale = Math.max(viewW / imgW, viewH / imgH);   // = object-fit: cover
  const drawW = imgW * scale, drawH = imgH * scale;
  return { scale, drawW, drawH,
           offsetX: (viewW - drawW) / 2, offsetY: (viewH - drawH) / 2 };
}

export function normToScreen(nx, ny, cover, align) {
  const ax = 0.5 + (nx - 0.5) * align.scaleX + align.offsetX;
  const ay = 0.5 + (ny - 0.5) * align.scaleY + align.offsetY;
  return { x: cover.offsetX + ax * cover.drawW,
           y: cover.offsetY + ay * cover.drawH };
}
```

En modo vídeo `align` es la identidad (`{0,0,1,1}`). La física, en cambio, corre
en **píxeles CSS de pantalla**, y el canvas se escala por `dpr` en el `setTransform`.

---

## 5. Tracking: de dónde salen las raíces

**No hay tracking real.** Hay 5 puntos de control con nombre, a lo largo de la
crin, y 5 keyframes temporales con sus posiciones escritas a mano:

```js
export const TRACK_ORDER = ["forehead","skull","upperNeck","midNeck","lowerNeck"];

export const TRACKING = {
  duration: 5.0,
  keyframes: [
    { time: 0.00, points: { forehead:[0.57,0.20], skull:[0.51,0.23],
                            upperNeck:[0.46,0.31], midNeck:[0.40,0.45],
                            lowerNeck:[0.35,0.62] } },
    { time: 1.25, points: { /* ... */ } },
    { time: 2.50, points: { /* ... */ } },
    { time: 3.75, points: { /* ... */ } },
    { time: 5.00, points: { /* idéntico a time 0, para que el loop no salte */ } },
  ],
};
```

`sampleTracking(t)` hace `t % duration`, busca el par de keyframes que rodea a
`t`, y mezcla con `smoothstep` (no lineal, para suavizar).

Luego `splinePoint(points, u)` ajusta un **Catmull-Rom** por esos 5 puntos y
devuelve un punto en `u ∈ [0,1]` a lo largo de la curva. Cada mechón guarda su
`rootU` fijo y por eso siempre nace en el mismo sitio relativo de la crin.

---

## 6. Un mechón (`strand.js`)

```js
const count = clamp(round(length / CONFIG.segmentLength),
                    CONFIG.minParticles, CONFIG.maxParticles);
const seg = length / count;

for (let i = 0; i <= count; i++) {
  const x = rootX + drift * (i / count) - seg * i * CONFIG.drapeLean;
  const y = rootY + seg * i;
  const p = new Particle(x, y, {
    pinned: i === 0,                                   // solo la raíz está fija
    char: text[(textCursor + i) % text.length],        // una letra por partícula
    scale: lerp(minScale, maxScale, hash(seed)),
    alpha: lerp(minAlpha, maxAlpha, hash(seed + 1)),
  });
  p.depth = i / count;                                 // 0 = raíz, 1 = punta
  if (i > 0) this.segments.push({ a: prev, b: p, len: seg });
}
```

El texto es un pool de palabras (`FILAMENTO MEMORY MOTION BODY SYSTEM IDENTITY
DATA 010101`) concatenado y repartido con un cursor continuo entre mechones, así
que la crin se lee como código corriendo.

La longitud de cada mechón sale de un perfil a lo largo de la crin
(`lengthProfile: [0.15, 0.45, 0.8, 1.0, 0.95, 0.75, 0.6]` — corto en la frente,
largo en medio del cuello) mapeado sobre `lengthRange: [80, 340]` px, más un
jitter determinista por mechón.

---

## 7. La física (`hairSystem.update`)

Integración **Verlet** + relajación de restricciones (estilo position-based
dynamics). Por frame:

```js
update(dt, loopTime) {
  // 1. fuerzas
  for (const p of this.particles) {
    if (p.pinned) continue;
    p.addForce(CONFIG.drapeX * p.depth, CONFIG.gravity);   // gravedad + caída lateral
    const w = this.wind.sample(p.pos.x, p.pos.y, p.depth, loopTime);
    p.addForce(w.x, w.y);
  }
  for (const p of this.particles) p.integrate(dt, CONFIG.damping);

  // 1b. convergencia al final del loop (para que los 5s cierren sin salto)
  if (this.loopConvergeK > 0) {
    for (const p of this.particles) {
      if (p.pinned) continue;
      p.pos.x += (p.rest.x - p.pos.x) * this.loopConvergeK;
      p.pos.y += (p.rest.y - p.pos.y) * this.loopConvergeK;
    }
  }

  // 2. relajación, CONFIG.iterations = 6 pasadas
  for (let it = 0; it < CONFIG.iterations; it++) {
    for (const s of this.strands)
      for (const seg of s.segments) this._solveSegment(seg);   // longitud fija
    for (const c of this.cohesion) this._solveSpring(c, CONFIG.cohesion);
    this._bendReturn();                                        // rigidez en la raíz
    if (CONFIG.collisionEnabled) this._collide();              // sacar del cuerpo
  }
}
```

Integración de partícula:

```js
integrate(dt, damping) {
  if (this.pinned) { this.acc.zero(); return; }
  const vx = (this.pos.x - this.oldPos.x) * damping;   // velocidad implícita
  const vy = (this.pos.y - this.oldPos.y) * damping;
  this.oldPos.copy(this.pos);
  const dd = dt * dt;
  this.pos.x += vx + this.acc.x * dd;
  this.pos.y += vy + this.acc.y * dd;
  this.acc.zero();
}
```

Piezas extra:

- **`_solveSegment`**: proyecta cada par de partículas a su distancia de reposo,
  repartiendo la corrección según cuál esté anclada.
- **`cohesion`**: muelles blandos horizontales entre mechones vecinos a la misma
  profundidad (solo si están a menos de `cohesionMaxDist` px). Así la crin tiene
  volumen compartido en vez de que cada mechón oscile solo.
- **`_bendReturn`**: tira las primeras `rootStiffness` (3) partículas de cada
  mechón hacia su `p.rest`, con peso decreciente. Es lo que evita que el mechón
  se doble hacia los lados justo en el nacimiento.
- **`wind`**: senos con frecuencias que son múltiplos enteros de
  `2π / videoDuration`, así el campo de viento vuelve al mismo estado exacto cada
  5 s y el loop no salta. La amplitud escala con `p.depth` (las puntas se mueven
  más que las raíces).

---

## 8. Colisión con el cuerpo (modo vídeo)

Las primitivas se derivan de los mismos puntos trackeados y se empujan "dentro"
del cuerpo, para que su superficie del lado visible quede justo bajo la crin:

```js
export function buildPrimitives(points, cfg) {
  const off = cfg.bodyOffset;
  const intoBody = (p, k = 1) => [p[0] + off * 0.35 * k, p[1] + off * k];
  const skullMid = [ (points.forehead[0]+points.skull[0])/2,
                     (points.forehead[1]+points.skull[1])/2 ];
  return [
    { type:"circle",  c: intoBody(skullMid, 1.1), r: cfg.skullRadius },
    { type:"capsule", a: intoBody(points.skull),     b: intoBody(points.upperNeck), r: cfg.neckRadius },
    { type:"capsule", a: intoBody(points.upperNeck), b: intoBody(points.midNeck),   r: cfg.neckRadius },
    { type:"capsule", a: intoBody(points.midNeck),   b: intoBody(points.lowerNeck), r: cfg.neckRadius*1.1 },
  ];
}
```s

Radios en `CONFIG.primitives`: `skullRadius: 0.09`, `neckRadius: 0.085`,
`bodyOffset: 0.05` — todos **fracciones del lado menor del rectángulo cover**.

`PrimitiveCollider.resolve(x, y)` busca la primitiva donde el punto está más
hundido y devuelve la normal de salida. Luego:

```js
_collide() {
  const step = this.collision.cell * CONFIG.collisionPush;   // 8 * 0.9 = 7.2 px
  for (const p of this.particles) {
    if (p.pinned) continue;
    const r = this.collision.resolve(p.pos.x, p.pos.y);
    if (!r) continue;
    p.pos.x += r.nx * step;  p.pos.y += r.ny * step;
    // matar velocidad para que el mechón repose y no bote
    p.oldPos.x = p.pos.x - (p.pos.x - p.oldPos.x) * 0.4;
    p.oldPos.y = p.pos.y - (p.pos.y - p.oldPos.y) * 0.4;
  }
}
```

---

## 9. Render

Los glifos se **pre-renderizan una vez** en un atlas: un canvas offscreen por
carácter. Por frame solo se hacen `drawImage`, nada de `fillText` en caliente.
El look es plano: una sola pasada de relleno rosa (`CONFIG.color`) con peso
`CONFIG.fontWeight` (300, light) y sin `shadowBlur` — el halo de neón queda
desactivado con `glowIntensity: 0`, y solo vuelve si ese valor sube de 0.

Cada glifo se orienta según la dirección local del mechón, vía `setTransform`
directo (rotación + escala + dpr en una sola matriz):

```js
const angle = Math.atan2(dy, dx) - Math.PI / 2;
ctx.setTransform(dpr*cos*s, dpr*sin*s, -dpr*sin*s, dpr*cos*s, dpr*p.pos.x, dpr*p.pos.y);
ctx.globalAlpha = p.alpha * lerp(1, 1 - CONFIG.tipFade, p.depth);
ctx.drawImage(img, -half, -half, box, box);
```

---

## 10. El bucle: sincronía con el vídeo

En vez de `requestAnimationFrame`, se usa **`requestVideoFrameCallback`** cuando
existe, para que la física avance exactamente con el frame de vídeo presentado
(`meta.mediaTime`), no con el reloj de la pantalla:

```js
const step = (now, currentTime) => {
  const dt = Math.min((now - lastPerf) / 16.6667, 2.2) || 1;
  lastPerf = now;

  hair.updateRoots(cover, currentTime);                        // 1. raíces al spline
  hair.collision.setPrimitives(primitivesToScreen(currentTime)); // 2. primitivas
  const phase = currentTime / CONFIG.videoDuration;            // 3. cierre del loop
  hair.loopConvergeK = phase > CONFIG.loopConvergeFrom
    ? smoothstep(CONFIG.loopConvergeFrom, 1, phase) * CONFIG.loopConverge : 0;
  hair.update(dt, currentTime);                                // 4. física
  renderVideo(currentTime);
};

if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
  const cb = (now, meta) => { if (!paused) step(now, meta.mediaTime);
                              videoEl.requestVideoFrameCallback(cb); };
  videoEl.requestVideoFrameCallback(cb);
} else {
  const raf = (now) => { if (!paused) step(now, videoEl.currentTime);
                         requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
}
```

`updateRoots` **no** reconstruye los mechones: solo teletransporta la partícula 0
de cada uno (`pos` y `oldPos`, para que no genere velocidad falsa). El resto de la
cadena la sigue por inercia.

Otros detalles: `prefers-reduced-motion` pausa el vídeo, corre 120 pasos de física
para que la crin se asiente, y pinta un solo frame. `visibilitychange` pausa.
El resize está debounced 150 ms y reconstruye cover + mechones.

---

## 11. Herramientas de depuración ya presentes

- Tecla **`c`** (o `?calibrate`): overlay de calibración — dibuja el spline verde
  de las raíces, las primitivas de colisión en cian, los 5 puntos con etiqueta, y
  un HUD con el tiempo actual.
- **espacio** = play/pause · **←/→** = ±0.25 s · **`,` / `.`** = ±1 frame.
- Click sobre el caballo → imprime `[x, y]` normalizado en la consola, para
  copiarlo a los keyframes.
- Tecla **`d`** (o `?debug`): overlay del modo static (rejilla de colisión + raíces).

---

## 12. Parámetros actuales relevantes

```js
strandCount: 84,  lengthRange: [80, 340],  segmentLength: 16,
minParticles: 6,  maxParticles: 32,
fontSize: 13,  fontWeight: 300,  glowIntensity: 0,   // plano, sin neón
gravity: 0.062,  damping: 0.9,  iterations: 6,  rootStiffness: 3,
cohesion: 0.14,  cohesionMaxDist: 70,  bendReturn: 0.012,
drapeX: -0.012,  drapeLean: 0.28,
windStrength: 0.16,  windVertical: 0.14,
collisionCell: 7,  collisionPush: 0.9,
loopConverge: 0.06,  loopConvergeFrom: 0.8,
primitives: { skullRadius: 0.09, neckRadius: 0.085, bodyOffset: 0.05 },
videoDuration: 5.0,  dprCap: 2,
color: "#ff2fae",
```

Datos reales del vídeo: `Caballo.mp4`, H.264, **1280×720**, **24 fps**,
**duración 5.041667 s** (121 frames), 4.5 MB.

---

## 13. Problemas concretos que veo en el código

Ordenados por cuánto explican que el efecto no pegue con el caballo.

### A. El "tracking" es a ojo, no tracking real

`TRACKING.keyframes` son 25 números escritos a mano (5 puntos × 5 tiempos) que
nunca se compararon con los píxeles reales del clip. Todo el resto del sistema
(raíces, spline, primitivas de colisión) se deriva **solo** de ahí. Si esos
números no coinciden con dónde está la crin en cada frame, la melena flota al
lado del caballo por muy bien que funcione la física. Esta es la causa raíz más
probable.

### B. `p.rest` se congela en `t = 0` mientras las raíces se mueven

`Particle.rest` se fija en el constructor, durante `build()`, con la pose del
caballo en `t = 0`, en **coordenadas de pantalla absolutas**. Y nunca se
actualiza. Pero en modo vídeo la raíz viaja por el spline en cada frame. Entonces:

- `_bendReturn()` (`hairSystem.js:277`) tira las 3 partículas superiores de cada
  mechón hacia una posición que corresponde a dónde estaba la cabeza al inicio
  del clip → mientras el caballo se mueve, el nacimiento del mechón es arrastrado
  hacia atrás, contra la raíz.
- `loopConverge` (`hairSystem.js:222`) tiene el mismo problema, aunque ahí es
  medio intencional.

Arreglo: guardar `rest` como **offset relativo a la raíz** y recalcularlo en
`updateRoots()`, en vez de como punto absoluto.

### C. `videoDuration` no coincide con la duración real

Config dice `5.0`, el mp4 dura `5.041667` (24 fps × 121 frames). `sampleTracking`
hace `t % 5.0`, así que el último frame del clip se interpreta como `t ≈ 0.042`
→ un salto en el punto exacto donde el loop debía ser invisible. Además
`loopConvergeFrom` se calcula con la duración mala. También el step por frame en
la calibración usa `1/30` cuando el clip es de `1/24`.

### D. Las primitivas de colisión son enormes y están mal centradas

`neckRadius: 0.085` es fracción de `min(drawW, drawH)`. En una ventana 1440×900
con un vídeo 1280×720: `scale = max(1440/1280, 900/720) = 1.25` → `drawH = 900`
→ radio ≈ **76 px**. Y `bodyOffset: 0.05` mete el centro solo 45 px hacia dentro.
Resultado: la superficie de la cápsula queda ~31 px **por encima** de la línea de
la crin, o sea el volumen de colisión se come la crin misma. Cada partícula que
nace ahí es expulsada radialmente. Con `step = cell(8) × collisionPush(0.9) = 7.2
px` por iteración × 6 iteraciones, hasta 43 px de empuje por frame: la melena se
despega del cuello y levita.

### E. El click de calibración está muerto

`style.css` pone `#mane { pointer-events: none }`, pero `main.js:341` registra
`canvas.addEventListener("click", ...)` para imprimir las coords normalizadas.
Ese listener nunca dispara — el click atraviesa al vídeo. O sea: el paso 3 del
flujo de calibración documentado en `tracking.js` es imposible tal como está.
Arreglo: escuchar en `window` en vez del canvas, o poner `pointer-events: auto`
mientras el overlay de calibración está activo.

### F. Detalles menores

- `PrimitiveCollider` no tiene `.field` / `.cols` / `.rows`, así que
  `drawDebug()` silenciosamente no dibuja nada en modo vídeo.
- `collision.rawNormal = true` se enchufa como propiedad ad-hoc desde `main.js`
  en vez de pasarse al constructor; fácil de perder de vista.
- `PrimitiveCollider.cell = 8` es un número inventado que solo existe para
  alimentar la fórmula de `step`; no representa ninguna rejilla real.
- `Caballo.mp4`, `Caballo1.png` y las dos máscaras PNG están duplicados en la
  carpeta padre y en `horse/`.

---

## 14. Pregunta para el que revise esto

Dado lo anterior: ¿en qué orden conviene atacarlo, y cuál es la forma correcta de
resolver A (conseguir un tracking real de la línea de la crin en un clip de 5 s /
121 frames) y B (`rest` relativo a una raíz que se mueve) sin rehacer el sistema?
