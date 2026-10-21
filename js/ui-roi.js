/**
 * ui-roi.js - Gestión del ROI (Zona de Interés), Marcadores Visuales y Edición Interactiva
 * Dibuja la guía visual sobre la cámara, los marcadores verde neón sobre el canvas congelado,
 * y permite agregar/eliminar piezas tocando la pantalla o con botones +1 / -1.
 */

class ROIViewer {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.onMarkersChanged = options.onMarkersChanged || null;
    this.onRoiChanged = options.onRoiChanged || null;

    // ROI en coordenadas relativas (0.0 a 1.0) respecto al canvas
    this.roiRelative = {
      x: 0.25,
      y: 0.35,
      width: 0.50,
      height: 0.35
    };

    // Marcadores actuales: [{ id, canvasY, canvasX, label }]
    this.markers = [];
    this.history = []; // Para función Deshacer

    // Imagen congelada almacenada
    this.frozenImage = null;

    // Estado de interacción (arrastrar ROI o tocar marcador)
    this.isDraggingRoiTop = false;
    this.isDraggingRoiBottom = false;
    this.isDraggingRoiBox = false;
    this.dragStartY = 0;
    this.dragStartX = 0;
    this.initialRoi = null;

    this.neonColor = '#22c55e'; // Verde Neón industrial
    this.neonGlow = 'rgba(34, 197, 94, 0.6)';
    this.roiColor = '#00f0ff'; // Cyan industrial
    this.roiBorderWidth = 2.5;

