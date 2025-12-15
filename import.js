// ====== CONFIG GENERAL ======
const STORAGE_KEY = "tt_order_manager_v1";
const WORKER_KEY = "tt_worker_id";
const DEVICE_KEY = "tt_device_id";

// ====== MISMO FORMATO DE RESULTADO QUE EN app.js ======
function defaultResult() {
  return {
    orderId: "",
    diaOrden: "",
    cuenta: "",
    crew: "",
    device: "",
    soundLink: "",
    typeOfPost: "",
    caption: "",
    slides: [],
    imageCategory: "",
    imageLinks: [],
    bookInfo: "",
    genres: [],
    hashtags: ""
  };
}

// ====== HELPERS TEXTO / PARSEO (COPIADOS DE app.js) ======
function cleanLine(line) {
  if (!line) return "";
  return line
    .replace(/^[\u2022•\-\u25CF\*\s\t]+/, "")
    .replace(/\u2028|\u2029/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Detector de encabezados de slide (misma lógica que app.js)
function isSlideHeader(line, inSlidesSection) {
  const trimmed = line.trim();

  // Ej: "Slide 1", "slide 2", "Slide 10 (Mic Drop)"
  if (/^slide\b/i.test(trimmed)) return true;

  // Ej: "[Slide 1]", "[Slide 1 – HOOK]", "[Slide 12] – CLIMAX", "[Slide 8"
  if (/^\[\s*slide\b.*$/i.test(trimmed)) return true;

  if (inSlidesSection) {
    // Ej: "HOOK (Slide 1):", "Mic Drop (Slide 10)"
    if (/\(\s*slide\s+\d{1,2}\s*\)\s*:?\s*$/i.test(trimmed)) {
      return true;
    }

    // Ej: "1. (Hook)", "2 (hook)", etc.
    if (/^\d{1,2}\s*[\.\)]?\s*\(\s*hook\s*\)\s*$/i.test(trimmed)) {
      return true;
    }

    // Números solos con signos: "1", "2.", "3:", "4 )", etc.
    if (/^\d{1,2}[\s\.\)\-"“”':]*$/.test(trimmed)) {
      return true;
    }
  }

  return false;
}

// Parser completo igual que en app.js, pero reutilizado aquí
function parseInput(raw) {
  const result = defaultResult();
  const lines = raw
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (!lines.length) return result;

  let inSlidesSection = false;
  let collectingImplicitSlide = false;
  let implicitSlideLines = [];

  const captionRegex =
    /^[^\w]*((tik\s*tok\s+caption)|(tiktok\s+caption)|caption)\b\s*:?\s*/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    const takeNext = setter => {
      if (i + 1 < lines.length) setter(cleanLine(lines[i + 1]));
    };

    // ====== CAMPOS GENERALES ======
    if (lower === "entregableid" || lower === "orderid") {
      takeNext(v => (result.orderId = v));
      continue;
    } else if (lower === "dia de entregable" || lower === "dia de orden") {
      takeNext(v => (result.diaOrden = v));
      continue;
    } else if (lower.endsWith("cuenta")) {
      takeNext(v => (result.cuenta = v));
      continue;
    } else if (lower === "crew" || lower.endsWith("crew")) {
      takeNext(v => (result.crew = v));
      continue;
    } else if (lower === "celular" || lower === "device") {
      takeNext(v => (result.device = v));
      continue;
    } else if (lower.startsWith("sound link")) {
      takeNext(v => (result.soundLink = v));
      continue;
    } else if (lower.startsWith("type of post")) {
      takeNext(v => (result.typeOfPost = v));
      continue;
    }

    // Inicio de sección "Text to use on post"
    if (/^text to use on post/i.test(line)) {
      inSlidesSection = true;
      collectingImplicitSlide = false;
      implicitSlideLines = [];
      continue;
    }

    // Caption
    if (captionRegex.test(line)) {
      let captionInline = line.replace(captionRegex, "").trim();
      captionInline = cleanLine(captionInline);
      if (captionInline) {
        result.caption = captionInline;
      } else if (i + 1 < lines.length) {
        result.caption = cleanLine(lines[i + 1]);
      }
      continue;
    }

    // ====== ONE SLIDE TYPE ======
    const isOneSlidePost =
      /one\s+slide/i.test(result.typeOfPost || "") ||
      /one\s+slider/i.test(result.typeOfPost || "") ||
      /one slide type/i.test(result.typeOfPost || "");

    if (inSlidesSection && isOneSlidePost && result.slides.length === 0) {
      const boundary =
        lower.startsWith("images for post") ||
        lower.startsWith("link cover image") ||
        lower.startsWith("book - author - tropes") ||
        lower.startsWith("hashtag order") ||
        lower.startsWith("hashtags for post") ||
        lower.startsWith("new genre") ||
        lower.startsWith("type of post");

      if (boundary) {
        if (collectingImplicitSlide && implicitSlideLines.length) {
          result.slides.push({
            title: "Slide 1",
            text: implicitSlideLines.join("\n").trim()
          });
          collectingImplicitSlide = false;
          implicitSlideLines = [];
        }
      } else if (!isSlideHeader(line, true)) {
        collectingImplicitSlide = true;
        implicitSlideLines.push(line);
        continue;
      }
    }

    // ====== SLIDES NORMALES ======
    if (isSlideHeader(line, inSlidesSection)) {
      const title = line;
      const bodyLines = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l2 = lines[j];
        const l2lower = l2.toLowerCase();
        if (
          isSlideHeader(l2, inSlidesSection) ||
          l2lower.startsWith("images for post") ||
          l2lower.startsWith("link cover image") ||
          l2lower.startsWith("book - author - tropes") ||
          l2lower.startsWith("hashtag order") ||
          l2lower.startsWith("hashtags for post")
        ) {
          break;
        }
        bodyLines.push(l2);
      }
      result.slides.push({ title, text: bodyLines.join("\n").trim() });
      i = j - 1;
      continue;
    }

    // Imágenes (categoría)
    if (lower.startsWith("images for post")) {
      takeNext(v => (result.imageCategory = v));
      continue;
    }

    // Imágenes (URLs)
    if (lower.startsWith("link cover image")) {
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l2 = lines[j];
        const l2lower = l2.toLowerCase();
        if (
          l2lower.startsWith("book - author - tropes") ||
          l2lower.startsWith("hashtag order") ||
          l2lower.startsWith("hashtags for post") ||
          l2lower.startsWith("images for post")
        ) {
          break;
        }
        if (/^https?:\/\//i.test(l2)) {
          result.imageLinks.push(l2.trim());
        }
      }
      i = j - 1;
      continue;
    }

    // Libro / géneros / hashtags
    if (lower.startsWith("book - author - tropes")) {
      if (i + 1 < lines.length) {
        result.bookInfo = cleanLine(lines[i + 1]);
      }
      let j = i + 2;
      for (; j < lines.length; j++) {
        const l2 = lines[j];
        const l2lower = l2.toLowerCase();
        if (
          l2lower.startsWith("hashtag order") ||
          l2lower.startsWith("hashtags for post")
        ) {
          const rest = cleanLine(
            l2.replace(/hashtag(s)? for post/i, "").replace(/hashtag order/i, "")
          );
          if (rest) {
            result.hashtags = rest;
          } else if (j + 1 < lines.length) {
            result.hashtags = cleanLine(lines[j + 1]);
          }
          break;
        } else {
          result.genres.push(cleanLine(l2));
        }
      }
      i = j - 1;
      continue;
    }
  }

  if (
    collectingImplicitSlide &&
    implicitSlideLines.length &&
    result.slides.length === 0
  ) {
    result.slides.push({
      title: "Slide 1",
      text: implicitSlideLines.join("\n").trim()
    });
  }

  return result;
}

