import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Models = require("../web/zeroimagestudio_models.js");

const krea = {
  id: "krea2_identity_edit",
  edit_method: "krea2_edit",
  defaults: {
    loader: "diffusion", clip_type: "krea2", weight_dtype: "default", latent_mode: "sd3", encoder: "clip",
    unet: "krea2_turbo_fp8_scaled.safetensors", clip: "qwen3vl_4b_fp8_scaled.safetensors", vae: "qwen_image_vae.safetensors",
  },
  krea: { grounding_px: 768, fit_mode: "fit", impl: "internal" },
  sampler: { steps: 8, cfg: 1, denoise: 1, sampler: "euler", scheduler: "simple", batch: 1, seedMode: "random" },
};
const qwen = {
  id: "qwen_image_21",
  edit_method: "qwen_image_21",
  defaults: {
    loader: "diffusion", clip_type: "qwen_image", weight_dtype: "default", latent_mode: "sd3", encoder: "qwen_image_21",
    unet: "qwen_image_2.1_bf16.safetensors", clip: "qwen3vl_8b_bf16.safetensors", vae: "qwen_image_2.1_vae_bf16.safetensors",
  },
  sampler: { steps: 20, cfg: 1, denoise: 1, sampler: "euler", scheduler: "simple", batch: 1, seedMode: "random" },
};

function blank() {
  return {
    loader: "diffusion", checkpoint: "", unet: "", clip: "", vae: "",
    clip_type: "krea2", weight_dtype: "default", latent_mode: "sd3", encoder: "clip",
    method: "krea2_edit", inpaint_mode: "vae_encode", inpaint_grow: 6, qwen_resolution: 0,
    loras: [],
    krea: { task: "general", fit_mode: "fit", grounding_px: 768, impl: "internal", ref_boost: 1, ref_boost_a: 1 },
  };
}

test("switching A to B to A restores A's files, sampler and LoRAs", () => {
  const pipe = blank();
  const sampler = { steps: 28, cfg: 3.5, denoise: 0.72, sampler: "euler", scheduler: "simple", batch: 1, seedMode: "random", seed: 0 };
  let slots = {};
  assert.equal(Models.adopt(slots, krea.id, pipe, "edit", krea, sampler), false);
  pipe.unet = "krea-user.safetensors";
  pipe.vae = "krea-vae.safetensors";
  pipe.weight_dtype = "fp8";
  pipe.krea.task = "identity";
  pipe.krea.grounding_px = 1024;
  sampler.steps = 12;
  sampler.cfg = 2.5;
  sampler.denoise = 0.6;
  sampler.sampler = "dpmpp_2m";
  sampler.scheduler = "beta";
  sampler.batch = 3;
  sampler.seedMode = "fixed";
  sampler.seed = 42;
  pipe.loras = [
    { name: "krea2_identity_edit_v2.safetensors", role: "task", system: true, strength_model: 1, strength_clip: 1, enabled: true },
    { name: "film.safetensors", strength_model: 0.4, strength_clip: 0.4, enabled: true, trigger_mode: "off", triggers: [] },
  ];
  slots = Models.remember(slots, krea.id, pipe, "edit", sampler);

  assert.equal(Models.adopt(slots, qwen.id, pipe, "edit", qwen, sampler), false);
  assert.equal(pipe.vae, "qwen_image_2.1_vae_bf16.safetensors");
  assert.equal(pipe.unet, "qwen_image_2.1_bf16.safetensors");
  assert.equal(pipe.clip_type, "qwen_image");
  assert.equal(pipe.method, "qwen_image_21");
  assert.equal(sampler.steps, 20);
  assert.equal(sampler.cfg, 1);
  assert.equal(sampler.seedMode, "random");
  assert.equal(pipe.loras.some((l) => l.name === "film.safetensors"), false);
  pipe.vae = "texture_fix_vae.safetensors";
  pipe.loras = [{ name: "portrait.safetensors", strength_model: 0.2, strength_clip: 0.2, enabled: false, trigger_mode: "off", triggers: [] }];
  sampler.steps = 30;
  sampler.seedMode = "increment";
  slots = Models.remember(slots, qwen.id, pipe, "edit", sampler);

  assert.equal(Models.adopt(slots, krea.id, pipe, "edit", krea, sampler), true);
  assert.equal(pipe.unet, "krea-user.safetensors");
  assert.equal(pipe.vae, "krea-vae.safetensors");
  assert.equal(pipe.weight_dtype, "fp8");
  assert.equal(pipe.clip_type, "krea2");
  assert.equal(pipe.krea.task, "identity");
  assert.equal(pipe.krea.grounding_px, 1024);
  assert.equal(sampler.steps, 12);
  assert.equal(sampler.cfg, 2.5);
  assert.equal(sampler.denoise, 0.6);
  assert.equal(sampler.sampler, "dpmpp_2m");
  assert.equal(sampler.scheduler, "beta");
  assert.equal(sampler.batch, 3);
  assert.equal(sampler.seedMode, "fixed");
  assert.equal(sampler.seed, 42);
  assert.equal(pipe.loras.some((l) => l.name === "film.safetensors" && l.strength_model === 0.4), true);
  assert.equal(pipe.loras.some((l) => l.role === "task" || l.system), false);

  assert.equal(Models.adopt(slots, qwen.id, pipe, "edit", qwen, sampler), true);
  assert.equal(pipe.vae, "texture_fix_vae.safetensors");
  assert.equal(sampler.steps, 30);
  assert.equal(sampler.seedMode, "increment");
  assert.equal(pipe.loras[0].name, "portrait.safetensors");
  assert.equal(pipe.loras[0].enabled, false);
});
