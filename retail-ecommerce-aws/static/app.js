const money = cents => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
const cart = new Map();
const categories = ["All", "Accessories", "Home", "Clothing", "Stationery"];
const nextStatuses = {
  placed: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};
let adminToken = sessionStorage.getItem("retail-admin-token") || "";
let products = [];
let activeCategory = "All";

async function api(url, options) {
  const headers = { "Content-Type": "application/json", ...(options?.headers || {}) };
  if (adminToken) headers["X-Admin-Token"] = adminToken;
  const response = await fetch(url, { ...options, headers });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Something went wrong.");
  return body;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function renderFilters() {
  document.querySelector("#filters").innerHTML = categories.map(category =>
    `<button class="filter ${category === activeCategory ? "active" : ""}" data-category="${category}">${category}</button>`).join("");
}

function renderProducts() {
  const visible = products.filter(product => activeCategory === "All" || product.category === activeCategory);
  document.querySelector("#product-grid").innerHTML = visible.map(product => `
    <article class="product-card"><div class="product-image"><span class="stock-tag">${product.stock ? `${product.stock} IN STOCK` : "SOLD OUT"}</span>${escapeHtml(product.emoji)}</div>
      <div class="product-info"><span class="category">${escapeHtml(product.category)}</span><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description)}</p>
        <div class="product-bottom"><span class="price">${money(product.price_cents)}</span><button class="add-button" data-add="${product.id}" ${product.stock ? "" : "disabled"} aria-label="Add ${escapeHtml(product.name)}">+</button></div>
      </div></article>`).join("") || '<p class="muted">No products in this collection yet.</p>';
}

function renderCart() {
  document.querySelector("#bag-count").textContent = [...cart.values()].reduce((sum, line) => sum + line.quantity, 0);
  const container = document.querySelector("#bag-lines");
  if (!cart.size) {
    container.innerHTML = '<p class="muted">Nothing in your bag just yet.</p>';
    return;
  }
  const lines = [...cart.values()];
  const total = lines.reduce((sum, line) => sum + line.product.price_cents * line.quantity, 0);
  container.innerHTML = lines.map(({ product, quantity }) => `
    <div class="bag-line"><span>${escapeHtml(product.name)} <small>${money(product.price_cents)}</small></span>
      <span class="quantity-controls"><button data-quantity="${product.id}" data-change="-1" aria-label="Remove one">−</button>${quantity}<button data-quantity="${product.id}" data-change="1" aria-label="Add one">+</button></span></div>`).join("") +
    `<div class="bag-total"><span>Subtotal</span><span>${money(total)}</span></div>`;
}

function renderOrders(orders) {
  document.querySelector("#orders-list").innerHTML = orders.length ? orders.map(order => `
    <article class="order-card"><div><h3>Order #${order.id} · ${escapeHtml(order.customer_name)}</h3>
      <p>${order.items.map(line => `${line.quantity} × ${escapeHtml(line.name)}`).join(", ")} · ${escapeHtml(order.shipping_address)} · ${escapeHtml(order.email)}</p>
      <span class="status-pill">${order.status.replaceAll("_", " ")}</span></div><div class="order-total">${money(order.total_cents)}${nextStatuses[order.status].length ? `<div class="manage-controls"><select aria-label="Next status for order ${order.id}">${nextStatuses[order.status].map(status => `<option value="${status}">${status}</option>`).join("")}</select><button data-update="${order.id}">Update</button></div>` : ""}</div></article>`).join("") :
    '<p class="muted">No merchant orders yet.</p>';
}

async function refreshOrders() {
  renderOrders(await api("/api/orders"));
}

async function refreshInventory() {
  const inventory = await api("/api/inventory");
  document.querySelector("#inventory-list").innerHTML = inventory.map(product => `
    <article class="inventory-row"><div class="inventory-name"><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.category)} · ${product.stock} units in stock</span></div>
      ${adminToken ? `<form class="stock-editor" data-stock="${product.id}"><input type="number" min="0" max="1000000" value="${product.stock}" required aria-label="New stock for ${escapeHtml(product.name)}"><button type="submit">Save stock</button></form>` : ""}</article>`).join("");
  products = inventory;
  renderProducts();
}

document.addEventListener("click", async event => {
  const filter = event.target.closest("[data-category]");
  const addButton = event.target.closest("[data-add]");
  const quantityButton = event.target.closest("[data-quantity]");
  const updateButton = event.target.closest("[data-update]");
  if (filter) {
    activeCategory = filter.dataset.category;
    renderFilters();
    renderProducts();
  }
  if (addButton) {
    const product = products.find(candidate => candidate.id === Number(addButton.dataset.add));
    if (product && product.stock > (cart.get(product.id)?.quantity || 0)) {
      cart.set(product.id, { product, quantity: (cart.get(product.id)?.quantity || 0) + 1 });
      renderCart();
    } else {
      alert("There isn’t enough stock for another one.");
    }
  }
  if (quantityButton) {
    const id = Number(quantityButton.dataset.quantity);
    const line = cart.get(id);
    if (line) {
      line.quantity += Number(quantityButton.dataset.change);
      if (line.quantity < 1) cart.delete(id);
      else if (line.quantity > line.product.stock) line.quantity = line.product.stock;
    }
    renderCart();
  }
  if (updateButton) {
    const select = updateButton.parentElement.querySelector("select");
    updateButton.disabled = true;
    try {
      await api(`/api/orders/${updateButton.dataset.update}`, {
        method: "PATCH",
        body: JSON.stringify({ status: select.value }),
      });
      await refreshOrders();
    } catch (error) {
      document.querySelector("#admin-message").textContent = error.message;
    } finally {
      updateButton.disabled = false;
    }
  }
});

document.addEventListener("submit", async event => {
  if (event.target.matches("[data-stock]")) {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await api(`/api/inventory/${form.dataset.stock}`, {
        method: "PUT",
        body: JSON.stringify({ stock: Number(form.querySelector("input").value) }),
      });
      await refreshInventory();
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  }
});

document.querySelector("#checkout-form").addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.querySelector("#checkout-message");
  if (!cart.size) {
    message.textContent = "Add something to your bag first.";
    return;
  }
  const formData = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  message.textContent = "";
  try {
    const order = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        customer_name: formData.get("customer_name"),
        email: formData.get("email"),
        shipping_address: formData.get("shipping_address"),
        items: [...cart.values()].map(({ product, quantity }) => ({ product_id: product.id, quantity })),
      }),
    });
    cart.clear();
    event.currentTarget.reset();
    renderCart();
    message.textContent = `Order #${order.id} is confirmed.`;
    showTrackedOrder(order);
    await refreshInventory();
    document.querySelector("#orders").scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

