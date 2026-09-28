# Changelog

## Reply context during busy sends

- Reply/Quote now writes its reference into the actual draft through the scoped composer SDK, rather than depending on send middleware that Desktop skips while steering a busy agent. The quote is visible/editable before sending.
- A new selection replaces the old reference without discarding the typed answer. Detected concurrent edits, missing composers and scope changes fail without overwriting the newer draft. No message is sent automatically.
- Removed hidden pending-reply state and its stale composer overlay. Removing the visible quote block cancels it.
- Hermes core is unchanged. Report: [#126917](https://github.com/NousResearch/hermes-agent/issues/126917).

## Current incoming message visibility

- Show the full claimed input in the focused Bot Chat while it is being handled, with sender attribution. Expand an existing matching source thread rather than creating a second copy. The temporary live view is removed on settlement, scope switch, failure or disposal; it never writes to the conversation.
- Claimed inbox items link to their chat view. Waiting-time guidance is omitted when there are no queued items.
- GET /inbox now returns full text only for claimed records. Reads do not claim, settle, reorder or resend a delivery.
- Backend reload is required for full text. An older running backend displays a clearly labelled preview rather than pretending it is complete.

## Bot-message attribution fallback

- Recognize Bot Mode envelopes with parenthesized display names when the host leaves them as ordinary user bubbles. The parser uses the final handle suffix rather than treating the first parenthesis as a handle.
- Render a centered, attributed incoming thread without changing stored messages or hiding the recipient's subsequent reply. Remote connection labels are retained and do not borrow a local bot's avatar.
- Ordinary mentions, quoted replies and malformed envelopes remain unchanged; HTML in a message body is escaped. Disabling restores the original presentation.
- Attribution is inferred from the text envelope, as in the host; it is not an authentication signal or permission grant.

## Command approval presentation

- Separate header, exact-command preview and action footer; opaque surfaces in both inline and floating placements.
- Larger controls in native visual/keyboard order (Reject, permissions menu, Run), stacked in narrow panes. No changes to approval choices, policy, confirmation or submission handlers.
- Bounded, selectable command text with an explicit scroll notice. Keyboard users can focus the preview; plugin teardown restores attributes it added.
- Added synthetic approval layout checks for light/dark, phone/desktop, inline/floating cards, restricted choices, disabled states, scroll notices and cleanup. These do not execute commands or validate live approval RPCs.

## Message-flicker correction

- Fixed a visibility feedback loop in duplicate-message filtering. Reading `innerText` from a visible message and then from a hidden message produced different paragraph/list separators, causing the duplicate to alternate between visible and hidden. Classification now reads detached text with explicit block boundaries, independent of layout.
- Added a synthetic frame-by-frame stability regression for paragraphs, lists and line breaks in All / Calm / Results, including expansion and teardown. The six flickering scenarios reproduce on the old code and stay stable with the fix.
- This changes only presentation; stored messages and delivery queues are untouched.

## Long-answer correction and feature roll-up

### Fixed

- Long clarification answers, URLs and unbroken strings no longer widen the option rows beyond the question card. Grid tracks may shrink and textareas wrap within their available space, growing vertically up to a scrollable cap. Single and batched free-text-only questions retain full-width fields.
- Inbox reads are tied to the connection, profile and Bot Chat they came from. Older asynchronous responses cannot overwrite a newer view or reappear after disposal.
- Inbox confirmations and recovery text remain with the originating Bot Chat rather than leaking into another bot's composer.
- Ambiguous request failures warn that the action may already have happened. A successful submission followed by a navigation failure no longer invites an automatic resend.
- Documentation distinguishes presentation changes from confirmed delivery cancellations and side-chat submissions. Disabling the plugin does not undo those actions.

### Included features

- Reply-to-message and selected-text quoting, with a centred hover reply button and jump-to-original quote cards.
- Handle now / Skip with confirmation for queued inbox items; claimed items remain protected. Stale-owner matches are shown separately as stuck.
- Needs-you badges, expandable no-action summaries and All / Calm / Results filtering.
- Neutral automatic system notes, instead of outgoing user bubbles.
- Collapsible bot-to-bot threads, merged reply notices and SDK-rendered saved blob avatars when available.
- Cron/task cards, media/file previews, reactions, typing indicators and reduced-motion support.

### Verification

The long-answer browser test ships with synthetic data only. Current layout/typing/scrolling coverage is 42 passing assertions across desktop and phone sizes in both themes. Existing presentation regression checks also pass. The earlier inbox corrections have reviewed synthetic-host evidence, not live authenticated acceptance.

Publishing source is not installation. No app restart, real answer submission or live inbox action is performed by this release. The host's translucent floating composer while scrolled up remains unchanged.
