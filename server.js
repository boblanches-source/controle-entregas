const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const knexFactory = require('knex');

const PORT = process.env.PORT || 3000;
const SQLITE_FILE = process.env.SQLITE_FILE || path.join(__dirname, 'db.sqlite3');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  },
});

const db = knexFactory({
  client: 'sqlite3',
  connection: {
    filename: SQLITE_FILE,
  },
  useNullAsDefault: true,
  pool: {
    afterCreate(conn, done) {
      conn.run('PRAGMA foreign_keys = ON;', done);
    },
  },
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PAYMENT_METHODS = ['Dinheiro', 'Cartão', 'Pix'];
const STATUS = {
  WAITING: 'aguardando',
  IN_ROUTE: 'em_rota',
  DELIVERED: 'entregue',
};

function isValidPaymentMethod(value) {
  return PAYMENT_METHODS.includes(value);
}

async function getOrderById(id) {
  return db('orders').where({ id }).first();
}

async function getTodayOrders() {
  return db('orders')
    .whereRaw("date(created_at, 'localtime') = date('now', 'localtime')")
    .orderBy('id', 'desc');
}

async function getTodayActiveOrders() {
  return db('orders')
    .whereRaw("date(created_at, 'localtime') = date('now', 'localtime')")
    .whereNot('status', STATUS.DELIVERED)
    .orderBy('id', 'desc');
}

async function getTodaySummary() {
  const rows = await db('orders')
    .select('final_payment_method')
    .count({ total: '*' })
    .where('status', STATUS.DELIVERED)
    .andWhereRaw("date(delivered_at, 'localtime') = date('now', 'localtime')")
    .groupBy('final_payment_method');

  const summary = {
    total_deliveries: 0,
    Dinheiro: 0,
    Cartão: 0,
    Pix: 0,
  };

  for (const row of rows) {
    const total = Number(row.total || 0);
    const method = row.final_payment_method || 'Dinheiro';
    summary.total_deliveries += total;
    if (summary[method] === undefined) summary[method] = 0;
    summary[method] += total;
  }

  return summary;
}

async function emitSync() {
  const orders = await getTodayOrders();
  io.emit('sync:orders', { orders });
}

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/orders', async (req, res) => {
  try {
    const orders = await getTodayOrders();
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar pedidos.' });
  }
});

app.get('/api/orders/active', async (req, res) => {
  try {
    const orders = await getTodayActiveOrders();
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar pedidos ativos.' });
  }
});

app.get('/api/summary/today', async (req, res) => {
  try {
    const summary = await getTodaySummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao gerar resumo do turno.' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { customer_name, initial_payment_method, has_drink } = req.body;

    if (!customer_name || !customer_name.trim()) {
      return res.status(400).json({ error: 'Nome do cliente é obrigatório.' });
    }

    if (!isValidPaymentMethod(initial_payment_method)) {
      return res.status(400).json({ error: 'Forma de pagamento inicial inválida.' });
    }

    const payload = {
      customer_name: customer_name.trim(),
      initial_payment_method,
      has_drink: Boolean(has_drink),
      status: STATUS.WAITING,
      final_payment_method: null,
      delivered_at: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    };

    const [id] = await db('orders').insert(payload);
    const order = await getOrderById(id);

    io.emit('order:created', order);
    await emitSync();

    return res.status(201).json(order);
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao criar pedido.' });
  }
});

app.patch('/api/orders/:id/start', async (req, res) => {
  try {
    const { id } = req.params;
    const order = await getOrderById(id);

    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }

    if (order.status === STATUS.DELIVERED) {
      return res.status(400).json({ error: 'Pedido já foi entregue.' });
    }

    await db('orders')
      .where({ id })
      .update({
        status: STATUS.IN_ROUTE,
        updated_at: db.fn.now(),
      });

    const updated = await getOrderById(id);
    io.emit('order:updated', updated);
    await emitSync();

    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao iniciar rota.' });
  }
});

app.patch('/api/orders/:id/finish', async (req, res) => {
  try {
    const { id } = req.params;
    const { final_payment_method } = req.body;

    if (!isValidPaymentMethod(final_payment_method)) {
      return res.status(400).json({ error: 'Forma de pagamento final inválida.' });
    }

    const order = await getOrderById(id);

    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }

    await db('orders')
      .where({ id })
      .update({
        status: STATUS.DELIVERED,
        final_payment_method,
        delivered_at: db.fn.now(),
        updated_at: db.fn.now(),
      });

    const updated = await getOrderById(id);
    io.emit('order:updated', updated);
    io.emit('order:delivered', updated);
    await emitSync();

    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao finalizar entrega.' });
  }
});

io.on('connection', (socket) => {
  socket.on('sync:request', async () => {
    const orders = await getTodayOrders();
    socket.emit('sync:orders', { orders });
  });
});

server.listen(PORT, async () => {
  console.log(`API rodando em http://localhost:${PORT}`);
});
