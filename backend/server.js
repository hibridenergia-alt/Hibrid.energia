import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createClient } from 'redis';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { z } from 'zod';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 10000;

// ============================================================
// Configuración de Redis (cliente principal + cliente de transacciones)
// ============================================================
const redisClient = createClient({ url: process.env.REDIS_URL });
const txClient = redisClient.duplicate();

redisClient.on('error', (err) => {
  console.error('❌ Error crítico en Redis principal:', err);
  if (process.env.NODE_ENV === 'production') process.exit(1);
});
txClient.on('error', (err) => console.error('❌ Error crítico en txClient:', err));

try {
  await redisClient.connect();
  await txClient.connect();
  console.log('✅ Redis conectado exitosamente.');
} catch (err) {
  console.error('❌ Falla fatal al inicializar Redis:', err);
  if (process.env.NODE_ENV === 'production') process.exit(1);
}

app.use(helmet());
app.use(express.json());
app.set('trust proxy', 1); // Necesario en Render (proxy inverso)

app.use(cors({
  origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'If-Match'],
  exposedHeaders: ['ETag']
}));

// ============================================================
// Rate limiting (público vs admin, con stores separados)
// ============================================================
const publicStore = redisClient.isOpen ? new RedisStore({
  prefix: 'rl:public:',
  sendCommand: (...args) => redisClient.sendCommand(args),
}) : undefined;

const adminStore = redisClient.isOpen ? new RedisStore({
  prefix: 'rl:admin:',
  sendCommand: (...args) => redisClient.sendCommand(args),
}) : undefined;

const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false, store: publicStore });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false, store: adminStore });

app.use('/api/', (req, res, next) => {
  const isPublicGet = req.method === 'GET' && (req.path === '/products' || req.path === '/config');
  return isPublicGet ? publicLimiter(req, res, next) : adminLimiter(req, res, next);
});

// ============================================================
// Utilidades de seguridad
// ============================================================
function safeCompare(a, b) {
  try {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (e) { return false; }
}

const requireAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const expected = `Bearer ${process.env.ADMIN_TOKEN}`;
  if (!safeCompare(authHeader, expected)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="HiBRID Admin Area"');
    return res.status(401).json({ error: 'Acceso denegado. Token inválido.' });
  }
  next();
};

// ============================================================
// Persistencia atómica genérica (WATCH/MULTI sobre una clave Redis)
// ============================================================
async function atomicUpdate(redisKey, defaultValue, updaterFn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await txClient.watch(redisKey);
      const data = await txClient.get(redisKey);
      const current = data ? JSON.parse(data) : structuredClone(defaultValue);
      const updated = updaterFn(current);
      const multi = txClient.multi();
      multi.set(redisKey, JSON.stringify(updated));
      const result = await multi.exec();
      if (result) return updated;
    } catch (err) {
      await txClient.unwatch();
      if (err.message === 'NOT_FOUND' || err.message === 'PRECONDITION_FAILED' || attempt === maxRetries) throw err;
    }
  }
  throw new Error('Conflicto persistente en base de datos.');
}

// ============================================================
// PRODUCTOS
// ============================================================
const DEFAULT_PRODUCTS = [
  { id: 'seed-panel-550w', name: 'Panel Solar Monocristalino 550W', category: 'paneles', price: 150000, description: 'Alta eficiencia, tecnología PERC.', image: 'productos/paneles1.png', visible: true, etag: '"1"' },
  { id: 'seed-inversor-5kw', name: 'Inversor Híbrido 5kW', category: 'inversores', price: 850000, description: 'Onda senoidal pura, compatible con litio.', image: 'productos/inversor1.png', visible: true, etag: '"1"' },
  { id: 'seed-bateria-4-8kwh', name: 'Batería de Litio 4.8kWh', category: 'baterias', price: 1250000, description: 'Ciclo profundo, 6000 ciclos DoD 80%.', image: 'productos/bateria1.png', visible: true, etag: '"1"' },
  { id: 'seed-aerogenerador-1kw', name: 'Aerogenerador 1kW', category: 'aerogeneradores', price: 650000, description: 'Ideal para zonas costeras.', image: 'productos/aero1.png', visible: true, etag: '"1"' },
  { id: 'seed-kit-solar-basico', name: 'Kit Solar Off-Grid Básico', category: 'kits', price: 2100000, description: 'Todo incluido para cabañas aisladas.', image: 'productos/kit1.png', visible: true, etag: '"1"' },
  { id: 'seed-conectores-mc4', name: 'Conectores MC4 (Par)', category: 'otros', price: 4500, description: 'Conectores solares con certificación IP67.', image: 'productos/otros1.png', visible: true, etag: '"1"' }
];

