import unittest

from app.editor_crop import crop_pixels, ffmpeg_crop_filter, normalize_crop


class EditorCropTests(unittest.TestCase):
    def test_normalize_rejects_full_frame(self):
        self.assertIsNone(normalize_crop({"enabled": True, "x": 0, "y": 0, "w": 1, "h": 1}))
        self.assertIsNone(normalize_crop({"enabled": False, "x": 0.1, "y": 0.1, "w": 0.5, "h": 0.5}))

    def test_normalize_clamps_and_keeps_enabled_crop(self):
        crop = normalize_crop({"x": -0.2, "y": 0.1, "w": 2, "h": 0.4})
        self.assertEqual(crop["x"], 0.0)
        self.assertAlmostEqual(crop["w"], 1.0)
        self.assertEqual(crop["y"], 0.1)
        self.assertEqual(crop["h"], 0.4)
        self.assertTrue(crop["enabled"])

    def test_crop_pixels_are_even(self):
        x, y, w, h = crop_pixels({"x": 0.1, "y": 0.1, "w": 0.5, "h": 0.5}, 577, 999)
        self.assertEqual(x % 2, 0)
        self.assertEqual(y % 2, 0)
        self.assertEqual(w % 2, 0)
        self.assertEqual(h % 2, 0)
        self.assertIn("crop=", ffmpeg_crop_filter({"x": 0.1, "y": 0.1, "w": 0.5, "h": 0.5}, 576, 1024))


if __name__ == "__main__":
    unittest.main()
