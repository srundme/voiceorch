"""Caller memory keeps facts and the last call for the next dial."""
import tempfile
import unittest
from pathlib import Path

from memory import apply_extract, load_memory, memory_block, parse_extract, save_memory


class MemoryTests(unittest.TestCase):
    def test_round_trip_and_block(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            record = apply_extract(
                {"phone": "+919000000101", "call_count": 0, "facts": {}, "summary": "", "calls": []},
                {
                    "summary": "Wants an international voice role in Bangalore.",
                    "facts": {"name": "Karthikeyan", "location": "Bangalore", "role": "international voice"},
                },
                [{"who": "Caller", "text": "I am in Bangalore."}],
            )
            save_memory(record, root)
            loaded = load_memory("+919000000101", root)
            self.assertEqual(loaded["call_count"], 1)
            self.assertEqual(loaded["facts"]["name"], "Karthikeyan")
            block = memory_block(loaded)
            self.assertIn("Karthikeyan", block)
            self.assertIn("do not re-ask", block.lower())
            self.assertIn("Previous call summary", block)

    def test_correction_replaces_a_fact_and_old_calls_drop_off(self):
        record = {"phone": "+919000000101", "call_count": 1, "facts": {"location": "Chennai"}, "summary": "old", "calls": []}
        for index in range(9):
            record = apply_extract(
                record,
                {"summary": f"call {index}", "facts": {"location": "Bangalore"}},
                [{"who": "Caller", "text": "Bangalore"}],
            )
        self.assertEqual(record["facts"]["location"], "Bangalore")
        self.assertEqual(len(record["calls"]), 8)
        self.assertEqual(record["call_count"], 10)

    def test_empty_extract_does_not_wipe_a_known_name(self):
        record = apply_extract(
            {"phone": "+919000000101", "call_count": 1, "facts": {"name": "Karthikeyan"}, "summary": "old", "calls": []},
            parse_extract("not json"),
            [{"who": "Caller", "text": "Yes."}],
        )
        self.assertEqual(record["facts"]["name"], "Karthikeyan")
        self.assertEqual(record["summary"], "Yes.")

    def test_first_call_has_no_memory_block(self):
        self.assertEqual(memory_block({"call_count": 0, "facts": {}, "summary": ""}), "")


if __name__ == "__main__":
    unittest.main()
