/**
 * Interactive checkbox prompt with keyboard navigation.
 *
 * Renders a list of items the user can navigate with arrow keys,
 * toggle with space, and confirm with enter.
 *
 * Uses `readline.emitKeypressEvents()` to parse terminal escape sequences
 * into structured keypress events, avoiding manual escape-code buffering.
 */

import { emitKeypressEvents } from 'readline';

export interface CheckboxItem {
  /** Display label */
  label: string;
  /** Suffix shown after the label (e.g., "(not detected)") */
  hint?: string;
  /** Whether this item is initially selected */
  selected: boolean;
}

export interface CheckboxOptions {
  /** If true, Enter is blocked when no items are selected (default: false) */
  requireSelection?: boolean;
}

export interface CheckboxResult {
  /** Indices of selected items */
  selected: number[];
}

/**
 * Show an interactive checkbox prompt in the terminal.
 *
 * Uses raw stdin mode to capture keystrokes. Falls back to returning
 * the initial selection if stdin is not a TTY (e.g., piped input).
 *
 * Controls:
 *   ↑/↓ or k/j — move cursor
 *   space       — toggle selection
 *   enter       — confirm
 *   a           — select all
 *   n           — select none
 */
export function checkboxPrompt(
  items: CheckboxItem[],
  options?: CheckboxOptions,
): Promise<CheckboxResult> {
  const requireSelection = options?.requireSelection ?? false;

  // Non-interactive fallback: return initial selection
  if (!process.stdin.isTTY) {
    const selected = items.map((item, i) => (item.selected ? i : -1)).filter((i) => i >= 0);
    return Promise.resolve({ selected });
  }

  /* v8 ignore start -- interactive TTY code requires a real terminal */
  return new Promise((resolve) => {
    const state = items.map((item) => item.selected);
    // Extra row at the end for the "Done" button
    const totalRows = items.length + 1;
    let cursor = 0;

    function render(initial: boolean): void {
      // Move cursor up to overwrite previous render (skip on first render)
      if (!initial) {
        process.stdout.write(`\x1B[${totalRows}A`);
      }

      for (let i = 0; i < items.length; i++) {
        const pointer = i === cursor ? '\x1B[36m❯\x1B[0m' : ' ';
        const check = state[i] ? '\x1B[32m✓\x1B[0m' : ' ';
        const hint = items[i].hint ? ` \x1B[2m${items[i].hint}\x1B[0m` : '';
        process.stdout.write(`\x1B[2K  ${pointer} [${check}] ${items[i].label}${hint}\n`);
      }

      // "Done" button row
      const count = state.filter(Boolean).length;
      const doneDisabled = requireSelection && count === 0;
      const donePointer = cursor === items.length ? '\x1B[36m❯\x1B[0m' : ' ';
      const doneStyle = doneDisabled ? '\x1B[2m' : '\x1B[1m';
      const doneSuffix = doneDisabled ? ' (select at least one)' : ` (${count} selected)`;
      process.stdout.write(`\x1B[2K  ${donePointer} ${doneStyle}Done\x1B[0m${doneSuffix}\n`);
    }

    render(true);

    const stdin = process.stdin;

    // emitKeypressEvents must be called BEFORE setRawMode.
    // It's safe to call multiple times — it no-ops if already active.
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();

    const onKeypress = (_ch: string | undefined, key: KeypressKey | undefined): void => {
      if (!key) {
        return;
      }

      // Ctrl-C
      if (key.ctrl && key.name === 'c') {
        stdin.setRawMode(false);
        process.exit(130);
      }

      if (key.name === 'up' || key.name === 'k') {
        cursor = cursor > 0 ? cursor - 1 : totalRows - 1;
        render(false);
      } else if (key.name === 'down' || key.name === 'j') {
        cursor = cursor < totalRows - 1 ? cursor + 1 : 0;
        render(false);
      } else if (key.name === 'space') {
        if (cursor < items.length) {
          state[cursor] = !state[cursor];
          render(false);
        }
      } else if (key.name === 'return') {
        const hasSelection = state.some(Boolean);
        if (requireSelection && !hasSelection) {
          // Don't allow confirming with nothing selected
          return;
        }
        finish();
      } else if (key.name === 'a') {
        state.fill(true);
        render(false);
      } else if (key.name === 'n') {
        state.fill(false);
        render(false);
      }
    };

    function finish(): void {
      stdin.removeListener('keypress', onKeypress);
      stdin.setRawMode(false);
      stdin.pause();

      const selected = state.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
      resolve({ selected });
    }

    stdin.on('keypress', onKeypress);
  });
  /* v8 ignore stop */
}

/**
 * Node.js keypress event key descriptor.
 * Not exported from @types/node, so we define the subset we use.
 */
interface KeypressKey {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}
