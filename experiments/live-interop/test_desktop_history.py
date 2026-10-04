"""Check fixed-version native completion separately from explicit item flags."""
import sys
import unittest
from pathlib import Path
from unittest.mock import mock_open, patch

sys.path.insert(0, str(Path(__file__).parent / "desktop"))
from read_full_marker import loaded_metadata


class DesktopHistoryTests(unittest.TestCase):
    def inspect(self, turns, version="26.928.31416"):
        state = {"turnHistory": {"kind": "canonical", "history": {
            "isComplete": True, "islands": [{}]}},
            "turnsPagination": {"hasLoadedOldest": True}}
        with patch("read_full_marker.turns_in", return_value=turns), \
                patch("builtins.open", mock_open()), \
                patch("read_full_marker.plistlib.load", return_value={
                    "CFBundleShortVersionString": version,
                    "CFBundleVersion": "12553"}):
            return loaded_metadata(state)

    def test_missing_preserved_under_verified_native_rule(self):
        result = self.inspect([{}, {}])
        self.assertTrue(result["fullHistoryConfirmed"])
        self.assertFalse(result["itemsExplicitlyLoaded"])
        self.assertEqual(result["itemPaginationCounts"], {"true": 0, "false": 0, "missing": 2})

    def test_explicit_incomplete_rejected(self):
        result = self.inspect([{"itemsPagination": {"hasLoadedOldest": False}}])
        self.assertFalse(result["fullHistoryConfirmed"])

    def test_unknown_version_rejected(self):
        self.assertFalse(self.inspect([{}], version="unknown")["fullHistoryConfirmed"])


if __name__ == "__main__":
    unittest.main()
