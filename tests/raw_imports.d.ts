// Vite's `?raw` suffix imports a file's text verbatim; tests use it to read
// README.md without node:fs (whose types aren't installed — see tsconfig
// "types"). Only .md is declared to keep the escape hatch narrow.
declare module '*.md?raw' {
  const content: string;
  export default content;
}
