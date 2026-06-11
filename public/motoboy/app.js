const API_BASE = 'https://controle-entregas-owfe.onrender.com';
const socket = io(API_BASE, { transports: ['websocket', 'polling'] });

const state = {
  orders: [],
  summary: null,
  finishingOrderId: null,
  editingOrderId: null,
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

function paymentStatusLabel(order) {
  return order.paid_at_counter ? 'Pago no balcão' : 'Pagar na entrega';
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

function parseMoneyInput(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.\-]/g, '');

  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function moneyToInput(value) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return num.toFixed(2).replace('.', ',');
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function canEditOrder(order) {
  return order && order.status === 'aguardando';
}

function isCashDelivery(order) {
  return !order.paid_at_counter && order.initial_payment_method === 'Dinheiro';
}

function updateToggleVisuals() {
  document.querySelectorAll('.choice-grid').forEach((grid) => {
    grid.querySelectorAll('label.choice').forEach((label) => {
      const input = label.querySelector('input');
      if (!input) return;
      label.classList.toggle('is-selected', input.checked);
    });
  });
}

function setOrders(orders) {
  state.orders = [...orders].sort((a, b) => b.id - a.id);
  if (state.editingOrderId && !state.orders.some((order) => order.id === state.editingOrderId && canEditOrder(order))) {
    state.editingOrderId = null;
  }
  renderOrders();
}

function upsertOrder(order) {
  const index = state.orders.findIndex((item) => item.id === order.id);
  if (index >= 0) {
    state.orders[index] = { ...state.orders[index], ...order };
  } else {
    state.orders.unshift(order);
  }
  state.orders.sort((a, b) => b.id - a.id);
  if (state.editingOrderId === order.id && !canEditOrder(order)) {
    state.editingOrderId = null;
  }
  renderOrders();
}

function removeOrder(id) {
  state.orders = state.orders.filter((order) => order.id !== id);
  if (state.finishingOrderId === id) state.finishingOrderId = null;
  if (state.editingOrderId === id) state.editingOrderId = null;
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
    updateToggleVisuals();
    return;
  }

  ordersContainer.innerHTML = activeOrders.map(renderCard).join('');
  updateToggleVisuals();
  activeOrders.forEach((order) => updateEditVisibility(order.id));
}

function renderEditForm(order) {
  const id = order.id;
  const paidAtCounter = Boolean(order.paid_at_counter);
  const needsChange = Boolean(order.needs_change);
  const showCashChange = order.initial_payment_method === 'Dinheiro' && !paidAtCounter;
  const observations = escapeHtml(order.observations || '');
  const orderValue = Number(order.order_value || 0);

  return `
    <div class="edit-box">
      <div class="edit-grid">
        <div class="field">
          <label for="edit-customer-${id}">Cliente</label>
          <input id="edit-customer-${id}" value="${escapeHtml(order.customer_name)}" />
        </div>

        <div class="field">
          <label for="edit-value-${id}">Valor do pedido</label>
          <input id="edit-value-${id}" type="number" step="0.01" min="0" value="${orderValue}" />
        </div>

        <div class="field">
          <label for="edit-method-${id}">Forma de pagamento</label>
          <select id="edit-method-${id}">
            <option ${order.initial_payment_method === 'Dinheiro' ? 'selected' : ''}>Dinheiro</option>
            <option ${order.initial_payment_method === 'Cartão' ? 'selected' : ''}>Cartão</option>
            <option ${order.initial_payment_method === 'Pix' ? 'selected' : ''}>Pix</option>
          </select>
        </div>

        <div class="field">
          <label>Pagamento</label>
          <div class="choice-grid" id="edit-paid-group-${id}">
            <label class="choice green">
              <input type="radio" name="edit_paid_at_counter_${id}" value="1" ${paidAtCounter ? 'checked' : ''} />
              <span>Pago no balcão</span>
            </label>
            <label class="choice orange">
              <input type="radio" name="edit_paid_at_counter_${id}" value="0" ${!paidAtCounter ? 'checked' : ''} />
              <span>Pagar na entrega</span>
            </label>
          </div>
        </div>
      </div>

      <div id="edit-cash-change-${id}" style="display:${showCashChange ? 'block' : 'none'};">
        <div class="field">
          <label>Se for dinheiro, precisa de troco?</label>
          <div class="choice-grid" id="edit-needs-group-${id}">
            <label class="choice blue">
              <input type="radio" name="edit_needs_change_${id}" value="sim" ${needsChange ? 'checked' : ''} />
              <span>Sim, precisa de troco</span>
            </label>
            <label class="choice purple">
              <input type="radio" name="edit_needs_change_${id}" value="nao" ${!needsChange ? 'checked' : ''} />
              <span>Não precisa de troco</span>
            </label>
          </div>
        </div>
      </div>

      <div class="field">
        <label>Bebida</label>
        <div class="choice-grid">
          <label class="choice blue">
            <input id="edit-drink-${id}" type="checkbox" ${order.has_drink ? 'checked' : ''} />
            <span>Contém bebida</span>
          </label>
        </div>
      </div>

      <div class="field">
        <label for="edit-observations-${id}">Observações</label>
        <textarea id="edit-observations-${id}" placeholder="Observações da entrega">${observations}</textarea>
      </div>

      <div class="edit-actions">
        <button class="btn success" data-action="save-edit" data-id="${id}">Salvar alterações</button>
        <button class="btn secondary" data-action="cancel-edit" data-id="${id}">Cancelar</button>
      </div>
    </div>
  `;
}

