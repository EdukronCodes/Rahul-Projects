import os
from urllib.parse import quote_plus

from flask import Flask, jsonify, request, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import select

db = SQLAlchemy()

INITIAL_PRODUCTS = [
    {"name": "Everyday Canvas Tote", "category": "Accessories", "description": "A sturdy carry-all for every kind of day.", "price_cents": 2400, "stock": 18, "emoji": "👜"},
    {"name": "Studio Ceramic Mug", "category": "Home", "description": "Hand-finished stoneware, made for slow mornings.", "price_cents": 1800, "stock": 24, "emoji": "☕"},
    {"name": "Weekend Knit", "category": "Clothing", "description": "Soft organic cotton with an easy, relaxed fit.", "price_cents": 5600, "stock": 12, "emoji": "🧶"},
    {"name": "Field Notes Set", "category": "Stationery", "description": "Three pocket notebooks for plans and ideas.", "price_cents": 1200, "stock": 40, "emoji": "📓"},
]
ORDER_STATUSES = ("placed", "processing", "shipped", "delivered", "cancelled")
STATUS_NEXT = {
    "placed": {"processing", "cancelled"},
    "processing": {"shipped", "cancelled"},
    "shipped": {"delivered"},
    "delivered": set(),
    "cancelled": set(),
}


class Product(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(140), nullable=False, unique=True)
    category = db.Column(db.String(60), nullable=False)
    description = db.Column(db.String(300), nullable=False)
    price_cents = db.Column(db.Integer, nullable=False)
    stock = db.Column(db.Integer, nullable=False, default=0)
    emoji = db.Column(db.String(12), nullable=False, default="📦")


class Order(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    customer_name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(254), nullable=False)
    shipping_address = db.Column(db.String(300), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="placed")
    total_cents = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.func.now())
    items = db.relationship("OrderItem", cascade="all, delete-orphan", lazy=True)


class OrderItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey("order.id"), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey("product.id"), nullable=False)
    product_name = db.Column(db.String(140), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    unit_price_cents = db.Column(db.Integer, nullable=False)


def product_json(product):
    return {
        "id": product.id,
        "name": product.name,
        "category": product.category,
        "description": product.description,
        "price_cents": product.price_cents,
        "stock": product.stock,
        "emoji": product.emoji,
    }


def order_json(order):
    return {
        "id": order.id,
        "customer_name": order.customer_name,
        "email": order.email,
        "shipping_address": order.shipping_address,
        "status": order.status,
        "total_cents": order.total_cents,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "items": [
            {
                "product_id": line.product_id,
                "name": line.product_name,
                "quantity": line.quantity,
                "unit_price_cents": line.unit_price_cents,
            }
            for line in order.items
        ],
    }


def database_uri():
    url = os.getenv("DATABASE_URL")
    if url:
        return url
    host = os.getenv("DB_HOST")
    if host:
        user = quote_plus(os.environ["DB_USER"])
        password = quote_plus(os.environ["DB_PASSWORD"])
        database = quote_plus(os.getenv("DB_NAME", "retail"))
        return f"postgresql+psycopg://{user}:{password}@{host}:5432/{database}?sslmode=require"
    return "sqlite:///retail.db"


def create_app(test_config=None):
    app = Flask(__name__, static_folder="static")
    app.config.from_mapping(
        SQLALCHEMY_DATABASE_URI=database_uri(),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
    )
    if test_config:
        app.config.update(test_config)
    db.init_app(app)

    with app.app_context():
        db.create_all()
        if db.session.scalar(select(db.func.count()).select_from(Product)) == 0:
            db.session.add_all([Product(**item) for item in INITIAL_PRODUCTS])
            db.session.commit()

    @app.get("/")
    def index():
        return send_from_directory(app.static_folder, "index.html")

    @app.get("/api/health")
    def health():
        db.session.execute(select(1))
        return jsonify(status="ok")

    @app.get("/api/products")
    def get_products():
        category = request.args.get("category")
        query = select(Product).order_by(Product.id)
        if category and category != "All":
            query = query.where(Product.category == category)
        return jsonify([product_json(product) for product in db.session.scalars(query).all()])

    @app.get("/api/inventory")
    def get_inventory():
        products = db.session.scalars(select(Product).order_by(Product.id)).all()
        return jsonify([product_json(product) for product in products])

    @app.put("/api/inventory/<int:product_id>")
    def update_inventory(product_id):
        product = db.session.get(Product, product_id)
        if product is None:
            return jsonify(error="Product not found."), 404
        data = request.get_json(silent=True) or {}
        stock = data.get("stock")
        if type(stock) is not int or stock < 0 or stock > 1_000_000:
            return jsonify(error="Stock must be a whole number between 0 and 1,000,000."), 400
        product.stock = stock
        db.session.commit()
        return jsonify(product_json(product))

    @app.get("/api/orders")
    def get_orders():
        orders = db.session.scalars(select(Order).order_by(Order.created_at.desc(), Order.id.desc())).all()
        return jsonify([order_json(order) for order in orders])

    @app.post("/api/orders")
    def place_order():
        data = request.get_json(silent=True) or {}
        name = data.get("customer_name", "").strip()
        email = data.get("email", "").strip()
        address = data.get("shipping_address", "").strip()
        lines = data.get("items")
        if not name or len(name) > 120 or "@" not in email or len(email) > 254 or not address or len(address) > 300:
            return jsonify(error="Provide a valid name, email, and shipping address."), 400
        if not isinstance(lines, list) or not lines:
            return jsonify(error="Add at least one product to your order."), 400

        quantities = {}
        for line in lines:
            if not isinstance(line, dict) or type(line.get("product_id")) is not int or type(line.get("quantity")) is not int:
                return jsonify(error="Each item needs an integer product_id and quantity."), 400
            product_id, quantity = line["product_id"], line["quantity"]
            if quantity < 1 or quantity > 20:
                return jsonify(error="Item quantities must be between 1 and 20."), 400
            quantities[product_id] = quantities.get(product_id, 0) + quantity
            if quantities[product_id] > 20:
                return jsonify(error="Item quantities must be between 1 and 20."), 400

        products = db.session.scalars(
            select(Product).where(Product.id.in_(quantities)).order_by(Product.id).with_for_update()
        ).all()
        if len(products) != len(quantities):
            return jsonify(error="One or more products do not exist."), 400
        out_of_stock = [product.name for product in products if product.stock < quantities[product.id]]
        if out_of_stock:
            return jsonify(error="Not enough inventory for: " + ", ".join(out_of_stock)), 409
        total = sum(product.price_cents * quantities[product.id] for product in products)
        if total > 1_000_000:
            return jsonify(error="Order total exceeds the $10,000 limit."), 400

        order = Order(customer_name=name, email=email, shipping_address=address, total_cents=total)
        order.items = []
        for product in products:
            quantity = quantities[product.id]
            product.stock -= quantity
            order.items.append(OrderItem(
                product_id=product.id,
                product_name=product.name,
                quantity=quantity,
                unit_price_cents=product.price_cents,
            ))
        db.session.add(order)
        db.session.commit()
        return jsonify(order_json(order)), 201

    @app.patch("/api/orders/<int:order_id>")
    def update_order(order_id):
        order = db.session.get(Order, order_id)
        if order is None:
            return jsonify(error="Order not found."), 404
        data = request.get_json(silent=True) or {}
        next_status = data.get("status")
        if next_status not in ORDER_STATUSES or next_status not in STATUS_NEXT[order.status]:
            return jsonify(error=f"Invalid status transition from {order.status}.", allowed_statuses=sorted(STATUS_NEXT[order.status])), 400
        if next_status == "cancelled":
            for line in order.items:
                product = db.session.get(Product, line.product_id)
                product.stock += line.quantity
        order.status = next_status
        db.session.commit()
        return jsonify(order_json(order))

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
