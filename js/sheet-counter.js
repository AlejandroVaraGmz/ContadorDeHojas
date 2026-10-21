/**
 * sheet-counter.js - Motor de Procesamiento Local (Modo A)
 * Implementa procesamiento digital de imágenes con Canvas API:
 * 1. Conversión a escala de grises y ecualización de histograma adaptativa (CLAHE).
 * 2. Filtro Gaussiano para reducción de ruido de textura metálica.
 * 3. Perfil de proyección horizontal de intensidades (promedio de brillo por fila).
 * 4. Detección de picos y valles con sensibilidad adaptativa según el calibre.
 * 5. Estimación automática de periodo mediante autocorrelación.
 */

class SheetCounter {
  constructor() {
    // Especificaciones físicas y parámetros de calibración por calibre
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
        minDistance: 5,
        expectedPitch: 9,
        filterSigma: 0.8,
        prominenceThreshold: 0.03
      },
      'cal24': {
        name: 'Calibre 24',
        nominalMm: 0.61,
        minDistance: 3,
        expectedPitch: 5,
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
  }

  /**
   * Procesa el área de interés (ROI) en un canvas
   * @param {HTMLCanvasElement} sourceCanvas - Canvas con la imagen original congelada
   * @param {Object} roi - Rectángulo { x, y, width, height } en píxeles absolutos del canvas
   * @param {string} gaugeKey - Clave del calibre ('quarter', 'cal10', 'cal12', 'cal14', 'cal20', 'cal24', 'auto')
   * @param {number} sensitivity - Factor de sensibilidad (0.2 a 2.0, default 1.0)
   * @returns {Object} { count, markers, profile, rawProfile, smoothedProfile, estimatedPitch, gaugeUsed }
   */
  processROI(sourceCanvas, roi, gaugeKey = 'auto', sensitivity = 1.0) {
    const ctx = sourceCanvas.getContext('2d');
    const rx = Math.max(0, Math.round(roi.x));
    const ry = Math.max(0, Math.round(roi.y));
    const rw = Math.min(sourceCanvas.width - rx, Math.round(roi.width));
    const rh = Math.min(sourceCanvas.height - ry, Math.round(roi.height));

    if (rw <= 10 || rh <= 10) {
      return { count: 0, markers: [], profile: [], error: 'ROI demasiado pequeño' };
    }

    // 1. Obtener píxeles del ROI
    const imgData = ctx.getImageData(rx, ry, rw, rh);
    const data = imgData.data;

    // 2. Convertir a Escala de Grises en Float32Array (rango 0-255)
    const gray = new Float32Array(rw * rh);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      // Fórmula estándar luminancia ITU-R BT.601
      gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    // 3. Aplicar CLAHE (Contrast-Limited Adaptive Histogram Equalization)
    const claheData = this.applyCLAHE(gray, rw, rh, 4, 8, 3.0);

    // 4. Perfil de Proyección Horizontal de Intensidades
    // Para mayor robustez contra ligeras inclinaciones o rayones en bordes,
    // promediamos sobre la franja central (30% a 80% del ancho del ROI)
    const colStart = Math.floor(rw * 0.25);
    const colEnd = Math.floor(rw * 0.85);
    const sampleWidth = colEnd - colStart;

    const rawProfile = new Float32Array(rh);
    for (let y = 0; y < rh; y++) {
      let sum = 0;
      const rowOffset = y * rw;
      for (let x = colStart; x < colEnd; x++) {
        sum += claheData[rowOffset + x];
      }
      rawProfile[y] = sum / sampleWidth;
    }

    // 5. Normalización de iluminación local (sustracción de fondo pasa-altas)
    // Elimina gradientes de iluminación global entre arriba y abajo
    let config = this.GAUGE_CONFIGS[gaugeKey] || this.GAUGE_CONFIGS['auto'];
    let expectedPitch = config.expectedPitch;

    // Si es detección automática, estimar periodo dominante por autocorrelación
    if (!expectedPitch || gaugeKey === 'auto') {
      expectedPitch = this.estimatePitchByAutocorrelation(rawProfile);
    }

    // Aplicar sensibilidad al pitch y a la distancia mínima
    const adjustedMinDist = Math.max(2, Math.round((config.minDistance || (expectedPitch * 0.6)) / sensitivity));
    const winBg = Math.min(rh - 1, Math.max(5, Math.round(expectedPitch * 2.2)));
    const bgProfile = this.movingAverage(rawProfile, winBg);
    
    // Perfil con contraste mejorado y fondo removido
    const hpProfile = new Float32Array(rh);
    for (let y = 0; y < rh; y++) {
      hpProfile[y] = rawProfile[y] - bgProfile[y];
    }

    // 6. Filtro Gaussiano 1D ligero para reducir ruido de textura del metal
    const sigma = Math.max(0.6, (config.filterSigma || 1.0) / Math.sqrt(sensitivity));
    const smoothedProfile = this.gaussianSmooth1D(hpProfile, sigma);

    // 7. Detección de Picos (Láminas) y Valles (Separaciones/Sombras)
    const detectedPeaks = this.findPeaks(smoothedProfile, adjustedMinDist, config.prominenceThreshold / sensitivity);

    // Mapear picos a marcadores con coordenadas absolutas en el canvas
    const markers = detectedPeaks.map((peakOffset, index) => {
      return {
        id: index + 1,
        roiY: peakOffset,
        canvasY: ry + peakOffset,
        canvasX: rx + Math.round(rw * 0.5),
        roiX: Math.round(rw * 0.5),
        intensity: smoothedProfile[peakOffset]
      };
    });

    return {
      count: markers.length,
      markers: markers,
      profile: Array.from(smoothedProfile),
      rawProfile: Array.from(rawProfile),
      estimatedPitch: Math.round(expectedPitch * 10) / 10,
      gaugeUsed: config.name,
      roi: { x: rx, y: ry, width: rw, height: rh }
    };
  }

