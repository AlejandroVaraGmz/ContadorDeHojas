/**
 * app.js - Controlador Principal de la PWA Industrial Contador de Láminas
 * Orquesta la cámara trasera, el visor de ROI, el motor local de procesamiento,
 * el módulo de Gemini Visión, y la Galería de Calibración con muestras reales.
 */

// Muestras reales pre-cargadas para calibración
const CALIBRATION_SAMPLES = [
  {
    id: 1,
    title: 'Muestra 1: Calibre 10',
    pieces: 8,
    gauge: 'cal10',
    imagePath: 'assets/samples/muestra1_cal10_8piezas.jpg',
    description: '8 piezas de acero inoxidable Calibre 10 (~3.4 mm) en empaque con cartón corrugado.',
    roi: { x: 0.38, y: 0.472, width: 0.50, height: 0.255 },
    sensitivity: 1.05
  },
  {
    id: 2,
    title: 'Muestra 2: Calibre 12',
    pieces: 15,
    gauge: 'cal12',
    imagePath: 'assets/samples/muestra2_cal12_15piezas.jpg',
    description: '15 piezas de acero inoxidable Calibre 12 (~2.7 mm) con etiqueta de empaque inferior.',
    roi: { x: 0.35, y: 0.410, width: 0.50, height: 0.362 },
    sensitivity: 1.0
  },
  {
    id: 3,
    title: 'Muestra 3: Calibre 1/4"',
    pieces: 2,
    gauge: 'quarter',
    imagePath: 'assets/samples/muestra3_cal1_4_2piezas.jpg',
    description: '2 placas gruesas de acero Calibre 1/4" (~6.35 mm) entre capas de cartón.',
    roi: { x: 0.15, y: 0.500, width: 0.45, height: 0.100 },
    sensitivity: 1.0
  },
  {
    id: 4,
    title: 'Muestra 4: Calibre 14',
    pieces: 24,
    gauge: 'cal14',
    imagePath: 'assets/samples/muestra4_cal14_24piezas.jpg',
    description: '24 piezas de lámina de acero Calibre 14 (~1.9 mm) en pila compacta.',
    roi: { x: 0.34, y: 0.350, width: 0.50, height: 0.415 },
    sensitivity: 1.05
  },
  {
    id: 5,
    title: 'Muestra 5: Calibre 24',
    pieces: 51,
    gauge: 'cal24',
    imagePath: 'assets/samples/muestra5_cal24_51piezas.jpg',
    description: '51 piezas ultra delgadas Calibre 24 (~0.6 mm) apiladas en caja de cartón.',
    roi: { x: 0.22, y: 0.395, width: 0.60, height: 0.252 },
    sensitivity: 1.0
  }
];

class SheetCounterApp {
  constructor() {
    this.state = {
      mode: 'local', // 'local' o 'gemini'
      gauge: 'auto',
      sensitivity: 1.0,
      isCameraRunning: false,
      isFrozen: false,
      currentCount: 0,
      activeSample: null,
      lastProfileData: null
    };

    // Inicializar subsistemas
    this.sheetCounter = new SheetCounter();
    this.geminiCounter = new GeminiVisionCounter();

    this._initDOMElements();
    this._initRoiViewer();
    this._initCameraManager();
    this._bindEvents();
    this._initPWA();
    this._renderCalibrationGallery();
  }