    this._bindEvents();
  }

  /**
   * Obtiene las coordenadas del ROI en píxeles absolutos del canvas
   */
  getAbsoluteROI() {
    return {
      x: Math.round(this.roiRelative.x * this.canvas.width),
      y: Math.round(this.roiRelative.y * this.canvas.height),
      width: Math.round(this.roiRelative.width * this.canvas.width),
      height: Math.round(this.roiRelative.height * this.canvas.height)
    };
  }

  /**
   * Establece el ROI en coordenadas relativas
   */
  setRelativeROI(roi) {
    this.roiRelative = {
      x: Math.max(0.05, Math.min(0.85, roi.x)),
      y: Math.max(0.05, Math.min(0.85, roi.y)),
      width: Math.max(0.1, Math.min(0.9, roi.width)),
      height: Math.max(0.05, Math.min(0.9, roi.height))
    };
    this.redraw();
    if (this.onRoiChanged) {
      this.onRoiChanged(this.getAbsoluteROI());
    }
  }

  /**
   * Carga una imagen o canvas congelado para análisis
   */
  loadFrozenImage(imageSource) {
    this.frozenImage = imageSource;
    this.canvas.width = imageSource.width || imageSource.videoWidth;
    this.canvas.height = imageSource.height || imageSource.videoHeight;
    this.markers = [];
    this.history = [];
    this.redraw();
  }

  /**
   * Asigna la lista de marcadores detectados automáticamente
   */
  setMarkers(markerList) {
    this._saveHistory();
    this.markers = markerList.map((m, idx) => ({
      id: idx + 1,
      canvasY: m.canvasY,
      canvasX: m.canvasX || (this.getAbsoluteROI().x + this.getAbsoluteROI().width / 2)
    }));
    this.redraw();
    this._notifyChange();
  }

  /**
   * Agrega un marcador manual en una coordenada Y específica
   */
  addMarkerAt(canvasY) {
    this._saveHistory();
    const roi = this.getAbsoluteROI();
    const clampedY = Math.max(roi.y, Math.min(roi.y + roi.height, canvasY));

    this.markers.push({
      id: this.markers.length + 1,
      canvasY: clampedY,
      canvasX: roi.x + roi.width / 2
    });

    // Reordenar de arriba hacia abajo
    this.markers.sort((a, b) => a.canvasY - b.canvasY);
    this.markers.forEach((m, idx) => (m.id = idx + 1));

    this.redraw();
    this._notifyChange();
  }

  /**
   * Elimina un marcador por su ID o índice
   */
  removeMarker(index) {
    if (index >= 0 && index < this.markers.length) {
      this._saveHistory();
      this.markers.splice(index, 1);
      this.markers.forEach((m, idx) => (m.id = idx + 1));
      this.redraw();
      this._notifyChange();
    }
  }

  /**
   * Ajuste rápido +1 (agrega una lámina estimada en el espacio más amplio)
   */
  adjustPlusOne() {
    this._saveHistory();
    const roi = this.getAbsoluteROI();

    if (this.markers.length === 0) {
      this.addMarkerAt(roi.y + roi.height / 2);
      return;
    }

    if (this.markers.length === 1) {
      this.addMarkerAt(this.markers[0].canvasY + 25);
      return;
    }

    // Buscar el espacio vertical más grande entre marcadores consecutivos
    let maxGap = 0;
    let insertY = roi.y + roi.height / 2;

    for (let i = 0; i < this.markers.length - 1; i++) {
      const gap = this.markers[i + 1].canvasY - this.markers[i].canvasY;
      if (gap > maxGap) {
        maxGap = gap;
        insertY = Math.round(this.markers[i].canvasY + gap / 2);
      }
    }

    // Si el gap superior o inferior es mayor:
    const topGap = this.markers[0].canvasY - roi.y;
    const botGap = (roi.y + roi.height) - this.markers[this.markers.length - 1].canvasY;
    if (topGap > maxGap) {
      insertY = Math.round(roi.y + topGap / 2);
    } else if (botGap > maxGap) {
      insertY = Math.round(this.markers[this.markers.length - 1].canvasY + botGap / 2);
    }

    this.addMarkerAt(insertY);
  }

  /**
   * Ajuste rápido -1 (elimina el último o más ambiguo)
   */
  adjustMinusOne() {
    if (this.markers.length > 0) {
      this._saveHistory();
      this.markers.pop();
      this.markers.forEach((m, idx) => (m.id = idx + 1));
      this.redraw();
      this._notifyChange();
    }
  }

  /**
   * Limpia todos los marcadores
   */
  clearMarkers() {
    this._saveHistory();
    this.markers = [];
    this.redraw();
    this._notifyChange();
  }

  /**
   * Deshace la última modificación
   */
  undo() {
    if (this.history.length > 0) {
      this.markers = this.history.pop();
      this.redraw();
      this._notifyChange();
    }
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
   * Redibuja la imagen congelada, el cuadro del ROI y las líneas verde neón
   */
  redraw() {
    if (!this.canvas) return;
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    ctx.clearRect(0, 0, cw, ch);

    // 1. Dibujar imagen de fondo si existe
    if (this.frozenImage) {
      ctx.drawImage(this.frozenImage, 0, 0, cw, ch);
    }

    const roi = this.getAbsoluteROI();

    // 2. Oscurecer el área exterior al ROI para enfocar la atención
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    // Arriba
    ctx.fillRect(0, 0, cw, roi.y);
    // Abajo
    ctx.fillRect(0, roi.y + roi.height, cw, ch - (roi.y + roi.height));
    // Izquierda
    ctx.fillRect(0, roi.y, roi.x, roi.height);
    // Derecha
    ctx.fillRect(roi.x + roi.width, roi.y, cw - (roi.x + roi.width), roi.height);
    ctx.restore();

    // 3. Dibujar marco del ROI con acentos industriales
    ctx.save();
    ctx.strokeStyle = this.roiColor;
    ctx.lineWidth = this.roiBorderWidth;
    ctx.strokeRect(roi.x, roi.y, roi.width, roi.height);

    // Esquinas reforzadas estilo visor técnico
    const cornerSize = Math.min(24, Math.round(roi.width * 0.1));
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#eab308'; // Amarillo seguridad industrial

    // Top-Left
    ctx.beginPath();
    ctx.moveTo(roi.x, roi.y + cornerSize);
    ctx.lineTo(roi.x, roi.y);
    ctx.lineTo(roi.x + cornerSize, roi.y);
    ctx.stroke();

    // Top-Right
    ctx.beginPath();
    ctx.moveTo(roi.x + roi.width - cornerSize, roi.y);
    ctx.lineTo(roi.x + roi.width, roi.y);
    ctx.lineTo(roi.x + roi.width, roi.y + cornerSize);
    ctx.stroke();

    // Bottom-Left
    ctx.beginPath();
    ctx.moveTo(roi.x, roi.y + roi.height - cornerSize);
    ctx.lineTo(roi.x, roi.y + roi.height);
    ctx.lineTo(roi.x + cornerSize, roi.y + roi.height);
    ctx.stroke();

    // Bottom-Right
    ctx.beginPath();
    ctx.moveTo(roi.x + roi.width - cornerSize, roi.y + roi.height);
    ctx.lineTo(roi.x + roi.width, roi.y + roi.height);
    ctx.lineTo(roi.x + roi.width, roi.y + roi.height - cornerSize);
    ctx.stroke();

    // Manijas de ajuste superior e inferior
    ctx.fillStyle = '#eab308';
    // Manija superior
    ctx.fillRect(roi.x + roi.width / 2 - 25, roi.y - 7, 50, 14);
    // Manija inferior
    ctx.fillRect(roi.x + roi.width / 2 - 25, roi.y + roi.height - 7, 50, 14);

    // Texto guía del ROI
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = '#eab308';
    ctx.fillText('▲ EXCLUIR CARTÓN SUPERIOR', roi.x + 8, Math.max(16, roi.y - 12));
    ctx.fillText('▼ EXCLUIR CARTÓN INFERIOR', roi.x + 8, Math.min(ch - 8, roi.y + roi.height + 18));
    ctx.restore();

    // 4. Dibujar Marcadores y Líneas Verde Neón sobre cada lámina detectada
    ctx.save();
    this.markers.forEach((marker) => {
      const my = marker.canvasY;
      const lx1 = roi.x + 4;
      const lx2 = roi.x + roi.width - 4;

      // Resplandor de Neón (Glow)
      ctx.shadowColor = this.neonColor;
      ctx.shadowBlur = 8;
      ctx.strokeStyle = this.neonColor;
      ctx.lineWidth = 2.5;

      // Línea horizontal que cruza el canto de la lámina
      ctx.beginPath();
      ctx.moveTo(lx1, my);
      ctx.lineTo(lx2, my);
      ctx.stroke();

      // Punto central indicador
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(marker.canvasX, my, 4, 0, Math.PI * 2);
      ctx.fill();

      // Etiqueta numérica a la derecha
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(10, 12, 16, 0.85)';
      ctx.fillRect(lx2 - 34, my - 9, 32, 18);
      ctx.strokeStyle = this.neonColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(lx2 - 34, my - 9, 32, 18);

      ctx.fillStyle = this.neonColor;
      ctx.font = 'bold 11px system-ui, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${marker.id}`, lx2 - 18, my);
    });
    ctx.restore();
  }

  /**
   * Dibuja el gráfico de forma de onda (waveform) de proyección de brillo
   * en un canvas secundario de diagnóstico
   */
  drawWaveformToCanvas(targetCanvas, profileData, markers) {
    if (!targetCanvas || !profileData || profileData.length === 0) return;
    const ctx = targetCanvas.getContext('2d');
    const w = targetCanvas.width;
    const h = targetCanvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, w, h);

    // Cuadrícula técnica
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Normalizar datos del perfil
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = 0; i < profileData.length; i++) {
      if (profileData[i] < minVal) minVal = profileData[i];
      if (profileData[i] > maxVal) maxVal = profileData[i];
    }
    const range = (maxVal - minVal) || 1;

    // Dibujar curva de señal vertical (orientada horizontalmente para fácil lectura)
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

    // Dibujar marcadores de picos detectados sobre la señal
    const roi = this.getAbsoluteROI();
    ctx.fillStyle = '#22c55e';
    markers.forEach(m => {
      const offsetInRoi = m.canvasY - roi.y;
      if (offsetInRoi >= 0 && offsetInRoi < profileData.length) {
        const px = 10 + offsetInRoi * step;
        const normalized = (profileData[offsetInRoi] - minVal) / range;
        const py = h - 10 - normalized * (h - 20);

        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  /**
   * Manejadores de interacción táctil y ratón para edición directa sobre el Canvas
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

      // Verificar si tocó la manija superior del ROI
      if (Math.abs(coords.y - roi.y) < 25 && coords.x >= roi.x && coords.x <= roi.x + roi.width) {
        this.isDraggingRoiTop = true;
        this.dragStartY = coords.y;
        this.initialRoi = { ...this.roiRelative };
        e.preventDefault();
        return;
      }

      // Verificar si tocó la manija inferior del ROI
      if (Math.abs(coords.y - (roi.y + roi.height)) < 25 && coords.x >= roi.x && coords.x <= roi.x + roi.width) {
        this.isDraggingRoiBottom = true;
        this.dragStartY = coords.y;
        this.initialRoi = { ...this.roiRelative };
        e.preventDefault();
        return;
      }

      // Si tocó sobre o muy cerca de un marcador existente (dentro de 14px), eliminarlo
      const touchTolerance = 14;
      const existingIdx = this.markers.findIndex(m => Math.abs(m.canvasY - coords.y) <= touchTolerance);

      if (existingIdx !== -1) {
        this.removeMarker(existingIdx);
        e.preventDefault();
        return;
      }

      // Si tocó dentro del ROI en espacio libre, agregar una nueva pieza en esa coordenada Y
      if (coords.x >= roi.x && coords.x <= roi.x + roi.width &&
          coords.y >= roi.y && coords.y <= roi.y + roi.height) {
        this.addMarkerAt(coords.y);
        e.preventDefault();
      }
    };

    const handleMove = (e) => {
      if (!this.isDraggingRoiTop && !this.isDraggingRoiBottom) return;
      const coords = getCanvasCoords(e);
      const dyRel = (coords.y - this.dragStartY) / this.canvas.height;

      if (this.isDraggingRoiTop) {
        const newY = Math.max(0.02, Math.min(this.initialRoi.y + this.initialRoi.height - 0.05, this.initialRoi.y + dyRel));
        const newH = (this.initialRoi.y + this.initialRoi.height) - newY;
        this.roiRelative.y = newY;
        this.roiRelative.height = newH;
        this.redraw();
      } else if (this.isDraggingRoiBottom) {
        const newH = Math.max(0.05, Math.min(1.0 - this.initialRoi.y, this.initialRoi.height + dyRel));
        this.roiRelative.height = newH;
        this.redraw();
      }
      e.preventDefault();
    };

    const handleEnd = () => {
      if (this.isDraggingRoiTop || this.isDraggingRoiBottom) {
        this.isDraggingRoiTop = false;
        this.isDraggingRoiBottom = false;
        if (this.onRoiChanged) {
          this.onRoiChanged(this.getAbsoluteROI());
        }
      }
    };

    // Eventos Táctiles
    canvas.addEventListener('touchstart', handleStart, { passive: false });
    canvas.addEventListener('touchmove', handleMove, { passive: false });
    canvas.addEventListener('touchend', handleEnd);
    canvas.addEventListener('touchcancel', handleEnd);

    // Eventos de Ratón (para desarrollo en PC o laptops industriales)
    canvas.addEventListener('mousedown', handleStart);
    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('mouseup', handleEnd);
  }
}

// Exportar globalmente
window.ROIViewer = ROIViewer;