// ====== LOCALSTORAGE COMPATIBLE CON app.js ======
function loadStateForImport() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { orders: [], currentOrderId: null, nextOrderId: 1 };
    }
    const state = JSON.parse(raw);
    return {
      orders: Array.isArray(state.orders) ? state.orders : [],
      currentOrderId: state.currentOrderId ?? null,
      nextOrderId: state.nextOrderId || 1
    };
  } catch (e) {
    console.error("No se pudo leer estado guardado", e);
    return { orders: [], currentOrderId: null, nextOrderId: 1 };
  }
}

function saveStateFromImport(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("No se pudo guardar estado desde import", e);
  }
}

// ====== CONSTRUIR BLOQUE DE TEXTO DESDE UNA FILA DEL CSV ======
function buildRawBlockFromRow(row) {
  const parts = [];

  function add(label, value) {
    if (value == null) return;
    const v = String(value).trim();
    if (!v) return;
    parts.push(label);
    parts.push(v);
  }

  add("EntregableID", row["EntregableID"]);
  add("Dia de Entregable", row["Dia de Entregable"]);
  add("1 Cuenta", row["1 Cuenta"]);
  add("2 Crew", row["2 Crew"]);
  add("Celular", row["Celular"]);
  add("Sound Link", row["Sound Link"]);
  add("Type of Post", row["Type of Post"]);
  add("Text to use on post", row["Text to use on post"]);
  add(
    "Images for Post (from Book Data) (from 3 Text)",
    row["Images for Post (from Book Data) (from 3 Text)"]
  );
  add("Link Cover Image", row["Link Cover Image"]);
  add("Book - Author - Tropes", row["Book - Author - Tropes"]);
  add("Hashtags for post", row["Hashtags for post"]);

  return parts.join("\n");
}

