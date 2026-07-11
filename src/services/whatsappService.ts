import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM;

if (!accountSid || !authToken || !whatsappFrom) {
  throw new Error('Missing Twilio configuration in environment');
}

const client = twilio(accountSid, authToken);

export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  await client.messages.create({
    from: `whatsapp:${whatsappFrom}`,
    to: `whatsapp:${to}`,
    body,
  });
}
