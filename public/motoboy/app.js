
const API_BASE = 'https://controle-entregas-owfe.onrender.com';
const socket = io(API_BASE, { transports: ['websocket', 'polling'] });

const state = {
  orders: [],
  summary: null,
  finishingOrderId: null,
  darkMode: true,
};

const connectionStatus = document.getElementById('connectionStatus');
const ordersContainer = document.getElementById('ordersContainer');
const refreshBtn = document.getElementById('refreshBtn');
const toggleSummaryBtn = document.getElementById('toggleSummaryBtn');
const summaryPanel = document.getElementById('summaryPanel');
const themeToggleBtn = document.getElementById('themeToggleBtn');

const sumTotal = document.getElementById('sumTotal');
const sumDinheiro = document.getElementById('sumDinheiro');
const sumCartao = document.getElementById('sumCartao');
const sumPix = document.getElementById('sumPix');
const receiptTemplate = document.getElementById('receiptTemplate');

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

function paymentLabel(value) {
  return value || '-';
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

function isDarkMode() {
  return state.darkMode;
}

function applyTheme() {
  document.body.classList.toggle('dark', isDarkMode());
  themeToggleBtn.textContent = isDarkMode() ? 'Modo claro' : 'Modo escuro';
  localStorage.setItem('motoboy-theme', isDarkMode() ? 'dark' : 'light');
}

function toggleTheme() {
  state.darkMode = !state.darkMode;
  applyTheme();
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
  const deliveredAt = order.delivered_at ? formatDateTime(order.delivered_at) : '-';

  return `
    <article class="order-card status-${order.status}">
      <div class="order-head">
        <div>
          <div class="customer">#${order.id} · ${order.customer_name}</div>
          <div class="meta">
            Pagamento inicial: <strong>${paymentLabel(order.initial_payment_method)}</strong><br />
            Bebida: <strong>${order.has_drink ? 'Sim' : 'Não'}</strong><br />
            Precisa de troco: <strong>${order.needs_change ? 'Sim' : 'Não'}</strong><br />
            Status: <strong>${statusLabel(order.status)}</strong><br />
            ${order.delivered_at ? `Hora da entrega: <strong>${deliveredAt}</strong><br />` : ''}
            ${order.final_payment_method ? `Pagamento final: <strong>${order.final_payment_method}</strong><br />` : ''}
            ${order.final_payment_method === 'Dinheiro' && order.cash_received != null ? `Recebido: <strong>${formatMoney(order.cash_received)}</strong><br />` : ''}
            ${order.final_payment_method === 'Dinheiro' && order.cash_change != null ? `Troco: <strong>${formatMoney(order.cash_change)}</strong><br />` : ''}
          </div>
        </div>
        <div class="badge ${statusBadgeClass(order.status)}">${statusLabel(order.status)}</div>
      </div>

      <div class="pill-row">
        ${order.status === 'aguardando' ? '<span class="pill warn">Aguardando partida</span>' : ''}
        ${order.status === 'em_rota' ? '<span class="pill blue">Em rota</span>' : ''}
        ${order.status === 'entregue' ? '<span class="pill green">Entregue</span>' : ''}
        ${order.needs_change ? '<span class="pill warn">Troco solicitado</span>' : '<span class="pill">Sem troco</span>'}
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
              <div class="cash-box">
                <label style="display:block; font-size:13px; font-weight:700; color:var(--muted);">
                  Forma de pagamento final
                </label>
                <select id="payment-${order.id}" data-order-id="${order.id}">
                  <option value="">Selecione</option>
                  <option>Dinheiro</option>
                  <option>Cartão</option>
                  <option>Pix</option>
                </select>

                <div id="cashFields-${order.id}" style="display:none;" class="cash-grid">
                  <div>
                    <label style="display:block; font-size:13px; font-weight:700; color:var(--muted); margin-bottom:6px;">Quanto recebeu</label>
                    <input id="received-${order.id}" inputmode="decimal" placeholder="Ex.: 50,00" />
                  </div>
                  <div>
                    <label style="display:block; font-size:13px; font-weight:700; color:var(--muted); margin-bottom:6px;">Quanto deu de troco</label>
                    <input id="change-${order.id}" inputmode="decimal" placeholder="Ex.: 7,00" />
                  </div>
                </div>

                <button class="btn success" data-action="confirm-finish" data-id="${order.id}">
                  Confirmar Entrega e Imprimir 58mm
                </button>
                <button class="btn secondary" data-action="cancel-finish" data-id="${order.id}">
                  Cancelar
                </button>
              </div>
            </div>
          `
          : ''
      }
    </article>
  `;
}

function updateCashFieldsVisibility(orderId) {
  const select = document.getElementById(`payment-${orderId}`);
  const cashFields = document.getElementById(`cashFields-${orderId}`);
  if (!select || !cashFields) return;

  cashFields.style.display = select.value === 'Dinheiro' ? 'grid' : 'none';
}

function parseMoneyInput(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.\\-]/g, '');

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

function openReceiptWindow(order) {
  const received = order.cash_received != null ? formatMoney(order.cash_received) : '-';
  const change = order.cash_change != null ? formatMoney(order.cash_change) : '-';
  const windowRef = window.open('', '_blank', 'width=380,height=700');
  if (!windowRef) {
    alert('O navegador bloqueou a impressão. Permita pop-ups para imprimir o comprovante.');
    return;
  }

  const html = `
    <!doctype html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Comprovante 58mm</title>
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
        .btn {
          margin-top: 10px;
          width: 100%;
          padding: 8px 10px;
          border: 0;
          border-radius: 8px;
          background: #000;
          color: #fff;
        }
      </style>
    </head>
    <body>
      <div class="receipt">
        <h1>Bob Lanches</h1>
        <div class="center muted">Comprovante de Entrega</div>
        <div class="line"></div>
        <div class="row"><strong>Pedido</strong><span>#${escapeHtml(order.id)}</span></div>
        <div class="row"><strong>Cliente</strong><span>${escapeHtml(order.customer_name)}</span></div>
        <div class="row"><strong>Pagamento</strong><span>${escapeHtml(order.final_payment_method || '-')}</span></div>
        <div class="row"><strong>Bebida</strong><span>${order.has_drink ? 'Sim' : 'Não'}</span></div>
        <div class="row"><strong>Hora entrega</strong><span>${escapeHtml(formatDateTime(order.delivered_at))}</span></div>
        <div class="line"></div>
        <div class="row"><strong>Recebido</strong><span>${escapeHtml(received)}</span></div>
        <div class="row"><strong>Troco</strong><span>${escapeHtml(change)}</span></div>
        <div class="line"></div>
        <div class="center muted">Obrigado e volte sempre!</div>
        <button class="btn" onclick="window.print()">Imprimir</button>
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

ordersContainer.addEventListener('change', (event) => {
  const select = event.target.closest('select[data-order-id]');
  if (!select) return;
  const orderId = select.getAttribute('data-order-id');
  updateCashFieldsVisibility(orderId);
});

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

    let cashReceived = null;
    let cashChange = null;

    if (finalPayment === 'Dinheiro') {
      const receivedInput = document.getElementById(`received-${orderId}`);
      const changeInput = document.getElementById(`change-${orderId}`);

      cashReceived = parseMoneyInput(receivedInput?.value);
      cashChange = parseMoneyInput(changeInput?.value);

      if (cashReceived === null) {
        alert('Informe quanto recebeu do cliente.');
        return;
      }

      if (cashChange === null) {
        alert('Informe quanto deu de troco.');
        return;
      }
    }

    const response = await fetch(`${API_BASE}/api/orders/${orderId}/finish`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        final_payment_method: finalPayment,
        cash_received: cashReceived,
        cash_change: cashChange,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      alert(error.error || 'Não foi possível finalizar a entrega.');
      return;
    }

    state.finishingOrderId = null;
    const updated = await response.json();
    openReceiptWindow(updated);
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

themeToggleBtn.addEventListener('click', toggleTheme);

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
  setOrders((orders || []).filter((order) => order.status !== 'entregue'));
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

const savedTheme = localStorage.getItem('motoboy-theme');
if (savedTheme === 'light') {
  state.darkMode = false;
}
applyTheme();

loadOrders().catch((error) => console.error(error));
loadSummary().catch((error) => console.error(error));
