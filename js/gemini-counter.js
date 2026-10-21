/**
 * gemini-counter.js - Motor 2: Asistente en Tiempo Real con Gemini Vision API (Preconfigurado)
 * Ejecuta análisis en segundo plano sobre el fotograma del ROI en vivo.
 * API Key preconfigurada por defecto: AQ.Ab8RN6IRM-D_n4lzxdtXYpyuMj_SX_5gadSL3Mmuh1Px7CPJBQ
 */

class GeminiVisionCounter {
  static DEFAULT_API_KEY = 'AQ.Ab8RN6IRM-D_n4lzxdtXYpyuMj_SX_5gadSL3Mmuh1Px7CPJBQ';
  static DEFAULT_MODEL = 'gemini-2.5-flash';

  constructor() {
    this.storageKey = 'contador_gemini_api_key';
    this.modelStorageKey = 'contador_gemini_model';

    // Cargar clave de localStorage o usar la preconfigurada por defecto
    const savedKey = localStorage.getItem(this.storageKey);
    this.apiKey = savedKey && savedKey.trim() !== '' ? savedKey.trim() : GeminiVisionCounter.DEFAULT_API_KEY;
    this.model = localStorage.getItem(this.modelStorageKey) || GeminiVisionCounter.DEFAULT_MODEL;

    this.isRequestInProgress = false;
  }

  setApiKey(key) {
    const trimmed = (key || '').trim();
    if (trimmed) {
      this.apiKey = trimmed;
      localStorage.setItem(this.storageKey, trimmed);
    } else {
      // Revertir a la clave preconfigurada
      this.apiKey = GeminiVisionCounter.DEFAULT_API_KEY;
      localStorage.removeItem(this.storageKey);
    }
  }

  getApiKey() {
    return this.apiKey;
  }

  isUsingDefaultKey() {
    return this.apiKey === GeminiVisionCounter.DEFAULT_API_KEY;
  }

  setModel(model) {
    this.model = model;
    localStorage.setItem(this.modelStorageKey, model);
  }

  /**
   * Extrae un fotograma optimizado del ROI para enviar a Gemini Vision
   * @param {HTMLVideoElement|HTMLCanvasElement} source - Origen del video o canvas congelado
   * @param {Object} roi - { x, y, width, height }
   * @returns {string} Base64 JPEG sin el prefijo data:image/jpeg;base64,
   */
  extractRoiBase64(source, roi) {
    const rx = Math.max(0, Math.round(roi.x));
    const ry = Math.max(0, Math.round(roi.y));
    const rw = Math.round(roi.width);
    const rh = Math.round(roi.height);

    const tempCanvas = document.createElement('canvas');
    // Escalar moderadamente el ROI a max 640px de altura para envío ultrarrápido por red
    const maxH = 640;
    const scale = rh > maxH ? (maxH / rh) : 1.0;
    tempCanvas.width = Math.round(rw * scale);
    tempCanvas.height = Math.round(rh * scale);

    const tCtx = tempCanvas.getContext('2d');
    tCtx.drawImage(
      source,
      rx, ry, rw, rh,
      0, 0, tempCanvas.width, tempCanvas.height
    );

    const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.88);
    return dataUrl.split(',')[1];
  }

  /**
   * Envía el frame del ROI a Gemini 2.5 Flash con el prompt de visión industrial
   * @param {HTMLVideoElement|HTMLCanvasElement} source - Video o canvas
   * @param {Object} roi - Coordenadas del ROI
   * @param {string} gaugeName - Calibre seleccionado (ej. 'Calibre 14')
   * @returns {Promise<Object>} { total_piezas, coordenadas_y, confianza }
   */
  async countSheetsLive(source, roi, gaugeName = 'Detección Automática') {
    if (this.isRequestInProgress) {
      throw new Error('Ya hay una consulta a Gemini en curso');
    }

    this.isRequestInProgress = true;

    try {
      const base64Data = this.extractRoiBase64(source, roi);

      const prompt = `Eres un sistema experto de visión industrial. Analiza este fotograma en vivo del perfil de un empaque de láminas de acero inoxidable/aluminio. Calibre seleccionado: ${gaugeName}. Referencias: Cal 1/4" (~2 pzs), Cal 10 (~8 pzs), Cal 12 (~15 pzs), Cal 14 (~24 pzs), Cal 24 (~51 pzs), Cal 20 (~75 pzs).
Instrucciones:
1. Ignora el cartón corrugado (con ondas) arriba y abajo, la tarima de madera y las etiquetas.
2. Cuenta solo los cantos horizontales de las láminas metálicas.
3. Responde solo en JSON:
{
  "total_piezas": <entero>,
  "coordenadas_y": [<arreglo de decimales de 0.0 a 1.0 con la posición vertical de cada lámina>],
  "confianza": "Alta" | "Media" | "Baja"
}`;

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

      const requestBody = {
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: base64Data
                }
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1
        }
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const errMsg = errorBody.error?.message || `Error HTTP ${response.status}`;
        throw new Error(`Gemini API: ${errMsg}`);
      }

      const json = await response.json();
      const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawText) {
        throw new Error('Respuesta vacía de Gemini.');
      }

      const parsed = JSON.parse(rawText);
      const totalPiezas = parseInt(parsed.total_piezas, 10) || 0;
      const coords = Array.isArray(parsed.coordenadas_y) ? parsed.coordenadas_y : [];
      const confianza = parsed.confianza || 'Media';

      return {
        total_piezas: totalPiezas,
        coordenadas_y: coords,
        confianza: confianza,
        raw: parsed
      };
    } finally {
      this.isRequestInProgress = false;
    }
  }

  /**
   * Prueba de conectividad con la API
   */
  async testConnection() {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}?key=${this.apiKey}`;
    try {
      const res = await fetch(endpoint);
      if (res.ok) {
        return { success: true, message: `Conexión verificada con ${this.model}` };
      } else {
        const err = await res.json().catch(() => ({}));
        return { success: false, message: err.error?.message || `Error ${res.status}` };
      }
    } catch (e) {
      return { success: false, message: e.message || 'Error de red' };
    }
  }
}

window.GeminiVisionCounter = GeminiVisionCounter;
