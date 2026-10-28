import unittest

from zeroimagestudio_workflows import (
    WorkflowError,
    assemble_prompt,
    build_workflow,
    describe_pipeline,
    missing_nodes_message,
    prompt_requests_removal,
    snap,
)


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
        prompt, warnings, _b = build_workflow(spec)
        self.assertIn("VAEEncode", classes(prompt))
        self.assertIn("SetLatentNoiseMask", classes(prompt))
        self.assertNotIn("VAEEncodeForInpaint", classes(prompt))
        self.assertIn("ImageToMask", classes(prompt))
        self.assertNotIn("EmptyLatentImage", classes(prompt))
        sampler = next(n for n in prompt.values() if n["class_type"] == "KSampler")
        self.assertAlmostEqual(sampler["inputs"]["denoise"], 0.7)
        self.assertFalse(any("denoise 1" in w for w in warnings))

    def test_create_inpaint_full_denoise_grows_mask(self):
        spec = _diff_spec(
            image="zeroimagestudio/crop.png",
            mask="zeroimagestudio/mask.png",
            has_mask=True,
            denoise=1,
            inpaint_grow=0,
            latent_mode="standard",
        )
        prompt, warnings, _b = build_workflow(spec)
        enc = next(n for n in prompt.values() if n["class_type"] == "VAEEncodeForInpaint")
        self.assertEqual(enc["inputs"]["grow_mask_by"], 0)
        self.assertNotIn("SetLatentNoiseMask", classes(prompt))
        self.assertTrue(any("denoise 1" in w for w in warnings))

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
        self.assertEqual(classes(prompt).count("ZeroImageStudioKrea2EditGroundedEncode"), 1)
        self.assertNotIn("VAEEncode", classes(prompt))
        patch = next(n for n in prompt.values() if n["class_type"] == "ZeroImageStudioKrea2EditModelPatch")
        latent = next(nid for nid, n in prompt.items() if n["class_type"] == "EmptySD3LatentImage")
        sampler = next(n for n in prompt.values() if n["class_type"] == "KSampler")
        self.assertEqual(patch["inputs"]["target_latent"], [latent, 0])
        self.assertEqual(patch["inputs"]["source_latent"], [latent, 0])
        self.assertNotIn("source_latent_b", patch["inputs"])
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
        self.assertIn("source_image_b", patch["inputs"])
        self.assertIn("image_b", enc["inputs"])
        self.assertNotIn("source_image_c", patch["inputs"])
        self.assertEqual(enc["inputs"]["grounding_px"], 768)
        self.assertEqual(patch["inputs"]["ref_position"], "aligned (trained)")
        self.assertTrue(any("2 Мп" in w for w in warnings))
        self.assertTrue(any("Raw" in w for w in warnings))
        self.assertFalse(any("только холст" in w for w in warnings))

    def test_krea_general_keeps_two_references_and_a_role_hint(self):
        spec = _diff_spec(
            pipeline="edit",
            edit_method="krea2_edit",
            image="zeroimagestudio/crop.png",
            references=["zeroimagestudio/a.png", "zeroimagestudio/b.png", "zeroimagestudio/c.png"],
            reference_roles=["face", "texture", "object"],
            prompt="поменяй глаза",
            width=512,
            height=512,
            loras=[{"name": "krea2_general_edit_v2.safetensors", "enabled": True, "strength_model": 1, "strength_clip": 1}],
            krea={"task": "general", "impl": "internal", "grounding_px": 768},
        )
        prompt, warnings, _built = build_workflow(spec)
        patch = next(n for n in prompt.values() if n["class_type"] == "ZeroImageStudioKrea2EditModelPatch")
        enc = next(n for n in prompt.values() if n["class_type"] == "ZeroImageStudioKrea2EditGroundedEncode")
        self.assertIn("source_image_b", patch["inputs"])
        self.assertIn("source_image_c", patch["inputs"])
        self.assertIn("image_c", enc["inputs"])
        self.assertIn("use the face from image 2", enc["inputs"]["prompt"])
        self.assertIn("use the texture from image 3", enc["inputs"]["prompt"])
        self.assertNotIn("image 4", enc["inputs"]["prompt"])
        self.assertTrue(any("два референса" in w for w in warnings))

    def test_krea_chains_task_lora_then_extras(self):
        spec = _diff_spec(
            pipeline="edit",
            edit_method="krea2_edit",
            image="zeroimagestudio/crop.png",
            loras=[
                {"name": "custom_general.safetensors", "enabled": True, "strength_model": 0.9, "strength_clip": 0.8},
                {"name": "film.safetensors", "enabled": True, "strength_model": 0.4, "strength_clip": 0.3},
                {"name": "skipped.safetensors", "enabled": False, "strength_model": 1, "strength_clip": 1},
            ],
            krea={"task": "general", "fit_mode": "fit", "grounding_px": 768, "impl": "internal"},
        )
        prompt, warnings, built = build_workflow(spec)
        self.assertEqual(built, "edit:krea2_edit")
        loaders = [(nid, n) for nid, n in prompt.items() if n["class_type"] == "LoraLoader"]
        self.assertEqual([n["inputs"]["lora_name"] for _nid, n in loaders], ["custom_general.safetensors", "film.safetensors"])
        self.assertEqual(loaders[0][1]["inputs"]["strength_model"], 0.9)
        self.assertEqual(loaders[1][1]["inputs"]["model"], [loaders[0][0], 0])
        self.assertEqual(loaders[1][1]["inputs"]["clip"], [loaders[0][0], 1])
        self.assertFalse(any("ждёт LoRA" in w for w in warnings))

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
        self.assertNotIn("source_latent_b", patch["inputs"])
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

    def test_denoise_zero_stays_zero(self):
        spec = _diff_spec(image="zeroimagestudio/crop.png", has_mask=False, denoise=0)
        prompt, _, _ = build_workflow(spec)
        sampler = next(n for n in prompt.values() if n["class_type"] == "KSampler")
        self.assertEqual(sampler["inputs"]["denoise"], 0.0)

    def test_grounding_fallback_and_explicit_zero(self):
        general = _diff_spec(
            pipeline="edit",
            edit_method="krea2_edit",
            image="zeroimagestudio/crop.png",
            krea={"task": "general", "impl": "internal"},
        )
        prompt, _, _ = build_workflow(general)
        enc = next(n for n in prompt.values() if n["class_type"] == "ZeroImageStudioKrea2EditGroundedEncode")
        self.assertEqual(enc["inputs"]["grounding_px"], 768)
        general["krea"]["grounding_px"] = 0
        prompt, _, _ = build_workflow(general)
        enc = next(n for n in prompt.values() if n["class_type"] == "ZeroImageStudioKrea2EditGroundedEncode")
        self.assertEqual(enc["inputs"]["grounding_px"], 0)
        identity = _diff_spec(
            pipeline="edit",
            edit_method="krea2_edit",
            image="zeroimagestudio/crop.png",
            krea={"task": "identity", "impl": "internal"},
        )
        prompt, _, _ = build_workflow(identity)
        enc = next(n for n in prompt.values() if n["class_type"] == "ZeroImageStudioKrea2EditGroundedEncode")
        self.assertEqual(enc["inputs"]["grounding_px"], 1024)

    def test_krea_cfg_above_one_grounds_negative(self):
        spec = _diff_spec(
            pipeline="edit",
            edit_method="krea2_edit",
            image="zeroimagestudio/crop.png",
            cfg=2.0,
            krea={"task": "general", "grounding_px": 768, "impl": "internal"},
        )
        prompt, _, _ = build_workflow(spec)
        self.assertEqual(classes(prompt).count("ZeroImageStudioKrea2EditGroundedEncode"), 2)
        self.assertNotIn("VAEEncode", classes(prompt))

    def test_removal_verb_is_not_a_substring(self):
        self.assertTrue(prompt_requests_removal("удали лампу"))
        self.assertTrue(prompt_requests_removal("уберите это"))
        self.assertFalse(prompt_requests_removal("сотрудник у двери"))
        self.assertFalse(prompt_requests_removal("убер"))
        spec = _diff_spec(
            pipeline="edit",
            edit_method="krea2_edit",
            image="zeroimagestudio/crop.png",
            prompt="сотрудник стоит",
            krea={"task": "general", "grounding_px": 768, "impl": "internal"},
        )
        _prompt, warnings, _built = build_workflow(spec)
        self.assertFalse(any("Raw" in w for w in warnings))

    def test_qwen_resolution_zero_is_sent(self):
        spec = _diff_spec(
            pipeline="edit",
            edit_method="qwen_image_21",
            clip_type="qwen_image",
            image="zeroimagestudio/crop.png",
            qwen_resolution=0,
        )
        prompt, warnings, _built = build_workflow(spec)
        enc = next(n for n in prompt.values() if n["class_type"] == "TextEncodeQwenImage21")
        self.assertEqual(enc["inputs"]["resolution"], 0)
        self.assertFalse(any("16435" in w for w in warnings))

    def test_describe_pipeline_snaps_and_keeps_zero(self):
        steps = describe_pipeline(_diff_spec(width=1000, height=1000, steps=0, cfg=0), "create")
        self.assertEqual(steps[0]["text"], "Область 1008×1008")
        self.assertIn("0 / 0", steps[4]["text"])

    def test_missing_krea_nodes_report_import_error(self):
        msg = missing_nodes_message(["ZeroImageStudioKrea2EditModelPatch"], "ImportError: no module")
        self.assertIn("ImportError: no module", msg)
        self.assertNotIn("Обновите ComfyUI", msg)
        other = missing_nodes_message(["TextEncodeQwenImage21"], None)
        self.assertIn("Обновите ComfyUI", other)


def enc_id(prompt, node):
    for nid, item in prompt.items():
        if item is node:
            return nid
    raise AssertionError("node missing")


if __name__ == "__main__":
    unittest.main()