function showTrackedOrder(order) {
  document.querySelector("#order-status").innerHTML = `<article class="order-card"><div><h3>Order #${order.id}</h3><p>${order.items.map(line => `${line.quantity} × ${escapeHtml(line.name)}`).join(", ")}</p><span class="status-pill">${order.status}</span></div><div class="order-total">${money(order.total_cents)}</div></article>`;
}

document.querySelector("#lookup-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const result = document.querySelector("#order-status");
  result.textContent = "Looking up your order…";
  try {
    const order = await api("/api/orders/lookup", {
      method: "POST",
      body: JSON.stringify({ order_id: Number(form.get("order_id")), email: form.get("email") }),
    });
    showTrackedOrder(order);
  } catch (error) {
    result.textContent = error.message;
  }
});

document.querySelector("#admin-login").addEventListener("click", async () => {
  const input = document.querySelector("#admin-token");
  const message = document.querySelector("#admin-message");
  adminToken = input.value;
  try {
    await Promise.all([refreshOrders(), refreshInventory()]);
    sessionStorage.setItem("retail-admin-token", adminToken);
    input.value = "";
    message.textContent = "Merchant desk unlocked for this browser session.";
  } catch (error) {
    adminToken = "";
    sessionStorage.removeItem("retail-admin-token");
    message.textContent = error.message;
    await refreshInventory();
  }
});

document.querySelector("#admin-logout").addEventListener("click", async () => {
  adminToken = "";
  sessionStorage.removeItem("retail-admin-token");
  document.querySelector("#orders-list").innerHTML = '<p class="muted">Unlock the desk to view merchant orders.</p>';
  document.querySelector("#admin-message").textContent = "Merchant desk locked.";
  await refreshInventory();
});

document.querySelector("#refresh-orders").addEventListener("click", () => refreshOrders().catch(error => {
  document.querySelector("#admin-message").textContent = error.message;
}));

refreshInventory().then(renderFilters).catch(error => {
  document.querySelector("#product-grid").innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
});
if (adminToken) {
  Promise.all([refreshOrders(), refreshInventory()])
    .then(() => { document.querySelector("#admin-message").textContent = "Merchant desk unlocked for this browser session."; })
    .catch(error => {
      adminToken = "";
      sessionStorage.removeItem("retail-admin-token");
      document.querySelector("#admin-message").textContent = error.message;
      refreshInventory();
    });
}
