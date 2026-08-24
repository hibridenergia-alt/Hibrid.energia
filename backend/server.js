// ============================================================
// HiBRID — Tienda y Cotizador Energético
// Backend: Render (API real) | Sesión por Cookie | Tema claro/oscuro
// ============================================================

const API_URL = "https://hibrid-energia.onrender.com";
const WHATSAPP_NUMBER = "56956139055";
const THEME_KEY = "hibrid_theme";
const CART_KEY = "hibrid_cart";
const LOCAL_IMAGE_FALLBACK = "./paneles.jpg";
const ALLOWED_IMAGE_HOSTS = new Set([window.location.hostname]);

const ROUTES = new Set(["home", "calculator", "cart", "admin-login", "admin"]);

const categories = [
  { key:"all", label:"Todos", blurb:"Catálogo completo", image:"kitsolar.jpg" },
  { key:"principales", label:"Principales", blurb:"Equipos destacados", image:"kitsolar.jpg" },
  { key:"paneles", label:"Paneles", blurb:"Módulos solares", image:"paneles.jpg" },
  { key:"baterias", label:"Baterías", blurb:"Litio y respaldo", image:"bateria.jpg" },
  { key:"inversores", label:"Inversores", blurb:"Control y conversión", image:"inversor.jpg" },
  { key:"kits", label:"Kits solar", blurb:"Paquetes listos", image:"kitsolar.jpg" },
  { key:"eolico", label:"Eólica", blurb:"Energía del viento", image:"eolica.jpg" },
  { key:"otros", label:"Otros", blurb:"Focos, cables y más", image:"focosolar1.jpg" }
];

const PRODUCT_CATEGORIES = new Set(categories.filter(c => c.key !== "all").map(c => c.key));

const imageLibrary = {
  paneles:["panelescatalago.jpg","paneles.jpg"],
  baterias:["bateriacatalogo1.jpg","bateriadeyecatalogo.jpeg","bateriafcatalogo.jpeg","bateria.jpg"],
  inversores:["inversorcatalogo.png","inversordeyecatalogo.jpg","inversor.jpg"],
  kits:["kitsolar.jpg","panelescatalago.jpg","bateriacatalogo1.jpg","inversorcatalogo.png"],
  eolico:["aerogeneradorcatalogo1.jpg","aerogeneradorcatalogo2.jpg","eolica.jpg"],
  principales:["kitsolar.jpg","panelescatalago.jpg","bateriacatalogo1.jpg","inversorcatalogo.png","aerogeneradorcatalogo1.jpg"],
  otros:["focosolar1.jpg","focosolarproducto.jpeg","camarasproductos.jpeg"]
};

const PROJECT_PROFILES = {
  hogar: { label: "Residencial / Hogar", hsp: 4.5, efficiency: 0.80, note: "Estimación residencial de referencia." },
  comercial: { label: "Comercial / Negocio", hsp: 4.5, efficiency: 0.78, note: "Estimación comercial preliminar; requiere revisar demanda máxima y perfil horario." },
  parcela: { label: "Parcela / Off-Grid (Aislado)", hsp: 2.5, efficiency: 0.70, note: "Estimación aislada; requiere revisar invierno, generador y cargas críticas." }
};

const state = {
  route: "home",
  products: [],
  productsLoaded: false,
  cart: [],
  filterCategory: "all",
  adminUnlocked: false
};

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));

const els = {};
let lastFocusedElement = null;
const pendingActions = new Set();
const whatsappMessages = new Map();
let whatsappMessageId = 0;
let storageAvailable = true;
let refreshQueued = false;

function cacheEls(){
  [
    "categoryGrid","catalogGrid","catalogTitle","catalogMeta","clearFiltersBtn",
    "cartList","summaryBox","stickyCartCount","stickyCartTotal","whatsappBtn","clearCartBtn",
    "calcKwh","calcKwhOut","calcAutonomia","calcAutonomiaOut","calcTipo","calculateBtn","calcResult",
    "advancedToggle","advancedPanel",
    "adminPass","adminLoginBtn","loginError","adminLogoutBtn","adminFilter","adminInventoryList","btnOpenNewProduct",
    "productModal","btnCloseModal","modalForm","modalTitle","modalProductId","modalProductEtag","modalProductName",
    "modalProductCategory","modalProductPrice","modalProductDesc","modalProductImage","modalProductImageUrl",
    "modalGalleryGrid","modalPreviewBox","modalSubmitBtn","customImgToggle","customImgPanel",
    "statTotal","statVisible","statHidden","noticeStack","themeToggle","themeIcon"
  ].forEach(id => { els[id] = document.getElementById(id); });
}

// ---------- Utilidades de Sanitización y UI ----------
function escapeHtml(value){
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function normCat(v){ return String(v || "").trim().toLowerCase(); }

function formatPrice(value){
  return new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(Number(value || 0));
}

function normalizeImageInput(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("data:")) return "";
  try {
    const url = new URL(raw, window.location.href);
    if (url.origin === window.location.origin) return url.href;
    if (url.protocol === "https:" && ALLOWED_IMAGE_HOSTS.has(url.hostname)) return url.href;
    return "";
  } catch { return ""; }
}

function safeImageUrl(value) {
  return normalizeImageInput(value) || LOCAL_IMAGE_FALLBACK;
}

function productImage(product){
  return safeImageUrl(product?.image_url || product?.image || product?.imagen);
}

