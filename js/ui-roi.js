/**
 * ui-roi.js - Escáner en Tiempo Real (HUD y Recubrimiento AR en Vivo)
 * Dibuja la Zona de Escaneo (ROI) con guías de alineación, las líneas verde neón en tiempo real
 * a 30 FPS, y gestiona la edición táctil (+1 / -1) al congelar la lectura.
 */

class ROIViewer {
  constructor(overlayCanvas, options = {}) {
    this.canvas = overlayCanvas;
    this.ctx = overlayCanvas.getContext('2d');
    this.onMarkersChanged = options.onMarkersChanged || null;
    this.onRoiChanged = options.onRoiChanged || null;

    // ROI en coordenadas relativas (0.0 a 1.0)
    this.roiRelative = {
      x: 0.22,
      y: 0.32,
      width: 0.56,
      height: 0.40
    };

    this.isFrozen = false;
    this.frozenImage = null;

    // Marcadores actuales en vivo o congelados: [{ id, canvasY, canvasX, roiY }]
    this.markers = [];
    this.history = [];

    // Estado de arrastre del ROI
    this.isDraggingTop = false;
    this.isDraggingBottom = false;
    this.isDraggingBox = false;
    this.dragStartY = 0;
    this.initialRoi = null;

    // Animación del rayo láser de escaneo en vivo
    this.laserProgress = 0;
    this.laserDirection = 1;

    // Colores industriales
    this.neonColor = '#22c55e'; // Verde Neón
    this.roiColor = '#00f0ff';  // Cyan
    this.safetyAmber = '#eab308'; // Amarillo de seguridad

    this._bindEvents();
  }

  getAbsoluteROI() {
    return {
      x: Math.round(this.roiRelative.x * this.canvas.width),
      y: Math.round(this.roiRelative.y * this.canvas.height),
      width: Math.round(this.roiRelative.width * this.canvas.width),
      height: Math.round(this.roiRelative.height * this.canvas.height)
    };
  }

  setRelativeROI(roi) {
    this.roiRelative = {
      x: Math.max(0.05, Math.min(0.85, roi.x)),
      y: Math.max(0.05, Math.min(0.85, roi.y)),
      width: Math.max(0.15, Math.min(0.9, roi.width)),
      height: Math.max(0.05, Math.min(0.9, roi.height))
    };
    if (this.onRoiChanged) {
      this.onRoiChanged(this.getAbsoluteROI());
    }
  }

