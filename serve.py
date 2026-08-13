#!/usr/bin/env python3
"""Servidor de desarrollo para curtain, sin caché.

`python3 -m http.server` no manda cabeceras de caché, así que Chrome aplica su
heurística y sirve el JS y los JSON viejos. Se han perdido varias iteraciones por
eso: en una, la página corría un config.js cacheado al que le faltaba una clave
nueva y las longitudes salían NaN, y el diagnóstico se fue al código en vez de a
la caché.

    python3 serve.py 8000     ->  http://localhost:8000/willow/
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Silencia el ruido de 200 y deja solo lo que importa (404, 500...).
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(NoCacheHandler, directory=".")
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"curtain servido sin caché en http://localhost:{port}/")
        print(f"  willow -> http://localhost:{port}/willow/")
        print(f"  horse  -> http://localhost:{port}/horse/")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nparado")


if __name__ == "__main__":
    main()