function getAllowedGalleryImage(value, category) {
  const candidate = String(value || "").replace(/^\.\//, "");
  const allowed = imageLibrary[normCat(category)] || [];
  return allowed.includes(candidate) ? candidate : "";
}

function getCategoryLabel(key){
  const cat = categories.find(item => item.key === key);
  return cat ? cat.label : key;
}

function showNotice(message, type="info"){
  const node = document.createElement("div");
  node.className = `notice ${escapeHtml(type)}`;
  const icon = type === "success" ? "fa-circle-check" : type === "error" ? "fa-triangle-exclamation" : "fa-circle-info";
  const title = type === "success" ? "Listo" : type === "error" ? "Revisa" : "Info";
  node.innerHTML = `<i class='fa-solid ${icon}'></i><div><strong>${title}</strong><div class='small muted' style='margin-top:.15rem'>${escapeHtml(message)}</div></div>`;
  if(els.noticeStack) els.noticeStack.appendChild(node);
  setTimeout(() => { node.style.opacity = "0"; node.style.transform = "translateY(-4px)"; }, 3200);
  setTimeout(() => { if(node.parentNode) node.remove(); }, 3800);
}

function scrollToElement(element) {
  if (!element) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
}

function scrollToTop() {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
}

async function runOnce(key, action) {
  if (pendingActions.has(key)) return;
  pendingActions.add(key);
  try { return await action(); } finally { pendingActions.delete(key); }
}

function openWhatsApp(message) {
  const number = String(WHATSAPP_NUMBER).replace(/[^\d]/g, "");
  const url = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (!popup) showNotice("El navegador bloqueó la ventana de WhatsApp. Permite ventanas emergentes.", "error");
}

function createWhatsAppButton(message, label) {
  const id = String(++whatsappMessageId);
  whatsappMessages.set(id, message);
  return `<button type="button" class="btn primary full js-whatsapp" style="margin-top:1rem" data-whatsapp-id="${escapeHtml(id)}"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i>&nbsp; ${escapeHtml(label)}</button>`;
}

// ---------- Tema claro/oscuro ----------
function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  const theme = saved === "light" || saved === "dark" ? saved : "dark";
  applyTheme(theme);
  if(els.themeToggle) els.themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(current === "dark" ? "light" : "dark");
  });
}
function applyTheme(theme){
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  if(els.themeIcon) els.themeIcon.className = "fa-solid " + (theme === "dark" ? "fa-moon" : "fa-sun");
}

// ---------- Red y Autenticación ----------
function getCsrfTokenFromNonHttpOnlyCookie() {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? match[1] : null;
}
function csrfHeaders() {
  const token = getCsrfTokenFromNonHttpOnlyCookie();
  return token ? { "X-CSRF-Token": token } : {};
}

async function apiFetch(path, options = {}) {
  const headers = { ...Object.assign({}, options.headers || {}), ...csrfHeaders() };
  try {
    const res = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });
    if (res.status === 401) { logoutAdmin(state.adminUnlocked); routeTo("admin-login"); return { ok: false, status: 401, unauthorized: true }; }
    if (res.status === 412) return { ok: false, status: 412, conflict: true };
    let data = null;
    try { data = res.status === 204 ? null : await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data };
  } catch (error) {
    return { ok: false, status: 0, networkError: true, error };
  }
}

function logoutAdmin(showMsg = false) {
  state.adminUnlocked = false;
  if (showMsg) showNotice("Tu sesión expiró. Ingresa de nuevo.", "error");
}

async function loginAdmin() {
  if (!els.adminPass) return;
  const token = els.adminPass.value.trim();
  if (!token) return;
  els.loginError.style.display = "none";
  els.adminLoginBtn.disabled = true;

  try {
    const res = await fetch(`${API_URL}/api/admin/session`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ token })
    });
    if (!res.ok) { els.loginError.style.display = "block"; return; }
    state.adminUnlocked = true;
    els.adminPass.value = "";
    routeTo("admin");
    showNotice("Acceso concedido.", "success");
    await fetchProducts({ automaticRetry: false });
  } catch {
    els.loginError.textContent = "No se pudo conectar con el servidor. Intenta de nuevo.";
    els.loginError.style.display = "block";
  } finally {
    els.adminLoginBtn.disabled = false;
  }
}

async function doLogout(){
  let result;
  try {
    result = await apiFetch("/api/admin/session", { method: "DELETE" });
  } catch {
    result = { ok: false, networkError: true };
  }
  logoutAdmin(false);
  routeTo("home");
  if (result.ok) showNotice("Sesión cerrada.", "info");
  else showNotice("Sesión local cerrada; no se pudo confirmar el cierre remoto.", "error");
}

// ---------- Carga y Normalización de productos ----------
function normalizeProduct(product) {
  if (!product || product.id == null) return null;
  const category = normCat(product.category);
  if (!PRODUCT_CATEGORIES.has(category)) return null;
  const price = Number(product.price);
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000) return null;

  return {
    ...product,
    id: String(product.id),
    name: String(product.name || "").trim().slice(0, 160),
    description: String(product.description || "").trim().slice(0, 1000),
    category,
    price: Math.round(price),
    visible: product.visible === true,
    etag: String(product.etag || "")
  };
}

let productsRequestId = 0;
let productsLoading = false;
let retryTimer = null;
let retryCount = 0;

async function fetchProducts({ automaticRetry = false } = {}) {
  if (productsLoading) {
    if (!automaticRetry) refreshQueued = true;
    return;
  }
  clearTimeout(retryTimer);
  retryTimer = null;
  if (!automaticRetry) retryCount = 0;
  
  productsLoading = true;
  const requestId = ++productsRequestId;
  renderCatalogLoading(automaticRetry ? "El servidor está despertando, esto puede tardar unos segundos…" : "Cargando catálogo…");

  try {
    const result = await apiFetch("/api/products");
    if (requestId !== productsRequestId) return;
    if (result.unauthorized) return;

    if (result.ok) {
      retryCount = 0;
      state.products = Array.isArray(result.data) ? result.data.map(normalizeProduct).filter(Boolean) : [];
      state.productsLoaded = true;
      renderAll();
      syncCart({ notify: true });
      updateCartStats();
      return;
    }

    if (retryCount < 3) {
      const delay = Math.min(30000, 3500 * (2 ** retryCount));
      retryCount += 1;
      retryTimer = setTimeout(() => fetchProducts({ automaticRetry: true }), delay);
      return;
    }
    state.productsLoaded = false;
    renderCatalogError();
  } finally {
    productsLoading = false;
    if (refreshQueued) {
      refreshQueued = false;
      queueMicrotask(() => fetchProducts({ automaticRetry: false }));
    }
  }
}

