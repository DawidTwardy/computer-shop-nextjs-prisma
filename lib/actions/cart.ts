// /lib/actions/cart.ts
'use server'; 

import prisma from "@/lib/prisma";
import { revalidatePath } from 'next/cache';

// Definicja typu CartItem z relacjami
type CartItemWithProductAndCategory = {
    id: number;
    quantity: number;
    createdAt: Date;
    updatedAt: Date;
    cartId: number;
    productId: number;
    product: {
        id: number;
        code: string;
        name: string;
        type: string;
        description: string | null;
        price: number;
        amount: number;
        image: string | null;
        createdAt: Date;
        updatedAt: Date;
        categoryId: number;
        category: {
            id: number;
            name: string;
        };
    };
};

type CartWithItems = {
    id: number;
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    items: CartItemWithProductAndCategory[];
};

/**
 * Pobiera koszyk użytkownika wraz ze wszystkimi powiązanymi danymi. (Task 4.15.1)
 * @param userId Identyfikator użytkownika (typ string/CUID).
 * @returns Obiekt koszyka (Cart) lub null.
 */
export async function getCartWithItems(userId: string): Promise<CartWithItems | null> {
  const cart = await prisma.cart.findUnique({
    where: { 
      userId: userId // Użycie findUnique() na userId (string)
    }, 
    include: {
      items: { // Dołącz pozycje w koszyku
        include: {
          product: { // Dla każdej pozycji dołącz product
            include: {
              category: true, // Dla każdego produktu dołącz category
            },
          },
        },
        orderBy: {
          createdAt: 'desc', // Posortuj pozycje po createdAt malejąco
        },
      },
    },
  }) as CartWithItems | null;

  return cart; // Zwróć cały obiekt koszyka lub null
}


/**
 * Oblicza całkowitą wartość koszyka użytkownika. (Task 4.15.2)
 * @param userId Identyfikator użytkownika.
 * @returns Całkowita wartość koszyka (number).
 */
export async function getCartTotal(userId: string): Promise<number> {
  const cart = await getCartWithItems(userId); // Wywołaj getCartWithItems()

  if (!cart) {
    return 0; // Jeśli koszyk nie istnieje, zwróć 0
  }

  // Użyj metody reduce() na tablicy cart.items do obliczenia sumy
  const total = cart.items.reduce((sum, item) => {
    // Dla każdej pozycji: cena produktu * ilość
    const price = Number(item.product.price);
    return sum + (price * item.quantity);
  }, 0); // Wartość początkowa: 0

  return parseFloat(total.toFixed(2)); // Zwróć całkowitą wartość
}


/**
 * Pobiera listę wszystkich użytkowników z liczbą produktów w ich koszykach. (Task 7.1.2c)
 */
export async function getAllUsersWithCarts() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      cart: {
        select: {
          id: true,
          _count: {
            select: {
              items: true,
            },
          },
        },
      },
    },
    orderBy: {
      name: 'asc'
    }
  });

  // Przetwarzanie wyników do formatu z pożądaną liczbą produktów
  return users.map(user => ({
    id: user.id,
    email: user.email,
    name: user.name,
    cartId: user.cart?.id || null,
    itemCount: user.cart ? user.cart._count.items : 0,
  }));
}

/**
 * Przenosi wszystkie produkty z koszyka jednego użytkownika do koszyka drugiego. (Task 7.1.2d)
 */
export async function transferCart(fromUserId: string, toUserId: string) {
  // Walidacja (nie można przenieść do tego samego użytkownika) (Task 7.1.4c)
  if (fromUserId === toUserId) {
    throw new Error('Nie można przenieść koszyka do tego samego użytkownika.');
  }

  const fromCart = await prisma.cart.findUnique({
    where: { userId: fromUserId },
    include: { items: true },
  });

  if (!fromCart || fromCart.items.length === 0) {
    // Jeśli koszyk źródłowy jest pusty, nic nie rób
    console.log(`Koszyk źródłowy (user: ${fromUserId}) jest pusty lub nie istnieje. Anulowanie transferu.`);
    revalidatePath('/basket'); 
    return;
  }

  // Pobierz lub utwórz koszyk docelowy
  let toCart = await prisma.cart.findUnique({
    where: { userId: toUserId },
    select: { id: true }
  });

  if (!toCart) {
    toCart = await prisma.cart.create({
      data: { userId: toUserId },
      select: { id: true }
    });
  }

  const toCartId = toCart.id;
  const itemTransferOperations: any[] = [];
  const productIdsToTransfer = fromCart.items.map(item => item.productId);

  // 1. Pobierz obecne pozycje w koszyku docelowym dla produktów, które mają być przeniesione
  const existingToCartItems = await prisma.cartItem.findMany({
    where: {
      cartId: toCartId,
      productId: {
        in: productIdsToTransfer,
      }
    }
  });
  
  const existingItemsMap = new Map(existingToCartItems.map(item => [item.productId, item]));

  // 2. Utwórz operacje upsert/update dla każdej pozycji z koszyka źródłowego
  for (const fromItem of fromCart.items) {
    const existingItem = existingItemsMap.get(fromItem.productId);

    if (existingItem) {
      // Jeśli produkt już istnieje w koszyku docelowym, zaktualizuj ilość
      itemTransferOperations.push(
        prisma.cartItem.update({
          where: {
            id: existingItem.id,
          },
          data: {
            quantity: existingItem.quantity + fromItem.quantity,
          },
        })
      );
    } else {
      // Jeśli produkt nie istnieje, utwórz nową pozycję w koszyku docelowym
      itemTransferOperations.push(
        prisma.cartItem.create({
          data: {
            cartId: toCartId,
            productId: fromItem.productId,
            quantity: fromItem.quantity,
          },
        })
      );
    }
  }

  // 3. Usuń wszystkie pozycje z koszyka źródłowego
  const deleteSourceItems = prisma.cartItem.deleteMany({
    where: { cartId: fromCart.id },
  });

  // 4. Wykonaj wszystkie operacje w jednej transakcji
  await prisma.$transaction([
    ...itemTransferOperations,
    deleteSourceItems,
  ]);
  
  // Odświeżenie strony po transferze (redirect) (Task 7.1.4e)
  revalidatePath('/basket'); 
}