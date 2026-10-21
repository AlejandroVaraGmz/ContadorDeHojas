# Contador Industrial de Láminas en Tiempo Real (Live Video Stream PWA)

Aplicación Web Progresiva (PWA) de grado industrial diseñada para el **escaneo, detección y conteo automático en tiempo real (30 FPS)** de láminas y placas de acero inoxidable y aluminio apiladas dentro de un empaque mientras el operador apunta con la cámara.

---

## ⚡ Novedades: Detección en Vivo a 30 FPS y Asistente IA

1. **Detección en Tiempo Real a 30 FPS (Motor 1 - Algoritmo Local)**:
   - Captura continua a 30 FPS mediante `requestAnimationFrame` exclusivamente dentro de la Zona de Escaneo (ROI).
   - Conversión a escala de grises y proyección horizontal de brillo fila por fila para detectar picos reflejantes y valles de separación.
   - **Filtro de Estabilización Temporal (Rolling Median de 12 frames)**: Estabiliza el número en pantalla y las líneas verdes para que la lectura sea sólida aun con temblor de mano del operador.
   - **Recubrimiento AR en Vivo**: Dibuja líneas y puntos verde neón (`#22c55e`) directamente sobre cada lámina en movimiento.

2. **Asistente Gemini Vision API Preconfigurado (Motor 2)**:
   - Clave de API de Gemini preconfigurada por defecto en el código:
     `AQ.Ab8RN6IRM-D_n4lzxdtXYpyuMj_SX_5gadSL3Mmuh1Px7CPJBQ`
   - Modo **"Auto-Escaneo IA en Vivo (Cada 3 seg)"**: toma un frame nítido del ROI en segundo plano sin pausar el video y consulta a `gemini-2.5-flash` con el prompt industrial especializado.
   - Botón **"✨ Verificar IA"** para análisis inmediato bajo demanda.

3. **Botón "Congelar Lectura (🔒)" y Ajuste Táctil**:
   - Permite al operador pausar la imagen en pantalla cuando los puntos verdes estén alineados, sin tener que seguir sosteniendo el móvil frente a la estiba.
   - En pantalla congelada:
     - Tocar una lámina sin marcar añade un punto verde (`+1`).
     - Tocar un punto existente lo elimina (`-1`).
     - Botones ergonómicos `+1` y `-1`, Deshacer y Limpiar.
     - Botón para volver a **"▶ Reanudar Cámara"**.

4. **Control Avanzado de Cámaras Traseras**:
   - Arranque forzado en Full HD (`1920x1080 @ 30 FPS`) con `facingMode: { exact: "environment" }`.
   - **Filtro estricto anti-frontales**: descarta automáticamente cámaras `front`, `user`, `selfie`, etc.
   - **Selector de Lentes Traseros en Vivo**: alterna al instante entre lentes Principal, Macro, Telefoto y Gran Angular mediante su `deviceId` exacto.
   - Control de Linterna (`🔦`) para iluminación en almacén.

5. **Galería de Calibración con 6 Muestras Reales**:
   - Muestra 1: 8 piezas — Calibre 10 (`assets/samples/muestra1_cal10_8piezas.jpg`)
   - Muestra 2: 15 piezas — Calibre 12 (`assets/samples/muestra2_cal12_15piezas.jpg`)
   - Muestra 3: 2 piezas — Calibre 1/4" (`assets/samples/muestra3_cal1_4_2piezas.jpg`)
   - Muestra 4: 24 piezas — Calibre 14 (`assets/samples/muestra4_cal14_24piezas.jpg`)
   - Muestra 5: 51 piezas — Calibre 24 (`assets/samples/muestra5_cal24_51piezas.jpg`)
   - Muestra 6: 75 piezas — Calibre 20 (`assets/samples/muestra6_cal20_75piezas.jpg`)

6. **PWA y Funcionamiento Offline**:
   - Diseño industrial OLED negro (`#07090d`), alto contraste verde neón y cian.
   - Instalable en Android e iOS (`manifest.json` e iconos SVG/PNG).
   - Service Worker (`sw.js`) con estrategia cache-first para operar sin internet en el almacén.

---

## 🛠️ Ejecución Local

El servidor local se encuentra disponible en:
```bash
python -m http.server 8080
```
Abre en tu navegador: **`http://localhost:8080`**
