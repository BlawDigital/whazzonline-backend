import { Injectable } from '@nestjs/common';

export type DeliveryLevel = 'standard' | 'priority';
export abstract class DeliveryProvider {
  abstract quotes(): {
    provider: string;
    mode: string;
    serviceLevel: DeliveryLevel;
    fee: number;
    etaMinutes: number;
  }[];
  abstract book(
    fulfillmentId: string,
    serviceLevel: DeliveryLevel,
  ): {
    provider: string;
    serviceLevel: DeliveryLevel;
    fee: number;
    etaMinutes: number;
    trackingCode: string;
    rider: { name: string; vehicle: string; simulated: boolean };
    status: string;
  };
}

@Injectable()
export class MockDeliveryProvider extends DeliveryProvider {
  quotes() {
    return [
      {
        provider: 'mock',
        mode: 'mock',
        serviceLevel: 'standard' as const,
        fee: 1500,
        etaMinutes: 60,
      },
      {
        provider: 'mock',
        mode: 'mock',
        serviceLevel: 'priority' as const,
        fee: 2500,
        etaMinutes: 30,
      },
    ];
  }
  book(fulfillmentId: string, serviceLevel: DeliveryLevel) {
    const quote = this.quotes().find(
      (item) => item.serviceLevel === serviceLevel,
    )!;
    return {
      provider: quote.provider,
      serviceLevel,
      fee: quote.fee,
      etaMinutes: quote.etaMinutes,
      trackingCode: `MOCK-${fulfillmentId}`,
      status: 'assigned',
      rider: {
        name: 'Demo courier',
        vehicle: 'Demo motorcycle',
        simulated: true,
      },
    };
  }
}
