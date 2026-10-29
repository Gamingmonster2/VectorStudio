import { init, potrace } from './potrace-wasm.js';
import { preprocessMkbitmap } from './mkbitmap.js';

// Application State
const state = {
  wasmReady: false,
  originalImage: null,
  preprocessedData: null,
  svgOutput: '',
  currentView: 'svg',      // 'svg', 'split', 'preprocessed', 'original'
  mode: 'monochrome',      // 'monochrome' or 'color'
  isProcessing: false,
  fileName: 'comic-vector',
};

// Built-in Gallery Definitions & Golden Values
const SAMPLES = {
  comic_video: {
    src: 'samples/comic_video.png',
    name: 'comic-strip-video',
    filter: 2,
    scale: 2,
    threshold: 0.48,
    turdsize: 2,
    alphamax: 1.0,
    opttolerance: 0.20,
    mode: 'monochrome'
  },
  manga_character: {
    src: 'samples/manga_character.png',
    name: 'manga-character',
    filter: 3,
    scale: 2,
    threshold: 0.44,
    turdsize: 2,
    alphamax: 1.1,
    opttolerance: 0.20,
    mode: 'monochrome'
  },
  botanical_sketch: {
    src: 'samples/botanical_sketch.png',
    name: 'fine-line-sketch',
    filter: 2,
    scale: 3,
    threshold: 0.50,
    turdsize: 1,
    alphamax: 0.9,
    opttolerance: 0.15,
    mode: 'monochrome'
  },
  scanned_signature: {
    src: 'samples/scanned_signature.png',
    name: 'scanned-signature',
    filter: 4,
    scale: 2,
    threshold: 0.48,
    turdsize: 2,
    alphamax: 1.0,
    opttolerance: 0.20,
    mode: 'monochrome'
  }
};

// DOM References
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const viewportContent = document.getElementById('viewportContent');
const loadingOverlay = document.getElementById('loadingOverlay');
const toast = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');
const btnThemeToggle = document.getElementById('btnThemeToggle');

// Mode toggles
const btnModeMono = document.getElementById('btnModeMono');
const btnModeColor = document.getElementById('btnModeColor');
const grpThreshold = document.getElementById('grpThreshold');
const grpFilter = document.getElementById('grpFilter');
const grpColorLevels = document.getElementById('grpColorLevels');

// Sliders
const rngFilter = document.getElementById('rngFilter');
const valFilter = document.getElementById('valFilter');
const rngScale = document.getElementById('rngScale');
const valScale = document.getElementById('valScale');
const rngThreshold = document.getElementById('rngThreshold');
const valThreshold = document.getElementById('valThreshold');
const rngColorLevels = document.getElementById('rngColorLevels');
const valColorLevels = document.getElementById('valColorLevels');
const chkInvert = document.getElementById('chkInvert');

const rngTurd = document.getElementById('rngTurd');
const valTurd = document.getElementById('valTurd');
const rngAlpha = document.getElementById('rngAlpha');
const valAlpha = document.getElementById('valAlpha');
const rngOpt = document.getElementById('rngOpt');
const valOpt = document.getElementById('valOpt');

const chkAuto = document.getElementById('chkAuto');
const btnTrace = document.getElementById('btnTrace');

// Actions
const btnCopySvg = document.getElementById('btnCopySvg');
const btnDownloadSvg = document.getElementById('btnDownloadSvg');
const btnDownloadBmp = document.getElementById('btnDownloadBmp');

// Stats
const statDim = document.getElementById('statDim');
const statSize = document.getElementById('statSize');
const statPaths = document.getElementById('statPaths');
const statTime = document.getElementById('statTime');

// Tabs & Cards
const tabButtons = document.querySelectorAll('.tab-btn');
const galleryCards = document.querySelectorAll('.gallery-card');

// Preset buttons
const presetVideo = document.getElementById('presetVideo');
const presetManga = document.getElementById('presetManga');
const presetHandwriting = document.getElementById('presetHandwriting');
const presetFineLine = document.getElementById('presetFineLine');

