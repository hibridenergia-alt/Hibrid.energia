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
// Cliente dedicado para transacciones (Hallazgo 4)
const txClient = redisClient.duplicate();

redisClient.on('error', (err) => {
  console.error('❌ Error crítico en Redis principal:', err);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});

txClient.on('error', (err) => {
  console.error('❌ Error crítico en txClient:', err);
});

try {
  await redisClient.connect();
  await txClient.connect(); // Inicializar cliente de transacciones
  console.log('✅ Redis (Principal y Transaccional) conectados exitosamente.');
} catch (err) {
  console.error('❌ Falla fatal al inicializar Redis:', err);
  if (process.env.NODE_ENV === 'production') process.exit(1);
}

app.use(helmet());
app.use(express.json());

// Hallazgo 1: Configurar 'trust proxy' para Render/Heroku (Crítico)
app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'If-Match'],
  exposedHeaders: ['ETag']
}));

// Configuración de Rate Limits separados (Hallazgo 9)
const store = redisClient.isOpen ? new RedisStore({
  sendCommand: (...args) => redisClient.sendCommand(args),
}) : undefined;

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300, // Límite generoso para lecturas
  standardHeaders: true,
  legacyHeaders: false,
  store,
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50, // Límite estricto para operaciones de escritura/admin
  standardHeaders: true,
  legacyHeaders: false,
  store,
});

// Aplicar Rate Limiter condicionalmente
app.use('/api/', (req, res, next) => {
  if (req.method === 'GET' && req.path === '/products') {
    return publicLimiter(req, res, next);
  }
  return adminLimiter(req, res, next);
});

// Hallazgo 11: IDs determinísticos y Hallazgo 7: Imagen bateriacatalogo1.jpg
const DEFAULT_PRODUCTS = [
  { id: 'seed-panel-550w', name: 'Panel Solar Monocristalino 550W', category: 'paneles', price: 150000, description: 'Alta eficiencia, tecnología PERC.', image: 'panelescatalogo.jpg', visible: true, etag: '"1"' },
  { id: 'seed-inversor-5kw', name: 'Inversor Híbrido 5kW', category: 'inversores', price: 850000, description: 'Onda senoidal pura, compatible con litio.', image: 'inversorcatalogo.png', visible: true, etag: '"1"' },
  { id: 'seed-bateria-4-8kwh', name: 'Batería de Litio 4.8kWh', category: 'baterias', price: 1250000, description: 'Ciclo profundo, 6000 ciclos DoD 80%.', image: 'bateriacatalogo1.jpg', visible: true, etag: '"1"' },
  { id: 'seed-aerogenerador-1kw', name: 'Aerogenerador 1kW', category: 'aerogeneradores', price: 650000, description: 'Ideal para zonas costeras.', image: 'eolica.jpg', visible: true, etag: '"1"' },
  { id: 'seed-kit-solar-basico', name: 'Kit Solar Off-Grid Básico', category: 'kits', price: 2100000, description: 'Todo incluido para cabañas aisladas.', image: 'kitsolar.jpg', visible: true, etag: '"1"' },
  { id: 'seed-conectores-mc4', name: 'Conectores MC4 (Par)', category: 'otros', price: 4500, description: 'Conectores solares con certificación IP67.', image: '', visible: true, etag: '"1"' }
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

// Hallazgo 4: Reutilizar cliente de base de datos para transacciones en vez de crear/destruir
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
      
      if (result) {
        return updatedProducts;
      }
    } catch (err) {
      await txClient.unwatch();
      if (attempt === maxRetries) throw err;
    }
  }
  throw new Error('Conflicto persistente en base de datos.');
}

// Hallazgo 5: Comparación segura de tokens en tiempo constante
function safeCompare(a, b) {
  try {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (e) {
    return false;
  }
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
  const expected = `Bearer ${process.env.ADMIN_TOKEN}`;
  
  const isAdmin = safeCompare(authHeader, expected);
  const publicProducts = isAdmin ? products : products.filter(p => p.visible);
  res.json(publicProducts);
});

app.get('/api/admin/session', requireAdmin, (req, res) => res.json({ status: 'ok' }));

app.get('/api/assets', requireAdmin, (req, res) => {
  res.json([
    { value: 'paneles.jpg', label: 'Paneles' },
    { value: 'panelescatalogo.jpg', label: 'Paneles Catálogo' },
    { value: 'bateria.jpg', label: 'Batería' },
    { value: 'bateriacatalogo1.jpg', label: 'Batería Catálogo' },
    { value: 'inversor.jpg', label: 'Inversor' },
    { value: 'inversorcatalogo.png', label: 'Inversor Catálogo' },
    { value: 'eolica.jpg', label: 'Eólica' },
    { value: 'kitsolar.jpg', label: 'Kit Solar' },
    { value: 'logotipohibrid.png', label: 'Logo HiBRID' }
  ]);
});

// Hallazgo 10: Limpiar propiedades sin uso como image_url
const productSchema = z.object({
  name: z.string().min(1),
  price: z.number().nonnegative(),
  description: z.string().optional(),
  category: z.enum(['paneles', 'inversores', 'baterias', 'aerogeneradores', 'kits', 'otros']),
  image: z.string().optional(),
  visible: z.boolean().optional(),
  nominalKW: z.number().nonnegative().optional()
});

app.post('/api/products', requireAdmin, async (req, res) => {
  try {
    const validated = productSchema.parse(req.body);
    const newProduct = { 
      ...validated, 
      visible: validated.visible ?? true, 
      id: crypto.randomUUID(), 
      etag: `"${crypto.randomUUID()}"` 
    };
    
    await updateProductsAtomically(products => {
      products.push(newProduct);
      return products;
    });

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

      updatedProduct = { 
        ...products[idx], 
        ...validated, 
        visible: validated.visible !== undefined ? validated.visible : products[idx].visible,
        etag: `"${crypto.randomUUID()}"` 
      };
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

app.patch('/api/products/:id/visibility', requireAdmin, async (req, res) => {
  const ifMatch = req.headers['if-match'];
  if (!ifMatch) return res.status(428).json({ error: 'If-Match header required' });

  try {
    const visible = req.body.visible;
    let updatedProduct;

    await updateProductsAtomically(products => {
      const idx = products.findIndex(p => p.id === req.params.id);
      if (idx === -1) throw new Error('NOT_FOUND');
      if (products[idx].etag !== ifMatch) throw new Error('PRECONDITION_FAILED');

      updatedProduct = { ...products[idx], visible: !!visible, etag: `"${crypto.randomUUID()}"` };
      products[idx] = updatedProduct;
      return products;
    });

    res.setHeader('ETag', updatedProduct.etag);
    res.json(updatedProduct);
  } catch (error) {
    if (error.message === 'NOT_FOUND') return res.status(404).json({ error: 'No encontrado' });
    if (error.message === 'PRECONDITION_FAILED') return res.status(412).json({ error: 'Conflicto' });
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

app.listen(PORT, () => {
  console.log(`🚀 Backend HiBRID en puerto ${PORT}`);
});