function renderCatalogLoading(message){
  if(els.catalogGrid) els.catalogGrid.innerHTML = `<div class='empty'><div class='spinner'></div><strong>${escapeHtml(message)}</strong><span class='small'>No cierres esta pestaña.</span></div>`;
}
function renderCatalogError(){
  if(els.catalogGrid) els.catalogGrid.innerHTML = `<div class='empty'><strong>No pudimos conectar con el servidor</strong><span class='small'>Verifica tu conexión e intenta de nuevo.</span><button class='btn primary small' type='button' id='retryFetchBtn'>Reintentar</button></div>`;
  const btn = document.getElementById("retryFetchBtn");
  if(btn) btn.addEventListener("click", () => fetchProducts({ automaticRetry: false }));
}

function renderAll() {
  renderCategoryButtons();
  renderCatalog();
  if (state.route === "cart") renderCart();
  if (state.route === "admin") renderAdmin();
}

// ---------- Enrutamiento ----------
function routeTo(route) {
  if (route === "admin-entry" || route === "admin") route = state.adminUnlocked ? "admin" : "admin-login";
  if (!ROUTES.has(route)) route = "home";
  
  state.route = route;
  $$(".view").forEach(view => view.classList.toggle("active", view.id === route));
  $$(".nav-btn").forEach(btn => {
    const target = btn.dataset.route === "admin-entry" ? (state.adminUnlocked ? "admin" : "admin-login") : btn.dataset.route;
    btn.classList.toggle("active", target === route);
  });
  if (route === "cart") renderCart();
  if (route === "admin") renderAdmin();
  scrollToTop();
}

// ---------- Catálogo ----------
function visibleProducts(){ return state.adminUnlocked && state.route === "admin" ? state.products : state.products.filter(item => item.visible === true); }
function filteredProducts(){ return visibleProducts().filter(item => state.filterCategory === "all" || normCat(item.category) === normCat(state.filterCategory)); }

function renderCategoryButtons(){
  if(!els.categoryGrid) return;
  let html = "";
  categories.forEach(cat => {
    const count = cat.key === "all" ? state.products.filter(p => p.visible === true).length : state.products.filter(p => normCat(p.category) === cat.key && p.visible === true).length;
    const activeClass = state.filterCategory === cat.key ? "active" : "";
    html += `<button class='category-card ${escapeHtml(activeClass)}' type='button' data-select-category='${escapeHtml(cat.key)}'>`;
    html += `<img src='${escapeHtml(safeImageUrl(cat.image))}' class='cat-img' alt='${escapeHtml(cat.label)}' loading='lazy' data-fallback='${escapeHtml(LOCAL_IMAGE_FALLBACK)}'>`;
    html += `<div class='cat-body'><strong>${escapeHtml(cat.label)}</strong><small>${escapeHtml(cat.blurb)}</small><span>${count} producto${count===1?"":"s"}</span></div></button>`;
  });
  els.categoryGrid.innerHTML = html;

  if(els.adminFilter){
    let opts = "<option value='all'>Todas las categorías</option>";
    categories.forEach(cat => { if(cat.key !== "all") opts += `<option value='${escapeHtml(cat.key)}'>${escapeHtml(cat.label)}</option>`; });
    els.adminFilter.innerHTML = opts;
  }
  if(els.modalProductCategory){
    let mOpts = "";
    categories.forEach(cat => { if(cat.key !== "all") mOpts += `<option value='${escapeHtml(cat.key)}'>${escapeHtml(cat.label)}</option>`; });
    els.modalProductCategory.innerHTML = mOpts;
  }
}

function renderCatalog(){
  if(!els.catalogGrid || !state.productsLoaded) return;
  const list = filteredProducts();

  if(els.catalogTitle) els.catalogTitle.textContent = state.filterCategory === "all" ? "Todos los productos" : `Mostrando: ${getCategoryLabel(state.filterCategory)}`;
  if(els.catalogMeta) els.catalogMeta.textContent = state.filterCategory === "all" ? "Catálogo completo." : "Filtrado por categoría.";
  if(els.clearFiltersBtn) els.clearFiltersBtn.style.display = state.filterCategory === "all" ? "none" : "inline-flex";

  if(list.length === 0){
    const noProductsAtAll = state.products.filter(p => p.visible).length === 0;
    if(noProductsAtAll) els.catalogGrid.innerHTML = `<div class='empty'><strong>Aún no hay productos publicados</strong><span class='small'>Ingresa al panel de administración para agregar el primero.</span><button class='btn primary small' type='button' data-route='admin-entry'>Ir a Admin</button></div>`;
    else els.catalogGrid.innerHTML = `<div class='empty'><strong>No hay productos en esta categoría</strong><span class='small'>Prueba con otra categoría o revisa el catálogo completo.</span></div>`;
    return;
  }

  let html = "";
  list.forEach(item => {
    const alt = escapeHtml(item.name || "Producto HiBRID");
    html += `<article class='product-card'><div class='product-media'><img src='${escapeHtml(productImage(item))}' alt='${alt}' loading='lazy' data-fallback='${escapeHtml(LOCAL_IMAGE_FALLBACK)}'></div>`;
    html += `<div class='product-body'><div class='product-top'><div><span class='badge${item.visible ? "" : " muted"}'>${escapeHtml(getCategoryLabel(item.category))}${item.visible ? "" : " · Oculto"}</span>`;
    html += `<h4 class='product-title' style='margin-top:.7rem'>${escapeHtml(item.name)}</h4></div><div class='price'>${formatPrice(item.price)}</div></div>`;
    html += `<p class='small muted'>${escapeHtml(item.description)}</p><button class='btn primary full' type='button' data-add='${escapeHtml(item.id)}'>Agregar al carrito</button></div></article>`;
  });
  els.catalogGrid.innerHTML = html;
}

