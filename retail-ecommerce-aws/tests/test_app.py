import pytest

from app import create_app, db


@pytest.fixture()
def client():
    app = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite://",
    })
    with app.test_client() as client:
        yield client
    with app.app_context():
        db.session.remove()
        db.drop_all()


def test_catalog_inventory_and_health(client):
    assert client.get("/api/health").json == {"status": "ok"}
    products = client.get("/api/products").json
    assert len(products) >= 1
    assert client.get("/api/products?category=Home").json[0]["category"] == "Home"


def test_order_decrements_stock_and_cancellation_restores_it(client):
    product = client.get("/api/products").json[0]
    original_stock = product["stock"]
    response = client.post("/api/orders", json={
        "customer_name": "Ari",
        "email": "ari@example.com",
        "shipping_address": "10 Market Street",
        "items": [{"product_id": product["id"], "quantity": 2}],
    })
    assert response.status_code == 201
    order = response.json
    assert order["total_cents"] == product["price_cents"] * 2
    assert client.get("/api/inventory").json[0]["stock"] == original_stock - 2
    assert client.patch(f"/api/orders/{order['id']}", json={"status": "cancelled"}).status_code == 200
    assert client.get("/api/inventory").json[0]["stock"] == original_stock


def test_out_of_stock_order_does_not_change_inventory(client):
    product = client.get("/api/products").json[0]
    client.put(f"/api/inventory/{product['id']}", json={"stock": 0})
    response = client.post("/api/orders", json={
        "customer_name": "Ari",
        "email": "ari@example.com",
        "shipping_address": "10 Market Street",
        "items": [{"product_id": product["id"], "quantity": 1}],
    })
    assert response.status_code == 409
    assert client.get("/api/inventory").json[0]["stock"] == 0


@pytest.mark.parametrize("payload", [
    {},
    {"customer_name": "Ari", "email": "ari@example.com", "shipping_address": "Somewhere", "items": [{"product_id": 1, "quantity": 0}]},
    {"customer_name": "Ari", "email": "ari@example.com", "shipping_address": "Somewhere", "items": [{"product_id": 999, "quantity": 1}]},
])
def test_invalid_orders_are_rejected(client, payload):
    assert client.post("/api/orders", json=payload).status_code == 400
