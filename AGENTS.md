# Athanor working instructions

## UI and interaction changes

- Read the relevant current Apple Human Interface Guidelines before each UI/UX change. Use official Apple sources; when the web page requires JavaScript, its official DocC JSON under `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<topic>.json` is suitable.
- Preserve Athanor's existing shadcn components, theme tokens, typography, colors, spacing and visual language. Apply HIG to behavior, clarity, accessibility and context; do not replace the design with an Apple visual skin.
- Keep navigation and address entry predictable. Inspired by Touch Bar, reveal actions relevant to the selected page or current operation without overcrowding the toolbar. Provide equivalent actions in More and existing keyboard shortcuts.
- Use measured progress. For unknown totals, show indeterminate activity and received bytes. Keep progress in a consistent place and explain pauses, interruptions and recovery actions.
- Keep notifications brief, actionable and readable above native page webviews. Progress events must not generate repeated toasts. Keep recent messages accessible.
- Record guidance links and the implementation rationale in `docs/HIG.md`. Distinguish build checks from runtime verification; do not claim unobserved behavior was verified.

## Browser integrations

- Preserve HTTP methods, authentication redirects and signed download/media URLs. Do not cancel and replay form submissions as plain GET requests.
- Never seek, change playback speed or mute YouTube's shared video element automatically to skip ads.
- Browser password migration uses user-selected official exports, encrypted storage and exact-origin filling. Plaintext passwords must not enter logs or shell state.
- 280blocker rules are personal-use downloads from the official monthly URL. Do not bundle or redistribute their content; keep the subscription opt-in and show the publisher's terms.
