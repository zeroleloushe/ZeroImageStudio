"""Load the node the way ComfyUI does: as a package, from its parent directory."""

import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class PackageImportTests(unittest.TestCase):
    def test_paste_runs_when_the_folder_is_a_package(self):
        parent = tempfile.mkdtemp(prefix="zis-pkg-")
        os.symlink(ROOT, os.path.join(parent, "ZeroImageStudio"))
        script = textwrap.dedent(
            """
            import importlib
            import sys
            import types

            def stub(name):
                try:
                    __import__(name)
                except ImportError:
                    sys.modules[name] = types.ModuleType(name)

            stub("torch")
            try:
                import aiohttp  # noqa: F401
            except ImportError:
                aio = types.ModuleType("aiohttp")
                web = types.ModuleType("aiohttp.web")
                aio.web = web
                sys.modules["aiohttp"] = aio
                sys.modules["aiohttp.web"] = web

            mod = importlib.import_module("ZeroImageStudio.zeroimagestudio_paste")
            from PIL import Image
            result = Image.new("RGB", (16, 16), (255, 0, 0))
            original = Image.new("RGB", (16, 16), (0, 0, 255))
            mask = Image.new("L", (16, 16), 0)
            mask.paste(255, (4, 4, 12, 12))
            out = mod.paste(result, original, mask, mode="hard", feather=0, color=False)
            assert out.mode == "RGBA" and out.size == (16, 16)
            assert out.getpixel((8, 8))[:3] == (255, 0, 0)
            assert out.getpixel((0, 0))[3] == 0
            print("package-paste-ok")
            """
        )
        env = os.environ.copy()
        env.pop("PYTHONPATH", None)
        proc = subprocess.run(
            [sys.executable, "-c", script],
            cwd=parent,
            env=env,
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, proc.stdout + "\n" + proc.stderr)
        self.assertIn("package-paste-ok", proc.stdout)


if __name__ == "__main__":
    unittest.main()
