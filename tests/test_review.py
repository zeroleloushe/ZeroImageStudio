"""Storage, gallery, zip, settings and LoRA-path checks from the review."""

import io
import json
import os
import tempfile
import unittest
import zipfile
from unittest import mock

from PIL import Image

import zeroimagestudio_storage as store
from zeroimagestudio_routes import _lora_tree


def _png(color):
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), color).save(buf, format="PNG")
    return buf.getvalue()


class ReviewStorageTests(unittest.TestCase):
    def test_empty_secret_is_kept_and_public_view_masks_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(store, "user_root", return_value=tmp):
                store.save_settings({"civitai_token": "secret-token", "llm_key": "llm-secret"})
                public = store.save_settings({"civitai_token": "", "llm_key": "••••"})
                blob = json.dumps(public)
                self.assertNotIn("secret-token", blob)
                self.assertNotIn("llm-secret", blob)
                self.assertTrue(public["has_civitai_token"])
                self.assertTrue(public["has_llm_key"])
                raw = store.load_settings()
                self.assertEqual(raw["civitai_token"], "secret-token")
                self.assertEqual(raw["llm_key"], "llm-secret")

    def test_project_read_rejects_bad_ids_and_does_not_mkdir(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(store, "user_root", return_value=tmp):
                for bad in ("../x", "not-hex", ".", "..", "abc"):
                    with self.assertRaises(ValueError):
                        store.project_dir(bad, create=False)
                path = store.project_dir("abcd1234", create=False)
                self.assertFalse(os.path.isdir(path))

    def test_zip_rejects_traversal_and_removes_the_folder(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("../evil.txt", "x")
            zf.writestr("project.json", "{}")
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(store, "user_root", return_value=tmp):
                with self.assertRaises(ValueError):
                    store.import_project_zip(buf.getvalue())
                projects = os.path.join(tmp, "projects")
                self.assertFalse(os.path.isdir(projects) and os.listdir(projects))

    def test_zip_requires_project_json(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("notes.txt", "hi")
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(store, "user_root", return_value=tmp):
                with self.assertRaises(ValueError):
                    store.import_project_zip(buf.getvalue())

    def test_broken_json_is_renamed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "x.json")
            with open(path, "w", encoding="utf-8") as f:
                f.write("{")
            self.assertEqual(store._read_json(path, {"ok": 1}), {"ok": 1})
            self.assertFalse(os.path.isfile(path))
            broken = [name for name in os.listdir(tmp) if name.startswith("x.json.broken")]
            self.assertEqual(len(broken), 1)

    def test_gallery_page_reuses_the_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(store, "output_root", return_value=tmp):
                store.save_gallery_image(_png((1, 2, 3)), {"prompt": "a"})
                store.save_gallery_image(_png((4, 5, 6)), {"prompt": "b"})
                calls = {"n": 0}
                real = store.read_png_meta

                def wrapped(path):
                    calls["n"] += 1
                    return real(path)

                with mock.patch.object(store, "read_png_meta", side_effect=wrapped):
                    first = store.list_gallery(0, 1)
                    self.assertEqual(first["total"], 2)
                    self.assertEqual(len(first["items"]), 1)
                    after = calls["n"]
                    second = store.list_gallery(1, 1)
                    self.assertEqual(len(second["items"]), 1)
                    self.assertEqual(calls["n"], after)
                    self.assertNotEqual(first["items"][0]["id"], second["items"][0]["id"])

    def test_commits_keep_the_last_eight_per_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(store, "output_root", return_value=tmp):
                ids = []
                for i in range(10):
                    saved = store.commit_image(_png((i, 0, 0)), _png((0, i, 0)), {"projectId": "abcd1234"})
                    ids.append(saved["id"])
                folder = os.path.join(tmp, "commits")
                pngs = [name for name in os.listdir(folder) if name.endswith(".png")]
                self.assertEqual(len(pngs), 16)
                self.assertNotIn(ids[0] + ".png", pngs)
                self.assertNotIn(ids[0] + "_mask.png", pngs)
                self.assertIn(ids[-1] + ".png", pngs)
                self.assertIn(ids[-1] + "_mask.png", pngs)

    def test_lora_tree_groups_windows_separators(self):
        tree = _lora_tree([r"krea\krea2_identity_edit_v2.safetensors", "flat.safetensors"])
        self.assertIn("krea", tree["children"])
        self.assertEqual(tree["children"]["krea"]["files"], [r"krea\krea2_identity_edit_v2.safetensors"])
        self.assertEqual(tree["files"], ["flat.safetensors"])

    def test_sidecar_preview_prefers_preview_png(self):
        from zeroimagestudio_routes import match_lora_previews

        names = ["Krea 2/Detailer.safetensors", "flat.pt"]
        have = {
            "Krea 2/Detailer.preview.png",
            "Krea 2/Detailer.png",
            "flat.jpg",
        }
        found = match_lora_previews(names, lambda rel: rel in have)
        self.assertEqual(found["Krea 2/Detailer.safetensors"], "Krea 2/Detailer.preview.png")
        self.assertEqual(found["flat.pt"], "flat.jpg")


class OutputNodeTests(unittest.TestCase):
    def test_missing_commit_raises_instead_of_a_black_frame(self):
        from zeroimagestudio_nodes import ZeroImageStudio

        node = ZeroImageStudio()
        with self.assertRaises(RuntimeError):
            node.run("", "", "", "")
        with mock.patch("zeroimagestudio_nodes._output_path", return_value="/tmp/zeroimagestudio-missing.png"):
            with self.assertRaises(RuntimeError) as ctx:
                node.run("ghost.png", "", "", "")
        self.assertIn("не нашёл", str(ctx.exception))

    def test_input_image_passes_through(self):
        import torch
        from zeroimagestudio_nodes import ZeroImageStudio

        image = torch.zeros((1, 8, 8, 3))
        out = ZeroImageStudio().run("", "", "layers", "", image=image)
        self.assertEqual(tuple(out[0].shape), (1, 8, 8, 3))
        self.assertEqual(out[2], "layers")


if __name__ == "__main__":
    unittest.main()
