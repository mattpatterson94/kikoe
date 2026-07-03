// kansuji ships no type declarations. Minimal surface: converts a numeric
// string (or number) to kanji numerals, e.g. kansuji('123') → '百二十三'.
declare module 'kansuji' {
  function kansuji(value: number | string): string;
  export default kansuji;
}
