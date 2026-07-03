// Voice command registry: the single source of truth for what can be said.
// app.ts builds its recognizer lookup tables from these specs, and the help
// panel (src/help.ts) renders its command list from the same specs — so a
// command added here shows up in both automatically and the two can't drift.

export interface CommandSpec {
  id: string;
  /** English trigger phrases, lowercase (matching normalizes case). */
  en: string[];
  /** Japanese trigger phrases, exact (kana/kanji as the recognizer emits them). */
  ja: string[];
  /** Effect shown in the help panel. */
  description: string;
}

// Available on every card during a session.
export const SHARED_COMMANDS: CommandSpec[] = [
  {
    id: 'next',
    en: ['next'],
    ja: ['次', 'つぎ', 'ねくすと', 'ネクスト'],
    description: 'Advance to the next card',
  },
  {
    id: 'wrong',
    en: ['wrong', 'incorrect', 'mistake'],
    ja: ['間違い', 'まちがい', '不正解', 'ふせいかい', 'だめ', 'ダメ', '駄目'],
    description: 'Mark the current answer wrong',
  },
  {
    // Resuming by voice while paused is impossible (recognition is stopped),
    // so this is deliberately pause-only — resuming needs the UI control.
    id: 'pause',
    en: ['pause', 'stop listening'],
    ja: ['ストップ'],
    description: 'Mute the mic (click the Muted chip to resume)',
  },
];

// BunPro Reveal & Grade cards while the answer is hidden.
export const REVEAL_COMMANDS: CommandSpec[] = [
  {
    id: 'reveal',
    en: ['reveal', 'show', 'show answer', 'answer'],
    ja: ['見せて', 'みせて', '答え', 'こたえ'],
    description: 'Show the answer',
  },
];

// BunPro Reveal & Grade cards once the answer is shown.
export const GRADE_COMMANDS: CommandSpec[] = [
  {
    id: 'grade-good',
    en: ['good', 'known', 'correct'],
    ja: ['わかった', '分かった'],
    description: 'Grade as known',
  },
  {
    id: 'grade-bad',
    en: ['bad', 'again'],
    ja: ['わからない', '分からない'],
    description: 'Grade as not known',
  },
];

// Checked only after answer matching fails: "help" is itself an accepted
// meaning on some cards (助け, 手伝う, …), so unlike the shared commands it
// must never shadow a correct answer. 助けて is deliberately absent for the
// same reason. See the low-priority routing in app.ts.
export const HELP_COMMANDS: CommandSpec[] = [
  {
    id: 'help',
    en: ['help', 'commands'],
    ja: ['ヘルプ', 'へるぷ', 'コマンド'],
    description: 'Show or hide this command list',
  },
];

export type HelpMode = 'standard' | 'reveal-hidden' | 'reveal-shown';

// The commands that can actually do something right now, in display order —
// mode-specific commands first since they're the ones the user is stuck on.
export function commandsForMode(mode: HelpMode): CommandSpec[] {
  if (mode === 'reveal-hidden') return [...REVEAL_COMMANDS, ...SHARED_COMMANDS, ...HELP_COMMANDS];
  if (mode === 'reveal-shown') return [...GRADE_COMMANDS, ...SHARED_COMMANDS, ...HELP_COMMANDS];
  return [...SHARED_COMMANDS, ...HELP_COMMANDS];
}

// Flatten specs into the phrase → action lookup app.ts matches against.
// Throws on an unmapped spec so a registry/action mismatch fails loudly in
// tests instead of silently dropping a command.
export function buildCommandTable(
  specs: CommandSpec[],
  actions: Record<string, () => unknown>,
): Record<string, () => unknown> {
  const table: Record<string, () => unknown> = {};
  for (const spec of specs) {
    const action = actions[spec.id];
    if (!action) throw new Error(`no action bound for command '${spec.id}'`);
    for (const phrase of [...spec.en, ...spec.ja]) table[phrase] = action;
  }
  return table;
}
