"""Identity crop/stitch: the pasted layer matches the source and stays inside the mask."""

import unittest

import numpy as np
from PIL import Image

from zeroimagestudio_geom import edit_geometry, inverse_box
from zeroimagestudio_paste import paste


def _checker(w, h, cell=10):
    img = np.zeros((h, w, 3), dtype=np.uint8)
    ys, xs = np.indices((h, w))
    on = ((xs // cell) + (ys // cell)) % 2 == 0
    img[on] = (240, 20, 20)
    img[~on] = (20, 20, 240)
    img[0, :, :] = (0, 255, 0)
    img[-1, :, :] = (0, 255, 0)
    img[:, 0, :] = (255, 255, 0)
    img[:, -1, :] = (255, 255, 0)
    return img


def _letterbox(crop, gen_w, gen_h, placed):
    canvas = np.zeros((gen_h, gen_w, 3), dtype=np.uint8)
    src = np.asarray(Image.fromarray(crop).resize((placed["w"], placed["h"]), Image.Resampling.NEAREST))
    canvas[placed["y"]:placed["y"] + placed["h"], placed["x"]:placed["x"] + placed["w"]] = src
    return canvas


def _inverse(model, placed, gen_w, gen_h, out_w, out_h):
    sx, sy, sw, sh = inverse_box(model.shape[1], model.shape[0], placed, gen_w, gen_h)
    patch = model[sy:sy + sh, sx:sx + sw]
    return np.asarray(Image.fromarray(patch).resize((out_w, out_h), Image.Resampling.NEAREST))


class StitchTests(unittest.TestCase):
    def test_seam_on_a_small_mask_is_clamped(self):
        geom = edit_geometry(
            2000, 2000,
            {"x": 100, "y": 100, "w": 1232, "h": 1232},
            {"x": 400, "y": 360, "w": 120, "h": 60},
            seam_doc=48, grow_doc=6, context=0.15, mp=1, step=16,
        )
        self.assertEqual(geom["seamDoc"], 4)
        self.assertLess(geom["blend"]["w"], 400)
        self.assertLessEqual(abs(geom["seamGen"] - round(geom["seamDoc"] * geom["scale"])), 1)
        self.assertLessEqual(geom["crop"]["x"], 400 - geom["seamDoc"])

    def _roundtrip(self, doc_w, doc_h, mask_box, frame, mp):
        doc = _checker(doc_w, doc_h, 8)
        mask = np.zeros((doc_h, doc_w), dtype=np.uint8)
        x, y, w, h = mask_box
        mask[y:y + h, x:x + w] = 255
        doc[y + h // 2, x + w // 2] = (0, 255, 128)
        geom = edit_geometry(doc_w, doc_h, frame, {"x": x, "y": y, "w": w, "h": h}, seam_doc=48, grow_doc=0, context=0.1, mp=mp, step=16)
        self.assertEqual(geom["seamDoc"], 4)
        crop = geom["crop"]
        self.assertEqual(crop["x"] % 16, crop["x"] % 16)
        patch = doc[crop["y"]:crop["y"] + crop["h"], crop["x"]:crop["x"] + crop["w"]]
        model = _letterbox(patch, geom["gen"]["w"], geom["gen"]["h"], geom["placed"])
        back = _inverse(model, geom["placed"], geom["gen"]["w"], geom["gen"]["h"], crop["w"], crop["h"])
        crop_mask = mask[crop["y"]:crop["y"] + crop["h"], crop["x"]:crop["x"] + crop["w"]]
        out = paste(Image.fromarray(back), Image.fromarray(patch), Image.fromarray(crop_mask), mode="feather", feather=geom["seamDoc"], color=False)
        arr = np.asarray(out)
        local_y = (y - crop["y"]) + (h // 2)
        local_x = (x - crop["x"]) + (w // 2)
        ys, xs = np.where((back[..., 1] > 200) & (back[..., 0] < 40))
        self.assertGreater(len(xs), 0)
        shift = int(np.min(np.abs(ys.astype(int) - local_y) + np.abs(xs.astype(int) - local_x)))
        self.assertLessEqual(shift, 1)
        self.assertGreater(int(arr[local_y, local_x, 3]), 200)
        self.assertEqual(int(arr[0, 0, 3]), 0)
        # Composite back onto the document. Pixels well outside the seam stay put.
        canvas = doc.astype(np.float32)
        alpha = arr[..., 3:4].astype(np.float32) / 255.0
        rgb = arr[..., :3].astype(np.float32)
        y0, x0 = crop["y"], crop["x"]
        base = canvas[y0:y0 + crop["h"], x0:x0 + crop["w"]]
        comp = rgb * alpha + base * (1.0 - alpha)
        canvas[y0:y0 + crop["h"], x0:x0 + crop["w"]] = comp
        far = np.ones(doc.shape[:2], dtype=bool)
        far[max(0, y - 40):y + h + 40, max(0, x - 40):x + w + 40] = False
        self.assertLessEqual(int(np.abs(canvas[far].astype(np.int16) - doc[far].astype(np.int16)).max()), 0)

    def test_identity_paste_stays_on_the_mask_and_aligned(self):
        self._roundtrip(640, 480, (150, 80, 120, 60), {"x": 0, "y": 0, "w": 640, "h": 480}, 0.5)
        self._roundtrip(1232, 1232, (500, 480, 120, 60), {"x": 40, "y": 36, "w": 1000, "h": 1000}, 1)
        self._roundtrip(1000, 700, (333, 211, 121, 57), {"x": 17, "y": 19, "w": 613, "h": 401}, 1)


if __name__ == "__main__":
    unittest.main()
