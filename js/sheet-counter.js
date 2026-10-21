/**
 * sheet-counter.js - Motor 1: Detección en Tiempo Real a 30 FPS (Algoritmo Local en Vivo)
 * Optimizado para ejecución a 30-60 FPS en navegadores móviles sin latencia.
 * Incluye filtro de estabilización temporal (mediana de 12 frames) contra temblores de mano.
 */

class SheetCounter {
  constructor() {
    this.GAUGE_CONFIGS = {
      'quarter': {
        name: 'Calibre 1/4"',
        nominalMm: 6.35,
        minDistance: 32,
        expectedPitch: 60,
        filterSigma: 2.2,
        prominenceThreshold: 0.08
      },
      'cal10': {
        name: 'Calibre 10',
        nominalMm: 3.42,
        minDistance: 19,
        expectedPitch: 32,
        filterSigma: 1.8,
        prominenceThreshold: 0.06
      },
      'cal12': {
        name: 'Calibre 12',
        nominalMm: 2.66,
        minDistance: 15,
        expectedPitch: 24,
        filterSigma: 1.4,
        prominenceThreshold: 0.05
      },
      'cal14': {
        name: 'Calibre 14',
        nominalMm: 1.90,
        minDistance: 10,
        expectedPitch: 17,
        filterSigma: 1.0,
        prominenceThreshold: 0.04
      },
      'cal20': {
        name: 'Calibre 20',
        nominalMm: 0.91,
        minDistance: 4,
        expectedPitch: 5.5,
        filterSigma: 0.7,
        prominenceThreshold: 0.025
      },
      'cal24': {
        name: 'Calibre 24',
        nominalMm: 0.61,
        minDistance: 3,
        expectedPitch: 5.0,
        filterSigma: 0.6,
        prominenceThreshold: 0.02
      },
      'auto': {
        name: 'Detección Automática',
        nominalMm: 0,
        minDistance: 4,
        expectedPitch: null,
        filterSigma: 1.0,
        prominenceThreshold: 0.04
      }
    };

    // Canvas fuera de pantalla para muestreo ultra-rápido del ROI a 30 FPS
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });

    // Historial para el Filtro de Estabilización (Mediana de los últimos 12 frames)
    this.historyCounts = [];
    this.maxHistory = 12;
    this.lastStableCount = 0;

    // Marcadores suavizados temporalmente para evitar parpadeo visual
    this.smoothedMarkers = [];
  }

  /**
   * Procesa un frame del video en vivo dentro de la Zona de Escaneo (ROI)
   * Diseñado para llamarse en cada requestAnimationFrame (~30-60 veces por segundo).
   * @param {HTMLVideoElement|HTMLCanvasElement} source - Elemento <video> en reproducción
   * @param {Object} roi - { x, y, width, height } en coordenadas nativas del video
   * @param {string} gaugeKey - Calibre seleccionado ('auto', 'cal10', 'cal12', etc.)
   * @param {number} sensitivity - Factor de sensibilidad (0.3 a 2.0)
   * @returns {Object} { liveCount, stableCount, markers, profile }
   */
  processLiveFrame(source, roi, gaugeKey = 'auto', sensitivity = 1.0) {
    const rx = Math.max(0, Math.round(roi.x));
    const ry = Math.max(0, Math.round(roi.y));
    const rw = Math.round(roi.width);
    const rh = Math.round(roi.height);

    if (rw < 10 || rh < 10) {
      return { liveCount: 0, stableCount: 0, markers: [], profile: [] };
    }

    // Para máxima velocidad a 30 FPS, muestreamos una franja central de 120px de ancho
    // preservando la resolución vertical al 100%
    const sampleWidth = Math.min(160, rw);
    const sampleHeight = rh;

    if (this.offscreenCanvas.width !== sampleWidth || this.offscreenCanvas.height !== sampleHeight) {
      this.offscreenCanvas.width = sampleWidth;
      this.offscreenCanvas.height = sampleHeight;
    }

    // Copiar únicamente la zona del ROI desde el video
    const sampleX = rx + Math.round((rw - sampleWidth) / 2);
    this.offscreenCtx.drawImage(
      source,
      sampleX, ry, sampleWidth, sampleHeight,
      0, 0, sampleWidth, sampleHeight
    );

    const imgData = this.offscreenCtx.getImageData(0, 0, sampleWidth, sampleHeight);
    const data = imgData.data;

    // 1. Proyección horizontal directa con conversión a escala de grises
    const rawProfile = new Float32Array(sampleHeight);
    for (let y = 0; y < sampleHeight; y++) {
      let sum = 0;
      const rowOffset = y * sampleWidth * 4;
      for (let x = 0; x < sampleWidth; x++) {
        const px = rowOffset + x * 4;
        // Luminancia BT.601
        sum += (0.299 * data[px] + 0.587 * data[px + 1] + 0.114 * data[px + 2]);
      }
      rawProfile[y] = sum / sampleWidth;
    }

    // 2. Parámetros según calibre seleccionado
    let config = this.GAUGE_CONFIGS[gaugeKey] || this.GAUGE_CONFIGS['auto'];
    let expectedPitch = config.expectedPitch;

    if (!expectedPitch || gaugeKey === 'auto') {
      expectedPitch = this.estimatePitchFast(rawProfile);
    }

    const adjustedMinDist = Math.max(2, Math.round((config.minDistance || (expectedPitch * 0.6)) / sensitivity));
    
    // 3. Sustracción de fondo pasa-altas para normalizar iluminación
    const winBg = Math.min(sampleHeight - 1, Math.max(5, Math.round(expectedPitch * 2.2)));
    const bgProfile = this.fastMovingAverage(rawProfile, winBg);

    const hpProfile = new Float32Array(sampleHeight);
    for (let y = 0; y < sampleHeight; y++) {
      hpProfile[y] = rawProfile[y] - bgProfile[y];
    }

    // 4. Filtro Gaussiano 1D ligero
    const sigma = Math.max(0.6, (config.filterSigma || 1.0) / Math.sqrt(sensitivity));
    const smoothedProfile = this.fastGaussian1D(hpProfile, sigma);

    // 5. Detección de picos
    const detectedPeaks = this.findPeaks(smoothedProfile, adjustedMinDist, (config.prominenceThreshold || 0.04) / sensitivity);
    const currentFrameCount = detectedPeaks.length;

    // 6. FILTRO DE ESTABILIZACIÓN TEMPORAL (Rolling Median de 12 frames)
    this.historyCounts.push(currentFrameCount);
    if (this.historyCounts.length > this.maxHistory) {
      this.historyCounts.shift();
    }
    const stableCount = this.calculateMedian(this.historyCounts);
    this.lastStableCount = stableCount;

    // 7. Mapeo de picos a coordenadas relativas y absolutas con suavizado temporal
    const targetMarkers = detectedPeaks.map((yOffset, idx) => ({
      id: idx + 1,
      roiY: yOffset,
      canvasY: ry + yOffset,
      canvasX: rx + rw / 2,
      intensity: smoothedProfile[yOffset]
    }));

    // Suavizado exponencial para evitar saltos en las líneas verdes
    this.smoothedMarkers = this.smoothMarkerPositions(targetMarkers, this.smoothedMarkers, ry, rh);

    return {
      liveCount: currentFrameCount,
      stableCount: stableCount,
      markers: this.smoothedMarkers,
      rawMarkers: targetMarkers,
      profile: Array.from(smoothedProfile),
      rawProfile: Array.from(rawProfile),
      gaugeName: config.name,
      estimatedPitch: Math.round(expectedPitch * 10) / 10
    };
  }

  /**
   * Calcula la mediana estadística de una lista de enteros
   */
  calculateMedian(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 !== 0) {
      return sorted[mid];
    }
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  /**
   * Suaviza la posición Y de los marcadores entre frames consecutivos
   */
  smoothMarkerPositions(newMarkers, prevMarkers, roiY, roiHeight) {
    if (!prevMarkers || prevMarkers.length === 0 || Math.abs(newMarkers.length - prevMarkers.length) > 2) {
      return newMarkers;
    }

    const alpha = 0.35; // Factor de respuesta inmediata
    return newMarkers.map((nm, idx) => {
      // Buscar el marcador previo más cercano verticalmente
      let closestPrev = null;
      let minDist = 18; // Tolerancia en píxeles

      for (let pm of prevMarkers) {
        const dist = Math.abs(pm.canvasY - nm.canvasY);
        if (dist < minDist) {
          minDist = dist;
          closestPrev = pm;
        }
      }

      if (closestPrev) {
        const smoothY = Math.round(closestPrev.canvasY * (1 - alpha) + nm.canvasY * alpha);
        return {
          id: idx + 1,
          roiY: smoothY - roiY,
          canvasY: smoothY,
          canvasX: nm.canvasX,
          intensity: nm.intensity
        };
      }
      return nm;
    });
  }

  /**
   * Resetea el buffer de estabilización (útil al cambiar de cámara o calibre)
   */
  resetHistory() {
    this.historyCounts = [];
    this.smoothedMarkers = [];
    this.lastStableCount = 0;
  }

  /**
   * Media móvil optimizada O(N)
   */
  fastMovingAverage(array, windowSize) {
    const len = array.length;
    const result = new Float32Array(len);
    const half = Math.floor(windowSize / 2);

    let sum = 0;
    let count = 0;
    for (let i = 0; i <= Math.min(half, len - 1); i++) {
      sum += array[i];
      count++;
    }

    for (let i = 0; i < len; i++) {
      const addIdx = i + half;
      if (addIdx < len) {
        sum += array[addIdx];
        count++;
      }
      const remIdx = i - half - 1;
      if (remIdx >= 0) {
        sum -= array[remIdx];
        count--;
      }
      result[i] = sum / count;
    }
    return result;
  }

  /**
   * Filtro Gaussiano 1D rápido
   */
  fastGaussian1D(array, sigma) {
    const radius = Math.max(1, Math.ceil(sigma * 2.5));
    const kernelSize = radius * 2 + 1;
    const kernel = new Float32Array(kernelSize);
    let sum = 0;

    for (let i = -radius; i <= radius; i++) {
      const w = Math.exp(-0.5 * (i / sigma) * (i / sigma));
      kernel[i + radius] = w;
      sum += w;
    }
    for (let i = 0; i < kernelSize; i++) kernel[i] /= sum;

    const len = array.length;
    const smoothed = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const idx = Math.min(len - 1, Math.max(0, i + k));
        acc += array[idx] * kernel[k + radius];
      }
      smoothed[i] = acc;
    }
    return smoothed;
  }

  /**
   * Estimación rápida de pitch por autocorrelación
   */
  estimatePitchFast(profile) {
    const len = profile.length;
    if (len < 10) return 16;

    let mean = 0;
    for (let i = 0; i < len; i++) mean += profile[i];
    mean /= len;

    const maxLag = Math.min(80, Math.floor(len / 2));
    let bestLag = 16;
    let maxCorr = -Infinity;

    for (let lag = 3; lag < maxLag; lag++) {
      let corr = 0;
      let count = 0;
      for (let i = 0; i < len - lag; i += 2) { // Paso 2 para mayor velocidad a 30 FPS
        corr += (profile[i] - mean) * (profile[i + lag] - mean);
        count++;
      }
      if (count > 0) {
        corr /= count;
        if (corr > maxCorr) {
          maxCorr = corr;
          bestLag = lag;
        }
      }
    }
    return Math.max(4, Math.min(80, bestLag));
  }

  /**
   * Búsqueda de picos locales con supresión de no-máximos
   */
  findPeaks(profile, minDistance, minProminence = 0.03) {
    const len = profile.length;
    const candidates = [];

    for (let i = 1; i < len - 1; i++) {
      if (profile[i] > profile[i - 1] && profile[i] >= profile[i + 1]) {
        candidates.push({ index: i, value: profile[i] });
      }
    }

    if (candidates.length === 0) return [];

    candidates.sort((a, b) => b.value - a.value);

    const selected = [];
    const suppressed = new Uint8Array(len);

    for (const cand of candidates) {
      if (suppressed[cand.index]) continue;

      selected.push(cand.index);

      const start = Math.max(0, cand.index - minDistance);
      const end = Math.min(len - 1, cand.index + minDistance);
      for (let s = start; s <= end; s++) {
        suppressed[s] = 1;
      }
    }

    selected.sort((a, b) => a - b);
    return selected;
  }
}

window.SheetCounter = SheetCounter;
