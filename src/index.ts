import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const app = express();
const prisma = new PrismaClient({ adapter });
const PORT = process.env.PORT || 3001;
const DISCOUNT_RATE = 0.9;

app.use(cors());
app.use(express.json());

app.get("/api/products", async (req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      include: { category: true },
    });
    res.json(products);
  } catch (error) {
    console.error("GET /products error:", error);
    res.status(500).json({ error: "Błąd podczas pobierania produktów" });
  }
});

app.get("/api/products/:id", async (req: Request, res: Response) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { category: true },
    });
    if (!product) {
      res.status(404).json({ error: "Produkt nie znaleziony" });
      return;
    }
    res.json(product);
  } catch (error) {
    console.error("GET /products/:id error:", error);
    res.status(500).json({ error: "Błąd podczas pobierania produktu" });
  }
});

app.get("/api/products/category/:categoryId", async (req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      where: { categoryId: parseInt(req.params.categoryId) },
      include: { category: true },
    });
    res.json(products);
  } catch (error) {
    console.error("GET /category error:", error);
    res.status(500).json({ error: "Błąd podczas pobierania produktów" });
  }
});

app.get("/api/categories", async (req: Request, res: Response) => {
  try {
    const categories = await prisma.category.findMany({
      include: { _count: { select: { products: true } } },
    });
    res.json(categories);
  } catch (error) {
    console.error("GET /categories error:", error);
    res.status(500).json({ error: "Błąd podczas pobierania kategorii" });
  }
});

app.get("/api/cart/:userId", async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;
    const cart = await prisma.cart.findUnique({
      where: { userId: userId },
      include: {
        items: {
          include: { product: true },
        },
      },
    });
    
    // POPRAWKA: Jeśli koszyk nie istnieje, zwracamy pustą listę items zamiast błędu 404
    if (!cart) {
      res.json({ items: [] });
      return;
    }
    
    res.json(cart);
  } catch (error) {
    console.error("GET /cart error:", error);
    res.status(500).json({ error: "Błąd podczas pobierania koszyka" });
  }
});

app.post("/api/cart/:userId/items", async (req: Request, res: Response) => {
  try {
    const { productId, quantity } = req.body;
    const userId = req.params.userId;

    // Automatyczne tworzenie użytkownika, jeśli nie istnieje
    const existingUser = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!existingUser) {
      await prisma.user.create({
        data: {
          id: userId,
          email: `user_${userId}@example.com`,
          name: "Auto Generated User"
        }
      });
    }

    let cart = await prisma.cart.findUnique({ where: { userId } });
    if (!cart) {
      cart = await prisma.cart.create({ data: { userId } });
    }

    const pId = Number(productId);
    const qty = Number(quantity);

    const cartItem = await prisma.cartItem.upsert({
      where: {
        cartId_productId: { cartId: cart.id, productId: pId },
      },
      update: { quantity: { increment: qty } },
      create: { cartId: cart.id, productId: pId, quantity: qty },
      include: { product: true },
    });

    res.json(cartItem);
  } catch (error) {
    console.error("POST /cart/items error:", error);
    res.status(500).json({ error: "Błąd podczas dodawania do koszyka" });
  }
});

app.delete("/api/cart/:userId/items/:productId", async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;
    const productId = parseInt(req.params.productId);

    const cart = await prisma.cart.findUnique({ where: { userId } });
    if (!cart) {
      res.status(404).json({ error: "Koszyk nie znaleziony" });
      return;
    }

    await prisma.cartItem.delete({
      where: {
        cartId_productId: { cartId: cart.id, productId },
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error("DELETE /cart item error:", error);
    res.status(500).json({ error: "Błąd podczas usuwania z koszyka" });
  }
});

app.get("/api/orders/:userId", async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;
    const orders = await prisma.order.findMany({
      where: { userId: userId },
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(orders);
  } catch (error) {
    console.error("GET /orders error:", error);
    res.status(500).json({ error: "Błąd podczas pobierania zamówień" });
  }
});

app.post("/api/orders", async (req: Request, res: Response) => {
  try {
    const { userId, cartId } = req.body;

    const cart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: { items: { include: { product: true } } },
    });

    if (!cart || cart.items.length === 0) {
      res.status(400).json({ error: "Koszyk jest pusty" });
      return;
    }

    const totalAmount = cart.items.reduce((sum, item) =>
      sum + (item.product.price * DISCOUNT_RATE) * item.quantity, 0
    );

    const order = await prisma.order.create({
      data: {
        userId,
        totalAmount: parseFloat(totalAmount.toFixed(2)),
        items: {
          create: cart.items.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
            priceAtOrder: parseFloat((item.product.price * DISCOUNT_RATE).toFixed(2)),
            productName: item.product.name,
            productCode: item.product.code,
          })),
        },
      },
      include: { items: { include: { product: true } } },
    });

    await prisma.cartItem.deleteMany({ where: { cartId } });

    res.json(order);
  } catch (error) {
    console.error("POST /orders error:", error);
    res.status(500).json({ error: "Błąd podczas tworzenia zamówienia" });
  }
});

app.get("/api/health", async (req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "✅ OK", database: "Connected" });
  } catch (error) {
    res.status(500).json({ status: "❌ Error", database: "Disconnected" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend API running on http://localhost:${PORT}`);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});