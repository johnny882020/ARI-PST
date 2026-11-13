# Self-hosting fonts

Fonts in the stacks: Heebo (body, Hebrew + Latin), Rubik (display), Assistant (fallback). All are believed to be SIL Open Font License 1.1. License is UNVERIFIED here. Confirm on the source page before bundling and store each `OFL.txt` in this folder.

Steps:
1. Download the OFL files from the font project (not from a CDN at runtime).
2. Subset to Hebrew + Latin + digits + punctuation, export WOFF2 (for example with `pyftsubset`).
3. Put the files here, for example `Heebo-Variable.woff2` and `Rubik-Variable.woff2`.
4. In `src/styles/fonts.css`, add `url("../../fonts/Heebo-Variable.woff2") format("woff2")` after `local(...)`.
5. Preload the Hebrew body face in the app HTML. Budget: 120 KB total on the public home page (UNVERIFIED target).

No font file is committed yet. The font stacks already fall back to system fonts.
