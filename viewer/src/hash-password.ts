import bcrypt from 'bcryptjs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

/**
 * Genera el hash bcrypt para VIEWER_PASSWORD_HASH sin dejar la contraseña
 * en texto plano en ningún archivo ni en el historial de la shell.
 * Uso: npm run hash-password  (pide la contraseña por prompt)
 */
async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  const password = await rl.question('Contraseña para el viewer: ');
  rl.close();

  if (!password.trim()) {
    console.error('Contraseña vacía, cancelado.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  console.log('\nVIEWER_PASSWORD_HASH=' + hash);
  console.log('\nPegá esa línea completa como variable de entorno en Railway (servicio mev-viewer).');
}

main();