// ---------- Carrito ----------
function normalizeQuantity(value) {
  const q = Number(value);
  if (!Number.isFinite(q)) return 0;
  return Math.min(999, Math.max(1, Math.floor(q)));
}

function normalizeCart(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Map();
  for (const row of value) {
    if (!row || row.id == null) continue;
    const id = String(row.id);
    const quantity = normalizeQuantity(row.quantity);
    if (!quantity) continue;
    seen.set(id, Math.min(999, (seen.get(id) || 0) + quantity));
  }
  return Array.from(seen, ([id, quantity]) => ({ id, quantity }));
}

function getProductById(id){ return state.products.find(item => String(item.id) === String(id)); }

function syncCart({ notify = false } = {}) {
  const previousLength = state.cart.length;
  state.cart = state.cart.filter(item => getProductById(item.id));
  const changed = state.cart.length !== previousLength;
  if (changed) {
    saveCartData();
    if (notify) showNotice("Algunos productos ya no están disponibles y fueron retirados.", "info");
  }
  return changed;
}

function saveCartData() {
  if (!storageAvailable) return;
  try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } 
  catch (error) { storageAvailable = false; console.warn("No se pudo persistir el carrito:", error); }
}

function loadCartData() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const parsed = JSON.parse(raw || "[]");
    state.cart = normalizeCart(parsed);
  } catch (error) {
    state.cart = []; storageAvailable = false; console.warn("No se pudo leer el carrito:", error);
  }
  saveCartData();
}

function detailedCart() {
  const validItems = [];
  for (const item of state.cart) {
    const product = getProductById(item.id);
    if (!product) continue;
    const quantity = normalizeQuantity(item.quantity);
    if (!quantity) continue;
    validItems.push({ id: String(item.id), quantity, product, subtotal: product.price * quantity });
  }
  return validItems;
}

function addToCart(id) {
  const product = getProductById(id);
  if (!product || product.visible !== true || !Number.isSafeInteger(product.price) || product.price < 0) {
    showNotice("Este producto ya no está disponible.", "error"); return;
  }
  const item = state.cart.find(row => String(row.id) === String(id));
  if (item) item.quantity = normalizeQuantity(item.quantity + 1);
  else state.cart.push({ id: String(id), quantity: 1 });
  
  saveCartData();
  updateCartStats();
  showNotice("Producto agregado al carrito.", "success");
}

function changeQty(id, delta){
  const item = state.cart.find(row => String(row.id) === String(id));
  if(!item) return;
  const newQ = item.quantity + delta;
  if(newQ <= 0) state.cart = state.cart.filter(row => String(row.id) !== String(id));
  else item.quantity = normalizeQuantity(newQ);
  saveCartData(); renderCart(); updateCartStats();
}

function removeFromCart(id){
  state.cart = state.cart.filter(item => String(item.id) !== String(id));
  saveCartData(); renderCart(); updateCartStats(); showNotice("Producto quitado del carrito.", "info");
}

function clearCart(){ state.cart = []; saveCartData(); renderCart(); updateCartStats(); showNotice("Carrito vaciado.", "info"); }

function renderCart(){
  if(!els.cartList || !els.summaryBox) return;
  const items = detailedCart();

  if(items.length === 0){
    els.cartList.innerHTML = `<div class='empty'><strong>Tu carrito está vacío</strong><span class='small'>Agrega productos desde el catálogo para cotizarlos aquí.</span><button class='btn primary small' type='button' data-route='home'>Ir al catálogo</button></div>`;
    els.summaryBox.innerHTML = `<div class='summary-line'><span>Productos</span><strong>0</strong></div><div class='summary-line'><span>Total</span><strong>${formatPrice(0)}</strong></div>`;
    return;
  }

  let html = "", totalUnits = 0, total = 0;
  items.forEach(item => {
    totalUnits += item.quantity; total += item.subtotal;
    const alt = escapeHtml(item.product?.name || item.name || "Producto HiBRID");
    html += `<article class='cart-item'><img src='${escapeHtml(productImage(item.product))}' alt='${alt}' loading='lazy' data-fallback='${escapeHtml(LOCAL_IMAGE_FALLBACK)}'>`;
    html += `<div><span class='badge'>${escapeHtml(getCategoryLabel(item.product.category))}</span><h4 style='margin-top:.6rem;font-weight:900'>${escapeHtml(item.product.name)}</h4>`;
    html += `<p class='small muted' style='margin-top:.3rem'>${escapeHtml(item.product.description)}</p><div class='qty-row'>`;
    html += `<button class='btn secondary small' type='button' data-qty='minus' data-id='${escapeHtml(item.id)}'>−</button>`;
    html += `<button class='btn secondary small' type='button' data-qty='plus' data-id='${escapeHtml(item.id)}'>+</button>`;
    html += `<button class='btn ghost small' type='button' data-remove='${escapeHtml(item.id)}'>Quitar</button></div></div>`;
    html += `<div style='text-align:right'><div class='tiny muted'>Cantidad: ${item.quantity}</div><div class='tiny muted' style='margin-top:.35rem'>Unitario: ${formatPrice(item.product.price)}</div>`;
    html += `<strong style='display:block;margin-top:.65rem'>${formatPrice(item.subtotal)}</strong></div></article>`;
  });
  els.cartList.innerHTML = html;
  els.summaryBox.innerHTML = `<div class='summary-line'><span>Líneas cotizadas</span><strong>${items.length}</strong></div><div class='summary-line'><span>Unidades totales</span><strong>${totalUnits}</strong></div><div class='summary-line'><span>Total estimado</span><strong>${formatPrice(total)}</strong></div>`;
}

function updateCartStats(){
  const items = detailedCart();
  let qty = 0, total = 0;
  items.forEach(item => { qty += item.quantity; total += item.subtotal; });
  if(els.stickyCartCount) els.stickyCartCount.textContent = qty + (qty === 1 ? " producto" : " productos");
  if(els.stickyCartTotal) els.stickyCartTotal.textContent = formatPrice(total);
}

