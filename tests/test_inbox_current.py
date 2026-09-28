"""Synthetic, read-only tests of the GET /inbox handler.

Run with an installed Python that has FastAPI:
    PYTHONDONTWRITEBYTECODE=1 python -B tests/test_inbox_current.py -v

Calls inbox() directly with explicit temporary-home injection. Session lookup
and live-owner discovery are substituted: this does NOT prove authenticated
host routing, real session discovery, or live delivery actions. No live Hermes
queues, chats, configuration, or delivery modules are read or invoked.
"""
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1] / "dashboard" / "inbox_api.py"
SPEC = importlib.util.spec_from_file_location("messenger_inbox_under_test", SOURCE)
assert SPEC is not None and SPEC.loader is not None
api = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(api)

NOW = 1_800_000_000 * 10**9
BASE_ITEM_KEYS = {
    "id", "sequence", "status", "session_id", "created_at", "claimed_at",
    "kind", "from", "handle", "preview", "stuck",
}


def snapshot(root: Path) -> dict:
    """Detect additions/removals, rewritten files and metadata changes, not atime."""
    result = {}
    for path in sorted(root.rglob("*")):
        stat = path.stat()
        result[str(path.relative_to(root))] = (
            path.read_bytes() if path.is_file() else None,
            stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns,
            stat.st_ino, stat.st_mode,
        )
    return result


class InboxCurrentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="messenger-inbox-current-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.homes = {name: self.root / name for name in ("A", "B")}
        self.records = {}
        self.bodies = {}
        for name, home in self.homes.items():
            self._seed(name, home)
        self.active_home = self.homes["A"]
        self.session_lookup = self._patch(
            "_bot_chat_session", side_effect=lambda home: f"synthetic-session-{home.name}"
        )
        self._patch("_home", side_effect=lambda: self.active_home)
        # Never import the real bot_live_delivery module or inspect live leases.
        self.stuck_lookup = self._patch(
            "_stuck_check", side_effect=lambda home: lambda rec: rec["owner"]["stale"]
        )
        self._patch("time", wraps=api.time).time_ns.return_value = NOW
        self.before = snapshot(self.root)

    def _patch(self, name, **kwargs):
        patcher = patch.object(api, name, **kwargs)
        value = patcher.start()
        self.addCleanup(patcher.stop)
        return value

    def _seed(self, name: str, home: Path):
        root = home / "runtime" / "bot_live_delivery"
        root.mkdir(parents=True)
        # Include unrelated synthetic files in the read-only snapshot too.
        (home / "config.yaml").write_text("synthetic: true\n", encoding="utf-8")
        (home / "state.db").write_bytes(b"synthetic sentinel; not a real database")
        (root / "malformed.json").write_text("{not JSON", encoding="utf-8")
        body = (
            f"{name}: full **synthetic** message\n\n"
            "- [Example](https://example.invalid/)\n"
            "```text\n" + "x" * 4096 + "\n```\n"
            + "\n".join(f"line {i}: Unicode — café 🧪" for i in range(80))
            + f"\n{name}: END OF UNTRUNCATED BODY  \n"
        )
        prefixes = {
            "agent": "Message from Synthetic Sender (@synthetic_sender):\n",
            "cron": '[Cronjob "Synthetic Cron" output — fixture]\n',
            "kanban": "🔔 [Synthetic Board] @synthetic Kanban t_abcdef — ",
            "other": "",
        }
        records = []
        for index, (kind, prefix) in enumerate(prefixes.items()):
            records.append(self._record(
                f"claimed-{kind}", "claimed", 10 + index, name, prefix + body
            ))
        records.extend([
            self._record("queued-later", "queued", 2, name, prefixes["agent"] + body),
            self._record("queued-first", "queued", 1, name, prefixes["agent"] + body),
        ])
        for status in ("delivered", "failed", "expired", "cancelled"):
            records.append(self._record(f"terminal-{status}", status, 0, name, body))
        for rec in records:
            (root / f'{rec["delivery_id"]}.json').write_text(
                json.dumps(rec, ensure_ascii=False), encoding="utf-8"
            )
        self.records[name] = {rec["delivery_id"]: rec for rec in records}
        self.bodies[name] = body

    @staticmethod
    def _record(delivery_id, status, sequence, name, message):
        return {
            "delivery_id": delivery_id,
            "status": status,
            "sequence": sequence,
            "session_id": f"synthetic-session-{name}",
            "message": message,
            "created_at": NOW - 120 * 10**9,
            "claimed_at": 0 if status == "queued" else NOW - 60 * 10**9,
            "owner": {"stale": delivery_id == "queued-later"},
            "receipt_sentinel": "must remain byte-for-byte unchanged",
        }

    def tearDown(self):
        self.assertEqual(self.before, snapshot(self.root), "GET mutated synthetic home files")

    def test_claimed_exposes_original_message_and_untruncated_display_body(self):
        items = {item["id"]: item for item in api.inbox()["items"]}
        for kind in ("agent", "cron", "kanban", "other"):
            with self.subTest(kind=kind):
                item = items[f"claimed-{kind}"]
                self.assertEqual(set(item), BASE_ITEM_KEYS | {"message", "body"})
                self.assertEqual(item["message"], self.records["A"][item["id"]]["message"])
                self.assertEqual(item["body"], self.bodies["A"])
                self.assertEqual(item["kind"], kind)
                self.assertEqual(item["preview"], api._preview(self.bodies["A"]))
                self.assertTrue(item["preview"].endswith("…"))
                self.assertLess(len(item["preview"]), len(item["body"]))
                self.assertFalse(item["stuck"])
        self.assertEqual(items["claimed-agent"]["from"], "Synthetic Sender")
        self.assertEqual(items["claimed-agent"]["handle"], "synthetic_sender")

    def test_queued_remains_preview_only(self):
        queued = [item for item in api.inbox()["items"] if item["status"] == "queued"]
        self.assertEqual([item["id"] for item in queued], ["queued-first", "queued-later"])
        for item in queued:
            self.assertEqual(set(item), BASE_ITEM_KEYS)
            self.assertNotIn("message", item)
            self.assertNotIn("body", item)
            self.assertEqual(item["preview"], api._preview(self.bodies["A"]))
            self.assertNotIn("END OF UNTRUNCATED BODY", item["preview"])
        self.assertFalse(queued[0]["stuck"])
        self.assertTrue(queued[1]["stuck"])

    def test_terminal_omission_existing_order_metadata_and_actions_are_preserved(self):
        result = api.inbox()
        records = self.records["A"]
        expected = sorted(
            (rec for rec in records.values() if rec["status"] in ("queued", "claimed")),
            key=lambda rec: (rec["status"] != "claimed", rec["sequence"]),
        )
        self.assertEqual([item["id"] for item in result["items"]], [rec["delivery_id"] for rec in expected])
        self.assertTrue(all(not item["id"].startswith("terminal-") for item in result["items"]))
        self.assertEqual(result["bot_chat_session_id"], "synthetic-session-A")
        self.assertIs(result["actions"], True)
        self.assertEqual(result["now"], NOW / 1e9)
        self.assertEqual(result["handled_24h"], sum(bool(rec["claimed_at"]) for rec in records.values()))
        self.assertEqual(result["median_wait_min_24h"], 1.0)
        for item, record in zip(result["items"], expected):
            self.assertEqual(item["status"], record["status"])
            self.assertEqual(item["session_id"], record["session_id"])
            self.assertEqual(item["created_at"], record["created_at"] / 1e9)
            self.assertEqual(item["claimed_at"], record["claimed_at"] / 1e9 if record["claimed_at"] else None)

    def test_temp_home_switch_A_B_A_has_no_cross_home_payload_leak(self):
        responses = []
        for name in ("A", "B", "A"):
            self.active_home = self.homes[name]
            response = api.inbox()
            responses.append(response)
            self.assertEqual(response["bot_chat_session_id"], f"synthetic-session-{name}")
            self.session_lookup.assert_called_with(self.homes[name])
            self.stuck_lookup.assert_called_with(self.homes[name])
            for item in response["items"]:
                self.assertEqual(item["session_id"], f"synthetic-session-{name}")
                if item["status"] == "claimed":
                    self.assertEqual(item["body"], self.bodies[name])
                    self.assertEqual(item["message"], self.records[name][item["id"]]["message"])
            self.assertEqual(self.before, snapshot(self.root))
        self.assertEqual(responses[0], responses[2])
        self.assertNotEqual(responses[0], responses[1])

    def test_repeated_get_leaves_all_synthetic_files_and_delivery_records_unchanged(self):
        for name in ("A", "B", "A"):
            self.active_home = self.homes[name]
            api.inbox()
            self.assertEqual(self.before, snapshot(self.root))
        # Both contents and filesystem metadata are covered; no transitions occur.
        for name, home in self.homes.items():
            for delivery_id, expected in self.records[name].items():
                path = home / "runtime" / "bot_live_delivery" / f"{delivery_id}.json"
                self.assertEqual(json.loads(path.read_text(encoding="utf-8")), expected)


if __name__ == "__main__":
    unittest.main()
