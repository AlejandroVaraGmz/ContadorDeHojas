/**
 * camera.js - Control Avanzado de Cámaras (Exclusivo Cámaras Traseras)
 * Transmisión de Video en Vivo a 30 FPS en Full HD con selector dinámico de lentes traseros.
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

  // Palabras clave estrictas para descartar cámaras frontales / selfie
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
   * 1. Inicia el stream en vivo forzando cámara trasera en Full HD y 30 FPS
   */
  async startInitialCamera() {
    this.stopCurrentStream();

    const strictConstraints = {
      video: {
        facingMode: { exact: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      },
      audio: false
    };

    try {
      console.log('[Camera] Iniciando cámara trasera con restricción estricta (Full HD @ 30 FPS)...');
      const stream = await navigator.mediaDevices.getUserMedia(strictConstraints);
      await this._attachStream(stream);
      await this.enumerateAndFilterRearCameras();
      return true;
    } catch (err) {
      console.warn('[Camera] Falló restricción exacta de environment:', err.name, err.message);

      // Fallback a facingMode environment sin exact
      try {
        console.log('[Camera] Fallback con facingMode "environment"...');
        const fallbackConstraints = {
          video: {
            facingMode: "environment",
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 }
          },
          audio: false
        };
        const stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
        await this._attachStream(stream);
        await this.enumerateAndFilterRearCameras();
        return true;
      } catch (fallbackErr) {
        // Fallback genérico para PC / pruebas locales
        try {
          console.warn('[Camera] Fallback genérico para entorno de pruebas...');
          const genericStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }
          });
          await this._attachStream(genericStream);
          await this.enumerateAndFilterRearCameras();
          return true;
        } catch (finalErr) {
          console.error('[Camera] Error total al acceder a cámara:', finalErr);
          if (this.onError) {
            this.onError('No se pudo acceder a la cámara trasera. Por favor concede permisos en el navegador.', finalErr);
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

    if (this.activeTrack && typeof this.activeTrack.getCapabilities === 'function') {
      this.capabilities = this.activeTrack.getCapabilities();
    } else {
      this.capabilities = {};
    }

    await new Promise((resolve) => {
      this.videoElement.onloadedmetadata = () => {
        this.videoElement.play().then(resolve).catch(resolve);
      };
    });
  }

  /**
   * 2. Lista y filtra cámaras descartando TODAS las frontales
   */
  async enumerateAndFilterRearCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');

      // Filtro estricto anti-frontales
      const rearOnly = videoDevices.filter(device => {
        const label = (device.label || '').toLowerCase();
        const isFront = CameraManager.FRONT_FILTER_KEYWORDS.some(kw => label.includes(kw));
        return !isFront;
      });

      // Mapear lentes traseros con etiquetas legibles
      this.rearCameras = rearOnly.map((device, index) => {
        let label = device.label || `Cámara Trasera ${index + 1}`;
        const lower = label.toLowerCase();

        if (lower.includes('macro')) {
          label = `🔍 Macro (${device.label})`;
        } else if (lower.includes('ultra') || lower.includes('wide') || lower.includes('gran')) {
          label = `🌐 Gran Angular (${device.label})`;
        } else if (lower.includes('tele') || lower.includes('zoom')) {
          label = `🔭 Telefoto (${device.label})`;
        } else if (lower.includes('back') || lower.includes('rear') || lower.includes('0') || lower.includes('main')) {
          label = `📷 Principal (${device.label})`;
        } else if (!device.label) {
          label = `📷 Lente Trasero ${index + 1}`;
        }

        return {
          deviceId: device.deviceId,
          label: label,
          rawLabel: device.label,
          groupId: device.groupId
        };
      });

      console.log('[Camera] Lentes traseros disponibles:', this.rearCameras);

      const currentSettings = this.activeTrack ? this.activeTrack.getSettings() : {};
      this.activeDeviceId = currentSettings.deviceId || (this.rearCameras[0] ? this.rearCameras[0].deviceId : null);

      if (this.onCamerasDiscovered) {
        this.onCamerasDiscovered(this.rearCameras, this.activeDeviceId);
      }
    } catch (err) {
      console.error('[Camera] Error al enumerar cámaras:', err);
    }
  }

  /**
   * 3. Cambia en vivo al lente trasero seleccionado por su deviceId exacto
   */
  async selectCameraByDeviceId(deviceId) {
    if (!deviceId) return;
    this.stopCurrentStream();

    const constraints = {
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      },
      audio: false
    };

    try {
      console.log(`[Camera] Cambiando en vivo a lente deviceId: ${deviceId}`);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      await this._attachStream(stream);
      this.activeDeviceId = deviceId;
      return true;
    } catch (err) {
      console.warn('[Camera] Falló cambio con deviceId exacto:', err);
      return this.startInitialCamera();
    }
  }

  /**
   * Conmuta la linterna / flash trasero
   */
  async toggleTorch() {
    if (!this.activeTrack) return false;
    const caps = typeof this.activeTrack.getCapabilities === 'function' ? this.activeTrack.getCapabilities() : {};

    if (!caps.torch) {
      console.warn('[Camera] La linterna no es soportada en este lente');
      return false;
    }

    try {
      this.isTorchOn = !this.isTorchOn;
      await this.activeTrack.applyConstraints({
        advanced: [{ torch: this.isTorchOn }]
      });
      return this.isTorchOn;
    } catch (err) {
      console.error('[Camera] Error linterna:', err);
      this.isTorchOn = false;
      return false;
    }
  }

  /**
   * Captura el fotograma actual a resolución completa en un elemento Canvas
   */
  captureFrame() {
    if (!this.videoElement || this.videoElement.videoWidth === 0) {
      throw new Error('El stream de video aún no está listo.');
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

window.CameraManager = CameraManager;
