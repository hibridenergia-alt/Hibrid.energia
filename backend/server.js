// ============================================================
// HiBRID — Tienda y Cotizador Energético
// Backend: Render (API real) | Sin datos demo | Tema claro/oscuro
// ============================================================

const API_URL = "https://hibrid-energia.onrender.com";
const WHATSAPP_NUMBER = "56956139055";
const THEME_KEY = "hibrid_theme";
const TOKEN_KEY = "hibrid_token";
const CART_KEY = "hibrid_cart";

const categories = [
  { key:"principales", label:"Principales", blurb:"Equipos destacados", image:"kitsolar.jpg" },
  { key:"paneles", label:"Paneles", blurb:"Módulos solares", image:"paneles.jpg" },
  { key:"baterias", label:"Baterías", blurb:"Litio y respaldo", image:"bateria.jpg" },
  { key:"inversores", label:"Inversores", blurb:"Control y conversión", image:"inversor.jpg" },
  { key:"kits", label:"Kits solar", blurb:"Paquetes listos", image:"kitsolar.jpg" },
  { key:"eolico", label:"Eólica", blurb:"Energía del viento", image:"eolica.jpg" },
  { key:"otros", label:"Otros", blurb:"Focos, cables y más", image:"focosolar1.jpg" }
];

const imageLibrary = {
  paneles:["panelescatalago.jpg","paneles.jpg"],
  baterias:["bateriacatalogo1.jpg","bateriadeyecatalogo.jpeg","bateriafcatalogo.jpeg","bateria.jpg"],
  inversores:["inversorcatalogo.png","inversordeyecatalogo.jpg","inversor.jpg"],
  kits:["kitsolar.jpg","panelescatalago.jpg","bateriacatalogo1.jpg","inversorcatalogo.png"],
  eolico:["aerogeneradorcatalogo1.jpg","aerogeneradorcatalogo2.jpg","eolica.jpg"],
  principales:["kitsolar.jpg","panelescatalago.jpg","bateriacatalogo1.jpg","inversorcatalogo.png","aerogeneradorcatalogo1.jpg"],
  otros:["focosolar1.jpg","focosolarproducto.jpeg","camarasproductos.jpeg"]
};

const state = {
  route: "home",
  products: [],
  productsLoaded: false,
  cart: [],
  filterCategory: "all",
  adminUnlocked: false,
  adminToken: localStorage.getItem(TOKEN_KEY) || ""
};

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));

const els = {};
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

// ---------- Utilidades ----------
function escapeHtml(value){
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function normCat(v){ return String(v || "").trim().toLowerCase(); }

function formatPrice(value){
  return new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(Number(value || 0));
}

function slugify(text){
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,30);
}

