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

// Gallery sample definitions & presets
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

// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const viewportContent = document.getElementById('viewportContent');
const loadingOverlay = document.getElementById('loadingOverlay');
const toast = document.getElementById('toast');

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
  // Auto load the exact comic sample from the video!
  loadSample('comic_video');
}

// --- Setup Event Listeners ---
function setupEventListeners() {
  // Drop & Upload
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      loadFile(e.target.files[0]);
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
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
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
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

  // Highlight card
  galleryCards.forEach(c => {
    if (c.dataset.sample === key) c.classList.add('active');
    else c.classList.remove('active');
  });

  // Apply parameters
  applyPresetValues(sample);

  // Load image
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
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    activeBtn.classList.add('active');
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
    btnModeColor.classList.add('active');
    btnModeMono.classList.remove('active');
    grpColorLevels.style.display = 'flex';
    grpThreshold.style.display = 'none';
    grpFilter.style.display = 'none';
  } else {
    btnModeMono.classList.add('active');
    btnModeColor.classList.remove('active');
    grpColorLevels.style.display = 'none';
    grpThreshold.style.display = 'flex';
    grpFilter.style.display = 'flex';
  }
  if (chkAuto.checked) debouncedRun();
}

// --- File Handling ---
function loadFile(file) {
  state.fileName = file.name.replace(/\.[^/.]+$/, "");
  galleryCards.forEach(c => c.classList.remove('active'));

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
  loadingOverlay.classList.add('active');

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
    loadingOverlay.classList.remove('active');
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
    cardBmp.innerHTML = '<span class="split-label">معالجة mkbitmap (الحبر النقي)</span>';
    const canvas = document.createElement('canvas');
    canvas.width = state.preprocessedData.width;
    canvas.height = state.preprocessedData.height;
    canvas.getContext('2d').putImageData(state.preprocessedData, 0, 0);
    cardBmp.appendChild(canvas);

    const cardSvg = document.createElement('div');
    cardSvg.className = 'split-card';
    cardSvg.innerHTML = '<span class="split-label">متجه Potrace SVG (المنحنيات الرياضية)</span>' + state.svgOutput;

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
    showToast('تم نسخ كود SVG إلى الحافظة!');
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
  showToast('تم تحميل ملف SVG بنجاح!');
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
  showToast('تم تحميل صورة البتماب المعالجة!');
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// Start application
bootstrap();