function renderFinishForm(order) {
  const id = order.id;
  const paidAtCounter = Boolean(order.paid_at_counter);

  if (paidAtCounter) {
    return `
      <div class="inline">
        <div class="cash-box">
          <strong>Pedido pago no balcão.</strong>
          <div class="summary-note">Só confirmar a entrega no endereço do cliente.</div>
        </div>
        <button class="btn success" data-action="confirm-finish" data-id="${id}">Confirmar entrega</button>
        <button class="btn secondary" data-action="cancel-finish" data-id="${id}">Cancelar</button>
      </div>
    `;
  }

  return `
    <div class="inline">
      <div class="cash-box">
        <label style="display:block; font-size:13px; font-weight:700; color:var(--muted);">
          Forma de pagamento na entrega
        </label>
        <select id="payment-${id}" data-order-id="${id}">
          <option value="">Selecione</option>
          <option ${order.final_payment_method === 'Dinheiro' ? 'selected' : ''}>Dinheiro</option>
          <option ${order.final_payment_method === 'Cartão' ? 'selected' : ''}>Cartão</option>
          <option ${order.final_payment_method === 'Pix' ? 'selected' : ''}>Pix</option>
        </select>

        <div id="cashFields-${id}" style="display:none;" class="cash-grid">
          <div>
            <label style="display:block; font-size:13px; font-weight:700; color:var(--muted); margin-bottom:6px;">Recebido do cliente</label>
            <input id="received-${id}" inputmode="decimal" placeholder="Ex.: 100,00" />
          </div>
          <div>
            <label style="display:block; font-size:13px; font-weight:700; color:var(--muted); margin-bottom:6px;">Troco calculado</label>
            <input id="change-${id}" inputmode="decimal" placeholder="Ex.: 50,00" readonly />
          </div>
        </div>

        <div class="summary-note">Quando for dinheiro, o troco é calculado automaticamente com base no valor do pedido.</div>
      </div>

      <button class="btn success" data-action="confirm-finish" data-id="${id}">Confirmar entrega e imprimir 58mm</button>
      <button class="btn secondary" data-action="cancel-finish" data-id="${id}">Cancelar</button>
    </div>
  `;
}