function productImage(product){
  if(!product) return "./paneles.jpg";
  const img = product.image_url || product.image || product.imagen || "";
  if(!img) return "./paneles.jpg";
  if(/^(https?:)?\/\//.test(img) || img.startsWith('/') || img.startsWith('data:')) return img;
  return './' + img;
}

function getCategoryLabel(key){
  if(key === "all") return "Todos los productos";
  const cat = categories.find(item => item.key === key);
  return cat ? cat.label : key;
}

function showNotice(message, type="info"){
  const node = document.createElement("div");
  node.className = "notice " + type;
  const icon = type === "success" ? "fa-circle-check" : type === "error" ? "fa-triangle-exclamation" : "fa-circle-info";
  const title = type === "success" ? "Listo" : type === "error" ? "Revisa" : "Info";
  node.innerHTML = "<i class='fa-solid " + icon + "'></i><div><strong>" + title + "</strong><div class='small muted' style='margin-top:.15rem'>" + escapeHtml(message) + "</div></div>";
  if(els.noticeStack) els.noticeStack.appendChild(node);
  setTimeout(() => { node.style.opacity = "0"; node.style.transform = "translateY(-4px)"; }, 3200);
  setTimeout(() => { if(node.parentNode) node.remove(); }, 3800);
}

// ---------- Tema claro/oscuro ----------
function initTheme(){
  const saved = localStorage.getItem(THEME_KEY) || "dark";
  applyTheme(saved);
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

// ---------- Autenticación / fetch con manejo consistente de 401 ----------
function logoutAdmin(showMsg){
  state.adminUnlocked = false;
  state.adminToken = "";
  localStorage.removeItem(TOKEN_KEY);
  if(showMsg) showNotice("Tu sesión expiró. Ingresa de nuevo.", "error");
}

// Envuelve fetch: agrega Authorization, detecta 401 (fuerza logout) y 412 (conflicto de edición).
// Devuelve { ok, status, data, conflict, unauthorized } — nunca lanza por 401/412, sí por error de red.
async function apiFetch(path, options = {}){
  const headers = Object.assign({}, options.headers || {});
  if(state.adminToken) headers["Authorization"] = `Bearer ${state.adminToken}`;

  const res = await fetch(`${API_URL}${path}`, Object.assign({}, options, { headers }));

  if(res.status === 401){
    logoutAdmin(state.adminUnlocked); // solo avisa si realmente creía estar logueado
    routeTo("admin-login");
    return { ok:false, status:401, unauthorized:true };
  }
  if(res.status === 412){
    return { ok:false, status:412, conflict:true };
  }
  let data = null;
  try { data = res.status === 204 ? null : await res.json(); } catch(e) { data = null; }
  return { ok: res.ok, status: res.status, data };
}

// ---------- Carga de productos ----------
async function fetchProducts(isRetry){
  renderCatalogLoading(isRetry ? "El servidor está despertando, esto puede tardar unos segundos…" : "Cargando catálogo…");
  try{
    const result = await apiFetch("/api/products");
    if(result.unauthorized) return; // ya redirigido
    if(!result.ok){
      throw new Error("HTTP " + result.status);
    }
    state.products = Array.isArray(result.data) ? result.data : [];
    state.productsLoaded = true;
    renderAll();
    updateCartStats();
  }catch(err){
    if(!isRetry){
      setTimeout(() => fetchProducts(true), 3500);
    }else{
      state.productsLoaded = false;
      renderCatalogError();
    }
  }
}

function renderCatalogLoading(message){
  if(!els.catalogGrid) return;
  els.catalogGrid.innerHTML = "<div class='empty'><div class='spinner'></div><strong>" + escapeHtml(message) + "</strong><span class='small'>No cierres esta pestaña.</span></div>";
}
function renderCatalogError(){
  if(!els.catalogGrid) return;
  els.catalogGrid.innerHTML = "<div class='empty'><strong>No pudimos conectar con el servidor</strong><span class='small'>Verifica tu conexión e intenta de nuevo.</span><button class='btn primary small' type='button' id='retryFetchBtn'>Reintentar</button></div>";
  const btn = document.getElementById("retryFetchBtn");
  if(btn) btn.addEventListener("click", () => fetchProducts(false));
}

// ---------- Enrutamiento ----------
function routeTo(route){
  if(route === "admin-entry") route = state.adminUnlocked ? "admin" : "admin-login";
  state.route = route;

  $$(".view").forEach(view => view.classList.toggle("active", view.id === route));
  $$(".nav-btn").forEach(btn => {
    const target = btn.dataset.route === "admin-entry" ? (state.adminUnlocked ? "admin" : "admin-login") : btn.dataset.route;
    btn.classList.toggle("active", target === route);
  });

  if(route === "cart") renderCart();
  if(route === "admin") renderAdmin();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- Catálogo ----------
function visibleProducts(){
  if(state.adminUnlocked && state.route === "admin") return state.products;
  return state.products.filter(item => item.visible === true);
}

function filteredProducts(){
  return visibleProducts().filter(item => {
    if(state.filterCategory === "all") return true;
    return normCat(item.category) === normCat(state.filterCategory);
  });
}

function renderCategoryButtons(){
  if(!els.categoryGrid) return;
  let html = "";
  categories.forEach(cat => {
    const count = state.products.filter(item => normCat(item.category) === normCat(cat.key) && item.visible === true).length;
    const imgSrc = cat.image.startsWith('http') ? cat.image : './' + cat.image;
    const activeClass = state.filterCategory === cat.key ? "active" : "";
    html += "<button class='category-card " + activeClass + "' type='button' data-select-category='" + cat.key + "'>";
    html += "<img src='" + imgSrc + "' class='cat-img' alt='" + cat.label + "' loading='lazy' onerror=\"this.onerror=null;this.src='https://via.placeholder.com/400x300?text=HiBRID';\">";
    html += "<div class='cat-body'><strong>" + cat.label + "</strong><small>" + cat.blurb + "</small><span>" + count + " producto" + (count===1?"":"s") + "</span></div></button>";
  });
  els.categoryGrid.innerHTML = html;

  if(els.adminFilter){
    let opts = "<option value='all'>Todas las categorías</option>";
    categories.forEach(cat => { opts += "<option value='" + cat.key + "'>" + cat.label + "</option>"; });
    els.adminFilter.innerHTML = opts;
  }
  if(els.modalProductCategory){
    let mOpts = "";
    categories.forEach(cat => { mOpts += "<option value='" + cat.key + "'>" + cat.label + "</option>"; });
    els.modalProductCategory.innerHTML = mOpts;
  }
}

function renderCatalog(){
  if(!els.catalogGrid) return;
  if(!state.productsLoaded) return; // el loading/error ya está pintado por fetchProducts

  const list = filteredProducts();

  if(els.catalogTitle) els.catalogTitle.textContent = state.filterCategory === "all" ? "Todos los productos" : "Mostrando: " + getCategoryLabel(state.filterCategory);
  if(els.catalogMeta) els.catalogMeta.textContent = state.filterCategory === "all" ? "Catálogo completo." : "Filtrado por categoría.";
  if(els.clearFiltersBtn) els.clearFiltersBtn.style.display = state.filterCategory === "all" ? "none" : "inline-flex";

  if(list.length === 0){
    const noProductsAtAll = state.products.filter(p => p.visible).length === 0;
    if(noProductsAtAll){
      els.catalogGrid.innerHTML = "<div class='empty'><strong>Aún no hay productos publicados</strong><span class='small'>Ingresa al panel de administración para agregar el primero.</span><button class='btn primary small' type='button' data-route='admin-entry'>Ir a Admin</button></div>";
    }else{
      els.catalogGrid.innerHTML = "<div class='empty'><strong>No hay productos en esta categoría</strong><span class='small'>Prueba con otra categoría o revisa el catálogo completo.</span></div>";
    }
    return;
  }

  let html = "";
  list.forEach(item => {
    html += "<article class='product-card'>";
    html += "<div class='product-media'><img src='" + escapeHtml(productImage(item)) + "' alt='" + escapeHtml(item.name) + "' loading='lazy' onerror=\"this.onerror=null;this.src='https://via.placeholder.com/400x300?text=HiBRID';\"></div>";
    html += "<div class='product-body'><div class='product-top'><div><span class='badge" + (item.visible ? "" : " muted") + "'>" + getCategoryLabel(item.category) + (item.visible ? "" : " · Oculto") + "</span>";
    html += "<h4 class='product-title' style='margin-top:.7rem'>" + escapeHtml(item.name) + "</h4></div>";
    html += "<div class='price'>" + formatPrice(item.price) + "</div></div>";
    html += "<p class='small muted'>" + escapeHtml(item.description) + "</p>";
    html += "<button class='btn primary full' type='button' data-add='" + escapeHtml(item.id) + "'>Agregar al carrito</button>";
    html += "</div></article>";
  });
  els.catalogGrid.innerHTML = html;
}

// ---------- Carrito ----------
function getProductById(id){ return state.products.find(item => item.id === id); }
function syncCart(){ state.cart = state.cart.filter(item => getProductById(item.id)); }

function loadCartData(){
  const stored = localStorage.getItem(CART_KEY);
  try{
    const parsed = stored ? JSON.parse(stored) : [];
    state.cart = Array.isArray(parsed) ? parsed : [];
  }catch(e){ state.cart = []; }
}
function saveCartData(){ localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); }

function detailedCart(){
  syncCart();
  const result = [];
  state.cart.forEach(item => {
    const product = getProductById(item.id);
    if(product) result.push({ id:item.id, quantity:item.quantity, product, subtotal:(product.price || 0) * item.quantity });
  });
  return result;
}

function addToCart(id){
  const item = state.cart.find(row => row.id === id);
  if(item) item.quantity += 1; else state.cart.push({ id, quantity:1 });
  saveCartData();
  updateCartStats();
  showNotice("Producto agregado al carrito.", "success");
}

function changeQty(id, delta){
  const item = state.cart.find(row => row.id === id);
  if(!item) return;
  item.quantity += delta;
  if(item.quantity <= 0) state.cart = state.cart.filter(row => row.id !== id);
  saveCartData(); renderCart(); updateCartStats();
}

function removeFromCart(id){
  state.cart = state.cart.filter(item => item.id !== id);
  saveCartData(); renderCart(); updateCartStats();
  showNotice("Producto quitado del carrito.", "info");
}

function clearCart(){
  state.cart = [];
  saveCartData(); renderCart(); updateCartStats();
  showNotice("Carrito vaciado.", "info");
}

function renderCart(){
  if(!els.cartList || !els.summaryBox) return;
  const items = detailedCart();

  if(items.length === 0){
    els.cartList.innerHTML = "<div class='empty'><strong>Tu carrito está vacío</strong><span class='small'>Agrega productos desde el catálogo para cotizarlos aquí.</span><button class='btn primary small' type='button' data-route='home'>Ir al catálogo</button></div>";
    els.summaryBox.innerHTML = "<div class='summary-line'><span>Productos</span><strong>0</strong></div><div class='summary-line'><span>Total</span><strong>" + formatPrice(0) + "</strong></div>";
    return;
  }

  let html = "";
  items.forEach(item => {
    html += "<article class='cart-item'>";
    html += "<img src='" + escapeHtml(productImage(item.product)) + "' alt='img' loading='lazy' onerror=\"this.onerror=null;this.src='https://via.placeholder.com/400x300?text=HiBRID';\">";
    html += "<div><span class='badge'>" + getCategoryLabel(item.product.category) + "</span>";
    html += "<h4 style='margin-top:.6rem;font-weight:900'>" + escapeHtml(item.product.name) + "</h4>";
    html += "<p class='small muted' style='margin-top:.3rem'>" + escapeHtml(item.product.description) + "</p>";
    html += "<div class='qty-row'>";
    html += "<button class='btn secondary small' type='button' data-qty='minus' data-id='" + escapeHtml(item.id) + "'>−</button>";
    html += "<button class='btn secondary small' type='button' data-qty='plus' data-id='" + escapeHtml(item.id) + "'>+</button>";
    html += "<button class='btn ghost small' type='button' data-remove='" + escapeHtml(item.id) + "'>Quitar</button>";
    html += "</div></div>";
    html += "<div style='text-align:right'><div class='tiny muted'>Cantidad: " + item.quantity + "</div>";
    html += "<div class='tiny muted' style='margin-top:.35rem'>Unitario: " + formatPrice(item.product.price) + "</div>";
    html += "<strong style='display:block;margin-top:.65rem'>" + formatPrice(item.subtotal) + "</strong></div></article>";
  });
  els.cartList.innerHTML = html;

  let totalUnits = 0, total = 0;
  items.forEach(item => { totalUnits += item.quantity; total += item.subtotal; });

  els.summaryBox.innerHTML =
    "<div class='summary-line'><span>Líneas cotizadas</span><strong>" + items.length + "</strong></div>" +
    "<div class='summary-line'><span>Unidades totales</span><strong>" + totalUnits + "</strong></div>" +
    "<div class='summary-line'><span>Total estimado</span><strong>" + formatPrice(total) + "</strong></div>";
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
    text += (index + 1) + ". " + item.product.name + " | Cant: " + item.quantity + " | Unitario: " + formatPrice(item.product.price) + " | Subtotal: " + formatPrice(item.subtotal) + "\n";
  });
  text += "\nTotal estimado: " + formatPrice(total) + "\n\nNota: Esta simulación y sus precios son estrictamente de referencia. La configuración final debe ser verificada por nuestro equipo técnico.";
  window.open("https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(text), "_blank", "noopener");
}

// ---------- Calculadora combinada (consumo diario + autonomía + tipo + enfoque) ----------
function initCalcInputs(){
  if(els.calcKwh) els.calcKwh.addEventListener("input", () => { els.calcKwhOut.textContent = els.calcKwh.value; });
  if(els.calcAutonomia) els.calcAutonomia.addEventListener("input", () => { els.calcAutonomiaOut.textContent = els.calcAutonomia.value; });
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

  let hsp = 4.5, efficiency = 0.80;
  if(use === "parcela"){ hsp = 2.5; efficiency = 0.70; }

  const panelPowerKw = 0.55;
  const areaPerPanel = 2.5;

  const requiredKw = dailyKwh / (hsp * efficiency);
  let panels = Math.ceil(requiredKw / panelPowerKw);
  if(panels < 1) panels = 1;

  const totalInstalledKw = panels * panelPowerKw;
  const area = panels * areaPerPanel;
  const batteryKwh = (dailyKwh * autonomyDays).toFixed(1);
  let numBatteries = Math.ceil(batteryKwh / 5.12);
  if(numBatteries < 1) numBatteries = 1;

  let inverter = "Inversor Monofásico 3kW - 5kW";
  if(totalInstalledKw > 5 && totalInstalledKw <= 10) inverter = "Inversor Monofásico 8kW u Off-Grid 6kW";
  if(totalInstalledKw > 10) inverter = "Inversores en Paralelo o Sistema Trifásico";

  let useNote = "Cálculo On-Grid/Híbrido: dimensionado con el promedio solar de la zona.";
  if(use === "parcela") useNote = "Cálculo Off-Grid/Aislado: dimensionado para funcionar de forma estable incluso en meses de invierno.";

  const wTextBase = `Hola HiBRID, usé su calculadora web.\nConsumo diario: ${dailyKwh} kWh\nAutonomía: ${autonomyDays} día(s)\nTipo de proyecto: ${use}\n`;

  let html = "<div class='calc-result'>";

  if(enfoque === "rapida"){
    html += "<h4 style='margin-bottom:.7rem; color:var(--color-primary);'>Cotización rápida</h4>";
    html += "<div class='calc-grid'>";
    html += "<div><strong>Potencia estimada:</strong><br>" + totalInstalledKw.toFixed(2) + " kWp (" + panels + " paneles)</div>";
    html += "<div><strong>Baterías sugeridas:</strong><br>" + batteryKwh + " kWh de respaldo</div>";
    html += "</div>";
    const wText = wTextBase + `\n*Cotización rápida — el equipo HiBRID confirma el detalle exacto.*`;
    html += `<button type='button' class='btn primary full' style='margin-top:1rem;' onclick="window.open('https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(wText)}', '_blank')"><i class="fa-brands fa-whatsapp"></i>&nbsp; Pedir precio ahora</button>`;
  } else {
    html += "<h4 style='margin-bottom:.7rem; color:var(--color-primary);'>Solución recomendada</h4>";
    html += "<p class='small' style='margin-bottom:1rem'>Para un consumo de <strong>" + dailyKwh + " kWh/día</strong>:</p>";
    html += "<div class='calc-grid'>";
    html += "<div><strong>Paneles Solares:</strong><br>" + panels + " módulos de 550W<br><span class='tiny muted'>Potencia: " + totalInstalledKw.toFixed(2) + " kWp</span></div>";
    html += "<div><strong>Inversor Sugerido:</strong><br>" + inverter + "<br><span class='tiny muted'>Según capacidad</span></div>";
    html += "<div><strong>Banco de Baterías:</strong><br>" + numBatteries + "x Litio 5.12kWh<br><span class='tiny muted'>Respaldo: " + batteryKwh + " kWh</span></div>";
    html += "<div><strong>Espacio en Techo:</strong><br>" + area + " m²<br><span class='tiny muted'>Área libre de sombras</span></div>";
    html += "</div><p class='small muted' style='margin-top:1rem'>" + useNote + "</p>";
    const wText = wTextBase + `Paneles: ${panels} x 550W (${totalInstalledKw.toFixed(2)} kWp)\nInversor: ${inverter}\nBaterías: ${numBatteries}x Litio 5.12kWh\n\n*Nota: simulación de referencia, requiere evaluación técnica.*`;
    html += `<button type='button' class='btn primary full' style='margin-top:1rem;' onclick="window.open('https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(wText)}', '_blank')"><i class="fa-brands fa-whatsapp"></i>&nbsp; Cotizar este sistema por WhatsApp</button>`;
  }

  html += "<p class='tiny muted' style='margin-top:1rem; border-top:1px solid var(--color-border); padding-top:.5rem;'>Esta simulación y sus precios son estrictamente de referencia.</p></div>";
  els.calcResult.innerHTML = html;
}

// ---------- Admin: listado ----------
function adminFilteredProducts(){
  if(!els.adminFilter) return state.products.slice();
  const filter = els.adminFilter.value || "all";
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
    const isChecked = item.visible ? "checked" : "";
    html += "<div class='inv-item'>";
    html += "<img src='" + escapeHtml(productImage(item)) + "' alt='img' onerror=\"this.onerror=null;this.src='https://via.placeholder.com/400x300?text=HiBRID';\">";
    html += "<div class='inv-info'><h4>" + escapeHtml(item.name) + "</h4>";
    html += "<div class='tiny muted'>Cat: " + getCategoryLabel(item.category) + " | Precio: " + formatPrice(item.price) + "</div></div>";
    html += "<div class='inv-actions'>";
    html += "<label class='switch' title='Activar/Ocultar'><input type='checkbox' data-toggle-id='" + escapeHtml(item.id) + "' " + isChecked + "><span class='slider'></span></label>";
    html += "<button class='btn secondary small' type='button' data-edit-id='" + escapeHtml(item.id) + "'>Editar</button>";
    html += "<button class='btn secondary small' type='button' data-duplicate-id='" + escapeHtml(item.id) + "'>Duplicar</button>";
    html += "<button class='btn danger small' type='button' data-delete-id='" + escapeHtml(item.id) + "'><i class='fa-solid fa-trash'></i></button>";
    html += "</div></div>";
  });
  els.adminInventoryList.innerHTML = html;
}

