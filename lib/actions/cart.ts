"use server"

import { prisma } from "../db"
import { revalidatePath } from "next/cache"

export async function getCartWithItems(userId: string) {
  return await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: {
          product: {
            include: {
              category: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }
    }
  })
}

export async function getCartTotal(userId: string) {
  const cart = await getCartWithItems(userId)
  if (!cart) return 0
  
  return cart.items.reduce((sum, item) => {
    return sum + (Number(item.product.price) * item.quantity)
  }, 0)
}

export async function getAllUsersWithCarts() {
  return await prisma.user.findMany({
    include: {
      cart: {
        include: {
          _count: {
            select: { items: true }
          }
        }
      }
    }
  })
}

export async function transferCart(fromUserId: string, toUserId: string) {
  if (fromUserId === toUserId) {
    throw new Error("Nie można przenieść koszyka do tego samego użytkownika")
  }

  const sourceCart = await prisma.cart.findUnique({
    where: { userId: fromUserId },
    include: { items: true }
  })

  if (!sourceCart || sourceCart.items.length === 0) {
    return { success: false, message: "Kosz źródłowy jest pusty" }
  }

  let targetCart = await prisma.cart.findUnique({
    where: { userId: toUserId }
  })

  if (!targetCart) {
    targetCart = await prisma.cart.create({
      data: { userId: toUserId }
    })
  }

  for (const item of sourceCart.items) {
    await prisma.cartItem.upsert({
      where: {
        cartId_productId: {
          cartId: targetCart.id,
          productId: item.productId
        }
      },
      update: {
        quantity: { increment: item.quantity }
      },
      create: {
        cartId: targetCart.id,
        productId: item.productId,
        quantity: item.quantity
      }
    })
  }

  await prisma.cartItem.deleteMany({
    where: { cartId: sourceCart.id }
  })

  revalidatePath("/basket")
  return { success: true }
}