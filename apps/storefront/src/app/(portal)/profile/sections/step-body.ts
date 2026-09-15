/**
 * What every card of the profile flow gives the dialog around it.
 *
 * The dialog owns the one primary button, the Back button and the step strip.
 * A body owns its fields, its checks and its writes, and may have steps of its
 * own — the Account card has two, Contacts and delivery has five. The two
 * meet through three callbacks: `registerSubmit` hands over what the primary
 * button should call, `onFrame` says which of the body's own steps is showing
 * (and what the button should read), and `onSaved` fires only once the
 * server has agreed that the whole card is complete.
 */
export interface StepFrame {
  /** 1-based, within this card. */
  index: number;
  count: number;
  /** Present when there is a previous step inside this card to go back to. */
  back?: () => void;
  /** "Continue" between steps, "Save" on the last one. */
  primaryLabel: string;
}

export interface StepBodyProps {
  registerSubmit: (submit: () => void) => void;
  onBusy: (busy: boolean) => void;
  onFrame: (frame: StepFrame) => void;
  onSaved: () => void;
}