// ---------- Admin: acciones (todas usan apiFetch → 401/412 consistentes) ----------
async function toggleVisibility(id){
  const item = state.products.find(p => p.id === id);
  if(!item) return;
  const result = await apiFetch(`/api/products/${id}/visibility`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "If-Match": item.etag || "" },
    body: JSON.stringify({ visible: !item.visible })
  });
  if(result.unauthorized) return;
  if(result.conflict){ showNotice("El producto cambió en otra sesión. Actualizando…", "error"); await fetchProducts(false); return; }
  if(!result.ok){ showNotice("Error cambiando visibilidad.", "error"); return; }
  showNotice(!item.visible ? "Producto publicado." : "Producto oculto.", "info");
  await fetchProducts(false);
}

async function duplicateProduct(id){
  const original = state.products.find(p => p.id === id);
  if(!original) return;
  const img = original.image_url || original.image;
  const payload = {
    name: original.name + " (Copia)", price: original.price, description: original.description,
    category: original.category, image: img, image_url: img, visible: false
  };
  const result = await apiFetch("/api/products", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  if(result.unauthorized) return;
  if(!result.ok){ showNotice("Error al duplicar.", "error"); return; }
  showNotice("Producto duplicado como borrador.", "success");
  await fetchProducts(false);
}

async function deleteProductAction(id){
  if(!confirm("¿Eliminar permanentemente este producto del catálogo?")) return;
  const item = state.products.find(p => p.id === id);
  if(!item) return;
  const result = await apiFetch(`/api/products/${id}`, {
    method: "DELETE", headers: { "If-Match": item.etag || "" }
  });
  if(result.unauthorized) return;
  if(!result.ok && result.status !== 204){ showNotice("Error al eliminar.", "error"); return; }
  state.cart = state.cart.filter(row => row.id !== id);
  saveCartData();
  showNotice("Producto eliminado correctamente.", "success");
  await fetchProducts(false);
}

async function saveModalProduct(e){
  e.preventDefault();
  const idVal = els.modalProductId.value.trim();
  const isNew = idVal === "";

  const name = els.modalProductName.value.trim();
  const description = els.modalProductDesc.value.trim();
  const price = Number(els.modalProductPrice.value || 0);
  const category = els.modalProductCategory.value;
  const galleryImage = els.modalProductImage.value.trim();
  const customImage = els.modalProductImageUrl.value.trim();
  const image = customImage !== "" ? customImage : galleryImage;

  if(!name || !description){ showNotice("Nombre y descripción son obligatorios.", "error"); return; }
  if(!Number.isFinite(price) || price < 0){ showNotice("El precio no es válido.", "error"); return; }
  if(!image){ showNotice("Selecciona una imagen antes de guardar.", "error"); return; }

  const existing = isNew ? null : state.products.find(p => p.id === idVal);
  if(!isNew && !existing){
    showNotice("Este producto ya no existe. Actualizando lista…", "error");
    closeModal(); await fetchProducts(false); return;
  }

  const payload = { name, description, price, category, image, image_url: image, visible: isNew ? false : existing.visible };
  const url = isNew ? "/api/products" : `/api/products/${existing.id}`;
  const headers = { "Content-Type": "application/json" };
  if(!isNew) headers["If-Match"] = existing.etag || "";

  els.modalSubmitBtn.disabled = true;
  const result = await apiFetch(url, { method: isNew ? "POST" : "PATCH", headers, body: JSON.stringify(payload) });
  els.modalSubmitBtn.disabled = false;

  if(result.unauthorized) return;
  if(result.conflict){ showNotice("El producto cambió en otra sesión. Recarga e intenta de nuevo.", "error"); closeModal(); await fetchProducts(false); return; }
  if(!result.ok){ showNotice("El servidor rechazó la operación.", "error"); return; }

  showNotice(isNew ? "Producto creado como borrador (oculto). Actívalo cuando esté listo." : "Producto actualizado.", "success");
  closeModal();
  await fetchProducts(false);
}

async function loginAdmin(){
  if(!els.adminPass) return;
  const token = els.adminPass.value.trim();
  if(!token) return;
  els.loginError.style.display = "none";
  els.adminLoginBtn.disabled = true;

  try{
    const res = await fetch(`${API_URL}/api/admin/session`, { headers: { Authorization: `Bearer ${token}` } });
    els.adminLoginBtn.disabled = false;
    if(!res.ok){ els.loginError.style.display = "block"; return; }

    state.adminUnlocked = true;
    state.adminToken = token;
    localStorage.setItem(TOKEN_KEY, token);
    els.adminPass.value = "";
    routeTo("admin");
    showNotice("Acceso concedido.", "success");
    await fetchProducts(false);
  }catch(err){
    els.adminLoginBtn.disabled = false;
    els.loginError.textContent = "No se pudo conectar con el servidor. Intenta de nuevo.";
    els.loginError.style.display = "block";
  }
}

function doLogout(){
  logoutAdmin(false);
  routeTo("home");
  showNotice("Sesión cerrada.", "info");
}

// ---------- Modal producto ----------
function openModal(productId){
  if(!els.productModal) return;
  els.productModal.classList.add("active");
  els.customImgPanel.classList.remove("open");
  els.customImgToggle.classList.remove("open");
  els.customImgToggle.setAttribute("aria-expanded", "false");

  if(productId){
    const item = state.products.find(p => p.id === productId);
    if(!item) return;
    els.modalTitle.textContent = "Editar Producto";
    els.modalProductId.value = item.id;
    els.modalProductEtag.value = item.etag || "";
    els.modalProductName.value = item.name;
    els.modalProductCategory.value = item.category;
    els.modalProductPrice.value = item.price;
    els.modalProductDesc.value = item.description;

    const currentImg = (item.image_url || item.image || "").replace(/^\.\//, "");
    const library = imageLibrary[item.category] || [];
    if(currentImg && !library.includes(currentImg)){
      els.modalProductImage.value = library[0] || currentImg;
      els.modalProductImageUrl.value = currentImg;
      els.customImgPanel.classList.add("open");
      els.customImgToggle.classList.add("open");
    }else{
      els.modalProductImage.value = currentImg || (library[0] || "");
      els.modalProductImageUrl.value = "";
    }
  }else{
    els.modalTitle.textContent = "Nuevo Producto";
    els.modalProductId.value = "";
    els.modalProductEtag.value = "";
    els.modalProductName.value = "";
    const defaultCat = (els.adminFilter && els.adminFilter.value !== "all") ? els.adminFilter.value : "principales";
    els.modalProductCategory.value = defaultCat;
    els.modalProductPrice.value = "";
    els.modalProductDesc.value = "";
    const fallback = (imageLibrary[defaultCat] || ["paneles.jpg"])[0];
    els.modalProductImage.value = fallback;
    els.modalProductImageUrl.value = "";
  }
  renderModalGallery();
  updateModalPreview();
}

function closeModal(){ if(els.productModal) els.productModal.classList.remove("active"); }

function renderModalGallery(){
  if(!els.modalGalleryGrid) return;
  const category = els.modalProductCategory.value || "principales";
  const images = imageLibrary[category] || [];
  const current = els.modalProductImage.value;

  let html = "";
  images.forEach(img => {
    const activeClass = current === img && !els.modalProductImageUrl.value ? "active" : "";
    const imgSrc = img.startsWith('http') ? img : './' + img;
    html += "<button class='gallery-item " + activeClass + "' type='button' data-modal-img='" + escapeHtml(img) + "'>";
    html += "<img src='" + escapeHtml(imgSrc) + "' loading='lazy' onerror=\"this.onerror=null;this.src='https://via.placeholder.com/200x200?text=HiBRID';\"></button>";
  });
  els.modalGalleryGrid.innerHTML = images.length ? html : "<div class='small muted'>No hay imágenes para esta categoría. Usa una URL personalizada.</div>";
}

function updateModalPreview(){
  if(!els.modalPreviewBox) return;
  const custom = els.modalProductImageUrl.value.trim();
  const chosen = custom || els.modalProductImage.value.trim();
  if(!chosen){ els.modalPreviewBox.innerHTML = "<div class='preview-empty'>Selecciona una imagen abajo</div>"; return; }
  const src = /^(https?:)?\/\//.test(chosen) || chosen.startsWith('/') ? chosen : './' + chosen;
  els.modalPreviewBox.innerHTML = "<img src='" + escapeHtml(src) + "' alt='Vista previa' onerror=\"this.parentElement.innerHTML='<div class=&quot;preview-empty&quot;>No se pudo cargar esta imagen — revisa el nombre o la URL</div>';\">";
}

// ---------- Render maestro ----------
function renderAll(){
  renderCategoryButtons();
  renderCatalog();
  renderCart();
  if(state.adminUnlocked) renderAdmin();
}

// ---------- Listeners globales ----------
function bindEvents(){
  document.addEventListener("click", (event) => {
    const routeBtn = event.target.closest("[data-route]");
    if(routeBtn) routeTo(routeBtn.dataset.route);

    const catBtn = event.target.closest("[data-select-category]");
    if(catBtn){
      state.filterCategory = catBtn.dataset.selectCategory;
      renderCategoryButtons(); renderCatalog();
      if(state.route !== "home") routeTo("home");
      setTimeout(() => {
        const sect = document.getElementById("catalogMetaJump");
        if(sect) sect.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }

    if(event.target.closest("#clearFiltersBtn")){
      state.filterCategory = "all";
      renderCategoryButtons(); renderCatalog();
    }

    const addBtn = event.target.closest("[data-add]");
    if(addBtn) addToCart(addBtn.dataset.add);

    const qtyBtn = event.target.closest("[data-qty]");
    if(qtyBtn) changeQty(qtyBtn.dataset.id, qtyBtn.dataset.qty === "plus" ? 1 : -1);

    const removeBtn = event.target.closest("[data-remove]");
    if(removeBtn) removeFromCart(removeBtn.dataset.remove);

    const editBtn = event.target.closest("[data-edit-id]");
    if(editBtn) openModal(editBtn.dataset.editId);

    const dupBtn = event.target.closest("[data-duplicate-id]");
    if(dupBtn) duplicateProduct(dupBtn.dataset.duplicateId);

    const delBtn = event.target.closest("[data-delete-id]");
    if(delBtn) deleteProductAction(delBtn.dataset.deleteId);

    const modalImgBtn = event.target.closest("[data-modal-img]");
    if(modalImgBtn){
      els.modalProductImage.value = modalImgBtn.dataset.modalImg;
      els.modalProductImageUrl.value = "";
      renderModalGallery();
      updateModalPreview();
    }

    if(event.target === els.productModal) closeModal();
    if(event.target.closest("#btnCloseModal")) closeModal();
    if(event.target.closest("#btnOpenNewProduct")) openModal(null);
  });

  document.addEventListener("change", (e) => {
    if(e.target.matches("[data-toggle-id]")) toggleVisibility(e.target.dataset.toggleId);
    if(e.target === els.modalProductCategory){
      const library = imageLibrary[els.modalProductCategory.value] || [];
      if(library.length && !library.includes(els.modalProductImage.value)) els.modalProductImage.value = library[0];
      els.modalProductImageUrl.value = "";
      renderModalGallery();
      updateModalPreview();
    }
    if(e.target === els.adminFilter) renderAdmin();
  });

  document.addEventListener("input", (e) => {
    if(e.target === els.modalProductImageUrl){ renderModalGallery(); updateModalPreview(); }
  });

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
function init(){
  cacheEls();
  initTheme();
  bindEvents();
  initCalcInputs();
  loadCartData();
  renderCategoryButtons();
  fetchProducts(false);
  routeTo("home");
}

document.addEventListener("DOMContentLoaded", init);