// --- Initialization ---
async function bootstrap() {
  try {
    await init();
    state.wasmReady = true;
    console.log('⚡ Potrace WebAssembly ready!');
  } catch (err) {
    console.error('Failed to initialize WASM:', err);
  }

  setupEventListeners();
  // Auto-load the exact video comic strip!
  loadSample('comic_video');
}

// --- Setup Event Listeners ---
function setupEventListeners() {
  // Theme toggle
  btnThemeToggle?.addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.theme = isDark ? 'dark' : 'light';
  });

  // Drop & Upload
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      loadFile(e.target.files[0]);
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-foreground/80', 'bg-accent/40');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-foreground/80', 'bg-accent/40');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-foreground/80', 'bg-accent/40');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      loadFile(e.dataTransfer.files[0]);
    }
  });

  // Slider bindings
  const bindSlider = (input, display, unit = '') => {
    input.addEventListener('input', () => {
      display.textContent = input.value + unit;
      if (chkAuto.checked) debouncedRun();
    });
  };

  bindSlider(rngFilter, valFilter);
  bindSlider(rngScale, valScale, 'x');
  bindSlider(rngThreshold, valThreshold);
  bindSlider(rngColorLevels, valColorLevels);
  bindSlider(rngTurd, valTurd);
  bindSlider(rngAlpha, valAlpha);
  bindSlider(rngOpt, valOpt);

  chkInvert.addEventListener('change', () => { if (chkAuto.checked) debouncedRun(); });

  // Mode toggling
  btnModeMono.addEventListener('click', () => setMode('monochrome'));
  btnModeColor.addEventListener('click', () => setMode('color'));

  // Run button
  btnTrace.addEventListener('click', () => runPipeline());

  // Tabs
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => {
        b.classList.remove('active', 'bg-background', 'text-foreground', 'shadow-sm');
        b.classList.add('text-muted-foreground', 'hover:text-foreground');
      });
      btn.classList.add('active', 'bg-background', 'text-foreground', 'shadow-sm');
      btn.classList.remove('text-muted-foreground', 'hover:text-foreground');
      state.currentView = btn.dataset.view;
      renderCurrentView();
    });
  });

  // Gallery Card clicks
  galleryCards.forEach(card => {
    card.addEventListener('click', () => {
      const sampleKey = card.dataset.sample;
      loadSample(sampleKey);
    });
  });

  // Presets Bar clicks
  presetVideo.addEventListener('click', () => applyPresetValues(SAMPLES.comic_video, presetVideo));
  presetManga.addEventListener('click', () => applyPresetValues(SAMPLES.manga_character, presetManga));
  presetHandwriting.addEventListener('click', () => applyPresetValues(SAMPLES.scanned_signature, presetHandwriting));
  presetFineLine.addEventListener('click', () => applyPresetValues(SAMPLES.botanical_sketch, presetFineLine));

  // Export buttons
  btnCopySvg.addEventListener('click', copySvgCode);
  btnDownloadSvg.addEventListener('click', downloadSvgFile);
  btnDownloadBmp.addEventListener('click', downloadBmpFile);
}

// --- Sample Loader ---
function loadSample(key) {
  const sample = SAMPLES[key];
  if (!sample) return;

  // Highlight card with shadcn active style
  galleryCards.forEach(c => {
    if (c.dataset.sample === key) {
      c.classList.add('active', 'border-primary', 'ring-1', 'ring-primary', 'bg-secondary/70');
    } else {
      c.classList.remove('active', 'border-primary', 'ring-1', 'ring-primary', 'bg-secondary/70');
    }
  });

  applyPresetValues(sample);

  state.fileName = sample.name;
  const img = new Image();
  img.onload = () => {
    state.originalImage = img;
    runPipeline();
  };
  img.src = sample.src;
}

