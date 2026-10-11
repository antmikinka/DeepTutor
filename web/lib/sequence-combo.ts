/**
 * The quest-mode combo as a pure reducer: zero I/O, zero React.
 *
 * Events fire only from fulfilled server responses — never optimistically —
 * so the badge always shows what the server has actually accepted. A
 * transport error is not a wrong answer and must leave the combo untouched.
 */

export type ComboEvent =
  | { type: "accept" } // place response accepted:true
  | { type: "reject" } // place response accepted:false
  | { type: "remove" } // successful remove response
  | { type: "solve" } // problem became solved (either mode)
  | { type: "transport-error" } // network failure — NOT a wrong answer
  | { type: "reset" }; // new problem / leave problem

export interface ComboState {
  combo: number;
  peak: number;
  frozen: boolean;
}

export const initialCombo: ComboState = { combo: 0, peak: 0, frozen: false };

export function nextCombo(state: ComboState, event: ComboEvent): ComboState {
  switch (event.type) {
    case "accept":
      if (state.frozen) return state;
      return {
        combo: state.combo + 1,
        peak: Math.max(state.peak, state.combo + 1),
        frozen: false,
      };
    case "reject":
    case "remove":
      return state.frozen ? state : { ...state, combo: 0 };
    case "solve":
      // Freeze at peak for the celebration; later events cannot lower it.
      return { ...state, frozen: true };
    case "transport-error":
      return state;
    case "reset":
      return initialCombo;
  }
}
