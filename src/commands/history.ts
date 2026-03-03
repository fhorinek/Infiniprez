import type { Command, HistoryState } from './types'

const MAX_HISTORY_ENTRIES = 200

export function createEmptyHistory<TState>(): HistoryState<TState> {
  return { past: [], future: [] }
}

export function executeCommand<TState>(
  state: TState,
  history: HistoryState<TState>,
  command: Command<TState>
) {
  const nextState = command.execute(state)

  return {
    state: nextState,
    history: recordExecutedCommand(history, command),
  }
}

export function recordExecutedCommand<TState>(
  history: HistoryState<TState>,
  command: Command<TState>
): HistoryState<TState> {
  const past = [...history.past, command]
  const boundedPast =
    past.length > MAX_HISTORY_ENTRIES ? past.slice(past.length - MAX_HISTORY_ENTRIES) : past

  return {
    past: boundedPast,
    future: [],
  }
}

export function undoCommand<TState>(state: TState, history: HistoryState<TState>) {
  const command = history.past[history.past.length - 1]
  if (!command) {
    return { state, history }
  }

  const previousState = command.undo(state)
  return {
    state: previousState,
    history: {
      past: history.past.slice(0, -1),
      future: [command, ...history.future],
    },
  }
}

export function redoCommand<TState>(state: TState, history: HistoryState<TState>) {
  const [command, ...remainingFuture] = history.future
  if (!command) {
    return { state, history }
  }

  const nextState = command.execute(state)
  return {
    state: nextState,
    history: {
      past: [...history.past, command],
      future: remainingFuture,
    },
  }
}

export function combineCommands<TState>(
  label: string,
  commands: Command<TState>[]
): Command<TState> {
  return {
    label,
    execute: (state) => commands.reduce((nextState, command) => command.execute(nextState), state),
    undo: (state) =>
      [...commands].reverse().reduce((nextState, command) => command.undo(nextState), state),
  }
}
