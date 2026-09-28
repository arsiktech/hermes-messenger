# Changelog

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
