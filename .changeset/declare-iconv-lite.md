---
"hyphos": patch
---

Declare `iconv-lite` as a direct dependency. The bundled CLI requires it at
startup for charset decoding, but the tree carried it only as a nested
transitive of `mailparser`, so production installs (`--omit=dev`) could start
no command: `Cannot find module 'iconv-lite'`. A new `pack:smoke` check now
installs the packed tarball production-only and starts the CLI, so an
undeclared runtime requirement fails before release.
