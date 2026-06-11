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
const paidAtCounterGroup = document.getElementById('paidAtCounterGroup');
const needsChangeGroup = document.getElementById('needsChangeGroup');
const summaryCards = document.getElementById('summaryCards');
const printSummaryBtn = document.getElementById('printSummaryBtn');
const summaryPrintTemplate = document.getElementById('summaryPrintTemplate');

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

function paidAtCounterLabel(value) {
  return value ? 'Pago' : 'Na entrega';
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

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
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

function updateToggleGroups() {
  document.querySelectorAll('.choice-grid').forEach((grid) => {
    grid.querySelectorAll('label.choice').forEach((label) => {
      const input = label.querySelector('input');
      if (!input) return;
      label.classList.toggle('is-selected', input.type === 'checkbox' ? input.checked : input.checked);
    });
  });
}

function syncCashBoxVisibility() {
  const payment = paymentMethodSelect.value;
  const paidAtCounter = document.querySelector('input[name="paid_at_counter"]:checked')?.value === '1';
  cashChangeBox.style.display = payment === 'Dinheiro' && !paidAtCounter ? 'block' : 'none';
}

function getPaidAtCounter() {
  return document.querySelector('input[name="paid_at_counter"]:checked')?.value === '1';
}

function getNeedsChange() {
  return document.querySelector('input[name="needs_change"]:checked')?.value === 'sim';
}

function orderEffectiveMethod(order) {
  return order.paid_at_counter ? order.initial_payment_method : order.final_payment_method;
}

function getSummary() {
  const summary = {
    total_orders: state.orders.length,
    total_deliveries: 0,
    total_received: 0,
    paid_at_counter_count: 0,
    pay_on_delivery_count: 0,
    pending_count: 0,
    Dinheiro: { count: 0, amount: 0 },
    Cartão: { count: 0, amount: 0 },
    Pix: { count: 0, amount: 0 },
  };

  for (const order of state.orders) {
    const orderValue = Number(order.order_value || 0) || 0;
    const paidAtCounter = Boolean(order.paid_at_counter);
    const delivered = order.status === 'entregue';
    const settled = paidAtCounter || delivered;
    const method = orderEffectiveMethod(order);

    if (paidAtCounter) summary.paid_at_counter_count += 1;
    else summary.pay_on_delivery_count += 1;

    if (delivered) summary.total_deliveries += 1;
    if (!settled) summary.pending_count += 1;

    if (settled) {
      summary.total_received += orderValue;
      if (summary[method]) {
        summary[method].count += 1;
        summary[method].amount += orderValue;
      }
    }
  }

  return summary;
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
  state.initialSyncDone = true;
  render();
}

async function loadOrders() {
  const response = await fetch(`${API_BASE}/api/orders`);
  if (!response.ok) throw new Error('Falha ao carregar pedidos.');
  const orders = await response.json();
  setOrders(orders);
}

function renderSummaryCards(summary) {
  const cards = [
    { label: 'Total pedidos', value: summary.total_orders, sub: 'Pedidos cadastrados' },
    { label: 'Entregues', value: summary.total_deliveries, sub: 'Finalizados no turno' },
    { label: 'Total recebido', value: formatMoney(summary.total_received), sub: 'Faturamento do turno' },
    { label: 'Pago no balcão', value: summary.paid_at_counter_count, sub: 'Somente entregar' },
    { label: 'Na entrega', value: summary.pay_on_delivery_count, sub: 'A cobrar do motoboy' },
    { label: 'Pendentes', value: summary.pending_count, sub: 'Ainda em aberto' },
  ];

  summaryCards.innerHTML = cards
    .map((card) => `
      <div class="summary-card">
        <div class="label">${card.label}</div>
        <div class="value">${card.value}</div>
        <div class="sub">${card.sub}</div>
      </div>
    `)
    .join('');
}

function renderSummaryForPrint(summary) {
  const windowRef = window.open('', '_blank', 'width=380,height=700');
  if (!windowRef) {
    alert('O navegador bloqueou a impressão. Permita pop-ups para imprimir o resumo.');
    return;
  }

  const html = `
    <!doctype html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Resumo 58mm</title>
      <style>
        @page { size: 58mm auto; margin: 2mm; }
        body {
          width: 58mm;
          margin: 0;
          padding: 0;
          font-family: Arial, Helvetica, sans-serif;
          color: #000;
          font-size: 10pt;
        }
        .receipt { width: 58mm; padding: 2mm; box-sizing: border-box; }
        h1 {
          font-size: 12pt;
          margin: 0 0 4px;
          text-align: center;
        }
        .center { text-align: center; }
        .line {
          border-top: 1px dashed #000;
          margin: 6px 0;
        }
        .row {
          display: flex;
          justify-content: space-between;
          gap: 6px;
          margin: 2px 0;
          word-break: break-word;
        }
        .muted {
          font-size: 9pt;
        }
      </style>
    </head>
    <body>
      <div class="receipt">
        <h1>Bob Lanches</h1>
        <div class="center muted">Resumo do Turno</div>
        <div class="line"></div>
        <div class="row"><strong>Total pedidos</strong><span>${summary.total_orders}</span></div>
        <div class="row"><strong>Entregues</strong><span>${summary.total_deliveries}</span></div>
        <div class="row"><strong>Total recebido</strong><span>${formatMoney(summary.total_received)}</span></div>
        <div class="row"><strong>Pago no balcão</strong><span>${summary.paid_at_counter_count}</span></div>
        <div class="row"><strong>Na entrega</strong><span>${summary.pay_on_delivery_count}</span></div>
        <div class="line"></div>
        <div class="row"><strong>Dinheiro</strong><span>${summary.Dinheiro.count} / ${formatMoney(summary.Dinheiro.amount)}</span></div>
        <div class="row"><strong>Cartão</strong><span>${summary.Cartão.count} / ${formatMoney(summary.Cartão.amount)}</span></div>
        <div class="row"><strong>Pix</strong><span>${summary.Pix.count} / ${formatMoney(summary.Pix.amount)}</span></div>
        <div class="line"></div>
        <div class="center muted">Fechado em tempo real</div>
      </div>
      <script>
        window.onload = function () {
          setTimeout(function () {
            window.print();
          }, 250);
        };
      </script>
    </body>
    </html>
  `;

  windowRef.document.open();
  windowRef.document.write(html);
  windowRef.document.close();
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

  const summary = getSummary();
  renderSummaryCards(summary);
  updateToggleGroups();
  syncCashBoxVisibility();
}

function renderCard(order) {
  const hasObservation = Boolean(order.observations && String(order.observations).trim());
  const orderMethod = slugify(order.initial_payment_method);
  const paidAtCounter = Boolean(order.paid_at_counter);
  const deliveredAt = order.delivered_at ? formatDateTime(order.delivered_at) : '-';
  const methodBadge = paidAtCounter ? '<span class="pill green">Pago</span>' : '<span class="pill warn">Pagar na entrega</span>';
  const drinkBadge = order.has_drink ? '<span class="pill blue">Com bebida</span>' : '<span class="pill gray">Sem bebida</span>';
  const changeBadge = order.initial_payment_method === 'Dinheiro'
    ? `<span class="pill ${order.needs_change ? 'warn' : 'gray'}">${order.needs_change ? 'Com troco' : 'Sem troco'}</span>`
    : '';
  const paymentBadge = `<span class="pill ${paidAtCounter ? 'green' : 'purple'}">${paidAtCounter ? 'Pago no balcão' : 'Na entrega'}</span>`;
  const valueText = formatMoney(order.order_value || 0);
  const obs = hasObservation ? `<div class="order-notes"><strong>Observações:</strong> ${escapeHtml(order.observations)}</div>` : '';

  return `
    <article class="order-card ${paidAtCounter ? 'paid-true' : ''} status-${order.status} method-${orderMethod}">
      <div class="order-top">
        <div>
          <div class="order-name">#${order.id} · ${escapeHtml(order.customer_name)}</div>
          <div class="meta">
            Valor: <strong>${valueText}</strong><br />
            Pagamento: <strong>${paymentLabel(order.initial_payment_method)}</strong><br />
            ${order.paid_at_counter ? 'Situação: <strong>Pago no balcão</strong><br />' : 'Situação: <strong>Vai pagar na entrega</strong><br />'}
            Bebida: <strong>${drinkLabel(order.has_drink)}</strong><br />
            Troco: <strong>${needsChangeLabel(order.needs_change)}</strong><br />
            Status: <strong>${statusLabel(order.status)}</strong><br />
            ${order.final_payment_method ? `Pagamento final: <strong>${paymentLabel(order.final_payment_method)}</strong><br />` : ''}
            ${order.final_payment_method === 'Dinheiro' && order.cash_received != null ? `Recebido: <strong>${formatMoney(order.cash_received)}</strong><br />` : ''}
            ${order.final_payment_method === 'Dinheiro' && order.cash_change != null ? `Troco entregue: <strong>${formatMoney(order.cash_change)}</strong><br />` : ''}
            ${order.delivered_at ? `Hora da entrega: <strong>${deliveredAt}</strong><br />` : ''}
          </div>
        </div>
        <div class="badge ${statusClass(order.status)}">${statusLabel(order.status)}</div>
      </div>

      <div class="pill-row">
        ${paymentBadge}
        ${methodBadge}
        ${drinkBadge}
        ${changeBadge}
        ${order.status === 'aguardando' ? '<span class="pill warn">Aguardando partida</span>' : ''}
        ${order.status === 'em_rota' ? '<span class="pill blue">Em rota</span>' : ''}
        ${order.status === 'entregue' ? '<span class="pill green">Entregue</span>' : ''}
      </div>

      ${obs}

      <div class="pill-row" style="margin-top:14px;">
        ${paidAtCounter ? '<span class="pill green">Somente entregar</span>' : '<span class="pill purple">Conferir pagamento na entrega</span>'}
      </div>
    </article>
  `;
}

function handlePaymentModeVisibility() {
  const payment = paymentMethodSelect.value;
  const paidAtCounter = getPaidAtCounter();
  cashChangeBox.style.display = payment === 'Dinheiro' && !paidAtCounter ? 'block' : 'none';
  updateToggleGroups();
}

function parseMoneyInput(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.\-]/g, '');

  if (cleaned === '') return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

orderForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(orderForm);
  const paymentMethod = String(formData.get('initial_payment_method') || '');
  const paidAtCounter = getPaidAtCounter();
  const needsChange = paymentMethod === 'Dinheiro' && !paidAtCounter && getNeedsChange();

  const payload = {
    customer_name: String(formData.get('customer_name') || '').trim(),
    order_value: String(formData.get('order_value') || '').trim(),
    initial_payment_method: paymentMethod,
    has_drink: formData.get('has_drink') === 'on',
    paid_at_counter: paidAtCounter,
    needs_change: needsChange,
    observations: String(formData.get('observations') || '').trim(),
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
  paymentMethodSelect.value = '';
  document.querySelector('input[name="paid_at_counter"][value="0"]').checked = true;
  document.querySelector('input[name="needs_change"][value="nao"]').checked = true;
  handlePaymentModeVisibility();
  const order = await response.json();
  upsertOrder(order);
});

function onRadioChange() {
  handlePaymentModeVisibility();
}

paymentMethodSelect.addEventListener('change', handlePaymentModeVisibility);
document.querySelectorAll('input[name="paid_at_counter"]').forEach((input) => input.addEventListener('change', onRadioChange));
document.querySelectorAll('input[name="needs_change"]').forEach((input) => input.addEventListener('change', updateToggleGroups));
document.getElementById('has_drink').addEventListener('change', updateToggleGroups);

printSummaryBtn.addEventListener('click', () => {
  const summary = getSummary();
  renderSummaryForPrint(summary);
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

loadOrders().catch((error) => {
  console.error(error);
});
handlePaymentModeVisibility();
updateToggleGroups();
