/**
 * gemini-counter.js - Modo B: Integración con API de Visión IA (Gemini Vision)
 * Permite realizar conteo asistido por IA multimodal para calibres ultra delgados
 * o casos complejos con empaques deformados.
 */

class GeminiVisionCounter {
  constructor() {
    this.storageKey = 'contador_gemini_api_key';
    this.modelStorageKey = 'contador_gemini_model';
    this.apiKey = localStorage.getItem(this.storageKey) || '';
    this.model = localStorage.getItem(this.modelStorageKey) || 'gemini-2.5-flash';
  }

  setApiKey(key) {
    this.apiKey = (key || '').trim();
    if (this.apiKey) {
      localStorage.setItem(this.storageKey, this.apiKey);
    } else {
      localStorage.removeItem(this.storageKey);
    }
  }

  getApiKey() {
    return this.apiKey;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.length > 10);
  }

  setModel(model) {
    this.model = model;
    localStorage.setItem(this.modelStorageKey, model);
  }

  /**
   * Envía la imagen recortada del ROI o la imagen completa a Gemini Vision
   * @param {HTMLCanvasElement} roiCanvas - Canvas con la imagen del área de interés
   * @param {string} gaugeName - Nombre del calibre seleccionado (ej. "Calibre 14")
   * @param {Object} contextInfo - Información auxiliar (ej. altura en píxeles)
   * @returns {Promise<Object>} { count, confidence, explanation, markers, rawResponse }
   */
  async countSheetsWithGemini(roiCanvas, gaugeName = 'Detección Automática', contextInfo = {}) {
    if (!this.isConfigured()) {
      throw new Error('API Key de Gemini no configurada. Ingrésela en los Ajustes (⚙️).');
    }

    // Convertir canvas a JPEG Base64
    const dataUrl = roiCanvas.toDataURL('image/jpeg', 0.92);
    const base64Data = dataUrl.split(',')[1];

    const prompt = `
Eres un inspector industrial de control de calidad y visión artificial especializado en metalurgia.
Analiza con máxima precisión esta fotografía del canto de un paquete de láminas/chapas de acero inoxidable o aluminio apiladas.

OBJETIVO CRÍTICO:
Contar el NÚMERO EXACTO de láminas metálicas individuales apiladas una sobre otra.

REGLAS DE INSPECCIÓN ESTRICTAS:
1. Cuenta ÚNICAMENTE láminas metálicas de acero o aluminio (cantos brillantes o gris metálico con ranuras oscuras entre ellas).
2. EXCLUYE COMPLETAMENTE las ondas del cartón corrugado (flautas sinusoidales marrones/cartón Kraft) en la parte superior e inferior.
3. EXCLUYE tarimas de madera, etiquetas adhesivas de papel blanco, flejes plásticos y rebordes de cartón protector.
4. Calibre de referencia esperado: "${gaugeName}".
5. Para cada lámina detectada, proporciona su posición vertical normalizada ('y_pct') como un porcentaje del 0 al 100 de arriba a abajo de esta imagen.

RESPONDE OBLIGATORIAMENTE EN FORMATO JSON ESTRICTO CON ESTA ESTRUCTURA:
{
  "sheet_count": <número entero exacto de láminas>,
  "confidence": "high" | "medium" | "low",
  "calibre_estimated": "<calibre estimado>",
  "y_positions_normalized": [<array de números entre 0 y 100 indicando la altura vertical de cada lámina>],
  "cardboard_top_excluded": true | false,
  "cardboard_bottom_excluded": true | false,
  "explanation": "<explicación técnica concisa en español del conteo realizado>"
}
`;

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

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const errMsg = errorBody.error?.message || `Error HTTP ${response.status}: ${response.statusText}`;
        throw new Error(`Error en API de Gemini: ${errMsg}`);
      }

      const json = await response.json();
      const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawText) {
        throw new Error('La respuesta de Gemini no contiene candidatos válidos.');
      }

      const parsed = JSON.parse(rawText);
      const count = parseInt(parsed.sheet_count, 10) || 0;

      // Mapear posiciones porcentuales a coordenadas en el canvas del ROI
      const roiHeight = roiCanvas.height;
      const markers = (parsed.y_positions_normalized || []).map((pct, idx) => {
        const roiY = Math.round((pct / 100) * roiHeight);
        return {
          id: idx + 1,
          roiY: roiY,
          confidence: parsed.confidence
        };
      });

      return {
        count: count,
        confidence: parsed.confidence || 'medium',
        explanation: parsed.explanation || 'Conteo completado con Gemini Vision.',
        calibreEstimated: parsed.calibre_estimated,
        markers: markers,
        raw: parsed
      };
    } catch (err) {
      console.error('[GeminiVision] Error al procesar:', err);
      throw err;
    }
  }

  /**
   * Prueba rápida de conexión con la API Key configurada
   */
  async testConnection() {
    if (!this.isConfigured()) {
      return { success: false, message: 'La API Key está vacía.' };
    }
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}?key=${this.apiKey}`;
    try {
      const res = await fetch(endpoint);
      if (res.ok) {
        return { success: true, message: `Conexión exitosa con ${this.model}` };
      } else {
        const err = await res.json().catch(() => ({}));
        return { success: false, message: err.error?.message || `Error ${res.status}` };
      }
    } catch (e) {
      return { success: false, message: e.message || 'Error de red o sin conexión' };
    }
  }
}

// Exportar globalmente
window.GeminiVisionCounter = GeminiVisionCounter;
