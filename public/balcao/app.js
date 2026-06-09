const API_BASE = 'https://controle-entregas-owfe.onrender.com';
const socket = io(API_BASE, { transports: ['websocket', 'polling'] });

const state = {
  orders: [],
};

const orderForm = document.getElementById('orderForm');
const ordersContainer = document.getElementById('ordersContainer');
const connectionStatus = document.getElementById('connectionStatus');

function paymentLabel(value) {
  return value || '-';
}

function statusLabel(status) {
  const map = {
    aguardando: 'Aguardando',
    em_rota: 'Em Rota',
    entregue: 'Entregue',
  };
  return map[status] || status;
}

function statusClass(status) {
  if (status === 'em_rota') return 'b-route';
  if (status === 'entregue') return 'b-done';
  return 'b-waiting';
}

function drinkLabel(value) {
  return value ? 'Sim' : 'Não';
}

function upsertOrder(order) {
  const index = state.orders.findIndex((item) => item.id === order.id);
  if (index >= 0) {
    state.orders[index] = { ...state.orders[index], ...order };
  } else {
    state.orders.unshift(order);
  }
  state.orders.sort((a, b) => b.id - a.id);
  render();
}

function setOrders(orders) {
  state.orders = [...orders].sort((a, b) => b.id - a.id);
  render();
}

async function loadOrders() {
  const response = await fetch(`${API_BASE}/api/orders`);
  if (!response.ok) throw new Error('Falha ao carregar pedidos.');
  const orders = await response.json();
  setOrders(orders);
}

function render() {
  const activeOrders = state.orders.filter((order) => order.status !== 'entregue');
  const doneOrders = state.orders.filter((order) => order.status === 'entregue');

  const activeHtml = activeOrders.length
    ? activeOrders.map(renderCard).join('')
    : `<div class="empty">Nenhum pedido em andamento.</div>`;

  const doneHtml = doneOrders.length
    ? doneOrders.map(renderCard).join('')
    : `<div class="empty">Nenhum pedido concluído hoje.</div>`;

  ordersContainer.innerHTML = `
    <div>
      <div class="section-title">
        <strong>Em andamento</strong>
        <span>${activeOrders.length} pedido(s)</span>
      </div>
      <div class="orders">${activeHtml}</div>
    </div>

    <div style="margin-top: 18px;">
      <div class="section-title">
        <strong>Concluídos hoje</strong>
        <span>${doneOrders.length} pedido(s)</span>
      </div>
      <div class="orders">${doneHtml}</div>
    </div>
  `;
}

function renderCard(order) {
  return `
    <article class="order-card">
      <div class="order-top">
        <div>
          <div class="order-name">#${order.id} · ${order.customer_name}</div>
          <div class="meta">
            Pagamento inicial: <strong>${paymentLabel(order.initial_payment_method)}</strong><br />
            Bebida: <strong>${drinkLabel(order.has_drink)}</strong><br />
            Status: <strong>${statusLabel(order.status)}</strong><br />
            ${order.final_payment_method ? `Pagamento final: <strong>${order.final_payment_method}</strong><br />` : ''}
          </div>
        </div>
        <div class="badge ${statusClass(order.status)}">${statusLabel(order.status)}</div>
      </div>
    </article>
  `;
}

orderForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(orderForm);
  const payload = {
    customer_name: String(formData.get('customer_name') || '').trim(),
    initial_payment_method: String(formData.get('initial_payment_method') || ''),
    has_drink: formData.get('has_drink') === 'on',
  };

  const response = await fetch(`${API_BASE}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    alert(error.error || 'Não foi possível lançar o pedido.');
    return;
  }

  orderForm.reset();
  const order = await response.json();
  upsertOrder(order);
});

socket.on('connect', () => {
  connectionStatus.textContent = 'Online';
  connectionStatus.className = 'badge b-route';
  socket.emit('sync:request');
});

socket.on('disconnect', () => {
  connectionStatus.textContent = 'Offline';
  connectionStatus.className = 'badge b-done';
});

socket.on('sync:orders', ({ orders }) => {
  setOrders(orders || []);
});

socket.on('order:created', (order) => {
  upsertOrder(order);
});

socket.on('order:updated', (order) => {
  upsertOrder(order);
});

socket.on('order:delivered', (order) => {
  upsertOrder(order);
});

loadOrders().catch((error) => {
  console.error(error);
});
