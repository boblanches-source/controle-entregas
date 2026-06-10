const API_BASE = window.API_BASE || 'https://controle-entregas-owfe.onrender.com';
const socket = io(API_BASE, { transports: ['websocket', 'polling'] });

const state = {
  orders: [],
  summary: null,
};

const orderForm = document.getElementById('orderForm');
const ordersContainer = document.getElementById('ordersContainer');
const connectionStatus = document.getElementById('connectionStatus');
const ordersCount = document.getElementById('ordersCount');

const initialPaymentMethod = document.getElementById('initial_payment_method');
const cashOptions = document.getElementById('cashOptions');
const refreshSummaryBtn = document.getElementById('refreshSummaryBtn');
const printSummaryBtn = document.getElementById('printSummaryBtn');
const printArea = document.getElementById('printArea');

const sumTotalDeliveries = document.getElementById('sumTotalDeliveries');
const sumTotalReceived = document.getElementById('sumTotalReceived');
const sumCounterReceived = document.getElementById('sumCounterReceived');
const sumDeliveryReceived = document.getElementById('sumDeliveryReceived');
const sumMoney = document.getElementById('sumMoney');
const sumCard = document.getElementById('sumCard');
const sumPix = document.getElementById('sumPix');
const sumChange = document.getElementById('sumChange');
const summaryDetails = document.getElementById('summaryDetails');

let audioContext = null;
let lastKnownOrderIds = new Set();