  _initDOMElements() {
    // Vistas principales
    this.videoElement = document.getElementById('cameraVideo');
    this.frozenCanvas = document.getElementById('frozenCanvas');
    this.liveOverlayCanvas = document.getElementById('liveOverlayCanvas');
    this.cameraContainer = document.getElementById('cameraContainer');

    // Controles de Cámara
    this.cameraSelect = document.getElementById('cameraSelect');
    this.torchBtn = document.getElementById('torchBtn');
    this.btnSwitchCamera = document.getElementById('btnSwitchCamera');
    this.cameraBadge = document.getElementById('cameraBadge');

    // Selectores principales
    this.gaugeSelect = document.getElementById('gaugeSelect');
    this.modeToggle = document.getElementById('modeToggle');
    this.sensitivitySlider = document.getElementById('sensitivitySlider');
    this.sensitivityVal = document.getElementById('sensitivityVal');

    // Botones de acción
    this.btnCapture = document.getElementById('btnCapture');
    this.btnGallery = document.getElementById('btnGallery');
    this.galleryInput = document.getElementById('galleryInput');
    this.btnRetake = document.getElementById('btnRetake');
    this.btnReanalyze = document.getElementById('btnReanalyze');

    // Panel de Resultados
    this.resultPanel = document.getElementById('resultPanel');
    this.countNumber = document.getElementById('countNumber');
    this.countStatus = document.getElementById('countStatus');
    this.gaugeBadge = document.getElementById('gaugeBadge');
    this.btnPlus = document.getElementById('btnPlus');
    this.btnMinus = document.getElementById('btnMinus');
    this.btnUndo = document.getElementById('btnUndo');
    this.btnClear = document.getElementById('btnClear');

    // Modales
    this.btnOpenSamples = document.getElementById('btnOpenSamples');
    this.samplesModal = document.getElementById('samplesModal');
    this.closeSamplesBtn = document.getElementById('closeSamplesBtn');
    this.samplesGrid = document.getElementById('samplesGrid');

    this.btnOpenSettings = document.getElementById('btnOpenSettings');
    this.settingsModal = document.getElementById('settingsModal');
    this.closeSettingsBtn = document.getElementById('closeSettingsBtn');
    this.apiKeyInput = document.getElementById('geminiApiKey');
    this.geminiModelSelect = document.getElementById('geminiModelSelect');
    this.btnSaveSettings = document.getElementById('btnSaveSettings');
    this.btnTestGemini = document.getElementById('btnTestGemini');
    this.settingsStatus = document.getElementById('settingsStatus');

    this.btnWaveform = document.getElementById('btnWaveform');
    this.waveformModal = document.getElementById('waveformModal');
    this.closeWaveformBtn = document.getElementById('closeWaveformBtn');
    this.waveformCanvas = document.getElementById('waveformCanvas');

    // Notificaciones y Spinners
    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.loadingText = document.getElementById('loadingText');
    this.toastContainer = document.getElementById('toastContainer');
  }

  _initRoiViewer() {
    this.roiViewer = new ROIViewer(this.frozenCanvas, {
      onMarkersChanged: (count) => {
        this.state.currentCount = count;
        this._updateCountDisplay();
      },
      onRoiChanged: (roi) => {
        if (this.state.isFrozen) {
          this.recalculateCount();
        }
      }
    });
  }

  _initCameraManager() {
    this.cameraManager = new CameraManager(
      this.videoElement,
      (rearCameras, activeDeviceId) => this._onCamerasDiscovered(rearCameras, activeDeviceId),
      (errorMsg) => this.showToast(errorMsg, 'error')
    );
  }

  _onCamerasDiscovered(rearCameras, activeDeviceId) {
    this.cameraSelect.innerHTML = '';

    if (rearCameras.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Cámara Trasera Predeterminada';
      this.cameraSelect.appendChild(opt);
    } else {
      rearCameras.forEach((cam, index) => {
        const opt = document.createElement('option');
        opt.value = cam.deviceId;
        opt.textContent = cam.label;
        if (cam.deviceId === activeDeviceId) opt.selected = true;
        this.cameraSelect.appendChild(opt);
      });
    }

    this.cameraBadge.textContent = `${rearCameras.length} Lente(s) Trasero(s)`;
  }

  async startCamera() {
    this.showLoading('Activando cámara trasera...');
    const success = await this.cameraManager.startInitialCamera();
    this.hideLoading();

    if (success) {
      this.state.isCameraRunning = true;
      this.state.isFrozen = false;
      this._updateUIState();
      this._startLiveRoiLoop();
    }
  }

