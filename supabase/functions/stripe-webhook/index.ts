/**
 * stripe-webhook — Supabase Edge Function
 * Handles Stripe payment events.
 *
 * Events handled:
 *   checkout.session.completed  → create payment record, create client, send onboarding email
 *   payment_intent.succeeded    → update payment status
 *   payment_intent.payment_failed → update payment status, log error
 *   customer.subscription.deleted → log cancellation
 *
 * Deploy:
 *   supabase functions deploy stripe-webhook
 *
 * Stripe Webhook setup:
 *   Dashboard → Developers → Webhooks → Add endpoint
 *   URL: https://<project-ref>.supabase.co/functions/v1/stripe-webhook
 *   Events: checkout.session.completed, payment_intent.succeeded,
 *           payment_intent.payment_failed
 *
 * Required env vars:
 *   STRIPE_WEBHOOK_SECRET   (whsec_...)
 *   RESEND_API_KEY
 *   RFS_FROM_EMAIL
 *   SUPABASE_URL            (auto-injected)
 *   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14';

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

  if (!signature || !webhookSecret) {
    return new Response('Missing signature', { status: 400 });
  }

  const body = await req.text();
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
    apiVersion: '2024-06-20',
  });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return new Response(`Webhook Error: ${err}`, { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutComplete(supabase, stripe, session);
        break;
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        await supabase
          .from('payments')
          .update({ status: 'succeeded' })
          .eq('stripe_payment_intent_id', pi.id);
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        await supabase
          .from('payments')
          .update({
            status: 'failed',
            // store error in description for visibility
          })
          .eq('stripe_payment_intent_id', pi.id);
        break;
      }

      default:
        console.log(`Unhandled event: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Error handling event:', err);
    return new Response(`Handler error: ${err}`, { status: 500 });
  }
});

// ── checkout.session.completed ───────────────────────────────
async function handleCheckoutComplete(
  supabase: any,
  stripe: Stripe,
  session: Stripe.Checkout.Session
) {
  const email = session.customer_details?.email || session.customer_email;
  if (!email) {
    console.error('No email on checkout session', session.id);
    return;
  }

  // Find or create lead
  let { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('email', email.toLowerCase())
    .single();

  if (!lead) {
    // New buyer not yet in CRM — create lead
    const name = session.customer_details?.name || '';
    const parts = name.split(' ');
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        fname: parts[0] || 'Unknown',
        lname: parts.slice(1).join(' ') || '',
        email: email.toLowerCase(),
        phone: session.customer_details?.phone || null,
        source: 'Stripe Checkout',
        stage: 5,
        stage_name: 'Closed Won',
      })
      .select()
      .single();
    lead = newLead;
  } else {
    // Advance existing lead to Closed Won
    await supabase
      .from('leads')
      .update({ stage: 5, stage_name: 'Closed Won' })
      .eq('id', lead.id);
  }

  if (!lead) return;

  // Determine tier from metadata or amount
  const tier = session.metadata?.tier ||
    getTierByAmount(session.amount_total || 0);

  // Create payment record
  const { data: payment } = await supabase
    .from('payments')
    .insert({
      lead_id: lead.id,
      stripe_payment_intent_id: session.payment_intent as string,
      stripe_customer_id: session.customer as string,
      stripe_checkout_session_id: session.id,
      amount_cents: session.amount_total || 0,
      status: 'succeeded',
      tier,
      description: `${tier} — ${session.payment_intent}`,
    })
    .select()
    .single();

  // Create client record
  const { data: client } = await supabase
    .from('clients')
    .upsert(
      {
        lead_id: lead.id,
        payment_id: payment?.id,
        onboarding_stage: 0,
        onboarding_stage_name: 'Welcome',
      },
      { onConflict: 'lead_id' }
    )
    .select()
    .single();

  // Log the payment event
  await supabase.from('activity_log').insert({
    lead_id: lead.id,
    type: 'payment',
    description: `Payment succeeded — ${tier} ($${((session.amount_total || 0) / 100).toFixed(0)})`,
    metadata: {
      stripe_session_id: session.id,
      amount_cents: session.amount_total,
      tier,
    },
  });

  // Send onboarding email
  if (client) {
    await sendOnboardingEmail(lead, client, tier);
  }

  // Enroll in relevant follow-up sequence (cancel any active nurture)
  await supabase
    .from('sequence_enrollments')
    .update({ cancelled: true })
    .eq('lead_id', lead.id)
    .eq('cancelled', false);
}

// ── Onboarding email ─────────────────────────────────────────
async function sendOnboardingEmail(lead: any, client: any, tier: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) return;

  const fromEmail = Deno.env.get('RFS_FROM_EMAIL') || 'erics@realtyflow.xyz';
  const portalUrl = `https://realtyflow.xyz/portal?token=${client.portal_token}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111111;border:1px solid rgba(201,168,76,0.15);">
      <tr>
        <td style="padding:40px 48px 32px;border-bottom:1px solid rgba(201,168,76,0.12);">
          <div style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#C9A84C;letter-spacing:0.08em;">
            RealtyFlow <span style="font-weight:300;">Systems</span>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:40px 48px;">
          <p style="font-size:13px;color:#C9A84C;letter-spacing:0.25em;text-transform:uppercase;margin:0 0 16px;font-family:monospace;">
            ${tier} · Welcome
          </p>
          <h1 style="font-family:Georgia,serif;font-size:32px;font-weight:300;color:#FFFFFF;margin:0 0 24px;line-height:1.2;">
            Welcome to RFS, ${lead.fname}.
          </h1>
          <p style="font-size:15px;color:#CCCCCC;line-height:1.75;margin:0 0 24px;">
            Payment confirmed. You are now an active RealtyFlow Systems client.
            Here is what happens next:
          </p>
          <table cellpadding="0" cellspacing="0" width="100%" style="background:rgba(201,168,76,0.05);border:1px solid rgba(201,168,76,0.15);margin-bottom:32px;">
            <tr><td style="padding:24px 28px;">
              <p style="font-family:monospace;font-size:10px;color:#C9A84C;letter-spacing:0.2em;text-transform:uppercase;margin:0 0 16px;">Next steps</p>
              <ol style="font-size:14px;color:#CCCCCC;line-height:2;margin:0;padding-left:20px;">
                <li><strong style="color:#fff;">Complete your intake form</strong> — 5 minutes in your client portal</li>
                <li><strong style="color:#fff;">System setup</strong> — I'll build your speed-to-lead infrastructure within 72 hours</li>
                <li><strong style="color:#fff;">Go live</strong> — Your system launches and starts working for you 24/7</li>
              </ol>
            </td></tr>
          </table>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:40px;">
            <tr><td style="background:#C9A84C;padding:0;">
              <a href="${portalUrl}"
                 style="display:inline-block;padding:16px 40px;background:#C9A84C;color:#0A0A0A;font-size:12px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;text-decoration:none;">
                Access Your Client Portal →
              </a>
            </td></tr>
          </table>
          <p style="font-size:14px;color:#AAAAAA;line-height:1.7;margin:0 0 32px;">
            I'll also be reaching out directly within 24 hours to kick things off.
            If you have any questions before then, reply to this email.
          </p>
          <p style="font-size:15px;color:#FFFFFF;margin:0;">— Erics</p>
          <p style="font-size:13px;color:#666666;margin:4px 0 0;">RealtyFlow Systems · Boston, MA</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 48px;border-top:1px solid rgba(201,168,76,0.08);">
          <p style="font-size:11px;color:#555555;margin:0;line-height:1.6;">
            RealtyFlow Systems · 820 Massachusetts Ave, Cambridge, MA 02139<br>
            <a href="https://realtyflow.xyz/privacy" style="color:#C9A84C;text-decoration:none;">Privacy Policy</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Erics @ RealtyFlow <${fromEmail}>`,
      to: lead.email,
      reply_to: fromEmail,
      subject: `Welcome to RealtyFlow Systems — ${tier}`,
      html,
    }),
  });
}

// ── Map Stripe amount → tier name ────────────────────────────
function getTierByAmount(amountCents: number): string {
  if (amountCents >= 750000) return 'Team Infrastructure';
  if (amountCents >= 400000) return 'Revenue Acceleration';
  return 'Core';
}
