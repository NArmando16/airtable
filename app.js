// ====== ESTADO GLOBAL ======
const defaultResult = () => ({
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
});

let orders = [];            // todas las órdenes
let currentOrderId = null;  // id de la orden que se está viendo
let nextOrderId = 1;        // contador para IDs internos
const STORAGE_KEY = "tt_order_manager_v1";

// ====== CONFIG BACKEND / DISPOSITIVO ======
const BACKEND_BASE_URL = "https://tu-backend-ejemplo.com"; // ← CAMBIA ESTO
const WORKER_KEY = "tt_worker_id";
const DEVICE_KEY = "tt_device_id";

// ====== HELPERS DE TEXTO / PARSEO ======
function cleanLine(line) {
  if (!line) return "";
  return line
    .replace(/^[\u2022•\-\u25CF\*\s\t]+/, "") // bullets al inicio
    .replace(/\u2028|\u2029/g, " ") // separadores raros
    .replace(/\s+/g, " ")
    .trim();
}

// Detector de encabezados de slide
function isSlideHeader(line, inSlidesSection) {
  const trimmed = line.trim();

  // Ej: "Slide 1", "slide 2", "Slide 10 (Mic Drop)"
  if (/^slide\b/i.test(trimmed)) return true;

  // Ej: "[Slide 1]", "[Slide 1 – HOOK]", "[Slide 12] – CLIMAX"
  if (/^\[\s*slide\b.*$/i.test(trimmed)) return true;

  if (inSlidesSection) {
    // Ej: "HOOK (Slide 1):", "Mic Drop (Slide 10)"
    // Cualquier línea que termine en "(Slide N)" o "(Slide N):"
    if (/\(\s*slide\s+\d{1,2}\s*\)\s*:?\s*$/i.test(trimmed)) {
      return true;
    }

    // Caso especial: "1. (Hook)", "2 (hook)", etc.
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

function parseInput(raw) {
  const result = defaultResult();
  const lines = raw
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (!lines.length) return result;

  let inSlidesSection = false;

  // Para ONE SLIDE: recolectar texto crudo después de "Text to use on post"
  let collectingImplicitSlide = false;
  let implicitSlideLines = [];

  // Caption: acepta "Caption:", "🖤caption:", "Tik Tok Caption:", etc.
  const captionRegex =
    /^[^\w]*((tik\s*tok\s+caption)|(tiktok\s+caption)|caption)\b\s*:?\s*/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    const takeNext = setter => {
      if (i + 1 < lines.length) setter(cleanLine(lines[i + 1]));
    };

    // IDs / fechas / cuenta
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
      // Reseteamos por si acaso
      collectingImplicitSlide = false;
      implicitSlideLines = [];
      continue; // no queremos tratar esta línea como texto
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

    // ====== ONE SLIDE TYPE: texto directo tras "Text to use on post" ======
    const isOneSlidePost =
      /one\s+slide/i.test(result.typeOfPost || "") ||
      /one\s+slider/i.test(result.typeOfPost || "") ||
      /one slide type/i.test(result.typeOfPost || "");

    if (inSlidesSection && isOneSlidePost && result.slides.length === 0) {
      // Si llegamos a una sección nueva, cerramos el slide implícito
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
        // dejamos que el resto de la lógica procese esta línea (por ejemplo, imágenes)
      } else if (!isSlideHeader(line, true)) {
        // No es header de slide ni boundary → texto del único slide
        collectingImplicitSlide = true;
        implicitSlideLines.push(line);
        continue; // esta línea ya se usó como texto de slide
      }
    }

    // ====== SLIDES NORMALES (multi-slide) ======
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

  // Si era One Slide Type y hemos recolectado texto pero no lo llegamos a cerrar
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

// ====== LOCALSTORAGE (GUARDAR / CARGAR ESTADO) ======
function saveState() {
  try {
    const state = {
      orders,
      currentOrderId,
      nextOrderId
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("No se pudo guardar estado", e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    orders = Array.isArray(state.orders) ? state.orders : [];
    currentOrderId = state.currentOrderId ?? null;
    nextOrderId = state.nextOrderId || 1;
  } catch (e) {
    console.error("No se pudo leer estado guardado", e);
  }
}

// ====== CONFIG DEL DISPOSITIVO (Crew + Device) ======
function loadDeviceConfig() {
  const workerInput = document.getElementById("workerIdInputMain");
  const deviceInput = document.getElementById("deviceIdInputMain");
  if (!workerInput || !deviceInput) return;

  const savedWorker = localStorage.getItem(WORKER_KEY);
  const savedDevice = localStorage.getItem(DEVICE_KEY);

  if (savedWorker) workerInput.value = savedWorker;
  if (savedDevice) deviceInput.value = savedDevice;
}

function saveDeviceConfig(workerId, deviceId) {
  if (workerId) localStorage.setItem(WORKER_KEY, workerId);
  if (deviceId) localStorage.setItem(DEVICE_KEY, deviceId);
}

// ====== PORTAPAPELES ======
async function copyToClipboard(text) {
  if (!text) return;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fallback más abajo
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
  } catch {
    // ignore
  }
  document.body.removeChild(textarea);
}

// ====== COLA DE ÓRDENES (LOCAL) ======
function addOrderFromInput() {
  const raw = document.getElementById("rawInput").value || "";
  if (!raw.trim()) {
    alert("Pega primero el texto de la orden.");
    return;
  }

  const data = parseInput(raw);

  const parts = [];
  if (data.cuenta) parts.push(data.cuenta);
  if (data.orderId) parts.push(data.orderId);
  const title = parts.join(" · ") || `Orden ${nextOrderId}`;

  const order = {
    id: nextOrderId++,
    title,
    data,
    completed: false
  };

  orders.push(order);
  document.getElementById("rawInput").value = "";

  // Si no hay orden activa, esta será la primera
  if (currentOrderId === null) {
    currentOrderId = order.id;
    renderResults(order.data);
    scrollToFirstSlide();
  }

  renderOrderList();
  updateOrderNav();
  updateCurrentOrderHeader();
  saveState();
}

function getCurrentOrderIndex() {
  return orders.findIndex(o => o.id === currentOrderId);
}

function getCurrentOrder() {
  return orders.find(o => o.id === currentOrderId) || null;
}

function selectOrder(id) {
  const ord = orders.find(o => o.id === id);
  if (!ord) return;
  currentOrderId = id;
  renderResults(ord.data);
  renderOrderList();
  updateOrderNav();
  updateCurrentOrderHeader();
  scrollToFirstSlide(); // 👉 al cambiar de orden, subimos a la primera slide
  saveState();
}

function toggleOrderCompleted(id) {
  const ord = orders.find(o => o.id === id);
  if (!ord) return;
  ord.completed = !ord.completed;
  renderOrderList();
  if (id === currentOrderId) {
    updateCurrentOrderHeader();
  }
  saveState();
}

// ELIMINAR SOLO UNA ORDEN
function deleteOrder(id) {
  const idx = orders.findIndex(o => o.id === id);
  if (idx === -1) return;

  const isCurrent = orders[idx].id === currentOrderId;
  orders.splice(idx, 1);

  if (isCurrent) {
    if (orders.length === 0) {
      currentOrderId = null;
    } else if (idx < orders.length) {
      currentOrderId = orders[idx].id; // siguiente
    } else {
      currentOrderId = orders[orders.length - 1].id; // última
    }
  }

  renderOrderList();

  if (currentOrderId === null) {
    const resultsSection = document.getElementById("results");
    if (resultsSection) resultsSection.classList.add("hidden");
  } else {
    const ord = getCurrentOrder();
    if (ord) {
      renderResults(ord.data);
      scrollToFirstSlide();
    }
  }

  updateOrderNav();
  updateCurrentOrderHeader();
  saveState();
}

function renderOrderList() {
  const listEl = document.getElementById("orderList");
  const countTag = document.getElementById("ordersCountTag");

  listEl.innerHTML = "";
  countTag.textContent =
    orders.length + " orden" + (orders.length === 1 ? "" : "es");

  orders.forEach(order => {
    const item = document.createElement("div");
    item.className =
      "order-item" + (order.id === currentOrderId ? " order-item-active" : "");

    const main = document.createElement("div");
    main.className = "order-main";

    // Flecha que indica la orden actualmente abierta
    const arrow = document.createElement("span");
    arrow.className = "order-current-indicator";
    arrow.textContent = "▶";

    const title = document.createElement("div");
    title.className = "order-title";
    title.textContent = order.title;

    const meta = document.createElement("div");
    meta.className = "order-meta";
    const d = order.data;
    meta.textContent = [d.diaOrden, d.typeOfPost].filter(Boolean).join(" · ");

    main.appendChild(arrow);
    main.appendChild(title);
    main.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "order-actions";

    const checkBtn = document.createElement("button");
    checkBtn.className =
      "order-check" + (order.completed ? " completed" : "");
    checkBtn.title = "Marcar orden como completada";
    checkBtn.onclick = ev => {
      ev.stopPropagation(); // que no dispare el click del item
      toggleOrderCompleted(order.id);
    };

    // Botón para borrar SOLO esta orden
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "order-delete-btn";
    deleteBtn.title = "Eliminar esta orden de la cola";
    deleteBtn.textContent = "🗑";
    deleteBtn.onclick = ev => {
      ev.stopPropagation();
      const ok = confirm(
        "¿Seguro que quieres eliminar esta orden de la cola?\nEsta acción no se puede deshacer."
      );
      if (!ok) return;
      deleteOrder(order.id);
    };

    actions.appendChild(checkBtn);
    actions.appendChild(deleteBtn);

    item.onclick = () => selectOrder(order.id);

    item.appendChild(main);
    item.appendChild(actions);
    listEl.appendChild(item);
  });

  // Mostrar u ocultar sección de detalle
  const resultsSection = document.getElementById("results");
  if (orders.length === 0) {
    resultsSection.classList.add("hidden");
    currentOrderId = null;
  } else if (currentOrderId !== null) {
    resultsSection.classList.remove("hidden");
  }
}

// Limpiar toda la cola de este dispositivo
function resetAllOrders() {
  const ok = confirm(
    "¿Seguro que quieres limpiar la cola de órdenes de este dispositivo?\nEsta acción no se puede deshacer."
  );
  if (!ok) return;

  orders = [];
  currentOrderId = null;
  nextOrderId = 1;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error("No se pudo eliminar estado guardado", e);
  }

  renderOrderList();
  const resultsSection = document.getElementById("results");
  if (resultsSection) resultsSection.classList.add("hidden");
}

// ====== COPIAS RÁPIDAS GENERALES ======
function scrollToCombo() {
  const el = document.getElementById("comboField");
  if (!el) return;
  try {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {
    el.scrollIntoView();
  }
}

function attachCopyHandlers() {
  document.querySelectorAll("[data-copy]").forEach(btn => {
    btn.onclick = async () => {
      const targetId = btn.getAttribute("data-copy");
      const el = document.getElementById(targetId);
      if (!el) return;
      const text = el.innerText || el.textContent || "";
      if (!text.trim()) return;
      const original = btn.textContent;
      await copyToClipboard(text);
      btn.textContent = "✅ Copiado";
      setTimeout(() => {
        btn.textContent = original;
      }, 1200);

      // Si copio el título, auto scroll al combo
      if (targetId === "bookInfoField") {
        scrollToCombo();
      }
    };
  });
}

// ====== SLIDES ======
function focusSlide(index) {
  const all = document.querySelectorAll(".slide-item");
  all.forEach(el => el.classList.remove("slide-active"));

  const target = document.getElementById("slideItem_" + index);
  if (target) {
    target.classList.add("slide-active");
    try {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      target.scrollIntoView();
    }
  }
}

// Scroll a la tarjeta de usuario
function scrollToUserDetails() {
  const el = document.getElementById("userDetailsCard");
  if (!el) return;
  try {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {
    el.scrollIntoView();
  }
}

// Scroll a la primera slide
function scrollToFirstSlide() {
  const first = document.getElementById("slideItem_0");
  if (!first) return;
  try {
    first.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {
    first.scrollIntoView();
  }
}

// Scroll a la tarjeta de título
function scrollToTitleCard() {
  const el = document.getElementById("titleCard");
  if (!el) return;
  try {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {
    el.scrollIntoView();
  }
}

// ====== DETALLE DE ORDEN ======
function renderResults(data) {
  const resultsSection = document.getElementById("results");
  resultsSection.classList.remove("hidden");

  const statusMessage = document.getElementById("statusMessage");

  const parts = [];
  if (data.cuenta) parts.push("usuario");
  if (data.imageLinks.length) parts.push(data.imageLinks.length + " imágenes");
  if (data.soundLink) parts.push("audio");
  if (data.slides.length) parts.push(data.slides.length + " slides");
  if (data.bookInfo) parts.push("título");
  if (data.caption || data.genres.length || data.hashtags) parts.push("combo texto");

  statusMessage.textContent = parts.length
    ? "Detectado: " + parts.join(" · ")
    : "No se detectaron bloques con el formato esperado.";

  const orDash = v => (v && v.trim() ? v : "—");

  // Usuario
  document.getElementById("accountField").textContent = orDash(data.cuenta);
  document.getElementById("orderIdField").textContent = orDash(data.orderId);
  document.getElementById("crewField").textContent = orDash(data.crew);
  document.getElementById("deviceField").textContent = orDash(data.device);

  // Audio
  const soundLinkField = document.getElementById("soundLinkField");
  const soundLinkCopy = document.getElementById("soundLinkCopy");
  if (data.soundLink && data.soundLink.startsWith("http")) {
    soundLinkField.href = data.soundLink;
    soundLinkField.textContent = "🎵 Abrir audio";
    soundLinkCopy.textContent = data.soundLink;
  } else {
    soundLinkField.href = "#";
    soundLinkField.textContent = "Sin audio detectado";
    soundLinkCopy.textContent = "";
  }

  // Slides
  const slidesContainer = document.getElementById("slidesContainer");
  const slidesCountTag = document.getElementById("slidesCountTag");
  slidesContainer.innerHTML = "";
  slidesCountTag.textContent =
    data.slides.length + " slide" + (data.slides.length === 1 ? "" : "s");

  data.slides.forEach((slide, idx) => {
    const slideId = "slide_" + idx;
    const wrap = document.createElement("div");
    wrap.className = "slide-item";
    wrap.id = "slideItem_" + idx;

    const header = document.createElement("div");
    header.className = "slide-header";

    const title = document.createElement("div");
    title.className = "slide-title";
    title.textContent = slide.title || "Slide " + (idx + 1);

    const rightHeader = document.createElement("div");
    rightHeader.style.display = "flex";
    rightHeader.style.alignItems = "center";
    rightHeader.style.gap = "0.3rem";

    const statusDot = document.createElement("span");
    statusDot.className = "slide-status";
    statusDot.id = "slideStatus_" + idx;

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.id = "slideCopyBtn_" + idx;
    copyBtn.textContent = "📋 Copiar slide";

    copyBtn.addEventListener("click", async () => {
      const textToCopy = slide.text || "";
      if (!textToCopy.trim()) return;
      await copyToClipboard(textToCopy);
      statusDot.classList.add("copied");
      const original = copyBtn.textContent;
      copyBtn.textContent = "✅ Copiado";
      setTimeout(() => {
        copyBtn.textContent = original;
      }, 1200);

      const nextIndex = idx + 1;
      if (nextIndex < data.slides.length) {
        // Hay siguiente slide: enfocar
        focusSlide(nextIndex);
      } else {
        // Último slide: ir al título
        scrollToTitleCard();
      }
    });

    rightHeader.appendChild(statusDot);
    rightHeader.appendChild(copyBtn);

    header.appendChild(title);
    header.appendChild(rightHeader);

    const pre = document.createElement("pre");
    pre.id = slideId;
    pre.textContent = slide.text || "";

    wrap.appendChild(header);
    wrap.appendChild(pre);
    slidesContainer.appendChild(wrap);
  });

  // Imágenes
  document.getElementById("imageCategoryField").textContent = orDash(
    data.imageCategory
  );
  const imageMainLink = document.getElementById("imageMainLink");
  const imageList = document.getElementById("imageList");
  const imageCountTag = document.getElementById("imageCountTag");
  const imageAutoNumber = document.getElementById("imageAutoNumber");

  imageMainLink.textContent = "";
  imageList.innerHTML = "";

  const links = data.imageLinks || [];
  const slidesCount = data.slides.length || 0;
  const autoNumber = slidesCount + 1;

  imageCountTag.textContent =
    links.length + " imagen" + (links.length === 1 ? "" : "es");

  if (links.length) {
    imageAutoNumber.textContent = autoNumber;

    const first = links[0];
    imageMainLink.textContent = first;

    links.forEach((url, idx) => {
      const div = document.createElement("div");
      div.className = "image-link-item";
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = `Imagen ${idx + 1}: ${url}`;
      div.appendChild(a);
      imageList.appendChild(div);
    });
  } else {
    imageAutoNumber.textContent = "";
  }

  // Título
  document.getElementById("bookInfoField").textContent = data.bookInfo || "";

  // Combo caption + géneros + hashtags
  const combo = [data.caption || "", (data.genres || []).join("\n"), data.hashtags || ""]
    .filter(s => s && s.trim())
    .join("\n\n");
  document.getElementById("comboField").textContent = combo;

  attachCopyHandlers();
  updateCurrentOrderHeader();
  updateOrderNav();
  autoCopyFirstSlide(data);
}

// Copia automáticamente el Slide 1 al cambiar de orden
function autoCopyFirstSlide(data) {
  if (!data || !data.slides || !data.slides.length) return;
  const first = data.slides[0];
  const textToCopy = first.text || "";
  if (!textToCopy.trim()) return;

  copyToClipboard(textToCopy);

  const statusDot = document.getElementById("slideStatus_0");
  if (statusDot) {
    statusDot.classList.add("copied");
  }
  const copyBtn = document.getElementById("slideCopyBtn_0");
  if (copyBtn) {
    const original = copyBtn.textContent;
    copyBtn.textContent = "✅ Copiado (auto)";
    setTimeout(() => {
      copyBtn.textContent = original;
    }, 1200);
  }
}

// ====== BARRA INFERIOR (TÍTULO + CASILLA) ======
function updateCurrentOrderHeader() {
  const label = document.getElementById("currentOrderTitle");
  const toggle = document.getElementById("currentOrderDoneToggle");
  const ord = getCurrentOrder();

  if (!ord) {
    label.textContent = "Sin orden seleccionada";
    toggle.classList.remove("completed");
    toggle.disabled = true;
    return;
  }

  toggle.disabled = false;
  if (ord.completed) {
    toggle.classList.add("completed");
  } else {
    toggle.classList.remove("completed");
  }

  const data = ord.data || {};
  // título del libro (quitando 📚:)
  let bookTitle = (data.bookInfo || "").replace(/^📚\s*:/, "").trim();
  const account = data.cuenta || "";

  let labelText;
  if (bookTitle && account) {
    labelText = `${bookTitle} - ${account}`;
  } else if (bookTitle) {
    labelText = bookTitle;
  } else if (account) {
    labelText = account;
  } else {
    labelText = ord.title;
  }

  label.textContent = labelText;
}

// ====== FLECHAS ARRIBA / ABAJO ======
function updateOrderNav() {
  const aboveSpan = document.getElementById("ordersAboveCount");
  const belowSpan = document.getElementById("ordersBelowCount");
  const prevBtn = document.getElementById("orderPrevBtn");
  const nextBtn = document.getElementById("orderNextBtn");

  const idx = getCurrentOrderIndex();
  if (idx === -1) {
    aboveSpan.textContent = "0";
    belowSpan.textContent = "0";
    prevBtn.classList.add("disabled");
    nextBtn.classList.add("disabled");
    return;
  }

  const above = idx;
  const below = orders.length - idx - 1;

  aboveSpan.textContent = above;
  belowSpan.textContent = below;

  if (above > 0) {
    prevBtn.classList.remove("disabled");
  } else {
    prevBtn.classList.add("disabled");
  }
  if (below > 0) {
    nextBtn.classList.remove("disabled");
  } else {
    nextBtn.classList.add("disabled");
  }
}

// ====== CARGAR ÓRDENES DESDE BACKEND ======
async function loadOrdersFromBackend() {
  const workerInput = document.getElementById("workerIdInputMain");
  const deviceInput = document.getElementById("deviceIdInputMain");
  const statusMessage = document.getElementById("statusMessage");

  if (!workerInput || !deviceInput) {
    alert("No se encontró el bloque de configuración de este celular.");
    return;
  }

  const crewId = workerInput.value.trim();
  const deviceId = deviceInput.value.trim();

  if (!crewId || !deviceId) {
    alert("Escribe tu ID de trabajador (Crew) y el nombre del Celular.");
    return;
  }

  saveDeviceConfig(crewId, deviceId);

  try {
    if (statusMessage) {
      statusMessage.textContent = "Cargando órdenes desde el servidor...";
    }

    const url =
      BACKEND_BASE_URL +
      "/api/orders?crewId=" +
      encodeURIComponent(crewId) +
      "&deviceId=" +
      encodeURIComponent(deviceId);

    const resp = await fetch(url);
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error("Error del servidor: " + txt);
    }
    const payload = await resp.json();
    if (!payload.ok) {
      throw new Error(payload.error || "Error desconocido en respuesta.");
    }

    const list = payload.orders || [];

    // Limpiamos cola local y la reemplazamos con lo de hoy
    orders = [];
    currentOrderId = null;
    nextOrderId = 1;

    list.forEach(o => {
      const data = parseInput(o.rawText || "");

      const parts = [];
      if (data.cuenta) parts.push(data.cuenta);
      if (data.orderId) parts.push(data.orderId);
      const title = parts.join(" · ") || `Orden ${nextOrderId}`;

      const order = {
        id: nextOrderId++,
        title,
        data,
        completed: false
      };
      orders.push(order);
    });

    renderOrderList();

    if (orders.length === 0) {
      if (statusMessage) {
        statusMessage.textContent =
          "No hay órdenes para hoy con ese Crew y Celular.";
      }
      const resultsSection = document.getElementById("results");
      if (resultsSection) resultsSection.classList.add("hidden");
      saveState();
      return;
    }

    currentOrderId = orders[0].id;
    const ord = getCurrentOrder();
    if (ord) {
      renderResults(ord.data);
      scrollToFirstSlide();
    }

    if (statusMessage) {
      statusMessage.textContent =
        "Cargadas " +
        orders.length +
        " orden(es) para hoy desde el servidor.";
    }
    saveState();
  } catch (err) {
    console.error(err);
    if (statusMessage) {
      statusMessage.textContent =
        "Error cargando órdenes desde el servidor. Revisa el backend.";
    }
    alert(err.message);
  }
}

// ====== EVENTOS GLOBALES ======
document.getElementById("addOrderBtn").addEventListener("click", addOrderFromInput);
document.getElementById("resetOrdersBtn").addEventListener("click", resetAllOrders);

const loadFromServerBtn = document.getElementById("loadFromServerBtn");
if (loadFromServerBtn) {
  loadFromServerBtn.addEventListener("click", loadOrdersFromBackend);
}

document.getElementById("orderPrevBtn").addEventListener("click", () => {
  const idx = getCurrentOrderIndex();
  if (idx > 0) {
    selectOrder(orders[idx - 1].id);
    scrollToUserDetails();
  }
});

document.getElementById("orderNextBtn").addEventListener("click", () => {
  const idx = getCurrentOrderIndex();
  if (idx === -1) return;
  if (idx < orders.length - 1) {
    selectOrder(orders[idx + 1].id);
    scrollToUserDetails();
  }
});

document
  .getElementById("currentOrderDoneToggle")
  .addEventListener("click", () => {
    const ord = getCurrentOrder();
    if (!ord) return;
    toggleOrderCompleted(ord.id);
  });

// ====== INICIALIZACIÓN ======
attachCopyHandlers();
loadState();
loadDeviceConfig();

if (orders.length > 0) {
  renderOrderList();
  if (
    currentOrderId === null ||
    !orders.some(o => o.id === currentOrderId)
  ) {
    currentOrderId = orders[0].id;
  }
  const ord = getCurrentOrder();
  if (ord) {
    renderResults(ord.data);
    scrollToFirstSlide();
  }
}
