// Renders the README's voice-command tables from the command registry
// (src/commands.ts), the same source the recognizer and the in-page help
// panel use, so the docs can't drift from what can actually be said. Each
// generated table sits between BEGIN/END marker comments in README.md; this
// module rewrites the text between them and reports which sections changed.
//
// Pure string → string on purpose: the CLI wrapper (readme-commands.js)
// owns file I/O, and tests/readme_tables.test.ts verifies the committed
// README is current without touching the filesystem.

import {
  SHARED_COMMANDS,
  REVEAL_COMMANDS,
  GRADE_COMMANDS,
  HELP_COMMANDS,
  type CommandSpec,
} from '../src/commands.ts';

export const REGEN_COMMAND = 'npm run readme:commands';

// `|` would end a table cell early, so escape it just in case a phrase or
// description ever contains one.
function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function phrases(list: string[]): string {
  return list.map((p) => `\`${cell(p)}\``).join(' / ');
}

function table(headers: string[], rows: string[][]): string[] {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [
    line(headers),
    line(headers.map((h) => '-'.repeat(h.length))),
    ...rows.map((r) => line(r.map(cell))),
  ];
}

function voiceCommandsTable(): string[] {
  return table(
    ['Say (English)', 'Say (Japanese)', 'Action'],
    [...SHARED_COMMANDS, ...HELP_COMMANDS].map((spec) => [
      phrases(spec.en),
      phrases(spec.ja),
      spec.description,
    ]),
  );
}

function revealGradeTable(): string[] {
  const row = (spec: CommandSpec, when: string) => [
    phrases(spec.en),
    phrases(spec.ja),
    when,
    spec.description,
  ];
  return table(
    ['Say (English)', 'Say (Japanese)', 'When', 'Action'],
    [
      ...REVEAL_COMMANDS.map((spec) => row(spec, 'Answer hidden')),
      ...GRADE_COMMANDS.map((spec) => row(spec, 'Answer shown')),
    ],
  );
}

interface Section {
  name: string;
  /** Prefix for every generated line — the BunPro table nests inside a list item. */
  indent: string;
  render: () => string[];
}

const SECTIONS: Section[] = [
  { name: 'voice-commands', indent: '', render: voiceCommandsTable },
  { name: 'bunpro-reveal-grade', indent: '  ', render: revealGradeTable },
];

function beginMarker(name: string): string {
  return `<!-- BEGIN GENERATED ${name} (from src/commands.ts — regenerate with \`${REGEN_COMMAND}\`) -->`;
}

function endMarker(name: string): string {
  return `<!-- END GENERATED ${name} -->`;
}

export interface RegenResult {
  /** README text with every generated section rewritten from the registry. */
  content: string;
  /** Names of sections whose text differed — empty means the README is current. */
  changed: string[];
}

export function regenerateReadmeTables(readme: string): RegenResult {
  let content = readme;
  const changed: string[] = [];
  for (const section of SECTIONS) {
    const begin = section.indent + beginMarker(section.name);
    const end = section.indent + endMarker(section.name);
    const beginAt = content.indexOf(begin);
    const endAt = content.indexOf(end);
    if (beginAt === -1 || endAt < beginAt) {
      throw new Error(
        `README.md is missing the "${section.name}" markers:\n  ${begin}\n  ${end}`,
      );
    }
    const body = section.render().map((line) => section.indent + line);
    const replacement = [begin, ...body, end].join('\n');
    const existing = content.slice(beginAt, endAt + end.length);
    if (existing !== replacement) changed.push(section.name);
    content = content.slice(0, beginAt) + replacement + content.slice(endAt + end.length);
  }
  return { content, changed };
}
