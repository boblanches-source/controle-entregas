const API_BASE = window.API_BASE || 'http://localhost:3000';
const socket = io(API_BASE, { transports: ['websocket', 'polling'] });

const state = {
  orders: [],
  summary: null,
  finishingOrderId: null,
};

const connectionStatus = document.getElementById('connectionStatus');
const ordersContainer = document.getElementById('ordersContainer');
const refreshBtn = document.getElementById('refreshBtn');
const toggleSummaryBtn = document.getElementById('toggleSummaryBtn');
const summaryPanel = document.getElementById('summaryPanel');

const sumTotal = document.getElementById('sumTotal');
const sumDinheiro = document.getElementById('sumDinheiro');
const sumCartao = document.getElementById('sumCartao');
const sumPix = document.getElementById('sumPix');

function statusLabel(status) {
  const map = {
    aguardando: 'Aguardando',
    em_rota: 'Em Rota',
    entregue: 'Entregue',
  };
  return map[status] || status;
}

function statusBadgeClass(status) {
  if (status === 'em_rota') return 'online';
  if (status === 'entregue') return 'offline';
  return 'badge';
}

function upsertOrder(order) {
  const index = state.orders.findIndex((item) => item.id === order.id);

  if (index >= 0) {
    state.orders[index] = { ...state.orders[index], ...order };
  } else {
    state.orders.unshift(order);
  }

  state.orders.sort((a, b) => b.id - a.id);
  renderOrders();
}

function setOrders(orders) {
  state.orders = [...orders].sort((a, b) => b.id - a.id);
  renderOrders();
}

function removeOrder(id) {
  state.orders = state.orders.filter((order) => order.id !== id);
  if (state.finishingOrderId === id) {
    state.finishingOrderId = null;
  }
  renderOrders();
}

async function loadOrders() {
  const response = await fetch(`${API_BASE}/api/orders/active`);
  if (!response.ok) throw new Error('Falha ao carregar pedidos ativos.');
  const orders = await response.json();
  setOrders(orders);
}

async function loadSummary() {
  const response = await fetch(`${API_BASE}/api/summary/today`);
  if (!response.ok) throw new Error('Falha ao carregar resumo.');
  const summary = await response.json();
  state.summary = summary;
  renderSummary();
}

function renderSummary() {
  const summary = state.summary || {
    total_deliveries: 0,
    Dinheiro: 0,
    Cartão: 0,
    Pix: 0,
  };

  sumTotal.textContent = summary.total_deliveries || 0;
  sumDinheiro.textContent = summary.Dinheiro || 0;
  sumCartao.textContent = summary.Cartão || 0;
  sumPix.textContent = summary.Pix || 0;
}

function renderOrders() {
  const activeOrders = state.orders.filter((order) => order.status !== 'entregue');

  if (!activeOrders.length) {
    ordersContainer.innerHTML = `<div class="empty">Nenhum pedido ativo no momento.</div>`;
    return;
  }

  ordersContainer.innerHTML = activeOrders.map(renderCard).join('');
}

function renderCard(order) {
  const isFinishing = state.finishingOrderId === order.id;

  return `
    <article class="order-card">
      <div class="order-head">
        <div>
          <div class="customer">#${order.id} · ${order.customer_name}</div>
          <div class="meta">
            Pagamento inicial: <strong>${order.initial_payment_method}</strong><br />
            Bebida: <strong>${order.has_drink ? 'Sim' : 'Não'}</strong><br />
            Status: <strong>${statusLabel(order.status)}</strong>
          </div>
        </div>
        <div class="badge ${statusBadgeClass(order.status)}">${statusLabel(order.status)}</div>
      </div>

      <div class="actions">
        ${
          order.status === 'aguardando'
            ? `<button class="btn success" data-action="start" data-id="${order.id}">Iniciar Rota</button>`
            : ''
        }

        ${
          order.status !== 'entregue'
            ? `
              <button class="btn warn" data-action="open-finish" data-id="${order.id}">
                Finalizar Entrega
              </button>
            `
            : ''
        }
      </div>

      ${
        isFinishing
          ? `
            <div class="inline">
              <select id="payment-${order.id}">
                <option value="">Confirme a forma de pagamento final</option>
                <option>Dinheiro</option>
                <option>Cartão</option>
                <option>Pix</option>
              </select>
              <button class="btn success" data-action="confirm-finish" data-id="${order.id}">
                Confirmar Entrega
              </button>
              <button class="btn secondary" data-action="cancel-finish" data-id="${order.id}">
                Cancelar
              </button>
            </div>
          `
          : ''
      }
    </article>
  `;
}

ordersContainer.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const { action, id } = button.dataset;
  const orderId = Number(id);

  if (action === 'start') {
    const response = await fetch(`${API_BASE}/api/orders/${orderId}/start`, {
      method: 'PATCH',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      alert(error.error || 'Não foi possível iniciar a rota.');
      return;
    }

    const updated = await response.json();
    upsertOrder(updated);
    return;
  }

  if (action === 'open-finish') {
    state.finishingOrderId = orderId;
    renderOrders();
    return;
  }

  if (action === 'cancel-finish') {
    state.finishingOrderId = null;
    renderOrders();
    return;
  }

  if (action === 'confirm-finish') {
    const select = document.getElementById(`payment-${orderId}`);
    const finalPayment = select ? select.value : '';

    if (!finalPayment) {
      alert('Selecione a forma de pagamento final.');
      return;
    }

    const response = await fetch(`${API_BASE}/api/orders/${orderId}/finish`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ final_payment_method: finalPayment }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      alert(error.error || 'Não foi possível finalizar a entrega.');
      return;
    }

    state.finishingOrderId = null;
    const updated = await response.json();
    removeOrder(updated.id);
    await loadSummary();
  }
});

refreshBtn.addEventListener('click', async () => {
  await loadOrders();
  await loadSummary();
});

toggleSummaryBtn.addEventListener('click', async () => {
  const isVisible = summaryPanel.style.display !== 'none';
  summaryPanel.style.display = isVisible ? 'none' : 'block';

  if (!isVisible) {
    await loadSummary();
  }
});

socket.on('connect', () => {
  connectionStatus.textContent = 'Online';
  connectionStatus.classList.remove('offline');
  connectionStatus.classList.add('online');
  socket.emit('sync:request');
});

socket.on('disconnect', () => {
  connectionStatus.textContent = 'Offline';
  connectionStatus.classList.remove('online');
  connectionStatus.classList.add('offline');
});

socket.on('sync:orders', ({ orders }) => {
  setOrders(orders.filter((order) => order.status !== 'entregue'));
});

socket.on('order:created', (order) => {
  if (order.status !== 'entregue') upsertOrder(order);
});

socket.on('order:updated', (order) => {
  if (order.status === 'entregue') {
    removeOrder(order.id);
  } else {
    upsertOrder(order);
  }
});

socket.on('order:delivered', (order) => {
  removeOrder(order.id);
  loadSummary().catch(() => {});
});

loadOrders().catch((error) => console.error(error));
loadSummary().catch((error) => console.error(error));
