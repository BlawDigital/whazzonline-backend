import {
  Module,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { GoodsInvoicesService } from './goods-invoices.service';
import { ReferralsModule } from '../referrals/referrals.module';
import {
  GoodsInvoicesController,
  MerchantPaymentsController,
} from './goods-invoices.controller';
@Injectable()
class InvoiceExpiry implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(private readonly invoices: GoodsInvoicesService) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), 300000);
    this.timer.unref();
    void this.sweep();
  }
  private async sweep() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.invoices.expire();
    } catch {
      /* Retry on the next sweep; do not expose database or account credentials in logs. */
    } finally {
      this.busy = false;
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
@Module({
  imports: [ReferralsModule],
  controllers: [GoodsInvoicesController, MerchantPaymentsController],
  providers: [GoodsInvoicesService, InvoiceExpiry],
  exports: [GoodsInvoicesService],
})
export class GoodsInvoicesModule {}
