import os
import hmac
from urllib.parse import quote_plus

from flask import Flask, current_app, jsonify, request, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import select

db = SQLAlchemy()

MENU = [
    {"name": "Margherita Pizza", "description": "Tomato, mozzarella, basil", "price_cents": 1299},
    {"name": "Crispy Chicken Burger", "description": "Crispy chicken, slaw, house sauce", "price_cents": 1099},
    {"name": "Paneer Tikka Bowl", "description": "Tikka paneer, rice, mint chutney", "price_cents": 1199},
    {"name": "Garden Salad", "description": "Seasonal greens, tomato, lemon dressing", "price_cents": 899},
]
ORDER_STATUSES = ("placed", "accepted", "preparing", "ready", "out_for_delivery", "delivered", "cancelled")
STATUS_NEXT = {
    "placed": {"accepted", "cancelled"},
    "accepted": {"preparing", "cancelled"},
    "preparing": {"ready", "cancelled"},
    "ready": {"out_for_delivery", "cancelled"},
    "out_for_delivery": {"delivered"},
    "delivered": set(),
    "cancelled": set(),
}


def database_uri():
    url = os.getenv("DATABASE_URL")
    if url:
        return url
    host = os.getenv("DB_HOST")
    if host:
        user = quote_plus(os.environ["DB_USER"])
        password = quote_plus(os.environ["DB_PASSWORD"])
        database = quote_plus(os.getenv("DB_NAME", "fooddelivery"))
        sslmode = os.getenv("DB_SSLMODE", "require")
        return f"postgresql+psycopg://{user}:{password}@{host}:5432/{database}?sslmode={sslmode}"
    return "sqlite:///food_delivery.db"


class MenuItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False, unique=True)
    description = db.Column(db.String(250), nullable=False)
    price_cents = db.Column(db.Integer, nullable=False)


class Order(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    customer_name = db.Column(db.String(120), nullable=False)
    delivery_address = db.Column(db.String(300), nullable=False)
    status = db.Column(db.String(30), nullable=False, default="placed")
    total_cents = db.Column(db.Integer, nullable=False)
    items = db.relationship("OrderItem", cascade="all, delete-orphan", lazy=True)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.func.now())


class OrderItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey("order.id"), nullable=False)
    menu_item_id = db.Column(db.Integer, db.ForeignKey("menu_item.id"), nullable=False)
    item_name = db.Column(db.String(120), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    unit_price_cents = db.Column(db.Integer, nullable=False)


def order_json(order):
    return {
        "id": order.id,
        "customer_name": order.customer_name,
        "email": order.email,
        "delivery_address": order.delivery_address,
        "status": order.status,
        "total_cents": order.total_cents,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "items": [
            {
                "menu_item_id": item.menu_item_id,
                "name": item.item_name,
                "quantity": item.quantity,
                "unit_price_cents": item.unit_price_cents,
            }
            for item in order.items
        ],
    }


def create_app(test_config=None):
    app = Flask(__name__, static_folder="static")
    app.config.from_mapping(
        SQLALCHEMY_DATABASE_URI=database_uri(),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        ADMIN_TOKEN=os.getenv("ADMIN_TOKEN", ""),
    )
    if test_config:
        app.config.update(test_config)
    db.init_app(app)

    with app.app_context():
        db.create_all()
        if db.session.scalar(select(db.func.count()).select_from(MenuItem)) == 0:
            db.session.add_all([MenuItem(**item) for item in MENU])
            db.session.commit()

    @app.get("/")
    def index():
        return send_from_directory(app.static_folder, "index.html")

    @app.get("/api/health")
    def health():
        db.session.execute(select(1))
        return jsonify(status="ok")

    @app.get("/api/menu")
    def get_menu():
        items = db.session.scalars(select(MenuItem).order_by(MenuItem.id)).all()
        return jsonify([
            {"id": item.id, "name": item.name, "description": item.description, "price_cents": item.price_cents}
            for item in items
        ])

    @app.get("/api/orders")
    def get_orders():
        if error := admin_auth_error():
            return error
        orders = db.session.scalars(select(Order).order_by(Order.created_at.desc(), Order.id.desc())).all()
        return jsonify([order_json(order) for order in orders])

    @app.post("/api/orders/lookup")
    def lookup_order():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify(error="Provide an order number and the email used at checkout."), 400
        order_id, email = data.get("order_id"), data.get("email")
        if isinstance(email, str):
            email = email.strip()
        if type(order_id) is not int or not isinstance(email, str) or not email or len(email) > 254:
            return jsonify(error="Provide an order number and the email used at checkout."), 400
        order = db.session.get(Order, order_id)
        if order is None or not hmac.compare_digest(
            order.email.casefold().encode("utf-8"),
            email.casefold().encode("utf-8"),
        ):
            return jsonify(error="No order matched that number and email."), 404
        details = order_json(order)
        return jsonify({key: details[key] for key in ("id", "status", "total_cents", "created_at", "items")})

    @app.post("/api/orders")
    def place_order():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify(error="Provide a customer name, valid email, delivery address, and at least one item."), 400
        name, email, address = data.get("customer_name"), data.get("email"), data.get("delivery_address")
        if not all(isinstance(value, str) for value in (name, email, address)):
            return jsonify(error="Provide a customer name, valid email, and delivery address."), 400
        name, email, address = name.strip(), email.strip(), address.strip()
        lines = data.get("items")
        if not name or "@" not in email or not address or not isinstance(lines, list) or not lines:
            return jsonify(error="Provide a customer name, valid email, delivery address, and at least one item."), 400
        if len(name) > 120 or len(email) > 254 or len(address) > 300:
            return jsonify(error="Name, email, or delivery address is too long."), 400

        quantities = {}
        for line in lines:
            if not isinstance(line, dict) or type(line.get("menu_item_id")) is not int or type(line.get("quantity")) is not int:
                return jsonify(error="Each item needs an integer menu_item_id and quantity."), 400
            item_id, quantity = line["menu_item_id"], line["quantity"]
            if quantity < 1 or quantity > 20:
                return jsonify(error="Item quantities must be between 1 and 20."), 400
            quantities[item_id] = quantities.get(item_id, 0) + quantity
            if quantities[item_id] > 20:
                return jsonify(error="Item quantities must be between 1 and 20."), 400

        menu_items = db.session.scalars(select(MenuItem).where(MenuItem.id.in_(quantities))).all()
        if len(menu_items) != len(quantities):
            return jsonify(error="One or more menu items do not exist."), 400
        total = sum(item.price_cents * quantities[item.id] for item in menu_items)
        if total > 100_000:
            return jsonify(error="Order total exceeds the $1,000 limit."), 400
        order = Order(customer_name=name, email=email, delivery_address=address, total_cents=total)
        order.items = [
            OrderItem(
                menu_item_id=item.id,
                item_name=item.name,
                quantity=quantities[item.id],
                unit_price_cents=item.price_cents,
            )
            for item in menu_items
        ]
        db.session.add(order)
        db.session.commit()
        return jsonify(order_json(order)), 201

    @app.patch("/api/orders/<int:order_id>")
    def update_order(order_id):
        if error := admin_auth_error():
            return error
        order = db.session.scalar(select(Order).where(Order.id == order_id).with_for_update())
        if order is None:
            return jsonify(error="Order not found."), 404
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify(error="Provide a valid order status."), 400
        next_status = data.get("status")
        if next_status not in ORDER_STATUSES or next_status not in STATUS_NEXT[order.status]:
            return jsonify(error=f"Invalid status transition from {order.status}.", allowed_statuses=sorted(STATUS_NEXT[order.status])), 400
        order.status = next_status
        db.session.commit()
        return jsonify(order_json(order))

    return app


def admin_auth_error():
    expected = current_app.config["ADMIN_TOKEN"]
    supplied = request.headers.get("X-Admin-Token", "")
    if not expected:
        return jsonify(error="Restaurant desk access is not configured."), 503
    if not hmac.compare_digest(expected.encode("utf-8"), supplied.encode("utf-8")):
        return jsonify(error="Restaurant desk access denied."), 401
    return None


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
