// ============================================================================
//  STAGE — handshake between a piece and the shell (the root index.html).
//
//  Without it the shell fades a piece in the moment its document loads, which is
//  long before the piece has letters: the video paints first (it is the fastest
//  thing on the page), then the tracking JSON arrives, then the strands are
//  built, then they settle. From outside that reads as "the horse appears, and
//  a second later its mane" — exactly what this file exists to prevent.
//
//  The contract, both directions:
//    piece  → shell : "curtain:ready"  — I have PAINTED a frame with letters on
//                                       it. Safe to show me.
//    shell  → piece : "curtain:show"   — you are on screen again; resume.
//                     "curtain:hide"   — you are parked; stop your solver AND
//                                       your clip.
//
//  Both halves of "hide" have to be done by hand. display:none does not stop rAF
//  the way it is often assumed to: Chrome kept firing it 19 times/s inside a
//  hidden iframe (measured 2026-08-12), and one unparked piece left solving
//  behind another cost the visible one 30.7 -> 18.6 fps. And it does not stop
//  media either, so a parked piece would keep advancing its clip under a frozen
//  canvas and come back with the letters a second of footage behind the body they
//  hang from. Hence: every piece stops its own solver on hide, and any piece with
//  a clip pauses that too.
//
//  Opened on its own (http://localhost:8000/fish/), there is no parent and every
//  function here is a no-op.
// ============================================================================

const inShell = window.parent !== window;

// Say it once per boot, after the first real paint — not after build(), which is
// a frame too early: the canvas is still empty at that point.
export function stageReady() {
  if (!inShell) return;
  try {
    window.parent.postMessage({ type: "curtain:ready" }, "*");
  } catch (err) {
    console.warn("No pude avisar al shell de que la pieza está lista.", err);
  }
}

// El cartel "click for sound" del shell tiene que irse EN el clic, no medio
// segundo después. Pero la pieza ocupa el viewport entero, así que el primer
// clic cae dentro de ESTE documento y el shell no ve el evento — el mismo
// problema que el lecho de sonido, con la nota larga en shared/js/ambient.js,
// que allí se resuelve sondeando cada 500 ms. Aquí no hace falta sondear: este
// documento sí ve el gesto, y lo único que tiene que hacer es contarlo. Una vez
// y se desengancha; lo que pase después ya no le importa a nadie.
if (inShell) {
  const PRESS = ["pointerdown", "mousedown", "touchstart", "keydown", "wheel"];
  const tell = () => {
    for (const type of PRESS) window.removeEventListener(type, tell, true);
    try {
      window.parent.postMessage({ type: "curtain:press" }, "*");
    } catch {}
  };
  for (const type of PRESS) {
    window.addEventListener(type, tell, { passive: true, capture: true });
  }
}

export function onStage({ onShow, onHide } = {}) {
  if (!inShell) return;
  window.addEventListener("message", (e) => {
    if (e.source !== window.parent) return;
    const type = e.data?.type;
    if (type === "curtain:show") onShow?.();
    else if (type === "curtain:hide") onHide?.();
  });
}
