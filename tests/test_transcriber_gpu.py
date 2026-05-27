import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from transcriber import TranscriberApp


@unittest.skipUnless(os.name == "nt", "Vulkan backend selection is Windows-specific")
class WhisperGpuSelectionTests(unittest.TestCase):
    def _app_for(self, root):
        app = object.__new__(TranscriberApp)
        app.app_dir = root / "app"
        app.runtime_dir = root / "runtime"
        app.app_dir.mkdir(parents=True)
        app.runtime_dir.mkdir(parents=True)
        return app

    def _write_whisper(self, directory, has_vulkan=False):
        directory.mkdir(parents=True, exist_ok=True)
        whisper = directory / "whisper-cli.exe"
        whisper.write_text("", encoding="utf-8")
        if has_vulkan:
            (directory / "ggml-vulkan.dll").write_text("", encoding="utf-8")
        return whisper

    def test_prefers_local_vulkan_over_path_cpu(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            app = self._app_for(root)
            local_dir = app.runtime_dir / ".tools" / "whisper.cpp" / "build" / "bin" / "Release"
            path_dir = root / "path-cpu"
            local_whisper = self._write_whisper(local_dir, has_vulkan=True)
            self._write_whisper(path_dir, has_vulkan=False)

            with patch.dict(os.environ, {"PATH": str(path_dir)}):
                self.assertEqual(Path(app._find_whisper_cpp()).resolve(), local_whisper.resolve())

    def test_prefers_path_vulkan_over_local_cpu(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            app = self._app_for(root)
            local_dir = app.runtime_dir / ".tools" / "whisper.cpp" / "build" / "bin" / "Release"
            path_dir = root / "path-vulkan"
            self._write_whisper(local_dir, has_vulkan=False)
            path_whisper = self._write_whisper(path_dir, has_vulkan=True)

            with patch.dict(os.environ, {"PATH": str(path_dir)}):
                self.assertEqual(Path(app._find_whisper_cpp()).resolve(), path_whisper.resolve())


if __name__ == "__main__":
    unittest.main()