function sendWhatsApp(){
  const items = detailedCart();
  if(items.length === 0){ showNotice("Primero agrega productos al carrito.", "error"); return; }
  let total = 0;
  let text = "Hola HiBRID, quiero más información sobre estos productos:\n\n";
  items.forEach((item, index) => {
    total += item.subtotal;
    text += `${index + 1}. ${item.product.name} | Cant: ${item.quantity} | Unitario: ${formatPrice(item.product.price)} | Subtotal: ${formatPrice(item.subtotal)}\n`;
  });
  text += `\nTotal estimado: ${formatPrice(total)}\n\nNota: Esta simulación y sus precios son estrictamente de referencia. La configuración final debe ser verificada por nuestro equipo técnico.`;
  openWhatsApp(text);
}

// ---------- Calculadora ----------
function initCalcInputs(){
  if(els.calcKwh) els.calcKwh.addEventListener("input", () => els.calcKwhOut.textContent = els.calcKwh.value);
  if(els.calcAutonomia) els.calcAutonomia.addEventListener("input", () => els.calcAutonomiaOut.textContent = els.calcAutonomia.value);
  if(els.advancedToggle) els.advancedToggle.addEventListener("click", () => {
    const open = els.advancedPanel.classList.toggle("open");
    els.advancedToggle.classList.toggle("open", open);
    els.advancedToggle.setAttribute("aria-expanded", String(open));
  });
}

function calculateSystem(){
  if(!els.calcKwh || !els.calcAutonomia || !els.calcTipo || !els.calcResult) return;

  const dailyKwh = Number(els.calcKwh.value || 0);
  const autonomyDays = Number(els.calcAutonomia.value || 1);
  const use = els.calcTipo.value;
  const enfoqueEl = document.querySelector('input[name="enfoque"]:checked');
  const enfoque = enfoqueEl ? enfoqueEl.value : "auto";

  if(!dailyKwh || dailyKwh <= 0){
    els.calcResult.innerHTML = "<p class='small' style='color:#e0524f;margin-top:1rem'>Ajusta el control de consumo diario para calcular.</p>";
    return;
  }

  const profile = PROJECT_PROFILES[use] || PROJECT_PROFILES.hogar;
  const panelPowerKw = 0.55;
  const areaPerPanel = 2.5;
  const requiredKw = dailyKwh / (profile.hsp * profile.efficiency);
  const panels = Math.max(1, Math.ceil(requiredKw / panelPowerKw));
  const totalInstalledKw = panels * panelPowerKw;
  const area = panels * areaPerPanel;

  const BATTERY_USABLE_FRACTION = 0.80;
  const DESIGN_MARGIN = 1.15;
  const BATTERY_UNIT_KWH = 5.12;
  const usableStorageKwh = dailyKwh * autonomyDays * DESIGN_MARGIN;
  const nominalBatteryKwh = usableStorageKwh / BATTERY_USABLE_FRACTION;
  const numBatteries = Math.max(1, Math.ceil(nominalBatteryKwh / BATTERY_UNIT_KWH));
  const batteryKwh = nominalBatteryKwh.toFixed(1);

  let inverterNote = "La potencia del inversor no puede definirse solo con el consumo diario.";
  if (totalInstalledKw <= 5) inverterNote = "Rango fotovoltaico preliminar: revisar inversor de 3–5 kW según demanda máxima.";
  else if (totalInstalledKw <= 10) inverterNote = "Rango fotovoltaico preliminar: revisar inversor de 6–8 kW según demanda máxima.";
  else inverterNote = "Evaluar configuración trifásica o inversores en paralelo con un técnico.";

  const wTextBase = `Hola HiBRID, usé su calculadora web.\nConsumo diario: ${dailyKwh} kWh\nAutonomía: ${autonomyDays} día(s)\nTipo de proyecto: ${profile.label}\n`;

  let html = "<div class='calc-result'>";

  if(enfoque === "rapida"){
    html += "<h4 style='margin-bottom:.7rem; color:var(--color-primary);'>Cotización rápida</h4>";
    html += `<div class='calc-grid'><div><strong>Potencia estimada:</strong><br>${totalInstalledKw.toFixed(2)} kWp (${panels} paneles)</div>`;
    html += `<div><strong>Baterías sugeridas:</strong><br>${batteryKwh} kWh de respaldo nominal</div></div>`;
    const wText = wTextBase + `\n*Cotización rápida — el equipo HiBRID confirma el detalle exacto.*`;
    html += createWhatsAppButton(wText, "Pedir precio ahora");
  } else {
    html += "<h4>Estimación preliminar</h4><p class='tiny muted' style='margin-bottom:1rem'>No reemplaza una evaluación eléctrica ni un estudio de cargas.</p>";
    html += `<div class='calc-grid'><div><strong>Paneles Solares:</strong><br>${panels} módulos de 550W<br><span class='tiny muted'>Potencia: ${totalInstalledKw.toFixed(2)} kWp</span></div>`;
    html += `<div><strong>Orientación de inversor:</strong><br><span class='tiny muted'>${escapeHtml(inverterNote)}</span></div>`;
    html += `<div><strong>Banco de Baterías:</strong><br>${numBatteries}x Litio 5.12kWh<br><span class='tiny muted'>Respaldo: ${batteryKwh} kWh</span></div>`;
    html += `<div><strong>Espacio en Techo:</strong><br>${area} m²<br><span class='tiny muted'>Área libre de sombras</span></div></div>`;
    html += `<p class="small muted" style="margin-top:1rem">${escapeHtml(profile.note)}</p>`;
    const wText = wTextBase + `Paneles: ${panels} x 550W (${totalInstalledKw.toFixed(2)} kWp)\nBaterías: ${numBatteries}x Litio 5.12kWh\n\n*Nota: simulación de referencia, requiere evaluación técnica.*`;
    html += createWhatsAppButton(wText, "Cotizar este sistema");
  }
  html += "</div>";
  els.calcResult.innerHTML = html;
}

