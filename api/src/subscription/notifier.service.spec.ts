import { NotifierService } from './notifier.service';

describe('NotifierService — WhatsApp (CallMeBot)', () => {
  const env = { ...process.env };
  const prisma = { platformSetting: { findUnique: jest.fn().mockResolvedValue(null) } } as any;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env = { ...env, NODE_ENV: 'test', WHATSAPP_NOTIFY_PHONE: '+237 656 56 67 62', WHATSAPP_NOTIFY_APIKEY: '123456' };
    delete process.env.TELEGRAM_BOT_TOKEN;
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });
  afterAll(() => {
    process.env = env;
  });

  it('envoie le message au numéro de l’administrateur', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => 'Message queued. You will receive it in a few seconds.' });
    const sent = await new NotifierService(prisma).notifyAdmin('Nouvelle demande', ['Offre : PME Pro']);
    expect(sent).toBe(true);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://api.callmebot.com/whatsapp.php');
    expect(url.searchParams.get('phone')).toBe('+237656566762');
    expect(url.searchParams.get('apikey')).toBe('123456');
    expect(url.searchParams.get('text')).toBe('*Nouvelle demande*\nOffre : PME Pro');
  });

  it('considère une clé refusée comme un échec', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => 'APIKey is invalid.' });
    expect(await new NotifierService(prisma).sendWhatsApp('test')).toBe(false);
  });

  it('ne fait rien sans configuration', async () => {
    delete process.env.WHATSAPP_NOTIFY_APIKEY;
    expect(await new NotifierService(prisma).sendWhatsApp('test')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
