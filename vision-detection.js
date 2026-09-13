/* ============================================================================
   vision-detection.js
   Free, fully client-side person/object detection + depth ordering +
   segmentation for Pa.

   Everything here is free and runs entirely in the browser:
   - Google MediaPipe Tasks Vision (WASM/GPU, no API key) for object
     detection (EfficientDet-Lite0) and person segmentation (selfie
     segmenter).
   - transformers.js running Depth-Anything-V2-Small (ONNX, WebGPU/WASM,
     no API key) for real per-pixel monocular depth.
   All model assets are public, no-auth, no-billing CDN/HF downloads that
   are cached by the browser after first load.

   STATUS: Phase 2 (see PROGRESS.md)
   - [DONE] Object + person detection (COCO-80 classes) via EfficientDet-Lite0
   - [DONE] Heuristic depth ranking (bbox size + vertical position + class prior)
     — kept as the always-available fallback / low-end-device default.
   - [DONE] Primary-person tracking (biggest/most confident "person" box)
   - [DONE] Real per-pixel depth via Depth-Anything-V2-Small (transformers.js),
     gated behind an explicit toggle, sampled into each detection's depth.
   - [DONE] Person segmentation mask (MediaPipe selfie segmenter) exposed as
     an alpha-mask canvas for pixel-accurate occlusion compositing, with
     temporal smoothing (exponential blend across frames) to reduce
     hair/edge flicker.
   - [DONE] Adaptive perf: an internal FPS monitor throttles how often the
     heavy models (depth, segmentation) run, independent of the (cheap)
     object-detection cadence.
   - [TODO next] Wire depth + mask into the Three.js layer to matte the
     avatar against the person (this is done on the HTML side now, in
     ai-costar-overlay.html's updateOcclusion(), which consumes
     getOcclusionMask() from this module).

   ========================================================================= */

// NOTE: import from the package root, NOT ".../vision_bundle.mjs" — that file
// only exposes a default export (it's meant for <script> tags), so
// `const { ObjectDetector, FilesetResolver } = await import(...)` against it
// throws at runtime. The package root resolves to the real ESM entry with
// proper named exports. (Confirmed against MediaPipe's own docs + a
// first-hand report of this exact failure mode.) Pin a specific version in
// production rather than @latest, so a future breaking release doesn't
// silently change behavior underneath you.
const VISION_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

// Public, free, no-auth model assets hosted by Google.
const OBJECT_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";
const SEGMENTER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

// transformers.js (Hugging Face) — free, client-side, no key. Depth Anything
// V2 Small has a public ONNX conversion under onnx-community that
// transformers.js's `depth-estimation` pipeline consumes directly.
const TRANSFORMERS_CDN =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm";
const DEPTH_MODEL_ID = "onnx-community/depth-anything-v2-small";

/**
 * A single detected thing, normalized to 0..1 video coordinates.
 * depth: 0 = closest to camera (front), 1 = farthest (back). Comes from the
 * real depth model when enabled + loaded, otherwise the bbox heuristic.
 */
