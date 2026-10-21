/**
 * camera.js - Control Avanzado de Cámaras (Exclusivo Cámaras Traseras)
 * Gestiona el acceso exclusivo a cámaras traseras, filtrado anti-frontales,
 * selector de lentes (Macro, Principal, Gran Angular, Telefoto), linterna y zoom.
 */

class CameraManager {
  constructor(videoElement, onCamerasDiscovered, onError) {
    this.videoElement = videoElement;
    this.onCamerasDiscovered = onCamerasDiscovered;
    this.onError = onError;
    this.currentStream = null;
    this.activeTrack = null;
    this.rearCameras = [];
    this.activeDeviceId = null;
    this.isTorchOn = false;
    this.capabilities = {};
  }

  // Lista estricta de palabras clave para descartar cámaras frontales
  static FRONT_FILTER_KEYWORDS = [
    'front',
    'frontal',
    'user',
    'selfie',
    'facetime',
    'delantera',
    'anterior',
    'face'
  ];

  /**
   * 1. Inicializa la cámara trasera forzada en alta resolución
   * usando facingMode: { exact: "environment" }
   */
  async startInitialCamera() {
    this.stopCurrentStream();

    // Requisito: inicial con { video: { facingMode: { exact: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } }
    const strictConstraints = {
      video: {
        facingMode: { exact: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    };

    try {
      console.log('[Camera] Solicitando cámara trasera estricta...');
      const stream = await navigator.mediaDevices.getUserMedia(strictConstraints);
      await this._attachStream(stream);
      await this.enumerateAndFilterRearCameras();
      return true;
    } catch (err) {
      console.warn('[Camera] Falló restricción exacta de environment:', err.name, err.message);

      // Si falla por 'exact' (ej. en escritorio de desarrollo o Android con etiquetas específicas),
      // intentamos fallback a facingMode: "environment" sin exact
      try {
        console.log('[Camera] Intentando fallback con facingMode "environment" no exacto...');
        const fallbackConstraints = {
          video: {
            facingMode: "environment",
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        };
        const stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
        await this._attachStream(stream);
        await this.enumerateAndFilterRearCameras();
        return true;
      } catch (fallbackErr) {
        // Fallback genérico para desarrollo en PC / cámaras web
        try {
          console.warn('[Camera] Fallback genérico a cualquier cámara disponible...');
          const genericStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1920 }, height: { ideal: 1080 } }
          });
          await this._attachStream(genericStream);
          await this.enumerateAndFilterRearCameras();
          return true;
        } catch (finalErr) {
          console.error('[Camera] Error total al acceder a la cámara:', finalErr);
          if (this.onError) {
            this.onError('No se pudo acceder a la cámara. Verifique los permisos en el navegador.', finalErr);
          }
          return false;
        }
      }
    }
  }

  /**
   * Conecta el MediaStream al elemento <video>
   */
  async _attachStream(stream) {
    this.currentStream = stream;
    this.activeTrack = stream.getVideoTracks()[0];
    this.videoElement.srcObject = stream;

    // Guardar capacidades (zoom, torch, focus)
    if (this.activeTrack && typeof this.activeTrack.getCapabilities === 'function') {
      this.capabilities = this.activeTrack.getCapabilities();
    } else {
      this.capabilities = {};
    }

    // Esperar a que el video comience a reproducirse
    await new Promise((resolve) => {
      this.videoElement.onloadedmetadata = () => {
        this.videoElement.play().then(resolve).catch(resolve);
      };
    });
  }

  /**
   * 2. Enumera los dispositivos y aplica FILTRO ESTRICTO ANTI-FRONTALES
   */
  async enumerateAndFilterRearCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');

      console.log('[Camera] Total dispositivos de video detectados:', videoDevices.length, videoDevices);

      // Filtro estricto anti-frontales: descartar si el label contiene palabras prohibidas
      const rearOnly = videoDevices.filter(device => {
        const label = (device.label || '').toLowerCase();
        const isFrontal = CameraManager.FRONT_FILTER_KEYWORDS.some(kw => label.includes(kw));
        return !isFrontal;
      });

      // Mapear con etiquetas claras de lentes
      this.rearCameras = rearOnly.map((device, index) => {
        let prettyLabel = device.label || `Cámara Trasera ${index + 1}`;
        const lower = prettyLabel.toLowerCase();

        // Categorizar lentes traseros comunes
        if (lower.includes('macro')) {
          prettyLabel = `🔍 Lente Macro (${device.label})`;
        } else if (lower.includes('ultra') || lower.includes('wide') || lower.includes('gran')) {
          prettyLabel = `🌐 Lente Gran Angular (${device.label})`;
        } else if (lower.includes('tele') || lower.includes('zoom')) {
          prettyLabel = `🔭 Lente Telefoto (${device.label})`;
        } else if (lower.includes('back') || lower.includes('rear') || lower.includes('trasera') || lower.includes('0')) {
          prettyLabel = `📷 Lente Principal (${device.label})`;
        } else if (!device.label) {
          prettyLabel = `📷 Lente Trasero ${index + 1}`;
        }

        return {
          deviceId: device.deviceId,
          label: prettyLabel,
          rawLabel: device.label,
          groupId: device.groupId
        };
      });

      console.log('[Camera] Cámaras traseras filtradas:', this.rearCameras);

      // Determinar cámara activa
      const currentTrackSettings = this.activeTrack ? this.activeTrack.getSettings() : {};
      this.activeDeviceId = currentTrackSettings.deviceId || (this.rearCameras[0] ? this.rearCameras[0].deviceId : null);

      if (this.onCamerasDiscovered) {
        this.onCamerasDiscovered(this.rearCameras, this.activeDeviceId);
      }
    } catch (err) {
      console.error('[Camera] Error al enumerar cámaras traseras:', err);
    }
  }

  /**
   * 3. Cambiar a un lente trasero específico usando su deviceId exacto
   */
  async selectCameraByDeviceId(deviceId) {
    if (!deviceId) return;
    this.stopCurrentStream();

    const constraints = {
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    };

    try {
      console.log(`[Camera] Cambiando a lente deviceId: ${deviceId}`);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      await this._attachStream(stream);
      this.activeDeviceId = deviceId;
      return true;
    } catch (err) {
      console.warn('[Camera] Falló cambio con deviceId exacto:', err);
      // Fallback a facingMode environment
      return this.startInitialCamera();
    }
  }

  /**
   * Control de Linterna / Flashlight (útil en almacenes con iluminación tenue)
   */
  async toggleTorch() {
    if (!this.activeTrack) return false;
    const caps = typeof this.activeTrack.getCapabilities === 'function' ? this.activeTrack.getCapabilities() : {};

    if (!caps.torch) {
      console.warn('[Camera] La linterna (torch) no es soportada por este lente');
      return false;
    }

    try {
      this.isTorchOn = !this.isTorchOn;
      await this.activeTrack.applyConstraints({
        advanced: [{ torch: this.isTorchOn }]
      });
      return this.isTorchOn;
    } catch (err) {
      console.error('[Camera] Error al conmutar linterna:', err);
      this.isTorchOn = false;
      return false;
    }
  }

  /**
   * Control de Zoom digital o de lente
   */
  async setZoom(zoomLevel) {
    if (!this.activeTrack) return;
    const caps = typeof this.activeTrack.getCapabilities === 'function' ? this.activeTrack.getCapabilities() : {};
    if (caps.zoom) {
      const min = caps.zoom.min || 1;
      const max = caps.zoom.max || 1;
      const clamped = Math.min(Math.max(zoomLevel, min), max);
      try {
        await this.activeTrack.applyConstraints({
          advanced: [{ zoom: clamped }]
        });
      } catch (err) {
        console.warn('[Camera] No se pudo aplicar zoom:', err);
      }
    }
  }

  /**
   * Captura un fotograma a resolución nativa en un elemento Image/Canvas
   */
  captureFrame() {
    if (!this.videoElement || this.videoElement.videoWidth === 0) {
      throw new Error('El video aún no está listo para capturar.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = this.videoElement.videoWidth;
    canvas.height = this.videoElement.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(this.videoElement, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  stopCurrentStream() {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      this.currentStream = null;
      this.activeTrack = null;
    }
    this.isTorchOn = false;
  }
}

// Exportar globalmente para uso en navegador
window.CameraManager = CameraManager;
