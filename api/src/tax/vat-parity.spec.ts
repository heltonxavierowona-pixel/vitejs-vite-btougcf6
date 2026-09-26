import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Le front affiche un aperçu des totaux calculé par une copie de
 * ce dossier (web/src/lib/tax). Si les deux copies divergent,
 * l'utilisateur verrait un montant différent de celui enregistré.
 * Correction : `npm run sync:tax` dans web/.
 */
describe('parité du moteur TVA API ↔ front', () => {
  const webDir = join(__dirname, '../../../web/src/lib/tax');

  it.each(['tax.constants.ts', 'vat-calculator.ts'])(
    '%s est identique des deux côtés',
    (file) => {
      const api = readFileSync(join(__dirname, file), 'utf8');
      const web = readFileSync(join(webDir, file), 'utf8');
      expect(web).toBe(api);
    },
  );
});