  /**
   * Sincroniza las dimensiones del canvas superpuesto con la resolución del video/contenedor
   */
  syncDimensions(width, height) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /**
   * DIBUJO EN VIVO (Llamado en cada frame a 30 FPS)
   * Renderiza el recubrimiento AR sobre el video en movimiento
   */
  renderLiveHUD(detectedMarkers, liveCount, stableCount, gaugeName, iaInfo = null) {
    if (this.isFrozen) return; // Si está congelado, el visor no redibuja el HUD en vivo

    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (cw === 0 || ch === 0) return;

    ctx.clearRect(0, 0, cw, ch);

    const roi = this.getAbsoluteROI();

    // 1. Máscara de oscurecimiento exterior para enfocar la visión
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    // Arriba
    ctx.fillRect(0, 0, cw, roi.y);
    // Abajo
    ctx.fillRect(0, roi.y + roi.height, cw, ch - (roi.y + roi.height));
    // Izquierda
    ctx.fillRect(0, roi.y, roi.x, roi.height);
    // Derecha
    ctx.fillRect(roi.x + roi.width, roi.y, cw - (roi.x + roi.width), roi.height);
    ctx.restore();

    // 2. Marco del ROI (Zona de Escaneo)
    ctx.save();
    ctx.strokeStyle = this.roiColor;
    ctx.lineWidth = 2.0;
    ctx.strokeRect(roi.x, roi.y, roi.width, roi.height);

    // Esquinas reforzadas estilo visor técnico
    const cSize = Math.min(22, Math.round(roi.width * 0.12));
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = this.safetyAmber;

    // TL
    ctx.beginPath(); ctx.moveTo(roi.x, roi.y + cSize); ctx.lineTo(roi.x, roi.y); ctx.lineTo(roi.x + cSize, roi.y); ctx.stroke();
    // TR
    ctx.beginPath(); ctx.moveTo(roi.x + roi.width - cSize, roi.y); ctx.lineTo(roi.x + roi.width, roi.y); ctx.lineTo(roi.x + roi.width, roi.y + cSize); ctx.stroke();
    // BL
    ctx.beginPath(); ctx.moveTo(roi.x, roi.y + roi.height - cSize); ctx.lineTo(roi.x, roi.y + roi.height); ctx.lineTo(roi.x + cSize, roi.y + roi.height); ctx.stroke();
    // BR
    ctx.beginPath(); ctx.moveTo(roi.x + roi.width - cSize, roi.y + roi.height); ctx.lineTo(roi.x + roi.width, roi.y + roi.height); ctx.lineTo(roi.x + roi.width, roi.y + roi.height - cSize); ctx.stroke();

    // Manijas táctiles de ajuste superior e inferior
    ctx.fillStyle = this.safetyAmber;
    ctx.fillRect(roi.x + roi.width / 2 - 28, roi.y - 6, 56, 12);
    ctx.fillRect(roi.x + roi.width / 2 - 28, roi.y + roi.height - 6, 56, 12);

    // Textos de exclusión de cartón
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = this.safetyAmber;
    ctx.fillText('▲ EXCLUIR CARTÓN SUPERIOR ▲', roi.x + 8, Math.max(14, roi.y - 10));
    ctx.fillText('▼ EXCLUIR BASE / CARTÓN ▼', roi.x + 8, Math.min(ch - 8, roi.y + roi.height + 18));

    // 3. Rayo Láser de Escaneo Dinámico en Vivo
    this.laserProgress += 0.015 * this.laserDirection;
    if (this.laserProgress >= 1.0) { this.laserProgress = 1.0; this.laserDirection = -1; }
    else if (this.laserProgress <= 0.0) { this.laserProgress = 0.0; this.laserDirection = 1; }

    const laserY = roi.y + Math.round(this.laserProgress * roi.height);
    const laserGrad = ctx.createLinearGradient(roi.x, laserY, roi.x + roi.width, laserY);
    laserGrad.addColorStop(0, 'rgba(34, 197, 94, 0)');
    laserGrad.addColorStop(0.5, 'rgba(34, 197, 94, 0.7)');
    laserGrad.addColorStop(1, 'rgba(34, 197, 94, 0)');
    ctx.fillStyle = laserGrad;
    ctx.fillRect(roi.x, laserY - 1, roi.width, 3);
    ctx.restore();

    // 4. Dibujo de Líneas y Puntos Verde Neón sobre cada lámina detectada en vivo
    this.markers = detectedMarkers;

    ctx.save();
    ctx.shadowColor = this.neonColor;
    ctx.shadowBlur = 6;
    ctx.strokeStyle = this.neonColor;
    ctx.lineWidth = 2.0;

    for (let i = 0; i < detectedMarkers.length; i++) {
      const m = detectedMarkers[i];
      const y = m.canvasY;

      // Línea horizontal que resalta el canto
      ctx.beginPath();
      ctx.moveTo(roi.x + 4, y);
      ctx.lineTo(roi.x + roi.width - 4, y);
      ctx.stroke();

      // Punto central indicador
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(roi.x + roi.width / 2, y, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Número indicador a la derecha (cada 2 láminas o si son pocas)
      if (detectedMarkers.length <= 30 || (i + 1) % 5 === 0 || i === detectedMarkers.length - 1) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(7, 9, 13, 0.85)';
        ctx.fillRect(roi.x + roi.width - 28, y - 8, 26, 16);
        ctx.strokeStyle = this.neonColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(roi.x + roi.width - 28, y - 8, 26, 16);

        ctx.fillStyle = this.neonColor;
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${i + 1}`, roi.x + roi.width - 15, y);
        ctx.shadowBlur = 6;
      }
    }
    ctx.restore();
  }

  /**
   * Congela el frame actual para inspección y edición manual
   */
  freezeFrame(imageSource, currentMarkers) {
    this.isFrozen = true;
    this.frozenImage = imageSource;
    this.syncDimensions(imageSource.width || imageSource.videoWidth, imageSource.height || imageSource.videoHeight);
    this.markers = JSON.parse(JSON.stringify(currentMarkers));
    this.history = [];
    this.redrawFrozenCanvas();
    this._notifyChange();
  }

  /**
   * Reanuda el stream de video en vivo
   */
  resumeLive() {
    this.isFrozen = false;
    this.frozenImage = null;
  }

  /**
   * Redibuja la vista congelada con la imagen de fondo y los marcadores
   */
  redrawFrozenCanvas() {
    if (!this.canvas) return;
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    ctx.clearRect(0, 0, cw, ch);

    // Dibujar fotograma congelado
    if (this.frozenImage) {
      ctx.drawImage(this.frozenImage, 0, 0, cw, ch);
    }

    const roi = this.getAbsoluteROI();

    // Máscara oscura
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.40)';
    ctx.fillRect(0, 0, cw, roi.y);
    ctx.fillRect(0, roi.y + roi.height, cw, ch - (roi.y + roi.height));
    ctx.fillRect(0, roi.y, roi.x, roi.height);
    ctx.fillRect(roi.x + roi.width, roi.y, cw - (roi.x + roi.width), roi.height);

    // Marco del ROI
    ctx.strokeStyle = this.roiColor;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(roi.x, roi.y, roi.width, roi.height);

    // Esquinas
    const c = 22;
    ctx.strokeStyle = this.safetyAmber;
    ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(roi.x, roi.y + c); ctx.lineTo(roi.x, roi.y); ctx.lineTo(roi.x + c, roi.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(roi.x + roi.width - c, roi.y); ctx.lineTo(roi.x + roi.width, roi.y); ctx.lineTo(roi.x + roi.width, roi.y + c); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(roi.x, roi.y + roi.height - c); ctx.lineTo(roi.x, roi.y + roi.height); ctx.lineTo(roi.x + c, roi.y + roi.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(roi.x + roi.width - c, roi.y + roi.height); ctx.lineTo(roi.x + roi.width, roi.y + roi.height); ctx.lineTo(roi.x + roi.width, roi.y + roi.height - c); ctx.stroke();

    // Manijas de ajuste
    ctx.fillStyle = this.safetyAmber;
    ctx.fillRect(roi.x + roi.width / 2 - 28, roi.y - 7, 56, 14);
    ctx.fillRect(roi.x + roi.width / 2 - 28, roi.y + roi.height - 7, 56, 14);

    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = this.safetyAmber;
    ctx.fillText('▲ EXCLUIR CARTÓN SUPERIOR', roi.x + 8, Math.max(16, roi.y - 12));
    ctx.fillText('▼ EXCLUIR CARTÓN INFERIOR', roi.x + 8, Math.min(ch - 8, roi.y + roi.height + 18));
    ctx.restore();

    // Dibujar marcadores congelados con soporte táctil
    ctx.save();
    this.markers.forEach((m) => {
      const y = m.canvasY;
      ctx.shadowColor = this.neonColor;
      ctx.shadowBlur = 8;
      ctx.strokeStyle = this.neonColor;
      ctx.lineWidth = 2.5;

      ctx.beginPath();
      ctx.moveTo(roi.x + 4, y);
      ctx.lineTo(roi.x + roi.width - 4, y);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(roi.x + roi.width / 2, y, 4, 0, Math.PI * 2);
      ctx.fill();

      // Número
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(7, 9, 13, 0.88)';
      ctx.fillRect(roi.x + roi.width - 32, y - 9, 30, 18);
      ctx.strokeStyle = this.neonColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(roi.x + roi.width - 32, y - 9, 30, 18);

      ctx.fillStyle = this.neonColor;
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${m.id}`, roi.x + roi.width - 17, y);
    });
    ctx.restore();
  }

  /**
   * Sincroniza marcadores devueltos por Gemini Vision
   */
  applyGeminiMarkers(normalizedYList) {
    const roi = this.getAbsoluteROI();
    this._saveHistory();

    this.markers = normalizedYList.map((normY, idx) => {
      const cy = Math.round(roi.y + normY * roi.height);
      return {
        id: idx + 1,
        roiY: Math.round(normY * roi.height),
        canvasY: cy,
        canvasX: roi.x + roi.width / 2
      };
    });

    if (this.isFrozen) {
      this.redrawFrozenCanvas();
    }
    this._notifyChange();
  }

  // --- Funciones de Edición Táctil (+1 / -1) ---

  addMarkerAt(canvasY) {
    this._saveHistory();
    const roi = this.getAbsoluteROI();
    const clampedY = Math.max(roi.y, Math.min(roi.y + roi.height, canvasY));

    this.markers.push({
      id: this.markers.length + 1,
      roiY: clampedY - roi.y,
      canvasY: clampedY,
      canvasX: roi.x + roi.width / 2
    });

    this.markers.sort((a, b) => a.canvasY - b.canvasY);
    this.markers.forEach((m, idx) => (m.id = idx + 1));

    if (this.isFrozen) this.redrawFrozenCanvas();
    this._notifyChange();
  }

  removeMarker(index) {
    if (index >= 0 && index < this.markers.length) {
      this._saveHistory();
      this.markers.splice(index, 1);
      this.markers.forEach((m, idx) => (m.id = idx + 1));
      if (this.isFrozen) this.redrawFrozenCanvas();
      this._notifyChange();
    }
  }

  adjustPlusOne() {
    this._saveHistory();
    const roi = this.getAbsoluteROI();

    if (this.markers.length === 0) {
      this.addMarkerAt(roi.y + roi.height / 2);
      return;
    }

    // Insertar en la brecha vertical más amplia
    let maxGap = 0;
    let insertY = roi.y + roi.height / 2;

    for (let i = 0; i < this.markers.length - 1; i++) {
      const gap = this.markers[i + 1].canvasY - this.markers[i].canvasY;
      if (gap > maxGap) {
        maxGap = gap;
        insertY = Math.round(this.markers[i].canvasY + gap / 2);
      }
    }

    const topGap = this.markers[0].canvasY - roi.y;
    const botGap = (roi.y + roi.height) - this.markers[this.markers.length - 1].canvasY;
    if (topGap > maxGap) insertY = Math.round(roi.y + topGap / 2);
    else if (botGap > maxGap) insertY = Math.round(this.markers[this.markers.length - 1].canvasY + botGap / 2);

    this.addMarkerAt(insertY);
  }

  adjustMinusOne() {
    if (this.markers.length > 0) {
      this._saveHistory();
      this.markers.pop();
      this.markers.forEach((m, idx) => (m.id = idx + 1));
      if (this.isFrozen) this.redrawFrozenCanvas();
      this._notifyChange();
    }
  }

  undo() {
    if (this.history.length > 0) {
      this.markers = this.history.pop();
      if (this.isFrozen) this.redrawFrozenCanvas();
      this._notifyChange();
    }
  }

  clearMarkers() {
    this._saveHistory();
    this.markers = [];
    if (this.isFrozen) this.redrawFrozenCanvas();
    this._notifyChange();
  }

  _saveHistory() {
    this.history.push(JSON.parse(JSON.stringify(this.markers)));
    if (this.history.length > 20) this.history.shift();
  }

  _notifyChange() {
    if (this.onMarkersChanged) {
      this.onMarkersChanged(this.markers.length, this.markers);
    }
  }

  /**
   * Diagnóstico de forma de onda 1D
   */
  drawWaveformToCanvas(targetCanvas, profileData, markers) {
    if (!targetCanvas || !profileData || profileData.length === 0) return;
    const ctx = targetCanvas.getContext('2d');
    const w = targetCanvas.width;
    const h = targetCanvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#07090d';
    ctx.fillRect(0, 0, w, h);

    // Cuadrícula
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 30) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 20) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    let minVal = Infinity, maxVal = -Infinity;
    for (let i = 0; i < profileData.length; i++) {
      if (profileData[i] < minVal) minVal = profileData[i];
      if (profileData[i] > maxVal) maxVal = profileData[i];
    }
    const range = (maxVal - minVal) || 1;

    // Curva de proyección
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const step = (w - 20) / profileData.length;
    for (let i = 0; i < profileData.length; i++) {
      const px = 10 + i * step;
      const normalized = (profileData[i] - minVal) / range;
      const py = h - 10 - normalized * (h - 20);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Puntos de picos
    const roi = this.getAbsoluteROI();
    ctx.fillStyle = '#22c55e';
    markers.forEach(m => {
      const off = m.canvasY - roi.y;
      if (off >= 0 && off < profileData.length) {
        const px = 10 + off * step;
        const normalized = (profileData[off] - minVal) / range;
        const py = h - 10 - normalized * (h - 20);
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  /**
   * Manejadores táctiles para arrastre del ROI y edición al congelar
   */
  _bindEvents() {
    const canvas = this.canvas;

    const getCanvasCoords = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: (clientX - rect.x) * scaleX,
        y: (clientY - rect.y) * scaleY
      };
    };

    const handleStart = (e) => {
      const coords = getCanvasCoords(e);
      const roi = this.getAbsoluteROI();

      // Verificar si tocó manija superior del ROI
      if (Math.abs(coords.y - roi.y) < 32 && coords.x >= roi.x - 20 && coords.x <= roi.x + roi.width + 20) {
        this.isDraggingTop = true;
        this.dragStartY = coords.y;
        this.initialRoi = { ...this.roiRelative };
        e.preventDefault();
        return;
      }

      // Verificar si tocó manija inferior del ROI
      if (Math.abs(coords.y - (roi.y + roi.height)) < 32 && coords.x >= roi.x - 20 && coords.x <= roi.x + roi.width + 20) {
        this.isDraggingBottom = true;
        this.dragStartY = coords.y;
        this.initialRoi = { ...this.roiRelative };
        e.preventDefault();
        return;
      }

      // Si está en modo congelado: editar marcadores al tocar
      if (this.isFrozen) {
        // Tocar sobre o cerca de un marcador existente para eliminarlo
        const touchTol = 18;
        const existingIdx = this.markers.findIndex(m => Math.abs(m.canvasY - coords.y) <= touchTol);
        if (existingIdx !== -1) {
          this.removeMarker(existingIdx);
          e.preventDefault();
          return;
        }

        // Tocar en espacio libre dentro del ROI para agregar una pieza
        if (coords.x >= roi.x && coords.x <= roi.x + roi.width &&
            coords.y >= roi.y && coords.y <= roi.y + roi.height) {
          this.addMarkerAt(coords.y);
          e.preventDefault();
        }
      }
    };

    const handleMove = (e) => {
      if (!this.isDraggingTop && !this.isDraggingBottom) return;
      const coords = getCanvasCoords(e);
      const dyRel = (coords.y - this.dragStartY) / this.canvas.height;

      if (this.isDraggingTop) {
        const newY = Math.max(0.02, Math.min(this.initialRoi.y + this.initialRoi.height - 0.05, this.initialRoi.y + dyRel));
        const newH = (this.initialRoi.y + this.initialRoi.height) - newY;
        this.roiRelative.y = newY;
        this.roiRelative.height = newH;
        if (this.isFrozen) this.redrawFrozenCanvas();
      } else if (this.isDraggingBottom) {
        const newH = Math.max(0.05, Math.min(0.98 - this.initialRoi.y, this.initialRoi.height + dyRel));
        this.roiRelative.height = newH;
        if (this.isFrozen) this.redrawFrozenCanvas();
      }
      e.preventDefault();
    };

    const handleEnd = () => {
      if (this.isDraggingTop || this.isDraggingBottom) {
        this.isDraggingTop = false;
        this.isDraggingBottom = false;
        if (this.onRoiChanged) {
          this.onRoiChanged(this.getAbsoluteROI());
        }
      }
    };

    canvas.addEventListener('touchstart', handleStart, { passive: false });
    canvas.addEventListener('touchmove', handleMove, { passive: false });
    canvas.addEventListener('touchend', handleEnd);
    canvas.addEventListener('touchcancel', handleEnd);

    canvas.addEventListener('mousedown', handleStart);
    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('mouseup', handleEnd);
  }
}

window.ROIViewer = ROIViewer;
