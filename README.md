# Hermes Messenger

A Telegram / iMessage-style chat for the [Hermes Agent](https://hermes-agent.nousresearch.com) desktop app.
No noise, just results.

- **Bubbles.** Your messages sit on the right in your theme's accent colour, the agent's on the left. Consecutive replies group together, and everything stays in a readable 800px column with the composer lined up underneath.
- **A noise filter** with three levels, switched from the status bar:
  - **All**: everything, as stock Hermes shows it.
  - **Calm** (default): tool calls, thinking and background notices stay visible but faded. Hover one to read it.
  - **Results**: only answers and things that need you. Approvals, clarifying questions and generated images are **never** hidden. Hold **⌥ / Alt** to peek at the hidden work.
- **A typing bubble** that follows the app's real busy state, so you can tell the agent is working even when Results mode hides the work.
- **Motion.** New messages spring in; history loads and session switches stay still. Respects *Reduce motion*.
- **No sticky prompt** clipping the transcript (you can switch it back on).
- **Works with any theme, light or dark.** The bubble colour comes from your theme's accent, darkened just enough for white text to meet WCAG AA contrast.

## Install

Copy the folder into your Hermes desktop plugins directory and restart the app (or reload the window):

```bash
git clone https://github.com/<you>/hermes-messenger ~/.hermes/desktop-plugins/hermes-messenger
```

Open it from the **status bar chip** (bottom right), or from the command palette under *Messenger*.
**⌘⌥F** (Ctrl+Alt+F) cycles All → Calm → Results.

To remove it, disable it in **Capabilities → Plugins**, or delete the folder. It only changes styling, so disabling it restores the stock app exactly.

## How it works

It's a single `plugin.js` with no build step and no dependencies. It:

- injects one stylesheet that targets the app's stable `data-slot` hooks;
- sets a few `data-hm-*` attributes on `<html>` to switch modes;
- uses a small MutationObserver so only genuinely new bubbles animate.

It never reads or changes messages, sessions, the backend, or the network. Settings are saved in plugin storage.

## Compatibility

Built and tested against Hermes Desktop **0.21.x**. If a future Hermes version renames a `data-slot`, the affected style stops applying; nothing breaks. Please open an issue if that happens.

## License

MIT
