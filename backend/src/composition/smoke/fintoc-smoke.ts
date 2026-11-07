// Smoke test against Fintoc's test mode: creates one Link Intent with the sk_test_ key from
// backend/.env.local and prints whether it worked (never the keys or tokens).
//   pnpm smoke:fintoc
import { createFintocClient } from '../../adapters/fintoc/fintoc-client.ts';
import { loadBankConfig } from '../bank-config.ts';

const config = loadBankConfig(process.env);
if (config.fintoc === null) {
  process.stdout.write('Sin llaves de Fintoc: define FINTOC_SECRET_KEY (sk_test_) y FINTOC_PUBLIC_KEY (pk_test_) en backend/.env.local.\n');
  process.stdout.write('Mientras tanto, la app ofrece solo el banco de demostración.\n');
} else {
  const intent = await createFintocClient(config.fintoc).createLinkIntent();
  process.stdout.write(`Link Intent creado en el modo de prueba de Fintoc (widget token de ${String(intent.widgetToken.length)} caracteres).\n`);
  process.stdout.write('Credenciales de prueba para el widget: RUT 41614850-3, clave jonsnow (ADR-002).\n');
}