  _startLiveRoiLoop() {
    // Dibuja la guía visual sobre el video en vivo
    const canvas = this.liveOverlayCanvas;
    const ctx = canvas.getContext('2d');

    const render = () => {
      if (!this.state.isCameraRunning || this.state.isFrozen) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      if (this.videoElement.videoWidth > 0) {
        if (canvas.width !== this.videoElement.videoWidth || canvas.height !== this.videoElement.videoHeight) {
          canvas.width = this.videoElement.videoWidth;
          canvas.height = this.videoElement.videoHeight;
        }

        const cw = canvas.width;
        const ch = canvas.height;
        ctx.clearRect(0, 0, cw, ch);

        const roi = this.roiViewer.getAbsoluteROI();

        // Máscara oscura exterior
        ctx.fillStyle = 'rgba(0, 0, 0, 0.40)';
        ctx.fillRect(0, 0, cw, roi.y);
        ctx.fillRect(0, roi.y + roi.height, cw, ch - (roi.y + roi.height));
        ctx.fillRect(0, roi.y, roi.x, roi.height);
        ctx.fillRect(roi.x + roi.width, roi.y, cw - (roi.x + roi.width), roi.height);

        // Marco ROI Cyan/Amarillo
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(roi.x, roi.y, roi.width, roi.height);

        // Esquinas
        const c = 20;
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth = 3.5;
        // TL
        ctx.beginPath(); ctx.moveTo(roi.x, roi.y + c); ctx.lineTo(roi.x, roi.y); ctx.lineTo(roi.x + c, roi.y); ctx.stroke();
        // TR
        ctx.beginPath(); ctx.moveTo(roi.x + roi.width - c, roi.y); ctx.lineTo(roi.x + roi.width, roi.y); ctx.lineTo(roi.x + roi.width, roi.y + c); ctx.stroke();
        // BL
        ctx.beginPath(); ctx.moveTo(roi.x, roi.y + roi.height - c); ctx.lineTo(roi.x, roi.y + roi.height); ctx.lineTo(roi.x + c, roi.y + roi.height); ctx.stroke();
        // BR
        ctx.beginPath(); ctx.moveTo(roi.x + roi.width - c, roi.y + roi.height); ctx.lineTo(roi.x + roi.width, roi.y + roi.height); ctx.lineTo(roi.x + roi.width, roi.y + roi.height - c); ctx.stroke();

        // Guía Láser central
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.5)';
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(roi.x, roi.y + roi.height / 2);
        ctx.lineTo(roi.x + roi.width, roi.y + roi.height / 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Textos
        ctx.font = 'bold 13px monospace';
        ctx.fillStyle = '#eab308';
        ctx.fillText('▲ ALINEAR CANTO SIN CARTÓN ▲', roi.x + 8, Math.max(16, roi.y - 10));
        ctx.fillText('▼ EXCLUIR BASE / TARIMA ▼', roi.x + 8, Math.min(ch - 8, roi.y + roi.height + 18));
      }

      requestAnimationFrame(render);
    };

    requestAnimationFrame(render);
  }

  async captureAndCount() {
    this._vibrate();

    if (!this.state.isCameraRunning) {
      this.showToast('Iniciando cámara primero...', 'info');
      await this.startCamera();
      return;
    }

    try {
      this.showLoading('Capturando fotograma en alta resolución...');
      const capturedCanvas = this.cameraManager.captureFrame();

      this.state.isFrozen = true;
      this.state.activeSample = null;
      this.roiViewer.loadFrozenImage(capturedCanvas);
      this._updateUIState();

      await this.processCurrentFrozenImage();
    } catch (err) {
      console.error('[App] Error al capturar:', err);
      this.showToast(err.message || 'Error al capturar imagen', 'error');
    } finally {
      this.hideLoading();
    }
  }

  async processCurrentFrozenImage() {
    const roi = this.roiViewer.getAbsoluteROI();

    if (this.state.mode === 'gemini') {
      await this._processWithGemini(roi);
    } else {
      this._processLocal(roi);
    }
  }