async function getProductsSnapshot() {
  const data = await redisClient.get('products');
  if (!data) return structuredClone(DEFAULT_PRODUCTS);
  try { return JSON.parse(data); } catch (e) { return structuredClone(DEFAULT_PRODUCTS); }
}

const updateProductsAtomically = (updaterFn) => atomicUpdate('products', DEFAULT_PRODUCTS, updaterFn);

const productSchema = z.object({
  name: z.string().min(1),
  price: z.number().nonnegative(),
  description: z.string().optional(),
  category: z.enum(['paneles', 'inversores', 'baterias', 'aerogeneradores', 'kits', 'otros']),
  image: z.string().optional(),
  visible: z.boolean().optional()
});

app.get('/health', (req, res) => res.status(200).json({ ok: true, service: 'hibrid-api' }));

app.get('/api/products', async (req, res) => {
  const products = await getProductsSnapshot();
  const authHeader = req.headers.authorization || '';
  const isAdmin = safeCompare(authHeader, `Bearer ${process.env.ADMIN_TOKEN}`);
  const publicProducts = isAdmin ? products : products.filter(p => p.visible);
  res.json(publicProducts);
});

app.get('/api/admin/session', requireAdmin, (req, res) => res.json({ status: 'ok' }));

app.post('/api/products', requireAdmin, async (req, res) => {
  try {
    const validated = productSchema.parse(req.body);
    const newProduct = { ...validated, visible: validated.visible ?? true, id: crypto.randomUUID(), etag: `"${crypto.randomUUID()}"` };
    await updateProductsAtomically(products => { products.push(newProduct); return products; });
    res.setHeader('ETag', newProduct.etag);
    res.status(201).json(newProduct);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.patch('/api/products/:id', requireAdmin, async (req, res) => {
  const ifMatch = req.headers['if-match'];
  if (!ifMatch) return res.status(428).json({ error: 'If-Match header required' });
  try {
    const validated = productSchema.partial().parse(req.body);
    let updatedProduct;
    await updateProductsAtomically(products => {
      const idx = products.findIndex(p => p.id === req.params.id);
      if (idx === -1) throw new Error('NOT_FOUND');
      if (products[idx].etag !== ifMatch) throw new Error('PRECONDITION_FAILED');
      updatedProduct = { ...products[idx], ...validated, visible: validated.visible !== undefined ? validated.visible : products[idx].visible, etag: `"${crypto.randomUUID()}"` };
      products[idx] = updatedProduct;
      return products;
    });
    res.setHeader('ETag', updatedProduct.etag);
    res.json(updatedProduct);
  } catch (error) {
    if (error.message === 'NOT_FOUND') return res.status(404).json({ error: 'No encontrado' });
    if (error.message === 'PRECONDITION_FAILED') return res.status(412).json({ error: 'Modificado por otro usuario' });
    res.status(500).json({ error: 'Error interno' });
  }
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  const ifMatch = req.headers['if-match'];
  if (!ifMatch) return res.status(428).json({ error: 'If-Match header required' });
  try {
    await updateProductsAtomically(products => {
      const idx = products.findIndex(p => p.id === req.params.id);
      if (idx === -1) throw new Error('NOT_FOUND');
      if (products[idx].etag !== ifMatch) throw new Error('PRECONDITION_FAILED');
      products.splice(idx, 1);
      return products;
    });
    res.status(204).send();
  } catch (error) {
    if (error.message === 'NOT_FOUND') return res.status(404).json({ error: 'No encontrado' });
    if (error.message === 'PRECONDITION_FAILED') return res.status(412).json({ error: 'Conflicto' });
    res.status(500).json({ error: 'Error interno' });
  }
});

// ============================================================
// ASSETS DINÁMICOS DESDE GITHUB (banner, mensajes, productos, categoria)
// ============================================================
const GITHUB_REPO = 'hibridenergia-alt/Hibrid.energia'; // AJUSTA si el nombre real del repo difiere
const GITHUB_BRANCH = 'main';

const ASSET_FOLDERS = {
  banner: 'docs/banner',
  mensajes: 'docs/mensajes',
  productos: 'docs/productos',
  categoria: 'docs/categoria'
};

async function listGithubFolder(folderPath) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${folderPath}?ref=${GITHUB_BRANCH}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'hibrid-backend' } });
  if (!res.ok) throw new Error('No se pudo listar la carpeta en GitHub');
  const data = await res.json();
  return data
    .filter(item => item.type === 'file' && /\.(png|jpe?g|webp)$/i.test(item.name))
    .map(item => item.path.replace('docs/', '')); // ej: "productos/paneles1.png"
}