function renderCard(order) {
  const isFinishing = state.finishingOrderId === order.id;
  const isEditing = state.editingOrderId === order.id && canEditOrder(order);
  const paidAtCounter = Boolean(order.paid_at_counter);
  const orderMethod = slugify(order.initial_payment_method);
  const hasObservation = Boolean(order.observations && String(order.observations).trim());
  const deliveredAt = order.delivered_at ? formatDateTime(order.delivered_at) : '-';
  const valueText = formatMoney(order.order_value || 0);

  return `
    <article class="order-card ${paidAtCounter ? 'paid-true' : ''} status-${order.status} method-${orderMethod}">
      <div class="order-head">
        <div>
          <div class="customer">#${order.id} · ${escapeHtml(order.customer_name)}</div>
          <div class="meta">
            Valor: <strong>${valueText}</strong><br />
            Pagamento: <strong>${paymentLabel(order.initial_payment_method)}</strong><br />
            Situação do pagamento: <strong>${paymentStatusLabel(order)}</strong><br />
            Bebida: <strong>${order.has_drink ? 'Sim' : 'Não'}</strong><br />
            Troco necessário: <strong>${order.needs_change ? 'Sim' : 'Não'}</strong><br />
            Status: <strong>${statusLabel(order.status)}</strong><br />
            ${order.final_payment_method ? `Pagamento de saída: <strong>${paymentLabel(order.final_payment_method)}</strong><br />` : ''}
            ${order.final_payment_method === 'Dinheiro' && order.cash_received != null ? `Recebido: <strong>${formatMoney(order.cash_received)}</strong><br />` : ''}
            ${order.final_payment_method === 'Dinheiro' && order.cash_change != null ? `Troco entregue: <strong>${formatMoney(order.cash_change)}</strong><br />` : ''}
            ${order.delivered_at ? `Hora da entrega: <strong>${deliveredAt}</strong><br />` : ''}
          </div>
        </div>
        <div class="badge ${statusBadgeClass(order.status)}">${statusLabel(order.status)}</div>
      </div>

      <div class="pill-row">
        ${paidAtCounter ? '<span class="pill green">Pago no balcão</span>' : '<span class="pill purple">Pagar na entrega</span>'}
        ${order.has_drink ? '<span class="pill blue">Com bebida</span>' : '<span class="pill gray">Sem bebida</span>'}
        ${order.needs_change ? '<span class="pill warn">Troco solicitado</span>' : '<span class="pill gray">Sem troco</span>'}
        ${order.status === 'aguardando' ? '<span class="pill warn">Aguardando saída</span>' : ''}
        ${order.status === 'em_rota' ? '<span class="pill blue">Em rota</span>' : ''}
        ${order.status === 'entregue' ? '<span class="pill green">Entregue</span>' : ''}
      </div>

      ${hasObservation ? `<div class="order-notes"><strong>Observações:</strong> ${escapeHtml(order.observations)}</div>` : ''}

      <div class="actions">
        ${canEditOrder(order) ? `<button class="btn edit" data-action="edit" data-id="${order.id}">Editar pedido</button>` : ''}
        ${order.status === 'aguardando' ? `<button class="btn success" data-action="start" data-id="${order.id}">Iniciar rota</button>` : ''}
        ${order.status !== 'entregue' ? `<button class="btn warn" data-action="open-finish" data-id="${order.id}">Finalizar entrega</button>` : ''}
      </div>

      ${isEditing ? renderEditForm(order) : ''}
      ${isFinishing ? renderFinishForm(order) : ''}
    </article>
  `;
}

function updateEditVisibility(orderId) {
  const method = document.getElementById(`edit-method-${orderId}`);
  const paid = document.querySelector(`input[name="edit_paid_at_counter_${orderId}"]:checked`)?.value === '1';
  const cashBox = document.getElementById(`edit-cash-change-${orderId}`);
  if (!method || !cashBox) return;
  cashBox.style.display = method.value === 'Dinheiro' && !paid ? 'block' : 'none';
}

function updateCashFieldsVisibility(orderId) {
  const select = document.getElementById(`payment-${orderId}`);
  const cashFields = document.getElementById(`cashFields-${orderId}`);
  if (!select || !cashFields) return;
  cashFields.style.display = select.value === 'Dinheiro' ? 'grid' : 'none';
}

