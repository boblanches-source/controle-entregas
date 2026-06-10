
const API_BASE = 'https://controle-entregas-owfe.onrender.com';
const socket = io(API_BASE, { transports: ['websocket', 'polling'] });

const state = {
  orders: [],
  initialSyncDone: false,
};

const orderForm = document.getElementById('orderForm');
const ordersContainer = document.getElementById('ordersContainer');
const connectionStatus = document.getElementById('connectionStatus');
const paymentMethodSelect = document.getElementById('initial_payment_method');
const cashChangeBox = document.getElementById('cashChangeBox');

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

function needsChangeLabel(value) {
  return value ? 'Sim' : 'Não';
}

function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function playNewOrderSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    const audioContext = new AudioContextClass();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gainNode.gain.value = 0.0001;

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.start();

    const now = audioContext.currentTime;
    gainNode.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    oscillator.stop(now + 0.2);
  } catch (error) {
    console.warn('Não foi possível tocar o som de novo pedido.', error);
  }
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
  state.initialSyncDone = true;
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
  const deliveredAt = order.delivered_at ? formatDateTime(order.delivered_at) : '-';

  return `
    <article class="order-card status-${order.status}">
      <div class="order-top">
        <div>
          <div class="order-name">#${order.id} · ${order.customer_name}</div>
          <div class="meta">
            Pagamento inicial: <strong>${paymentLabel(order.initial_payment_method)}</strong><br />
            Bebida: <strong>${drinkLabel(order.has_drink)}</strong><br />
            Precisa de troco: <strong>${needsChangeLabel(order.needs_change)}</strong><br />
            Status: <strong>${statusLabel(order.status)}</strong><br />
            ${order.final_payment_method ? `Pagamento final: <strong>${order.final_payment_method}</strong><br />` : ''}
            ${order.final_payment_method === 'Dinheiro' && order.cash_received != null ? `Recebido: <strong>${formatMoney(order.cash_received)}</strong><br />` : ''}
            ${order.final_payment_method === 'Dinheiro' && order.cash_change != null ? `Troco: <strong>${formatMoney(order.cash_change)}</strong><br />` : ''}
            ${order.delivered_at ? `Hora da entrega: <strong>${deliveredAt}</strong><br />` : ''}
          </div>
        </div>
        <div class="badge ${statusClass(order.status)}">${statusLabel(order.status)}</div>
      </div>

      <div class="pill-row">
        ${order.needs_change ? '<span class="pill warn">Troco solicitado</span>' : '<span class="pill gray">Sem troco</span>'}
        ${order.has_drink ? '<span class="pill blue">Com bebida</span>' : '<span class="pill gray">Sem bebida</span>'}
        ${order.status === 'aguardando' ? '<span class="pill warn">Aguardando partida</span>' : ''}
        ${order.status === 'em_rota' ? '<span class="pill blue">Em rota</span>' : ''}
        ${order.status === 'entregue' ? '<span class="pill green">Entregue</span>' : ''}
      </div>
    </article>
  `;
}

function onPaymentModeChange() {
  const isCash = paymentMethodSelect.value === 'Dinheiro';
  cashChangeBox.style.display = isCash ? 'block' : 'none';
}

orderForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(orderForm);
  const paymentMethod = String(formData.get('initial_payment_method') || '');
  const needsChange = paymentMethod === 'Dinheiro' && formData.get('needs_change') === 'sim';

  const payload = {
    customer_name: String(formData.get('customer_name') || '').trim(),
    initial_payment_method: paymentMethod,
    has_drink: formData.get('has_drink') === 'on',
    needs_change: needsChange,
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
  onPaymentModeChange();
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
  if (state.initialSyncDone) playNewOrderSound();
});

socket.on('order:updated', (order) => {
  upsertOrder(order);
});

socket.on('order:delivered', (order) => {
  upsertOrder(order);
});

paymentMethodSelect.addEventListener('change', onPaymentModeChange);
onPaymentModeChange();

loadOrders().catch((error) => {
  console.error(error);
});