class Detection {
  constructor({ label, score, x, y, w, h, depth, isPerson }) {
    this.label = label;
    this.score = score;
    this.x = x; this.y = y; this.w = w; this.h = h; // normalized 0..1, top-left origin
    this.depth = depth;
    this.isPerson = isPerson;
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  get area() { return this.w * this.h; }
}

/** Simple rolling frame-time monitor used to adapt heavy-model cadence. */
class PerfMonitor {
  constructor() {
    this._last = 0;
    this._avgMs = 16.7; // assume 60fps until we know otherwise
  }
  tick() {
    const now = performance.now();
    if (this._last) {
      const dt = now - this._last;
      // exponential moving average, ~1s time constant at 60fps
      this._avgMs = this._avgMs * 0.94 + dt * 0.06;
    }
    this._last = now;
  }
  get fps() {
    return this._avgMs > 0 ? 1000 / this._avgMs : 60;
  }
}

export class VisionSystem {
  /**
   * @param {HTMLVideoElement} video - the live webcam element already playing
   * @param {HTMLCanvasElement} [debugCanvas] - optional overlay canvas for boxes
   * @param {(dets: Detection[]) => void} [onDetections] - fired every frame with results
   * @param {boolean} [useRealDepth] - start with the heavy depth model enabled
   * @param {boolean} [useSegmentation] - start with selfie segmentation enabled
   * @param {"auto"|"full"|"battery"} [perfMode] - heavy-model cadence strategy
   */
  constructor({
    video,
    debugCanvas = null,
    onDetections = null,
    useRealDepth = false,
    useSegmentation = false,
    perfMode = "auto",
  } = {}) {
    this.video = video;
    this.debugCanvas = debugCanvas;
    this.onDetections = onDetections;

    this.detector = null; // MediaPipe ObjectDetector
    this.segmenter = null; // MediaPipe ImageSegmenter
    this.depthPipeline = null; // transformers.js depth-estimation pipeline

    this.running = false;
    this.showBoxes = true;
    this._loopHandle = null;
    this._lastVideoTime = -1;
    this.latest = []; // most recent Detection[]
    this._loadingPromise = null;

    this._wantRealDepth = !!useRealDepth;
    this._wantSegmentation = !!useSegmentation;
    this._depthLoading = false;
    this._segLoading = false;
    this._depthReady = false;
    this._segReady = false;

    this._perfMode = perfMode;
    this._perf = new PerfMonitor();
    this._tickCount = 0;
    // How many ticks to skip between heavy-model runs. Recomputed each
    // frame by _adaptCadence() when perfMode === "auto".
    this._depthEveryN = 6; // Depth-Anything is the heaviest — run least often
    this._segEveryN = 2; // selfie segmenter is lighter — run more often

    // Real depth map, normalized 0 (near) .. 1 (far), same aspect as video.
    this._depthMap = null; // { data: Float32Array, width, height }
    this._depthBusy = false;
    this._depthVersion = 0; // bumped each time _depthMap is replaced

    // Session 6: temporal smoothing for depth, same idea as _maskSmooth
    // below. Depth-Anything's raw per-frame output has enough pixel noise
    // that occlusion flickers right at the avatarDepth boundary even when
    // you're holding still. Blending each new frame in rather than using it
    // raw fixes that without adding a perceptible frame of latency.
    this._depthSmooth = null; // Float32Array, same length as depth map, or null before first frame
    this._depthSmoothFactor = 0.4; // weight given to each new frame; lower = steadier, slower to react

    // Person mask, as an offscreen canvas: alpha = person probability*255,
    // RGB = the actual video pixels (so it can be drawn straight onto an
    // occlusion layer with destination-in / drawn directly).
    this._maskCanvas = document.createElement("canvas");
    this._maskBusy = false;
    this._segHasFrame = false;
    this._maskVersion = 0; // bumped each time _maskCanvas is rebuilt

    // Temporal smoothing (PROGRESS.md remaining item 2): the selfie
    // segmenter's raw category mask is single-frame and binary (0/1 per
    // pixel), so hair/edge pixels can flicker in and out frame-to-frame.
    // This buffer holds a running exponential average (0..255 per pixel, at
    // the mask's own resolution) that gets written into _maskCanvas's alpha
    // channel instead of the raw binary value, softening exactly that edge
    // flicker without adding a frame of latency (it's a blend, not a delay).
    this._maskSmooth = null; // Float32Array, same length as mw*mh, or null before first frame
    this._maskSmoothW = 0;
    this._maskSmoothH = 0;
    // Weight given to each *new* frame's raw value; 1 = no smoothing (old
    // behavior), lower = steadier edges but slower to react to real motion.
    // 0.35 favors steadiness since segmentation already runs on its own
    // throttled cadence (_segEveryN) rather than every tick.
    this._maskSmoothFactor = 0.35;

    // Per-pixel occlusion stencil (item 3 in PROGRESS.md "REMAINING"):
    // RGB = white, alpha = person-mask-alpha wherever that pixel's real
    // depth is nearer than the avatar's depth slot, 0 elsewhere. Rebuilt
    // lazily in getOcclusionMask() only when the mask or depth map actually
    // changed (tracked via the version counters above) or avatarDepth
    // itself changed, since both inputs update on their own throttled
    // cadence and rebuilding every rendered frame would be wasted work.
    this._occlusionStencilCanvas = document.createElement("canvas");
    this._occlusionStencilKey = null;

    // Scratch canvases for feeding video frames into the heavy models
    // (both want a plain 2D canvas / ImageBitmap, not a <video> element,
    // to control resolution and stay fast).
    this._depthScratch = document.createElement("canvas");
    // Session 6 perf fix: MediaPipe's ImageSegmenter returns a categoryMask
    // sized to whatever input it was given — if you feed it the raw <video>
    // element (1280x720 typical webcam), _maskCanvas and every per-pixel
    // loop that reads it (_runSegmentation's smoothing pass,
    // _buildPixelOcclusionStencil) end up doing ~920k-iteration CPU loops
    // every frame, which is the dominant source of jank. Feeding it this
    // downscaled scratch canvas instead keeps the mask at a fixed, cheap
    // resolution regardless of camera resolution; drawImage() upscaling it
    // back out in updateOcclusion() is free (GPU-composited) and the
    // bilinear blur that comes along with that upscale is a *better* look
    // for a cutout edge than a razor-sharp per-pixel mask anyway.
    this._segScratch = document.createElement("canvas");
    this._segScratchW = 480; // ~4x fewer pixels per axis vs 1280 typical
  }

