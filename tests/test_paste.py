import unittest

import numpy as np
from PIL import Image

from zeroimagestudio_paste import box_blur, color_match, paste, poisson_blend


class PasteTests(unittest.TestCase):
    def test_box_blur_keeps_constant(self):
        m = np.ones((9, 9), dtype=np.float32) * 0.5
        out = box_blur(m, 2)
        self.assertTrue(np.allclose(out, 0.5, atol=1e-5))

    def test_box_blur_spreads_peak(self):
        m = np.zeros((21, 21), dtype=np.float32)
        m[10, 10] = 1
        out = box_blur(m, 2)
        self.assertGreater(out[10, 12], 0)
        self.assertLess(out[10, 10], 1)

    def test_feather_alpha_follows_mask(self):
        result = Image.new("RGB", (32, 32), (255, 0, 0))
        original = Image.new("RGB", (32, 32), (0, 0, 255))
        mask = Image.new("L", (32, 32), 0)
        mask.paste(255, (8, 8, 24, 24))
        out = paste(result, original, mask, mode="feather", feather=0, color=False)
        arr = np.asarray(out)
        self.assertEqual(arr.shape, (32, 32, 4))
        self.assertEqual(int(arr[0, 0, 3]), 0)
        self.assertGreater(int(arr[16, 16, 3]), 200)
        self.assertEqual(int(arr[16, 16, 0]), 255)

    def test_poisson_matches_destination_outside_mask(self):
        h = w = 48
        src = np.zeros((h, w, 3), dtype=np.float32)
        src[..., 2] = 1.0
        src[18:30, 18:30, 0] = 1.0
        src[18:30, 18:30, 2] = 0.0
        dst = np.zeros((h, w, 3), dtype=np.float32)
        dst[..., 2] = 1.0
        mask = np.zeros((h, w), dtype=np.float32)
        mask[8:40, 8:40] = 1
        out = poisson_blend(src, dst, mask)
        outside = out[mask < 0.5]
        self.assertTrue(np.allclose(outside, dst[mask < 0.5], atol=0.08))
        self.assertGreater(float(out[24, 24, 0]), 0.2)

    def test_color_match_shifts_mean(self):
        src = np.ones((16, 16, 3), dtype=np.float32) * 0.2
        dst = np.ones((16, 16, 3), dtype=np.float32) * 0.8
        mask = np.zeros((16, 16), dtype=np.float32)
        mask[4:12, 4:12] = 1
        matched = color_match(src, dst, mask)
        self.assertGreater(float(matched[..., 0].mean()), 0.5)

    def test_paste_core_stays_opaque_while_a_premultiplied_blur_dims_it(self):
        # The ghost was a layer mask blurred on a transparent canvas: white mixed
        # with empty pixels, so the eye's coverage collapsed and destination-in
        # darkened crisp pixels. Paste alpha is the mask itself, applied once.
        result = Image.new("RGB", (80, 48), (255, 0, 0))
        original = Image.new("RGB", (80, 48), (0, 0, 255))
        mask = Image.new("L", (80, 48), 0)
        mask.paste(255, (20, 10, 60, 38))
        out = np.asarray(paste(result, original, mask, mode="feather", feather=8, color=False))
        self.assertGreater(int(out[24, 40, 3]), 250)
        self.assertEqual(int(out[0, 0, 3]), 0)
        peak = np.zeros((21, 21), dtype=np.float32)
        peak[10, 10] = 1
        # Three-pixel support mixed with zeros, the way a CSS blur premultiplies.
        dim = box_blur(peak, 6)
        self.assertLess(float(dim[10, 10]), 0.2)

    def test_poisson_alpha_stays_inside_the_seam(self):
        result = Image.new("RGB", (64, 64), (255, 0, 0))
        original = Image.new("RGB", (64, 64), (0, 0, 255))
        mask = Image.new("L", (64, 64), 0)
        mask.paste(255, (24, 24, 40, 40))
        out = np.asarray(paste(result, original, mask, mode="poisson", feather=6, color=False))
        self.assertEqual(int(out[0, 0, 3]), 0)
        self.assertGreater(int(out[32, 32, 3]), 200)

    def test_hard_mask_is_binary(self):
        result = Image.new("RGB", (8, 8), (10, 20, 30))
        original = Image.new("RGB", (8, 8), (1, 2, 3))
        mask = Image.new("L", (8, 8), 0)
        mask.putpixel((3, 3), 255)
        out = np.asarray(paste(result, original, mask, mode="hard", feather=0, color=False))
        self.assertEqual(int(out[3, 3, 3]), 255)
        self.assertEqual(int(out[0, 0, 3]), 0)

    def test_color_match_clamps_std_ratio(self):
        src = np.full((8, 8, 3), 0.5, dtype=np.float32)
        src[0, 0, 0] = 0.51
        dst = np.full((8, 8, 3), 0.1, dtype=np.float32)
        dst[0, 0, 0] = 1.0
        mask = np.ones((8, 8), dtype=np.float32)
        raw = float(src[..., 0].max() - src[..., 0].min())
        out = color_match(src.copy(), dst, mask)
        spread = float(out[..., 0].max() - out[..., 0].min())
        self.assertLessEqual(spread, raw * 2.0 + 1e-4)

    def test_poisson_skips_color_match(self):
        result = Image.new("RGB", (24, 24), (255, 0, 0))
        original = Image.new("RGB", (24, 24), (0, 0, 255))
        mask = Image.new("L", (24, 24), 0)
        mask.paste(255, (6, 6, 18, 18))
        colored = paste(result, original, mask, mode="poisson", feather=1, color=True)
        plain = paste(result, original, mask, mode="poisson", feather=1, color=False)
        self.assertTrue(np.array_equal(np.asarray(colored), np.asarray(plain)))


if __name__ == "__main__":
    unittest.main()
