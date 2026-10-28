import unittest

import numpy as np
from PIL import Image

from zeroimagestudio_paste import (
    box_blur,
    clamp_feather,
    color_match,
    dilate_binary,
    erode_binary,
    estimate_translation,
    lock_context,
    paste,
    poisson_blend,
    shift_rgb,
    _mask_float,
)


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

    def test_interior_does_not_darken(self):
        h = w = 80
        dst = np.full((h, w, 3), 180, dtype=np.uint8)
        identical = dst.copy()
        brighter = dst.copy()
        brighter[20:60, 20:60] = 255
        for mode in ("feather", "hard", "poisson"):
            mean, out, hard, _seam = self._paste_case(mode, identical, identical, (20, 20, 60, 60), 8)
            self.assertLess(mean, 1.0, mode)
            self.assertEqual(int(out[0, 0, 3]), 0, mode)
            if mode != "feather":
                self.assertEqual(int(out[..., 3][~hard].max()), 0, mode)
            mean_b, out_b, hard_b, _seam_b = self._paste_case(mode, brighter, dst, (20, 20, 60, 60), 8, color=False)
            self.assertLess(mean_b, 1.0, mode)
            self.assertEqual(int(out_b[0, 0, 3]), 0, mode)
            if mode != "feather":
                self.assertEqual(int(out_b[..., 3][~hard_b].max()), 0, mode)

    def _paste_case(self, mode, src, dst, box, feather, color=True):
        mask = Image.new("L", (src.shape[1], src.shape[0]), 0)
        mask.paste(255, box)
        out = np.asarray(paste(Image.fromarray(src), Image.fromarray(dst), mask, mode=mode, feather=feather, color=color))
        m = _mask_float(mask, (src.shape[1], src.shape[0]))
        seam = clamp_feather(feather, m)
        interior = erode_binary(m > 0.5, max(seam, 1))
        delta = np.abs(out[..., :3][interior].astype(np.int16) - src[interior].astype(np.int16))
        return float(delta.mean()), out, m > 0.5, seam

    def test_flat_white_patch_stays_flat(self):
        dst = np.full((64, 64, 3), 180, dtype=np.uint8)
        src = dst.copy()
        src[16:48, 16:48] = 255
        mask = Image.new("L", (64, 64), 0)
        mask.paste(255, (16, 16, 48, 48))
        for mode in ("feather", "poisson", "hard"):
            out = np.asarray(paste(Image.fromarray(src), Image.fromarray(dst), mask, mode=mode, feather=8, color=False))
            self.assertEqual(int(out[32, 32, 0]), 255, mode)
            self.assertEqual(int(out[32, 32, 1]), 255, mode)
            self.assertEqual(int(out[32, 32, 2]), 255, mode)
            self.assertEqual(int(out[0, 0, 3]), 0, mode)

    def test_feather_is_clamped_on_a_small_mask(self):
        mask = Image.new("L", (48, 48), 255)
        result = Image.new("RGB", (48, 48), (255, 255, 255))
        original = Image.new("RGB", (48, 48), (180, 180, 180))
        m = _mask_float(mask, (48, 48))
        self.assertLessEqual(clamp_feather(48, m), 10)
        out = np.asarray(paste(result, original, mask, mode="feather", feather=48, color=False))
        self.assertGreater(int(out[24, 24, 3]), 250)
        self.assertEqual(int(out[24, 24, 0]), 255)

    def test_poisson_skips_color_match(self):
        result = Image.new("RGB", (24, 24), (255, 0, 0))
        original = Image.new("RGB", (24, 24), (0, 0, 255))
        mask = Image.new("L", (24, 24), 0)
        mask.paste(255, (6, 6, 18, 18))
        colored = paste(result, original, mask, mode="poisson", feather=1, color=True)
        plain = paste(result, original, mask, mode="poisson", feather=1, color=False)
        self.assertTrue(np.array_equal(np.asarray(colored), np.asarray(plain)))

    def _ramp(self, h=96, w=96):
        rng = np.random.default_rng(0)
        return rng.integers(0, 255, size=(h, w, 3)).astype(np.float32)

    def _displace(self, image, dx, dy):
        out = np.zeros_like(image)
        h, w = image.shape[:2]
        y0, y1 = max(0, dy), min(h, h + dy)
        x0, x1 = max(0, dx), min(w, w + dx)
        out[y0:y1, x0:x1] = image[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
        return out

    def test_register_recovers_a_known_shift_and_clamps(self):
        dst = self._ramp()
        src = self._displace(dst, 3, -4)
        valid = np.ones(dst.shape[:2], dtype=bool)
        valid[:16, :] = valid[-16:, :] = False
        valid[:, :16] = valid[:, -16:] = False
        valid[32:64, 32:64] = False
        dx, dy, score = estimate_translation(src, dst, valid, 8)
        self.assertEqual((dx, dy), (-3, 4))
        self.assertGreater(score, 0.9)
        fixed = shift_rgb(src, dst, dx, dy)
        self.assertLess(float(np.abs(fixed[40:70, 40:70] - dst[40:70, 40:70]).mean()), 1.0)

        yy, xx = np.mgrid[0:96, 0:96]
        blob = np.exp(-((xx - 48) ** 2 + (yy - 48) ** 2) / (2 * 18.0 ** 2))
        smooth = np.stack([blob, blob * 0.4, blob * 0.2], axis=-1)
        far = self._displace(smooth, 14, 0)
        cdx, cdy, _cscore = estimate_translation(far, smooth, valid, 8)
        self.assertEqual((cdx, cdy), (-8, 0))

        flat_a = np.zeros_like(dst)
        flat_b = np.ones_like(dst) * 40
        zdx, zdy, _z = estimate_translation(flat_a, flat_b, valid, 8)
        self.assertEqual((zdx, zdy), (0, 0))

    def test_paste_shifts_the_edit_back_and_locks_the_context(self):
        dst = self._ramp().astype(np.uint8)
        src = self._displace(dst.astype(np.float32), 4, -2).astype(np.uint8)
        mask = Image.new("L", (96, 96), 0)
        mask.paste(255, (32, 32, 64, 64))
        out = np.asarray(paste(Image.fromarray(src), Image.fromarray(dst), mask, mode="hard", feather=4, color=False))
        self.assertLess(int(np.abs(out[50, 50, :3].astype(int) - dst[50, 50].astype(int)).max()), 2)
        raw = np.asarray(paste(Image.fromarray(src), Image.fromarray(dst), mask, mode="hard", feather=4, color=False, register=False))
        self.assertGreater(int(np.abs(raw[50, 50, :3].astype(int) - dst[50, 50].astype(int)).max()), 2)

    def test_context_outside_the_seam_is_the_original(self):
        src = np.full((96, 96, 3), 255, dtype=np.uint8)
        dst = np.full((96, 96, 3), 20, dtype=np.uint8)
        mask = Image.new("L", (96, 96), 0)
        mask.paste(255, (40, 40, 56, 56))
        out = np.asarray(paste(Image.fromarray(src), Image.fromarray(dst), mask, mode="feather", feather=6, color=False, register=False))
        self.assertEqual(int(out[48, 48, 0]), 255)
        self.assertEqual(int(out[1, 1, 0]), 20)
        kept = dilate_binary(_mask_float(mask, (96, 96)) > 0.5, 6)
        self.assertFalse(bool(kept[1, 1]))
        locked = lock_context(src.astype(np.float32) / 255.0, dst.astype(np.float32) / 255.0, _mask_float(mask, (96, 96)), 6)
        self.assertAlmostEqual(float(locked[1, 1, 0]), 20 / 255.0, places=3)


if __name__ == "__main__":
    unittest.main()
