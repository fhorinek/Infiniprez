export interface Command<TState> {
  label: string
  execute: (state: TState) => TState
  undo: (state: TState) => TState
}

export interface HistoryState<TState> {
  past: Command<TState>[]
  future: Command<TState>[]
}

export const EMPTY_HISTORY: HistoryState<never> = {
  past: [],
  future: [],
}