// ---------- Admin ----------
function adminFilteredProducts(){
  const filter = els.adminFilter?.value || "all";
  if(filter === "all") return state.products.slice();
  return state.products.filter(item => normCat(item.category) === normCat(filter));
}

function renderAdmin(){
  if(!state.adminUnlocked || !els.adminInventoryList) return;
  if(els.statTotal) els.statTotal.textContent = state.products.length;
  if(els.statVisible) els.statVisible.textContent = state.products.filter(p => p.visible).length;
  if(els.statHidden) els.statHidden.textContent = state.products.filter(p => !p.visible).length;

  const list = adminFilteredProducts();
  if(list.length === 0){
    els.adminInventoryList.innerHTML = "<div class='empty'><strong>No hay productos en esta categoría</strong><span class='small'>Crea uno nuevo o cambia el filtro.</span></div>";
    return;
  }

  let html = "";
  list.forEach(item => {
    const alt = escapeHtml(item.name || "Producto HiBRID");
    html += `<div class='inv-item'><img src='${escapeHtml(productImage(item))}' alt='${alt}' data-fallback='${escapeHtml(LOCAL_IMAGE_FALLBACK)}'><div class='inv-info'><h4>${escapeHtml(item.name)}</h4>`;
    html += `<div class='tiny muted'>Cat: ${escapeHtml(getCategoryLabel(item.category))} | Precio: ${formatPrice(item.price)}</div></div><div class='inv-actions'>`;
    html += `<label class='switch' title='Activar/Ocultar'><input type='checkbox' data-toggle-id='${escapeHtml(item.id)}' ${item.visible ? "checked" : ""}><span class='slider'></span></label>`;
    html += `<button class='btn secondary small' type='button' data-edit-id='${escapeHtml(item.id)}'>Editar</button><button class='btn secondary small' type='button' data-duplicate-id='${escapeHtml(item.id)}'>Duplicar</button>`;
    html += `<button class='btn danger small' type='button' data-delete-id='${escapeHtml(item.id)}'><i class='fa-solid fa-trash'></i></button></div></div>`;
  });
  els.adminInventoryList.innerHTML = html;
}

async function toggleVisibility(id){
  return runOnce(`toggle:${id}`, async () => {
    const item = state.products.find(p => String(p.id) === String(id));
    if(!item) return;
    const requestedVisible = !item.visible;
    const result = await apiFetch(`/api/products/${id}/visibility`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "If-Match": item.etag || "" }, body: JSON.stringify({ visible: requestedVisible })
    });
    if(result.unauthorized) return;
    if(result.conflict){ showNotice("El producto cambió en otra sesión. Actualizando…", "error"); await fetchProducts({ automaticRetry: false }); return; }
    if(result.networkError || !result.ok){ showNotice("Error conectando con el servidor.", "error"); return; }
    
    const actualVisible = typeof result.data?.visible === "boolean" ? result.data.visible : requestedVisible;
    showNotice(actualVisible ? "Producto publicado." : "Producto oculto.", "success");
    await fetchProducts({ automaticRetry: false });
  });
}

async function duplicateProduct(id){
  return runOnce(`duplicate:${id}`, async () => {
    const original = state.products.find(p => String(p.id) === String(id));
    if(!original) return;
    const payload = { 
      name: original.name + " (Copia)", price: original.price, description: original.description, 
      category: original.category, image_url: productImage(original), visible: false 
    };
    const result = await apiFetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if(result.unauthorized) return;
    if(result.networkError || !result.ok){ showNotice("Error al duplicar.", "error"); return; }
    showNotice("Producto duplicado como borrador.", "success");
    await fetchProducts({ automaticRetry: false });
  });
}

async function deleteProductAction(id){
  if(!confirm("¿Eliminar permanentemente este producto del catálogo?")) return;
  return runOnce(`delete:${id}`, async () => {
    const item = state.products.find(p => String(p.id) === String(id));
    if(!item) return;
    const result = await apiFetch(`/api/products/${id}`, { method: "DELETE", headers: { "If-Match": item.etag || "" } });
    if(result.unauthorized) return;
    if(result.conflict){ showNotice("El producto cambió en otra sesión. Actualizando…", "error"); await fetchProducts({ automaticRetry: false }); return; }
    if(result.networkError || (!result.ok && result.status !== 204)){ showNotice("Error al eliminar.", "error"); return; }
    state.cart = state.cart.filter(row => String(row.id) !== String(id));
    saveCartData(); showNotice("Producto eliminado correctamente.", "success");
    await fetchProducts({ automaticRetry: false });
  });
}

// ---------- Modal producto y Focus Trap ----------
function getFocusable(container) {
  return $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', container);
}

function setBackgroundInert(value) {
  const background = [ document.querySelector(".topbar"), document.querySelector("#mainContent"), document.querySelector(".site-footer"), document.querySelector(".sticky-cart"), document.querySelector("#noticeStack") ];
  background.filter(Boolean).forEach(element => { element.inert = value; });
}