function formatMoney(value) {
  const number = Number(value || 0);
  return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function paymentLabel(value) {
  return value || '-';
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

function drinkLabel(value) {
  return value ? 'Sim' : 'Não';
}

function playNotificationSound() {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = audioContext;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.value = 0.001;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    oscillator.stop(ctx.currentTime + 0.4);
  } catch (error) {
    console.warn('Som não disponível:', error);
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
}

async function loadOrders() {
  const response = await fetch(`${API_BASE}/api/orders`);
  if (!response.ok) throw new Error('Falha ao carregar pedidos.');
  const orders = await response.json();
  setOrders(orders);
  lastKnownOrderIds = new Set(state.orders.map((order) => order.id));
}

async function loadSummary() {
  const response = await fetch(`${API_BASE}/api/summary/today`);
  if (!response.ok) throw new Error('Falha ao carregar resumo.');
  const summary = await response.json();
  state.summary = summary;
  renderSummary();
}

function formatSummaryNumber(value) {
  return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderSummary() {
  const summary = state.summary || {
    total_deliveries: 0,
    total_received: 0,
    paid_at_counter_total: 0,
    paid_on_delivery_total: 0,
    total_change_given: 0,
    Dinheiro: { count: 0, total: 0 },
    Cartão: { count: 0, total: 0 },
    Pix: { count: 0, total: 0 },
    payment_breakdown: [],
  };

  sumTotalDeliveries.textContent = String(summary.total_deliveries || 0);
  sumTotalReceived.textContent = formatMoney(summary.total_received || 0);
  sumCounterReceived.textContent = formatMoney(summary.paid_at_counter_total || 0);
  sumDeliveryReceived.textContent = formatMoney(summary.paid_on_delivery_total || 0);
  sumMoney.textContent = `${summary.Dinheiro?.count || 0} pedidos · ${formatMoney(summary.Dinheiro?.total || 0)}`;
  sumCard.textContent = `${summary.Cartão?.count || 0} pedidos · ${formatMoney(summary.Cartão?.total || 0)}`;
  sumPix.textContent = `${summary.Pix?.count || 0} pedidos · ${formatMoney(summary.Pix?.total || 0)}`;
  sumChange.textContent = formatMoney(summary.total_change_given || 0);

  const lines = [
    `Total de entregas: ${summary.total_deliveries || 0}`,
    `Total recebido: ${formatMoney(summary.total_received || 0)}`,
    `Pago no balcão: ${formatMoney(summary.paid_at_counter_total || 0)}`,
    `Pago na entrega: ${formatMoney(summary.paid_on_delivery_total || 0)}`,
    `Troco entregue: ${formatMoney(summary.total_change_given || 0)}`,
  ];

  summaryDetails.innerHTML = lines
    .map((line) => `<div class="summary-item"><span>${line.split(':')[0]}</span><strong>${line.split(':').slice(1).join(':').trim()}</strong></div>`)
    .join('');
}

function render() {
  const activeOrders = state.orders.filter((order) => order.status !== 'entregue');
  const doneOrders = state.orders.filter((order) => order.status === 'entregue');

  ordersCount.textContent = `${state.orders.length} pedidos (${activeOrders.length} ativos)`;

  const activeHtml = activeOrders.length
    ? activeOrders.map(renderCard).join('')
    : `<div class="empty">Nenhum pedido em andamento.</div>`;

  const doneHtml = doneOrders.length
    ? doneOrders.slice(0, 8).map(renderCard).join('')
    : '';

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
      <div class="orders">${doneHtml || '<div class="empty">Nenhum pedido concluído hoje.</div>'}</div>
    </div>
  `;
}

function renderCard(order) {
  return `
    <article class="order-card ${statusClass(order.status)}">
      <div class="order-top">
        <div>
          <div class="order-name">#${order.id} · ${order.customer_name}</div>
          <div class="meta">
            Valor: <strong>${formatMoney(order.order_value)}</strong><br />
            Pagamento: <strong>${paymentLabel(order.initial_payment_method)}</strong><br />
            Pago no balcão: <strong>${order.is_paid ? 'Sim' : 'Não'}</strong><br />
            Bebida: <strong>${drinkLabel(order.has_drink)}</strong><br />
            ${order.status === 'entregue' && order.delivered_at ? `Horário da entrega: <strong>${new Date(order.delivered_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong><br />` : ''}
          </div>
        </div>

        <div class="order-badges">
          <span class="pill ${statusClass(order.status)}">${statusLabel(order.status)}</span>
          ${order.is_paid ? '<span class="pill paid">PAGO</span>' : '<span class="pill">A RECEBER</span>'}
          ${order.has_drink ? '<span class="pill drink">Bebida</span>' : ''}
        </div>
      </div>

      ${order.observations ? `<div class="notes"><strong>Observações:</strong> ${escapeHtml(order.observations)}</div>` : ''}

      <div class="actions">
        ${
          order.status === 'aguardando'
            ? `<button class="btn-route" data-action="start" data-id="${order.id}">Iniciar rota</button>`
            : ''
        }

        ${
          order.status !== 'entregue'
            ? `<button class="btn-finish" data-action="open-finish" data-id="${order.id}">Finalizar entrega</button>`
            : ''
        }
      </div>

      <div id="finish-box-${order.id}" class="finish-box" style="display:none;">
        ${renderFinishBox(order)}
      </div>
    </article>
  `;
}

function renderFinishBox(order) {
  if (order.is_paid) {
    return `
      <div class="hint" style="margin-bottom:10px;">Pedido já pago no balcão. O motoboy só precisa marcar como entregue.</div>
      <button class="btn-finish" data-action="confirm-paid-finish" data-id="${order.id}">Marcar como entregue</button>
      <button class="btn-cancel" data-action="cancel-finish" data-id="${order.id}" style="margin-top:8px;">Cancelar</button>
    `;
  }

  return `
    <div class="field">
      <label for="payment-${order.id}" style="display:block; margin-bottom:6px; font-weight:700; color:#334155;">Forma de pagamento na entrega</label>
      <select id="payment-${order.id}">
        <option value="">Selecione</option>
        <option>Dinheiro</option>
        <option>Cartão</option>
        <option>Pix</option>
      </select>
    </div>

    <div id="cash-box-${order.id}" style="display:none;">
      <div class="field">
        <label for="cash-${order.id}" style="display:block; margin-bottom:6px; font-weight:700; color:#334155;">Quanto recebeu do cliente?</label>
        <input id="cash-${order.id}" type="number" step="0.01" min="0" placeholder="Ex.: 50,00" />
      </div>
      <div class="hint">O sistema calcula o troco automaticamente.</div>
    </div>

    <div class="actions" style="margin-top:10px;">
      <button class="btn-finish" data-action="confirm-finish" data-id="${order.id}">Confirmar entrega</button>
      <button class="btn-cancel" data-action="cancel-finish" data-id="${order.id}">Cancelar</button>
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

function printSummary() {
  const summary = state.summary || {
    total_deliveries: 0,
    total_received: 0,
    paid_at_counter_total: 0,
    paid_on_delivery_total: 0,
    total_change_given: 0,
    Dinheiro: { count: 0, total: 0 },
    Cartão: { count: 0, total: 0 },
    Pix: { count: 0, total: 0 },
  };

  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR');
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const html = `
    <!doctype html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Resumo do Turno</title>
      <style>
        @page { size: 58mm auto; margin: 2mm; }
        body { width: 58mm; margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
        .ticket { width: 58mm; font-size: 10px; line-height: 1.35; }
        h1 { font-size: 13px; text-align: center; margin: 0 0 6px; }
        .center { text-align: center; }
        .line { border-top: 1px dashed #000; margin: 6px 0; }
        .row { display: flex; justify-content: space-between; gap: 8px; }
        .muted { font-size: 9px; }
        .section { margin: 6px 0; }
      </style>
    </head>
    <body>
      <div class="ticket">
        <h1>BOB LANCHES</h1>
        <div class="center">RESUMO DO TURNO</div>
        <div class="center muted">${dateStr} · ${timeStr}</div>
        <div class="line"></div>
        <div class="row"><span>Total de entregas</span><strong>${summary.total_deliveries || 0}</strong></div>
        <div class="row"><span>Total recebido</span><strong>${formatMoney(summary.total_received || 0)}</strong></div>
        <div class="row"><span>Pago no balcão</span><strong>${formatMoney(summary.paid_at_counter_total || 0)}</strong></div>
        <div class="row"><span>Pago na entrega</span><strong>${formatMoney(summary.paid_on_delivery_total || 0)}</strong></div>
        <div class="row"><span>Troco entregue</span><strong>${formatMoney(summary.total_change_given || 0)}</strong></div>
        <div class="line"></div>
        <div class="section"><strong>Por forma de pagamento</strong></div>
        <div class="row"><span>Dinheiro (${summary.Dinheiro?.count || 0})</span><strong>${formatMoney(summary.Dinheiro?.total || 0)}</strong></div>
        <div class="row"><span>Cartão (${summary.Cartão?.count || 0})</span><strong>${formatMoney(summary.Cartão?.total || 0)}</strong></div>
        <div class="row"><span>Pix (${summary.Pix?.count || 0})</span><strong>${formatMoney(summary.Pix?.total || 0)}</strong></div>
        <div class="line"></div>
        <div class="center muted">Controle do balcão</div>
      </div>
      <script>
        window.onload = function() {
          window.print();
          setTimeout(function(){ window.close(); }, 300);
        };
      </script>
    </body>
    </html>
  `;

  const popup = window.open('', '_blank', 'width=480,height=720');
  if (!popup) {
    alert('Permita pop-ups para imprimir o resumo.');
    return;
  }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}

async function submitOrder(event) {
  event.preventDefault();

  const formData = new FormData(orderForm);
  const initial_payment_method = String(formData.get('initial_payment_method') || '');
  const payload = {
    customer_name: String(formData.get('customer_name') || '').trim(),
    order_value: Number(formData.get('order_value') || 0),
    initial_payment_method,
    is_paid: formData.get('is_paid') === 'on',
    needs_change: formData.get('needs_change') === 'on' && initial_payment_method === 'Dinheiro',
    has_drink: formData.get('has_drink') === 'on',
    observations: String(formData.get('observations') || '').trim(),
  };

  const response = await fetch(`${API_BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    alert(error.error || 'Não foi possível lançar o pedido.');
    return;
  }

  orderForm.reset();
  cashOptions.style.display = 'none';
  const order = await response.json();
  upsertOrder(order);
}

function renderSummaryFromState() {
  renderSummary();
}

function renderSummary() {
  const summary = state.summary || {
    total_deliveries: 0,
    total_received: 0,
    paid_at_counter_total: 0,
    paid_on_delivery_total: 0,
    total_change_given: 0,
    Dinheiro: { count: 0, total: 0 },
    Cartão: { count: 0, total: 0 },
    Pix: { count: 0, total: 0 },
  };

  sumTotalDeliveries.textContent = String(summary.total_deliveries || 0);
  sumTotalReceived.textContent = formatMoney(summary.total_received || 0);
  sumCounterReceived.textContent = formatMoney(summary.paid_at_counter_total || 0);
  sumDeliveryReceived.textContent = formatMoney(summary.paid_on_delivery_total || 0);
  sumMoney.textContent = `${summary.Dinheiro?.count || 0} pedidos · ${formatMoney(summary.Dinheiro?.total || 0)}`;
  sumCard.textContent = `${summary.Cartão?.count || 0} pedidos · ${formatMoney(summary.Cartão?.total || 0)}`;
  sumPix.textContent = `${summary.Pix?.count || 0} pedidos · ${formatMoney(summary.Pix?.total || 0)}`;
  sumChange.textContent = formatMoney(summary.total_change_given || 0);

  summaryDetails.innerHTML = `
    <div class="summary-item"><span>Total de entregas</span><strong>${summary.total_deliveries || 0}</strong></div>
    <div class="summary-item"><span>Total recebido</span><strong>${formatMoney(summary.total_received || 0)}</strong></div>
    <div class="summary-item"><span>Pago no balcão</span><strong>${formatMoney(summary.paid_at_counter_total || 0)}</strong></div>
    <div class="summary-item"><span>Pago na entrega</span><strong>${formatMoney(summary.paid_on_delivery_total || 0)}</strong></div>
    <div class="summary-item"><span>Troco entregue</span><strong>${formatMoney(summary.total_change_given || 0)}</strong></div>
  `;
}

function initializeThemeAndEvents() {
  initialPaymentMethod.addEventListener('change', () => {
    cashOptions.style.display = initialPaymentMethod.value === 'Dinheiro' ? 'block' : 'none';
    if (initialPaymentMethod.value !== 'Dinheiro') {
      const needsChange = document.getElementById('needs_change');
      if (needsChange) needsChange.checked = false;
    }
  });

  orderForm.addEventListener('submit', submitOrder);

  refreshSummaryBtn.addEventListener('click', async () => {
    await loadSummary();
  });

  printSummaryBtn.addEventListener('click', () => {
    printSummary();
  });

  ordersContainer.addEventListener('input', (event) => {
    const select = event.target.closest('select[id^="payment-"]');
    if (!select) return;
    const orderId = Number(select.id.replace('payment-', ''));
    const cashBox = document.getElementById(`cash-box-${orderId}`);
    if (cashBox) {
      cashBox.style.display = select.value === 'Dinheiro' ? 'block' : 'none';
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
      const box = document.getElementById(`finish-box-${orderId}`);
      if (box) {
        const isHidden = box.style.display === 'none' || !box.style.display;
        box.style.display = isHidden ? 'block' : 'none';
      }
      return;
    }

    if (action === 'cancel-finish') {
      const box = document.getElementById(`finish-box-${orderId}`);
      if (box) box.style.display = 'none';
      return;
    }

    if (action === 'confirm-paid-finish') {
      const response = await fetch(`${API_BASE}/api/orders/${orderId}/finish`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        alert(error.error || 'Não foi possível finalizar a entrega.');
        return;
      }

      const updated = await response.json();
      upsertOrder(updated);
      await loadSummary();
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
      upsertOrder(updated);
      await loadSummary();
    }
  });
}

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
  const currentIds = new Set((orders || []).map((order) => order.id));
  const isDifferent = currentIds.size !== lastKnownOrderIds.size || [...currentIds].some((id) => !lastKnownOrderIds.has(id));
  setOrders(orders || []);
  lastKnownOrderIds = currentIds;
  if (isDifferent && currentIds.size > lastKnownOrderIds.size) {
    playNotificationSound();
  }
});

socket.on('order:created', (order) => {
  if (!lastKnownOrderIds.has(order.id)) {
    playNotificationSound();
  }
  upsertOrder(order);
  lastKnownOrderIds.add(order.id);
});

socket.on('order:updated', (order) => {
  upsertOrder(order);
});

socket.on('order:delivered', (order) => {
  upsertOrder(order);
  loadSummary().catch(() => {});
});

loadOrders().catch((error) => console.error(error));
loadSummary().catch((error) => console.error(error));