// --- Apply Preset Values to Sliders ---
function applyPresetValues(cfg, activeBtn = null) {
  if (cfg.filter !== undefined) {
    rngFilter.value = cfg.filter;
    valFilter.textContent = cfg.filter;
  }
  if (cfg.scale !== undefined) {
    rngScale.value = cfg.scale;
    valScale.textContent = cfg.scale + 'x';
  }
  if (cfg.threshold !== undefined) {
    rngThreshold.value = cfg.threshold;
    valThreshold.textContent = cfg.threshold;
  }
  if (cfg.turdsize !== undefined) {
    rngTurd.value = cfg.turdsize;
    valTurd.textContent = cfg.turdsize;
  }
  if (cfg.alphamax !== undefined) {
    rngAlpha.value = cfg.alphamax;
    valAlpha.textContent = cfg.alphamax;
  }
  if (cfg.opttolerance !== undefined) {
    rngOpt.value = cfg.opttolerance;
    valOpt.textContent = cfg.opttolerance;
  }

  // Update preset button active state
  if (activeBtn) {
    document.querySelectorAll('.preset-btn').forEach(b => {
      b.classList.remove('active', 'border-primary', 'bg-accent/70');
    });
    activeBtn.classList.add('active', 'border-primary', 'bg-accent/70');
  }

  if (cfg.mode) {
    setMode(cfg.mode);
  } else if (chkAuto.checked) {
    debouncedRun();
  }
}

// --- Mode Switching ---
function setMode(mode) {
  state.mode = mode;
  if (mode === 'color') {
    btnModeColor.classList.add('active', 'bg-background', 'text-foreground', 'shadow-sm');
    btnModeColor.classList.remove('text-muted-foreground');
    btnModeMono.classList.remove('active', 'bg-background', 'text-foreground', 'shadow-sm');
    btnModeMono.classList.add('text-muted-foreground');

    grpColorLevels.style.display = 'block';
    grpThreshold.style.display = 'none';
    grpFilter.style.display = 'none';
  } else {
    btnModeMono.classList.add('active', 'bg-background', 'text-foreground', 'shadow-sm');
    btnModeMono.classList.remove('text-muted-foreground');
    btnModeColor.classList.remove('active', 'bg-background', 'text-foreground', 'shadow-sm');
    btnModeColor.classList.add('text-muted-foreground');

    grpColorLevels.style.display = 'none';
    grpThreshold.style.display = 'block';
    grpFilter.style.display = 'block';
  }
  if (chkAuto.checked) debouncedRun();
}