function trapModalFocus(event) {
  if (event.key !== "Tab" || !els.productModal?.classList.contains("active")) return;
  const focusable = getFocusable(els.productModal);
  if (!focusable.length) { event.preventDefault(); els.btnCloseModal.focus(); return; }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } 
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function openModal(productId = null){
  if(!els.productModal) return;
  let item = null;
  if(productId){
    item = state.products.find(product => String(product.id) === String(productId));
    if(!item){ showNotice("El producto ya no existe. Actualizando lista…", "error"); fetchProducts({ automaticRetry: false }); return; }
  }

  lastFocusedElement = document.activeElement;
  els.productModal.classList.add("active");
  els.productModal.setAttribute("aria-hidden", "false");
  setBackgroundInert(true);

  if(els.modalForm) els.modalForm.reset();
  els.customImgPanel.classList.remove("open");
  els.customImgToggle.classList.remove("open");
  els.customImgToggle.setAttribute("aria-expanded", "false");

  if(item){
    els.modalTitle.textContent = "Editar Producto";
    els.modalProductId.value = item.id;
    els.modalProductEtag.value = item.etag || "";
    els.modalProductName.value = item.name || "";
    els.modalProductCategory.value = normCat(item.category);
    els.modalProductPrice.value = Number(item.price) || 0;
    els.modalProductDesc.value = item.description || "";
    
    const currentImg = String(item.image_url || item.image || "").replace(/^\.\//, "");
    const library = imageLibrary[item.category] || [];
    if(currentImg && !library.includes(currentImg)){
      els.modalProductImage.value = library[0] || "";
      els.modalProductImageUrl.value = normalizeImageInput(currentImg);
      els.customImgPanel.classList.add("open");
      els.customImgToggle.classList.add("open");
    } else {
      els.modalProductImage.value = currentImg || library[0] || "";
      els.modalProductImageUrl.value = "";
    }
  } else {
    els.modalTitle.textContent = "Nuevo Producto";
    els.modalProductId.value = "";
    els.modalProductEtag.value = "";
    els.modalProductName.value = "";
    els.modalProductCategory.value = els.adminFilter?.value !== "all" ? els.adminFilter.value : "principales";
    els.modalProductPrice.value = "";
    els.modalProductDesc.value = "";
    els.modalProductImage.value = (imageLibrary[els.modalProductCategory.value] || ["paneles.jpg"])[0];
    els.modalProductImageUrl.value = "";
  }
  
  renderModalGallery();
  updateModalPreview();
  requestAnimationFrame(() => els.modalProductName?.focus());
}

function closeModal(){ 
  if(!els.productModal) return; 
  els.productModal.classList.remove("active");
  els.productModal.setAttribute("aria-hidden", "true");
  setBackgroundInert(false);
  if(lastFocusedElement && document.contains(lastFocusedElement)) lastFocusedElement.focus();
  lastFocusedElement = null;
}

async function saveModalProduct(e){
  e.preventDefault();
  return runOnce("saveModal", async () => {
    const idVal = els.modalProductId.value.trim();
    const isNew = idVal === "";
    
    const name = els.modalProductName.value.trim();
    const description = els.modalProductDesc.value.trim();
    const price = Number(els.modalProductPrice.value || 0);
    const category = els.modalProductCategory.value;
    
    const customImageInput = els.modalProductImageUrl.value.trim();
    let image;

    if (customImageInput) {
      image = normalizeImageInput(customImageInput);
      if (!image) { showNotice("La URL personalizada no es válida o no está permitida.", "error"); return; }
    } else {
      image = getAllowedGalleryImage(els.modalProductImage.value, category);
      if (!image) { showNotice("La imagen seleccionada no pertenece a la galería.", "error"); return; }
    }

    if(!name || !description){ showNotice("Nombre y descripción son obligatorios.", "error"); return; }
    if(!Number.isFinite(price) || price < 0){ showNotice("El precio no es válido.", "error"); return; }

    const existing = isNew ? null : state.products.find(p => String(p.id) === idVal);
    if(!isNew && !existing){ showNotice("Este producto ya no existe.", "error"); closeModal(); await fetchProducts({ automaticRetry: false }); return; }

    const payload = { name: name.slice(0, 160), description: description.slice(0, 1000), price, category: normCat(category), image, image_url: image, visible: isNew ? false : existing.visible };
    const url = isNew ? "/api/products" : `/api/products/${existing.id}`;
    const headers = { "Content-Type": "application/json" };
    if(!isNew) headers["If-Match"] = existing.etag || "";

    els.modalSubmitBtn.disabled = true;
    let result;
    try {
      result = await apiFetch(url, { method: isNew ? "POST" : "PATCH", headers, body: JSON.stringify(payload) });
    } catch (error) {
      showNotice("Ocurrió un error inesperado al guardar.", "error");
      return;
    } finally {
      els.modalSubmitBtn.disabled = false;
    }

    if(result.unauthorized) return;
    if(result.conflict){ showNotice("El producto cambió en otra sesión. Recarga e intenta de nuevo.", "error"); closeModal(); await fetchProducts({ automaticRetry: false }); return; }
    if(result.networkError || !result.ok){ showNotice("El servidor rechazó la operación.", "error"); return; }

    showNotice(isNew ? "Producto creado como borrador (oculto)." : "Producto actualizado.", "success");
    closeModal(); await fetchProducts({ automaticRetry: false });
  });
}

function renderModalGallery(){
  if(!els.modalGalleryGrid) return;
  const category = els.modalProductCategory.value || "principales";
  const images = imageLibrary[category] || [];
  const current = els.modalProductImage.value;
  let html = "";
  images.forEach(img => {
    const activeClass = current === img && !els.modalProductImageUrl.value ? "active" : "";
    const imgSrc = img.startsWith('http') ? img : './' + img;
    html += `<button class='gallery-item ${escapeHtml(activeClass)}' type='button' data-modal-img='${escapeHtml(img)}'>`;
    html += `<img src='${escapeHtml(imgSrc)}' loading='lazy' data-fallback='${escapeHtml(LOCAL_IMAGE_FALLBACK)}'></button>`;
  });
  els.modalGalleryGrid.innerHTML = images.length ? html : "<div class='small muted'>No hay imágenes para esta categoría.</div>";
}

function updateModalPreview(){
  if(!els.modalPreviewBox) return;
  const chosen = els.modalProductImageUrl.value.trim() || els.modalProductImage.value.trim();
  if(!chosen){ els.modalPreviewBox.innerHTML = "<div class='preview-empty'>Selecciona una imagen abajo</div>"; return; }
  const src = safeImageUrl(chosen);
  els.modalPreviewBox.innerHTML = `<img src='${escapeHtml(src)}' alt='Vista previa' data-fallback='${escapeHtml(LOCAL_IMAGE_FALLBACK)}'>`;
}

// ---------- Inicialización de Fallbacks Visuales ----------
function initLogoFallback() {
  const logo = document.getElementById("siteLogo");
  const logoFallback = document.getElementById("logoFallback");
  if (logo && logoFallback) {
    logo.addEventListener("error", () => { logo.hidden = true; logoFallback.style.display = "flex"; });
  }
}

function initStaticImageFallbacks() {
  document.querySelectorAll("img[data-static-fallback]").forEach(image => {
    image.addEventListener("error", () => {
      const replacement = document.createElement("div");
      replacement.className = "preview-empty";
      replacement.textContent = "Imagen de referencia no disponible";
      image.replaceWith(replacement);
    });
  });
}

function initWhatsAppLink() {
  const link = document.getElementById("headerWhatsappLink");
  if (!link) return;
  const number = WHATSAPP_NUMBER.replace(/\D/g, "");
  const message = encodeURIComponent("Hola HiBRID, quiero más información");
  link.href = `https://wa.me/${number}?text=${message}`;
}

// ---------- Listeners globales ----------
function bindEvents(){
  document.addEventListener("click", event => {
    const whatsapp = event.target.closest(".js-whatsapp");
    if (whatsapp) {
      const id = whatsapp.dataset.whatsappId;
      const message = whatsappMessages.get(id);
      if (!message) { showNotice("No se pudo preparar el mensaje de WhatsApp.", "error"); return; }
      openWhatsApp(message);
      whatsappMessages.delete(id);
      return;
    }

    const routeBtn = event.target.closest("[data-route]");
    if (routeBtn) { routeTo(routeBtn.dataset.route); return; }

    const catBtn = event.target.closest("[data-select-category]");
    if(catBtn){
      state.filterCategory = catBtn.dataset.selectCategory;
      renderCategoryButtons(); renderCatalog();
      if(state.route !== "home") routeTo("home");
      setTimeout(() => scrollToElement(document.getElementById("catalogMetaJump")), 50);
      return;
    }

    if(event.target.closest("#clearFiltersBtn")){ state.filterCategory = "all"; renderCategoryButtons(); renderCatalog(); return; }
    
    const addBtn = event.target.closest("[data-add]");
    if(addBtn) { addToCart(addBtn.dataset.add); return; }
    
    const qtyBtn = event.target.closest("[data-qty]");
    if(qtyBtn) { changeQty(qtyBtn.dataset.id, qtyBtn.dataset.qty === "plus" ? 1 : -1); return; }
    
    const removeBtn = event.target.closest("[data-remove]");
    if(removeBtn) { removeFromCart(removeBtn.dataset.remove); return; }
    
    const editBtn = event.target.closest("[data-edit-id]");
    if(editBtn) { openModal(editBtn.dataset.editId); return; }
    
    const dupBtn = event.target.closest("[data-duplicate-id]");
    if(dupBtn) { duplicateProduct(dupBtn.dataset.duplicateId); return; }
    
    const delBtn = event.target.closest("[data-delete-id]");
    if(delBtn) { deleteProductAction(delBtn.dataset.deleteId); return; }
    
    const modalImgBtn = event.target.closest("[data-modal-img]");
    if(modalImgBtn){
      els.modalProductImage.value = modalImgBtn.dataset.modalImg;
      els.modalProductImageUrl.value = "";
      renderModalGallery(); updateModalPreview();
      return;
    }
    
    if(event.target === els.productModal || event.target.closest("#btnCloseModal")) { closeModal(); return; }
    if(event.target.closest("#btnOpenNewProduct")) { openModal(null); return; }
  });

  document.addEventListener("change", (e) => {
    if(e.target.matches("[data-toggle-id]")) toggleVisibility(e.target.dataset.toggleId);
    if(e.target === els.modalProductCategory){
      const library = imageLibrary[els.modalProductCategory.value] || [];
      if(library.length && !library.includes(els.modalProductImage.value)) els.modalProductImage.value = library[0];
      els.modalProductImageUrl.value = ""; renderModalGallery(); updateModalPreview();
    }
    if(e.target === els.adminFilter) renderAdmin();
  });

  document.addEventListener("input", (e) => {
    if(e.target === els.modalProductImageUrl){ renderModalGallery(); updateModalPreview(); }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && els.productModal?.classList.contains("active")) { closeModal(); return; }
    trapModalFocus(event);
  });

  document.addEventListener("error", event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    if (image.dataset.fallbackApplied === "true") return;
    
    const fallback = String(image.dataset.fallback || "").trim();
    if (!fallback) return;

    image.dataset.fallbackApplied = "true";
    image.src = fallback;
  }, true);

  if(els.customImgToggle) els.customImgToggle.addEventListener("click", () => {
    const open = els.customImgPanel.classList.toggle("open");
    els.customImgToggle.classList.toggle("open", open);
    els.customImgToggle.setAttribute("aria-expanded", String(open));
  });

  if(els.whatsappBtn) els.whatsappBtn.addEventListener("click", sendWhatsApp);
  if(els.clearCartBtn) els.clearCartBtn.addEventListener("click", clearCart);
  if(els.calculateBtn) els.calculateBtn.addEventListener("click", calculateSystem);
  if(els.adminLoginBtn) els.adminLoginBtn.addEventListener("click", loginAdmin);
  if(els.adminPass) els.adminPass.addEventListener("keydown", e => { if(e.key === "Enter") loginAdmin(); });
  if(els.adminLogoutBtn) els.adminLogoutBtn.addEventListener("click", doLogout);
  if(els.modalForm) els.modalForm.addEventListener("submit", saveModalProduct);
}

// ---------- Init ----------
function init() {
  cacheEls();
  initTheme();
  initLogoFallback();
  initStaticImageFallbacks();
  initWhatsAppLink();
  bindEvents();
  initCalcInputs();
  loadCartData();
  renderCategoryButtons();
  fetchProducts({ automaticRetry: false });
  routeTo("home");
}

document.addEventListener("DOMContentLoaded", init);
