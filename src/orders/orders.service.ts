import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { PrismaClient } from 'generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { ChangeOrderStatusDto, OrderPaginationDto } from './dto';
import { PRODUCT_SERVICE } from 'src/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {

  private readonly logger = new Logger('OrdersService');

  constructor(
    @Inject(PRODUCT_SERVICE) private readonly productMicroservice: ClientProxy,
  ) {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async create(createOrderDto: CreateOrderDto) {

    try {

      // confirmar que los productos existen
      const productIds = createOrderDto.items.map(item => item.productId);
      const products: any[] = await firstValueFrom(this.productMicroservice.send({ cmd: 'validate_products' }, productIds));

      // calculo de los valores
      const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {
        const price = products.find(product => product.id === orderItem.productId).price;
        return acc + price * orderItem.quantity;
      }, 0);

      const totalItems = createOrderDto.items.reduce((acc, orderItem) => {
        return acc + orderItem.quantity;
      }, 0);

      // crear una transaccion de la base de datos
      const order = await this.order.create({
        data: {
          totalAmount,
          totalItems,
          orderItems: {
            createMany: {
              data: createOrderDto.items.map(item => ({
                productId: item.productId,
                quantity: item.quantity,
                price: products.find(product => product.id === item.productId).price,
              }))
            }
          }
        },
        include: {
          orderItems: {
            select: {
              productId: true,
              quantity: true,
              price: true,
            }
          }
        }
      })

      return {
        ...order,
        orderItems: order.orderItems.map(item => ({
          ...item,
          name: products.find(product => product.id === item.productId).name,
        })),
      };

    } catch (error) {
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        message: error.message,
      });
    }
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const totalPages = await this.order.count({
      where: {
        status: orderPaginationDto.status
      }
    })
    const currentPages = orderPaginationDto.page || 1;
    const perPage = orderPaginationDto.limit || 10;
    return {
      data: await this.order.findMany({
        skip: (currentPages - 1) * perPage,
        take: perPage,
        where: {
          status: orderPaginationDto.status
        }
      }),
      meta: {
        total: totalPages,
        page: currentPages,
        lastPage: Math.ceil(totalPages / perPage),
        perPage
      }
    }
  }
  async findOne(id: string) {
    const order = await this.order.findFirst({
      where: { id },
      include: {
        orderItems: {
          select: {
            productId: true,
            quantity: true,
            price: true,
          }
        }
      }
    });
    if (!order) {
      throw new RpcException({ status: HttpStatus.NOT_FOUND, message: `Order with ID ${id} not found` });
    }

    const productIds = order.orderItems.map(item => item.productId);
    const products: any[] = await firstValueFrom(this.productMicroservice.send({ cmd: 'validate_products' }, productIds));
    return {
      ...order,
      orderItems: order.orderItems.map(item => ({
        ...item,
        name: products.find(product => product.id === item.productId).name,
      })),
    };
  }

  async changeStatus(changeOrderStatusDto: ChangeOrderStatusDto) {
    const { id, status } = changeOrderStatusDto;

    const order = await this.order.findFirst({
      where: { id },
    });

    if (order?.status === status) { // si viene el mismo status no hace nada
      return order;
    }

    return this.order.update({
      where: { id },
      data: { status: status },
    });
  }
}