function guessProductGroup(filename) {
  const f = filename.toLowerCase();
  if (f.startsWith('panele')) return 'Paneles';
  if (f.startsWith('bateria')) return 'Baterías';
  if (f.startsWith('inversor') || f.startsWith('imversor')) return 'Inversores';
  if (f.startsWith('aero') || f.startsWith('aerp')) return 'Aerogeneradores';
  if (f.startsWith('kit')) return 'Kits Solares';
  return 'Otros';
}

const assetCache = new Map(); // folder -> { data, timestamp }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

app.get('/api/assets/:folder', requireAdmin, async (req, res) => {
  const folderKey = req.params.folder;
  const folderPath = ASSET_FOLDERS[folderKey];
  if (!folderPath) return res.status(404).json({ error: 'Carpeta no reconocida' });

  const forceRefresh = req.query.refresh === 'true';
  const cached = assetCache.get(folderKey);
  if (!forceRefresh && cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return res.json(cached.data);
  }

  try {
    const files = await listGithubFolder(folderPath);
    let result = files;
    if (folderKey === 'productos') {
      const groups = {};
      files.forEach(path => {
        const filename = path.split('/').pop();
        const groupName = guessProductGroup(filename);
        (groups[groupName] ??= []).push({ value: path, label: filename.replace(/\.[^.]+$/, '') });
      });
      result = Object.entries(groups).map(([group, options]) => ({ group, options }));
    }
    assetCache.set(folderKey, { data: result, timestamp: Date.now() });
    res.json(result);
  } catch (e) {
    if (cached) return res.json(cached.data); // si GitHub falla, sirve lo último conocido
    res.status(502).json({ error: 'No se pudo leer GitHub: ' + e.message });
  }
});

// ============================================================
// CONFIGURACIÓN DEL SITIO (banner, mensaje de bienvenida, fotos de categorías)
// ============================================================
const DEFAULT_CONFIG = {
  banner: { mode: 'fixed', images: ['categoria/logotipohibrid.png'] },
  promo: { enabled: false, image: '', title: '', text: '', ctaLabel: 'Ver Catálogo', ctaFilter: 'ver todos' },
  categorias: {
    paneles: 'categoria/panelessolarescategoria.png',
    inversores: 'categoria/inversorescategoria.png',
    baterias: 'categoria/bateriascategoria.png',
    aerogeneradores: 'categoria/eolicacategoria.png',
    kits: 'categoria/kitsolarescategoria.png',
    otros: 'categoria/otroscategoria.png'
  },
  etag: '"1"'
};

const configSchema = z.object({
  banner: z.object({
    mode: z.enum(['fixed', 'rotating']),
    images: z.array(z.string()).min(1)
  }).optional(),
  promo: z.object({
    enabled: z.boolean(),
    image: z.string().optional(),
    title: z.string().optional(),
    text: z.string().optional(),
    ctaLabel: z.string().optional(),
    ctaFilter: z.string().optional()
  }).optional(),
  categorias: z.object({
    paneles: z.string(), inversores: z.string(), baterias: z.string(),
    aerogeneradores: z.string(), kits: z.string(), otros: z.string()
  }).partial().optional()
});

async function getConfigSnapshot() {
  const data = await redisClient.get('siteConfig');
  if (!data) return structuredClone(DEFAULT_CONFIG);
  try { return JSON.parse(data); } catch (e) { return structuredClone(DEFAULT_CONFIG); }
}

const updateConfigAtomically = (updaterFn) => atomicUpdate('siteConfig', DEFAULT_CONFIG, updaterFn);

app.get('/api/config', async (req, res) => {
  res.json(await getConfigSnapshot());
});

app.patch('/api/config', requireAdmin, async (req, res) => {
  const ifMatch = req.headers['if-match'];
  if (!ifMatch) return res.status(428).json({ error: 'If-Match header required' });
  try {
    const validated = configSchema.parse(req.body);
    const updatedConfig = await updateConfigAtomically(current => {
      if (current.etag !== ifMatch) throw new Error('PRECONDITION_FAILED');
      return {
        ...current,
        banner: validated.banner ? { ...current.banner, ...validated.banner } : current.banner,
        promo: validated.promo ? { ...current.promo, ...validated.promo } : current.promo,
        categorias: validated.categorias ? { ...current.categorias, ...validated.categorias } : current.categorias,
        etag: `"${crypto.randomUUID()}"`
      };
    });
    res.setHeader('ETag', updatedConfig.etag);
    res.json(updatedConfig);
  } catch (error) {
    if (error.message === 'PRECONDITION_FAILED') return res.status(412).json({ error: 'Modificado por otro usuario' });
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
    res.status(500).json({ error: 'Error interno' });
  }
});

app.listen(PORT, () => console.log(`🚀 Backend HiBRID en puerto ${PORT}`));