  _processLocal(roi) {
    this.showLoading('Procesando cantos con CLAHE...');

    try {
      const result = this.sheetCounter.processROI(
        this.frozenCanvas,
        roi,
        this.state.gauge,
        this.state.sensitivity
      );

      this.state.currentCount = result.count;
      this.state.lastProfileData = result.profile;
      this.roiViewer.setMarkers(result.markers);

      this._updateCountDisplay(result.gaugeUsed, 'Local (CLAHE)');
      this.showToast(`Conteo completado: ${result.count} piezas detectadas`, 'success');
    } catch (err) {
      console.error('[Local] Error:', err);
      this.showToast('Error en procesamiento local: ' + err.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  async _processWithGemini(roi) {
    if (!this.geminiCounter.isConfigured()) {
      this.showToast('API Key no configurada. Abriendo ajustes...', 'warning');
      this.openSettingsModal();
      return;
    }

    this.showLoading('Analizando cantos con Gemini Vision...');

    try {
      // Crear un canvas recortado del ROI
      const roiCanvas = document.createElement('canvas');
      roiCanvas.width = roi.width;
      roiCanvas.height = roi.height;
      const rCtx = roiCanvas.getContext('2d');
      rCtx.drawImage(
        this.frozenCanvas,
        roi.x, roi.y, roi.width, roi.height,
        0, 0, roi.width, roi.height
      );

      const gaugeLabel = this.gaugeSelect.options[this.gaugeSelect.selectedIndex].text;
      const result = await this.geminiCounter.countSheetsWithGemini(roiCanvas, gaugeLabel);

      this.state.currentCount = result.count;

      // Mapear marcadores devueltos
      const markers = result.markers.map((m, idx) => ({
        id: idx + 1,
        canvasY: roi.y + m.roiY,
        canvasX: roi.x + roi.width / 2
      }));

      this.roiViewer.setMarkers(markers);
      this._updateCountDisplay(result.calibreEstimated || gaugeLabel, 'Gemini Vision (IA)');
      this.showToast(`Gemini IA: ${result.count} piezas. ${result.explanation}`, 'success', 5000);
    } catch (err) {
      console.error('[Gemini] Error:', err);
      this.showToast('Error en Gemini: ' + err.message, 'error');
    } finally {
      this.hideLoading();
    }
  }

  recalculateCount() {
    if (this.state.isFrozen) {
      this.processCurrentFrozenImage();
    }
  }

  loadSample(sampleId) {
    const sample = CALIBRATION_SAMPLES.find(s => s.id === sampleId);
    if (!sample) return;

    this.showLoading(`Cargando ${sample.title}...`);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.state.isFrozen = true;
      this.state.activeSample = sample;
      this.state.gauge = sample.gauge;
      this.gaugeSelect.value = sample.gauge;

      this.state.sensitivity = sample.sensitivity || 1.0;
      this.sensitivitySlider.value = Math.round(this.state.sensitivity * 100);
      this.sensitivityVal.textContent = `${this.sensitivitySlider.value}%`;

      this.roiViewer.loadFrozenImage(img);
      this.roiViewer.setRelativeROI(sample.roi);

      this._updateUIState();
      this.closeModal(this.samplesModal);
      this.hideLoading();

      // Procesar de inmediato
      this.processCurrentFrozenImage();
    };

    img.onerror = () => {
      this.hideLoading();
      this.showToast(`Error al cargar la imagen de ${sample.title}`, 'error');
    };

    img.src = sample.imagePath;
  }

  loadFromGallery(file) {
    if (!file) return;

    this.showLoading('Cargando imagen de galería...');
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        this.state.isFrozen = true;
        this.state.activeSample = null;
        this.roiViewer.loadFrozenImage(img);
        this._updateUIState();
        this.hideLoading();
        this.processCurrentFrozenImage();
      };
      img.src = e.target.result;
    };

    reader.readAsDataURL(file);
  }

  _updateCountDisplay(gaugeName, modeBadge) {
    this.countNumber.textContent = this.state.currentCount;

    if (this.state.activeSample) {
      const expected = this.state.activeSample.pieces;
      const detected = this.state.currentCount;
      const diff = detected - expected;

      if (diff === 0) {
        this.countStatus.innerHTML = `<span class="badge-success">✓ Coincide con calibración (${expected} pzas)</span>`;
      } else {
        const sign = diff > 0 ? `+${diff}` : `${diff}`;
        this.countStatus.innerHTML = `<span class="badge-warning">⚠ Esperado: ${expected} (${sign} pzas de diferencia)</span>`;
      }
    } else {
      this.countStatus.innerHTML = `<span class="badge-neutral">${modeBadge || 'Detección completada'}</span>`;
    }

    if (gaugeName) {
      this.gaugeBadge.textContent = gaugeName;
    }
  }

  _updateUIState() {
    if (this.state.isFrozen) {
      this.frozenCanvas.style.display = 'block';
      this.videoElement.style.display = 'none';
      this.liveOverlayCanvas.style.display = 'none';

      this.btnCapture.style.display = 'none';
      this.btnRetake.style.display = 'inline-flex';
      this.btnReanalyze.style.display = 'inline-flex';
      this.resultPanel.classList.add('visible');
    } else {
      this.frozenCanvas.style.display = 'none';
      this.videoElement.style.display = 'block';
      this.liveOverlayCanvas.style.display = 'block';

      this.btnCapture.style.display = 'inline-flex';
      this.btnRetake.style.display = 'none';
      this.btnReanalyze.style.display = 'none';
      this.resultPanel.classList.remove('visible');
    }
  }

  _renderCalibrationGallery() {
    this.samplesGrid.innerHTML = '';

    CALIBRATION_SAMPLES.forEach((sample) => {
      const card = document.createElement('div');
      card.className = 'sample-card';
      card.innerHTML = `
        <div class="sample-thumb-wrapper">
          <img src="${sample.imagePath}" alt="${sample.title}" class="sample-thumb" loading="lazy">
          <span class="sample-pieces-badge">${sample.pieces} Piezas</span>
        </div>
        <div class="sample-info">
          <h4 class="sample-title">${sample.title}</h4>
          <p class="sample-desc">${sample.description}</p>
          <div class="sample-meta">
            <span class="sample-calibre">${sample.gauge.toUpperCase()}</span>
            <button class="btn btn-sm btn-primary sample-load-btn" data-id="${sample.id}">
              Calibrar / Probar
            </button>
          </div>
        </div>
      `;

      card.querySelector('.sample-load-btn').addEventListener('click', () => {
        this.loadSample(sample.id);
      });

      this.samplesGrid.appendChild(card);
    });
  }

