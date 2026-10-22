/**
 * gemini-counter.js - Motor 2: Conexión a Gemini Vision API (Tiempo Real)
 * Endpoint: https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}
 *
 * NOTA: gemini-2.5-flash y gemini-1.5-flash ya NO están disponibles para esta cuenta
 * (la API responde 404 "no longer available to new users"). El modelo vigente
 * recomendado por la propia API es gemini-3.8-flash. Si un modelo responde 404/429/503
 * se prueba automáticamente el siguiente de la lista MODEL_CHAIN.
 */

class GeminiVisionCounter {
  static DEFAULT_API_KEY = 'AQ.Ab8RN6IRM-D_n4lzxdtXYpyuMj_SX_5gadSL3Mmuh1Px7CPJBQ';

  // Modelos vigentes en orden de preferencia (verificados contra ListModels de esta clave)
  static MODEL_CHAIN = [
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
    'gemini-3.5-flash'
  ];
  static DEFAULT_MODEL = 'gemini-3.8-flash';

  constructor() {
    this.storageKey = 'contador_gemini_api_key';
    this.modelStorageKey = 'contador_gemini_model';

    const savedKey = localStorage.getItem(this.storageKey);
    this.apiKey = (savedKey && savedKey.trim() !== '') ? savedKey.trim() : GeminiVisionCounter.DEFAULT_API_KEY;

    // Si en localStorage quedó un modelo obsoleto (ej. gemini-2.5-flash), se descarta y se migra
    const savedModel = localStorage.getItem(this.modelStorageKey);
    if (savedModel && GeminiVisionCounter.MODEL_CHAIN.includes(savedModel)) {
      this.model = savedModel;
    } else {
      this.model = GeminiVisionCounter.DEFAULT_MODEL;
      localStorage.setItem(this.modelStorageKey, this.model);
    }

    this.lastModelUsed = this.model;
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
    this.model = GeminiVisionCounter.MODEL_CHAIN.includes(model) ? model : GeminiVisionCounter.DEFAULT_MODEL;
    localStorage.setItem(this.modelStorageKey, this.model);
  }

  /**
   * Lista de modelos a intentar: primero el elegido, luego el resto de la cadena
   */
  _modelsToTry() {
    const rest = GeminiVisionCounter.MODEL_CHAIN.filter(m => m !== this.model);
    return [this.model, ...rest];
  }

  _endpoint(model) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
  }

  /**
   * POST con reintento automático entre modelos ante 404 / 429 / 500 / 503
   */
  async _postWithFallback(requestBody) {
    let lastError = null;

    for (const model of this._modelsToTry()) {
      try {
        console.log(`[GeminiVision] POST -> models/${model}:generateContent`);
        const response = await fetch(this._endpoint(model), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (response.ok) {
          this.lastModelUsed = model;
          return { response, model };
        }

        const errorBody = await response.json().catch(() => ({}));
        const msg = errorBody.error?.message || `Error HTTP ${response.status}`;
        lastError = new Error(`Gemini API (${model}): ${msg}`);

        // Errores recuperables: probar el siguiente modelo
        if ([404, 429, 500, 503].includes(response.status)) {
          console.warn(`[GeminiVision] ${model} -> ${response.status}. Probando siguiente modelo...`);
          continue;
        }
        // Errores no recuperables (400 clave inválida, 403, etc.)
        throw lastError;
      } catch (e) {
        if (e === lastError) throw e;
        // Error de red: reintentar con el siguiente
        lastError = e;
        console.warn(`[GeminiVision] Error de red con ${model}:`, e);
      }
    }

    throw lastError || new Error('No hay modelos de Gemini disponibles.');
  }

  /**
   * Extrae el recorte del ROI en Base64 JPEG
   */
  extractRoiBase64(source, roi) {
    const rx = Math.max(0, Math.round(roi.x));
    const ry = Math.max(0, Math.round(roi.y));
    const rw = Math.round(roi.width);
    const rh = Math.round(roi.height);

    const tempCanvas = document.createElement('canvas');
    const maxH = 720;
    const scale = rh > maxH ? (maxH / rh) : 1.0;
    tempCanvas.width = Math.round(rw * scale);
    tempCanvas.height = Math.round(rh * scale);

    const tCtx = tempCanvas.getContext('2d');
    tCtx.drawImage(source, rx, ry, rw, rh, 0, 0, tempCanvas.width, tempCanvas.height);

    const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.90);
    return dataUrl.split(',')[1];
  }

  /**
   * Envía el recorte del ROI a Gemini y devuelve { total_piezas, coordenadas_y, confianza }
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

      const requestBody = {
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { mimeType: 'image/jpeg', data: base64Data } }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1
        }
      };

      const { response, model } = await this._postWithFallback(requestBody);

      const json = await response.json();
      // Algunos modelos con razonamiento devuelven varias partes; tomamos la primera con texto
      const parts = json.candidates?.[0]?.content?.parts || [];
      const rawText = (parts.find(p => typeof p.text === 'string' && !p.thought) || {}).text;

      if (!rawText) {
        throw new Error('La respuesta de Gemini no contiene datos válidos.');
      }

      const parsed = JSON.parse(rawText);
      const totalPiezas = parseInt(parsed.total_piezas, 10) || 0;
      const coords = (Array.isArray(parsed.coordenadas_y) ? parsed.coordenadas_y : [])
        .map(Number)
        .filter(v => Number.isFinite(v) && v >= 0 && v <= 1);
      const confianza = parsed.confianza || 'Media';

      return {
        total_piezas: totalPiezas,
        coordenadas_y: coords,
        confianza: confianza,
        modelUsed: model,
        raw: parsed
      };
    } finally {
      this.isRequestInProgress = false;
    }
  }

  /**
   * Prueba de conectividad (usa la misma cadena de modelos)
   */
  async testConnection() {
    const testBody = {
      contents: [{ parts: [{ text: 'Responde solo en JSON: {"status": "ok"}' }] }],
      generationConfig: { responseMimeType: 'application/json' }
    };

    try {
      const { model } = await this._postWithFallback(testBody);
      return { success: true, message: `Conexión exitosa con ${model}` };
    } catch (e) {
      return { success: false, message: e.message || 'Error de red o sin conexión' };
    }
  }
}

window.GeminiVisionCounter = GeminiVisionCounter;
