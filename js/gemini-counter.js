/**
 * gemini-counter.js - Motor 2: Conexión a Gemini Vision API (Tiempo Real)
 * Endpoint oficial: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}
 * Modelos soportados: gemini-2.5-flash (predeterminado) y gemini-1.5-flash.
 * Clave preconfigurada: AQ.Ab8RN6IRM-D_n4lzxdtXYpyuMj_SX_5gadSL3Mmuh1Px7CPJBQ
 */

class GeminiVisionCounter {
  static DEFAULT_API_KEY = 'AQ.Ab8RN6IRM-D_n4lzxdtXYpyuMj_SX_5gadSL3Mmuh1Px7CPJBQ';
  static DEFAULT_MODEL = 'gemini-2.5-flash';

  constructor() {
    this.storageKey = 'contador_gemini_api_key';
    this.modelStorageKey = 'contador_gemini_model';

    // Cargar clave guardada o usar la clave preconfigurada
    const savedKey = localStorage.getItem(this.storageKey);
    this.apiKey = (savedKey && savedKey.trim() !== '') ? savedKey.trim() : GeminiVisionCounter.DEFAULT_API_KEY;

    // Validar modelo vigente (estrictamente gemini-2.5-flash o gemini-1.5-flash)
    const savedModel = localStorage.getItem(this.modelStorageKey);
    if (savedModel === 'gemini-1.5-flash' || savedModel === 'gemini-2.5-flash') {
      this.model = savedModel;
    } else {
      this.model = GeminiVisionCounter.DEFAULT_MODEL; // gemini-2.5-flash
      localStorage.setItem(this.modelStorageKey, this.model);
    }

    this.isRequestInProgress = false;
  }

  setApiKey(key) {
    const trimmed = (key || '').trim();
    if (trimmed) {
      this.apiKey = trimmed;
      localStorage.setItem(this.storageKey, trimmed);
    } else {
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
    if (model === 'gemini-1.5-flash' || model === 'gemini-2.5-flash') {
      this.model = model;
    } else {
      this.model = GeminiVisionCounter.DEFAULT_MODEL;
    }
    localStorage.setItem(this.modelStorageKey, this.model);
  }

  /**
   * Extrae el recorte del ROI en Base64 JPEG optimizado para análisis inmediato
   * @param {HTMLVideoElement|HTMLCanvasElement} source - Video en vivo o canvas congelado
   * @param {Object} roi - { x, y, width, height }
   * @returns {string} Base64 sin encabezado data:image/jpeg;base64,
   */
  extractRoiBase64(source, roi) {
    const rx = Math.max(0, Math.round(roi.x));
    const ry = Math.max(0, Math.round(roi.y));
    const rw = Math.round(roi.width);
    const rh = Math.round(roi.height);

    const tempCanvas = document.createElement('canvas');
    // Escalar altura a max 720px para velocidad de transmisión sin pérdida de resolución de cantos
    const maxH = 720;
    const scale = rh > maxH ? (maxH / rh) : 1.0;
    tempCanvas.width = Math.round(rw * scale);
    tempCanvas.height = Math.round(rh * scale);

    const tCtx = tempCanvas.getContext('2d');
    tCtx.drawImage(
      source,
      rx, ry, rw, rh,
      0, 0, tempCanvas.width, tempCanvas.height
    );

    const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.90);
    return dataUrl.split(',')[1];
  }

  /**
   * Realiza la petición POST a la API de Gemini Vision
   * URL exacta: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}
   * @param {HTMLVideoElement|HTMLCanvasElement} source - Origen de imagen o video
   * @param {Object} roi - Región de interés
   * @param {string} gaugeName - Calibre seleccionado
   * @returns {Promise<Object>} { total_piezas, coordenadas_y, confianza }
   */
  async countSheetsLive(source, roi, gaugeName = 'Detección Automática') {
    if (this.isRequestInProgress) {
      throw new Error('Consulta previa a Gemini en proceso...');
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

      // Endpoint exacto: https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}
      const modelToUse = (this.model === 'gemini-1.5-flash') ? 'gemini-1.5-flash' : 'gemini-2.5-flash';
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${this.apiKey}`;

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

      console.log(`[GeminiVision] Enviando petición POST a: ${endpoint.split('?')[0]}?key=***`);

      let response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      // Si el modelo devuelve 404 o 503, intentar fallback automático entre gemini-2.5-flash y gemini-1.5-flash
      if (!response.ok && (response.status === 404 || response.status === 503)) {
        console.warn(`[GeminiVision] ${modelToUse} devolvió ${response.status}. Intentando fallback alternativo...`);
        const fallbackModel = (modelToUse === 'gemini-2.5-flash') ? 'gemini-1.5-flash' : 'gemini-2.5-flash';
        const fallbackEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${fallbackModel}:generateContent?key=${this.apiKey}`;
        try {
          const fallbackRes = await fetch(fallbackEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          });
          if (fallbackRes.ok) {
            response = fallbackRes;
          }
        } catch (e) {
          console.warn('[GeminiVision] Fallback falló:', e);
        }
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const errMsg = errorBody.error?.message || `Error HTTP ${response.status}`;
        throw new Error(`Gemini API (${modelToUse}): ${errMsg}`);
      }

      const json = await response.json();
      const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawText) {
        throw new Error('La respuesta de Gemini no contiene datos válidos.');
      }

      const parsed = JSON.parse(rawText);
      const totalPiezas = parseInt(parsed.total_piezas, 10) || 0;
      const coords = Array.isArray(parsed.coordenadas_y) ? parsed.coordenadas_y : [];
      const confianza = parsed.confianza || 'Media';

      return {
        total_piezas: totalPiezas,
        coordenadas_y: coords,
        confianza: confianza,
        modelUsed: modelToUse,
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
    const modelToUse = (this.model === 'gemini-1.5-flash') ? 'gemini-1.5-flash' : 'gemini-2.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${this.apiKey}`;

    const testBody = {
      contents: [{ parts: [{ text: 'Responde solo en JSON: {"status": "ok"}' }] }],
      generationConfig: { responseMimeType: 'application/json' }
    };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testBody)
      });

      if (res.ok) {
        return { success: true, message: `Conexión exitosa con ${modelToUse}` };
      } else {
        const err = await res.json().catch(() => ({}));
        return { success: false, message: err.error?.message || `Error HTTP ${res.status}` };
      }
    } catch (e) {
      return { success: false, message: e.message || 'Error de red o sin conexión' };
    }
  }
}

window.GeminiVisionCounter = GeminiVisionCounter;
