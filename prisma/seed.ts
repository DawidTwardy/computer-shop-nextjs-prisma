// prisma/seed.ts

import { PrismaClient, OrderStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
// POPRAWKA: Używamy require zamiast import, aby uniknąć błędu modułów z tsx
const productsData = require('../data/products.json');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const productTypes = ['procesor', 'karta graficzna', 'pamięć ram', 'dysk'];

async function main() {
  console.log('Rozpoczynam pełny seeding...');

  // 1. Czyszczenie bazy danych (w kolejności odwrotnej do zależności)
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  // DODANE: Czyszczenie nowych tabel Auth.js
  await (prisma as any).session.deleteMany();
  await (prisma as any).account.deleteMany();
  await (prisma as any).verificationToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  console.log('Wyczyszczono stare dane.');

  // 2. Tworzenie kategorii i mapowanie ich ID
  await prisma.category.createMany({
    data: productTypes.map(type => ({ name: type })),
    skipDuplicates: true,
  });
  const categories = await prisma.category.findMany();
  const categoryMap = new Map(categories.map(c => [c.name, c.id]));
  console.log(`Utworzono ${categories.length} kategorii.`);
  
  // 3. Tworzenie produktów
  const productsToSeed = productsData.map((p: any) => ({
    ...p,
    price: parseFloat(p.price.toFixed(2)), 
    categoryId: categoryMap.get(p.type)!, 
    type: p.type, 
  }));
  
  const productCreationData = productsToSeed.map(({ id, date, ...rest }: any) => ({ 
    ...rest, 
  })); 
  
  await prisma.product.createMany({
    data: productCreationData,
    skipDuplicates: true,
  });
  console.log(`Utworzono ${productsToSeed.length} produktów (z pliku JSON).`);

  // 4. Odczyt produktów z nowymi ID z bazy (aby móc ich użyć w relacjach)
  const allProducts = await prisma.product.findMany({ orderBy: { id: 'asc' } });
  const getProductByCode = (code: string) => allProducts.find(p => p.code === code)!;
  
  // 5. Tworzenie użytkownika (ZMODYFIKOWANE dla Auth.js - usunięto hasło)
  const user = await prisma.user.create({
    data: {
      email: 'user@pk.edu.pl',
      name: 'Jan Kowalski (Testowy)',
    },
  });
  console.log(`Utworzono użytkownika testowego (ID: ${user.id}).`);

  // 6. Przykładowy Koszyk (Cart) z CartItem
  const cart = await prisma.cart.create({
    data: {
      userId: user.id, // ID jest teraz String
      items: {
        create: [
          // RTX 4070 SUPER
          { productId: getProductByCode('GPU-NV4070SUPR').id, quantity: 1, createdAt: new Date(Date.now() - 3600000) },
          // Corsair Vengeance 32GB RAM
          { productId: getProductByCode('RAM-D5600032GC').id, quantity: 2, createdAt: new Date() },
        ],
      },
    },
  });
  console.log(`Utworzono koszyk (ID: ${cart.id}) z 2 produktami.`);

  // 7. Przykładowe Zamówienia (Orders) - minimum 4
  const ordersInfo = [
    {
      status: OrderStatus.DELIVERED,
      productItems: [
        { code: 'CPU-I714700K', quantity: 1 },
        { code: 'SSD-SAMSUNG990P', quantity: 1 },
      ],
      date: '2025-01-10T12:00:00Z',
    },
    {
      status: OrderStatus.CANCELLED,
      productItems: [
        { code: 'GPU-NV4090FE', quantity: 1 },
        { code: 'RAM-D5800032G', quantity: 1 },
      ],
      date: '2025-03-20T10:00:00Z',
    },
    {
      status: OrderStatus.SHIPPED,
      productItems: [
        { code: 'CPU-I914900K', quantity: 1 },
        { code: 'GPU-AMDRX7800XT', quantity: 1 },
      ],
      date: '2025-11-25T15:00:00Z',
    },
    {
      status: OrderStatus.PENDING,
      productItems: [
        { code: 'SSD-CRUCIALT7002TB', quantity: 1 },
        { code: 'RAM-D5760032G', quantity: 1 },
        { code: 'HDD-WDBLUE6TB', quantity: 1 },
      ],
      date: '2025-12-01T08:00:00Z',
    },
  ];

  for (const orderInfo of ordersInfo) {
    const itemsData = orderInfo.productItems.map(item => {
        const product = getProductByCode(item.code);
        return {
            productId: product.id,
            quantity: item.quantity,
            priceAtOrder: product.price,
            productName: product.name,
            productCode: product.code,
        };
    });

    const totalAmount = itemsData.reduce((sum, item) => sum + (item.priceAtOrder * item.quantity), 0);
    
    await prisma.order.create({
      data: {
        userId: user.id, // ID jest typu String
        status: orderInfo.status,
        totalAmount: parseFloat(totalAmount.toFixed(2)),
        createdAt: new Date(orderInfo.date),
        updatedAt: new Date(orderInfo.date),
        items: {
          create: itemsData,
        },
      },
    });
  }
  console.log(`Utworzono ${ordersInfo.length} przykładowych zamówień.`);
}

main()
  .then(() => console.log('Seeding zakończony pomyślnie!'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });