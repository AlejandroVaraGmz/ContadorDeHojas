/**
 * app.js - Controlador Principal de la PWA Industrial con Detección en Tiempo Real
 * Orquesta el bucle de video a 30 FPS, filtro de estabilización temporal (mediana 12 frames),
 * asistente en vivo de Gemini Vision (cada 3s), botón de congelamiento (🔒) y galería de calibración.
 */

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
  },
  {
    id: 6,
    title: 'Muestra 6: Calibre 20',
    pieces: 75,
    gauge: 'cal20',
    imagePath: 'assets/samples/muestra6_cal20_75piezas.jpg',
    description: '75 piezas de lámina fina Calibre 20 (~0.9 mm) apiladas en tarima de madera.',
    roi: { x: 0.22, y: 0.415, width: 0.58, height: 0.365 },
    sensitivity: 1.0
  }
];

class RealTimeSheetCounterApp {
  constructor() {
    this.state = {
      isLiveRunning: false,
      isFrozen: false,
      gauge: 'auto',
      sensitivity: 1.0,
      currentLiveCount: 0,
      currentStableCount: 0,
      activeSample: null,
      autoIaEnabled: false,
      lastProfile: null,
      geminiLastResult: null
    };

    this.sheetCounter = new SheetCounter();
    this.geminiCounter = new GeminiVisionCounter();

    this.animationFrameId = null;
    this.autoIaIntervalId = null;

    this._initDOMElements();
    this._initROIViewer();
    this._initCamera();
    this._bindEvents();
    this._initPWA();
    this._renderCalibrationGallery();
  }

  _initDOMElements() {
    // Video y Canvas AR Superpuesto
    this.videoElement = document.getElementById('cameraVideo');
    this.arCanvas = document.getElementById('arCanvas');
    this.cameraContainer = document.getElementById('cameraContainer');

    // Barra superior
    this.cameraSelect = document.getElementById('cameraSelect');
    this.gaugeSelect = document.getElementById('gaugeSelect');
    this.torchBtn = document.getElementById('torchBtn');
    this.btnOpenSamples = document.getElementById('btnOpenSamples');
    this.btnOpenSettings = document.getElementById('btnOpenSettings');
    this.btnWaveform = document.getElementById('btnWaveform');

    // Contador Gigante en Vivo
    this.liveCounterCard = document.getElementById('liveCounterCard');
    this.liveCountNumber = document.getElementById('liveCountNumber');
    this.liveCountPrefix = document.getElementById('liveCountPrefix');
    this.liveGaugeBadge = document.getElementById('liveGaugeBadge');
    this.fpsBadge = document.getElementById('fpsBadge');
    this.iaStatusBadge = document.getElementById('iaStatusBadge');

    // Controles de Acción Principal
    this.btnFreeze = document.getElementById('btnFreeze');
    this.btnResume = document.getElementById('btnResume');
    this.btnVerifyIA = document.getElementById('btnVerifyIA');
    this.autoIaToggle = document.getElementById('autoIaToggle');
    this.btnGallery = document.getElementById('btnGallery');
    this.galleryInput = document.getElementById('galleryInput');

    // Panel de Edición Manual Táctil (Al congelar)
    this.manualEditPanel = document.getElementById('manualEditPanel');
    this.btnPlus = document.getElementById('btnPlus');
    this.btnMinus = document.getElementById('btnMinus');
    this.btnUndo = document.getElementById('btnUndo');
    this.btnClear = document.getElementById('btnClear');
    this.sensitivitySlider = document.getElementById('sensitivitySlider');
    this.sensitivityVal = document.getElementById('sensitivityVal');

    // Modales
    this.samplesModal = document.getElementById('samplesModal');
    this.closeSamplesBtn = document.getElementById('closeSamplesBtn');
    this.samplesGrid = document.getElementById('samplesGrid');

    this.settingsModal = document.getElementById('settingsModal');
    this.closeSettingsBtn = document.getElementById('closeSettingsBtn');
    this.geminiApiKeyInput = document.getElementById('geminiApiKey');
    this.geminiModelSelect = document.getElementById('geminiModelSelect');
    this.btnSaveSettings = document.getElementById('btnSaveSettings');
    this.btnTestGemini = document.getElementById('btnTestGemini');
    this.settingsStatus = document.getElementById('settingsStatus');

    this.waveformModal = document.getElementById('waveformModal');
    this.closeWaveformBtn = document.getElementById('closeWaveformBtn');
    this.waveformCanvas = document.getElementById('waveformCanvas');

    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.loadingText = document.getElementById('loadingText');
    this.toastContainer = document.getElementById('toastContainer');
  }

  _initROIViewer() {
    this.roiViewer = new ROIViewer(this.arCanvas, {
      onMarkersChanged: (count) => {
        if (this.state.isFrozen) {
          this.state.currentStableCount = count;
          this._updateHUDCount(count, true);
        }
      },
      onRoiChanged: () => {
        this.sheetCounter.resetHistory();
      }
    });
  }

  _initCamera() {
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
      opt.textContent = 'Cámara Trasera (Auto)';
      this.cameraSelect.appendChild(opt);
    } else {
      rearCameras.forEach((cam) => {
        const opt = document.createElement('option');
        opt.value = cam.deviceId;
        opt.textContent = cam.label;
        if (cam.deviceId === activeDeviceId) opt.selected = true;
        this.cameraSelect.appendChild(opt);
      });
    }
  }

  /**
   * Inicia el stream de video en vivo a 30 FPS
   */
  async startLiveStream() {
    this.showLoading('Iniciando stream de video en Full HD @ 30 FPS...');
    const ok = await this.cameraManager.startInitialCamera();
    this.hideLoading();

    if (ok) {
      this.state.isLiveRunning = true;
      this.state.isFrozen = false;
      this.roiViewer.resumeLive();
      this._updateUIModes();
      this._start30FpsDetectionLoop();
    }
  }

  /**
   * BUCLE PRINCIPAL DE DETECCIÓN EN TIEMPO REAL A 30 FPS (Motor 1)
   */
  _start30FpsDetectionLoop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    let lastTime = performance.now();
    let frameCounter = 0;

    const loop = (currentTime) => {
      if (!this.state.isLiveRunning || this.state.isFrozen) {
        return; // Detener bucle si está congelado o pausado
      }

      if (this.videoElement.videoWidth > 0 && this.videoElement.videoHeight > 0) {
        const vw = this.videoElement.videoWidth;
        const vh = this.videoElement.videoHeight;

        // Sincronizar resolución exacta del canvas AR con el video
        this.roiViewer.syncDimensions(vw, vh);

        // 1. Obtener coordenadas del ROI en el video
        const roi = this.roiViewer.getAbsoluteROI();

        // 2. Procesar frame en tiempo real con el algoritmo local
        const result = this.sheetCounter.processLiveFrame(
          this.videoElement,
          roi,
          this.state.gauge,
          this.state.sensitivity
        );

        this.state.currentLiveCount = result.liveCount;
        this.state.currentStableCount = result.stableCount;
        this.state.lastProfile = result.profile;

        // 3. Renderizar HUD y recubrimiento AR sobre el video en vivo
        this.roiViewer.renderLiveHUD(
          result.markers,
          result.liveCount,
          result.stableCount,
          result.gaugeName,
          this.state.geminiLastResult
        );

        // 4. Actualizar contador gigante en el HUD
        this._updateHUDCount(result.stableCount, false);

        // Cálculo de FPS en vivo
        frameCounter++;
        if (currentTime - lastTime >= 1000) {
          const fps = Math.round((frameCounter * 1000) / (currentTime - lastTime));
          this.fpsBadge.textContent = `${fps} FPS`;
          frameCounter = 0;
          lastTime = currentTime;
        }
      }

      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  /**
   * Actualiza el Contador Gigante en Vivo en pantalla
   */
  _updateHUDCount(count, isFrozen = false) {
    this.liveCountNumber.textContent = count;
    this.liveCountPrefix.textContent = isFrozen ? 'CONGELADO:' : 'EN VIVO:';

    if (this.state.activeSample) {
      const exp = this.state.activeSample.pieces;
      const diff = count - exp;
      if (diff === 0) {
        this.liveGaugeBadge.innerHTML = `<span class="badge-success">✓ Exacto (${exp} pzas)</span>`;
      } else {
        const sign = diff > 0 ? `+${diff}` : `${diff}`;
        this.liveGaugeBadge.innerHTML = `<span class="badge-warning">Esperado: ${exp} (${sign})</span>`;
      }
    } else {
      const gName = this.gaugeSelect.options[this.gaugeSelect.selectedIndex].text;
      this.liveGaugeBadge.textContent = gName;
    }
  }

  /**
   * CONGELAR / FIJAR LECTURA (Freeze Frame)
   */
  freezeFrame() {
    this._vibrate(60);

    let frameSource = null;
    if (this.state.isLiveRunning && this.videoElement.videoWidth > 0) {
      frameSource = this.cameraManager.captureFrame();
    } else if (this.state.activeSample) {
      frameSource = this.roiViewer.frozenImage;
    }

    if (!frameSource) {
      this.showToast('No hay imagen para congelar', 'warning');
      return;
    }

    this.state.isFrozen = true;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Congelar los marcadores actuales en el visor interactivo
    this.roiViewer.freezeFrame(frameSource, this.roiViewer.markers);
    this._updateUIModes();
    this.showToast('Lectura congelada. Puedes tocar la pantalla para ajustar piezas (+1 / -1).', 'info', 4000);
  }

  /**
   * REANUDAR CÁMARA EN VIVO
   */
  resumeLiveStream() {
    this._vibrate(40);
    this.state.isFrozen = false;
    this.state.activeSample = null;
    this.roiViewer.resumeLive();
    this._updateUIModes();
    this.sheetCounter.resetHistory();
    this._start30FpsDetectionLoop();
  }

  /**
   * MOTOR 2: Verificación con Gemini Vision API
   */
  async verifyWithGemini() {
    this._vibrate(50);
    const roi = this.roiViewer.getAbsoluteROI();
    const gaugeName = this.gaugeSelect.options[this.gaugeSelect.selectedIndex].text;
    const source = this.state.isFrozen && this.roiViewer.frozenImage ? this.roiViewer.frozenImage : this.videoElement;

    this.iaStatusBadge.textContent = 'IA: Analizando...';
    this.iaStatusBadge.className = 'ia-badge active';
    this.showToast('Enviando frame a Gemini 2.5 Flash...', 'info', 2000);

    try {
      const result = await this.geminiCounter.countSheetsLive(source, roi, gaugeName);
      this.state.geminiLastResult = result;

      // Actualizar contador y marcadores
      this._updateHUDCount(result.total_piezas, this.state.isFrozen);
      this.roiViewer.applyGeminiMarkers(result.coordenadas_y);

      this.iaStatusBadge.textContent = `IA: ${result.total_piezas} pzas (${result.confianza})`;
      this.iaStatusBadge.className = 'ia-badge success';
      this.showToast(`Gemini IA: ${result.total_piezas} piezas detectadas (Confianza: ${result.confianza})`, 'success', 4000);
    } catch (err) {
      console.error('[Gemini] Error:', err);
      this.iaStatusBadge.textContent = 'IA: Error';
      this.iaStatusBadge.className = 'ia-badge error';
      this.showToast(err.message || 'Error en consulta a Gemini', 'error');
    }
  }

  /**
   * Activa/Desactiva el escaneo automático en segundo plano cada 3 segundos
   */
  toggleAutoIa(enabled) {
    this.state.autoIaEnabled = enabled;

    if (this.autoIaIntervalId) {
      clearInterval(this.autoIaIntervalId);
      this.autoIaIntervalId = null;
    }

    if (enabled) {
      this.showToast('Auto-Escaneo IA activado (consultando cada 3 seg en segundo plano)', 'info');
      this.iaStatusBadge.style.display = 'inline-block';
      this.iaStatusBadge.textContent = 'IA Auto: Activo';
      this.iaStatusBadge.className = 'ia-badge active';

      // Disparar de inmediato y luego cada 3 segundos
      this.verifyWithGemini();
      this.autoIaIntervalId = setInterval(() => {
        if (!this.state.isFrozen && this.state.isLiveRunning) {
          this.verifyWithGemini();
        }
      }, 3000);
    } else {
      this.showToast('Auto-Escaneo IA desactivado', 'info');
      this.iaStatusBadge.textContent = 'IA: Inactiva';
      this.iaStatusBadge.className = 'ia-badge';
    }
  }

  /**
   * Carga una muestra de la galería de calibración
   */
  loadSample(sampleId) {
    const sample = CALIBRATION_SAMPLES.find(s => s.id === sampleId);
    if (!sample) return;

    this.showLoading(`Cargando ${sample.title}...`);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.state.activeSample = sample;
      this.state.isFrozen = true;
      this.state.gauge = sample.gauge;
      this.gaugeSelect.value = sample.gauge;

      this.state.sensitivity = sample.sensitivity || 1.0;
      this.sensitivitySlider.value = Math.round(this.state.sensitivity * 100);
      this.sensitivityVal.textContent = `${this.sensitivitySlider.value}%`;

      this.roiViewer.syncDimensions(img.width, img.height);
      this.roiViewer.setRelativeROI(sample.roi);

      // Procesar una vez con el motor local
      const roi = this.roiViewer.getAbsoluteROI();
      const res = this.sheetCounter.processLiveFrame(img, roi, sample.gauge, this.state.sensitivity);

      this.roiViewer.freezeFrame(img, res.markers);
      this._updateHUDCount(res.stableCount, true);
      this._updateUIModes();

      this.closeModal(this.samplesModal);
      this.hideLoading();
      this.showToast(`${sample.title} cargada: ${res.stableCount} piezas detectadas (Esperado: ${sample.pieces})`, 'success');
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
        this.state.activeSample = null;
        this.state.isFrozen = true;
        this.roiViewer.syncDimensions(img.width, img.height);

        const roi = this.roiViewer.getAbsoluteROI();
        const res = this.sheetCounter.processLiveFrame(img, roi, this.state.gauge, this.state.sensitivity);

        this.roiViewer.freezeFrame(img, res.markers);
        this._updateHUDCount(res.stableCount, true);
        this._updateUIModes();
        this.hideLoading();
      };
      img.src = e.target.result;
    };

    reader.readAsDataURL(file);
  }

  _updateUIModes() {
    if (this.state.isFrozen) {
      this.btnFreeze.style.display = 'none';
      this.btnResume.style.display = 'inline-flex';
      this.manualEditPanel.classList.add('visible');
    } else {
      this.btnFreeze.style.display = 'inline-flex';
      this.btnResume.style.display = 'none';
      this.manualEditPanel.classList.remove('visible');
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
    // Congelar / Reanudar
    this.btnFreeze.addEventListener('click', () => this.freezeFrame());
    this.btnResume.addEventListener('click', () => this.resumeLiveStream());

    // Verificar con IA y Auto-IA
    this.btnVerifyIA.addEventListener('click', () => this.verifyWithGemini());
    this.autoIaToggle.addEventListener('change', (e) => this.toggleAutoIa(e.target.checked));

    // Galería
    this.btnGallery.addEventListener('click', () => this.galleryInput.click());
    this.galleryInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.loadFromGallery(e.target.files[0]);
      }
    });

    // Selector de Cámara y Linterna
    this.cameraSelect.addEventListener('change', async (e) => {
      const deviceId = e.target.value;
      if (deviceId) {
        this.showLoading('Cambiando a lente seleccionado...');
        await this.cameraManager.selectCameraByDeviceId(deviceId);
        this.sheetCounter.resetHistory();
        this.hideLoading();
      }
    });

    this.torchBtn.addEventListener('click', async () => {
      const on = await this.cameraManager.toggleTorch();
      this.torchBtn.classList.toggle('active', on);
      this.showToast(on ? 'Linterna encendida' : 'Linterna apagada', 'info');
    });

    // Calibre
    this.gaugeSelect.addEventListener('change', (e) => {
      this.state.gauge = e.target.value;
      this.sheetCounter.resetHistory();
      this._updateHUDCount(this.state.currentStableCount, this.state.isFrozen);
    });

    // Sensibilidad
    this.sensitivitySlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      this.sensitivityVal.textContent = `${val}%`;
      this.state.sensitivity = val / 100;
    });

    // Edición manual al congelar (+1 / -1 / Deshacer / Limpiar)
    this.btnPlus.addEventListener('click', () => {
      this._vibrate(40);
      this.roiViewer.adjustPlusOne();
    });
    this.btnMinus.addEventListener('click', () => {
      this._vibrate(40);
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
      this.geminiCounter.setApiKey(this.geminiApiKeyInput.value);
      this.geminiCounter.setModel(this.geminiModelSelect.value);
      this.showToast('Configuración guardada', 'success');
      this.closeModal(this.settingsModal);
    });

    this.btnTestGemini.addEventListener('click', async () => {
      this.settingsStatus.textContent = 'Probando conexión con Gemini...';
      this.geminiCounter.setApiKey(this.geminiApiKeyInput.value);
      this.geminiCounter.setModel(this.geminiModelSelect.value);
      const res = await this.geminiCounter.testConnection();
      this.settingsStatus.textContent = res.message;
      this.settingsStatus.className = res.success ? 'status-msg success' : 'status-msg error';
    });

    // Diagnóstico Waveform
    this.btnWaveform.addEventListener('click', () => {
      this.openModal(this.waveformModal);
      if (this.state.lastProfile) {
        this.roiViewer.drawWaveformToCanvas(
          this.waveformCanvas,
          this.state.lastProfile,
          this.roiViewer.markers
        );
      }
    });
    this.closeWaveformBtn.addEventListener('click', () => this.closeModal(this.waveformModal));

    [this.samplesModal, this.settingsModal, this.waveformModal].forEach(m => {
      m.addEventListener('click', (e) => {
        if (e.target === m) this.closeModal(m);
      });
    });
  }

  openModal(m) { m.classList.add('open'); }
  closeModal(m) { m.classList.remove('open'); }

  openSettingsModal() {
    this.geminiApiKeyInput.value = this.geminiCounter.getApiKey();
    this.geminiModelSelect.value = this.geminiCounter.model;
    this.settingsStatus.textContent = '';
    this.openModal(this.settingsModal);
  }

  showLoading(text) {
    this.loadingText.textContent = text;
    this.loadingOverlay.classList.add('visible');
  }

  hideLoading() {
    this.loadingOverlay.classList.remove('visible');
  }

  showToast(msg, type = 'info', duration = 3000) {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    this.toastContainer.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 250);
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
          .then(r => console.log('[PWA] SW Registrado:', r.scope))
          .catch(e => console.warn('[PWA] Error SW:', e));
      });
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new RealTimeSheetCounterApp();
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    window.app.startLiveStream().catch(() => {
      window.app.loadSample(1);
    });
  } else {
    window.app.loadSample(1);
  }
});
