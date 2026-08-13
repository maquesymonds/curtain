// ============================================================================
//  JSON FILE I/O — download a JSON object, or pick one off disk.
//  Shared by every authoring tool; there is nothing piece-specific in here.
// ============================================================================

export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // give the browser a tick to start the download before revoking
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Open a file picker and resolve with the file's text, or null if cancelled.
// Parsing and validation are the caller's job — it knows what a valid file is.
export function pickJSONText() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    document.body.appendChild(input);

    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.remove();
      resolve(file ? await file.text() : null);
    });
    // Cancelling a file dialog fires no event in every browser, so the element is
    // left to the GC in that case; harmless and display:none.
    input.click();
  });
}

// Round a coordinate pair list to a fixed number of decimals, so exported files
// don't carry 17 digits of float noise per number.
export function roundPairs(pairs, decimals) {
  const f = 10 ** decimals;
  return pairs.map((p) => [Math.round(p[0] * f) / f, Math.round(p[1] * f) / f]);
}
