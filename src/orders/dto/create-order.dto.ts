import { IsBoolean, IsEnum, IsNumber, IsOptional, IsPositive } from "class-validator";
import { OrderStatusList } from "../enum/order.enum";
import { OrderStatus } from "generated/prisma";

export class CreateOrderDto {
    @IsNumber()
    @IsPositive()
    public totalAmount: number;

    @IsNumber()
    @IsPositive()
    public totalItems: number;

    @IsEnum(OrderStatusList, { message: 'Invalid order status' })
    @IsOptional()
    public status: OrderStatus = OrderStatus.PENDING;

    @IsBoolean()
    @IsOptional()
    public paid: boolean = false;
}
