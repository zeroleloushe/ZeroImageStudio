import unittest

from zeroimagestudio_workflows import WorkflowError, assemble_prompt, build_workflow, snap


def _diff_spec(**extra):
    spec = {
        "pipeline": "create",
        "loader": "diffusion",
        "unet": "model.safetensors",
        "clip": "clip.safetensors",
        "vae": "vae.safetensors",
        "clip_type": "krea2",
        "weight_dtype": "default",
        "latent_mode": "sd3",
        "encoder": "clip",
        "prompt": "рыжие волосы",
        "negative": "",
        "seed": 7,
        "steps": 8,
        "cfg": 1.0,
        "denoise": 1.0,
        "sampler": "euler",
        "scheduler": "simple",
        "batch": 1,
        "width": 1024,
        "height": 1024,
        "loras": [],
        "prompt_presets": [],
    }
    spec.update(extra)
    return spec


def classes(prompt):
    return [n["class_type"] for n in prompt.values()]


class AssembleTests(unittest.TestCase):
    def test_order(self):
        text = assemble_prompt(
            "волосы",
            [
                {"text": "студия", "position": "before", "enabled": True},
                {"text": "кожа", "position": "after", "enabled": True},
                {"text": "выкл", "position": "before", "enabled": False},
            ],
            [
                {
                    "enabled": True,
                    "trigger_mode": "end",
                    "triggers": [{"text": "hcolor style", "enabled": True}, {"text": "skip", "enabled": False}],
                }
            ],
        )
        self.assertEqual(text, "студия, волосы, кожа, hcolor style")

    def test_trigger_start(self):
        text = assemble_prompt("x", [], [{"enabled": True, "trigger_mode": "start", "triggers": ["a"]}])
        self.assertEqual(text, "a, x")


