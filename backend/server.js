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

// Configuración Estricta de Redis
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
app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'If-Match'],
  exposedHeaders: ['ETag']
}));

// HALLAZGO 14: Separación estricta de Stores en Redis mediante prefix
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
  if (req.method === 'GET' && req.path === '/products') return publicLimiter(req, res, next);
  return adminLimiter(req, res, next);
});

const DEFAULT_PRODUCTS = [
  { id: 'seed-panel-550w', name: 'Panel Solar Monocristalino 550W', category: 'paneles', price: 150000, description: 'Alta eficiencia, tecnología PERC.', image: 'productos/paneles1.png', visible: true, etag: '"1"' },
  { id: 'seed-inversor-5kw', name: 'Inversor Híbrido 5kW', category: 'inversores', price: 850000, description: 'Onda senoidal pura, compatible con litio.', image: 'productos/inversor1.png', visible: true, etag: '"1"' },
  { id: 'seed-bateria-4-8kwh', name: 'Batería de Litio 4.8kWh', category: 'baterias', price: 1250000, description: 'Ciclo profundo, 6000 ciclos DoD 80%.', image: 'productos/bateria1.png', visible: true, etag: '"1"' },
  { id: 'seed-aerogenerador-1kw', name: 'Aerogenerador 1kW', category: 'aerogeneradores', price: 650000, description: 'Ideal para zonas costeras.', image: 'productos/aero1.png', visible: true, etag: '"1"' },
  { id: 'seed-kit-solar-basico', name: 'Kit Solar Off-Grid Básico', category: 'kits', price: 2100000, description: 'Todo incluido para cabañas aisladas.', image: 'productos/Paneles4.png', visible: true, etag: '"1"' },
  { id: 'seed-conectores-mc4', name: 'Conectores MC4 (Par)', category: 'otros', price: 4500, description: 'Conectores solares con certificación IP67.', image: 'productos/otros1.png', visible: true, etag: '"1"' }
];

async function getProductsSnapshot() {
  const data = await redisClient.get('products');
  if (!data) return structuredClone(DEFAULT_PRODUCTS);
  try {
    return JSON.parse(data);
  } catch (e) {
    return structuredClone(DEFAULT_PRODUCTS);
  }
}

async function updateProductsAtomically(updaterFn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await txClient.watch('products');
      const data = await txClient.get('products');
      let products = data ? JSON.parse(data) : structuredClone(DEFAULT_PRODUCTS);
      const updatedProducts = updaterFn(products);
      const multi = txClient.multi();
      multi.set('products', JSON.stringify(updatedProducts));
      const result = await multi.exec();
      if (result) return updatedProducts;
    } catch (err) {
      await txClient.unwatch();
      if (attempt === maxRetries) throw err;
    }
  }
  throw new Error('Conflicto persistente en base de datos.');
}

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

app.get('/health', (req, res) => res.status(200).json({ ok: true, service: 'hibrid-api' }));

app.get('/api/products', async (req, res) => {
  const products = await getProductsSnapshot();
  const authHeader = req.headers.authorization || '';
  const isAdmin = safeCompare(authHeader, `Bearer ${process.env.ADMIN_TOKEN}`);
  const publicProducts = isAdmin ? products : products.filter(p => p.visible);
  res.json(publicProducts);
});

app.get('/api/admin/session', requireAdmin, (req, res) => res.json({ status: 'ok' }));

// HALLAZGO 16: Listado de assets con "Label" estético pero "Value" idéntico al typo del repo.
app.get('/api/assets', requireAdmin, (req, res) => {
  res.json([
    { group: 'Paneles', options: [
      { value: 'productos/Paneles4.png', label: 'Paneles 4' },
      { value: 'productos/paneles1.png', label: 'Paneles 1' },
      { value: 'productos/paneles2.png', label: 'Paneles 2' },
      { value: 'productos/paneles3.png', label: 'Paneles 3' },
      { value: 'productos/paneles5.png', label: 'Paneles 5' }
    ]},
    { group: 'Baterías', options: [
      { value: 'productos/bateria1.png', label: 'Batería 1' },
      { value: 'productos/bateria1a.png', label: 'Batería 1a' },
      { value: 'productos/bateria2.png', label: 'Batería 2' },
      { value: 'productos/bateria2a.png', label: 'Batería 2a' },
      { value: 'productos/bateria3.png', label: 'Batería 3' },
      { value: 'productos/bateria3a.png', label: 'Batería 3a' },
      { value: 'productos/bateria4.png', label: 'Batería 4' },
      { value: 'productos/bateria5.png', label: 'Batería 5' }
    ]},
    { group: 'Inversores', options: [
      { value: 'productos/inversor1.png', label: 'Inversor 1' },
      { value: 'productos/inversor2.png', label: 'Inversor 2' },
      { value: 'productos/imversor3.png', label: 'Inversor 3 (typo corregido UI)' },
      { value: 'productos/inversor4.png', label: 'Inversor 4' },
      { value: 'productos/imversor5.png', label: 'Inversor 5 (typo corregido UI)' }
    ]},
    { group: 'Aerogeneradores', options: [
      { value: 'productos/aero1.png', label: 'Aero 1' },
      { value: 'productos/aero2.png', label: 'Aero 2' },
      { value: 'productos/aero3.png', label: 'Aero 3' },
      { value: 'productos/aero4.png', label: 'Aero 4' },
      { value: 'productos/aerp5.png', label: 'Aero 5 (typo corregido UI)' }
    ]},
    { group: 'Otros', options: [
      { value: 'productos/otros1.png', label: 'Otros 1' },
      { value: 'productos/otros2.png', label: 'Otros 2' },
      { value: 'productos/otros3.png', label: 'Otros 3' },
      { value: 'productos/otros4.png', label: 'Otros 4' },
      { value: 'productos/otros5.png', label: 'Otros 5' },
      { value: 'productos/otros6.png', label: 'Otros 6' },
      { value: 'productos/otros7.png', label: 'Otros 7' },
      { value: 'productos/otros8.png', label: 'Otros 8' },
      { value: 'productos/otros9.png', label: 'Otros 9' },
      { value: 'productos/otros10.png', label: 'Otros 10' },
      { value: 'productos/otros11.png', label: 'Otros 11' }
    ]}
  ]);
});

// HALLAZGO 18: Eliminado el campo en desuso nominalKW del validador.
const productSchema = z.object({
  name: z.string().min(1),
  price: z.number().nonnegative(),
  description: z.string().optional(),
  category: z.enum(['paneles', 'inversores', 'baterias', 'aerogeneradores', 'kits', 'otros']),
  image: z.string().optional(),
  visible: z.boolean().optional()
});

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

app.listen(PORT, () => console.log(`🚀 Backend HiBRID en puerto ${PORT}`));
