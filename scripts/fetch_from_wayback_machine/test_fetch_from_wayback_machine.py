import json
import gzip
import ssl
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from scripts.fetch_from_wayback_machine import fetch_from_wayback_machine as fetcher


class FetchFromWaybackMachineTests(unittest.TestCase):
    def test_default_platforms_include_all_known_platforms_for_one_click_run(self):
        self.assertEqual(fetcher.DEFAULT_PLATFORMS, fetcher.VALID_PLATFORMS)

    def test_script_help_runs_without_external_requests_dependency(self):
        result = subprocess.run(
            [
                sys.executable,
                str(Path(fetcher.__file__)),
                "--help",
            ],
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Fetch historical Warframe weekly riven snapshots", result.stdout)
        self.assertIn("Defaults to PC PS4 XB1 SWI", result.stdout)
        self.assertIn("--insecure", result.stdout)

    def test_parse_args_supports_insecure_tls_option(self):
        args = fetcher.parse_args(["--insecure", "PC"])

        self.assertTrue(args.insecure)
        self.assertEqual(args.platforms, ["PC"])

    def test_build_tls_context_can_disable_certificate_verification(self):
        context = fetcher.build_tls_context(verify_tls=False)

        self.assertFalse(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_NONE)

    def test_output_path_for_timestamp_targets_project_data_folder(self):
        output_path = fetcher.output_path_for_timestamp("PC", "20190327120000")
        expected = (
            Path(fetcher.__file__).resolve().parents[2]
            / "data"
            / "PC"
            / "2019_W13_weeklyRivensPC.json"
        )

        self.assertEqual(output_path, expected)

    def test_download_snapshot_skips_existing_data_file_without_fetching(self):
        with TemporaryDirectory() as temp_dir:
            data_dir = Path(temp_dir) / "data"
            timestamp = "20190327120000"

            with patch.object(fetcher, "DATA_DIR", data_dir):
                output_path = fetcher.output_path_for_timestamp("PC", timestamp)
                output_path.parent.mkdir(parents=True)
                output_path.write_text("existing", encoding="utf-8")

                session = Mock()
                downloaded_path = fetcher.download_snapshot(
                    session,
                    "PC",
                    "https://example.test/weeklyRivensPC.json",
                    timestamp,
                    1,
                    1,
                )

                self.assertIsNone(downloaded_path)
                self.assertEqual(output_path.read_text(encoding="utf-8"), "existing")
                session.get.assert_not_called()

    def test_download_snapshot_continues_after_snapshot_download_error(self):
        with TemporaryDirectory() as temp_dir:
            data_dir = Path(temp_dir) / "data"

            with (
                patch.object(fetcher, "DATA_DIR", data_dir),
                patch.object(fetcher, "DOWNLOAD_DELAY_SECONDS", 0),
                patch.object(
                    fetcher,
                    "request_with_retries",
                    side_effect=fetcher.DownloadError("request failed"),
                ),
            ):
                downloaded_path = fetcher.download_snapshot(
                    Mock(),
                    "PC",
                    "https://example.test/weeklyRivensPC.json",
                    "20240621163605",
                    1,
                    1,
                )

                self.assertIsNone(downloaded_path)

    def test_decode_response_body_handles_gzip_encoded_json(self):
        body = gzip.compress(b'["ok"]')

        text = fetcher.decode_response_body(
            body,
            {"Content-Encoding": "gzip"},
            "utf-8",
        )

        self.assertEqual(text, '["ok"]')

    def test_update_dates_index_merges_downloaded_weeks_sorted_and_unique(self):
        with TemporaryDirectory() as temp_dir:
            dates_path = Path(temp_dir) / "dates.json"
            dates_path.write_text(
                json.dumps(
                    {
                        "PC": ["2019_W14"],
                        "PS4": [],
                        "XB1": [],
                        "SWI": [],
                    }
                ),
                encoding="utf-8",
            )

            self.assertTrue(
                hasattr(fetcher, "update_dates_index"),
                "update_dates_index should exist",
            )

            changed = fetcher.update_dates_index(
                dates_path,
                [
                    Path(temp_dir) / "data" / "PC" / "2019_W13_weeklyRivensPC.json",
                    Path(temp_dir) / "data" / "PC" / "2019_W14_weeklyRivensPC.json",
                ],
            )

            self.assertTrue(changed)
            self.assertEqual(
                json.loads(dates_path.read_text(encoding="utf-8"))["PC"],
                ["2019_W13", "2019_W14"],
            )


if __name__ == "__main__":
    unittest.main()
