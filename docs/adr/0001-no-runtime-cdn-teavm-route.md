# No third-party runtime CDN: compile FreeCol with TeaVM

FreeCol's Swing client could plausibly run unmodified under CheerpJ, but CheerpJ's free licence requires loading its closed runtime from Leaning Technologies' CDN on every visit, and self-hosting needs a paid commercial licence. We won't depend on a third party's CDN to keep the game running, so CheerpJ is out entirely. Instead the Engine (FreeCol's model, server, AI and non-GUI client) is compiled with TeaVM to Wasm GC and served from our own static site, with GraalVM Web Image as the fallback if TeaVM can't build or run it. The cost is that FreeCol's 72K-line Swing GUI doesn't come along: we build a new Browser UI.

## Considered Options

- CheerpJ via CDN (free): rejected, third-party runtime dependency.
- CheerpJ self-hosted (paid): rejected, cost and a closed binary in a GPL project.
- LLM or tool translation of Java to TypeScript: rejected earlier, forks FreeCol for good.