// --- File Handling ---
function loadFile(file) {
  state.fileName = file.name.replace(/\.[^/.]+$/, "");
  galleryCards.forEach(c => c.classList.remove('active', 'border-primary', 'ring-1', 'ring-primary', 'bg-secondary/70'));

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      state.originalImage = img;
      runPipeline();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// --- Debounce ---
let debounceTimeout = null;
function debouncedRun() {
  clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(() => {
    runPipeline();
  }, 160);
}

// --- Main Pipeline ---
async function runPipeline() {
  if (!state.originalImage || state.isProcessing) return;
  state.isProcessing = true;
  loadingOverlay.classList.remove('opacity-0', 'pointer-events-none');
  loadingOverlay.classList.add('opacity-100');

  const startTime = performance.now();

  try {
    const img = state.originalImage;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const rawImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // 1. mkbitmap Preprocessing
    const preprocessed = preprocessMkbitmap(rawImageData, {
      filter: parseInt(rngFilter.value, 10),
      threshold: parseFloat(rngThreshold.value),
      invert: chkInvert.checked,
      scale: parseInt(rngScale.value, 10),
      mode: state.mode,
      posterizeLevel: parseInt(rngColorLevels.value, 10)
    });
    state.preprocessedData = preprocessed;

    // 2. Potrace WebAssembly Tracing
    const potraceOptions = {
      turdsize: parseInt(rngTurd.value, 10),
      turnpolicy: 4,
      alphamax: parseFloat(rngAlpha.value),
      opticurve: 1,
      opttolerance: parseFloat(rngOpt.value),
      extractcolors: state.mode === 'color',
      posterizelevel: state.mode === 'color' ? parseInt(rngColorLevels.value, 10) : 2,
      posterizationalgorithm: 1,
      pathonly: false
    };

    const svg = await potrace(preprocessed, potraceOptions);
    state.svgOutput = svg;

    const endTime = performance.now();
    updateStats(endTime - startTime, svg, preprocessed.width, preprocessed.height);
    renderCurrentView();

  } catch (err) {
    console.error('Vectorization error:', err);
    showToast('حدث خطأ أثناء المعالجة: ' + err.message);
  } finally {
    state.isProcessing = false;
    loadingOverlay.classList.remove('opacity-100');
    loadingOverlay.classList.add('opacity-0', 'pointer-events-none');
  }
}

// --- Render Viewport ---
function renderCurrentView() {
  if (!state.svgOutput && !state.preprocessedData) return;

  viewportContent.innerHTML = '';

  if (state.currentView === 'svg') {
    viewportContent.innerHTML = state.svgOutput;
  } else if (state.currentView === 'preprocessed') {
    const canvas = document.createElement('canvas');
    canvas.width = state.preprocessedData.width;
    canvas.height = state.preprocessedData.height;
    canvas.getContext('2d').putImageData(state.preprocessedData, 0, 0);
    viewportContent.appendChild(canvas);
  } else if (state.currentView === 'original') {
    const img = document.createElement('img');
    img.src = state.originalImage.src;
    viewportContent.appendChild(img);
  } else if (state.currentView === 'split') {
    const container = document.createElement('div');
    container.className = 'split-view';

    const cardBmp = document.createElement('div');
    cardBmp.className = 'split-card';
    cardBmp.innerHTML = '<span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">معالجة mkbitmap (الحبر النقي)</span>';
    const canvas = document.createElement('canvas');
    canvas.width = state.preprocessedData.width;
    canvas.height = state.preprocessedData.height;
    canvas.getContext('2d').putImageData(state.preprocessedData, 0, 0);
    cardBmp.appendChild(canvas);

    const cardSvg = document.createElement('div');
    cardSvg.className = 'split-card';
    cardSvg.innerHTML = '<span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">متجه Potrace SVG (المنحنيات الرياضية)</span>' + state.svgOutput;

    container.appendChild(cardBmp);
    container.appendChild(cardSvg);
    viewportContent.appendChild(container);
  }
}

// --- Update Stats ---
function updateStats(durationMs, svg, width, height) {
  statDim.textContent = `${width} × ${height} px`;
  const sizeBytes = new Blob([svg]).size;
  statSize.textContent = sizeBytes > 1024 ? `${(sizeBytes / 1024).toFixed(1)} KB` : `${sizeBytes} B`;
  const pathMatches = svg.match(/<path/g);
  statPaths.textContent = pathMatches ? pathMatches.length : 1;
  statTime.textContent = `${Math.round(durationMs)} ms`;
}

// --- Export Functions ---
function copySvgCode() {
  if (!state.svgOutput) return;
  navigator.clipboard.writeText(state.svgOutput).then(() => {
    showToast('تم نسخ كود SVG بنجاح إلى الحافظة!');
  });
}

function downloadSvgFile() {
  if (!state.svgOutput) return;
  const blob = new Blob([state.svgOutput], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.fileName || 'vector'}.svg`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('تم بدء تحميل ملف SVG!');
}

function downloadBmpFile() {
  if (!state.preprocessedData) return;
  const canvas = document.createElement('canvas');
  canvas.width = state.preprocessedData.width;
  canvas.height = state.preprocessedData.height;
  canvas.getContext('2d').putImageData(state.preprocessedData, 0, 0);
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `${state.fileName || 'bitmap'}-mkbitmap.png`;
  a.click();
  showToast('تم بدء تحميل صورة Bitmap!');
}

function showToast(msg) {
  if (toastMsg) toastMsg.textContent = msg;
  toast.classList.remove('translate-y-16', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');
  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-16', 'opacity-0');
  }, 2400);
}

// Start application
bootstrap();