  _bindEvents() {
    // Captura y Reintento
    this.btnCapture.addEventListener('click', () => this.captureAndCount());
    this.btnRetake.addEventListener('click', () => {
      this.state.isFrozen = false;
      this._updateUIState();
      if (!this.state.isCameraRunning) {
        this.startCamera();
      }
    });

    this.btnReanalyze.addEventListener('click', () => this.recalculateCount());

    // Galería
    this.btnGallery.addEventListener('click', () => this.galleryInput.click());
    this.galleryInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.loadFromGallery(e.target.files[0]);
      }
    });

    // Selector de Cámara Trasera
    this.cameraSelect.addEventListener('change', async (e) => {
      const deviceId = e.target.value;
      if (deviceId) {
        this.showLoading('Cambiando a lente seleccionado...');
        await this.cameraManager.selectCameraByDeviceId(deviceId);
        this.hideLoading();
      }
    });

    // Linterna
    this.torchBtn.addEventListener('click', async () => {
      const isOn = await this.cameraManager.toggleTorch();
      this.torchBtn.classList.toggle('active', isOn);
      this.showToast(isOn ? 'Linterna encendida' : 'Linterna apagada', 'info');
    });

    // Selector de Calibre
    this.gaugeSelect.addEventListener('change', (e) => {
      this.state.gauge = e.target.value;
      if (this.state.isFrozen) {
        this.recalculateCount();
      }
    });

    // Modo Local vs Gemini
    this.modeToggle.addEventListener('change', (e) => {
      this.state.mode = e.target.checked ? 'gemini' : 'local';
      this.showToast(`Modo cambiado a: ${this.state.mode === 'gemini' ? 'Gemini Visión (IA)' : 'Local (CLAHE)'}`, 'info');
      if (this.state.isFrozen) {
        this.recalculateCount();
      }
    });

    // Deslizador de Sensibilidad
    this.sensitivitySlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      this.sensitivityVal.textContent = `${val}%`;
      this.state.sensitivity = val / 100;
    });

    this.sensitivitySlider.addEventListener('change', () => {
      if (this.state.isFrozen) {
        this.recalculateCount();
      }
    });

    // Ajustes Manuales (+1, -1, Deshacer, Limpiar)
    this.btnPlus.addEventListener('click', () => {
      this._vibrate();
      this.roiViewer.adjustPlusOne();
    });

    this.btnMinus.addEventListener('click', () => {
      this._vibrate();
      this.roiViewer.adjustMinusOne();
    });

    this.btnUndo.addEventListener('click', () => this.roiViewer.undo());
    this.btnClear.addEventListener('click', () => this.roiViewer.clearMarkers());

    // Modales
    this.btnOpenSamples.addEventListener('click', () => this.openModal(this.samplesModal));
    this.closeSamplesBtn.addEventListener('click', () => this.closeModal(this.samplesModal));

    this.btnOpenSettings.addEventListener('click', () => this.openSettingsModal());
    this.closeSettingsBtn.addEventListener('click', () => this.closeModal(this.settingsModal));

    this.btnSaveSettings.addEventListener('click', () => {
      this.geminiCounter.setApiKey(this.apiKeyInput.value);
      this.geminiCounter.setModel(this.geminiModelSelect.value);
      this.showToast('Ajustes guardados correctamente', 'success');
      this.closeModal(this.settingsModal);
    });

    this.btnTestGemini.addEventListener('click', async () => {
      this.settingsStatus.textContent = 'Probando conexión con Gemini...';
      this.settingsStatus.className = 'status-msg';
      this.geminiCounter.setApiKey(this.apiKeyInput.value);
      this.geminiCounter.setModel(this.geminiModelSelect.value);

      const res = await this.geminiCounter.testConnection();
      this.settingsStatus.textContent = res.message;
      this.settingsStatus.className = res.success ? 'status-msg success' : 'status-msg error';
    });

    // Visualizador de Forma de Onda (Waveform)
    this.btnWaveform.addEventListener('click', () => {
      this.openModal(this.waveformModal);
      if (this.state.lastProfileData) {
        this.roiViewer.drawWaveformToCanvas(
          this.waveformCanvas,
          this.state.lastProfileData,
          this.roiViewer.markers
        );
      }
    });
    this.closeWaveformBtn.addEventListener('click', () => this.closeModal(this.waveformModal));

    // Cerrar modales con clic fuera
    [this.samplesModal, this.settingsModal, this.waveformModal].forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModal(modal);
      });
    });
  }

  openModal(modal) {
    modal.classList.add('open');
  }

  closeModal(modal) {
    modal.classList.remove('open');
  }

  openSettingsModal() {
    this.apiKeyInput.value = this.geminiCounter.getApiKey();
    this.geminiModelSelect.value = this.geminiCounter.model;
    this.settingsStatus.textContent = '';
    this.openModal(this.settingsModal);
  }

  showLoading(text = 'Cargando...') {
    this.loadingText.textContent = text;
    this.loadingOverlay.classList.add('visible');
  }

  hideLoading() {
    this.loadingOverlay.classList.remove('visible');
  }

  showToast(message, type = 'info', duration = 3500) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    this.toastContainer.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  _vibrate(ms = 40) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) {}
    }
  }

  _initPWA() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then(reg => console.log('[PWA] Service Worker registrado:', reg.scope))
          .catch(err => console.warn('[PWA] Error registro Service Worker:', err));
      });
    }
  }
}

// Inicializar al cargar el DOM
window.addEventListener('DOMContentLoaded', () => {
  window.app = new SheetCounterApp();

  // Iniciar automáticamente cámara en móviles o cargar muestra 1 si no hay cámara
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    window.app.startCamera().catch(() => {
      // Si el navegador bloquea cámara automática, cargar muestra 1
      window.app.loadSample(1);
    });
  } else {
    window.app.loadSample(1);
  }
});