  /**
   * Implementación de CLAHE (Contrast-Limited Adaptive Histogram Equalization)
   */
  applyCLAHE(gray, width, height, tilesX = 4, tilesY = 8, clipLimit = 3.0) {
    const tileW = Math.ceil(width / tilesX);
    const tileH = Math.ceil(height / tilesY);
    const numBins = 256;
    const cdfs = [];

    // Calcular histograma ecualizado para cada tile
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const x0 = tx * tileW;
        const y0 = ty * tileH;
        const x1 = Math.min(width, x0 + tileW);
        const y1 = Math.min(height, y0 + tileH);
        const tileArea = (x1 - x0) * (y1 - y0);

        const hist = new Int32Array(numBins);
        for (let y = y0; y < y1; y++) {
          const row = y * width;
          for (let x = x0; x < x1; x++) {
            const v = Math.min(255, Math.max(0, Math.round(gray[row + x])));
            hist[v]++;
          }
        }

        // Clip limit
        const actualClip = Math.max(1, Math.round(clipLimit * (tileArea / numBins)));
        let excess = 0;
        for (let b = 0; b < numBins; b++) {
          if (hist[b] > actualClip) {
            excess += hist[b] - actualClip;
            hist[b] = actualClip;
          }
        }
        const bonus = Math.floor(excess / numBins);
        for (let b = 0; b < numBins; b++) {
          hist[b] += bonus;
        }

        // CDF
        const cdf = new Float32Array(numBins);
        let cum = 0;
        for (let b = 0; b < numBins; b++) {
          cum += hist[b];
          cdf[b] = (cum / tileArea) * 255;
        }
        cdfs.push(cdf);
      }
    }

    // Interpolar bilinealmente entre tiles vecinos para suavidad continua
    const result = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      const ty_f = (y / tileH) - 0.5;
      const ty1 = Math.max(0, Math.min(tilesY - 1, Math.floor(ty_f)));
      const ty2 = Math.min(tilesY - 1, ty1 + 1);
      const dy = Math.max(0, Math.min(1, ty_f - ty1));

      const row = y * width;
      for (let x = 0; x < width; x++) {
        const tx_f = (x / tileW) - 0.5;
        const tx1 = Math.max(0, Math.min(tilesX - 1, Math.floor(tx_f)));
        const tx2 = Math.min(tilesX - 1, tx1 + 1);
        const dx = Math.max(0, Math.min(1, tx_f - tx1));

        const val = Math.min(255, Math.max(0, Math.round(gray[row + x])));
        const cdf11 = cdfs[ty1 * tilesX + tx1][val];
        const cdf12 = cdfs[ty1 * tilesX + tx2][val];
        const cdf21 = cdfs[ty2 * tilesX + tx1][val];
        const cdf22 = cdfs[ty2 * tilesX + tx2][val];

        const top = cdf11 * (1 - dx) + cdf12 * dx;
        const bot = cdf21 * (1 - dx) + cdf22 * dx;
        result[row + x] = top * (1 - dy) + bot * dy;
      }
    }
    return result;
  }

  /**
   * Media móvil para sustracción de fondo
   */
  movingAverage(array, windowSize) {
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
   * Filtro Gaussiano 1D
   */
  gaussianSmooth1D(array, sigma) {
    const radius = Math.max(1, Math.ceil(sigma * 3));
    const kernelSize = radius * 2 + 1;
    const kernel = new Float32Array(kernelSize);
    let sum = 0;

    for (let i = -radius; i <= radius; i++) {
      const w = Math.exp(-0.5 * (i / sigma) * (i / sigma));
      kernel[i + radius] = w;
      sum += w;
    }
    for (let i = 0; i < kernelSize; i++) {
      kernel[i] /= sum;
    }

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
   * Estima el periodo dominante (grosor de cada lámina en px)
   * mediante autocorrelación del perfil
   */
  estimatePitchByAutocorrelation(profile) {
    const len = profile.length;
    if (len < 10) return 15;

    // Media
    let mean = 0;
    for (let i = 0; i < len; i++) mean += profile[i];
    mean /= len;

    // Autocorrelación para desfases (lags) entre 3 y len/2
    const maxLag = Math.min(100, Math.floor(len / 2));
    let bestLag = 16;
    let maxCorr = -Infinity;

    for (let lag = 3; lag < maxLag; lag++) {
      let corr = 0;
      let count = 0;
      for (let i = 0; i < len - lag; i++) {
        corr += (profile[i] - mean) * (profile[i + lag] - mean);
        count++;
      }
      if (count > 0) {
        corr /= count;
        // Ponderar hacia lags medios para evitar subarmónicos espurios
        if (corr > maxCorr) {
          maxCorr = corr;
          bestLag = lag;
        }
      }
    }
    return Math.max(4, Math.min(80, bestLag));
  }

  /**
   * Algoritmo de detección de picos con distancia mínima y prominencia
   */
  findPeaks(profile, minDistance, minProminence = 0.03) {
    const len = profile.length;
    const candidates = [];

    // 1. Encontrar todos los máximos locales
    for (let i = 1; i < len - 1; i++) {
      if (profile[i] > profile[i - 1] && profile[i] >= profile[i + 1]) {
        candidates.push({ index: i, value: profile[i] });
      }
    }

    if (candidates.length === 0) return [];

    // 2. Ordenar candidatos por intensidad descendente y suprimir vecinos dentro de minDistance
    candidates.sort((a, b) => b.value - a.value);

    const selected = [];
    const suppressed = new Uint8Array(len);

    for (const cand of candidates) {
      if (suppressed[cand.index]) continue;

      selected.push(cand.index);

      // Suprimir ventana de distancia mínima
      const start = Math.max(0, cand.index - minDistance);
      const end = Math.min(len - 1, cand.index + minDistance);
      for (let s = start; s <= end; s++) {
        suppressed[s] = 1;
      }
    }

    // 3. Ordenar cronológicamente (de arriba hacia abajo)
    selected.sort((a, b) => a - b);
    return selected;
  }
}

// Exportar globalmente
window.SheetCounter = SheetCounter;
