# Contador Industrial de Láminas (PWA)

Aplicación Web Progresiva (PWA) de grado industrial diseñada para el conteo automático y preciso de láminas/chapas de acero inoxidable y aluminio apiladas dentro de empaques de almacén a partir de fotografías.

---

## 🚀 Características Principales

### 1. Control Avanzado de Cámaras (Exclusivo Cámaras Traseras)
- **Arranque forzado en alta resolución**: Al abrir o activar la cámara, solicita automáticamente `{ video: { facingMode: { exact: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } }`.
- **Filtro estricto anti-frontales**: Filtra automáticamente `enumerateDevices()` descartando cualquier cámara cuya etiqueta contenga `front`, `frontal`, `user`, `selfie`, `facetime`, `delantera` o `anterior`.
- **Selector de Lentes Traseros**: Menú desplegable en la barra superior para cambiar entre lentes (Principal, Macro, Gran Angular, Telefoto) mediante su `deviceId` exacto para obtener el mejor enfoque de cerca en los cantos de las láminas.
- **Control de Linterna (Torch)**: Botón rápido de encendido/apagado de flash para iluminar los paquetes en pasillos oscuros de almacén.

### 2. Zona de Interés (ROI) y Guía Visual
- **Visor vertical en tiempo real**: Guía gráfica centrada con bordes cian/amarillo de seguridad que indica dónde alinear los cantos de las láminas.
- **Exclusión de cartón corrugado**: Indicadores superiores e inferiores para aislar el paquete metálico del cartón ondulado y la tarima de madera.
- **Manijas interactivas de recorte**: Permite ajustar la altura superior e inferior del ROI arrastrando directamente sobre la pantalla o el canvas congelado.

### 3. Motor Dual de Procesamiento y Conteo
- **Modo A (Procesamiento Local en Canvas / CLAHE)**:
  - Conversión a escala de grises con luminancia estandarizada.
  - **CLAHE (Contrast-Limited Adaptive Histogram Equalization)**: Ecualización adaptativa local por bloques que normaliza zonas oscuras y reflejos metálicos.
  - **Filtro Gaussiano 1D**: Reduce el ruido de la textura y rayones del metal sin perder definición en los cantos horizontales.
  - **Perfil de Proyección Horizontal de Intensidades**: Promedia el brillo fila por fila y sustrae el fondo mediante filtro pasa-altas.
  - **Detección de Picos y Valles con Calibre**: Distancia mínima y prominencia adaptativa según el calibre seleccionado (`Calibre 1/4"`, `10`, `12`, `14`, `20`, `24` o `Detección Automática` por autocorrelación).
- **Modo B (Gemini Visión IA Multimodal)**:
  - Integración nativa con la API de Google Gemini (`gemini-2.5-flash`, `gemini-1.5-flash`, `gemini-2.5-pro`).
  - Módulo configurable con almacenamiento seguro local de la API Key en el dispositivo.
  - Análisis asistido para calibres ultra delgados o empaques con dobleces complejos.

### 4. Visualización de Resultados y Corrección Manual
- **Líneas y marcadores verde neón (`#22c55e`)**: Trazado visual de cada canto de lámina detectado con su número de orden (1..N).
- **Lectura numérica en tiempo real**: Panel inferior de alto contraste con tipografía monoespaciada para lectura a distancia en almacén.
- **Edición táctil sobre el Canvas**:
  - Tocar sobre un espacio vacío añade una pieza en esa coordenada Y.
  - Tocar sobre un marcador existente lo elimina.
  - Botones ergonómicos `+1` y `-1` para ajuste con una sola mano usando el pulgar.
  - Botón `Deshacer` y `Limpiar`.
- **Gráfico de Diagnóstico (Waveform)**: Modal que grafica la curva de brillo promedio 1D y los picos detectados.

### 5. Galería de Calibración con Muestras Reales
Incluye una galería precargada con los 5 casos reales de referencia para probar y calibrar el algoritmo con un solo toque:
1. **Muestra 1**: 8 piezas — Calibre 10 (`assets/samples/muestra1_cal10_8piezas.jpg`)
2. **Muestra 2**: 15 piezas — Calibre 12 (`assets/samples/muestra2_cal12_15piezas.jpg`)
3. **Muestra 3**: 2 piezas — Calibre 1/4" (`assets/samples/muestra3_cal1_4_2piezas.jpg`)
4. **Muestra 4**: 24 piezas — Calibre 14 (`assets/samples/muestra4_cal14_24piezas.jpg`)
5. **Muestra 5**: 51 piezas — Calibre 24 (`assets/samples/muestra5_cal24_51piezas.jpg`)

### 6. PWA & Modo Offline
- **Diseño industrial de alto contraste**: Fondo oscuro OLED (`#07090d`) para ahorrar batería y maximizar visibilidad en ambientes industriales.
- **Instalable**: Cumple con todos los estándares PWA (`manifest.json`, iconos SVG y PNG 192/512px, `display: standalone`).
- **Offline First**: Service Worker (`sw.js`) con estrategia de caché para operar 100% sin conexión a internet en el almacén.

---

## 📁 Estructura del Proyecto

```
ContadorDeHojas/
├── index.html                   # Interfaz de usuario principal
├── manifest.json                # Manifiesto de PWA instalable
├── sw.js                        # Service Worker para funcionamiento offline
├── css/
│   └── style.css                # Estilos industriales y ergonomía táctil
├── js/
│   ├── app.js                   # Orquestador principal, estado y muestras
│   ├── camera.js                # Control de cámara trasera y filtro anti-frontales
│   ├── sheet-counter.js         # Motor local: CLAHE, proyección 1D y picos
│   ├── gemini-counter.js        # Módulo de visión con Gemini API
│   └── ui-roi.js                # Guía ROI, marcadores y edición en canvas
├── assets/
│   ├── icons/                   # Iconos PWA (SVG, PNG 192px y 512px)
│   └── samples/                 # Muestras reales precargadas para calibración
└── README.md
```

---

## 🛠️ Ejecución Local

Para probar la PWA en un servidor web local:

```bash
# Con Python (cualquier versión):
python -m http.server 8080

# Luego abrir en el navegador:
# http://localhost:8080
```

Para probar en un dispositivo móvil Android o iOS en la misma red Wi-Fi:
1. Obtén tu IP local (`ipconfig` en Windows).
2. Abre `http://<TU_IP_LOCAL>:8080` en Chrome o Safari móvil.
3. Para probar la cámara en móvil a través de IP local, asegúrate de activar flags de origen seguro en Chrome (`chrome://flags/#unsafely-treat-insecure-origin-as-secure`) o servir vía HTTPS (por ejemplo con ngrok, Cloudflare Tunnel o GitHub Pages).

---

## 🔒 Privacidad y Almacenamiento
- Las imágenes tomadas en Modo Local se procesan 100% dentro del navegador del usuario mediante la Canvas API; ningún dato abandona el dispositivo.
- La API Key de Gemini (si se usa en Modo B) se almacena únicamente en el `localStorage` del dispositivo local del operador.