class WorkflowTests(unittest.TestCase):
    def test_create_diffusion_sd3(self):
        prompt, warnings, built = build_workflow(_diff_spec())
        self.assertEqual(built, "create")
        self.assertIn("UNETLoader", classes(prompt))
        self.assertIn("CLIPLoader", classes(prompt))
        self.assertIn("VAELoader", classes(prompt))
        self.assertIn("EmptySD3LatentImage", classes(prompt))
        self.assertIn("KSampler", classes(prompt))
        self.assertIn("SaveImage", classes(prompt))
        clip = next(n for n in prompt.values() if n["class_type"] == "CLIPLoader")
        self.assertEqual(clip["inputs"]["type"], "krea2")
        enc = next(n for n in prompt.values() if n["class_type"] == "CLIPTextEncode" and n["inputs"]["text"])
        self.assertEqual(enc["inputs"]["text"], "рыжие волосы")
        self.assertFalse(warnings)

    def test_create_checkpoint_and_lora(self):
        spec = _diff_spec(
            loader="checkpoint",
            checkpoint="sd.safetensors",
            latent_mode="standard",
            loras=[{"name": "hair.safetensors", "enabled": True, "strength_model": 0.8, "strength_clip": 0.7}],
            prompt_presets=[{"text": "портрет", "position": "before", "enabled": True}],
        )
        prompt, _w, built = build_workflow(spec)
        self.assertEqual(built, "create")
        self.assertIn("CheckpointLoaderSimple", classes(prompt))
        self.assertNotIn("UNETLoader", classes(prompt))
        self.assertIn("LoraLoader", classes(prompt))
        self.assertIn("EmptyLatentImage", classes(prompt))
        enc = next(n for n in prompt.values() if n["class_type"] == "CLIPTextEncode" and n["inputs"]["text"])
        self.assertIn("портрет", enc["inputs"]["text"])
        lora = next(n for n in prompt.values() if n["class_type"] == "LoraLoader")
        self.assertEqual(lora["inputs"]["strength_model"], 0.8)

    def test_create_inpaint(self):
        spec = _diff_spec(image="zeroimagestudio/crop.png", mask="zeroimagestudio/mask.png", has_mask=True, denoise=0.7, latent_mode="standard")
        prompt, _w, _b = build_workflow(spec)
        self.assertIn("VAEEncodeForInpaint", classes(prompt))
        self.assertIn("ImageToMask", classes(prompt))
        self.assertNotIn("EmptyLatentImage", classes(prompt))
        sampler = next(n for n in prompt.values() if n["class_type"] == "KSampler")
        self.assertAlmostEqual(sampler["inputs"]["denoise"], 0.7)

    def test_create_inpaint_conditioning(self):
        spec = _diff_spec(
            image="zeroimagestudio/crop.png",
            mask="zeroimagestudio/mask.png",
            has_mask=True,
            inpaint_mode="inpaint_conditioning",
        )
        prompt, _w, _b = build_workflow(spec)
        self.assertIn("InpaintModelConditioning", classes(prompt))

    def test_create_img2img(self):
        spec = _diff_spec(image="zeroimagestudio/crop.png", has_mask=False, denoise=0.55)
        prompt, _w, _b = build_workflow(spec)
        self.assertIn("VAEEncode", classes(prompt))
        self.assertNotIn("VAEEncodeForInpaint", classes(prompt))

    def test_create_drops_references(self):
        spec = _diff_spec(
            pipeline="create",
            encoder="qwen_image_21",
            clip_type="qwen_image",
            image="zeroimagestudio/crop.png",
            references=["zeroimagestudio/ref.png"],
            denoise=0.4,
        )
        prompt, _warnings, built = build_workflow(spec)
        self.assertEqual(built, "create")
        blob = str(prompt)
        self.assertIn("zeroimagestudio/crop.png", blob)
        self.assertNotIn("zeroimagestudio/ref.png", blob)
        self.assertNotIn("Reference", blob)

    def test_qwen_edit(self):
        spec = _diff_spec(
            pipeline="edit",
            edit_method="qwen_image_21",
            clip_type="qwen_image",
            image="zeroimagestudio/crop.png",
            references=["zeroimagestudio/ref.png"],
            qwen_resolution=1024,
            has_mask=True,
        )
        prompt, warnings, built = build_workflow(spec)
        self.assertEqual(built, "edit:qwen_image_21")
        enc = next(n for n in prompt.values() if n["class_type"] == "TextEncodeQwenImage21")
        self.assertIn("images.image_1", enc["inputs"])
        self.assertIn("images.image_2", enc["inputs"])
        self.assertEqual(enc["inputs"]["resolution"], 1024)
        sampler = next(n for n in prompt.values() if n["class_type"] == "KSampler")
        self.assertEqual(sampler["inputs"]["positive"], [enc_id(prompt, enc), 0])
        self.assertEqual(sampler["inputs"]["latent_image"], [enc_id(prompt, enc), 2])
        self.assertTrue(any("16435" in w for w in warnings))

    def test_krea_edit_wires_target_latent(self):
        spec = _diff_spec(
            pipeline="edit",
            edit_method="krea2_edit",
            image="zeroimagestudio/crop.png",
            references=["zeroimagestudio/id.png"],
            loras=[{"name": "krea2_identity_edit_v2.safetensors", "enabled": True, "strength_model": 1, "strength_clip": 0}],
            krea={"fit_mode": "fit", "grounding_px": 1024, "impl": "internal", "ref_position": "beside (right of target)"},
            denoise=0.4,
        )
        prompt, warnings, built = build_workflow(spec)
        self.assertEqual(built, "edit:krea2_edit")
        self.assertIn("ZeroImageStudioKrea2EditModelPatch", classes(prompt))
        self.assertIn("ZeroImageStudioKrea2EditGroundedEncode", classes(prompt))
        self.assertEqual(classes(prompt).count("ZeroImageStudioKrea2EditGroundedEncode"), 2)
        patch = next(n for n in prompt.values() if n["class_type"] == "ZeroImageStudioKrea2EditModelPatch")
        latent = next(nid for nid, n in prompt.items() if n["class_type"] == "EmptySD3LatentImage")
        sampler = next(n for n in prompt.values() if n["class_type"] == "KSampler")
        self.assertEqual(patch["inputs"]["target_latent"], [latent, 0])
        self.assertEqual(sampler["inputs"]["latent_image"], [latent, 0])
        self.assertEqual(patch["inputs"]["fit_mode"], "fit")
        self.assertIn("source_image_b", patch["inputs"])
        self.assertEqual(sampler["inputs"]["denoise"], 1.0)
        self.assertTrue(any("Denoise" in w for w in warnings))

    def test_krea_general_drops_reference_and_warns_over_two_megapixels(self):
        spec = _diff_spec(
            pipeline="edit",
            edit_method="krea2_edit",
            image="zeroimagestudio/crop.png",
            references=["zeroimagestudio/extra.png"],
            prompt="удали лампу",
            width=1600,
            height=1280,
            loras=[{"name": "krea2_general_edit_v2.safetensors", "enabled": True, "strength_model": 1, "strength_clip": 1}],
            krea={"task": "general", "fit_mode": "fit", "grounding_px": 768, "impl": "internal", "ref_position": "aligned (trained)"},
        )
        prompt, warnings, built = build_workflow(spec)
        self.assertEqual(built, "edit:krea2_edit")
        patch = next(n for n in prompt.values() if n["class_type"] == "ZeroImageStudioKrea2EditModelPatch")
        enc = next(n for n in prompt.values() if n["class_type"] == "ZeroImageStudioKrea2EditGroundedEncode")
        self.assertNotIn("source_image_b", patch["inputs"])
        self.assertNotIn("image_b", enc["inputs"])
        self.assertEqual(enc["inputs"]["grounding_px"], 768)
        self.assertEqual(patch["inputs"]["ref_position"], "aligned (trained)")
        self.assertTrue(any("2 Мп" in w for w in warnings))
        self.assertTrue(any("Raw" in w for w in warnings))
        self.assertTrue(any("только холст" in w for w in warnings))

    def test_krea_identity_keeps_subject_reference(self):
        spec = _diff_spec(
            pipeline="edit",
            edit_method="krea2_edit",
            image="zeroimagestudio/scene.png",
            references=["zeroimagestudio/person.png", "zeroimagestudio/extra.png"],
            loras=[{"name": "krea/krea2_identity_edit_v2.safetensors", "enabled": True, "strength_model": 1, "strength_clip": 1}],
            krea={
                "task": "identity",
                "fit_mode": "fit",
                "grounding_px": 1024,
                "impl": "internal",
                "ref_position": "beside (right of target)",
                "ref_position_a": "aligned (trained)",
            },
        )
        prompt, warnings, _built = build_workflow(spec)
        patch = next(n for n in prompt.values() if n["class_type"] == "ZeroImageStudioKrea2EditModelPatch")
        enc = next(n for n in prompt.values() if n["class_type"] == "ZeroImageStudioKrea2EditGroundedEncode")
        self.assertIn("source_image_b", patch["inputs"])
        self.assertIn("source_latent_b", patch["inputs"])
        self.assertEqual(patch["inputs"]["ref_position"], "beside (right of target)")
        self.assertEqual(patch["inputs"]["ref_position_a"], "aligned (trained)")
        self.assertEqual(enc["inputs"]["grounding_px"], 1024)
        self.assertTrue(any("Лишние" in w for w in warnings))
        self.assertFalse(any("2 Мп" in w for w in warnings))

    def test_krea_external_class_names(self):
        spec = _diff_spec(pipeline="edit", edit_method="krea2_edit", image="a.png", krea={"impl": "external"})
        prompt, _w, _b = build_workflow(spec)
        self.assertIn("Krea2EditModelPatch", classes(prompt))
        self.assertNotIn("ZeroImageStudioKrea2EditModelPatch", classes(prompt))

    def test_edit_inpaint_requires_image(self):
        with self.assertRaises(WorkflowError):
            build_workflow(_diff_spec(pipeline="edit", edit_method="inpaint"))

    def test_missing_files(self):
        spec = _diff_spec()
        spec["unet"] = ""
        with self.assertRaises(WorkflowError):
            build_workflow(spec)

    def test_qwen_create_uses_requested_frame(self):
        prompt, warnings, built = build_workflow(_diff_spec(
            encoder="qwen_image_21",
            clip_type="qwen_image",
            width=832,
            height=1216,
        ))
        self.assertEqual(built, "create")
        self.assertNotIn("TextEncodeQwenImage21", classes(prompt))
        self.assertGreaterEqual(classes(prompt).count("CLIPTextEncode"), 2)
        latent = next(n for n in prompt.values() if n["class_type"] == "EmptySD3LatentImage")
        self.assertEqual(latent["inputs"]["width"], 832)
        self.assertEqual(latent["inputs"]["height"], 1216)
        sampler = next(n for n in prompt.values() if n["class_type"] == "KSampler")
        latent_id = next(nid for nid, n in prompt.items() if n["class_type"] == "EmptySD3LatentImage")
        self.assertEqual(sampler["inputs"]["latent_image"], [latent_id, 0])
        self.assertFalse(any("квадрат" in w for w in warnings))

    def test_qwen_create_snaps_frame_to_16(self):
        prompt, _, _ = build_workflow(_diff_spec(
            encoder="qwen_image_21",
            clip_type="qwen_image",
            width=830,
            height=1210,
        ))
        latent = next(n for n in prompt.values() if n["class_type"] == "EmptySD3LatentImage")
        self.assertEqual(latent["inputs"]["width"], 832)
        self.assertEqual(latent["inputs"]["height"], 1216)

    def test_create_uses_requested_frame(self):
        prompt, _, built = build_workflow(_diff_spec(width=832, height=1216))
        self.assertEqual(built, "create")
        latent = next(n for n in prompt.values() if n["class_type"] == "EmptySD3LatentImage")
        self.assertEqual(latent["inputs"]["width"], 832)
        self.assertEqual(latent["inputs"]["height"], 1216)

    def test_create_snaps_frame_to_16(self):
        prompt, _, _ = build_workflow(_diff_spec(width=830, height=1210))
        latent = next(n for n in prompt.values() if n["class_type"] == "EmptySD3LatentImage")
        self.assertEqual(latent["inputs"]["width"], 832)
        self.assertEqual(latent["inputs"]["height"], 1216)

    def test_snap(self):
        self.assertEqual(snap(1000, 16), 1008)
        self.assertEqual(snap(8, 64), 64)


def enc_id(prompt, node):
    for nid, item in prompt.items():
        if item is node:
            return nid
    raise AssertionError("node missing")


if __name__ == "__main__":
    unittest.main()
