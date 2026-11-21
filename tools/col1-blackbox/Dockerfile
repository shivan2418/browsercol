# Runs the user's own GOG copy of Colonization (1994) in DOSBox on a hidden
# X display, driven by keystrokes, observed only through screenshots.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      dosbox xvfb xdotool imagemagick x11-utils python3 python3-pil tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /harness
