import { z } from 'zod';
import { WEBPAY_INTEGRATION, WEBPAY_PRODUCTION_URL, type WebpayConfig } from '../adapters/webpay/webpay-plus-gateway.ts';

const EXACT_ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/;

const paymentsSchema = z.object({
  // integration: Transbank test environment with its public credentials (no real charges).
  WEBPAY_ENVIRONMENT: z.enum(['integration', 'production']).default('integration'),
  WEBPAY_COMMERCE_CODE: z.string().regex(/^\d{12}$/).optional(),
  WEBPAY_API_KEY: z.string().min(32).optional(),
  // Public URL of this API, where Transbank sends the browser back.
  API_PUBLIC_URL: z.string().regex(EXACT_ORIGIN).default('http://localhost:3000'),
});

export interface PaymentsConfig {
  readonly webpay: WebpayConfig;
  readonly environment: 'integration' | 'production';
  readonly apiPublicUrl: string;
}

/**
 * Webpay Plus settings. During the project only the integration environment is used; production
 * requires its own commerce code and key and refuses to fall back to the test credentials.
 * Errors name the variable but never echo its value.
 */
export function loadPaymentsConfig(env: NodeJS.ProcessEnv): PaymentsConfig {
  const pick = (key: string) => (env[key] === undefined || env[key] === '' ? undefined : env[key]);
  const parsed = paymentsSchema.safeParse({
    WEBPAY_ENVIRONMENT: pick('WEBPAY_ENVIRONMENT'),
    WEBPAY_COMMERCE_CODE: pick('WEBPAY_COMMERCE_CODE'),
    WEBPAY_API_KEY: pick('WEBPAY_API_KEY'),
    API_PUBLIC_URL: pick('API_PUBLIC_URL'),
  });
  if (!parsed.success) {
    const variables = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ');
    throw new Error(`Invalid payments configuration in environment variables: ${variables}`);
  }
  const data = parsed.data;
  if (data.WEBPAY_ENVIRONMENT === 'production') {
    if (data.WEBPAY_COMMERCE_CODE === undefined || data.WEBPAY_API_KEY === undefined) {
      throw new Error('Invalid payments configuration in environment variables: WEBPAY_COMMERCE_CODE, WEBPAY_API_KEY');
    }
    return {
      environment: 'production',
      apiPublicUrl: data.API_PUBLIC_URL,
      webpay: { baseUrl: WEBPAY_PRODUCTION_URL, commerceCode: data.WEBPAY_COMMERCE_CODE, apiKey: data.WEBPAY_API_KEY },
    };
  }
  return {
    environment: 'integration',
    apiPublicUrl: data.API_PUBLIC_URL,
    webpay: {
      baseUrl: WEBPAY_INTEGRATION.baseUrl,
      commerceCode: data.WEBPAY_COMMERCE_CODE ?? WEBPAY_INTEGRATION.commerceCode,
      apiKey: data.WEBPAY_API_KEY ?? WEBPAY_INTEGRATION.apiKey,
    },
  };
}