function updateChangeCalculation(orderId) {
  const order = state.orders.find((item) => item.id === Number(orderId));
  if (!order) return;

  const receivedInput = document.getElementById(`received-${orderId}`);
  const changeInput = document.getElementById(`change-${orderId}`);
  if (!receivedInput || !changeInput) return;

  const received = parseMoneyInput(receivedInput.value);
  const orderValue = Number(order.order_value || 0) || 0;

  if (received === null) {
    changeInput.value = '';
    return;
  }

  const change = received - orderValue;
  changeInput.value = moneyToInput(change > 0 ? change : 0);
}

async function saveEdit(orderId) {
  const order = state.orders.find((item) => item.id === Number(orderId));
  if (!order || !canEditOrder(order)) {
    alert('Esse pedido já saiu para a rota e não pode mais ser editado.');
    return;
  }

  const customer = document.getElementById(`edit-customer-${orderId}`)?.value.trim() || '';
  const orderValueRaw = document.getElementById(`edit-value-${orderId}`)?.value;
  const paymentMethod = document.getElementById(`edit-method-${orderId}`)?.value || '';
  const paidAtCounter = document.querySelector(`input[name="edit_paid_at_counter_${orderId}"]:checked`)?.value === '1';
  const needsChangeRadio = document.querySelector(`input[name="edit_needs_change_${orderId}"]:checked`)?.value || 'nao';
  const hasDrink = document.getElementById(`edit-drink-${orderId}`)?.checked || false;
  const observations = document.getElementById(`edit-observations-${orderId}`)?.value.trim() || '';

  const orderValue = parseMoneyInput(orderValueRaw);
  if (!customer) {
    alert('Informe o nome do cliente.');
    return;
  }
  if (orderValue === null || orderValue < 0) {
    alert('Informe um valor válido para o pedido.');
    return;
  }
  if (!paymentMethod) {
    alert('Selecione a forma de pagamento.');
    return;
  }

  const payload = {
    customer_name: customer,
    order_value: orderValue,
    initial_payment_method: paymentMethod,
    paid_at_counter: paidAtCounter,
    needs_change: paymentMethod === 'Dinheiro' && !paidAtCounter ? needsChangeRadio === 'sim' : false,
    has_drink: hasDrink,
    observations,
  };

  const response = await fetch(`${API_BASE}/api/orders/${orderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    alert(error.error || 'Não foi possível salvar a edição.');
    return;
  }

  const updated = await response.json();
  state.editingOrderId = null;
  upsertOrder(updated);
}

function printReceipt(order) {
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
        <div class="row"><strong>Pedido</strong><span>${escapeHtml(order.id)}</span></div>
        <div class="row"><strong>Cliente</strong><span>${escapeHtml(order.customer_name)}</span></div>
        <div class="row"><strong>Valor</strong><span>${escapeHtml(formatMoney(order.order_value))}</span></div>
        <div class="row"><strong>Pagamento</strong><span>${escapeHtml(paymentLabel(order.final_payment_method || order.initial_payment_method || '-'))}</span></div>
        <div class="row"><strong>Hora entrega</strong><span>${escapeHtml(formatDateTime(order.delivered_at))}</span></div>
        <div class="row"><strong>Recebido</strong><span>${escapeHtml(formatMoney(order.cash_received))}</span></div>
        <div class="row"><strong>Troco</strong><span>${escapeHtml(formatMoney(order.cash_change))}</span></div>
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

function renderSummaryCards(summary) {
  const cards = [
    { label: 'Total entregas', value: summary.total_deliveries, sub: 'Finalizados no turno' },
    { label: 'Dinheiro', value: summary.Dinheiro, sub: 'Pedidos em dinheiro' },
    { label: 'Cartão', value: summary.Cartão, sub: 'Pedidos no cartão' },
    { label: 'Pix', value: summary.Pix, sub: 'Pedidos no Pix' },
  ];

  sumTotal.textContent = summary.total_deliveries || 0;
  sumDinheiro.textContent = summary.Dinheiro || 0;
  sumCartao.textContent = summary.Cartão || 0;
  sumPix.textContent = summary.Pix || 0;
}

function renderSummaryCardsContainer() {
  const summary = state.summary || { total_deliveries: 0, Dinheiro: 0, Cartão: 0, Pix: 0 };
  renderSummaryCards(summary);
}

function updateTheme() {
  document.body.classList.toggle('dark', state.darkMode);
  themeToggleBtn.textContent = state.darkMode ? 'Modo claro' : 'Modo escuro';
  localStorage.setItem('motoboy-theme', state.darkMode ? 'dark' : 'light');
}

function toggleTheme() {
  state.darkMode = !state.darkMode;
  updateTheme();
}

ordersContainer.addEventListener('change', (event) => {
  const paymentSelect = event.target.closest('select[data-order-id]');
  if (paymentSelect) {
    updateCashFieldsVisibility(paymentSelect.dataset.orderId);
    return;
  }

  const editMethod = event.target.closest('select[id^="edit-method-"]');
  if (editMethod) {
    const orderId = editMethod.id.replace('edit-method-', '');
    updateEditVisibility(orderId);
    updateToggleVisuals();
    return;
  }

  const editPaid = event.target.closest('input[name^="edit_paid_at_counter_"]');
  if (editPaid) {
    const orderId = editPaid.name.replace('edit_paid_at_counter_', '');
    updateEditVisibility(orderId);
    updateToggleVisuals();
    return;
  }

  const receivedInput = event.target.closest('input[id^="received-"]');
  if (receivedInput) {
    const orderId = receivedInput.id.replace('received-', '');
    updateChangeCalculation(orderId);
    return;
  }
});

ordersContainer.addEventListener('input', (event) => {
  const receivedInput = event.target.closest('input[id^="received-"]');
  if (receivedInput) {
    const orderId = receivedInput.id.replace('received-', '');
    updateChangeCalculation(orderId);
  }
});

ordersContainer.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const { action, id } = button.dataset;
  const orderId = Number(id);

  if (action === 'edit') {
    const order = state.orders.find((item) => item.id === orderId);
    if (!order || !canEditOrder(order)) {
      alert('Esse pedido já saiu para a rota e não pode mais ser editado.');
      return;
    }
    state.editingOrderId = orderId;
    state.finishingOrderId = null;
    renderOrders();
    return;
  }

  if (action === 'cancel-edit') {
    state.editingOrderId = null;
    renderOrders();
    return;
  }

  if (action === 'save-edit') {
    await saveEdit(orderId);
    return;
  }

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
    state.editingOrderId = null;
    upsertOrder(updated);
    return;
  }

  if (action === 'open-finish') {
    state.finishingOrderId = orderId;
    state.editingOrderId = null;
    renderOrders();
    return;
  }

  if (action === 'cancel-finish') {
    state.finishingOrderId = null;
    renderOrders();
    return;
  }

  if (action === 'confirm-finish') {
    const order = state.orders.find((item) => item.id === orderId);
    if (!order) return;

    let finalPayment = order.initial_payment_method;
    let cashReceived = null;
    let cashChange = null;

    if (!order.paid_at_counter) {
      const select = document.getElementById(`payment-${orderId}`);
      finalPayment = select ? select.value : '';

      if (!finalPayment) {
        alert('Selecione a forma de pagamento na entrega.');
        return;
      }

      if (finalPayment === 'Dinheiro') {
        const receivedInput = document.getElementById(`received-${orderId}`);
        const received = parseMoneyInput(receivedInput?.value);
        const orderValue = Number(order.order_value || 0) || 0;

        if (received === null) {
          alert('Informe quanto recebeu do cliente.');
          return;
        }

        if (received < orderValue) {
          alert('O valor recebido não pode ser menor que o valor do pedido.');
          return;
        }

        cashReceived = received;
        cashChange = Number((received - orderValue).toFixed(2));
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
    printReceipt(updated);
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
  if (!isVisible) await loadSummary();
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
updateTheme();
loadOrders().catch((error) => console.error(error));
loadSummary().catch((error) => console.error(error));
