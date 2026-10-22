"""Asset library dedupes uploads by content hash."""

import io
import os
import tempfile
import unittest
from unittest import mock

from PIL import Image

import zeroimagestudio_storage as store


def _png(color):
    buf = io.BytesIO()
    Image.new("RGB", (32, 24), color).save(buf, format="PNG")
    return buf.getvalue()


class AssetTests(unittest.TestCase):
    def test_same_bytes_merge_roles_and_projects(self):
        data = _png((10, 20, 30))
        other = _png((200, 10, 10))
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(store, "user_root", return_value=tmp):
                first = store.save_asset(data, "photo.png", "image/png", "canvas", "p1", {"x": 1, "y": 2, "w": 32, "h": 24, "mp": "off"})
                second = store.save_asset(data, "again.png", "image/png", "reference", "p2", None)
                self.assertEqual(first["id"], second["id"])
                items = store.list_assets()
                self.assertEqual(len(items), 1)
                self.assertEqual(set(items[0]["roles"]), {"canvas", "reference"})
                self.assertEqual(set(items[0]["project_ids"]), {"p1", "p2"})
                self.assertEqual(items[0]["import"]["w"], 32)
                self.assertTrue(os.path.isfile(os.path.join(tmp, "assets", first["id"] + ".png")))
                self.assertTrue(os.path.isfile(os.path.join(tmp, "assets", first["id"] + ".thumb.jpg")))
                extra = store.save_asset(other, "other.png", "image/png", "canvas", None, None)
                self.assertEqual(len(store.list_assets()), 2)
                self.assertNotEqual(extra["id"], first["id"])
                store.delete_asset(extra["id"])
                self.assertEqual(len(store.list_assets()), 1)
                self.assertFalse(os.path.isfile(os.path.join(tmp, "assets", extra["id"] + ".png")))


if __name__ == "__main__":
    unittest.main()
