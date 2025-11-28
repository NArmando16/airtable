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

let lastParsed = null;

// Limpia bullets, tabs raros, etc.
function cleanLine(line) {
  if (!line) return "";
  return line
    .replace(/^[\u2022•\-\u25CF\*\s\t]+/, "") // bullets al inicio
    .replace(/\u2028|\u2029/g, " ") // separadores raros
    .replace(/\s+/g, " ")
    .trim();
}

function isSlideHeader(line, inSlidesSection) {
  const trimmed = line.trim();
  if (/^slide\b/i.test(trimmed)) return true;
  if (/^\[\s*slide\b.*\]$/i.test(trimmed)) return true;
  if (inSlidesSection) {
    const m = /^(\d{1,2})(?:[.)])?$/.exec(trimmed);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 50) return true;
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

  // Caption puede ser: "Caption:", "🖤caption:", "Tik Tok Caption:", "Tiktok Caption:", etc.
  const captionRegex = /^[^a-zA-Z0-9]*((tik\s*tok\s+caption)|(tiktok\s+caption)|caption)\b\s*:?\s*/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    const takeNext = (setter) => {
      if (i + 1 < lines.length) setter(cleanLine(lines[i + 1]));
    };

    // IDs / fechas / cuenta
    if (lower === "entregableid" || lower === "orderid") {
      takeNext(v => result.orderId = v);
    } else if (lower === "dia de entregable" || lower === "dia de orden") {
      takeNext(v => result.diaOrden = v);
    } else if (lower.endsWith("cuenta")) { // "Cuenta" o "1 Cuenta"
      takeNext(v => result.cuenta = v);
    } else if (lower === "crew" || lower.endsWith("crew")) {
      takeNext(v => result.crew = v);
    } else if (lower === "celular" || lower === "device") {
      takeNext(v => result.device = v);
    } else if (lower.startsWith("sound link")) {
      takeNext(v => result.soundLink = v);
    } else if (lower.startsWith("type of post")) {
      takeNext(v => result.typeOfPost = v);
    }

    if (/^text to use on post/i.test(line)) {
      inSlidesSection = true;
    }

    // Caption (incluye variantes con emojis y "Tik Tok Caption")
    if (captionRegex.test(line)) {
      let captionInline = line.replace(captionRegex, "").trim();
      captionInline = cleanLine(captionInline);
      if (captionInline) {
        result.caption = captionInline;
      } else if (i + 1 < lines.length) {
        result.caption = cleanLine(lines[i + 1]);
      }
    }

    // Slides
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
      takeNext(v => result.imageCategory = v);
    }

    // Imágenes (URLs bajo Link Cover Image / Images)
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
    }
  }

  return result;
}

async function copyToClipboard(text) {
  if (!text) return;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // ignore y fall back
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

function attachCopyHandlers() {
  // Solo botones globales (título, combo)
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
    };
  });
}

// Enfoca un slide (lo resalta y hace scroll suave)
function focusSlide(index) {
  const all = document.querySelectorAll(".slide-item");
  all.forEach(el => el.classList.remove("slide-active"));

  const target = document.getElementById("slideItem_" + index);
  if (target) {
    target.classList.add("slide-active");
    try {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      // por si el navegador no soporta scrollIntoView options
      target.scrollIntoView();
    }
  }
}

function renderResults(data) {
  const resultsSection = document.getElementById("results");
  const statusMessage = document.getElementById("statusMessage");
  resultsSection.classList.remove("hidden");

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

    const statusDot = document.createElement("span");
    statusDot.className = "slide-status";
    statusDot.id = "slideStatus_" + idx;

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.id = "slideCopyBtn_" + idx;
    copyBtn.textContent = "📋 Copiar slide";

    copyBtn.addEventListener("click", async () => {
      // SOLO el cuerpo del slide, sin la palabra "Slide"
      const textToCopy = slide.text || "";
      if (!textToCopy.trim()) return;
      await copyToClipboard(textToCopy);
      statusDot.classList.add("copied");
      const original = copyBtn.textContent;
      copyBtn.textContent = "✅ Copiado";
      setTimeout(() => {
        copyBtn.textContent = original;
      }, 1200);

      // Ir al siguiente slide automáticamente
      const nextIndex = idx + 1;
      if (nextIndex < data.slides.length) {
        focusSlide(nextIndex);
      }
    });

    header.appendChild(title);
    header.appendChild(statusDot);
    header.appendChild(copyBtn);

    const pre = document.createElement("pre");
    pre.id = slideId;
    pre.textContent = slide.text || "";

    wrap.appendChild(header);
    wrap.appendChild(pre);
    slidesContainer.appendChild(wrap);
  });

  // Imágenes (solo links)
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
  const combo = [
    data.caption || "",
    (data.genres || []).join("\n"),
    data.hashtags || ""
  ]
    .filter(s => s && s.trim())
    .join("\n\n");
  document.getElementById("comboField").textContent = combo;

  attachCopyHandlers();
  autoCopyFirstSlide(data);
}

// Copia automáticamente el Slide 1 al procesar (solo cuerpo)
async function autoCopyFirstSlide(data) {
  if (!data || !data.slides || !data.slides.length) return;
  const first = data.slides[0];

  // SOLO el cuerpo del slide
  const textToCopy = first.text || "";
  if (!textToCopy.trim()) return;

  // Copiar al portapapeles
  copyToClipboard(textToCopy);

  // Marcar visualmente el slide 1 como copiado
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

  // Enfocar el primer slide (el que vas a usar primero)
  focusSlide(0);
}

document.getElementById("processBtn").addEventListener("click", () => {
  const raw = document.getElementById("rawInput").value || "";
  const parsed = parseInput(raw);
  lastParsed = parsed;
  renderResults(parsed);
});

// Inicializa handlers globales (botones de copiar título/combo)
attachCopyHandlers();