// ====== IMPORTAR ÓRDENES DESDE CSV PARSEADO ======
function importOrdersFromCsvRows(rows, workerId, celularFilter) {
  const imported = [];
  let state = loadStateForImport();

  const workerIdTrim = (workerId || "").trim();
  const celularTrim = (celularFilter || "").trim();

  rows.forEach(row => {
    const crew = (row["2 Crew"] || "").trim();
    const cel = (row["Celular"] || "").trim();

    if (workerIdTrim && crew !== workerIdTrim) return;
    if (celularTrim && cel !== celularTrim) return;

    const rawBlock = buildRawBlockFromRow(row);
    const data = parseInput(rawBlock);

    const hasSomething =
      (data.cuenta && data.cuenta.trim()) ||
      (data.orderId && data.orderId.trim()) ||
      (data.bookInfo && data.bookInfo.trim()) ||
      (data.slides && data.slides.length > 0);

    if (!hasSomething) return;

    const titleParts = [];
    if (data.cuenta) titleParts.push(data.cuenta);
    if (data.orderId) titleParts.push(data.orderId);
    const title = titleParts.join(" · ") || `Orden ${state.nextOrderId}`;

    const order = {
      id: state.nextOrderId++,
      title,
      data,
      completed: false
    };

    state.orders.push(order);
    imported.push(order);
  });

  if (state.currentOrderId == null && state.orders.length > 0) {
    state.currentOrderId = state.orders[0].id;
  }

  saveStateFromImport(state);

  return imported;
}

// ====== UI: MANEJO DE FORMULARIO ======
document.addEventListener("DOMContentLoaded", () => {
  const workerInput = document.getElementById("workerIdInput");
  const celularInput = document.getElementById("celularIdInput");
  const fileInput = document.getElementById("csvFileInput");
  const btn = document.getElementById("analyzeCsvBtn");
  const statusEl = document.getElementById("importStatus");
  const previewEl = document.getElementById("importPreview");

  if (workerInput) {
    const savedWorker = localStorage.getItem(WORKER_KEY);
    workerInput.value = savedWorker || "584ArmandoNavarro";
  }
  if (celularInput) {
    const savedDevice = localStorage.getItem(DEVICE_KEY);
    if (savedDevice) celularInput.value = savedDevice;
  }

  if (!btn) return;

  btn.addEventListener("click", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      alert("Selecciona primero el archivo CSV del día.");
      return;
    }

    const workerId = workerInput.value || "";
    const celularId = celularInput.value || "";

    if (!workerId.trim()) {
      const ok = confirm(
        "No escribiste ID de trabajador (Crew).\n¿Quieres importar órdenes de TODOS los trabajadores?"
      );
      if (!ok) return;
    }

    localStorage.setItem(WORKER_KEY, workerId);
    if (celularId.trim()) {
      localStorage.setItem(DEVICE_KEY, celularId.trim());
    }

    statusEl.textContent = "Leyendo CSV y analizando filas...";
    previewEl.textContent = "";

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: results => {
        const rows = results.data || [];
        if (!rows.length) {
          statusEl.textContent = "El CSV no tiene filas de datos.";
          return;
        }

        const imported = importOrdersFromCsvRows(rows, workerId, celularId);

        if (!imported.length) {
          statusEl.textContent =
            "No se encontraron órdenes que coincidan con el filtro (Crew / Celular).";
          return;
        }

        statusEl.textContent =
          `Se importaron ${imported.length} orden` +
          (imported.length === 1 ? "" : "es") +
          ` a la cola de este dispositivo. Abre el gestor principal para verlas.`;

        const previews = imported.slice(0, 5).map((ord, idx) => {
          const d = ord.data;
          const slidesCount = d.slides ? d.slides.length : 0;
          return (
            `#${idx + 1}: ${ord.title}\n` +
            `   Día: ${d.diaOrden || "—"} | Celular: ${d.device || "—"} | Slides: ${slidesCount}\n`
          );
        });

        previewEl.textContent =
          previews.join("\n") +
          (imported.length > 5
            ? `\n... y ${imported.length - 5} orden(es) más.`
            : "");
      },
      error: err => {
        console.error(err);
        statusEl.textContent =
          "Ocurrió un error leyendo el CSV. Revisa el archivo e inténtalo de nuevo.";
      }
    });
  });
});
