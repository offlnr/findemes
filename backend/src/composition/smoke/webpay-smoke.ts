// Smoke test against the Transbank integration environment (no real charges): creates one
// Webpay Plus transaction and prints the URL to pay it with a test card.
//   pnpm smoke:webpay
import { randomBytes } from 'node:crypto';
import { clp } from '../../core/index.ts';
import { createWebpayPlusGateway, WEBPAY_INTEGRATION } from '../../adapters/webpay/webpay-plus-gateway.ts';
import { buyOrderFrom } from '../../modules/subscription/domain/subscription.ts';

const gateway = createWebpayPlusGateway(WEBPAY_INTEGRATION);
const buyOrder = buyOrderFrom(randomBytes(16).toString('hex'));
const started = await gateway.start(buyOrder, 'smoke-test', clp(5990), 'http://localhost:3000/v1/payments/webpay/return');
process.stdout.write(`Orden ${buyOrder} creada en el ambiente de integración.\nPagar en: ${started.redirectUrl}?token_ws=${started.token}\n`);