  /** Lazily loads MediaPipe's ObjectDetector + the model. Safe to call multiple times. */
  async _ensureLoaded() {
    if (this.detector) return;
    if (this._loadingPromise) return this._loadingPromise;
    this._loadingPromise = (async () => {
      const { ObjectDetector, FilesetResolver } = await import(VISION_CDN);
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      this.detector = await ObjectDetector.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: OBJECT_MODEL_URL,
          delegate: "GPU",
        },
        scoreThreshold: 0.4,
        maxResults: 12,
        runningMode: "VIDEO",
      });
    })().catch((err) => {
      console.error("[VisionSystem] failed to load object detector:", err);
      this._loadingPromise = null;
      throw err;
    });
    return this._loadingPromise;
  }

  /** Lazily loads MediaPipe's ImageSegmenter (selfie segmentation). */
  async _ensureSegmenterLoaded() {
    if (this.segmenter || this._segLoading) return;
    this._segLoading = true;
    try {
      const { ImageSegmenter, FilesetResolver } = await import(VISION_CDN);
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      this.segmenter = await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: SEGMENTER_MODEL_URL,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
      this._segReady = true;
    } catch (err) {
      console.error("[VisionSystem] failed to load segmenter:", err);
      this.segmenter = null;
      this._segReady = false;
      this._wantSegmentation = false; // don't keep retrying every tick
    } finally {
      this._segLoading = false;
    }
  }

  /** Lazily loads transformers.js + Depth-Anything-V2-Small (~50-100MB, cached after first load). */
  async _ensureDepthLoaded() {
    if (this.depthPipeline || this._depthLoading) return;
    this._depthLoading = true;
    try {
      const { pipeline } = await import(TRANSFORMERS_CDN);
      // Prefer WebGPU (fast); transformers.js falls back to wasm internally
      // on unsupported browsers when device isn't forced, so try webgpu
      // first and retry plain (auto) on failure rather than hard-failing.
      try {
        this.depthPipeline = await pipeline("depth-estimation", DEPTH_MODEL_ID, {
          device: "webgpu",
        });
      } catch (webgpuErr) {
        console.warn(
          "[VisionSystem] WebGPU depth model failed, falling back to CPU/WASM:",
          webgpuErr,
        );
        this.depthPipeline = await pipeline("depth-estimation", DEPTH_MODEL_ID);
      }
      this._depthReady = true;
    } catch (err) {
      console.error("[VisionSystem] failed to load depth model:", err);
      this.depthPipeline = null;
      this._depthReady = false;
      this._wantRealDepth = false; // don't keep retrying every tick
    } finally {
      this._depthLoading = false;
    }
  }

  async start() {
    if (this.running) return;
    try {
      await this._ensureLoaded();
    } catch {
      return; // load failed; caller can check .detector === null
    }
    if (this._wantSegmentation) this._ensureSegmenterLoaded(); // fire and forget
    if (this._wantRealDepth) this._ensureDepthLoaded(); // fire and forget
    this.running = true;
    this._tick();
  }

  stop() {
    this.running = false;
    if (this._loopHandle) cancelAnimationFrame(this._loopHandle);
    this._loopHandle = null;
    this.latest = [];
    this._depthMap = null;
    this._segHasFrame = false;
    this._maskSmooth = null; // drop stale smoothing state so a restart doesn't blend against last session's mask
    this._depthSmooth = null; // same, for depth
    this._clearDebug();
  }

  setShowBoxes(v) {
    this.showBoxes = !!v;
    if (!this.showBoxes) this._clearDebug();
  }

  /** Toggle the heavy monocular-depth model on/off. Lazily loads on first enable. */
  setRealDepthEnabled(v) {
    this._wantRealDepth = !!v;
    if (this._wantRealDepth && !this.depthPipeline) this._ensureDepthLoaded();
    if (!this._wantRealDepth) {
      this._depthMap = null; // drop stale map immediately
      this._depthSmooth = null;
    }
  }

  /** Toggle person segmentation on/off. Lazily loads on first enable. */
  setSegmentationEnabled(v) {
    this._wantSegmentation = !!v;
    if (this._wantSegmentation && !this.segmenter) this._ensureSegmenterLoaded();
    if (!this._wantSegmentation) {
      this._segHasFrame = false;
      this._maskSmooth = null;
    }
  }

  /**
   * "auto" adapts cadence to measured fps; "full" runs heavy models as
   * often as the (still-throttled) minimums allow; "battery" runs them
   * least often, for low-end devices.
   */
  setPerfMode(mode) {
    this._perfMode = mode;
  }

  get usingRealDepth() {
    return this._wantRealDepth && this._depthReady && !!this._depthMap;
  }
  get usingSegmentation() {
    return this._wantSegmentation && this._segReady && this._segHasFrame;
  }
  get depthModelLoading() {
    return this._depthLoading;
  }
  get segmenterLoading() {
    return this._segLoading;
  }

  /** Recompute how many ticks to skip between heavy-model runs. */
  _adaptCadence() {
    if (this._perfMode === "full") {
      this._depthEveryN = 3;
      this._segEveryN = 1;
      return;
    }
    if (this._perfMode === "battery") {
      this._depthEveryN = 12;
      this._segEveryN = 4;
      return;
    }
    // "auto": look at measured fps and back off if the page is struggling.
    const fps = this._perf.fps;
    if (fps < 24) {
      this._depthEveryN = 14;
      this._segEveryN = 5;
    } else if (fps < 40) {
      this._depthEveryN = 8;
      this._segEveryN = 3;
    } else {
      this._depthEveryN = 5;
      this._segEveryN = 2;
    }
  }

  _tick = () => {
    if (!this.running) return;
    this._loopHandle = requestAnimationFrame(this._tick);
    this._perf.tick();

    const video = this.video;
    if (!video || video.readyState < 2 || video.currentTime === this._lastVideoTime) {
      return;
    }
    this._lastVideoTime = video.currentTime;
    if (!this.detector) return;

    this._tickCount++;
    this._adaptCadence();

    let result;
    try {
      result = this.detector.detectForVideo(video, performance.now());
    } catch (err) {
      console.error("[VisionSystem] detect error:", err);
      return;
    }

    const vw = video.videoWidth || 1;
    const vh = video.videoHeight || 1;
    const dets = (result.detections || []).map((d) => {
      const box = d.boundingBox; // {originX, originY, width, height} in px
      const cat = d.categories && d.categories[0];
      const x = box.originX / vw;
      const y = box.originY / vh;
      const w = box.width / vw;
      const h = box.height / vh;
      const label = cat ? cat.categoryName : "object";
      const score = cat ? cat.score : 0;
      return new Detection({
        label, score, x, y, w, h,
        depth: 0, // filled in by _rankDepth below
        isPerson: label === "person",
      });
    });

    // Heavy models run on their own throttled cadence (independent of the
    // cheap object detector above), gated by both "wanted" + "loaded".
    if (this._wantRealDepth) {
      if (!this.depthPipeline && !this._depthLoading) this._ensureDepthLoaded();
      if (this.depthPipeline && !this._depthBusy && this._tickCount % this._depthEveryN === 0) {
        this._runDepthEstimation(video, vw, vh); // async, fire and forget
      }
    }
    if (this._wantSegmentation) {
      if (!this.segmenter && !this._segLoading) this._ensureSegmenterLoaded();
      if (this.segmenter && !this._maskBusy && this._tickCount % this._segEveryN === 0) {
        this._runSegmentation(video, vw, vh);
      }
    }

    this._rankDepth(dets);
    this.latest = dets;
    if (this.onDetections) this.onDetections(dets);
    if (this.showBoxes) this._draw(dets);
  };

  /**
   * Runs Depth-Anything-V2-Small on the current video frame. Heavy (tens of
   * ms even on GPU), so this is called on a throttled cadence from _tick and
   * never awaited by the main loop — it just updates this._depthMap
   * whenever it finishes, and the *next* _rankDepth call picks it up.
   */
  async _runDepthEstimation(video, vw, vh) {
    this._depthBusy = true;
    try {
      // Downscale for speed — depth doesn't need full video resolution,
      // and a smaller input is dramatically faster with little quality loss
      // once re-mapped back to normalized 0..1 coordinates.
      const DW = 256;
      const DH = Math.max(1, Math.round((vh / vw) * DW));
      const scratch = this._depthScratch;
      if (scratch.width !== DW || scratch.height !== DH) {
        scratch.width = DW;
        scratch.height = DH;
      }
      const sctx = scratch.getContext("2d");
      sctx.drawImage(video, 0, 0, DW, DH);

      const output = await this.depthPipeline(scratch);
      // transformers.js's depth-estimation pipeline returns
      // { predicted_depth: Tensor, depth: RawImage } — `depth` is a
      // single-channel image already normalized/resized to the input size.
      const depthImg = output && output.depth;
      if (!depthImg || !depthImg.data) return;

      // Depth-Anything outputs *inverse* depth (disparity): larger pixel
      // value = physically closer. Convert to our 0 (near) .. 1 (far)
      // convention while copying into a plain Float32Array.
      const n = depthImg.width * depthImg.height;
      const src = depthImg.data; // Uint8ClampedArray, single channel (or RGBA — handle both)
      const channels = src.length / n;

      // Reset the smoothing buffer if resolution changed (first frame, or
      // the model/input size changed) rather than blending stale data of
      // the wrong shape into the new one.
      if (!this._depthSmooth || this._depthSmooth.length !== n) {
        this._depthSmooth = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const v = src[i * channels] / 255;
          this._depthSmooth[i] = 1 - v; // seed with this frame's raw values
        }
      } else {
        const k = this._depthSmoothFactor;
        for (let i = 0; i < n; i++) {
          const v = src[i * channels] / 255;
          const raw = 1 - v;
          this._depthSmooth[i] += (raw - this._depthSmooth[i]) * k;
        }
      }

      this._depthMap = {
        data: this._depthSmooth,
        width: depthImg.width,
        height: depthImg.height,
      };
      this._depthVersion++;
    } catch (err) {
      console.error("[VisionSystem] depth estimation error:", err);
    } finally {
      this._depthBusy = false;
    }
  }

  /**
   * Runs MediaPipe's selfie segmenter on the current video frame and
   * rebuilds this._maskCanvas so it holds: RGB = the video's own pixels,
   * alpha = person probability * 255. That shape lets a caller composite it
   * directly (drawImage the mask, or use it as a destination-in stencil
   * over a freshly drawn video frame — see ai-costar-overlay.html's
   * updateOcclusion()).
   */
  _runSegmentation(video, vw, vh) {
    this._maskBusy = true;
    try {
      // Downscale before handing to the segmenter (see _segScratch comment
      // in the constructor) — keeps the returned categoryMask, and every
      // loop downstream that reads it, cheap and resolution-independent.
      const SW = this._segScratchW;
      const SH = Math.max(1, Math.round((vh / vw) * SW));
      const scratch = this._segScratch;
      if (scratch.width !== SW || scratch.height !== SH) {
        scratch.width = SW;
        scratch.height = SH;
      }
      scratch.getContext("2d").drawImage(video, 0, 0, SW, SH);
      const result = this.segmenter.segmentForVideo(scratch, performance.now());
      const categoryMask = result && result.categoryMask;
      if (!categoryMask) return;
      const maskArr = categoryMask.getAsUint8Array(); // 0/1 per pixel (or per-category index)
      const mw = categoryMask.width, mh = categoryMask.height;
      const n = mw * mh;

      // Reset the smoothing buffer if the mask resolution changed (first
      // frame, or the model/canvas size changed) rather than blending
      // stale data of the wrong shape into the new one.
      if (!this._maskSmooth || this._maskSmoothW !== mw || this._maskSmoothH !== mh) {
        this._maskSmooth = new Float32Array(n);
        this._maskSmoothW = mw;
        this._maskSmoothH = mh;
        // Seed with this frame's raw values so the very first frame isn't
        // dragged toward 0 by blending against an empty buffer.
        for (let i = 0; i < n; i++) {
          this._maskSmooth[i] = maskArr[i] !== 0 ? 255 : 0;
        }
      } else {
        const k = this._maskSmoothFactor;
        for (let i = 0; i < n; i++) {
          const raw = maskArr[i] !== 0 ? 255 : 0;
          this._maskSmooth[i] += (raw - this._maskSmooth[i]) * k;
        }
      }

      const canvas = this._maskCanvas;
      if (canvas.width !== mw || canvas.height !== mh) {
        canvas.width = mw;
        canvas.height = mh;
      }
      // willReadFrequently: this canvas is read back via getImageData in
      // _buildPixelOcclusionStencil() every time the mask changes — without
      // this hint Chrome keeps warning (correctly) that it's picked a
      // GPU-backed context that makes repeated readback slower than it
      // needs to be.
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const imgData = ctx.createImageData(mw, mh);
      const smooth = this._maskSmooth;
      for (let i = 0; i < n; i++) {
        imgData.data[i * 4 + 0] = 255;
        imgData.data[i * 4 + 1] = 255;
        imgData.data[i * 4 + 2] = 255;
        imgData.data[i * 4 + 3] = smooth[i] | 0;
      }
      ctx.putImageData(imgData, 0, 0);
      categoryMask.close && categoryMask.close(); // MPMask holds GPU memory — release it
      this._segHasFrame = true;
      this._maskVersion++;
    } catch (err) {
      console.error("[VisionSystem] segmentation error:", err);
    } finally {
      this._maskBusy = false;
    }
  }

  /**
   * Depth ranking. Uses the real per-pixel depth map (sampled over each
   * detection's box) when available and enabled; otherwise falls back to
   * the Phase 1 heuristic (box size + vertical position + class prior).
   */
  _rankDepth(dets) {
    if (!dets.length) return;
    const useReal = this.usingRealDepth;
    for (const d of dets) {
      d.depth = useReal ? this._sampleDepthMap(d) : this._heuristicDepth(d);
    }
    dets.sort((a, b) => a.depth - b.depth);
  }

  /** Phase-1 heuristic depth for a single detection (0 near .. 1 far). */
  _heuristicDepth(d) {
    const sizeScore = 1 - Math.min(1, d.area * 3); // bigger box -> smaller score -> closer
    const posScore = 1 - d.cy; // lower in frame (larger cy) -> closer
    const personBias = d.isPerson ? -0.15 : 0;
    return Math.max(0, Math.min(1, sizeScore * 0.6 + posScore * 0.4 + personBias));
  }

  /** Average the real depth map over a detection's bbox (cheap 3x3 sample grid). */
  _sampleDepthMap(d) {
    const map = this._depthMap;
    if (!map) return this._heuristicDepth(d);
    const { data, width, height } = map;
    let sum = 0, count = 0;
    for (let gy = 0; gy < 3; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        const nx = d.x + d.w * ((gx + 0.5) / 3);
        const ny = d.y + d.h * ((gy + 0.5) / 3);
        const px = Math.min(width - 1, Math.max(0, Math.round(nx * width)));
        const py = Math.min(height - 1, Math.max(0, Math.round(ny * height)));
        sum += data[py * width + px];
        count++;
      }
    }
    return count ? sum / count : this._heuristicDepth(d);
  }

  /**
   * Real depth at an arbitrary normalized (0..1, 0..1) video coordinate, or
   * the heuristic-equivalent fallback (0.5, "middle distance") when the
   * real model isn't ready. Handy for sampling depth under a segmentation
   * mask rather than only at detection boxes.
   */
  getDepthAt(nx, ny) {
    const map = this._depthMap;
    if (!this.usingRealDepth || !map) return 0.5;
    const { data, width, height } = map;
    const px = Math.min(width - 1, Math.max(0, Math.round(nx * width)));
    const py = Math.min(height - 1, Math.max(0, Math.round(ny * height)));
    return data[py * width + px];
  }

  /** Largest, closest detected person — treated as "the user" for framing/scale logic. */
  getPrimaryPerson() {
    const people = this.latest.filter((d) => d.isPerson);
    if (!people.length) return null;
    return people.reduce((best, d) => (d.area > best.area ? d : best), people[0]);
  }

  /** True if any detection is currently estimated to be nearer than `depthThreshold`. */
  hasSomethingInFrontOf(depthThreshold) {
    return this.latest.some((d) => d.depth < depthThreshold);
  }

  /**
   * The latest person-mask canvas (RGB = video pixels, alpha = person
   * probability), or null if segmentation is off / not ready yet. Caller
   * owns nothing special here — treat it as read-only and draw it via
   * drawImage/destination-in the same frame you read it, since it's
   * overwritten in place on the next segmentation pass.
   */
  getPersonMaskCanvas() {
    return this.usingSegmentation ? this._maskCanvas : null;
  }

  /**
   * Occlusion stencil for a given avatar depth slot (PROGRESS.md item 3:
   * per-pixel partial occlusion instead of all-or-nothing).
   *
   * Returns an offscreen canvas (RGB = white, alpha = person-mask-alpha
   * wherever that pixel is estimated nearer than `avatarDepth`, 0
   * elsewhere) ready to be drawn as a destination-in stencil over a fresh
   * video frame — same contract as getPersonMaskCanvas() used to have.
   * Returns null when there's nothing to occlude with (segmentation off/not
   * ready) or nothing currently occludes.
   *
   * When real per-pixel depth isn't enabled/loaded, falls back to the
   * original whole-silhouette behavior (the entire person mask occludes,
   * or none of it does, based on getPrimaryPerson().depth) — same as
   * Phase 2 before this method existed.
   */
  getOcclusionMask(avatarDepth) {
    if (!this.usingSegmentation || !this._segHasFrame) return null;

    if (!this.usingRealDepth || !this._depthMap) {
      const primary = this.getPrimaryPerson();
      if (!primary || primary.depth >= avatarDepth) return null;
      return this._maskCanvas;
    }

    // Per-pixel path. Skip the rebuild if neither input changed since the
    // last call with this exact avatarDepth — the mask and depth map each
    // update on their own throttled cadence, so most calls (driven every
    // rendered frame) can reuse the cached stencil.
    const key = `${this._maskVersion}:${this._depthVersion}:${avatarDepth}`;
    if (key === this._occlusionStencilKey) return this._occlusionStencilCanvas;
    this._occlusionStencilKey = key;
    return this._buildPixelOcclusionStencil(avatarDepth);
  }

  /**
   * Builds the per-pixel occlusion stencil at the segmentation mask's own
   * resolution, sampling the (possibly different-resolution) depth map via
   * nearest-neighbor lookup at each mask pixel's normalized coordinate.
   */
  _buildPixelOcclusionStencil(avatarDepth) {
    const maskCanvas = this._maskCanvas;
    const mw = maskCanvas.width, mh = maskCanvas.height;
    if (!mw || !mh) return null;

    const maskData = maskCanvas
      .getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, mw, mh).data;
    const { data: dData, width: dw, height: dh } = this._depthMap;

    const stencil = this._occlusionStencilCanvas;
    if (stencil.width !== mw || stencil.height !== mh) {
      stencil.width = mw;
      stencil.height = mh;
    }
    const outCtx = stencil.getContext("2d", { willReadFrequently: true });
    const outImg = outCtx.createImageData(mw, mh);
    const out = outImg.data;

    // Bilinear depth lookup instead of nearest-neighbor: the depth map
    // (256x144) is much lower-res than the mask it's being sampled against,
    // so a nearest-neighbor Math.round produced a visibly blocky,
    // stair-stepped occlusion edge. Interpolating across the 4 nearest
    // depth samples gives a smooth boundary that tracks the mask's own
    // (already-smooth) silhouette instead of the depth grid.
    for (let y = 0; y < mh; y++) {
      const ny = (y + 0.5) / mh;
      const fy = ny * dh - 0.5;
      const y0 = Math.min(dh - 1, Math.max(0, Math.floor(fy)));
      const y1 = Math.min(dh - 1, y0 + 1);
      const ty = Math.min(1, Math.max(0, fy - y0));
      for (let x = 0; x < mw; x++) {
        const i = (y * mw + x) * 4;
        const alpha = maskData[i + 3];
        if (alpha === 0) continue; // out[i+3] already 0 from createImageData

        const nx = (x + 0.5) / mw;
        const fx = nx * dw - 0.5;
        const x0 = Math.min(dw - 1, Math.max(0, Math.floor(fx)));
        const x1 = Math.min(dw - 1, x0 + 1);
        const tx = Math.min(1, Math.max(0, fx - x0));

        const d00 = dData[y0 * dw + x0];
        const d10 = dData[y0 * dw + x1];
        const d01 = dData[y1 * dw + x0];
        const d11 = dData[y1 * dw + x1];
        const dTop = d00 + (d10 - d00) * tx;
        const dBot = d01 + (d11 - d01) * tx;
        const depth = dTop + (dBot - dTop) * ty;

        if (depth >= avatarDepth) continue;
        out[i] = 255; out[i + 1] = 255; out[i + 2] = 255;
        out[i + 3] = alpha;
      }
    }
    outCtx.putImageData(outImg, 0, 0);
    return stencil;
  }

  /** Raw depth map ({data, width, height}, near=0..far=1) or null. */
  getDepthMap() {
    return this.usingRealDepth ? this._depthMap : null;
  }

  _clearDebug() {
    if (!this.debugCanvas) return;
    const ctx = this.debugCanvas.getContext("2d");
    ctx.clearRect(0, 0, this.debugCanvas.width, this.debugCanvas.height);
  }

  _draw(dets) {
    const canvas = this.debugCanvas;
    if (!canvas) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.font = "12px ui-monospace, monospace";
    ctx.lineWidth = 2;
    dets.forEach((d, i) => {
      const px = d.x * w, py = d.y * h, pw = d.w * w, ph = d.h * h;
      // closer = warmer color
      const hue = 140 - d.depth * 140; // 140 (green, far) -> 0 (red, near)
      const color = `hsl(${hue}, 85%, 55%)`;
      ctx.strokeStyle = color;
      ctx.strokeRect(px, py, pw, ph);
      const depthSrc = this.usingRealDepth ? "AI" : "heur";
      const tag = `${d.isPerson ? "PERSON" : d.label} ${(d.score * 100).toFixed(0)}% · depth ${d.depth.toFixed(2)} (${depthSrc}) · #${i + 1}`;
      const tw = ctx.measureText(tag).width + 8;
      ctx.fillStyle = color;
      ctx.fillRect(px, Math.max(0, py - 16), tw, 16);
      ctx.fillStyle = "#0b0e14";
      ctx.fillText(tag, px + 4, Math.max(11, py - 4));
    });
    // Small perf readout in the corner so the user can see the adaptive
    // cadence working (or judge whether to flip perfMode to "battery").
    const fps = this._perf.fps.toFixed(0);
    const readout = `${fps}fps · depth 1/${this._depthEveryN} · seg 1/${this._segEveryN}`;
    ctx.fillStyle = "rgba(11,14,20,0.75)";
    const rw = ctx.measureText(readout).width + 10;
    ctx.fillRect(w - rw - 6, 6, rw, 18);
    ctx.fillStyle = "#e7ecf2";
    ctx.fillText(readout, w - rw - 1, 19);
  }
}
