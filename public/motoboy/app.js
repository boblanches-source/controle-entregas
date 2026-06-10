const API_BASE = window.API_BASE || 'https://controle-entregas-owfe.onrender.com';
const socket = io(API_BASE, { transports: ['websocket', 'polling'] });

const state = {
  orders: [],
  history: [],
  theme: 'light',
  finishingOrderId: null,
};

const connectionStatus = document.getElementById('connectionStatus');
const ordersContainer = document.getElementById('ordersContainer');
const historyContainer = document.getElementById('historyContainer');
const refreshBtn = document.getElementById('refreshBtn');
const toggleThemeBtn = document.getElementById('toggleThemeBtn');
const activeCount = document.getElementById('activeCount');

function formatMoney(value) {
  const number = Number(value || 0);
  return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function timeLabel(value) {
  if (!value) return '-';
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status) {
  const map = {
    aguardando: 'Aguardando',
    em_rota: 'Em rota',
    entregue: 'Entregue',
  };
  return map[status] || status;
}

function statusClass(status) {
  if (status === 'em_rota') return 'route';
  if (status === 'entregue') return 'done';
  return 'waiting';
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

function pushHistory(order) {
  const item = {
    id: order.id,
    customer_name: order.customer_name,
    delivered_at: order.delivered_at,
    status: order.status,
    is_paid: order.is_paid,
    final_payment_method: order.final_payment_method || order.initial_payment_method,
  };
  const index = state.history.findIndex((x) => x.id === item.id);
  if (index >= 0) state.history[index] = item;
  else state.history.unshift(item);
  state.history = state.history.slice(0, 8);
  renderHistory();
}

async function loadOrders() {
  const response = await fetch(`${API_BASE}/api/orders/active`);
  if (!response.ok) throw new Error('Falha ao carregar pedidos ativos.');
  const orders = await response.json();
  setOrders(orders);
}

async function loadAllOrders() {
  const response = await fetch(`${API_BASE}/api/orders`);
  if (!response.ok) throw new Error('Falha ao carregar histórico.');
  const orders = await response.json();
  state.history = orders
    .filter((order) => order.status === 'entregue')
    .slice(0, 8)
    .map((order) => ({
      id: order.id,
      customer_name: order.customer_name,
      delivered_at: order.delivered_at,
      status: order.status,
      is_paid: order.is_paid,
      final_payment_method: order.final_payment_method || order.initial_payment_method,
    }));
  renderHistory();
}

function render() {
  const activeOrders = state.orders.filter((order) => order.status !== 'entregue');
  activeCount.textContent = `${activeOrders.length} pedidos ativos`;

  if (!activeOrders.length) {
    ordersContainer.innerHTML = `<div class="empty">Nenhum pedido ativo no momento.</div>`;
    return;
  }

  ordersContainer.innerHTML = activeOrders.map(renderCard).join('');
}

function renderHistory() {
  if (!state.history.length) {
    historyContainer.innerHTML = `<div class="empty">Nenhuma entrega concluída hoje.</div>`;
    return;
  }

  historyContainer.innerHTML = state.history.map((order) => `
    <div class="history-item">
      <strong>#${order.id} · ${order.customer_name}</strong><br />
      Hora: ${timeLabel(order.delivered_at)}<br />
      Pagamento: ${order.final_payment_method || '-'} · ${order.is_paid ? 'Pago no balcão' : 'Recebido na entrega'}
    </div>
  `).join('');
}

function renderCard(order) {
  const isFinishing = state.finishingOrderId === order.id;
  return `
    <article class="order-card ${statusClass(order.status)}">
      <div class="order-top">
        <div>
          <div class="customer">#${order.id} · ${order.customer_name}</div>
          <div class="meta">
            Valor: <strong>${formatMoney(order.order_value)}</strong><br />
            Pagamento: <strong>${order.initial_payment_method}</strong><br />
            ${order.is_paid ? '<strong>Pago no balcão</strong><br />' : '<strong>A receber na entrega</strong><br />'}
            Bebida: <strong>${order.has_drink ? 'Sim' : 'Não'}</strong><br />
            ${order.observations ? `Observações: <strong>${escapeHtml(order.observations)}</strong><br />` : ''}
            ${order.needs_change ? '<strong>Vai precisar de troco</strong><br />' : ''}
          </div>
        </div>
        <div class="badges">
          <span class="pill ${statusClass(order.status)}">${statusLabel(order.status)}</span>
          ${order.is_paid ? '<span class="pill paid">PAGO</span>' : '<span class="pill cash">A RECEBER</span>'}
          ${order.has_drink ? '<span class="pill cash">Bebida</span>' : ''}
        </div>
      </div>

      <div class="actions">
        ${order.status === 'aguardando' ? `<button class="btn success" data-action="start" data-id="${order.id}">Iniciar rota</button>` : ''}
        ${order.status !== 'entregue' ? `<button class="btn warn" data-action="open-finish" data-id="${order.id}">Finalizar entrega</button>` : ''}
      </div>

      <div id="finish-box-${order.id}" class="finish-box" style="display:${isFinishing ? 'block' : 'none'};">
        ${renderFinishBox(order)}
      </div>
    </article>
  `;
}

function renderFinishBox(order) {
  const deliveredTime = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  if (order.is_paid) {
    return `
      <div class="hint" style="margin-bottom:10px;">Pedido pago no balcão. Entregue e confirme a finalização.</div>
      <div class="hint" style="margin-bottom:10px;">Horário atual: <strong>${deliveredTime}</strong></div>
      <button class="btn success" data-action="confirm-paid-finish" data-id="${order.id}">Marcar como entregue</button>
      <button class="btn secondary" data-action="cancel-finish" data-id="${order.id}" style="margin-top:8px;">Cancelar</button>
    `;
  }

  return `
    <div class="field">
      <label for="payment-${order.id}">Forma de pagamento na entrega</label>
      <select id="payment-${order.id}">
        <option value="">Selecione</option>
        <option>Dinheiro</option>
        <option>Cartão</option>
        <option>Pix</option>
      </select>
    </div>

    <div id="cash-box-${order.id}" style="display:none;">
      <div class="field">
        <label for="cash-${order.id}">Quanto recebeu do cliente?</label>
        <input id="cash-${order.id}" type="number" step="0.01" min="0" placeholder="Ex.: 50,00" />
      </div>
      <div id="change-preview-${order.id}" class="hint">Troco será calculado automaticamente.</div>
    </div>

    <div class="hint" style="margin-top:8px;">Horário da entrega: <strong>${deliveredTime}</strong></div>

    <div class="actions" style="margin-top:10px;">
      <button class="btn success" data-action="confirm-finish" data-id="${order.id}">Confirmar entrega</button>
      <button class="btn secondary" data-action="cancel-finish" data-id="${order.id}">Cancelar</button>
    </div>
  `;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setTheme(theme) {
  state.theme = theme;
  document.body.classList.toggle('dark-mode', theme === 'dark');
  toggleThemeBtn.textContent = theme === 'dark' ? 'Modo claro' : 'Modo escuro';
}

function setupTheme() {
  const saved = localStorage.getItem('motoboy-theme') || 'light';
  setTheme(saved);
  toggleThemeBtn.addEventListener('click', () => {
    const next = state.theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('motoboy-theme', next);
  });
}

ordersContainer.addEventListener('input', (event) => {
  const select = event.target.closest('select[id^="payment-"]');
  if (!select) return;
  const orderId = Number(select.id.replace('payment-', ''));
  const cashBox = document.getElementById(`cash-box-${orderId}`);
  if (cashBox) {
    cashBox.style.display = select.value === 'Dinheiro' ? 'block' : 'none';
  }
});

ordersContainer.addEventListener('keyup', (event) => {
  const input = event.target.closest('input[id^="cash-"]');
  if (!input) return;
  const orderId = Number(input.id.replace('cash-', ''));
  const order = state.orders.find((item) => item.id === orderId);
  const preview = document.getElementById(`change-preview-${orderId}`);
  if (preview && order) {
    const received = Number(input.value || 0);
    const change = Math.max(0, received - Number(order.order_value || 0));
    preview.textContent = `Troco estimado: ${formatMoney(change)}`;
  }
});

ordersContainer.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const { action, id } = button.dataset;
  const orderId = Number(id);

  if (action === 'start') {
    const response = await fetch(`${API_BASE}/api/orders/${orderId}/start`, { method: 'PATCH' });
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
    render();
    return;
  }

  if (action === 'cancel-finish') {
    state.finishingOrderId = null;
    render();
    return;
  }

  if (action === 'confirm-paid-finish') {
    const response = await fetch(`${API_BASE}/api/orders/${orderId}/finish`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      alert(error.error || 'Não foi possível finalizar a entrega.');
      return;
    }
    const updated = await response.json();
    state.finishingOrderId = null;
    state.orders = state.orders.filter((item) => item.id !== updated.id);
    pushHistory(updated);
    render();
    await loadAllOrders();
    return;
  }

  if (action === 'confirm-finish') {
    const select = document.getElementById(`payment-${orderId}`);
    const final_payment_method = select ? select.value : '';
    if (!final_payment_method) {
      alert('Selecione a forma de pagamento final.');
      return;
    }

    let cash_received = null;
    if (final_payment_method === 'Dinheiro') {
      const cashInput = document.getElementById(`cash-${orderId}`);
      cash_received = Number(cashInput?.value || 0);
      if (!cash_received || cash_received <= 0) {
        alert('Informe quanto recebeu do cliente.');
        return;
      }
    }

    const response = await fetch(`${API_BASE}/api/orders/${orderId}/finish`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ final_payment_method, cash_received }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      alert(error.error || 'Não foi possível finalizar a entrega.');
      return;
    }

    const updated = await response.json();
    state.finishingOrderId = null;
    state.orders = state.orders.filter((item) => item.id !== updated.id);
    pushHistory(updated);
    render();
    await loadSummary();
    await loadAllOrders();
    return;
  }
});

refreshBtn.addEventListener('click', async () => {
  await loadOrders();
  await loadAllOrders();
});

socket.on('connect', () => {
  connectionStatus.textContent = 'Online';
  connectionStatus.className = 'badge online';
  socket.emit('sync:request');
});

socket.on('disconnect', () => {
  connectionStatus.textContent = 'Offline';
  connectionStatus.className = 'badge offline';
});

socket.on('sync:orders', ({ orders }) => {
  setOrders((orders || []).filter((order) => order.status !== 'entregue'));
  loadAllOrders().catch(() => {});
});

socket.on('order:created', (order) => {
  if (order.status !== 'entregue') upsertOrder(order);
});

socket.on('order:updated', (order) => {
  if (order.status === 'entregue') {
    state.orders = state.orders.filter((item) => item.id !== order.id);
    pushHistory(order);
    render();
    loadAllOrders().catch(() => {});
  } else {
    upsertOrder(order);
  }
});

socket.on('order:delivered', (order) => {
  state.orders = state.orders.filter((item) => item.id !== order.id);
  pushHistory(order);
  render();
  loadAllOrders().catch(() => {});
});

setupTheme();
loadOrders().catch((error) => console.error(error));
loadAllOrders().catch((error) => console.error(error));
