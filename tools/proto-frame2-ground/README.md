# PROTOTYPE: frame-2 ground from tiles

Throwaway. This answers one question: can the renderer make frame 2's look from plain tile data, and is it cheap enough for a netbook? Frame 2's look is soft, wandering terrain borders, curved coasts with a beach and surf, and a winding river.

Run it: serve this folder (`python3 -m http.server`) and open `index.html`. Use `?view=guide`, `large` (beside frame 2) or `big` (a random 120 × 80 map, drag to pan). The Benchmark button times the ground shader.

How it works:

- **Ground:** one WebGL2 fragment shader. Each terrain has one seamless texture from gpt-image-2-5-flare, with frame 2 as the style reference. For each pixel, the shader mixes the textures of the 3 × 3 nearby tiles. Each tile's weight is a soft square around its centre, sampled at a noise-warped position, so borders wander off the tile lines. Each texture's brightness pushes its edge in or out, which makes the edges ragged.
- **Coast:** a smoothed, noise-warped land fraction. Where it crosses 0.5 is the coastline; just above that is a sand band, and just below are shallows and surf streaks.
- **River:** distance to the river's segments, at a noise-warped position.
- **Trees:** sprites on a 2D canvas on top, five per forest tile at seeded spots, drawn back to front.

Speed: the ground costs about 2.3 ms per 1920 × 1080 frame on an RX 6600, measured in Chromium with ANGLE on GL or Vulkan. It has not been measured on integrated graphics. The verdict is in `docs` on the issue / in the session that made it.
