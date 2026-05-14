// stripe-webhook — RealtyFlow Systems
// Listens for Stripe payment events.
// On success: creates client record → sends onboarding email with portal link.
//
// Stripe dashboard → Webhooks → Add endpoint:
//   URL: https://YOUR_PROJECT_ID.supabase.co/functions/v1/stripe-webhook
//   Events: checkout.session.completed, payment_intent.succeeded

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req: Request) => {
  const signature = req.headers.get("stripe-signature");
  const body      = await req.text();

  if (!signature) {
    return new Response("Missing stripe-signature", { status: 400 });
  }

  // Verify Stripe signature (manual HMAC — avoids importing full Stripe SDK)
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
  const isValid = await verifyStripeSignature(body, signature, webhookSecret);
  if (!isValid) {
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(body);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  if (
    event.type === "checkout.session.completed" ||
    event.type === "payment_intent.succeeded"
  ) {
    const session       = event.data.object;
    const customerEmail = session.customer_details?.email ?? session.receipt_email ?? "";
    const customerName  = session.customer_details?.name  ?? "Client";
    const amountCents   = session.amount_total ?? session.amount ?? 0;
    const plan          = session.metadata?.plan ?? "starter";

    if (!customerEmail) {
      console.warn("No customer email in event", event.id);
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // Upsert lead → mark as client
    const { data: lead } = await supabase
      .from("leads")
      .upsert(
        {
          email: customerEmail.toLowerCase(),
          name:  customerName,
          stage: "client",
        },
        { onConflict: "email" }
      )
      .select()
      .single();

    // Create client record
    const { data: client } = await supabase
      .from("clients")
      .insert({
        lead_id:            lead?.id ?? null,
        stripe_customer_id: session.customer ?? null,
        plan,
        amount_cents:  amountCents,
        status:        "active",
        onboarded_at:  new Date().toISOString(),
      })
      .select()
      .single();

    // Log payment
    await supabase.from("payments").insert({
      client_id:                 client?.id ?? null,
      stripe_payment_intent_id:  session.payment_intent ?? session.id,
      amount_cents:              amountCents,
      status:                    "succeeded",
      description:               session.metadata?.description ?? plan,
    });

    // Send onboarding email
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey && client) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "RealtyFlow Systems <erics@realtyflow.xyz>",
          to:   [customerEmail],
          subject: "Welcome to RealtyFlow Systems — Your Portal is Live",
          html: onboardingEmail(customerName, client.portal_access_token, plan),
        }),
      });

      await supabase.from("email_log").insert({
        lead_id:  lead?.id ?? null,
        to_email: customerEmail,
        subject:  "Welcome to RealtyFlow Systems",
        type:     "onboarding",
      });
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});

async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string
): Promise<boolean> {
  try {
    const parts     = Object.fromEntries(header.split(",").map(p => p.split("=")));
    const timestamp = parts["t"];
    const signature = parts["v1"];
    const signed    = `${timestamp}.${payload}`;
    const key       = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const mac  = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed));
    const hex  = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");
    return hex === signature;
  } catch {
    return false;
  }
}

function onboardingEmail(name: string, token: string, plan: string): string {
  const firstName = name.split(" ")[0];
  const portalUrl = `https://realtyflow.xyz/portal?token=${token}`;
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="background:#0A0A0A;color:#fff;font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;padding:0;">
  <div style="padding:32px 40px;border-bottom:1px solid rgba(201,168,76,.2);">
    <p style="font-size:10px;color:#C9A84C;letter-spacing:.3em;text-transform:uppercase;margin:0 0 8px;">RealtyFlow Systems</p>
    <h1 style="font-size:30px;font-weight:300;margin:0;line-height:1.2;">Welcome,<br><em style="font-style:italic;color:#C9A84C;">${firstName}</em></h1>
  </div>
  <div style="padding:32px 40px;">
    <p style="font-size:14px;color:#AAA;line-height:1.75;margin:0 0 8px;">
      Payment confirmed. You're on the <strong style="color:#E0E0E0;">${planLabel}</strong> plan. Your client portal is live and your onboarding checklist is waiting.
    </p>
    <div style="margin:28px 0;">
      <a href="${portalUrl}"
         style="display:inline-block;padding:14px 28px;background:#C9A84C;color:#0A0A0A;
                font-size:11px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;
                text-decoration:none;">
        ACCESS YOUR PORTAL →
      </a>
    </div>
    <p style="font-size:13px;color:#AAA;line-height:1.75;">
      I'll reach out within 24 hours to schedule your kickoff call and walk through your setup. Keep this email — your portal link is unique to your account.
    </p>
    <p style="font-size:13px;color:#AAA;line-height:1.75;margin-top:16px;">
      Questions? Reply here or email
      <a href="mailto:erics@realtyflow.xyz" style="color:#C9A84C;text-decoration:none;">erics@realtyflow.xyz</a>
    </p>
  </div>
  <div style="padding:20px 40px;border-top:1px solid rgba(255,255,255,.06);">
    <p style="font-size:11px;color:#444;margin:0;line-height:1.7;">
      RealtyFlow Systems · 820 Massachusetts Ave, Cambridge, MA 02139
    </p>
  </div>
</body>
</html>`;
}
